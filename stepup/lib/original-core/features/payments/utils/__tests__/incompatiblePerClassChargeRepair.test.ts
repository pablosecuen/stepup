// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/incompatiblePerClassChargeRepair.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
 * contradictorios "Agosto pendiente" + "Pago vencido" en la lista de
 * Alumnos): pruebas de la reparación general de cargos `por_clase`
 * incompatibles con el plan mensual vigente del alumno
 * (`planIncompatiblePerClassChargeRepair`/`analyzeFinancialConsistency`,
 * `financialReconciliation.ts`), más los casos de frontera de fecha
 * pedidos explícitamente (días 1/9/10/11, huso Buenos Aires).
 *
 * Identidad ficticia aislada: todos los `studentId` usan el prefijo
 * `qa-fin-` — nunca las cuentas reales de Joaquín ni Lara Gómez Sand.
 */
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { analyzeFinancialConsistency, planIncompatiblePerClassChargeRepair } from '../financialReconciliation.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { determineMonthlyDueStage } from '../paymentDueStage.ts';
import { resolveStudentMonthlyCardStatus, summarizeOverdueDebt } from '../monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE } from '../paymentDates.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
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

const MONTHLY_PLAN: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 1 };
const PER_CLASS_PLAN: StudentBillingPlan = { type: 'per_class', amount: 9000 };

// ---------------------------------------------------------------------------
// 1) Días 1, 9, 10 y 11 — la mensualidad está en término del 1 al 10
//    inclusive, la primera mora arranca el 11.
// ---------------------------------------------------------------------------
test('1) mensualidad: días 1, 9 y 10 están en término; el día 11 arranca la primera mora', () => {
  assertEqual(determineMonthlyDueStage('2026-08-01', '2026-08-01'), 'on_time', 'día 1: en término');
  assertEqual(determineMonthlyDueStage('2026-08-01', '2026-08-09'), 'on_time', 'día 9: en término');
  assertEqual(determineMonthlyDueStage('2026-08-01', '2026-08-10'), 'on_time', 'día 10: TODAVÍA en término (inclusive)');
  assertEqual(determineMonthlyDueStage('2026-08-01', '2026-08-11'), 'first_late', 'día 11: arranca la primera mora');
});

// Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidades
// "Mes vencido" al comenzar el mes): usa un plan con `dueDay: 10` (no
// `MONTHLY_PLAN`, que fija `dueDay: 1` para el resto de los casos de este
// archivo, ajenos a esta fecha) — el vencimiento REAL de la mensualidad
// ahora sí gobierna `resolveStudentMonthlyCardStatus` (`resolveMonthlyDueDateUrgency`),
// separado de la etapa de recargo (`determineMonthlyDueStage`, probada en el
// caso "1)" de arriba, sin cambios).
test('1b) resolveStudentMonthlyCardStatus: "Agosto pendiente" los días 1-10 (vencimiento real el 10), "Primer vencimiento" al décimo día de mora', () => {
  const planDueDay10: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 10 };
  ['2026-08-01', '2026-08-09', '2026-08-10'].forEach((evaluationDate) => {
    const status = resolveStudentMonthlyCardStatus({
      plan: planDueDay10,
      charges: [],
      chargeStates: [],
      evaluationDate,
    });
    assertEqual(status.status, 'pendiente_en_termino', `${evaluationDate}: agosto sigue pendiente en término`);
    assertEqual(status.label, 'Agosto pendiente', `${evaluationDate}: texto exacto`);
  });

  const dueDate = '2026-08-10';
  const charge = monthlyCharge({ id: 'c1', studentId: 'qa-fin-s1', billingPeriod: '2026-08', dueDate });
  const state20 = calculateChargeState({ charge, allocations: [], payments: [], adjustments: [], evaluationDate: '2026-08-20' });
  const status20 = resolveStudentMonthlyCardStatus({
    plan: planDueDay10,
    charges: [charge],
    chargeStates: [state20],
    evaluationDate: '2026-08-20',
  });
  assertEqual(status20.status, 'vencido_sin_recargo', 'con vencimiento el 10, el día 20 (10 días de mora) pasa a "Mes vencido" genérico, sin recargos automáticos');
});

// ---------------------------------------------------------------------------
// 2) Zona horaria Buenos Aires cerca de medianoche — nunca UTC.
// ---------------------------------------------------------------------------
test('2) huso Buenos Aires cerca de medianoche: 10/08 23:50 UTC todavía es 10/08 en Buenos Aires (no cruzó a UTC-3)', () => {
  // 2026-08-10T23:50:00Z es, en America/Argentina/Buenos_Aires (UTC-3),
  // 2026-08-10 20:50 — el mismo día calendario, nunca 11/08.
  const dateKey = localDateKeyInTimeZone(new Date('2026-08-10T23:50:00.000Z'), ARGENTINA_TIME_ZONE);
  assertEqual(dateKey, '2026-08-10', 'a las 23:50 UTC todavía es 10/08 en Buenos Aires');
});

