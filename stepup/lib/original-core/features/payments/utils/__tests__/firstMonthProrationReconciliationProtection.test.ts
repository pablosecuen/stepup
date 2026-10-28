// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/firstMonthProrationReconciliationProtection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * CORRECCIÓN GENERAL (a pedido de Joaquín — alta a mitad de mes y métricas
 * financieras): la cuota inicial proporcional ya implementada
 * (`firstMonthProration.ts`/`confirmFirstMonthProration`) debe ser la única
 * fuente de verdad financiera del mes de ingreso. Causa raíz real del
 * desbalance reportado: `planMonthlyAmountReconciliationRepair` (corre en
 * cada arranque/foreground de la app y ANTES de cada pago) trataba CUALQUIER
 * divergencia entre el cargo real y la cuota habitual del plan como un error
 * a corregir — sin saber que el primer período diverge a propósito — y
 * revertía en silencio la media cuota a la cuota completa. Estas pruebas
 * verifican que una decisión de primer mes ya confirmada protege el cargo
 * para siempre, con cualquier importe/proporción, en cualquier módulo que
 * lea el cargo real.
 */
import type {
  FirstMonthProrationDecision,
  Payment,
  PaymentAllocation,
  PaymentCharge,
  PaymentsRepositoryState,
} from '../../types/index.ts';
import { analyzeFinancialConsistency, planMonthlyAmountReconciliationRepair } from '../financialReconciliation.ts';
import { computeProportionalAmount, planFirstMonthProration, resolveFirstMonthChargeAmount } from '../firstMonthProration.ts';
import { buildMonthlyCharge } from '../paymentMutations.ts';
import { buildMonthlyChargeId } from '../paymentIdempotency.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { buildHomeFinancialSummary } from '../buildHomeFinancialSummary.ts';
import { buildPeriodFinancialSummary } from '../periodFinancialSummary.ts';
import type { RecurrenceRule, RecurrenceWeek } from '../../../calendar/types/index.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
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

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function weeklyRule(overrides: Partial<RecurrenceRule> & { weeks: RecurrenceWeek[]; cycleLengthWeeks: 1 | 2 | 3 | 4 }): RecurrenceRule {
  return {
    recurrenceId: 'qa_rule',
    studentId: 'qa_student',
    participantIds: ['qa_student'],
    type: 'weekly',
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-27',
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

function decision(
  overrides: Partial<FirstMonthProrationDecision> & {
    studentId: string;
    billingPeriod: string;
    chargedAmount: number;
    permanentMonthlyAmount: number;
  }
): FirstMonthProrationDecision {
  return {
    id: `firstmonth_${overrides.studentId}_${overrides.billingPeriod}`,
    effectiveJoinDate: `${overrides.billingPeriod}-15`,
    criterion: 'proportional',
    classesRemaining: 2,
    classesPerFullPeriod: 4,
    chargeId: buildMonthlyChargeId(overrides.studentId, overrides.billingPeriod),
    createdAt: `${overrides.billingPeriod}-15T09:00:00.000Z`,
    confirmedAt: `${overrides.billingPeriod}-15T09:00:00.000Z`,
    ...overrides,
  };
}

/** Arma un cargo del primer mes con el mismo camino real: sugerencia -> criterio -> cargo. */
function buildFirstMonthCharge(input: {
  studentId: string;
  billingPeriod: string;
  monthlyAmount: number;
  classesRemaining: number;
  classesPerFullPeriod: number;
}): { charge: PaymentCharge; decision: FirstMonthProrationDecision; chargedAmount: number } {
  const proportionalAmount = computeProportionalAmount(input.monthlyAmount, input.classesRemaining, input.classesPerFullPeriod);
  const suggestion = {
    studentId: input.studentId,
    billingPeriod: input.billingPeriod,
    effectiveJoinDate: `${input.billingPeriod}-15`,
    classesRemaining: input.classesRemaining,
    classesPerFullPeriod: input.classesPerFullPeriod,
    permanentMonthlyAmount: input.monthlyAmount,
    proportionalAmount,
  };
  const chargedAmount = resolveFirstMonthChargeAmount(suggestion, 'proportional');
  const charge = buildMonthlyCharge({
    studentId: input.studentId,
    billingPeriod: input.billingPeriod,
    dueDate: suggestion.effectiveJoinDate,
    originalAmount: chargedAmount,
    createdAt: `${input.billingPeriod}-15T09:00:00.000Z`,
    existingCharges: [],
  });
  return {
    charge,
    chargedAmount,
    decision: decision({
      studentId: input.studentId,
      billingPeriod: input.billingPeriod,
      chargedAmount,
      permanentMonthlyAmount: input.monthlyAmount,
      classesRemaining: input.classesRemaining,
      classesPerFullPeriod: input.classesPerFullPeriod,
      chargeId: charge.id,
    }),
  };
}

// ---------------------------------------------------------------------------
// 1) Alta a mitad de mes con media cuota — el caso exacto del ejemplo
//    ($80.000 completo, $40.000 el primer período).
// ---------------------------------------------------------------------------

test('alta a mitad de mes: el cargo del primer período es exactamente la mitad, nunca la cuota completa', () => {
  const { charge, chargedAmount } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  assertEqual(chargedAmount, 40000, 'el ejemplo exacto del pedido: mitad de las clases, mitad de la cuota');
  assertEqual(charge.originalAmount, 40000, 'el cargo real nace con el importe prorrateado');
});

// ---------------------------------------------------------------------------
// 2) La reconciliación automática (arranque/foreground/antes de pagar) NUNCA
//    revierte el cargo prorrateado a la cuota completa — ni una vez, ni tras
//    "editar posteriormente la cuota habitual" varias veces.
// ---------------------------------------------------------------------------

test('la reconciliación automática nunca revierte un primer mes prorrateado a la cuota completa', () => {
  const { charge, decision: firstMonthDecision } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }), // misma cuota habitual: divergencia legítima
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [firstMonthDecision],
  });

  assertEqual(plan.actions.length, 0, 'con una decisión de primer mes registrada, nunca hay acción de reconciliación');
  const untouched = plan.updatedCharges.find((c) => c.id === charge.id)!;
  assertEqual(untouched.originalAmount, 40000, 'el cargo sigue prorrateado, nunca vuelve a $80.000');
});

