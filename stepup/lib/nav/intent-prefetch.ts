/**
 * Precarga POR INTENCIÓN del área privada. La precarga automática de Next (todo enlace que entra al viewport) sigue apagada: dispara
 * ráfagas de verificaciones de sesión (B0, «JWT issued at future»). Lo que sí se permite es precargar UNA ruta frecuente cuando la persona
 * muestra intención real (el puntero se posa sobre el enlace o el teclado lo enfoca): descarga sólo el esqueleto de la pantalla
 * (`loading.tsx`), así el clic muestra la estructura al instante en vez de esperar al servidor. Reglas, todas puras y probadas:
 *  - sólo secciones con `loading.tsx` y la ficha UUID concreta señalada por la persona; nunca Inicio ni formularios de edición;
 *  - nunca en los primeros 3 s de la página (después de iniciar sesión no hay ráfaga);
 *  - una vez por destino cada 60 s;
 *  - no con «ahorro de datos» activado.
 */
export const INTENT_PREFETCH_ROUTES: ReadonlySet<string> = new Set([
  "/alumnos",
  "/calendario",
  "/cobros",
  "/registro",
  "/recordatorios",
  "/resumen-financiero",
  "/configuracion",
  "/calendario/series",
  "/calendario/disponibilidad",
  "/calendario/nueva",
  "/alumnos/nuevo",
]);

export const INTENT_MIN_PAGE_AGE_MS = 3000;
export const INTENT_REPEAT_AFTER_MS = 60_000;

/** Only the profile actually hovered/focused/touched; never edits, registration actions or all rows on screen. */
export function isStudentProfilePathname(pathname: string): boolean {
  return /^\/(?:alumnos|cobros\/alumnos)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);
}

/** Ruta sin consulta ni ancla, o `null` si el destino no es una ruta interna simple. */
export function intentPathname(href: unknown): string | null {
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return null;
  const end = href.search(/[?#]/);
  const pathname = end === -1 ? href : href.slice(0, end);
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function shouldPrefetchOnIntent(input: { href: unknown; pageAgeMs: number; nowMs: number; lastPrefetchAtMs: number | null; saveData?: boolean }): boolean {
  const pathname = intentPathname(input.href);
  if (!pathname || (!INTENT_PREFETCH_ROUTES.has(pathname) && !isStudentProfilePathname(pathname))) return false;
  if (input.saveData) return false;
  if (input.pageAgeMs < INTENT_MIN_PAGE_AGE_MS) return false;
  if (input.lastPrefetchAtMs !== null && input.nowMs - input.lastPrefetchAtMs < INTENT_REPEAT_AFTER_MS) return false;
  return true;
}
