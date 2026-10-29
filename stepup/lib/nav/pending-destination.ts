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
  readonly fromPath: string;
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

/** La navegación pendiente SÓLO aplica mientras la ruta siga siendo aquella desde la que se hizo clic. */
export function activePendingNavigation(pending: PendingNavigation | null, pathname: string): PendingNavigation | null {
  return pending && pending.fromPath === pathname ? pending : null;
}
