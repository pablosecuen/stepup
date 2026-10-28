// Puerto VERBATIM del original (`src/features/calendar/utils/calendarPendingRecurrence.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  PendingLessonDraft,
  RecurrenceRule,
} from '../types/index.ts';
import { addDaysToDateKey, getDateKeyJsDay, getLocalDateKey } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';

export function getDeviceTimeZone(): string {
  return (
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    'America/Argentina/Buenos_Aires'
  );
}

export function buildRuleFromPendingLesson(
  draft: PendingLessonDraft,
  timeZone = getDeviceTimeZone()
): RecurrenceRule | null {
  if (draft.recurrence.mode === 'single') {
    return null;
  }

  const localDate = getLocalDateKey(draft.date, timeZone);
  const selectedWeekday = jsDayToAppWeekday(getDateKeyJsDay(localDate));
  const startDate = addDaysToDateKey(localDate, -selectedWeekday);
  const weekly = draft.recurrence.mode === 'weekly';

  return {
    recurrenceId: `recurrence_${draft.requestId}`,
    studentId: draft.studentId,
    type: weekly ? 'weekly' : 'custom',
    cycleLengthWeeks: weekly ? 1 : draft.recurrence.cycleLengthWeeks,
    weeks: weekly
      ? [
          {
            weekIndex: 0,
            sessions: [
              {
                weekday: selectedWeekday,
                hour: draft.hour,
                minute: draft.minute,
                durationMinutes: draft.durationMinutes,
              },
            ],
          },
        ]
      : draft.recurrence.weeks.map((week) => ({
          ...week,
          sessions: week.sessions.map((session) => ({
            ...session,
            durationMinutes: draft.durationMinutes,
          })),
        })),
    modality: draft.modality,
    timezone: timeZone,
    startDate,
    endDate: null,
    status: 'active',
  };
}
