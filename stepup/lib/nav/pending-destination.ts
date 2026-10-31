import { pathnameOf } from "./screens.ts";

/**
 * Destino pendiente de la navegación en curso (29/10/2026): UN valor compartido entre quien detecta el clic (`NavigationProgress`) y quienes
 * lo muestran (el esqueleto optimista de `ScreenSlot` y la pestaña activa de la navegación). Guarda además la ruta DESDE la que se salió:
 * cuando la ruta cambia, la navegación completó y el valor deja de aplicar al instante, durante el mismo render que muestra la pantalla
 * nueva (sin esperar a un efecto), así el esqueleto y la pantalla real nunca se ven a la vez ni queda un fotograma vacío entre ambos.
 * Sin React ni DOM: es un almacén externo para `useSyncExternalStore`.
 */
export interface PendingNavigation {
  /** «/ruta?x=y» del destino. */
  readonly destination: string;
  /** Ruta («/ruta», sin parámetros) desde donde se hizo clic. */
  readonly fromPath: string;}

/**
 * El nombre compartido del elemento pulsado (p. ej. el alumno de una fila). El esqueleto del destino lo dibuja IGUAL, con el mismo nombre de transición, para que la transición
 * del nombre aterrice en su encabezado aunque los datos tarden y el contenido real lo reemplace sin saltos. Se guarda de forma SÍNCRONA en el clic (el esqueleto de `loading.tsx`
 * se dibuja en la transición de la propia navegación, antes de que el destino pendiente se publique) y sin avisar a nadie: sólo se LEE al dibujar. Vale para su destino y unos segundos.
 */
export interface SharedNameHint {
  readonly id: string;
  readonly text: string;
}
const SHARED_NAME_HINT_MAX_AGE_MS = 10_000;
let sharedNameHint: { pathname: string; hint: SharedNameHint; at: number } | null = null;

export function rememberSharedName(pathname: string, hint: SharedNameHint | null, now: number = Date.now()): void {
  sharedNameHint = hint ? { pathname, hint, at: now } : null;
}

/** El nombre del último clic cuyo destino es una ruta como `pattern` (el esqueleto de una ficha no conoce su ruta exacta: `loading.tsx` se dibuja en la propia transición). */
export function readSharedNameMatching(pattern: RegExp, now: number = Date.now()): SharedNameHint | null {
  return sharedNameHint && pattern.test(sharedNameHint.pathname) && now - sharedNameHint.at <= SHARED_NAME_HINT_MAX_AGE_MS ? sharedNameHint.hint : null;
}

export function readSharedName(pathname: string, now: number = Date.now()): SharedNameHint | null {
  return sharedNameHint && sharedNameHint.pathname === pathname && now - sharedNameHint.at <= SHARED_NAME_HINT_MAX_AGE_MS ? sharedNameHint.hint : null;
}

type Listener = () => void;

let current: PendingNavigation | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getPendingNavigation(): PendingNavigation | null {
  return current;
}

export function subscribePendingNavigation(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPendingNavigation(next: PendingNavigation): void {
  if (current && current.destination === next.destination && current.fromPath === next.fromPath) return;
  current = next;
  emit();
}

export function clearPendingNavigation(): void {
  if (current === null) return;
  current = null;
  emit();
}

/**
 * La navegación pendiente aplica mientras la ruta actual NO sea todavía la del destino: así, en una ráfaga de clics, las pantallas intermedias que lleguen
 * antes (sin ser el último destino) no reemplazan al esqueleto del último destino; y al llegar al destino deja de aplicar en ese mismo render. Quien la
 * retira del almacén (`NavigationProgress`) lo hace al llegar al destino o al ir a una ruta ajena a la ráfaga (una redirección).
 */
export function activePendingNavigation(pending: PendingNavigation | null, pathname: string): PendingNavigation | null {
  return pending && pathnameOf(pending.destination) !== pathname ? pending : null;
}
