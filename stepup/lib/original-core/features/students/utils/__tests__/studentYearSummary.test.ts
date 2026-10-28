// Puerto VERBATIM del original (`src/features/students/utils/__tests__/studentYearSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import { DEFAULT_FORM_STATE } from '../../../new-class/types/index.ts';
import { buildNewStudentsPerMonthSummary, buildStudentYearActivitySummary } from '../studentYearSummary.ts';
import { assert, assertEqual, finishTests, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function lesson(
  overrides: Partial<Omit<SavedLesson, 'form'>> & { id: string; form: Partial<NewClassFormState> }
): SavedLesson {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
    form: {
      ...DEFAULT_FORM_STATE,
      studentIds: ['s1'],
      date: '2026-03-10',
      time: '10:00',
      modality: 'online',
      eventType: 'clase_dictada',
      actualDurationMinutes: null,
      ...overrides.form,
    },
  };
}

function student(overrides: { id: string; status: string; dateJoined: string }) {
  return overrides;
}

// ---------------------------------------------------------------------------
// Alumnos únicos atendidos
// ---------------------------------------------------------------------------

test('alumnos únicos atendidos: sólo cuenta studentId con al menos una clase dictada en el año', () => {
  const lessons = [
    lesson({ id: 'l1', form: { studentIds: ['s1'], date: '2026-03-01' } }),
    lesson({ id: 'l2', form: { studentIds: ['s2'], date: '2026-06-01', eventType: 'alumno_ausente' } }),
  ];
  const summary = buildStudentYearActivitySummary({
    lessons,
    students: [student({ id: 's1', status: 'activo', dateJoined: '2025-01-01' })],
    year: 2026,
  });
  assertEqual(summary.uniqueStudentsAttended, 1, 's2 nunca tuvo una clase efectivamente dictada');
});

test('clase compartida cuenta cada participante una sola vez en el total anual', () => {
  const lessons = [
    lesson({ id: 'l1', form: { studentIds: ['s1', 's2'], date: '2026-03-01' } }),
    lesson({ id: 'l2', form: { studentIds: ['s1', 's2'], date: '2026-04-01' } }),
  ];
  const summary = buildStudentYearActivitySummary({
    lessons,
    students: [],
    year: 2026,
  });
  assertEqual(summary.uniqueStudentsAttended, 2, 's1 y s2 cuentan una vez cada uno, no una vez por clase');
});

test('alumno sin clases nunca cuenta como atendido', () => {
  const summary = buildStudentYearActivitySummary({
    lessons: [],
    students: [student({ id: 's1', status: 'activo', dateJoined: '2026-01-01' })],
    year: 2026,
  });
  assertEqual(summary.uniqueStudentsAttended, 0, 'un alumno sin ninguna clase dictada no cuenta como atendido');
});

test('perfil huérfano/dato de prueba: se excluye vía validStudentIds', () => {
  const lessons = [
    lesson({ id: 'l1', form: { studentIds: ['s-real'], date: '2026-03-01' } }),
    lesson({ id: 'l2', form: { studentIds: ['s-huerfano'], date: '2026-03-01' } }),
  ];
  const summary = buildStudentYearActivitySummary({
    lessons,
    students: [],
    year: 2026,
    validStudentIds: new Set(['s-real']),
  });
  assertEqual(summary.uniqueStudentsAttended, 1, 'sólo el id que existe en la colección real de alumnos cuenta');
});

test('activos actualmente: usa el status canónico del perfil, nunca se infiere por tener clase futura', () => {
  const summary = buildStudentYearActivitySummary({
    lessons: [],
    students: [
      student({ id: 's1', status: 'activo', dateJoined: '2025-01-01' }),
      student({ id: 's2', status: 'pausado', dateJoined: '2025-01-01' }),
      student({ id: 's3', status: 'archivado', dateJoined: '2025-01-01' }),
    ],
    year: 2026,
  });
  assertEqual(summary.activeStudentsNow, 1, 'sólo status activo cuenta, sin importar clases futuras');
});

// ---------------------------------------------------------------------------
// Cambio de año
// ---------------------------------------------------------------------------

test('cambio de año: sólo cuenta clases y altas del año pedido', () => {
  const lessons = [
    lesson({ id: 'l-2025', form: { studentIds: ['s1'], date: '2025-12-31' } }),
    lesson({ id: 'l-2026', form: { studentIds: ['s2'], date: '2026-01-01' } }),
  ];
  const summary = buildStudentYearActivitySummary({
    lessons,
    students: [
      student({ id: 's1', status: 'activo', dateJoined: '2025-06-01' }),
      student({ id: 's2', status: 'activo', dateJoined: '2026-01-01' }),
    ],
    year: 2026,
  });
  assertEqual(summary.uniqueStudentsAttended, 1, 'sólo s2 tuvo clase en 2026');
  assertEqual(summary.newStudentsThisYear, 1, 'sólo s2 se dio de alta en 2026');
});

