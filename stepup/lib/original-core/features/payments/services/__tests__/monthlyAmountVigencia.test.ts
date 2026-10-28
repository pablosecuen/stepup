// Puerto VERBATIM del original (`src/features/payments/services/__tests__/monthlyAmountVigencia.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual): casos de aceptación 1-5, 11 y 12 del pedido —
 * los específicos de "vigencia del monto mensual" (los casos 6-10, sobre
 * pago retroactivo/deuda anterior/doble toque, ya están cubiertos en
 * `overdueClearsAfterFullPayment.test.ts`). Reproduce el caso demostrado
 * exacto ($185.000 → $192.000) contra el motor financiero REAL (store con
 * adaptador falso, nunca AsyncStorage) — `correctMonthlyAmount` en sí está
 * acoplado al store de perfiles (singleton, no inyectable), así que estos
 * tests aplican `planMonthlyAmountChange` (la misma función pura que usa el
 * servicio) directamente contra el store de pagos real, y verifican el
 * motor de cargos/pagos de punta a punta — la única parte no cubierta acá
 * (la escritura en `StudentProfile.billingPlan`) se verifica por código
 * fuente en `monthlyAmountCorrectionService.test.ts`.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { registerPaymentForStudent } from '../registerPaymentService.ts';
import { planMonthlyAmountChange, type MonthlyAmountChangePlan } from '../../utils/monthlyAmountCorrection.ts';
import { resolveEffectiveMonthlyAmount } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount } from '../../utils/monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import { calculateChargeState } from '../../utils/paymentCalculations.ts';
import type { MonthlyBillingPlan } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { asyncTest, assert, assertEqual } from '../../../calendar/utils/__tests__/testHarness.ts';

function makeFakeAdapter() {
  const store = { persisted: emptyPaymentsState() };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state: PaymentsRepositoryState) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

/** Aplica el mismo cambio que `correctMonthlyAmount`, sin depender del store de perfiles (singleton, no inyectable en pruebas). */
async function applyAmountChange(
  controller: ReturnType<typeof createPaymentsStoreController>,
  input: { studentId: string; currentBillingPeriod: string; newAmount: number; effectiveFrom: 'this_month' | 'next_month' },
  evaluationDate: string
): Promise<MonthlyAmountChangePlan> {
  let plan: MonthlyAmountChangePlan | null = null;
  await controller.applyMutation((current) => {
    const existingCharge = current.charges.find(
      (charge) =>
        charge.studentId === input.studentId &&
        charge.type === 'mensual' &&
        charge.billingPeriod === input.currentBillingPeriod &&
        charge.voidedAt === null
    );
    const currentChargeState = existingCharge
      ? calculateChargeState({
          charge: existingCharge,
          allocations: current.allocations,
          payments: current.payments,
          adjustments: current.adjustments,
          evaluationDate,
        })
      : null;
    plan = planMonthlyAmountChange({
      studentId: input.studentId,
      currentBillingPeriod: input.currentBillingPeriod,
      newAmount: input.newAmount,
      effectiveFrom: input.effectiveFrom,
      existingCharges: current.charges,
      existingCharge: existingCharge ?? null,
      currentChargeState,
      createdAt: `${evaluationDate}T00:00:00.000Z`,
    });
    if (!plan.chargeUpdated) return current;
    return { ...current, charges: plan.updatedCharges };
  });
  if (!plan) throw new Error('inalcanzable');
  return plan;
}

asyncTest('CASO 1 — impago, aumento este mes: cargo final $192.000, pago sugerido $192.000, saldo $0 tras pagar', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);

  const changePlan = await applyAmountChange(
    controller,
    { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 192000, effectiveFrom: 'this_month' },
    '2026-08-05'
  );
  assertEqual(changePlan.chargeUpdated, true, 'el cargo de agosto se actualizó');

  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...changePlan.planPatch };
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-08'), 192000, 'el importe efectivo de agosto ya es el nuevo');

  const snapshot = controller.getSnapshot();
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: snapshot, evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({
    plan,
    charges: summary.charges,
    chargeStates: summary.chargeStates,
    evaluationDate: '2026-08-05',
  });
  assertEqual(suggested.amount, 192000, 'el pago sugerido es exactamente el importe corregido, nunca el viejo');

  // Confirmación exitosa: pagar exactamente lo sugerido nunca es rechazado por el motor.
  const registration = await registerPaymentForStudent(
    { studentId: 's1', amount: suggested.amount, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );
  assertEqual(registration.allocations.length, 1, 'se asigna en una sola operación, sin fricción');

  const finalSummary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'saldo final exacto en $0 — nunca queda un remanente');
});

