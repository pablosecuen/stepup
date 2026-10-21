import { instantDateKey, instantMinutesOfDay, weekdayIndexMondayFirst } from "../calendar/civil-calendar.ts";
import { addDaysToDateKey } from "../payments/dates.ts";

/**
 * Puerto exacto de `buildCalendarDemandSummary` (móvil, `calendarDemandSummary.ts`): demanda semanal y horaria de los ÚLTIMOS 90 DÍAS (hoy incluido, por fecha civil de Argentina), no configurable.
 *
 * - Cuenta clases dictadas (`completed`) y confirmadas a futuro (`scheduled`): excluye canceladas, reprogramadas y cualquier otro estado, y las clases «sin alumnos» que ya pasaron.
 * - Mide HORAS OCUPADAS, no sólo cantidad: cada clase reparte su duración entre los intervalos de 30 minutos que toca.
 * - Una clase compartida ocupa la agenda UNA sola vez (el insumo ya es «una ocurrencia», nunca una por alumno).
 * - Día de la semana con lunes = 0 … domingo = 6 (como la app).
 */
export const DEMAND_LOOKBACK_DAYS = 90;
const SLOT_MINUTES = 30;
const SLOT_COUNT_PER_DAY = (24 * 60) / SLOT_MINUTES;

export interface OccurrenceForDemand {
  start: string;
  end: string;
  status: string;
  participantCount: number;
}

export interface DemandByWeekday {
  /** 0 = lunes … 6 = domingo. */
  weekday: number;
  occupiedHours: number;
  lessonCount: number;
  percentOfWeeklyDemand: number;
}

export interface DemandSlot {
  hour: number;
  minute: number;
  occupiedHours: number;
  lessonCount: number;
}

export interface CalendarDemandSummary {
  rangeStart: string;
  rangeEnd: string;
  byWeekday: DemandByWeekday[];
  /** Día(s) más demandados — más de uno en caso de empate. */
  topWeekdays: DemandByWeekday[];
  bySlot: DemandSlot[];
  /** Horario(s) más demandados — más de tres en caso de empate en el tercer lugar. */
  topSlots: DemandSlot[];
}

/** Rango de la demanda: los últimos `DEMAND_LOOKBACK_DAYS` días terminando en `evaluationDate`, ambos incluidos. */
export function demandRangeFor(evaluationDate: string): { rangeStart: string; rangeEnd: string } {
  return { rangeStart: addDaysToDateKey(evaluationDate, -(DEMAND_LOOKBACK_DAYS - 1)), rangeEnd: evaluationDate };
}

function isRelevantOccurrence(occurrence: OccurrenceForDemand, rangeStart: string, rangeEnd: string, evaluationInstant: string): boolean {
  if (occurrence.status !== "scheduled" && occurrence.status !== "completed") return false;
  const startDateKey = instantDateKey(occurrence.start);
  if (startDateKey < rangeStart || startDateKey > rangeEnd) return false;
  const isEmpty = occurrence.participantCount === 0;
  const isPast = new Date(occurrence.end).getTime() < new Date(evaluationInstant).getTime();
  if (isEmpty && isPast) return false;
  return true;
}

export function buildCalendarDemandSummary(input: { occurrences: readonly OccurrenceForDemand[]; rangeStart: string; rangeEnd: string; evaluationInstant: string }): CalendarDemandSummary {
  const { occurrences, rangeStart, rangeEnd, evaluationInstant } = input;
  const relevant = occurrences.filter((occurrence) => isRelevantOccurrence(occurrence, rangeStart, rangeEnd, evaluationInstant));

  const weekdayMinutes = new Map<number, number>();
  const weekdayLessonCount = new Map<number, number>();
  const slotMinutes = new Map<number, number>();
  const slotLessonCount = new Map<number, number>();

  relevant.forEach((occurrence) => {
    const durationMinutes = Math.max(0, Math.round((new Date(occurrence.end).getTime() - new Date(occurrence.start).getTime()) / 60_000));
    if (durationMinutes === 0) return;

    const weekday = weekdayIndexMondayFirst(instantDateKey(occurrence.start));
    weekdayMinutes.set(weekday, (weekdayMinutes.get(weekday) ?? 0) + durationMinutes);
    weekdayLessonCount.set(weekday, (weekdayLessonCount.get(weekday) ?? 0) + 1);

    // Reparte la duración de la clase entre los intervalos de 30 min que toca.
    const startMinuteOfDay = instantMinutesOfDay(occurrence.start);
    let currentSlot = Math.floor(startMinuteOfDay / SLOT_MINUTES);
    let minutesRemaining = durationMinutes;
    let minutesIntoCurrentSlot = startMinuteOfDay - currentSlot * SLOT_MINUTES;
    const touchedSlots = new Set<number>();
    while (minutesRemaining > 0 && currentSlot < SLOT_COUNT_PER_DAY) {
      const minutesInThisSlot = Math.min(SLOT_MINUTES - minutesIntoCurrentSlot, minutesRemaining);
      slotMinutes.set(currentSlot, (slotMinutes.get(currentSlot) ?? 0) + minutesInThisSlot);
      touchedSlots.add(currentSlot);
      minutesRemaining -= minutesInThisSlot;
      minutesIntoCurrentSlot = 0;
      currentSlot += 1;
    }
    touchedSlots.forEach((slot) => slotLessonCount.set(slot, (slotLessonCount.get(slot) ?? 0) + 1));
  });

  const totalWeeklyMinutes = Array.from(weekdayMinutes.values()).reduce((sum, minutes) => sum + minutes, 0);
  const byWeekday: DemandByWeekday[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const minutes = weekdayMinutes.get(weekday) ?? 0;
    return {
      weekday,
      occupiedHours: minutes / 60,
      lessonCount: weekdayLessonCount.get(weekday) ?? 0,
      percentOfWeeklyDemand: totalWeeklyMinutes > 0 ? (minutes / totalWeeklyMinutes) * 100 : 0,
    };
  });

  const maxWeekdayMinutes = Math.max(0, ...byWeekday.map((entry) => entry.occupiedHours * 60));
  const topWeekdays = maxWeekdayMinutes > 0 ? byWeekday.filter((entry) => entry.occupiedHours * 60 === maxWeekdayMinutes) : [];

  const bySlot: DemandSlot[] = Array.from(slotMinutes.entries())
    .map(([slotIndex, minutes]) => ({
      hour: Math.floor((slotIndex * SLOT_MINUTES) / 60),
      minute: (slotIndex * SLOT_MINUTES) % 60,
      occupiedHours: minutes / 60,
      lessonCount: slotLessonCount.get(slotIndex) ?? 0,
    }))
    .sort((a, b) => (a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));

  const sortedByDemand = [...bySlot].sort((a, b) => b.occupiedHours - a.occupiedHours);
  const thirdPlaceHours = sortedByDemand[2]?.occupiedHours ?? -1;
  const topSlots = sortedByDemand.filter((slot) => slot.occupiedHours >= thirdPlaceHours && slot.occupiedHours > 0);

  return { rangeStart, rangeEnd, byWeekday, topWeekdays, bySlot, topSlots };
}
