import { sessionSlotForInstant } from "./lesson-edit.ts";
import type { SlotIgnore, SlotItem } from "./parity.ts";
import { buildTimeSlots } from "../original-core/features/calendar/utils/calendarTimeSlots.ts";
import { buildQuickPickOptions, formatTimeSlotLabel, TIME_SLOT_QUICK_PICK_STEP_MINUTES } from "../original-core/features/calendar/utils/timeSlotQuickPick.ts";

/**
 * Selector de horario del Calendario web — misma regla que la app original (`RescheduleTimeSlotGrid` + `useTimeSlotQuickPick`): la grilla principal va en pasos de 30 minutos
 * (08:00–21:30); mantener presionado o tocar dos veces un horario ofrece ESE inicio y el inicio + 15 minutos. Elegir un inicio nunca cambia la duración de la clase. Como
 * mantener presionado no existe con teclado, la web suma una alternativa visible: «Mostrar :15 y :45» muestra todos los cuartos de hora. PURO.
 */
export const PRIMARY_SLOT_TIMES: readonly string[] = buildTimeSlots().map((slot) => formatTimeSlotLabel(slot.hour, slot.minute));

/** Todos los cuartos de hora alcanzables: los de la grilla principal más su +15 minutos. */
export const ALL_QUARTER_TIMES: readonly string[] = PRIMARY_SLOT_TIMES.flatMap((time) => {
  const [hour, minute] = time.split(":").map(Number);
  const [first, second] = buildQuickPickOptions(hour, minute);
  return [formatTimeSlotLabel(first.hour, first.minute), formatTimeSlotLabel(second.hour, second.minute)];
});

export const isPrimarySlotTime = (time: string) => PRIMARY_SLOT_TIMES.includes(time);

/** «18:00» → [«18:00», «18:15»] (las dos opciones del selector rápido). */
export function quickPickTimes(time: string): [string, string] {
  const [hour, minute] = time.split(":").map(Number);
  const [first, second] = buildQuickPickOptions(hour, minute);
  return [formatTimeSlotLabel(first.hour, first.minute), formatTimeSlotLabel(second.hour, second.minute)];
}

/** El horario principal al que pertenece un inicio (para abrir el selector rápido desde un :15 o :45 ya elegido). */
export function primaryTimeFor(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute;
  const base = total - (total % 30 === 0 ? 0 : TIME_SLOT_QUICK_PICK_STEP_MINUTES);
  return formatTimeSlotLabel(Math.floor(base / 60), base % 60);
}

export type DayLoad = "wide" | "limited" | "none" | "past";

/** Cómo se ve un día al elegir fecha: «amplio» (más de 20 horarios libres), «limitado» (algunos) o «sin horarios libres». Un día pasado no se ofrece. */
export function classifyDay(freeSlots: number, isPast: boolean): DayLoad {
  if (isPast) return "past";
  if (freeSlots > 20) return "wide";
  return freeSlots > 0 ? "limited" : "none";
}

export const DAY_LOAD_TEXT: Record<DayLoad, string> = {
  wide: "amplia disponibilidad",
  limited: "disponibilidad limitada",
  none: "sin horarios libres",
  past: "fecha pasada",
};

/**
 * Qué clases NO ocupan lugar al buscar horario para mover una clase: la propia clase y, si el cambio es «esta y las siguientes», las clases de ESA misma sesión de la serie (mismo día
 * de la semana y hora) desde la fecha efectiva, porque la operación las reemplaza. Las demás sesiones de la serie y cualquier otra clase siguen ocupando. El servidor vuelve a validar.
 */
export function buildSlotIgnore(options: { ignoreId?: string; series?: { lineage: readonly string[]; fromInstant: string; originalStartIso: string; timeZone: string } }): SlotIgnore {
  const { ignoreId, series } = options;
  const originalSlot = series ? sessionSlotForInstant(series.originalStartIso, series.timeZone) : null;
  return (item: SlotItem) => {
    if (ignoreId && item.id === ignoreId) return true;
    if (!series || !originalSlot || !item.recurrenceId || !series.lineage.includes(item.recurrenceId) || item.start < series.fromInstant) return false;
    const slot = sessionSlotForInstant(item.start, series.timeZone);
    return slot.weekday === originalSlot.weekday && slot.hour === originalSlot.hour && slot.minute === originalSlot.minute;
  };
}
