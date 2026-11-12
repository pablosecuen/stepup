/**
 * Animación de los contadores (importes, cantidades, horas, porcentajes) — lógica pura, sin React.
 *
 * Reglas (todas probadas en `lib/ui/__tests__/count-animation.test.ts`):
 *  - El valor FINAL es siempre el estado por defecto. La animación sólo reemplaza el texto mientras corre; nunca se
 *    "prepara" un 0 en un elemento que todavía no se ve. Si el observador no existe, no avisa, el movimiento está
 *    reducido o la animación se interrumpe, queda el valor final.
 *  - Arranca apenas UN píxel del contador entra en pantalla (no un porcentaje ni un margen recortado): un contador
 *    parcialmente visible cerca del borde inferior arranca igual.
 *  - Una animación nueva cancela la anterior (nunca dos a la vez) y puede partir del valor que se estaba mostrando.
 *  - Los importes se interpolan en centavos y el último valor es exactamente el recibido (nunca un redondeo).
 */

export type CountKind = "money" | "count" | "hours" | "percent";

export const COUNT_ANIMATION_MS = 900;

/** Valor intermedio de la animación: ease-out cúbico entre `from` y `to`; en `progress >= 1` es exactamente `to`. */
export function countValueAt(from: number, to: number, progress: number, kind: CountKind): number {
  if (!(progress < 1)) return to;
  const eased = 1 - Math.pow(1 - Math.max(0, progress), 3);
  const raw = from + (to - from) * eased;
  return kind === "count" || (Number.isInteger(from) && Number.isInteger(to)) ? Math.round(raw) : Math.round(raw * 100) / 100;
}

/** Lo que el controlador necesita del entorno; en el navegador lo arma `createBrowserCountEnv`. */
export interface CountEnv {
  prefersReducedMotion(): boolean;
  /** Avisa si cambia la preferencia de movimiento; devuelve la función que deja de avisar. */
  onReducedMotionChange(listener: () => void): () => void;
  /** `true` si ahora mismo se ve al menos un píxel del contador dentro de la ventana. */
  isVisibleNow(): boolean;
  /** Observador de visibilidad, o `null` si el navegador no lo tiene. Devuelve la función que lo corta. */
  watchVisibility: ((listener: (visible: boolean) => void) => () => void) | null;
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(id: number): void;
}

export interface CountRun {
  /** Corta todo (cuadros, observador, preferencia) sin tocar lo que se ve. Idempotente. */
  dispose(): void;
}

/**
 * Muestra `to` y, si corresponde, lo anima desde `from` cuando el contador entra en pantalla.
 * `emit(value, final)` se llama con cada valor mostrado; `final` es `true` cuando el valor ya es `to`.
 * Antes de animar NO se emite nada: el consumidor muestra `to` por defecto.
 */
export function runCountAnimation(options: { from: number; to: number; kind: CountKind; env: CountEnv; emit: (value: number, final: boolean) => void; durationMs?: number }): CountRun {
  const { from, to, kind, env, emit } = options;
  const duration = options.durationMs ?? COUNT_ANIMATION_MS;
  let disposed = false;
  let frame: number | null = null;
  let unwatchVisibility: (() => void) | null = null;
  let unwatchMotion: (() => void) | null = null;

  const release = () => {
    if (frame !== null) { env.cancelFrame(frame); frame = null; }
    if (unwatchVisibility) { unwatchVisibility(); unwatchVisibility = null; }
    if (unwatchMotion) { unwatchMotion(); unwatchMotion = null; }
  };
  const finish = () => {
    if (disposed) return;
    disposed = true;
    release();
    emit(to, true);
  };
  const dispose = () => { disposed = true; release(); };

  // Nada que animar: valor ausente/ inválido, sin cambio, movimiento reducido o sin observador de visibilidad.
  if (!Number.isFinite(to) || !Number.isFinite(from) || from === to || env.prefersReducedMotion()) { finish(); return { dispose }; }

  let started = false;
  const play = () => {
    if (started || disposed) return;
    started = true;
    if (unwatchVisibility) { unwatchVisibility(); unwatchVisibility = null; }
    let startedAt: number | null = null;
    emit(from, false);
    const tick = (now: number) => {
      frame = null;
      if (disposed) return;
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / duration);
      if (progress >= 1) { finish(); return; }
      emit(countValueAt(from, to, progress, kind), false);
      frame = env.requestFrame(tick);
    };
    frame = env.requestFrame(tick);
  };

  // El movimiento reducido que se activa a mitad de camino también deja el valor final.
  unwatchMotion = env.onReducedMotionChange(() => { if (env.prefersReducedMotion()) finish(); });

  if (!env.watchVisibility) { finish(); return { dispose }; }
  if (env.isVisibleNow()) { play(); return { dispose }; }
  unwatchVisibility = env.watchVisibility(visible => { if (visible) play(); });
  return { dispose };
}

/** Entorno real del navegador para un elemento concreto. Acepta una `window` alternativa (las pruebas pasan una simulada). */
export function createBrowserCountEnv(element: Element, win: Pick<Window, "matchMedia" | "requestAnimationFrame" | "cancelAnimationFrame" | "innerWidth" | "innerHeight"> & { IntersectionObserver?: typeof IntersectionObserver } = window): CountEnv {
  const motion = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const Observer = win.IntersectionObserver;
  return {
    prefersReducedMotion: () => Boolean(motion?.matches),
    onReducedMotionChange: listener => {
      if (!motion) return () => {};
      motion.addEventListener("change", listener);
      return () => motion.removeEventListener("change", listener);
    },
    isVisibleNow: () => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth;
    },
    watchVisibility: typeof Observer === "function"
      // Umbral 0 y sin margen: "visible" es que se vea un píxel, incluso pegado al borde inferior de la página.
      ? listener => {
        const observer = new Observer(entries => { if (entries.some(entry => entry.isIntersecting)) listener(true); }, { threshold: 0 });
        observer.observe(element);
        return () => observer.disconnect();
      }
      : null,
    requestFrame: callback => win.requestAnimationFrame(callback),
    cancelFrame: id => win.cancelAnimationFrame(id),
  };
}
