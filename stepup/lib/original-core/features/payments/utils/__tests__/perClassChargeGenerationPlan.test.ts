// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/perClassChargeGenerationPlan.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import type { PaymentCharge } from '../../types/index.ts';
import { planPerClassChargesForLesson, planPerClassChargesForLessons, type StudentBillingLookup } from '../perClassChargeGenerationPlan.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function form(overrides: Partial<NewClassFormState> & { studentIds: string[] }): NewClassFormState {
  return {
    eventType: 'clase_dictada',
    date: '2026-07-11',
    time: '10:00',
    scheduledDurationMinutes: 60,
    actualDurationMinutes: 60,
    modality: 'presencial',
    attendance: [],
    topics: [],
    objectives: [],
    activities: [],
    activityNotes: '',
    activityAttachments: [],
    materialIds: [],
    evaluations: [],
    internalNotes: '',
    homeworkDescription: '',
    homeworkDueDate: null,
    isBillable: true,
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
    consumesMonthlyPackage: true,
    holidayException: false,
    rescheduledFromLessonId: null,
    ...overrides,
  };
}

function savedLesson(overrides: Partial<SavedLesson> & { id: string; form: NewClassFormState }): SavedLesson {
  return {
    createdAt: '2026-07-11T12:00:00.000Z',
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    ...overrides,
  };
}

const PROFILES: Record<string, StudentBillingLookup> = {
  s1: { billingType: 'por_clase', price: 9500 },
  s2: { billingType: 'por_clase', price: 9500 },
  s3: { billingType: 'mensual', price: 20000 },
  // Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
  // de cobros): alumnos con StudentBillingPlan nuevo — ninguno de estos
  // NUNCA debe generar un cargo por clase individual, exactamente igual que
  // un alumno mensual. `billingType` queda en 'por_clase' a propósito acá
  // (compatibilidad con perfiles antiguos): lo que manda es `billingPlan`.
  s4: { billingType: 'por_clase', price: 5000, billingPlan: { type: 'weekly', amount: 5000, dueWeekday: 1 } },
  s5: {
    billingType: 'por_clase',
    price: 8000,
    billingPlan: { type: 'class_package', amount: 64000, includedClasses: 8, validFrom: '2026-07-01' },
  },
  s6: { billingType: 'por_clase', price: 0, billingPlan: { type: 'complimentary' } },
};

function getProfile(studentId: string): StudentBillingLookup | null {
  return PROFILES[studentId] ?? null;
}

test('cargo por clase individual: crea un PaymentCharge con el importe, savedLessonId y calendarLessonId correctos', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 9500,
    billedAmountByStudent: { s1: 9500 },
    calendarLessonId: 'calendar-1',
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });

  assertEqual(plan.toCreate.length, 1, 'crea un cargo');
  assertEqual(plan.toCreate[0].studentId, 's1', 'para el alumno correcto');
  assertEqual(plan.toCreate[0].type, 'por_clase', 'tipo por clase');
  assertEqual(plan.toCreate[0].originalAmount, 9500, 'importe correcto');
  assertEqual(plan.toCreate[0].dueDate, '2026-07-11', 'vence el día de la clase');
  assertEqual(plan.toCreate[0].savedLessonId, 'lesson-1', 'referencia a la clase pedagógica');
  assertEqual(plan.toCreate[0].calendarLessonId, 'calendar-1', 'referencia a la reserva de calendario');
  assertEqual(plan.skipped.length, 0, 'nadie se omite');
});

test('alumno mensual nunca genera un cargo por clase individual', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s3'] }), // s3 es mensual
    billedAmount: 20000,
    billedAmountByStudent: { s3: 20000 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea cargo por clase para un alumno mensual');
  assertEqual(plan.skipped.length, 1, 'se reporta el motivo');
  assertEqual(plan.skipped[0].reason, 'alumno_mensual', 'motivo correcto');
});

test('alumno semanal (StudentBillingPlan nuevo) nunca genera un cargo por clase individual, aunque billingType siga en por_clase', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s4'] }),
    billedAmount: 5000,
    billedAmountByStudent: { s4: 5000 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea cargo por clase para un alumno semanal');
  assertEqual(plan.skipped[0].reason, 'alumno_mensual', 'mismo motivo de omisión que un mensual (su cobro es por período)');
});

test('alumno de paquete de clases nunca genera un cargo por clase individual', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s5'] }),
    billedAmount: 8000,
    billedAmountByStudent: { s5: 8000 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea cargo por clase: su cobro es el paquete, con créditos');
});

test('alumno sin cobro (complimentary) nunca genera un cargo por clase individual', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s6'] }),
    billedAmount: 0,
    billedAmountByStudent: { s6: 0 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'nunca se le genera ningún cargo');
});

test('clase grupal con desglose: cada alumno por_clase recibe su propio importe distinto', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1', 's2'] }),
    billedAmount: 19000, // total
    billedAmountByStudent: { s1: 9500, s2: 9500 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 2, 'un cargo por alumno');
  const bys1 = plan.toCreate.find((c) => c.studentId === 's1')!;
  const bys2 = plan.toCreate.find((c) => c.studentId === 's2')!;
  assertEqual(bys1.originalAmount, 9500, 'importe de s1');
  assertEqual(bys2.originalAmount, 9500, 'importe de s2');
});