// ---------------------------------------------------------------------------
// Alumnos nuevos por mes
// ---------------------------------------------------------------------------

test('alumnos nuevos por mes: usa dateJoined real, nunca fecha de primera clase/pago/edición', () => {
  const summary = buildNewStudentsPerMonthSummary({
    students: [
      student({ id: 's1', status: 'activo', dateJoined: '2026-01-15' }),
      student({ id: 's2', status: 'activo', dateJoined: '2026-01-20' }),
      student({ id: 's3', status: 'activo', dateJoined: '2026-03-05' }),
    ],
    year: 2026,
  });
  assertEqual(summary.months.length, 12, 'siempre 12 entradas, meses sin alta en 0');
  assertEqual(summary.months[0].count, 2, 'dos altas en enero');
  assertEqual(summary.months[2].count, 1, 'una alta en marzo');
  assertEqual(summary.months[1].count, 0, 'febrero sin altas, en 0, no ausente');
  assertEqual(summary.total, 3, 'total anual');
  assertEqual(summary.peakMonths.length, 1, 'un único mes pico');
  assertEqual(summary.peakMonths[0], 1, 'enero es el mes pico');
});

test('mes pico empatado: muestra todos los meses empatados', () => {
  const summary = buildNewStudentsPerMonthSummary({
    students: [
      student({ id: 's1', status: 'activo', dateJoined: '2026-01-01' }),
      student({ id: 's2', status: 'activo', dateJoined: '2026-03-01' }),
    ],
    year: 2026,
  });
  assertEqual(summary.peakMonths.length, 2, 'dos meses empatados en el pico');
  assert(summary.peakMonths.includes(1), 'enero está entre los meses pico');
  assert(summary.peakMonths.includes(3), 'marzo está entre los meses pico');
});

test('sin datos del año anterior: previousYearTotal es null, nunca 0 engañoso', () => {
  const summary = buildNewStudentsPerMonthSummary({
    students: [student({ id: 's1', status: 'activo', dateJoined: '2026-01-01' })],
    year: 2026,
  });
  assertEqual(summary.previousYearTotal, null, 'sin ningún alumno de 2025, no hay comparación posible');
});

test('con datos del año anterior: compara correctamente', () => {
  const summary = buildNewStudentsPerMonthSummary({
    students: [
      student({ id: 's1', status: 'activo', dateJoined: '2025-05-01' }),
      student({ id: 's2', status: 'activo', dateJoined: '2025-06-01' }),
      student({ id: 's3', status: 'activo', dateJoined: '2026-01-01' }),
    ],
    year: 2026,
  });
  assertEqual(summary.previousYearTotal, 2, 'dos altas de 2025');
  assertEqual(summary.total, 1, 'una alta de 2026');
});

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

test('colecciones vacías: todo en cero, sin errores', () => {
  const summary = buildStudentYearActivitySummary({ lessons: [], students: [], year: 2026 });
  assertEqual(summary.uniqueStudentsAttended, 0, 'sin datos');
  assertEqual(summary.activeStudentsNow, 0, 'sin datos');
  assertEqual(summary.newStudentsThisYear, 0, 'sin datos');

  const monthly = buildNewStudentsPerMonthSummary({ students: [], year: 2026 });
  assertEqual(monthly.total, 0, 'sin altas');
  assertEqual(monthly.peakMonths.length, 0, 'sin mes pico si no hay datos');
});

test('no muta lessons ni students', () => {
  const lessons = [lesson({ id: 'l1', form: { studentIds: ['s1'], date: '2026-03-01' } })];
  const students = [student({ id: 's1', status: 'activo', dateJoined: '2026-01-01' })];
  const lessonsSnapshot = JSON.stringify(lessons);
  const studentsSnapshot = JSON.stringify(students);
  buildStudentYearActivitySummary({ lessons, students, year: 2026 });
  buildNewStudentsPerMonthSummary({ students, year: 2026 });
  assertEqual(JSON.stringify(lessons), lessonsSnapshot, 'lessons no cambia');
  assertEqual(JSON.stringify(students), studentsSnapshot, 'students no cambia');
});

finishTests('de resumen anual de alumnos');
