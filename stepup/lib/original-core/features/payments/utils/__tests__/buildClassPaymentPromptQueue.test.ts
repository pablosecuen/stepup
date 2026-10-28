// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/buildClassPaymentPromptQueue.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildClassPaymentPromptQueue } from '../buildClassPaymentPromptQueue.ts';
import type { StudentBillingLookup } from '../perClassChargeGenerationPlan.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function perClassCharge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; savedLessonId: string }): PaymentCharge {
  return {
    type: 'por_clase',
    originalAmount: 9500,
    currency: 'ARS',
    dueDate: '2026-07-11',
    createdAt: '2026-07-11T12:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string }): Payment {
  return {
    amount: 9500,
    currency: 'ARS',
    method: 'efectivo',
    paidAt: '2026-07-11',
    recordedAt: '2026-07-11T12:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(
  overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string }
): PaymentAllocation {
  return { amount: 9500, ...overrides };
}

const porClaseProfile: StudentBillingLookup = { billingType: 'por_clase', price: 9500 };
const mensualProfile: StudentBillingLookup = { billingType: 'mensual', price: 20000 };
// Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
// de cobros): alumno semanal con StudentBillingPlan nuevo — `billingType`
// crudo sigue en 'por_clase' (compatibilidad), pero `billingPlan` es lo que
// manda: nunca debe preguntarse nada financiero al registrar su clase.
const weeklyProfile: StudentBillingLookup = {
  billingType: 'por_clase',
  price: 5000,
  billingPlan: { type: 'weekly', amount: 5000, dueWeekday: 1 },
};

test('incluye a un alumno por_clase con cargo recién creado y sin asignaciones', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 1, 'un alumno en la cola');
  assertEqual(queue[0].studentId, 's1', 'el id del alumno');
  assertEqual(queue[0].studentName, 'Ana', 'el nombre del alumno');
  assertEqual(queue[0].chargeId, 'charge_por_clase_s1_lesson-1', 'el cargo de esta clase');
});

test('nunca pregunta por un alumno mensual (regla 1)', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    // ni siquiera hace falta que exista un cargo: se descarta por billingType antes de buscarlo
    charges: [],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => mensualProfile,
    state,
  });
  assertEqual(queue.length, 0, 'sin preguntas para un alumno mensual');
});

test('nunca pregunta a un alumno semanal (StudentBillingPlan), aunque billingType siga en por_clase', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    // aunque existiera un cargo por_clase huérfano de una versión anterior, no debe preguntarse
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => weeklyProfile,
    state,
  });
  assertEqual(queue.length, 0, 'sin preguntas para un alumno semanal: su cobro es por período, se gestiona desde Cobros');
});

test('no pregunta si no existe cargo para esta clase (no facturable, precio inválido o reconciliación fallida)', () => {
  const state: PaymentsRepositoryState = emptyState(); // ningún cargo se llegó a crear
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 0, 'sin cargo no hay nada que preguntar; la clase ya guardada no se ve afectada');
});

test('no pregunta a un alumno sin perfil', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => null,
    state,
  });
  assertEqual(queue.length, 0, 'sin perfil, se omite');
});

test('no repregunta a un alumno cuyo cargo ya tiene una asignación registrada (evita duplicar, regla 9)', () => {
  const state: PaymentsRepositoryState = {
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
    payments: [payment({ id: 'payment-1', studentId: 's1' })],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge_por_clase_s1_lesson-1', studentId: 's1' })],
    adjustments: [],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 0, 'ya resuelto anteriormente: no se vuelve a preguntar ni se arriesga a duplicar el pago');
});

test('ignora una asignación anulada del pago y sigue preguntando (el pago original ya no cuenta como resolución vigente)', () => {
  const state: PaymentsRepositoryState = {
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
    payments: [payment({ id: 'payment-1', studentId: 's1', voidedAt: '2026-07-12T00:00:00.000Z', voidReason: 'error' })],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge_por_clase_s1_lesson-1', studentId: 's1' })],
    adjustments: [],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 1, 'un pago anulado no cuenta como resolución vigente: se vuelve a preguntar');
});

test('clase grupal: resuelve a cada alumno por_clase con su propio cargo, sin mezclarlos (regla 2)', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1', originalAmount: 9500 }),
      perClassCharge({ id: 'charge_por_clase_s2_lesson-1', studentId: 's2', savedLessonId: 'lesson-1', originalAmount: 12000 }),
    ],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1', 's2', 's3'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana', s2: 'Beto', s3: 'Caro' },
    getProfile: (id) => (id === 's3' ? mensualProfile : porClaseProfile), // s3 es mensual, se descarta
    state,
  });
  assertEqual(queue.length, 2, 'sólo los dos alumnos por_clase, en el orden de studentIds');
  assertEqual(queue[0].studentId, 's1', 'primero s1');
  assertEqual(queue[0].charge.originalAmount, 9500, 'cada uno con su propio importe');
  assertEqual(queue[1].studentId, 's2', 'luego s2');
  assertEqual(queue[1].charge.originalAmount, 12000, 'no se mezclan los cargos entre alumnos');
});

test('no confunde el cargo de otra clase del mismo alumno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      perClassCharge({ id: 'charge_por_clase_s1_lesson-viejo', studentId: 's1', savedLessonId: 'lesson-viejo', originalAmount: 5000 }),
    ],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-nuevo', // clase distinta, sin cargo propio todavía
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 0, 'el cargo de una clase distinta no cuenta para esta');
});

test('ignora un cargo anulado como si no existiera', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      perClassCharge({
        id: 'charge_por_clase_s1_lesson-1',
        studentId: 's1',
        savedLessonId: 'lesson-1',
        voidedAt: '2026-07-12T00:00:00.000Z',
        voidReason: 'clase cancelada por error',
      }),
    ],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: { s1: 'Ana' },
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue.length, 0, 'un cargo anulado no genera pregunta');
});

test('usa el studentId como respaldo del nombre si no está en studentNames', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
  };
  const queue = buildClassPaymentPromptQueue({
    studentIds: ['s1'],
    savedLessonId: 'lesson-1',
    studentNames: {},
    getProfile: () => porClaseProfile,
    state,
  });
  assertEqual(queue[0].studentName, 's1', 'respaldo razonable si falta el nombre');
});

test('no muta state ni studentIds ni studentNames recibidos', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [perClassCharge({ id: 'charge_por_clase_s1_lesson-1', studentId: 's1', savedLessonId: 'lesson-1' })],
  };
  const studentIds = ['s1'];
  const studentNames = { s1: 'Ana' };
  const stateSnapshot = JSON.stringify(state);
  const idsSnapshot = JSON.stringify(studentIds);
  const namesSnapshot = JSON.stringify(studentNames);

  buildClassPaymentPromptQueue({ studentIds, savedLessonId: 'lesson-1', studentNames, getProfile: () => porClaseProfile, state });

  assertEqual(JSON.stringify(state), stateSnapshot, 'state sin cambios');
  assertEqual(JSON.stringify(studentIds), idsSnapshot, 'studentIds sin cambios');
  assertEqual(JSON.stringify(studentNames), namesSnapshot, 'studentNames sin cambios');
  assert(true, 'no lanza');
});