test('2b) huso Buenos Aires cerca de medianoche: 11/08 02:59 UTC ya es 10/08 en Buenos Aires (UTC-3 todavía no cruzó la medianoche local)', () => {
  const dateKey = localDateKeyInTimeZone(new Date('2026-08-11T02:59:00.000Z'), ARGENTINA_TIME_ZONE);
  assertEqual(dateKey, '2026-08-10', 'las 02:59 UTC del 11/08 son 23:59 del 10/08 en Buenos Aires (UTC-3)');
});

test('2c) huso Buenos Aires cerca de medianoche: 11/08 03:00 UTC ya es 11/08 00:00 en Buenos Aires (cruzó la medianoche local)', () => {
  const dateKey = localDateKeyInTimeZone(new Date('2026-08-11T03:00:00.000Z'), ARGENTINA_TIME_ZONE);
  assertEqual(dateKey, '2026-08-11', 'las 03:00 UTC son exactamente las 00:00 del 11/08 en Buenos Aires');
});

// ---------------------------------------------------------------------------
// 3) Mensual sin deudas anteriores
// ---------------------------------------------------------------------------
test('3) alumno mensual sin ninguna deuda anterior: cero hallazgos, cero acciones de reparación', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 'qa-fin-s1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];
  const resolvePlan = () => MONTHLY_PLAN;

  const report = analyzeFinancialConsistency({ state, students, resolvePlan, evaluationDate: '2026-08-10' });
  assertEqual(report.countsByCategory.per_class_charge_incompatible_with_monthly_plan, 0, 'sin cargos por clase, sin hallazgo');

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nada que reparar');
});

// ---------------------------------------------------------------------------
// 4) Mensual con deuda de julio (deuda histórica LEGÍTIMA — nunca se toca)
// ---------------------------------------------------------------------------
test('4) mensual con una mensualidad de julio impaga: es deuda histórica legítima, la reparación de cargos por clase no la toca', () => {
  const july = monthlyCharge({ id: 'c-jul', studentId: 'qa-fin-s1', billingPeriod: '2026-07', dueDate: '2026-07-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [july] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'la reparación es sólo sobre cargos por clase; una mensualidad vieja nunca se anula');
  assert(plan.updatedCharges.find((c) => c.id === 'c-jul')?.voidedAt === null, 'julio sigue intacto');
});

test('4b) por_clase de un período ANTERIOR al actual, alumno ya mensual: deuda histórica legítima, nunca se anula automáticamente', () => {
  const oldPerClass = perClassCharge({ id: 'c-jun', studentId: 'qa-fin-s1', dueDate: '2026-06-15' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [oldPerClass] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const report = analyzeFinancialConsistency({ state, students, resolvePlan: () => MONTHLY_PLAN, evaluationDate: '2026-08-10' });
  assertEqual(
    report.countsByCategory.per_class_charge_incompatible_with_monthly_plan,
    0,
    'un cargo por clase de un período ANTERIOR al actual nunca se marca como incompatible: puede ser legítimo'
  );

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nunca se anula sin certeza');
  assert(plan.updatedCharges.find((c) => c.id === 'c-jun')?.voidedAt === null, 'la deuda histórica de junio permanece intacta');
});

// ---------------------------------------------------------------------------
// 5) Alumno legítimamente cobrado por clase (plan vigente = per_class)
// ---------------------------------------------------------------------------
test('5) alumno con plan vigente "por clase": un cargo por clase del período actual es legítimo, nunca se toca', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-07' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const report = analyzeFinancialConsistency({ state, students, resolvePlan: () => PER_CLASS_PLAN, evaluationDate: '2026-08-10' });
  assertEqual(report.countsByCategory.per_class_charge_incompatible_with_monthly_plan, 0, 'con plan por_clase vigente, jamás es un hallazgo');

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => PER_CLASS_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nunca se anula un cargo legítimo por clase');
});

// ---------------------------------------------------------------------------
// 6) Cambio de clase suelta (por_clase) a mensual — EL CASO REPORTADO
// ---------------------------------------------------------------------------
test('6) cambio de plan por_clase -> mensual: un cargo por clase del período actual/futuro, sin pagos, se anula automáticamente', () => {
  // Reproduce la forma exacta del caso reportado (con datos ficticios,
  // aislados y parametrizados — nunca el nombre/id/importe/fecha reales):
  // un cargo por_clase con vencimiento DENTRO del período actual, para un
  // alumno cuyo plan vigente YA es mensual, coexistiendo con la
  // mensualidad "pendiente en término" del mismo período.
  const residual = perClassCharge({ id: 'c-residual', studentId: 'qa-fin-s1', dueDate: '2026-08-07', originalAmount: 185000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [residual] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const report = analyzeFinancialConsistency({ state, students, resolvePlan: () => MONTHLY_PLAN, evaluationDate: '2026-08-10' });
  assertEqual(report.countsByCategory.per_class_charge_incompatible_with_monthly_plan, 1, 'se detecta exactamente el caso reportado');

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T12:00:00.000Z',
  });
  assertEqual(plan.actions.length, 1, 'se anula automáticamente');
  const voided = plan.updatedCharges.find((c) => c.id === 'c-residual');
  assert(voided?.voidedAt === '2026-08-10T12:00:00.000Z', 'queda anulado con la fecha real de la reparación');
  assert(!!voided?.voidReason, 'el motivo de anulación queda registrado (auditable)');

  // Tras la anulación, el resumen financiero (misma fuente que alimenta
  // badges/perfil/Home/Centro de cobros) ya no lo cuenta como vencido.
  const summary = buildStudentPaymentsSummary({
    studentId: 'qa-fin-s1',
    state: { ...state, charges: plan.updatedCharges },
    evaluationDate: '2026-08-10',
  });
  assertEqual(summary.overdueBalance, 0, 'sin saldo vencido: el badge "Pago vencido" desaparece');
  const debt = summarizeOverdueDebt({ charges: summary.charges, chargeStates: summary.chargeStates });
  assertEqual(debt.label, null, 'sin ninguna obligación vencida visible');
});

// ---------------------------------------------------------------------------
// 7) Cargos residuales CON y SIN pagos asignados
// ---------------------------------------------------------------------------
test('7a) cargo residual SIN pagos asignados: se anula automáticamente', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 1, 'se anula');
  assertEqual(plan.needsReview.length, 0, 'no necesita revisión: no tenía ningún pago');
});

test('7b) cargo residual CON un pago ya asignado: nunca se anula solo, queda marcado para revisión manual', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05', originalAmount: 9000 });
  const pay = payment({ id: 'p1', studentId: 'qa-fin-s1', amount: 9000, paidAt: '2026-08-06' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 'qa-fin-s1', amount: 9000 });
  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'nunca se anula un cargo con pagos reales asignados');
  assertEqual(plan.needsReview.length, 1, 'queda señalado para revisión manual');
  assertEqual(plan.needsReview[0].chargeId, 'c1', 'identifica el cargo correcto');

  const stillActive = plan.updatedCharges.find((c) => c.id === 'c1');
  assert(stillActive?.voidedAt === null, 'el cargo y su pago permanecen intactos: nunca se borra información');
  assertEqual(state.payments[0].voidedAt, null, 'el pago real nunca se toca');
});

