// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarPendingRecurrence.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PendingLessonDraft } from '../../types/index.ts';
import { buildRuleFromPendingLesson } from '../calendarPendingRecurrence.ts';
import { assert, assertEqual, test } from './testHarness.ts';

function draft(mode: 'single' | 'weekly' | 'custom'): PendingLessonDraft {
  return {
    studentId: 'student-new',
    requestId: 'request-stable',
    date: '2026-07-13T21:00:00.000Z',
    hour: 18,
    minute: 0,
    durationMinutes: 60,
    modality: 'presencial',
    recurrence: {
      mode,
      cycleLengthWeeks: mode === 'custom' ? 2 : 1,
      weeks: [
        {
          weekIndex: 0,
          sessions: [
            { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
          ],
        },
        {
          weekIndex: 1,
          sessions: [
            { weekday: 3, hour: 17, minute: 30, durationMinutes: 60 },
          ],
        },
      ],
    },
  };
}

test('alta de alumno con clase suelta no crea regla', () => {
  assertEqual(
    buildRuleFromPendingLesson(
      draft('single'),
      'America/Argentina/Buenos_Aires'
    ),
    null,
    'sin regla'
  );
});

test('alta semanal crea una regla estable sin duplicados por id', () => {
  const rule = buildRuleFromPendingLesson(
    draft('weekly'),
    'America/Argentina/Buenos_Aires'
  );
  assert(rule, 'debe crear regla');
  assertEqual(rule.recurrenceId, 'recurrence_request-stable', 'id estable');
  assertEqual(rule.startDate, '2026-07-13', 'lunes inicial');
  assertEqual(rule.weeks[0].sessions[0].weekday, 0, 'día del slot');
});

test('alta personalizada conserva el ciclo alternado', () => {
  const rule = buildRuleFromPendingLesson(
    draft('custom'),
    'America/Argentina/Buenos_Aires'
  );
  assert(rule, 'debe crear regla');
  assertEqual(rule.cycleLengthWeeks, 2, 'ciclo de dos semanas');
  assertEqual(rule.weeks[1].sessions[0].weekday, 3, 'segunda semana jueves');
});
