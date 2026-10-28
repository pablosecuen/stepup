// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/studentSessionHistory.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildStudentSessionHistory } from '../studentSessionHistory.ts';
import type { NewClassFormState, SavedLesson } from '../../types/index.ts';
import { DEFAULT_FORM_STATE } from '../../types/index.ts';

function form(overrides: Partial<NewClassFormState> & { studentIds: string[] }): NewClassFormState {
  return {
    ...DEFAULT_FORM_STATE,
    eventType: 'clase_dictada',
    date: '2026-07-11',
    time: '10:00',
    modality: 'presencial',
    ...overrides,
  };
}

function lesson(overrides: Partial<SavedLesson> & { id: string; form: NewClassFormState }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
  };
}

const TODAY = '2026-07-15';

test('buildStudentSessionHistory: sólo clases del alumno pedido', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-10' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s2'], date: '2026-07-10' }) }),
  ];
  const entries = buildStudentSessionHistory(lessons, 's1', TODAY);
  assertEqual(entries.length, 1, 'sólo la clase del alumno pedido');
  assertEqual(entries[0].lessonId, 'l1', 'id correcto');
});

test('buildStudentSessionHistory: nunca incluye clases canceladas (countsAsClass: false)', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-10' }), countsAsClass: false }),
  ];
  const entries = buildStudentSessionHistory(lessons, 's1', TODAY);
  assertEqual(entries.length, 0, 'nunca una clase cancelada/no contabilizada');
});

test('buildStudentSessionHistory: nunca incluye una clase con fecha futura', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-20' }) }),
  ];
  const entries = buildStudentSessionHistory(lessons, 's1', TODAY);
  assertEqual(entries.length, 0, 'una clase que todavía no pasó no puede corregirse');
});

test('buildStudentSessionHistory: ordena de más reciente a más antigua', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-07-12' }) }),
    lesson({ id: 'l3', form: form({ studentIds: ['s1'], date: '2026-07-08' }) }),
  ];
  const entries = buildStudentSessionHistory(lessons, 's1', TODAY);
  assertEqual(entries.map((entry) => entry.lessonId).join(','), 'l2,l3,l1', 'más reciente primero');
});

test('buildStudentSessionHistory: expone null para campos de sesión ausentes, nunca inventa datos', () => {
  const lessons: SavedLesson[] = [lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-10' }) })];
  const entries = buildStudentSessionHistory(lessons, 's1', TODAY);
  assertEqual(entries[0].effectiveStartAt, null, 'sin dato real, nunca inventado');
  assertEqual(entries[0].actualStartedAt, null, 'sin dato real, nunca inventado');
  assertEqual(entries[0].actualEndedAt, null, 'sin dato real, nunca inventado');
  assertEqual(entries[0].studentArrival, null, 'sin dato real, nunca inventado');
});