test('clase grupal con importes diferentes por alumno (precios distintos)', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1', 's2'] }),
    billedAmount: 17000,
    billedAmountByStudent: { s1: 9500, s2: 7500 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.find((c) => c.studentId === 's1')!.originalAmount, 9500, 'importe distinto de s1');
  assertEqual(plan.toCreate.find((c) => c.studentId === 's2')!.originalAmount, 7500, 'importe distinto de s2');
});

test('clase no cobrable (isBillable: false): no crea ningún cargo, se omite como importe cero', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1'], isBillable: false }),
    billedAmount: null,
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea cargos');
  assertEqual(plan.skipped[0].reason, 'importe_cero', 'se reporta como importe cero, no como error');
});

test('clase grupal no cobrable: nunca se reporta como "sin desglose" — es una decisión explícita, no una ambigüedad', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1', 's2'], isBillable: false }),
    billedAmount: null,
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea cargos');
  assert(
    plan.skipped.every((item) => item.reason === 'importe_cero'),
    'ambos se reportan como importe cero, no como grupal_sin_desglose'
  );
});

test('compatibilidad con SavedLesson anterior: individual usa billedAmount cuando falta billedAmountByStudent', () => {
  const legacyLesson = savedLesson({
    id: 'lesson-legacy-1',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 8000,
    // sin billedAmountByStudent: registro anterior a Fase 4B.1
  });
  const plan = planPerClassChargesForLesson({
    lesson: legacyLesson,
    getProfile,
    existingCharges: [],
    createdAt: '2026-07-11T12:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'crea el cargo usando billedAmount como compatibilidad');
  assertEqual(plan.toCreate[0].originalAmount, 8000, 'usa el total como importe individual');
});

test('compatibilidad con SavedLesson anterior: grupal sin desglose se reporta para revisión manual, sin inventar una división', () => {
  const legacyGroupLesson = savedLesson({
    id: 'lesson-legacy-group',
    form: form({ studentIds: ['s1', 's2'] }),
    billedAmount: 19000, // total, sin desglose por alumno
  });
  const plan = planPerClassChargesForLesson({
    lesson: legacyGroupLesson,
    getProfile,
    existingCharges: [],
    createdAt: '2026-07-11T12:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 0, 'no inventa una división del total: no crea ningún cargo');
  assertEqual(plan.skipped.length, 2, 'ambos alumnos se reportan');
  assert(
    plan.skipped.every((item) => item.reason === 'grupal_sin_desglose'),
    'el motivo identifica exactamente el problema: falta el desglose'
  );
});

test('reconciliación repetida no duplica cargos (idempotente)', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 9500,
    billedAmountByStudent: { s1: 9500 },
  });

  const firstPass = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(firstPass.toCreate.length, 1, 'primera corrida: crea el cargo');

  const secondPass = planPerClassChargesForLesson({
    lesson,
    getProfile,
    existingCharges: firstPass.toCreate, // simula que ya quedó persistido
    createdAt: '2026-07-12T09:00:00.000Z', // otra apertura de la app, otro día
  });
  assertEqual(secondPass.toCreate.length, 0, 'segunda corrida: no duplica, el cargo ya existe');
});

test('planPerClassChargesForLessons barre varias clases y es idempotente entre ellas', () => {
  const lessonA = savedLesson({
    id: 'lesson-a',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 9500,
    billedAmountByStudent: { s1: 9500 },
  });
  const lessonB = savedLesson({
    id: 'lesson-b',
    form: form({ studentIds: ['s2'], date: '2026-07-12' }),
    billedAmount: 7000,
    billedAmountByStudent: { s2: 7000 },
  });

  const firstRun = planPerClassChargesForLessons({
    lessons: [lessonA, lessonB],
    getProfile,
    existingCharges: [],
    createdAt: '2026-07-12T09:00:00.000Z',
  });
  assertEqual(firstRun.toCreate.length, 2, 'crea un cargo por cada clase');

  const secondRun = planPerClassChargesForLessons({
    lessons: [lessonA, lessonB],
    getProfile,
    existingCharges: firstRun.toCreate,
    createdAt: '2026-07-13T09:00:00.000Z',
  });
  assertEqual(secondRun.toCreate.length, 0, 'reconciliación repetida: no duplica ninguno de los dos');
});

test('alumno sin perfil se omite y se reporta, sin crear un cargo huérfano', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['alumno-fantasma'] }),
    billedAmount: 9500,
    billedAmountByStudent: { 'alumno-fantasma': 9500 },
  });
  const plan = planPerClassChargesForLesson({ lesson, getProfile, existingCharges: [], createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no crea nada sin poder confirmar el tipo de facturación');
  assertEqual(plan.skipped[0].reason, 'sin_perfil', 'motivo correcto');
});

test('no muta lesson ni existingCharges recibidos', () => {
  const lesson = savedLesson({
    id: 'lesson-1',
    form: form({ studentIds: ['s1'] }),
    billedAmount: 9500,
    billedAmountByStudent: { s1: 9500 },
  });
  const existingCharges: PaymentCharge[] = [];
  const lessonSnapshot = JSON.stringify(lesson);
  const chargesSnapshot = JSON.stringify(existingCharges);
  planPerClassChargesForLesson({ lesson, getProfile, existingCharges, createdAt: '2026-07-11T12:00:00.000Z' });
  assertEqual(JSON.stringify(lesson), lessonSnapshot, 'lesson no cambia');
  assertEqual(JSON.stringify(existingCharges), chargesSnapshot, 'existingCharges no cambia');
});
