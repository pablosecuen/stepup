// Puerto VERBATIM del original (`src/features/calendar/utils/teacherAvailabilityEngine.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  AvailabilityConflict,
  AvailabilityException,
  AvailabilityEvaluation,
  TeacherAvailability,
  WeeklyAvailabilityBlock,
} from '../types/teacherAvailability.ts';
import { addDaysToDateKey, getDateKeyJsDay, getLocalDateKey, localDateTimeToInstantIso } from './calendarTimezone.ts';

interface InstantRange {
  start: number;
  end: number;
}

interface LabeledRange extends InstantRange {
  id: string;
  label: string;
}

export const WEEKLY_REASON_LABELS: Record<WeeklyAvailabilityBlock['reason'], string> = {
  work: 'Otro trabajo',
  study: 'Estudio',
  personal: 'Compromiso personal',
  other: 'No disponible',
};

export const EXCEPTION_REASON_LABELS: Record<AvailabilityException['reason'], string> = {
  vacation: 'Vacaciones',
  holiday: 'Feriado',
  leave: 'Licencia',
  other: 'No disponible',
};

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Horario inválido: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new RangeError(`Horario inválido: ${value}`);
  return { hour, minute };
}

function instantAt(date: string, time: string, timezone: string): number {
  const { hour, minute } = parseTime(time);
  return new Date(
    localDateTimeToInstantIso({ date, hour, minute, timeZone: timezone })
  ).getTime();
}

function dayBounds(date: string, timezone: string): InstantRange {
  const nextDate = addDaysToDateKey(date, 1);
  return {
    start: instantAt(date, '00:00', timezone),
    end: instantAt(nextDate, '00:00', timezone),
  };
}

function timedRange(
  date: string,
  startTime: string,
  endTime: string,
  timezone: string
): InstantRange {
  const start = instantAt(date, startTime, timezone);
  const end = instantAt(date, endTime, timezone);
  if (end <= start) {
    throw new RangeError(`El bloque ${startTime}-${endTime} debe terminar después de comenzar.`);
  }
  return { start, end };
}

function overlaps(a: InstantRange, b: InstantRange): boolean {
  return a.start < b.end && b.start < a.end;
}

function intersection(a: InstantRange, b: InstantRange): InstantRange {
  return { start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) };
}

function appWeekday(dateKey: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  return ((getDateKeyJsDay(dateKey) + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

function isDateInsideException(date: string, exception: AvailabilityException): boolean {
  return date >= exception.date && date <= (exception.endDate ?? exception.date);
}

function exceptionRangeForDate(
  date: string,
  exception: AvailabilityException,
  timezone: string
): InstantRange {
  if (exception.type === 'unavailable_full_day' || !exception.startTime || !exception.endTime) {
    return dayBounds(date, timezone);
  }
  return timedRange(date, exception.startTime, exception.endTime, timezone);
}

function enumerateLocalDates(startIso: string, endIso: string, timezone: string): string[] {
  const first = getLocalDateKey(startIso, timezone);
  // end es exclusivo: mirar 1 ms antes evita sumar el día siguiente cuando
  // la clase termina exactamente a medianoche.
  const last = getLocalDateKey(new Date(new Date(endIso).getTime() - 1).toISOString(), timezone);
  const result: string[] = [];
  for (let date = first; date <= last; date = addDaysToDateKey(date, 1)) result.push(date);
  return result;
}

function fullyCovered(request: InstantRange, ranges: InstantRange[]): boolean {
  const relevant = ranges
    .filter((range) => overlaps(request, range))
    .map((range) => intersection(request, range))
    .sort((a, b) => a.start - b.start);
  let cursor = request.start;
  for (const range of relevant) {
    if (range.start > cursor) return false;
    cursor = Math.max(cursor, range.end);
    if (cursor >= request.end) return true;
  }
  return false;
}

function conflictResult(
  kind: AvailabilityConflict['kind'],
  source: LabeledRange,
  request: InstantRange
): AvailabilityEvaluation {
  const overlap = intersection(source, request);
  const conflict: AvailabilityConflict = {
    kind,
    sourceId: source.id,
    label: source.label,
    overlapStart: new Date(overlap.start).toISOString(),
    overlapEnd: new Date(overlap.end).toISOString(),
  };
  return { isAvailable: false, conflict, label: conflict.label };
}

export function evaluateAvailability(
  startIso: string,
  endIso: string,
  availability: TeacherAvailability
): AvailabilityEvaluation {
  const request = { start: new Date(startIso).getTime(), end: new Date(endIso).getTime() };
  if (!Number.isFinite(request.start) || !Number.isFinite(request.end) || request.end <= request.start) {
    throw new RangeError('El rango a evaluar es inválido.');
  }

  const dates = enumerateLocalDates(startIso, endIso, availability.timezone);
  const extraRanges: InstantRange[] = [];
  const exceptionConflicts: LabeledRange[] = [];
  const weeklyConflicts: LabeledRange[] = [];

  for (const date of dates) {
    for (const exception of availability.exceptions) {
      if (!isDateInsideException(date, exception)) continue;
      const range = exceptionRangeForDate(date, exception, availability.timezone);
      if (exception.type === 'available_extra') {
        extraRanges.push(range);
      } else {
        exceptionConflicts.push({
          ...range,
          id: exception.id,
          label: exception.note?.trim() || EXCEPTION_REASON_LABELS[exception.reason],
        });
      }
    }

    for (const block of availability.weeklyBlocks) {
      if (block.weekday !== appWeekday(date)) continue;
      weeklyConflicts.push({
        ...timedRange(date, block.startTime, block.endTime, availability.timezone),
        id: block.id,
        label: block.note?.trim() || WEEKLY_REASON_LABELS[block.reason],
      });
    }
  }

  // Una disponibilidad extra sólo gana si cubre el pedido completo. Una
  // cobertura parcial no oculta el conflicto de la parte restante.
  if (fullyCovered(request, extraRanges)) {
    return { isAvailable: true, conflict: null, label: 'Disponibilidad extra' };
  }

  const exception = exceptionConflicts.find((range) => overlaps(request, range));
  if (exception) return conflictResult('exception', exception, request);

  const weekly = weeklyConflicts.find((range) => overlaps(request, range));
  if (weekly) return conflictResult('weekly_block', weekly, request);

  return { isAvailable: true, conflict: null, label: null };
}