asyncTest('CASO 2 — impago, aumento próximo mes: agosto conserva $185.000, septiembre nace en $192.000', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);

  const changePlan = await applyAmountChange(
    controller,
    { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 192000, effectiveFrom: 'next_month' },
    '2026-08-05'
  );
  assertEqual(changePlan.chargeUpdated, false, 'agosto nunca se toca');

  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...changePlan.planPatch };
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-08'), 185000, 'agosto sigue en 185.000');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-09'), 192000, 'septiembre ya usa el nuevo importe');

  const summaryAugust = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  const suggestedAugust = resolveSuggestedMonthlyPaymentAmount({
    plan,
    charges: summaryAugust.charges,
    chargeStates: summaryAugust.chargeStates,
    evaluationDate: '2026-08-05',
  });
  assertEqual(suggestedAugust.amount, 185000, 'pagar agosto sigue proponiendo 185.000, no el nuevo precio');

  // Septiembre se genera con el precio nuevo, resolviendo el plan efectivo.
  await generateMonthlyChargesForCandidates(
    [{ studentId: 's1', price: resolveEffectiveMonthlyAmount(plan, '2026-09') }],
    '2026-09',
    '2026-09-01T09:00:00.000Z',
    deps
  );
  const septemberCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-09')!;
  assertEqual(septemberCharge.originalAmount, 192000, 'septiembre nace con el importe nuevo');
});

asyncTest('CASO 3 — pago parcial: cargo $185.000, pagado $50.000, nuevo cargo $192.000, saldo $142.000', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await registerPaymentForStudent(
    { studentId: 's1', amount: 50000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );

  const changePlan = await applyAmountChange(
    controller,
    { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 192000, effectiveFrom: 'this_month' },
    '2026-08-05'
  );
  assertEqual(changePlan.chargeUpdated, true, 'se acepta: el nuevo importe es mayor a lo ya pagado');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].paidAmount, 50000, 'el pago parcial previo se conserva intacto');
  assertEqual(summary.chargeStates[0].balance, 142000, 'saldo principal: 192.000 - 50.000');

  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...changePlan.planPatch };
  const suggested = resolveSuggestedMonthlyPaymentAmount({
    plan,
    charges: summary.charges,
    chargeStates: summary.chargeStates,
    evaluationDate: '2026-08-05',
  });
  assertEqual(suggested.amount, 142000, 'el pago completo sugerido es el saldo real, nunca 192.000 a secas');
});

asyncTest('CASO 4 — mes cerrado: agosto pagado no cambia con el aumento, septiembre usa el nuevo importe', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await registerPaymentForStudent(
    { studentId: 's1', amount: 185000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );

  let rejected = false;
  try {
    await applyAmountChange(
      controller,
      { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 192000, effectiveFrom: 'this_month' },
      '2026-08-05'
    );
  } catch {
    rejected = true;
  }
  assert(rejected, '"este mes" se rechaza sobre un período ya cerrado');

  const chargeAfter = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-08')!;
  assertEqual(chargeAfter.originalAmount, 185000, 'agosto queda exactamente como se pagó, nunca reescrito');

  // El cambio SÍ se puede aplicar "desde el próximo mes".
  const nextMonthPlan = await applyAmountChange(
    controller,
    { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 192000, effectiveFrom: 'next_month' },
    '2026-08-05'
  );
  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...nextMonthPlan.planPatch };
  await generateMonthlyChargesForCandidates(
    [{ studentId: 's1', price: resolveEffectiveMonthlyAmount(plan, '2026-09') }],
    '2026-09',
    '2026-09-01T09:00:00.000Z',
    deps
  );
  const septemberCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-09')!;
  assertEqual(septemberCharge.originalAmount, 192000, 'septiembre ya usa el importe nuevo');
});

asyncTest('CASO 5 — reducir por debajo de lo pagado: se impide este mes, sin saldo negativo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 192000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await registerPaymentForStudent(
    { studentId: 's1', amount: 150000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );

  let rejected = false;
  try {
    await applyAmountChange(
      controller,
      { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 140000, effectiveFrom: 'this_month' },
      '2026-08-05'
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'reducir por debajo de lo ya pagado ($150.000) nunca se acepta para el mes actual');

  const chargeAfter = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-08')!;
  assertEqual(chargeAfter.originalAmount, 192000, 'el cargo queda intacto tras el rechazo');
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assert(summary.chargeStates[0].balance >= 0, 'nunca se generó saldo negativo (a favor)');

  // "Próximo mes" sí se puede aplicar aunque sea menor a lo pagado este mes (no toca el cargo actual).
  const nextMonthPlan = await applyAmountChange(
    controller,
    { studentId: 's1', currentBillingPeriod: '2026-08', newAmount: 140000, effectiveFrom: 'next_month' },
    '2026-08-05'
  );
  assertEqual(nextMonthPlan.chargeUpdated, false, '"próximo mes" siempre se acepta: nunca toca el cargo actual');
});