// ---------------------------------------------------------------------------
// 8) Pago parcial y pago total
// ---------------------------------------------------------------------------
test('8a) cargo residual con pago PARCIAL: no se anula (tiene actividad real), queda para revisión', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05', originalAmount: 9000 });
  const pay = payment({ id: 'p1', studentId: 'qa-fin-s1', amount: 4000, paidAt: '2026-08-06' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 'qa-fin-s1', amount: 4000 });
  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'un pago parcial ya es actividad real: nunca se anula solo');
  assertEqual(plan.needsReview.length, 1, 'requiere revisión manual');
});

test('8b) cargo residual saldado por completo (pago total): nunca se anula, sigue como historial de un pago real', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05', originalAmount: 9000 });
  const pay = payment({ id: 'p1', studentId: 'qa-fin-s1', amount: 9000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 'qa-fin-s1', amount: 9000 });
  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'un cargo ya saldado nunca se anula: borraría el historial de un pago real');

  const summary = buildStudentPaymentsSummary({ studentId: 'qa-fin-s1', state, evaluationDate: '2026-08-10' });
  assertEqual(summary.overdueBalance, 0, 'de todos modos, saldado, nunca cuenta como vencido');
});

// ---------------------------------------------------------------------------
// 9) Anulación y re-registro — idempotencia
// ---------------------------------------------------------------------------
test('9) correr la reparación dos veces seguidas nunca vuelve a anular lo mismo (idempotente)', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const first = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(first.actions.length, 1, 'primera corrida: anula');

  const second = planIncompatiblePerClassChargeRepair({
    state: { ...state, charges: first.updatedCharges },
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:05:00.000Z',
  });
  assertEqual(second.actions.length, 0, 'segunda corrida: ya no encuentra nada que reparar');
  assertEqual(
    first.updatedCharges.find((c) => c.id === 'c1')?.voidedAt,
    '2026-08-10T00:00:00.000Z',
    'el voidedAt original nunca se sobrescribe'
  );
});

