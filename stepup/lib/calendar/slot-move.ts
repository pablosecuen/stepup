import { addDaysToDateKey, daysBetweenDateKeys, getDateKeyJsDay, getLocalDateKey, getLocalTimeKey, localDateTimeToInstantIso } from "./timezone.ts";
import { mondayOfWeekContaining } from "./weekday.ts";
import { generateOccurrences } from "./recurrence-engine.ts";
import type { RecurrenceRuleForEngine, RecurrenceSession, RecurrenceWeek } from "./types.ts";

/**
 * «Cambiar horario — esta y las siguientes»: la sesión semanal de la serie que cae en la clase elegida pasa al día y hora nuevos y LAS DEMÁS sesiones no cambian. Todo puro:
 * el servidor vuelve a calcular el patrón con esta función (nunca confía en el que arma el navegador) y después valida conflictos y disponibilidad con el motor de siempre.
 *
 * El cambio rige desde `effectiveDate` = la fecha más temprana entre la clase elegida y el día nuevo, así que la clase elegida queda reemplazada por UNA sola ocurrencia (la
 * nueva) y nunca existen las dos. Para que la primera clase con el nuevo horario sea exactamente la elegida, el día nuevo tiene que estar a menos de una semana de la clase
 * original (la sucesora arranca en el lunes de la semana de la fecha efectiva).
 */
export interface SlotMoveRule {
  weeks: RecurrenceWeek[];
  /** Lunes de la semana 0 del patrón vigente (`recurrence_rules.start_date`). */
  startDate: string;
  endDate: string | null;
  timezone: string;
}

export interface SlotMoveInput {
  rule: SlotMoveRule;
  /** Inicio (ISO) de la clase que se mueve. */
  originalStartIso: string;
  targetDate: string;
  /** «HH:MM». */
  targetTime: string;
  todayDate: string;
}

export type SlotMovePlan = { ok: true; weeks: RecurrenceWeek[]; effectiveDate: string; originalDate: string } | { ok: false; error: string };

const MAX_GAP_DAYS = 6;

const appWeekdayOfDateKey = (dateKey: string) => {
  const jsDay = getDateKeyJsDay(dateKey);
  return jsDay === 0 ? 6 : jsDay - 1;
};
const weeksBetween = (fromMonday: string, toMonday: string) => Math.round(daysBetweenDateKeys(fromMonday, toMonday) / 7);
const mod = (value: number, size: number) => ((value % size) + size) % size;
const byStart = (a: RecurrenceSession, b: RecurrenceSession) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute;

/** Sesiones de una misma semana que se pisan entre sí (el patrón nuevo no puede dejar dos clases de la misma serie al mismo tiempo). */
export function patternSelfOverlap(weeks: readonly RecurrenceWeek[]): boolean {
  return weeks.some((week) => {
    const sessions = [...week.sessions].sort(byStart);
    return sessions.some((session, index) => {
      const next = sessions[index + 1];
      return !!next && next.weekday === session.weekday && next.hour * 60 + next.minute < session.hour * 60 + session.minute + session.durationMinutes;
    });
  });
}

