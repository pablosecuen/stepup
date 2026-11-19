import { END_HOUR } from "./layout.ts";
import { DURATION_OPTIONS_MINUTES, lessonDurationMinutes } from "./lesson-edit.ts";
import { instantDateKey, instantMinutesOfDay, instantTimeLabel } from "./civil-calendar.ts";
import { formatMinutes } from "../format/number-format.ts";

/**
 * «Extender duración»: acción rápida sobre UNA clase (+15, +30 o +60 minutos). Reglas puras compartidas por la pantalla, la Server Action y las pruebas.
 *
 * Los límites son los que ya existen, nunca se amplían en silencio: la duración máxima de la lista de duraciones de la clase (`DURATION_OPTIONS_MINUTES`, hoy 2 h) y la jornada del calendario
 * (`END_HOUR`, hoy 22:00, en la zona horaria de la cuenta). Una opción que los supera se deshabilita con un motivo breve.
 */
export const EXTEND_INCREMENTS_MINUTES = [15, 30, 60] as const;
export type ExtendIncrement = (typeof EXTEND_INCREMENTS_MINUTES)[number];

export const MAX_LESSON_DURATION_MINUTES: number = Math.max(...DURATION_OPTIONS_MINUTES);
export const WORKDAY_END_MINUTES = END_HOUR * 60;

export interface ExtendableItem {
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  occupiesSlot?: boolean;
  hiddenByReplacement?: boolean;
}

/**
 * ¿Se ofrece «Extender duración»? No para una clase cancelada, reemplazada, el origen liberado de una reprogramación ni una ya registrada/dictada: su duración histórica requiere otro circuito.
 * (El registro finalizado deja la clase en `completed`; el servidor lo vuelve a comprobar dentro de la transacción.)
 */
export function canExtendLesson(item: ExtendableItem): boolean {
  if (item.status === "cancelled" || item.status === "completed") return false;
  if (item.occupiesSlot === false || item.hiddenByReplacement) return false;
  return true;
}

export interface ExtendOption {
  minutes: ExtendIncrement;
  /** Fin nuevo (instante ISO) y duración total resultante. */
  newEnd: string;
  newDuration: number;
  /** Motivo breve por el que la opción no se puede elegir; `null` si está disponible. */
  disabledReason: string | null;
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Motivo por el que la clase NO puede terminar en `newEnd`, o `null` si respeta los límites. Se comprueba en la zona horaria de la cuenta. */
export function extensionLimitReason(startIso: string, newEndIso: string): string | null {
  const newDuration = lessonDurationMinutes(startIso, newEndIso);
  if (newDuration > MAX_LESSON_DURATION_MINUTES) return `Máximo ${formatMinutes(MAX_LESSON_DURATION_MINUTES)} por clase.`;
  const sameDay = instantDateKey(newEndIso) === instantDateKey(startIso);
  const endMinutes = instantMinutesOfDay(newEndIso);
  if (!sameDay || endMinutes > WORKDAY_END_MINUTES || (endMinutes === 0 && !sameDay)) return `Terminaría después de las ${String(END_HOUR).padStart(2, "0")}:00.`;
  return null;
}

/** Las tres opciones rápidas para una clase, ninguna seleccionada de antemano. */
export function extendOptions(startIso: string, endIso: string): ExtendOption[] {
  return EXTEND_INCREMENTS_MINUTES.map((minutes) => {
    const newEnd = addMinutes(endIso, minutes);
    return { minutes, newEnd, newDuration: lessonDurationMinutes(startIso, newEnd), disabledReason: extensionLimitReason(startIso, newEnd) };
  });
}

/** Resultado de aplicar `minutes` a una clase: el fin nuevo o el motivo por el que no se puede (para el servidor y la pantalla). */
export function evaluateExtension(startIso: string, endIso: string, minutes: number): { ok: true; newEnd: string; newDuration: number } | { ok: false; error: string } {
  if (!(EXTEND_INCREMENTS_MINUTES as readonly number[]).includes(minutes)) return { ok: false, error: "Elegí +15, +30 o +60 minutos." };
  const newEnd = addMinutes(endIso, minutes);
  const reason = extensionLimitReason(startIso, newEnd);
  if (reason) return { ok: false, error: reason };
  return { ok: true, newEnd, newDuration: lessonDurationMinutes(startIso, newEnd) };
}

/** «13:00–14:15 · 75 min»: el resumen del resultado (se muestra apenas se elige una opción). */
export function describeExtension(startIso: string, newEndIso: string): { range: string; duration: string } {
  return { range: `${instantTimeLabel(startIso)}–${instantTimeLabel(newEndIso)}`, duration: formatMinutes(lessonDurationMinutes(startIso, newEndIso)) };
}
