/**
 * «Editar registro» desde el Calendario: la pantalla del registro recibe a dónde volver (`volver`) para regresar a la MISMA semana o día desde la que se abrió. Sólo se acepta una ruta interna del
 * Calendario (`/calendario…`): nunca una dirección externa, de otra sección ni con `//`, que serviría para redirigir a otro sitio. PURO.
 */
const SAFE_CALENDAR_PATH = /^\/calendario(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&%.:,+-]*)?$/;

export function safeCalendarReturn(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return null;
  return SAFE_CALENDAR_PATH.test(raw) ? raw : null;
}

/** Enlace a la pantalla de edición del registro de una clase ya registrada; `returnPath` (la URL actual del Calendario) es opcional. */
export function editRegistrationHref(calendarLessonId: string, returnPath: string | null): string {
  const base = `/registro/${encodeURIComponent(calendarLessonId)}`;
  const safe = safeCalendarReturn(returnPath);
  return safe ? `${base}?volver=${encodeURIComponent(safe)}` : base;
}
