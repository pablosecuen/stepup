/**
 * Posición de desplazamiento de la grilla del Calendario al salir hacia «Nueva clase» desde un espacio libre: se guarda con la ruta de origen y se restituye UNA vez al volver (Cancelar o guardar) a esa misma
 * vista, para que la grilla quede donde estaba. Vive en `sessionStorage` (sólo de esta pestaña; si no está disponible, la grilla simplemente se abre arriba como siempre) y caduca a los 30 minutos.
 */
const KEY = "teacherflow:calendario:desplazamiento-origen";
const MAX_AGE_MS = 30 * 60 * 1000;

export function saveGridScroll(returnPath: string, scroller: { scrollTop: number } | null): void {
  if (!scroller) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: returnPath, top: Math.max(0, Math.round(scroller.scrollTop)), at: Date.now() }));
  } catch {
    // Sin almacenamiento: no se restituye la posición, nada más.
  }
}

/** Restituye la posición guardada si corresponde a ESTA vista y todavía es reciente; siempre consume el dato. */
export function restoreGridScroll(currentPath: string, scroller: { scrollTop: number } | null): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    sessionStorage.removeItem(KEY);
    const saved = JSON.parse(raw) as { path?: unknown; top?: unknown; at?: unknown };
    if (!scroller || saved.path !== currentPath || typeof saved.top !== "number" || typeof saved.at !== "number" || Date.now() - saved.at > MAX_AGE_MS) return false;
    scroller.scrollTop = saved.top;
    return true;
  } catch {
    return false;
  }
}