test('regla 9: editar la cuota habitual DESPUÉS del alta nunca convierte retroactivamente la media cuota en cuota completa', () => {
  const { charge, decision: firstMonthDecision } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });

  // La profesora sube la cuota habitual a $95.000 DESPUÉS del alta — la
  // reconciliación automática corre en el próximo arranque/foreground.
  const planAfterPriceChange = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 95000, dueDay: 1 }),
    evaluationDate: '2026-08-25',
    firstMonthProrationDecisions: [firstMonthDecision],
  });

  assertEqual(planAfterPriceChange.actions.length, 0, 'la divergencia sigue siendo legítima (media cuota vs. nueva cuota habitual)');
  const stillHalf = planAfterPriceChange.updatedCharges.find((c) => c.id === charge.id)!;
  assertEqual(stillHalf.originalAmount, 40000, 'agosto conserva su media cuota exacta, pase lo que pase con la cuota habitual');
});

test('sin decisión de primer mes registrada, la reconciliación SIGUE funcionando igual que antes (protege sólo lo prorrateado, nunca deja de reparar divergencias reales)', () => {
  const legacyCharge = buildMonthlyCharge({
    studentId: 's_legacy',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 160000,
    createdAt: '2026-08-01T09:00:00.000Z',
    existingCharges: [],
  });
  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [legacyCharge] },
    students: [{ id: 's_legacy', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 168000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [], // ninguna decisión: sigue siendo un cambio de precio legítimo a sincronizar
  });
  assertEqual(plan.actions.length, 1, 'sin decisión, la reconciliación de un cambio de precio real sigue funcionando');
  assertEqual(plan.updatedCharges.find((c) => c.id === legacyCharge.id)!.originalAmount, 168000, 'se sincroniza como siempre');
});

