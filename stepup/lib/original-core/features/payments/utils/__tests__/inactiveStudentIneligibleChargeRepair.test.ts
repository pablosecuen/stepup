// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/inactiveStudentIneligibleChargeRepair.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): pruebas de la reparación general de mensualidades ya
 * creadas para un período no facturable por inactividad
 * (`planInactiveStudentIneligibleChargeRepair`, `financialReconciliation.ts`).
 *
 * Identidad ficticia aislada: todos los `studentId` usan el prefijo
 * `qa-fin-` — nunca las cuentas reales de Joaquín ni Lara Gómez Sand, ni los
 * dos casos puntuales observados.
 */
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentStatus } from '../../../student-profile/types/index.ts';
import { planInactiveStudentIneligibleChargeRepair } from '../financialReconciliation.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function monthlyCharge(
  overrides: Partial<PaymentCharge> & { id: string; studentId: string; billingPeriod: string; dueDate: string }
): PaymentCharge {
  return {
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    createdAt: `${overrides.dueDate}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function perClassCharge(
  overrides: Partial<PaymentCharge> & { id: string; studentId: string; dueDate: string }
): PaymentCharge {
  return {
    type: 'por_clase',
    originalAmount: 9000,
    currency: 'ARS',
    createdAt: `${overrides.dueDate}T09:00:00.000Z`,
    savedLessonId: `lesson-${overrides.id}`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> & { id: string; studentId: string; amount: number; paidAt: string }): Payment {
  return {
    currency: 'ARS',
    method: 'efectivo',
    recordedAt: `${overrides.paidAt}T09:00:00.000Z`,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(
  overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string; amount: number }
): PaymentAllocation {
  return { ...overrides };
}

function student(overrides: { id: string; status: StudentStatus; statusChangeDate?: string | null }) {
  return { statusChangeDate: null, ...overrides };
}

const VOIDED_AT = '2026-09-11T00:00:00.000Z';

// ---------------------------------------------------------------------------
// 1) El caso principal: mensualidad de un período POSTERIOR a la baja
// ---------------------------------------------------------------------------
test('mensualidad de un período posterior a la baja, sin ningún pago: se anula automáticamente', () => {
  // Baja efectiva el 15/07 — agosto es un período íntegramente posterior.
  const charge = monthlyCharge({
    id: 'c-agosto',
    studentId: 'qa-fin-inact-1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [student({ id: 'qa-fin-inact-1', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 1, 'se detecta y se anula el único caso ineligible');
  assertEqual(plan.actions[0].billingPeriod, '2026-08', 'identifica el período correcto');
  const voided = plan.updatedCharges.find((c) => c.id === 'c-agosto');
  assert(voided?.voidedAt === VOIDED_AT, 'queda anulado con la fecha real de la reparación');
  assert(!!voided?.voidReason, 'el motivo de anulación queda registrado (auditable)');
});

// ---------------------------------------------------------------------------
// 2) Deuda legítima: el propio período de la baja NUNCA se toca
// ---------------------------------------------------------------------------
test('mensualidad del propio período de la baja: deuda legítima, nunca se anula', () => {
  const charge = monthlyCharge({
    id: 'c-julio',
    studentId: 'qa-fin-inact-2',
    billingPeriod: '2026-07',
    dueDate: '2026-07-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [student({ id: 'qa-fin-inact-2', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'el período de la baja pudo tener actividad real antes de la fecha efectiva: nunca se toca');
  assert(plan.updatedCharges.find((c) => c.id === 'c-julio')?.voidedAt === null, 'julio permanece intacto');
});

// ---------------------------------------------------------------------------
// 3) Deuda legítima anterior a la baja: se conserva íntegra
// ---------------------------------------------------------------------------
test('mensualidad de un período muy anterior a la baja: deuda histórica legítima, nunca se toca', () => {
  const charge = monthlyCharge({
    id: 'c-mayo',
    studentId: 'qa-fin-inact-3',
    billingPeriod: '2026-05',
    dueDate: '2026-05-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [student({ id: 'qa-fin-inact-3', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'deuda de meses antes de la baja: legítima, se conserva íntegra en el historial');
  assert(plan.updatedCharges.find((c) => c.id === 'c-mayo')?.voidedAt === null, 'mayo permanece intacto');
});

// ---------------------------------------------------------------------------
// 4) Alumno activo: nunca se toca, sin importar el período
// ---------------------------------------------------------------------------
test('alumno activo: cualquier mensualidad, de cualquier período, nunca se repara', () => {
  const futureCharge = monthlyCharge({
    id: 'c-futuro',
    studentId: 'qa-fin-activo-1',
    billingPeriod: '2026-12',
    dueDate: '2026-12-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [futureCharge] };
  const students = [student({ id: 'qa-fin-activo-1', status: 'activo' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'un alumno activo siempre es facturable: nunca hay nada que reparar');
});

// ---------------------------------------------------------------------------
// 5) Sin fecha efectiva de baja demostrada: nunca se actúa sin certeza
// ---------------------------------------------------------------------------
test('alumno no activo SIN fecha de baja conocida (dato legado): nunca se actúa, sin importar el período', () => {
  const charge = monthlyCharge({
    id: 'c-legado',
    studentId: 'qa-fin-legado-1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [student({ id: 'qa-fin-legado-1', status: 'inactivo', statusChangeDate: null })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(
    plan.actions.length,
    0,
    'sin fecha efectiva demostrada no se puede afirmar con certeza que el período es ineligible: se deja intacto'
  );
  assertEqual(plan.needsReview.length, 0, 'tampoco se marca para revisión: simplemente no se evalúa sin la fecha');
});

// ---------------------------------------------------------------------------
// 6) Cargo con pago total o parcial: nunca se anula solo
// ---------------------------------------------------------------------------
test('mensualidad ineligible con pago TOTAL ya asignado: nunca se anula, queda para revisión manual; Payment/Allocation intactos', () => {
  const charge = monthlyCharge({
    id: 'c-pagada',
    studentId: 'qa-fin-inact-4',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
    originalAmount: 20000,
  });
  const pay = payment({ id: 'p1', studentId: 'qa-fin-inact-4', amount: 20000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c-pagada', studentId: 'qa-fin-inact-4', amount: 20000 });
  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const students = [student({ id: 'qa-fin-inact-4', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const paymentsSnapshot = JSON.stringify(state.payments);
  const allocationsSnapshot = JSON.stringify(state.allocations);

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'un cargo con pago real nunca se anula solo, aunque el período sea ineligible');
  assertEqual(plan.needsReview.length, 1, 'queda señalado para revisión manual');
  assertEqual(plan.needsReview[0].chargeId, 'c-pagada', 'identifica el cargo correcto');
  assert(plan.updatedCharges.find((c) => c.id === 'c-pagada')?.voidedAt === null, 'el cargo permanece intacto');
  assertEqual(JSON.stringify(state.payments), paymentsSnapshot, 'ningún Payment se modifica');
  assertEqual(JSON.stringify(state.allocations), allocationsSnapshot, 'ninguna asignación se modifica');
});

test('mensualidad ineligible con pago PARCIAL ya asignado: nunca se anula, queda para revisión manual', () => {
  const charge = monthlyCharge({
    id: 'c-parcial',
    studentId: 'qa-fin-inact-5',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
    originalAmount: 20000,
  });
  const pay = payment({ id: 'p1', studentId: 'qa-fin-inact-5', amount: 8000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c-parcial', studentId: 'qa-fin-inact-5', amount: 8000 });
  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const students = [student({ id: 'qa-fin-inact-5', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'un pago parcial ya es actividad real: nunca se anula solo');
  assertEqual(plan.needsReview.length, 1, 'requiere revisión manual');
});

// ---------------------------------------------------------------------------
// 7) Idempotencia
// ---------------------------------------------------------------------------
test('correr la reparación dos veces seguidas nunca vuelve a anular lo mismo (idempotente)', () => {
  const charge = monthlyCharge({
    id: 'c-agosto',
    studentId: 'qa-fin-inact-6',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [student({ id: 'qa-fin-inact-6', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const first = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(first.actions.length, 1, 'primera corrida: anula');

  const second = planInactiveStudentIneligibleChargeRepair({
    state: { ...state, charges: first.updatedCharges },
    students,
    voidedAt: '2026-09-11T00:05:00.000Z',
  });
  assertEqual(second.actions.length, 0, 'segunda corrida: ya no encuentra nada que reparar');
  assertEqual(
    first.updatedCharges.find((c) => c.id === 'c-agosto')?.voidedAt,
    VOIDED_AT,
    'el voidedAt original nunca se sobrescribe'
  );
});

// ---------------------------------------------------------------------------
// 8) Reactivación: una vez activo, ya no se toca ninguno de sus cargos
// ---------------------------------------------------------------------------
test('alumno reactivado (status vuelve a activo): la reparación deja de tocar sus cargos de inmediato, aunque el período siga siendo posterior a una baja vieja', () => {
  const charge = monthlyCharge({
    id: 'c-agosto',
    studentId: 'qa-fin-reactivado-1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  // Reactivado: status activo, statusChangeDate ya en null (mismo criterio
  // que `applyReactivation`/`restoreStudent`).
  const students = [student({ id: 'qa-fin-reactivado-1', status: 'activo', statusChangeDate: null })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'reactivado: vuelve a ser facturable de inmediato, nunca se repara');
});

// ---------------------------------------------------------------------------
// 9) Clase suelta y paquete: nunca se alteran (sólo mensualidades)
// ---------------------------------------------------------------------------
test('clase suelta (por_clase) de un alumno inactivo para un período posterior a la baja: no se toca (esta reparación es sólo de mensualidades)', () => {
  const perClass = perClassCharge({ id: 'c-clase', studentId: 'qa-fin-inact-7', dueDate: '2026-08-05' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [perClass] };
  const students = [student({ id: 'qa-fin-inact-7', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'esta reparación nunca toca cargos por_clase');
  assert(plan.updatedCharges.find((c) => c.id === 'c-clase')?.voidedAt === null, 'la clase suelta permanece intacta');
});

// ---------------------------------------------------------------------------
// 10) Pausado y archivado: mismo criterio que inactivo
// ---------------------------------------------------------------------------
test('alumno pausado y alumno archivado: mismo criterio que inactivo — período posterior a la baja se repara igual', () => {
  const pausedCharge = monthlyCharge({
    id: 'c-pausado',
    studentId: 'qa-fin-pausado-1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const archivedCharge = monthlyCharge({
    id: 'c-archivado',
    studentId: 'qa-fin-archivado-1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [pausedCharge, archivedCharge] };
  const students = [
    student({ id: 'qa-fin-pausado-1', status: 'pausado', statusChangeDate: '2026-07-15' }),
    student({ id: 'qa-fin-archivado-1', status: 'archivado', statusChangeDate: '2026-07-15' }),
  ];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 2, 'pausado y archivado se reparan exactamente igual que inactivo');
});

// ---------------------------------------------------------------------------
// 11) Nunca borra, nunca duplica, nunca toca Payment/PaymentAllocation
// ---------------------------------------------------------------------------
test('reparar nunca genera un cargo nuevo (sólo anula) ni cambia la cantidad total de cargos', () => {
  const ineligible = monthlyCharge({
    id: 'c-agosto',
    studentId: 'qa-fin-inact-8',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const legit = monthlyCharge({
    id: 'c-julio',
    studentId: 'qa-fin-inact-8',
    billingPeriod: '2026-07',
    dueDate: '2026-07-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [ineligible, legit] };
  const students = [student({ id: 'qa-fin-inact-8', status: 'inactivo', statusChangeDate: '2026-07-15' })];

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students, voidedAt: VOIDED_AT });
  assertEqual(plan.updatedCharges.length, 2, 'la cantidad total de cargos nunca cambia: sólo se anula, nunca se crea ni se borra');
  assertEqual(plan.actions.length, 1, 'sólo el período posterior a la baja se anula');
});

test('sin datos del alumno (ausente de `students`): nunca se asume nada, el cargo se deja intacto', () => {
  const charge = monthlyCharge({
    id: 'c-sin-datos',
    studentId: 'qa-fin-sin-datos',
    billingPeriod: '2026-08',
    dueDate: '2026-08-10',
  });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };

  const plan = planInactiveStudentIneligibleChargeRepair({ state, students: [], voidedAt: VOIDED_AT });
  assertEqual(plan.actions.length, 0, 'sin datos del alumno, nunca se actúa sobre su cargo');
});
