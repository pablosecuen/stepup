// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/reportMonths.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildMonthsSummaryLabel, buildReportTitle, computeSelectedMonthsRange, formatClassCount, getStudentMonthsWithClasses, isLessonCountedForReports } from '../reportMonths.ts';
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import { DEFAULT_FORM_STATE } from '../../../new-class/types/index.ts';

const TODAY = '2026-07-18';

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

test('getStudentMonthsWithClasses: agrupa y cuenta correctamente por mes', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-07-12' }) }),
    lesson({ id: 'l3', form: form({ studentIds: ['s1'], date: '2026-06-20' }) }),
  ];
  const months = getStudentMonthsWithClasses(lessons, 's1', TODAY);
  assertEqual(months.length, 2, 'dos meses con clases');
  assertEqual(months[0].monthKey, '2026-07', 'orden más-reciente-primero');
  assertEqual(months[0].classCount, 2, 'dos clases en julio');
  assertEqual(months[1].monthKey, '2026-06', 'junio en segundo lugar');
  assertEqual(months[1].classCount, 1, 'una clase en junio');
  assertEqual(months[0].label, 'Julio 2026', 'etiqueta capitalizada con año');
});

test('getStudentMonthsWithClasses: excluye clases canceladas/no contabilizadas (countsAsClass: false)', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-07-06', eventType: 'cancelada_tarde' }), countsAsClass: false }),
  ];
  const months = getStudentMonthsWithClasses(lessons, 's1', TODAY);
  assertEqual(months.length, 1, 'sólo julio cuenta');
  assertEqual(months[0].classCount, 1, 'la clase cancelada no suma');
});

test('getStudentMonthsWithClasses: nunca cuenta una clase con fecha futura', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-08-01' }) }),
  ];
  const months = getStudentMonthsWithClasses(lessons, 's1', TODAY);
  assertEqual(months.length, 1, 'agosto es futuro respecto de hoy (18/07/2026), no cuenta');
  assertEqual(months[0].monthKey, '2026-07', 'sólo julio');
});

test('getStudentMonthsWithClasses: nunca duplica una clase reprogramada (la original queda con countsAsClass: false)', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'original', form: form({ studentIds: ['s1'], date: '2026-07-05', eventType: 'reprogramada' }), countsAsClass: false }),
    lesson({ id: 'nueva-fecha', form: form({ studentIds: ['s1'], date: '2026-07-12', eventType: 'clase_dictada', rescheduledFromLessonId: 'original' }) }),
  ];
  const months = getStudentMonthsWithClasses(lessons, 's1', TODAY);
  const totalClasses = months.reduce((sum, month) => sum + month.classCount, 0);
  assertEqual(totalClasses, 1, 'la clase reprogramada cuenta una sola vez, en su fecha real');
});

test('getStudentMonthsWithClasses: nunca incluye clases de otro alumno', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-07-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s2'], date: '2026-07-06' }) }),
  ];
  const months = getStudentMonthsWithClasses(lessons, 's1', TODAY);
  assertEqual(months[0].classCount, 1, 'sólo la clase del alumno pedido');
});

test('getStudentMonthsWithClasses: alumno sin clases devuelve lista vacía', () => {
  const months = getStudentMonthsWithClasses([], 's1', TODAY);
  assertEqual(months.length, 0, 'sin clases, sin meses');
});

test('formatClassCount: singular y plural correctos', () => {
  assertEqual(formatClassCount(1), '1 clase', 'singular');
  assertEqual(formatClassCount(0), '0 clases', 'plural con cero');
  assertEqual(formatClassCount(2), '2 clases', 'plural');
  assertEqual(formatClassCount(14), '14 clases', 'plural con dos dígitos');
});

test('computeSelectedMonthsRange: calcula primera y última clase incluida de los meses elegidos', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-05-05' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-06-10' }) }),
    lesson({ id: 'l3', form: form({ studentIds: ['s1'], date: '2026-07-15' }) }),
  ];
  const range = computeSelectedMonthsRange(lessons, 's1', ['2026-05', '2026-06', '2026-07'], TODAY);
  assert(range !== null, 'debe encontrar un rango');
  assertEqual(range!.periodStart, '2026-05-05', 'primera clase real, nunca inventada');
  assertEqual(range!.periodEnd, '2026-07-15', 'última clase real');
  assertEqual(range!.classCount, 3, 'total de clases incluidas');
});

test('computeSelectedMonthsRange: meses no consecutivos excluyen los meses intermedios no elegidos', () => {
  const lessons: SavedLesson[] = [
    lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-03-01' }) }),
    lesson({ id: 'l2', form: form({ studentIds: ['s1'], date: '2026-04-15' }) }), // abril no elegido
    lesson({ id: 'l3', form: form({ studentIds: ['s1'], date: '2026-06-20' }) }),
  ];
  const range = computeSelectedMonthsRange(lessons, 's1', ['2026-03', '2026-06'], TODAY);
  assertEqual(range!.classCount, 2, 'nunca incluye abril, que no fue seleccionado');
});

test('computeSelectedMonthsRange: sin clases en los meses elegidos devuelve null', () => {
  const range = computeSelectedMonthsRange([], 's1', ['2026-07'], TODAY);
  assertEqual(range, null, 'null cuando no hay clases');
});

test('isLessonCountedForReports: nunca cuenta una reserva de calendario futura como asistida', () => {
  const futureLesson = lesson({ id: 'l1', form: form({ studentIds: ['s1'], date: '2026-12-31' }) });
  assert(!isLessonCountedForReports(futureLesson, 's1', TODAY), 'clase futura nunca cuenta');
});

test('buildMonthsSummaryLabel: un solo mes', () => {
  assertEqual(buildMonthsSummaryLabel(['2026-07']), 'julio 2026', 'ejemplo exacto pedido');
});

test('buildMonthsSummaryLabel: meses consecutivos', () => {
  assertEqual(buildMonthsSummaryLabel(['2026-05', '2026-06', '2026-07']), 'mayo a julio 2026', 'ejemplo exacto pedido');
});

test('buildMonthsSummaryLabel: meses no consecutivos', () => {
  assertEqual(buildMonthsSummaryLabel(['2026-03', '2026-06']), 'marzo y junio 2026', 'ejemplo exacto pedido');
});

test('buildMonthsSummaryLabel: es indiferente al orden de entrada', () => {
  assertEqual(buildMonthsSummaryLabel(['2026-07', '2026-05', '2026-06']), 'mayo a julio 2026', 'ordena internamente antes de agrupar');
});

test('buildReportTitle: antepone "Informe — " al resumen de meses', () => {
  assertEqual(buildReportTitle(['2026-07']), 'Informe — julio 2026', 'título completo de un solo mes');
  assertEqual(buildReportTitle(['2026-03', '2026-06']), 'Informe — marzo y junio 2026', 'título completo no consecutivo');
});