test('una decisión de OTRO alumno o de OTRO período nunca protege un cargo distinto (sin mezclar datos)', () => {
  const legacyCharge = buildMonthlyCharge({
    studentId: 's_real',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 50000,
    createdAt: '2026-08-01T09:00:00.000Z',
    existingCharges: [],
  });
  const decisionForOtherStudent = decision({
    studentId: 's_otro_alumno',
    billingPeriod: '2026-08',
    chargedAmount: 40000,
    permanentMonthlyAmount: 80000,
  });
  const decisionForOtherPeriod = decision({
    studentId: 's_real',
    billingPeriod: '2026-07',
    chargedAmount: 40000,
    permanentMonthlyAmount: 80000,
  });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [legacyCharge] },
    students: [{ id: 's_real', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 70000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [decisionForOtherStudent, decisionForOtherPeriod],
  });

  assertEqual(plan.actions.length, 1, 'ninguna decisión ajena (otro alumno/otro período) protege este cargo');
  assertEqual(plan.updatedCharges.find((c) => c.id === legacyCharge.id)!.originalAmount, 70000, 'se sincroniza normalmente');
});

// ---------------------------------------------------------------------------
// 3) `analyzeFinancialConsistency` tampoco reporta el primer mes prorrateado
//    como una inconsistencia.
// ---------------------------------------------------------------------------

test('el reporte de consistencia nunca marca un primer mes prorrateado como "plan_amount_diverges_from_charge"', () => {
  const { charge, decision: firstMonthDecision } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
    firstMonthProrationDecisions: [firstMonthDecision],
  });
  assertEqual(report.countsByCategory.plan_amount_diverges_from_charge, 0, 'la media cuota nunca es un hallazgo');
});

test('sin la decisión, el mismo cargo prorrateado SÍ se reportaría como divergente (confirma que la protección es la causa del cambio)', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const report = analyzeFinancialConsistency({
    state: { ...emptyState(), charges: [charge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }),
    evaluationDate: '2026-08-20',
    // firstMonthProrationDecisions omitido a propósito
  });
  assertEqual(report.countsByCategory.plan_amount_diverges_from_charge, 1, 'sin el registro de la decisión, se vería como divergencia');
});

// ---------------------------------------------------------------------------
// 4) Proporciones distintas del 50% e importes aleatorios — nunca hardcodea
//    40.000/80.000/50%.
// ---------------------------------------------------------------------------

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

test('cualquier importe y proporción configurada: la reconciliación protege el cargo prorrateado sin importar los números exactos', () => {
  const random = pseudoRandom(2026);
  for (let i = 0; i < 40; i++) {
    const monthlyAmount = 10000 + Math.floor(random() * 400000);
    const classesPerFullPeriod = 1 + Math.floor(random() * 12);
    // Al menos 1 clase restante: con 0 el cargo sería $0 (criterio real
    // 'no_charge', que nunca crea un PaymentCharge) — fuera del alcance de
    // esta prueba, que verifica cargos reales con importe positivo.
    const classesRemaining = 1 + Math.floor(random() * classesPerFullPeriod);
    const studentId = `qa_random_${i}`;

    const { charge, decision: firstMonthDecision, chargedAmount } = buildFirstMonthCharge({
      studentId,
      billingPeriod: '2026-08',
      monthlyAmount,
      classesRemaining,
      classesPerFullPeriod,
    });

    const plan = planMonthlyAmountReconciliationRepair({
      state: { ...emptyState(), charges: [charge] },
      students: [{ id: studentId, status: 'activo' }],
      resolvePlan: () => ({ type: 'monthly', amount: monthlyAmount, dueDay: 1 }),
      evaluationDate: '2026-08-25',
      firstMonthProrationDecisions: [firstMonthDecision],
    });

    assertEqual(plan.actions.length, 0, `iteración ${i}: sin acción — cuota ${monthlyAmount}, ${classesRemaining}/${classesPerFullPeriod} clases`);
    const updated = plan.updatedCharges.find((c) => c.id === charge.id)!;
    assertEqual(updated.originalAmount, chargedAmount, `iteración ${i}: conserva el importe prorrateado exacto`);
  }
});

// ---------------------------------------------------------------------------
// 5) Pago completo y parcial del primer período proporcional — nunca saldo a
//    favor falso, nunca deuda fantasma.
// ---------------------------------------------------------------------------

