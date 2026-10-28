import type { RecurrenceWeek } from "./types.ts";
import { getDateKeyJsDay, getLocalDateKey, getLocalTimeKey } from "./timezone.ts";

/**
 * Reglas puras de las acciones de clase del Calendario (nombre y duración), puerto de `calendarClassTitle.ts` y `calendarDurationEdit.ts` de la app original.
 * Sin Supabase ni React: las usan las Server Actions, la pantalla y las pruebas.
 */

/** Alcance de un cambio sobre una clase que pertenece a una serie. «series» sólo existe para el nombre (toda la serie); la duración sólo admite «occurrence» y «thisAndFuture». */
export type LessonEditScope = "occurrence" | "series" | "thisAndFuture";

export const CLASS_TITLE_MAX_LENGTH = 60;

/** Texto del nombre ya recortado; vacío = «sin nombre propio» (vuelve a mostrarse el automático según los alumnos). */
export function normalizeClassTitle(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function validateClassTitleInput(raw: string): { valid: true } | { valid: false; error: string } {
  if (raw.trim().length > CLASS_TITLE_MAX_LENGTH) return { valid: false, error: `El nombre no puede superar los ${CLASS_TITLE_MAX_LENGTH} caracteres.` };
  return { valid: true };
}

export const DURATION_OPTIONS_MINUTES = [30, 45, 60, 75, 90, 120] as const;

export function isValidDurationOption(value: number): boolean {
  return (DURATION_OPTIONS_MINUTES as readonly number[]).includes(value);
}

export function computeEndFromDuration(startIso: string, durationMinutes: number): string {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new RangeError("La duración debe ser un número de minutos mayor a cero.");
  const startTime = new Date(startIso).getTime();
  if (!Number.isFinite(startTime)) throw new RangeError("El inicio de la clase no es una fecha válida.");
  return new Date(startTime + durationMinutes * 60_000).toISOString();
}

export function lessonDurationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

export interface SessionSlot {
  /** Lunes = 0 … domingo = 6 (como `RecurrenceSession.weekday`). */
  weekday: number;
  hour: number;
  minute: number;
}

/** Día de la semana y hora (hora civil de la serie) en que empieza una clase: identifica cuál sesión del patrón semanal es. */
export function sessionSlotForInstant(startIso: string, timeZone: string): SessionSlot {
  const dateKey = getLocalDateKey(startIso, timeZone);
  const jsDay = getDateKeyJsDay(dateKey);
  const [hourText, minuteText] = getLocalTimeKey(startIso, timeZone).split(":");
  return { weekday: jsDay === 0 ? 6 : jsDay - 1, hour: Number(hourText), minute: Number(minuteText) };
}

/** Patrón semanal con la duración nueva SÓLO en la sesión que coincide con `slot`; `matched` dice cuántas sesiones coincidieron (si ninguna, el cambio no tendría efecto). */
export function applyDurationToWeeks(weeks: RecurrenceWeek[], slot: SessionSlot, durationMinutes: number): { weeks: RecurrenceWeek[]; matched: number } {
  let matched = 0;
  const next = weeks.map((week) => ({
    ...week,
    sessions: week.sessions.map((session) => {
      if (session.weekday === slot.weekday && session.hour === slot.hour && session.minute === slot.minute) {
        matched += 1;
        return { ...session, durationMinutes };
      }
      return session;
    }),
  }));
  return { weeks: next, matched };
}
