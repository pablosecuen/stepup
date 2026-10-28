// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/financialReconciliation.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { analyzeFinancialConsistency, planDuplicateMonthlyChargeRepair, planMonthlyAmountReconciliationRepair } from '../financialReconciliation.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual, PARTE 8): pruebas del analizador global de sólo
 * lectura y de la reparación automática de duplicados TÉCNICOS (nunca
 * ambiguos).
 */

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function monthlyCharge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; billingPeriod: string; dueDate: string }): PaymentCharge {
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

function allocation(overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string; amount: number }): PaymentAllocation {
  return { ...overrides };
}

const monthlyPlan: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 1 };

test('sin ninguna colección: reporte vacío, cero inconsistencias', () => {
  const report = analyzeFinancialConsistency({
    state: emptyState(),
    students: [],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.totalFindings, 0, 'sin datos, nada que reportar');
});

test('plan_amount_diverges_from_charge: cargo del mes con originalAmount distinto al plan efectivo', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', originalAmount: 185000 });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 192000, dueDay: 1 }),
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.plan_amount_diverges_from_charge, 1, 'detecta exactamente el caso demostrado (185k vs 192k)');
  assertEqual(report.findings[0].studentId, 's1', 'conserva el studentId internamente (nunca se lo muestra a la profesora)');
});

test('sin divergencia: plan y cargo coinciden, cero hallazgos', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', originalAmount: 192000 });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => monthlyPlan.type === 'monthly' ? { type: 'monthly', amount: 192000, dueDay: 1 } : null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.plan_amount_diverges_from_charge, 0, 'coinciden: sin hallazgo');
});

test('pendingAmount vigente ya alcanzado: resolveEffectiveMonthlyAmount se usa, nunca plan.amount crudo', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 's1', billingPeriod: '2026-09', dueDate: '2026-09-01', originalAmount: 192000 });
  const plan: StudentBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, pendingAmount: 192000, pendingAmountEffectiveFrom: '2026-09' };
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => plan,
    evaluationDate: '2026-09-05',
  });
  assertEqual(report.countsByCategory.plan_amount_diverges_from_charge, 0, 'el pendingAmount ya vigente coincide con el cargo — sin falso positivo');
});

test('monthly_student_without_current_charge: alumno mensual activo sin cargo, ya fuera del margen de generación', () => {
  const report = analyzeFinancialConsistency({
    state: emptyState(),
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => monthlyPlan,
    evaluationDate: '2026-08-15', // día 15: ya debería existir el cargo de agosto
  });
  assertEqual(report.countsByCategory.monthly_student_without_current_charge, 1, 'detecta el alumno sin cargo generado');
});

test('monthly_student_without_current_charge: antes del vencimiento real sin cargo todavía NO es un hallazgo (generación normal)', () => {
  // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidades
  // "Mes vencido" al comenzar el mes): usa un plan con `dueDay: 10` (no
  // `monthlyPlan`, que fija `dueDay: 1` para el resto de los casos de este
  // archivo) — el margen normal de generación ahora se mide contra el
  // vencimiento REAL configurado, nunca un día fijo asumido.
  const report = analyzeFinancialConsistency({
    state: emptyState(),
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 20000, dueDay: 10 }),
    evaluationDate: '2026-08-05', // en término: todavía faltan más de 3 días para el vencimiento real (10)
  });
  assertEqual(report.countsByCategory.monthly_student_without_current_charge, 0, 'día 5, vencimiento el 10: todavía en el margen normal, no es un hallazgo');
});

test('duplicate_monthly_charge: dos cargos vigentes para el mismo alumno+período+tipo, ids distintos', () => {
  const chargeA = monthlyCharge({ id: 'legacy_a', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const chargeB = monthlyCharge({ id: 'legacy_b', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [chargeA, chargeB] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.duplicate_monthly_charge, 1, 'un único grupo duplicado detectado (2 cargos)');
});

test('charge_without_billing_period: cargo mensual sin billingPeriod', () => {
  const charge: PaymentCharge = {
    id: 'c1',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 20000,
    currency: 'ARS',
    dueDate: '2026-08-01',
    createdAt: '2026-08-01T09:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.charge_without_billing_period, 1, 'un cargo mensual sin billingPeriod es siempre un hallazgo');
});

test('charge_without_student / payment_without_student: referencias a alumnos inexistentes', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 'fantasma', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const orphanPayment = payment({ id: 'p1', studentId: 'otro_fantasma', amount: 1000, paidAt: '2026-08-01' });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge], payments: [orphanPayment] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.charge_without_student, 1, 'cargo de un alumno que no existe');
  assertEqual(report.countsByCategory.payment_without_student, 1, 'pago de un alumno que no existe');
});

test('allocation_without_payment / allocation_without_charge: asignaciones huérfanas', () => {
  const orphan1 = allocation({ id: 'a1', paymentId: 'no_existe', chargeId: 'no_existe', studentId: 's1', amount: 1000 });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), allocations: [orphan1] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.allocation_without_payment, 1, 'asignación sin pago real');
  assertEqual(report.countsByCategory.allocation_without_charge, 1, 'la misma asignación también sin cargo real');
});