test('pago completo del primer período proporcional: balance en 0, sin saldo a favor fantasma', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 40000, paidAt: '2026-08-18' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 40000 });

  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const chargeState = calculateChargeState({ charge, allocations: state.allocations, payments: state.payments, adjustments: state.adjustments, evaluationDate: '2026-08-20' });

  assertEqual(chargeState.balance, 0, 'pagar exactamente el importe prorrateado salda el período por completo');
  assertEqual(chargeState.paidAmount, 40000, 'lo pagado es exactamente lo prorrateado, nunca la cuota completa');
});

test('pago parcial del primer período proporcional: el saldo se calcula sobre el importe prorrateado, nunca sobre la cuota completa', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 15000, paidAt: '2026-08-18' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 15000 });

  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const chargeState = calculateChargeState({ charge, allocations: state.allocations, payments: state.payments, adjustments: state.adjustments, evaluationDate: '2026-08-20' });

  assertEqual(chargeState.balance, 25000, 'saldo = 40.000 prorrateados - 15.000 pagados, nunca 80.000 - 15.000');
  assert(chargeState.balance > 0, 'todavía queda saldo real por cobrar');
});

// ---------------------------------------------------------------------------
// 6) Alta al inicio de mes con cuota completa — sigue igual, nunca afectada
//    por esta protección (no hay ninguna decisión de proporcional que
//    aplicar, es simplemente la cuota completa de siempre).
// ---------------------------------------------------------------------------

test('alta al inicio del mes (todas las clases por delante): cuota completa, sin ninguna protección especial de por medio', () => {
  const suggestion = planFirstMonthProration({
    studentId: 's1',
    monthlyAmount: 80000,
    effectiveJoinDate: '2026-08-03', // primer lunes del mes en el ejemplo de firstMonthProration.test.ts
    activeSeries: [
      weeklyRule({
        studentId: 's1',
        participantIds: ['s1'],
        cycleLengthWeeks: 1,
        weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
      }),
    ],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(suggestion.classesRemaining, suggestion.classesPerFullPeriod, 'todas las clases del período siguen por delante');
  assertEqual(resolveFirstMonthChargeAmount(suggestion, 'proportional'), 80000, 'con el período completo, la cuota es completa');
});

// ---------------------------------------------------------------------------
// 7) Cambio al mes siguiente: cuota completa habitual, sin decisión — la
//    reconciliación (si alguna vez hiciera falta) no encuentra nada raro.
// ---------------------------------------------------------------------------

test('el mes siguiente al alta ya usa la cuota completa habitual, y la reconciliación no encuentra ninguna divergencia', () => {
  const { charge: augustCharge, decision: augustDecision } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  // Septiembre: generado por el motor mensual normal (fuera del alcance de
  // este archivo) directamente en $80.000 — nunca hereda el prorrateo de agosto.
  const septemberCharge = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-09',
    dueDate: '2026-09-01',
    originalAmount: 80000,
    createdAt: '2026-09-01T09:00:00.000Z',
    existingCharges: [augustCharge],
  });

  const plan = planMonthlyAmountReconciliationRepair({
    state: { ...emptyState(), charges: [augustCharge, septemberCharge] },
    students: [{ id: 's1', status: 'activo' }],
    resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }),
    evaluationDate: '2026-09-10',
    firstMonthProrationDecisions: [augustDecision],
  });

  assertEqual(plan.actions.length, 0, 'septiembre ya coincide con la cuota habitual — nada que reconciliar');
  const untouchedSeptember = plan.updatedCharges.find((c) => c.id === septemberCharge.id)!;
  assertEqual(untouchedSeptember.originalAmount, 80000, 'septiembre es la cuota completa de siempre');
});

// ---------------------------------------------------------------------------
// 8) Reinicio: correr la reconciliación varias veces seguidas (simula
//    arranque/foreground repetidos) con el mismo registro persistido nunca
//    degrada el cargo prorrateado.
// ---------------------------------------------------------------------------

test('reinicio: correr la reconciliación automática varias veces seguidas nunca degrada el cargo prorrateado', () => {
  const { charge, decision: firstMonthDecision } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });

  let charges: PaymentCharge[] = [charge];
  for (let run = 0; run < 5; run++) {
    const plan = planMonthlyAmountReconciliationRepair({
      state: { ...emptyState(), charges },
      students: [{ id: 's1', status: 'activo' }],
      resolvePlan: () => ({ type: 'monthly', amount: 80000, dueDay: 1 }),
      evaluationDate: '2026-08-20',
      firstMonthProrationDecisions: [firstMonthDecision],
    });
    charges = plan.updatedCharges;
  }

  assertEqual(charges.find((c) => c.id === charge.id)!.originalAmount, 40000, 'tras 5 "arranques" seguidos, sigue en $40.000');
});