export function planSeriesSlotMove(input: SlotMoveInput): SlotMovePlan {
  const { rule, todayDate } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.targetTime)) return { ok: false, error: "Elegí un día y una hora válidos." };
  const originalDate = getLocalDateKey(input.originalStartIso, rule.timezone);
  const [originalHour, originalMinute] = getLocalTimeKey(input.originalStartIso, rule.timezone).split(":").map(Number);
  const [targetHour, targetMinute] = input.targetTime.split(":").map(Number);

  const effectiveDate = input.targetDate < originalDate ? input.targetDate : originalDate;
  if (effectiveDate < todayDate) return { ok: false, error: "No se puede cambiar el horario de una fecha pasada." };
  if (Math.abs(daysBetweenDateKeys(originalDate, input.targetDate)) > MAX_GAP_DAYS) {
    return { ok: false, error: "Para «Esta y las siguientes» elegí un día de la misma semana que esta clase (hasta 6 días antes o después). Para mover sólo esta clase a otra fecha usá «Solo esta clase»." };
  }
  if (rule.endDate && input.targetDate > rule.endDate) return { ok: false, error: "El día elegido queda fuera de la serie." };

  const cycle = rule.weeks.length;
  if (cycle < 1) return { ok: false, error: "La serie no tiene un patrón semanal válido." };
  const effectiveMonday = mondayOfWeekContaining(effectiveDate);
  // El patrón vigente está numerado desde su propio lunes de inicio; la sucesora vuelve a numerar desde el lunes de la fecha efectiva.
  const rotation = mod(weeksBetween(rule.startDate, effectiveMonday), cycle);
  const rotated: RecurrenceWeek[] = rule.weeks
    .map((week) => ({ weekIndex: mod(week.weekIndex - rotation, cycle), sessions: week.sessions.map((session) => ({ ...session })) }))
    .sort((a, b) => a.weekIndex - b.weekIndex);

  const originalWeekIndex = mod(weeksBetween(effectiveMonday, mondayOfWeekContaining(originalDate)), cycle);
  const targetWeekIndex = mod(weeksBetween(effectiveMonday, mondayOfWeekContaining(input.targetDate)), cycle);
  const originalWeekday = appWeekdayOfDateKey(originalDate);
  const source = rotated.find((week) => week.weekIndex === originalWeekIndex);
  const matches = source?.sessions.filter((session) => session.weekday === originalWeekday && session.hour === originalHour && session.minute === originalMinute) ?? [];
  if (!source || matches.length !== 1) return { ok: false, error: "No encontramos el horario de esta clase en el patrón de la serie: no se cambió nada." };
  const moving = matches[0];

  const moved = rotated.map((week) => ({ ...week, sessions: week.sessions.filter((session) => session !== moving) }));
  const destination = moved.find((week) => week.weekIndex === targetWeekIndex);
  if (!destination) return { ok: false, error: "No se pudo ubicar el nuevo horario en el patrón de la serie." };
  destination.sessions.push({ weekday: appWeekdayOfDateKey(input.targetDate), hour: targetHour, minute: targetMinute, durationMinutes: moving.durationMinutes });
  moved.forEach((week) => week.sessions.sort(byStart));
  if (patternSelfOverlap(moved)) return { ok: false, error: "El nuevo horario se superpone con otra clase de esta misma serie." };

  // Comprobación final con el motor real: la primera clase con el horario nuevo tiene que ser exactamente la elegida, y la clase original no puede seguir existiendo.
  const probe: RecurrenceRuleForEngine = {
    recurrenceId: "cambio-de-horario",
    studentId: null,
    participantIds: [],
    cycleLengthWeeks: cycle,
    weeks: moved,
    modality: "online",
    timezone: rule.timezone,
    startDate: effectiveMonday,
    endDate: rule.endDate,
    status: "active",
    classTitle: null,
    activityKind: "class",
  };
  const from = new Date(localDateTimeToInstantIso({ date: effectiveDate, hour: 0, minute: 0, timeZone: rule.timezone }));
  const until = new Date(localDateTimeToInstantIso({ date: addDaysToDateKey(effectiveDate, 7 * cycle + 14), hour: 0, minute: 0, timeZone: rule.timezone }));
  const generated = generateOccurrences(probe, from, until);
  const targetStart = localDateTimeToInstantIso({ date: input.targetDate, hour: targetHour, minute: targetMinute, timeZone: rule.timezone });
  const hasTarget = generated.some((occurrence) => occurrence.start === targetStart);
  const keepsOriginal = generated.some((occurrence) => occurrence.start === input.originalStartIso) && input.originalStartIso !== targetStart;
  if (!hasTarget || keepsOriginal) return { ok: false, error: "El patrón de la serie no permite ese día y hora como siguiente clase. Elegí otro día de la misma semana." };
  return { ok: true, weeks: moved, effectiveDate, originalDate };
}