test('negative_balance: una asignación deja el cargo con saldo negativo (crédito)', () => {
  const charge = monthlyCharge({ id: 'c1', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', originalAmount: 100000 });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 150000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 150000 });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge], payments: [pay], allocations: [alloc] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.negative_balance, 1, 'saldo negativo real detectado (150k asignados contra un cargo de 100k)');
});

test('voided_charge_with_active_allocations / voided_payment_with_active_allocations: asignaciones huérfanas por anulación', () => {
  const voidedCharge = monthlyCharge({ id: 'c1', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', voidedAt: '2026-08-10T00:00:00.000Z', voidReason: 'error' });
  const voidedPayment = payment({ id: 'p1', studentId: 's1', amount: 20000, paidAt: '2026-08-05', voidedAt: '2026-08-10T00:00:00.000Z', voidReason: 'error' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 20000 });
  const report = analyzeFinancialConsistency({
    state: { charges: [voidedCharge], payments: [voidedPayment], allocations: [alloc], adjustments: [] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => null,
    evaluationDate: '2026-08-15',
  });
  assertEqual(report.countsByCategory.voided_charge_with_active_allocations, 1, 'la asignación sigue apuntando al cargo ya anulado');
  assertEqual(report.countsByCategory.voided_payment_with_active_allocations, 1, 'y también al pago ya anulado');
});

// ---------------------------------------------------------------------------
// Reparación automática de duplicados TÉCNICOS (nunca ambiguos)
// ---------------------------------------------------------------------------

test('duplicado técnico sin ambigüedad (uno con pagos, el otro vacío): se anula sólo el vacío', () => {
  const withPayment = monthlyCharge({ id: 'real', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', createdAt: '2026-08-01T09:00:00.000Z' });
  const empty = monthlyCharge({ id: 'fantasma', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', createdAt: '2026-08-01T09:00:01.000Z' });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 20000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'real', studentId: 's1', amount: 20000 });

  const plan = planDuplicateMonthlyChargeRepair({
    state: { charges: [withPayment, empty], payments: [pay], allocations: [alloc], adjustments: [] },
    voidedAt: '2026-08-15T00:00:00.000Z',
  });

  assertEqual(plan.actions.length, 1, 'una acción de reparación');
  assertEqual(plan.actions[0].keptChargeId, 'real', 'conserva el que tiene actividad real');
  assertEqual(plan.actions[0].voidedChargeIds.length, 1, 'un único cargo anulado');
  assertEqual(plan.actions[0].voidedChargeIds[0], 'fantasma', 'anula el vacío, nunca el que tiene pagos');
  assertEqual(plan.ambiguousGroups.length, 0, 'no es un caso ambiguo');

  const kept = plan.updatedCharges.find((c) => c.id === 'real')!;
  const voided = plan.updatedCharges.find((c) => c.id === 'fantasma')!;
  assertEqual(kept.voidedAt, null, 'el cargo real nunca se toca');
  assert(voided.voidedAt !== null, 'el duplicado vacío queda anulado, nunca borrado');
  assertEqual(voided.originalAmount, 20000, 'el cargo anulado conserva sus datos originales — nunca se borra información');
});

test('duplicado sin pagos en ninguno de los dos: se conserva el más antiguo, se anula el más nuevo', () => {
  const older = monthlyCharge({ id: 'first', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', createdAt: '2026-08-01T09:00:00.000Z' });
  const newer = monthlyCharge({ id: 'second', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01', createdAt: '2026-08-01T09:05:00.000Z' });

  const plan = planDuplicateMonthlyChargeRepair({
    state: { charges: [older, newer], payments: [], allocations: [], adjustments: [] },
    voidedAt: '2026-08-15T00:00:00.000Z',
  });

  assertEqual(plan.actions[0].keptChargeId, 'first', 'sin pagos en ninguno: se conserva el más antiguo');
  assertEqual(plan.actions[0].voidedChargeIds[0], 'second', 'se anula el más nuevo');
});

test('duplicado AMBIGUO (ambos con pagos reales): nunca se repara solo, queda reportado', () => {
  const chargeA = monthlyCharge({ id: 'a', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const chargeB = monthlyCharge({ id: 'b', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const payA = payment({ id: 'pa', studentId: 's1', amount: 10000, paidAt: '2026-08-05' });
  const payB = payment({ id: 'pb', studentId: 's1', amount: 10000, paidAt: '2026-08-06' });
  const allocA = allocation({ id: 'aa', paymentId: 'pa', chargeId: 'a', studentId: 's1', amount: 10000 });
  const allocB = allocation({ id: 'ab', paymentId: 'pb', chargeId: 'b', studentId: 's1', amount: 10000 });

  const plan = planDuplicateMonthlyChargeRepair({
    state: { charges: [chargeA, chargeB], payments: [payA, payB], allocations: [allocA, allocB], adjustments: [] },
    voidedAt: '2026-08-15T00:00:00.000Z',
  });

  assertEqual(plan.actions.length, 0, 'nunca decide sola cuál de las dos es la "real"');
  assertEqual(plan.ambiguousGroups.length, 1, 'queda reportado como ambiguo para revisión manual');
  assert(
    plan.updatedCharges.every((c) => c.voidedAt === null),
    'ningún cargo del grupo ambiguo se toca'
  );
});

test('reparar duplicados es idempotente: correrlo sobre el resultado ya reparado no encuentra nada más', () => {
  const withPayment = monthlyCharge({ id: 'real', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const empty = monthlyCharge({ id: 'fantasma', studentId: 's1', billingPeriod: '2026-08', dueDate: '2026-08-01' });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 20000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'real', studentId: 's1', amount: 20000 });

  const firstRun = planDuplicateMonthlyChargeRepair({
    state: { charges: [withPayment, empty], payments: [pay], allocations: [alloc], adjustments: [] },
    voidedAt: '2026-08-15T00:00:00.000Z',
  });
  const secondRun = planDuplicateMonthlyChargeRepair({
    state: { charges: firstRun.updatedCharges, payments: [pay], allocations: [alloc], adjustments: [] },
    voidedAt: '2026-08-16T00:00:00.000Z',
  });

  assertEqual(secondRun.actions.length, 0, 'ya reparado: la segunda corrida no encuentra nada que hacer');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
// mensual y obligación desincronizadas): reparación de datos ya
// desincronizados por el gap real de `planMonthlyAmountChange` — un cargo
// mensual vigente (identidad semántica, cualquier id real, determinístico o
// no) cuyo importe quedó divergiendo del plan. Nunca usa los importes del
// reporte real (160.000/168.000/73.500/70.000) salvo en el caso de
// aceptación explícito, que sí los reproduce a propósito.
// ---------------------------------------------------------------------------

test('reconciliación: cargo abierto SIN pagos con id legacy (no generado por buildMonthlyChargeId) — se sincroniza directo con el importe del plan', () => {
  const legacyCharge = monthlyCharge({
    id: 'obligacion_vieja_de_otra_version_12345',
    studentId: 'qa_finanzas_reconc_1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 41000,
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [legacyCharge] },
    students: [{ id: 'qa_finanzas_reconc_1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 63500, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 1, 'una única acción de sincronización');
  assertEqual(plan.actions[0].chargeId, legacyCharge.id, 'usa el id real del cargo, nunca uno inventado');
  assertEqual(plan.actions[0].previousAmount, 41000, 'conserva el importe anterior para auditoría');
  assertEqual(plan.actions[0].newAmount, 63500, 'sincroniza con el importe efectivo del plan');
  const updated = plan.updatedCharges.find((c) => c.id === legacyCharge.id)!;
  assertEqual(updated.originalAmount, 63500, 'el cargo queda con el importe corregido');
  assertEqual(plan.needsReview.length, 0, 'sin ambigüedad, no requiere revisión manual');
});

test('reconciliación: pago parcial y el plan es MAYOR a lo ya asignado — se sincroniza, el saldo se recalcula contra el nuevo importe', () => {
  const charge = monthlyCharge({
    id: 'legacy_partial',
    studentId: 'qa_finanzas_reconc_2',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 50000,
  });
  const pay = payment({ id: 'p1', studentId: 'qa_finanzas_reconc_2', amount: 30000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'legacy_partial', studentId: 'qa_finanzas_reconc_2', amount: 30000 });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] },
    students: [{ id: 'qa_finanzas_reconc_2', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 1, 'el pago parcial no bloquea la sincronización cuando el plan es mayor a lo ya asignado');
  const updated = plan.updatedCharges.find((c) => c.id === 'legacy_partial')!;
  assertEqual(updated.originalAmount, 80000, 'se sincroniza con el importe del plan');
  assertEqual(plan.needsReview.length, 0, 'sin ambigüedad');
});

test('reconciliación: pago parcial y el plan sería MENOR a lo ya asignado — nunca se toca solo, queda en needsReview', () => {
  const charge = monthlyCharge({
    id: 'legacy_would_shrink',
    studentId: 'qa_finanzas_reconc_3',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 90000,
  });
  const pay = payment({ id: 'p1', studentId: 'qa_finanzas_reconc_3', amount: 60000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'legacy_would_shrink', studentId: 'qa_finanzas_reconc_3', amount: 60000 });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] },
    students: [{ id: 'qa_finanzas_reconc_3', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 45000, dueDay: 1 }), // menor a los 60.000 ya asignados
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'nunca inventa saldo a favor sincronizando solo');
  assertEqual(plan.needsReview.length, 1, 'queda reportado para corrección manual explícita');
  assertEqual(plan.needsReview[0].alreadyAllocated, 60000, 'informa lo ya asignado');
  assertEqual(plan.needsReview[0].planAmount, 45000, 'informa el importe del plan que generaría el conflicto');
  const untouched = plan.updatedCharges.find((c) => c.id === 'legacy_would_shrink')!;
  assertEqual(untouched.originalAmount, 90000, 'el cargo queda exactamente como estaba, sin mutación silenciosa');
});

test('reconciliación: período ya SALDADO por completo — nunca se reescribe historia financiera, aunque el plan diverja', () => {
  const charge = monthlyCharge({
    id: 'legacy_settled',
    studentId: 'qa_finanzas_reconc_4',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 55000,
  });
  const pay = payment({ id: 'p1', studentId: 'qa_finanzas_reconc_4', amount: 55000, paidAt: '2026-08-05' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: 'legacy_settled', studentId: 'qa_finanzas_reconc_4', amount: 55000 });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] },
    students: [{ id: 'qa_finanzas_reconc_4', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 70000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'un período saldado nunca se reescribe silenciosamente');
  assertEqual(plan.needsReview.length, 0, 'tampoco es un caso de revisión: está correctamente cerrado');
  const untouched = plan.updatedCharges.find((c) => c.id === 'legacy_settled')!;
  assertEqual(untouched.originalAmount, 55000, 'conserva el importe histórico real que efectivamente se pagó');
});

test('reconciliación: cargo ANULADO — nunca se encuentra como vigente, nunca se toca', () => {
  const voided = monthlyCharge({
    id: 'legacy_voided',
    studentId: 'qa_finanzas_reconc_5',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 30000,
    voidedAt: '2026-08-10T00:00:00.000Z',
    voidReason: 'anulado manualmente',
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [voided] },
    students: [{ id: 'qa_finanzas_reconc_5', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 99000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'un cargo anulado nunca se considera "vigente" para reconciliar');
  const untouched = plan.updatedCharges.find((c) => c.id === 'legacy_voided')!;
  assertEqual(untouched.originalAmount, 30000, 'el cargo anulado queda intacto, nunca se revive ni se le cambia el importe');
});

test('reconciliación: cargo de un PERÍODO ANTERIOR al evaluado — nunca se toca', () => {
  const julyCharge = monthlyCharge({
    id: 'legacy_july',
    studentId: 'qa_finanzas_reconc_6',
    billingPeriod: '2026-07',
    dueDate: '2026-07-01',
    originalAmount: 40000,
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [julyCharge] },
    students: [{ id: 'qa_finanzas_reconc_6', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 55000, dueDay: 1 }),
    evaluationDate: '2026-08-20', // evaluado en agosto: julio ya es un período anterior
  });
  assertEqual(plan.actions.length, 0, 'sólo reconcilia el período de facturación ACTUAL, nunca deuda histórica');
  const untouched = plan.updatedCharges.find((c) => c.id === 'legacy_july')!;
  assertEqual(untouched.originalAmount, 40000, 'julio queda intacto');
});

test('reconciliación: sin cargo del período actual — no crea nada, ese es otro flujo', () => {
  const plan = planMonthlyAmountReconciliationRepair({
    state: emptyState(),
    students: [{ id: 'qa_finanzas_reconc_7', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 55000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'sin cargo del período, nada que reconciliar acá');
  assertEqual(plan.updatedCharges.length, 0, 'no crea ningún cargo — la creación es responsabilidad de otro flujo');
});

test('reconciliación: alumno INACTIVO (archivado) con divergencia — nunca se toca', () => {
  const charge = monthlyCharge({
    id: 'legacy_archived',
    studentId: 'qa_finanzas_reconc_8',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 20000,
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 'qa_finanzas_reconc_8', status: 'archivado' }],
    resolvePlan: () => ({ type: 'monthly', amount: 99000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'la reparación automática nunca toca alumnos inactivos');
  const untouched = plan.updatedCharges.find((c) => c.id === 'legacy_archived')!;
  assertEqual(untouched.originalAmount, 20000, 'queda exactamente como estaba');
});

test('reconciliación: ya coincide — ninguna acción, aunque el id sea legacy', () => {
  const charge = monthlyCharge({
    id: 'legacy_already_ok',
    studentId: 'qa_finanzas_reconc_9',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 47000,
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 'qa_finanzas_reconc_9', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 47000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
  });
  assertEqual(plan.actions.length, 0, 'sin divergencia, sin acción');
});

test('reconciliación: idempotente — correrla sobre el resultado ya reparado no encuentra nada más', () => {
  const charge = monthlyCharge({
    id: 'legacy_idem',
    studentId: 'qa_finanzas_reconc_10',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 33000,
  });
  const students = [{ id: 'qa_finanzas_reconc_10', status: 'activo' as const }];
  const resolvePlan = () => ({ type: 'monthly' as const, amount: 51000, dueDay: 1 });

  const firstRun = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [charge] },
    students,
    resolvePlan,
    evaluationDate: '2026-08-20',
  });
  assertEqual(firstRun.actions.length, 1, 'primera corrida: una sincronización');

  const secondRun = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: firstRun.updatedCharges },
    students,
    resolvePlan,
    evaluationDate: '2026-08-20',
  });
  assertEqual(secondRun.actions.length, 0, 'ya reparado: la segunda corrida no encuentra nada que hacer');
  assertEqual(secondRun.updatedCharges.length, 1, 'sigue habiendo un único cargo, nunca se duplica');
});

// ---------------------------------------------------------------------------
// CASO DE ACEPTACIÓN — reproduce la forma exacta del bug reportado (plan
// $168.000, cargo abierto legacy en $160.000, sin pagos), con identidad
// ficticia. Único lugar del archivo donde se usan esos dos importes a
// propósito, como caso de aceptación explícito — nunca en el resto de la
// matriz general.
// ---------------------------------------------------------------------------

test('CASO DE ACEPTACIÓN: plan $168.000 / cargo legacy $160.000 sin pagos → tras reparar, todo en $168.000, un único cargo', () => {
  const legacyCharge = monthlyCharge({
    id: 'obligacion_generada_por_una_version_anterior',
    studentId: 'qa_finanzas_aceptacion',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 160000,
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [legacyCharge] },
    students: [{ id: 'qa_finanzas_aceptacion', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 168000, dueDay: 1 }),
    evaluationDate: '2026-08-05', // en término (0% recargo): saldo puro, sin mora de por medio
  });

  assertEqual(plan.actions.length, 1, 'una única sincronización');
  assertEqual(plan.updatedCharges.length, 1, 'un único cargo mensual vigente para agosto');
  const finalCharge = plan.updatedCharges[0];
  assertEqual(finalCharge.id, legacyCharge.id, 'se corrige el MISMO cargo real, nunca se crea uno nuevo');
  assertEqual(finalCharge.originalAmount, 168000, 'obligación agosto: original $168.000');

  const chargeState = calculateChargeState({
    charge: finalCharge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-08-05',
  });
  assertEqual(chargeState.balance, 168000, 'obligación agosto: saldo $168.000');
});