test('9b) re-registrar una clase nueva (otro savedLessonId) tras anular la vieja: la nueva no hereda la anulación', () => {
  const oldCharge = perClassCharge({ id: 'c-viejo', studentId: 'qa-fin-s1', dueDate: '2026-08-05', voidedAt: '2026-08-06T00:00:00.000Z', voidReason: 'Reparación automática' });
  const newCharge = perClassCharge({ id: 'c-nuevo', studentId: 'qa-fin-s1', dueDate: '2026-08-12' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [oldCharge, newCharge] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 1, 'sólo actúa sobre el cargo activo nuevo, nunca sobre el ya anulado');
  assertEqual(plan.actions[0].voidedChargeId, 'c-nuevo', 'es el cargo recién creado, no el viejo (ya anulado)');
});

// ---------------------------------------------------------------------------
// 10) Actualización inmediata de todas las pantallas (misma fuente única)
// ---------------------------------------------------------------------------
test('10) tras anular, el mismo resumen financiero puro que alimenta lista/perfil/Home/Cobros/recordatorios refleja el cambio sin ningún paso extra', () => {
  const residual = perClassCharge({ id: 'c-residual', studentId: 'qa-fin-s1', dueDate: '2026-08-07' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [residual] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const before = buildStudentPaymentsSummary({ studentId: 'qa-fin-s1', state, evaluationDate: '2026-08-10' });
  assertEqual(before.overdueBalance > 0, true, 'antes de reparar: el badge mostraría "vencido"');

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  const after = buildStudentPaymentsSummary({
    studentId: 'qa-fin-s1',
    state: { ...state, charges: plan.updatedCharges },
    evaluationDate: '2026-08-10',
  });
  assertEqual(after.overdueBalance, 0, 'inmediatamente después: ya no hay saldo vencido, sin recargar nada aparte');
});

// ---------------------------------------------------------------------------
// 12) Ausencia de cargos y recargos duplicados
// ---------------------------------------------------------------------------
test('12) reparar nunca genera un cargo nuevo (sólo anula) ni duplica ninguno existente', () => {
  const residual = perClassCharge({ id: 'c-residual', studentId: 'qa-fin-s1', dueDate: '2026-08-07' });
  const monthly = monthlyCharge({ id: 'c-mensual', studentId: 'qa-fin-s1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [residual, monthly] };
  const students = [{ id: 'qa-fin-s1', status: 'activo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.updatedCharges.length, 2, 'la cantidad total de cargos nunca cambia: sólo se anula, nunca se crea ni se borra');
});

// ---------------------------------------------------------------------------
// Alumno pausado/inactivo: la reparación automática nunca actúa sobre él
// (mismo criterio ya establecido por el resto de `analyzeFinancialConsistency`).
// ---------------------------------------------------------------------------
test('alumno inactivo con un cargo por clase del período actual: la reparación automática no lo toca', () => {
  const charge = perClassCharge({ id: 'c1', studentId: 'qa-fin-s1', dueDate: '2026-08-05' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [charge] };
  const students = [{ id: 'qa-fin-s1', status: 'inactivo' as const }];

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan: () => MONTHLY_PLAN,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 0, 'un alumno inactivo nunca se repara automáticamente');
});

// ---------------------------------------------------------------------------
// Grupal: un cargo por clase incompatible dentro de una clase grupal, con
// otro alumno del mismo grupo en plan por_clase legítimo — cada alumno se
// evalúa de forma independiente.
// ---------------------------------------------------------------------------
test('clase grupal: cada alumno se repara de forma independiente según SU propio plan vigente', () => {
  const monthlyStudentCharge = perClassCharge({ id: 'c-mensual-alumno', studentId: 'qa-fin-grupal-mensual', dueDate: '2026-08-07' });
  const perClassStudentCharge = perClassCharge({ id: 'c-porclase-alumno', studentId: 'qa-fin-grupal-porclase', dueDate: '2026-08-07' });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [monthlyStudentCharge, perClassStudentCharge] };
  const students = [
    { id: 'qa-fin-grupal-mensual', status: 'activo' as const },
    { id: 'qa-fin-grupal-porclase', status: 'activo' as const },
  ];
  const resolvePlan = (studentId: string) => (studentId === 'qa-fin-grupal-mensual' ? MONTHLY_PLAN : PER_CLASS_PLAN);

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students,
    resolvePlan,
    evaluationDate: '2026-08-10',
    voidedAt: '2026-08-10T00:00:00.000Z',
  });
  assertEqual(plan.actions.length, 1, 'sólo se anula el cargo del alumno mensual de la misma clase grupal');
  assertEqual(plan.actions[0].studentId, 'qa-fin-grupal-mensual', 'nunca toca al compañero de grupo que sigue pagando por clase');
});
