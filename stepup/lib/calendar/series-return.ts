import { safeCalendarReturn } from "../registro/return-path.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Enlace a la administración de UNA serie, por su id real (nunca por nombre). `returnPath` es la semana o el día del Calendario desde el que se abrió. */
export function seriesDetailHref(recurrenceId: string, returnPath: string | null): string {
  const base = `/calendario/series/${encodeURIComponent(recurrenceId)}`;
  const safe = safeCalendarReturn(returnPath);
  return safe ? `${base}?volver=${encodeURIComponent(safe)}` : base;
}

/** Valor de `?editar=` que abre «Editar futuras» al entrar a la serie (el recorrido directo de «Administrar serie»). */
export const SERIES_EDIT_FUTURE = "futuras";

/**
 * «Administrar serie» desde el detalle de una clase: abre DIRECTAMENTE «Editar futuras» de ESA serie (por su id real). Es la misma pantalla de la serie con el mismo editor; sólo cambia que
 * llega abierto. Abrirlo no guarda nada. «Cancelar» o guardar vuelven al Calendario de origen (`volver`).
 */
export function seriesEditHref(recurrenceId: string, returnPath: string | null): string {
  const detail = seriesDetailHref(recurrenceId, returnPath);
  return `${detail}${detail.includes("?") ? "&" : "?"}editar=${SERIES_EDIT_FUTURE}`;
}

/** ¿La entrada pide abrir «Editar futuras»? Sólo el valor exacto; cualquier otro se ignora. */
export function wantsDirectFutureEdit(raw: unknown): boolean {
  return raw === SERIES_EDIT_FUTURE;
}

/** El id de la ruta sólo se acepta si tiene forma de uuid: cualquier otra cosa no consulta la base. */
export function parseSeriesId(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** A dónde vuelve «Volver»: la ruta interna del Calendario recibida o, sin ella, el Calendario. */
export function seriesBackTarget(raw: unknown): string {
  return safeCalendarReturn(raw) ?? "/calendario";
}
