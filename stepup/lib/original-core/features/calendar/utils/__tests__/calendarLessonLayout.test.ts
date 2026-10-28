// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarLessonLayout.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from './testHarness.ts';
import { computeLessonColumnLayout } from '../calendarLessonLayout.ts';
import type { CalendarLesson } from '../../types/index.ts';

function buildLesson(overrides: Partial<CalendarLesson> & { id: string; start: string; end: string }): CalendarLesson {
  return {
    studentId: overrides.id,
    studentName: `Alumno ${overrides.id}`,
    level: 'A1',
    participants: [{ studentId: overrides.id, studentName: `Alumno ${overrides.id}`, level: 'A1' }],
    lessonType: 'individual',
    modality: 'presencial',
    status: 'scheduled',
    color: '#FFE4D2',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  };
}

function slotFor(layout: ReturnType<typeof computeLessonColumnLayout>, lessonId: string) {
  const slot = layout.find((item) => item.lessonId === lessonId);
  if (!slot) throw new Error(`No se encontró layout para ${lessonId}`);
  return slot;
}

test('computeLessonColumnLayout: clases sin superposición ocupan una sola columna cada una', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T15:00:00.000Z', end: '2026-07-20T16:00:00.000Z' }),
    buildLesson({ id: 'c', start: '2026-07-20T17:00:00.000Z', end: '2026-07-20T18:00:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  for (const lesson of lessons) {
    const slot = slotFor(layout, lesson.id);
    assertEqual(slot.columnCount, 1, `${lesson.id} debe estar sola en su columna`);
    assertEqual(slot.columnIndex, 0, `${lesson.id} siempre en la única columna disponible`);
  }
});

test('computeLessonColumnLayout: dos clases en el mismo horario exacto quedan lado a lado, nunca una tapando a la otra', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  const slotA = slotFor(layout, 'a');
  const slotB = slotFor(layout, 'b');
  assertEqual(slotA.columnCount, 2, 'a comparte el ancho entre 2 columnas');
  assertEqual(slotB.columnCount, 2, 'b comparte el ancho entre 2 columnas');
  assert(slotA.columnIndex !== slotB.columnIndex, 'a y b deben quedar en columnas distintas, nunca superpuestas');
});

test('computeLessonColumnLayout: superposición parcial también se reparte el ancho', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T13:30:00.000Z', end: '2026-07-20T14:30:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  assertEqual(slotFor(layout, 'a').columnCount, 2, 'se superponen 30 minutos: deben compartir columnas');
  assertEqual(slotFor(layout, 'b').columnCount, 2, 'misma lógica desde el otro lado');
});

test('computeLessonColumnLayout: tres clases encadenadas por superposición transitiva comparten 3 columnas', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T13:15:00.000Z', end: '2026-07-20T14:15:00.000Z' }),
    buildLesson({ id: 'c', start: '2026-07-20T13:30:00.000Z', end: '2026-07-20T14:30:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  assertEqual(slotFor(layout, 'a').columnCount, 3, 'a se superpone con b y c');
  assertEqual(slotFor(layout, 'b').columnCount, 3, 'b se superpone con a y c');
  assertEqual(slotFor(layout, 'c').columnCount, 3, 'c se superpone con a y b (transitivamente vía b)');
  const columns = new Set([
    slotFor(layout, 'a').columnIndex,
    slotFor(layout, 'b').columnIndex,
    slotFor(layout, 'c').columnIndex,
  ]);
  assertEqual(columns.size, 3, 'las tres deben quedar en columnas distintas entre sí');
});

test('computeLessonColumnLayout: un grupo de superposición no contagia el ancho a clases sueltas posteriores', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'c', start: '2026-07-20T15:00:00.000Z', end: '2026-07-20T16:00:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  assertEqual(slotFor(layout, 'a').columnCount, 2, 'a y b siguen compartiendo 2 columnas');
  assertEqual(slotFor(layout, 'b').columnCount, 2, 'idem para b');
  assertEqual(slotFor(layout, 'c').columnCount, 1, 'c empieza después de que a y b terminaron: sola en su columna');
});

test('computeLessonColumnLayout: un horario que termina justo cuando empieza el siguiente no cuenta como superposición', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T14:00:00.000Z', end: '2026-07-20T15:00:00.000Z' }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  assertEqual(slotFor(layout, 'a').columnCount, 1, 'a termina exactamente cuando empieza b: no se superponen');
  assertEqual(slotFor(layout, 'b').columnCount, 1, 'misma lógica para b');
});

test('computeLessonColumnLayout: una clase cancelada superpuesta sigue recibiendo su propia columna, nunca desaparece', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({
      id: 'b',
      start: '2026-07-20T13:00:00.000Z',
      end: '2026-07-20T14:00:00.000Z',
      status: 'cancelled',
    }),
  ];
  const layout = computeLessonColumnLayout(lessons);
  assertEqual(layout.length, 2, 'ambas clases (incluida la cancelada) reciben un slot de layout');
  assert(slotFor(layout, 'a').columnIndex !== slotFor(layout, 'b').columnIndex, 'quedan en columnas distintas');
});

test('computeLessonColumnLayout: nunca muta el array de entrada', () => {
  const lessons = [
    buildLesson({ id: 'a', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
    buildLesson({ id: 'b', start: '2026-07-20T13:00:00.000Z', end: '2026-07-20T14:00:00.000Z' }),
  ];
  const snapshot = JSON.stringify(lessons);
  computeLessonColumnLayout(lessons);
  assertEqual(JSON.stringify(lessons), snapshot, 'el array y sus objetos quedan intactos');
});
