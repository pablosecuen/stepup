/**
 * Lógica pura de la respuesta inmediata al clic en un enlace del área privada (sin DOM: se prueba sin navegador).
 *
 *  - `resolveNavigationIntent`: ¿este clic inicia una navegación interna del mismo sitio? Respeta abrir en otra pestaña
 *    (Ctrl/Cmd/Shift/Alt + clic, botón central, `target`, `download`), un clic ya cancelado, enlaces externos, anclas, `mailto:`
 *    y el mismo destino en el que ya se está.
 *  - `decideClick`: con una navegación pendiente, un segundo clic sobre el MISMO destino se ignora (doble clic, Enter repetido);
 *    uno sobre otro destino reemplaza al pendiente (Next conserva la última).
 *  - `SLOW_AFTER_MS`/`GIVE_UP_AFTER_MS`: tiempos del indicador. Nunca esconde una demora real: pasados `SLOW_AFTER_MS` lo dice con texto y pasados
 *    `GIVE_UP_AFTER_MS` se apaga solo (la navegación fallida o colgada no deja la pantalla «ocupada» para siempre).
 */
export const SLOW_AFTER_MS = 6_000;
export const GIVE_UP_AFTER_MS = 20_000;

export interface ClickLike {
  /** `href` ya resuelto del enlace (propiedad `href` del `<a>`), o `null` si no tiene. */
  readonly href: string | null;
  readonly currentUrl: string;
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly defaultPrevented: boolean;
  readonly target: string | null;
  readonly download: boolean;
}

export type NavigationIntent = { readonly kind: "navigate"; readonly destination: string } | { readonly kind: "ignore"; readonly reason: string };

/** `ruta?consulta` del destino (sin `#`): es lo que identifica una navegación del router. */
function routeKey(url: URL): string {
  return `${url.pathname}${url.search}`;
}

export function resolveNavigationIntent(click: ClickLike): NavigationIntent {
  const ignore = (reason: string): NavigationIntent => ({ kind: "ignore", reason });
  if (click.defaultPrevented) return ignore("default_prevented");
  if (click.button !== 0) return ignore("not_primary_button");
  if (click.ctrlKey || click.metaKey || click.shiftKey || click.altKey) return ignore("modifier");
  if (click.download) return ignore("download");
  if (click.target && click.target !== "" && click.target !== "_self") return ignore("target");
  if (!click.href) return ignore("no_href");
  let destination: URL;
  let current: URL;
  try {
    destination = new URL(click.href);
    current = new URL(click.currentUrl);
  } catch {
    return ignore("invalid_url");
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") return ignore("protocol");
  if (destination.origin !== current.origin) return ignore("external");
  if (routeKey(destination) === routeKey(current)) return ignore("same_destination"); // ancla o el mismo lugar: el router no navega
  return { kind: "navigate", destination: routeKey(destination) };
}

export type ClickDecision = "start" | "block_repeat" | "replace";

export function decideClick(pendingDestination: string | null, destination: string): ClickDecision {
  if (pendingDestination === null) return "start";
  return pendingDestination === destination ? "block_repeat" : "replace";
}

export type PendingPhase = "idle" | "pending" | "slow";

/** Fase del indicador según cuánto lleva pendiente (el reloj lo pone quien llama). */
export function pendingPhase(pendingSinceMs: number | null, nowMs: number): PendingPhase {
  if (pendingSinceMs === null) return "idle";
  const elapsed = nowMs - pendingSinceMs;
  if (elapsed >= GIVE_UP_AFTER_MS) return "idle";
  return elapsed >= SLOW_AFTER_MS ? "slow" : "pending";
}
