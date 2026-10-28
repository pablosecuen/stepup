// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDurationEdit.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  AppWeekday,
  CalendarLesson,
  PendingRecurrenceDraft,
  RecurrenceRule,
  RecurrenceWeek,
} from '../types/index.ts';
import { draftFromRule } from './calendarRecurrenceSplit.ts';
import { getDateKeyJsDay, getLocalDateKey, getLocalTimeKey } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';

/**
 * Corrección 2026-08-18 (a pedido de Joaquín — EDICIÓN DE DURACIÓN DE
 * CLASES Y SERIES): `CalendarLesson` no tiene un campo de duración propio
 * — la duración programada de una clase agendada SIEMPRE es derivada
 * (`end - start`, ver `getLessonDurationMinutes`). "Cambiar la duración"
 * es, en los datos reales, reescribir `end` conservando `start` — para una
 * clase suelta o una única ocurrencia — o reescribir
 * `RecurrenceSession.durationMinutes` en la plantilla de la serie — para
 * "esta clase y las siguientes". Este módulo es la mitad PURA (sin React
 * ni RN) de esa operación: nunca decide por sí solo si hay conflicto ni
 * cómo persistir — eso lo sigue haciendo el mismo motor real ya existente
 * (`calendarConflicts.ts`, `teacherAvailabilityEngine.ts`,
 * `calendarRecurrenceSplit.ts`, `calendarRecurrenceMutations.ts`).
 */

/** Único conjunto de duraciones ofrecidas — fuente única para el selector de UI y para validar. */
export const DURATION_OPTIONS_MINUTES = [30, 45, 60, 75, 90, 120] as const;
export type DurationOptionMinutes = (typeof DURATION_OPTIONS_MINUTES)[number];

export function isValidDurationOption(value: number): value is DurationOptionMinutes {
  return (DURATION_OPTIONS_MINUTES as readonly number[]).includes(value);
}

/** El único lugar que combina un inicio + una duración en minutos para obtener el fin real. */
export function computeEndFromDuration(startIso: string, durationMinutes: number): string {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new RangeError('La duración debe ser un número de minutos mayor a cero.');
  }
  const startTime = new Date(startIso).getTime();
  if (!Number.isFinite(startTime)) {
    throw new RangeError('El inicio de la clase no es una fecha válida.');
  }
  return new Date(startTime + durationMinutes * 60_000).toISOString();
}

/** Duración programada actual de una clase — siempre derivada de start/end, nunca un campo aparte. */
export function getLessonDurationMinutes(lesson: CalendarLesson): number {
  return Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000);
}

export interface RecurrenceSessionSlot {
  weekday: AppWeekday;
  hour: number;
  minute: number;
}

/**
 * A qué día/horario de la plantilla de la serie pertenece esta ocurrencia
 * puntual — se deriva de `lesson.start` en la zona horaria real de la
 * regla, nunca de un cálculo separado ni de una coordenada de dispositivo.
 */
export function resolveSessionSlotForLesson(lesson: CalendarLesson, timeZone: string): RecurrenceSessionSlot {
  const dateKey = getLocalDateKey(lesson.start, timeZone);
  const weekday = jsDayToAppWeekday(getDateKeyJsDay(dateKey));
  const [hourText, minuteText] = getLocalTimeKey(lesson.start, timeZone).split(':');
  return { weekday, hour: Number(hourText), minute: Number(minuteText) };
}

/**
 * Aplica la nueva duración ÚNICAMENTE a la sesión (día+hora) que coincide
 * con `slot` — cualquier otro día/horario que la misma regla contenga (una
 * serie con clases lunes Y miércoles, por ejemplo) queda intacto. Nunca
 * homogeneiza bloques que la profesora no tocó.
 */
export function applyDurationToWeeks(
  weeks: RecurrenceWeek[],
  slot: RecurrenceSessionSlot,
  newDurationMinutes: number
): RecurrenceWeek[] {
  return weeks.map((week) => ({
    ...week,
    sessions: week.sessions.map((session) =>
      session.weekday === slot.weekday && session.hour === slot.hour && session.minute === slot.minute
        ? { ...session, durationMinutes: newDurationMinutes }
        : session
    ),
  }));
}

/**
 * Construye el borrador (`PendingRecurrenceDraft`) que necesita
 * `splitRecurrenceFromDate` (el mecanismo real de "editar futuras", ya
 * existente) para "Esta clase y las siguientes": clona el patrón vigente
 * de la regla tal cual (mismos días, horarios, participantes,
 * modalidad — nada de eso vive en el draft, así que nada de eso se toca) y
 * cambia únicamente la duración de la sesión que corresponde a la
 * ocurrencia tocada.
 */
export function buildDurationOnlyDraft(
  rule: RecurrenceRule,
  lesson: CalendarLesson,
  newDurationMinutes: number
): PendingRecurrenceDraft {
  const slot = resolveSessionSlotForLesson(lesson, rule.timezone);
  const baseDraft = draftFromRule(rule);
  return {
    ...baseDraft,
    weeks: applyDurationToWeeks(baseDraft.weeks, slot, newDurationMinutes),
  };
}
