// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDailyDemand.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarDay } from '../types/index.ts';
import type { TeacherAvailability } from '../types/teacherAvailability.ts';
import { getDateKeyJsDay, getLocalDateKey } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';

/**
 * Corrección 2026-07-16 (a pedido de Joaquín): color de demanda por día en
 * el Calendario, según cuántas horas quedan libres ese día dentro de la
 * ventana de trabajo (8:00-22:00, misma ventana que ya usan
 * `WeekTimeGrid.tsx`/`RescheduleTimeSlotGrid.tsx`). Rangos definidos con
 * los ejemplos reales que dio Joaquín: un día de trabajo/estudio de 12 a
 * 18hs (libre 9-11 y 19-22, 5 horas libres) da "ocupado" (naranja); un día
 * libre de 9 a 21/22hs (12-13 horas libres) da "libre" (verde).
 *
 * Nunca reimplementa el motor de disponibilidad: usa exactamente los
 * mismos datos (`TeacherAvailability.weeklyBlocks`/`exceptions`) y el
 * mismo criterio de solapamiento que `availabilityOverlaysForDay` en
 * `WeekTimeGrid.tsx` — sólo cambia qué se hace con esos intervalos (acá se
 * suman para saber cuánto queda libre, allá se dibujan como overlay).
 */
export const DEMAND_WINDOW_START_HOUR = 8;
export const DEMAND_WINDOW_END_HOUR = 22;

export type DailyDemandLevel = 'vacaciones' | 'completo' | 'saturado' | 'ocupado' | 'media' | 'libre';

export interface DailyDemandResult {
  level: DailyDemandLevel;
  freeMinutes: number;
  /** Texto siempre presente: el nivel nunca debe comunicarse sólo por color. */
  label: string;
}

interface MinuteInterval {
  startMinute: number;
  endMinute: number;
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function clipToWindow(startMinute: number, endMinute: number): MinuteInterval | null {
  const windowStart = DEMAND_WINDOW_START_HOUR * 60;
  const windowEnd = DEMAND_WINDOW_END_HOUR * 60;
  const clippedStart = Math.max(startMinute, windowStart);
  const clippedEnd = Math.min(endMinute, windowEnd);
  if (clippedEnd <= clippedStart) return null;
  return { startMinute: clippedStart, endMinute: clippedEnd };
}

function mergeIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((first, second) => first.startMinute - second.startMinute);
  const merged: MinuteInterval[] = [{ ...sorted[0] }];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (interval.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, interval.endMinute);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function isFullDayVacation(dateKey: string, availability: TeacherAvailability): boolean {
  return availability.exceptions.some(
    (exception) =>
      exception.type === 'unavailable_full_day' &&
      exception.reason === 'vacation' &&
      dateKey >= exception.date &&
      dateKey <= (exception.endDate ?? exception.date)
  );
}

/**
 * Minutos libres dentro de la ventana de trabajo — nunca negativos.
 * "Libre" significa: sin una clase real (no cancelada) y sin un bloqueo de
 * disponibilidad (bloque semanal o excepción) superpuesto.
 */
export function computeDailyFreeMinutes(day: CalendarDay, availability?: TeacherAvailability): number {
  const windowStart = DEMAND_WINDOW_START_HOUR * 60;
  const windowEnd = DEMAND_WINDOW_END_HOUR * 60;
  const totalWindowMinutes = windowEnd - windowStart;

  const busyIntervals: MinuteInterval[] = [];

  for (const lesson of day.lessons) {
    if (lesson.status === 'cancelled') continue;
    const start = new Date(lesson.start);
    const end = new Date(lesson.end);
    const clipped = clipToWindow(start.getHours() * 60 + start.getMinutes(), end.getHours() * 60 + end.getMinutes());
    if (clipped) busyIntervals.push(clipped);
  }

  if (availability) {
    const dateKey = getLocalDateKey(day.date, availability.timezone);
    const weekday = jsDayToAppWeekday(getDateKeyJsDay(dateKey));

    for (const block of availability.weeklyBlocks) {
      if (block.weekday !== weekday) continue;
      const clipped = clipToWindow(timeToMinute(block.startTime), timeToMinute(block.endTime));
      if (clipped) busyIntervals.push(clipped);
    }

    for (const exception of availability.exceptions) {
      if (exception.type === 'available_extra') continue;
      if (!(dateKey >= exception.date && dateKey <= (exception.endDate ?? exception.date))) continue;
      const startMinute = exception.type === 'unavailable_full_day' ? windowStart : timeToMinute(exception.startTime ?? '00:00');
      const endMinute = exception.type === 'unavailable_full_day' ? windowEnd : timeToMinute(exception.endTime ?? '23:59');
      const clipped = clipToWindow(startMinute, endMinute);
      if (clipped) busyIntervals.push(clipped);
    }
  }

  const busyMinutes = mergeIntervals(busyIntervals).reduce(
    (total, interval) => total + (interval.endMinute - interval.startMinute),
    0
  );
  return Math.max(0, totalWindowMinutes - busyMinutes);
}

/**
 * Rangos (en horas libres, sobre una ventana total de 14hs):
 *   vacaciones → día completo marcado como vacaciones (pisa a todo lo demás)
 *   completo   → 0 horas libres (agenda llena de clases reales)
 *   saturado   → hasta 3 horas libres
 *   ocupado    → hasta 6 horas libres
 *   media      → hasta 9 horas libres
 *   libre      → más de 9 horas libres
 */
export function classifyDailyDemand(day: CalendarDay, availability?: TeacherAvailability): DailyDemandResult {
  if (availability) {
    const dateKey = getLocalDateKey(day.date, availability.timezone);
    if (isFullDayVacation(dateKey, availability)) {
      return { level: 'vacaciones', freeMinutes: 0, label: 'Vacaciones' };
    }
  }

  const freeMinutes = computeDailyFreeMinutes(day, availability);
  const freeHours = freeMinutes / 60;

  if (freeMinutes === 0) return { level: 'completo', freeMinutes, label: 'Día completo' };
  if (freeHours <= 3) return { level: 'saturado', freeMinutes, label: 'Muy poca disponibilidad' };
  if (freeHours <= 6) return { level: 'ocupado', freeMinutes, label: 'Poca disponibilidad' };
  if (freeHours <= 9) return { level: 'media', freeMinutes, label: 'Disponibilidad media' };
  return { level: 'libre', freeMinutes, label: 'Bastante disponibilidad' };
}
