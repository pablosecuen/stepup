import { safeCalendarReturn } from "../registro/return-path.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enlace a la administración de UNA serie, por su id real (nunca por nombre). `returnPath` es la semana o el día del Calendario desde el que se abrió. */
export function seriesDetailHref(recurrenceId: string, returnPath: string | null): string {
  const base = `/calendario/series/${encodeURIComponent(recurrenceId)}`;
  const safe = safeCalendarReturn(returnPath);
  return safe ? `${base}?volver=${encodeURIComponent(safe)}` : base;
}

/** El id de la ruta sólo se acepta si tiene forma de uuid: cualquier otra cosa no consulta la base. */
export function parseSeriesId(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** A dónde vuelve «Volver»: la ruta interna del Calendario recibida o, sin ella, el Calendario. */
export function seriesBackTarget(raw: unknown): string {
  return safeCalendarReturn(raw) ?? "/calendario";
}
