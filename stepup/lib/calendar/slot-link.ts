import { safeCalendarReturn } from "../registro/return-path.ts";

/**
 * Tocar un espacio libre del Calendario abre «Nueva clase» en ESE día y a ESA hora, como la app original (cada hora de la grilla es un espacio: la clase empieza en punto, `minute=0`).
 * El día es la fecha civil de la columna y la hora la de la grilla (zona horaria de la cuenta), así que no depende del scroll, la densidad ni los encabezados fijos. `volver` es la
 * semana o el día de origen (sólo rutas internas del Calendario). No crea nada: sólo abre el formulario. PURO.
 */
export function newLessonSlotHref(input: { dayKey: string; hour: number; returnPath?: string | null }): string {
  const params = new URLSearchParams({ date: input.dayKey, hour: String(input.hour), minute: "0" });
  const back = safeCalendarReturn(input.returnPath ?? null);
  if (back) params.set("volver", back);
  return `/calendario/nueva?${params.toString()}`;
}

/** Texto accesible del espacio: «Agregar clase el 2026-10-19 a las 14:00». */
export function slotAriaLabel(dayLabel: string, hour: number): string {
  return `Agregar clase el ${dayLabel} a las ${String(hour).padStart(2, "0")}:00`;
}