// ---------------------------------------------------------------------------
// 9) Resumen financiero y proyección: "Generado"/"Cobrado"/"Pendiente" del
//    mes de ingreso reflejan el cargo proporcional, nunca la cuota completa
//    — el ejemplo exacto del pedido ("Cobrado en agosto aumenta $40.000, no
//    $80.000").
// ---------------------------------------------------------------------------

test('Resumen financiero (Home): "Generado"/"Pendiente" del mes de ingreso son el importe proporcional, nunca la cuota completa', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  // evaluationDate = el propio día de ingreso (dueDate del cargo prorrateado,
  // "vence hoy", todavía en término) — el foco de este caso es el IMPORTE
  // proporcional, no el vencimiento; una fecha posterior ya caería en "mes
  // vencido" bajo la regla real de vencimiento (corrección 2026-09-02), algo
  // ajeno a lo que este caso verifica.
  const summary = buildHomeFinancialSummary({ state: { ...emptyState(), charges: [charge] }, evaluationDate: '2026-08-15' });
  assertEqual(summary.currentMonthGenerated, 40000, '"Generado este mes" es el importe proporcional, nunca $80.000');
  assertEqual(summary.currentMonthPendingOnTimeBalance, 40000, 'todo el saldo pendiente en término es el importe proporcional');
});

test('Resumen financiero (Home): al pagar el primer período proporcional, "Cobrado en agosto" aumenta exactamente $40.000, no $80.000', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 40000, paidAt: '2026-08-18' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 40000 });

  const summary = buildHomeFinancialSummary({
    state: { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] },
    evaluationDate: '2026-08-20',
  });
  assertEqual(summary.monthlyCollected, 40000, 'exactamente el ejemplo del pedido: $40.000, nunca $80.000');
  assertEqual(summary.currentMonthPendingOnTimeBalance, 0, 'ya no queda nada pendiente: el período prorrateado quedó saldado');
});

test('Resumen financiero por período (analíticas): "Generado"/"Cobrado" de agosto usan el cargo proporcional real', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 40000, paidAt: '2026-08-18' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 40000 });

  const summary = buildPeriodFinancialSummary({
    state: { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] },
    rangeStart: '2026-08-01',
    rangeEnd: '2026-08-31',
    evaluationDate: '2026-08-20',
  });
  assertEqual(summary.generated, 40000, 'generado del período: el importe proporcional real');
  assertEqual(summary.collected, 40000, 'cobrado del período: exactamente lo pagado sobre el cargo proporcional');
  assertEqual(summary.pending, 0, 'sin pendiente: ya se saldó');
  assertEqual(summary.overdue, 0, 'sin vencido');
});

// ---------------------------------------------------------------------------
// 10) Ausencia de deuda o saldo a favor fantasma tras la protección — el
//     motor de cargo real sigue siendo la única fuente del saldo, nunca la
//     reconciliación lo reemplaza por un cálculo propio.
// ---------------------------------------------------------------------------

test('sin deuda ni saldo a favor fantasma: pagar de más contra el cargo proporcional sigue detectándose como excedente real, nunca oculto por la protección', () => {
  const { charge } = buildFirstMonthCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    monthlyAmount: 80000,
    classesRemaining: 2,
    classesPerFullPeriod: 4,
  });
  const pay = payment({ id: 'p1', studentId: 's1', amount: 40000, paidAt: '2026-08-18' });
  const alloc = allocation({ id: 'a1', paymentId: 'p1', chargeId: charge.id, studentId: 's1', amount: 40000 });

  const state: PaymentsRepositoryState = { charges: [charge], payments: [pay], allocations: [alloc], adjustments: [] };
  const chargeState = calculateChargeState({
    charge,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-08-25',
  });
  assertEqual(chargeState.balance, 0, 'saldado exacto: ni deuda ni saldo a favor');
  assertEqual(chargeState.settledAt !== null, true, 'queda marcado como saldado en su momento real, sin ambigüedad');
});