asyncTest('CASO 11 — cinco alumnos con montos e situaciones distintas: la reconciliación no encuentra falsos positivos', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  // s1: impago. s2: parcial. s3: pagado. s4: vencido (mes anterior). s5: comienza el próximo mes (sin cargo).
  await generateMonthlyChargesForCandidates(
    [
      { studentId: 's1', price: 50000 },
      { studentId: 's2', price: 154700 },
      { studentId: 's3', price: 60000 },
    ],
    '2026-08',
    '2026-08-01T09:00:00.000Z',
    deps
  );
  await generateMonthlyChargesForCandidates([{ studentId: 's4', price: 100000 }], '2026-07', '2026-07-01T09:00:00.000Z', deps);

  await registerPaymentForStudent(
    { studentId: 's2', amount: 70000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );
  await registerPaymentForStudent(
    { studentId: 's3', amount: 60000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-15T12:00:00.000Z') },
    deps
  );

  const snapshot = controller.getSnapshot();

  const summaryS1 = buildStudentPaymentsSummary({ studentId: 's1', state: snapshot, evaluationDate: '2026-08-05' });
  assertEqual(summaryS1.chargeStates[0].balance, 50000, 's1 sigue debiendo el importe completo');

  const summaryS2 = buildStudentPaymentsSummary({ studentId: 's2', state: snapshot, evaluationDate: '2026-08-05' });
  assertEqual(summaryS2.chargeStates[0].balance, 84700, 's2: 154.700 - 70.000 = 84.700');

  const summaryS3 = buildStudentPaymentsSummary({ studentId: 's3', state: snapshot, evaluationDate: '2026-08-05' });
  assertEqual(summaryS3.chargeStates[0].balance, 0, 's3 saldado por completo');

  const summaryS4 = buildStudentPaymentsSummary({ studentId: 's4', state: snapshot, evaluationDate: '2026-08-15' });
  assert(summaryS4.overdueBalance > 0, 's4 realmente vencido (julio impago, ya en agosto)');

  const summaryS5 = buildStudentPaymentsSummary({ studentId: 's5', state: snapshot, evaluationDate: '2026-08-05' });
  assertEqual(summaryS5.charges.length, 0, 's5 no tiene ningún cargo — comienza el próximo mes, sin deuda actual');
});

asyncTest('CASO 12 — importes variables sin lógica hardcodeada: la vigencia funciona igual para cualquier par de montos', async () => {
  const pairs: Array<{ from: number; to: number }> = [
    { from: 50000, to: 60000 },
    { from: 185000, to: 192000 },
    { from: 192000, to: 185000 },
    { from: 154700, to: 170300 },
    { from: 999, to: 1000001 },
  ];

  for (const { from, to } of pairs) {
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const studentId = `s_${from}_${to}`;

    await generateMonthlyChargesForCandidates([{ studentId, price: from }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
    const changePlan = await applyAmountChange(
      controller,
      { studentId, currentBillingPeriod: '2026-08', newAmount: to, effectiveFrom: 'this_month' },
      '2026-08-05'
    );
    assertEqual(changePlan.chargeUpdated, true, `(${from}→${to}) el cargo se actualiza`);

    const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
    assertEqual(summary.chargeStates[0].originalAmount, to, `(${from}→${to}) el cargo queda exactamente en el importe nuevo`);

    const plan: MonthlyBillingPlan = { type: 'monthly', amount: from, dueDay: 1, ...changePlan.planPatch };
    const suggested = resolveSuggestedMonthlyPaymentAmount({
      plan,
      charges: summary.charges,
      chargeStates: summary.chargeStates,
      evaluationDate: '2026-08-05',
    });
    assertEqual(suggested.amount, to, `(${from}→${to}) el pago sugerido es siempre el importe corregido`);

    const registration = await registerPaymentForStudent(
      { studentId, amount: suggested.amount, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-15T12:00:00.000Z') },
      deps
    );
    assert(registration.allocations.length === 1, `(${from}→${to}) la confirmación nunca es rechazada por el motor`);

    const finalSummary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
    assertEqual(finalSummary.chargeStates[0].balance, 0, `(${from}→${to}) saldo final en $0`);
  }
});
