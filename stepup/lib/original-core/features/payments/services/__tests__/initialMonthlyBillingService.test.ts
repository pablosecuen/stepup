// Puerto VERBATIM del original (`src/features/payments/services/__tests__/initialMonthlyBillingService.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E02/Fase 4, corrección
 * integral post-simulación): antes, `applyFirstMonthSituation`/
 * `markCurrentMonthAsPaid` — la función real detrás del botón "Marcar mes
 * actual como pagado" — sólo aceptaban el singleton real de
 * `paymentsStore.ts` (AsyncStorage real), así que era imposible probar ese
 * flujo de punta a punta sin tocar almacenamiento real. Ahora acepta
 * `deps` inyectables (mismo patrón que `registerPaymentService.ts`/
 * `monthlyChargeGenerationService.ts`) — este archivo prueba EXACTAMENTE el
 * servicio real que usa `CobrosTab.tsx`, nunca una reimplementación
 * paralela, incluido el caso demostrado $185.000 → $192.000 (Fase 4).
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { registerPaymentForStudent } from '../registerPaymentService.ts';
import { applyFirstMonthSituation, markCurrentMonthAsPaid, resumeMonthlyBillingAfterRestore, type ResumeMonthlyBillingProfileDeps } from '../initialMonthlyBillingService.ts';
import { planMonthlyAmountChange, type MonthlyAmountChangePlan } from '../../utils/monthlyAmountCorrection.ts';
import { resolveEffectiveMonthlyAmount } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount } from '../../utils/monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import { calculateChargeState } from '../../utils/paymentCalculations.ts';
import type { MonthlyBillingPlan, StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

/**
 * Perfil en memoria falso para `resumeMonthlyBillingAfterRestore` — nunca
 * toca AsyncStorage ni el store real de perfiles. Ids ficticios (`s1`,
 * `estudiante_x`, ...), nunca datos de un alumno real — la propia tarea
 * pide explícitamente no escribir información personal en los informes ni
 * en las pruebas de esta fase.
 */
function makeFakeProfileStore(initial: Record<string, StudentProfile> = {}) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: ResumeMonthlyBillingProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

function makeMonthlyProfile(id: string, amount: number, startPeriod?: string): StudentProfile {
  return {
    id,
    name: `Alumno ficticio ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    billingPlan: { type: 'monthly', amount, dueDay: 1, startPeriod },
    dateJoined: '2026-01-01T00:00:00.000Z',
    lastReactivatedAt: null,
    statusChangeDate: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 1,
    price: amount,
    averageGrade: 8,
    classesThisMonth: 0,
    attendanceRate: 100,
    paymentStatus: 'verde',
    nextClassAt: null,
    lastClassAt: null,
    pendingHomework: null,
    alerts: [],
    currentGoals: [],
    strengths: [],
    areasToImprove: [],
    totalClasses: 0,
    totalHoursTaken: 0,
    totalInvested: 0,
    statusHistory: [],
    levelHistory: [],
    priceHistory: [],
    skillGradesHistory: [],
  };
}

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

async function applyPriceChange(
  applyMutation: ReturnType<typeof createPaymentsStoreController>['applyMutation'],
  studentId: string,
  billingPeriod: string,
  newAmount: number,
  effectiveFrom: 'this_month' | 'next_month',
  evaluationDate: string
): Promise<MonthlyAmountChangePlan> {
  let plan: MonthlyAmountChangePlan | null = null;
  await applyMutation((current) => {
    const existingCharge = current.charges.find(
      (c) => c.studentId === studentId && c.type === 'mensual' && c.billingPeriod === billingPeriod && c.voidedAt === null
    );
    const currentChargeState = existingCharge
      ? calculateChargeState({ charge: existingCharge, allocations: current.allocations, payments: current.payments, adjustments: current.adjustments, evaluationDate })
      : null;
    plan = planMonthlyAmountChange({ studentId, currentBillingPeriod: billingPeriod, newAmount, effectiveFrom, existingCharges: current.charges, existingCharge: existingCharge ?? null, currentChargeState, createdAt: `${evaluationDate}T00:00:00.000Z` });
    if (!plan.chargeUpdated) return current;
    return { ...current, charges: plan.updatedCharges };
  });
  if (!plan) throw new Error('inalcanzable');
  return plan;
}

asyncTest('CASO EXACTO Fase 4, opción A: cargo agosto $185.000, nuevo plan $192.000 "desde este mes" — markCurrentMonthAsPaid nunca es rechazado, saldo final $0', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);

  const changePlan = await applyPriceChange(controller.applyMutation, 's1', '2026-08', 192000, 'this_month', '2026-08-05');
  assertEqual(changePlan.chargeUpdated, true, 'el cargo de agosto se actualiza a $192.000');

  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...changePlan.planPatch };
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-08'), 192000, 'el importe efectivo de agosto ya es el nuevo');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(suggested.amount, 192000, 'el pago sugerido es exactamente el importe corregido');

  // La confirmación real: EXACTAMENTE el servicio que usa CobrosTab.handleMarkCurrentMonthPaid.
  const result = await markCurrentMonthAsPaid(
    { studentId: 's1', amount: suggested.amount, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') },
    deps
  );
  assert(result.allocation !== null, 'markCurrentMonthAsPaid nunca se rechaza al confirmar exactamente lo sugerido');
  assertEqual(result.allocation?.amount, 192000, 'se asigna el importe completo corregido, nunca el viejo');

  const finalSummary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'saldo final exacto en $0');
  assertEqual(finalSummary.chargeStates[0].originalAmount, 192000, 'el cargo de agosto quedó en $192.000');
});

asyncTest('CASO EXACTO Fase 4, opción B: "desde el próximo mes" — agosto conserva $185.000, markCurrentMonthAsPaid de agosto propone $185.000, septiembre nace en $192.000', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 185000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  const changePlan = await applyPriceChange(controller.applyMutation, 's1', '2026-08', 192000, 'next_month', '2026-08-05');
  assertEqual(changePlan.chargeUpdated, false, 'agosto nunca se toca al elegir "próximo mes"');

  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 185000, dueDay: 1, ...changePlan.planPatch };
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-08'), 185000, 'agosto sigue en $185.000');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-09'), 192000, 'septiembre ya usa el nuevo importe');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(suggested.amount, 185000, 'pagar agosto sigue proponiendo $185.000, nunca el precio nuevo');

  const result = await markCurrentMonthAsPaid(
    { studentId: 's1', amount: suggested.amount, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') },
    deps
  );
  assertEqual(result.allocation?.amount, 185000, 'se registra exactamente $185.000 para agosto');

  await generateMonthlyChargesForCandidates(
    [{ studentId: 's1', price: resolveEffectiveMonthlyAmount(plan, '2026-09') }],
    '2026-09',
    '2026-09-01T09:00:00.000Z',
    deps
  );
  const septemberCharge = controller.getSnapshot().charges.find((c) => c.billingPeriod === '2026-09')!;
  assertEqual(septemberCharge.originalAmount, 192000, 'septiembre nace con el importe nuevo');
});

asyncTest('impago: markCurrentMonthAsPaid sobre un cargo recién generado salda el mes completo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 60000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  const result = await markCurrentMonthAsPaid({ studentId: 's1', amount: 60000, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps);
  assertEqual(result.allocation?.amount, 60000, 'saldo completo del mes impago');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].balance, 0, 'saldo final $0');
});

asyncTest('parcial: markCurrentMonthAsPaid con un pago parcial previo paga exactamente el saldo restante, nunca duplica ni excede', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 100000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await registerPaymentForStudent({ studentId: 's1', amount: 40000, method: 'efectivo', paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps);

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 100000, dueDay: 1 };
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(suggested.amount, 60000, 'el saldo restante es exactamente 100.000 - 40.000');

  const result = await markCurrentMonthAsPaid({ studentId: 's1', amount: suggested.amount, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps);
  assertEqual(result.allocation?.amount, 60000, 'nunca vuelve a cobrar los 40.000 ya pagados');

  const finalSummary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'saldo final $0, nunca negativo');
  assertEqual(finalSummary.chargeStates[0].paidAmount, 100000, 'el total pagado es exactamente el importe del cargo');
});

asyncTest('ya pagado: markCurrentMonthAsPaid sobre un mes ya saldado se rechaza limpio (nunca duplica el pago)', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 60000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await markCurrentMonthAsPaid({ studentId: 's1', amount: 60000, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps);

  let rejected = false;
  let message = '';
  try {
    await markCurrentMonthAsPaid({ studentId: 's1', amount: 60000, paidAt: '2026-08-06', now: new Date('2026-08-06T15:00:00.000Z') }, deps);
  } catch (error) {
    rejected = true;
    message = error instanceof Error ? error.message : '';
  }
  assert(rejected, 'marcar como pagado dos veces se rechaza, nunca duplica el pago');
  assert(message.includes('saldado'), 'el mensaje explica que ya está saldado');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-06' });
  assertEqual(summary.chargeStates[0].paidAmount, 60000, 'sigue habiendo un único pago, nunca dos');
});

asyncTest('vencido: markCurrentMonthAsPaid sobre un cargo en mora nunca incluye recargo automático', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  // dueDay: 1 explícito — este caso depende de la etapa EXACTA de mora
  // (first_late el día 15); el default de la profesora (día 10) correría
  // esa etapa a otra fecha. Ver `resolveMonthlyDueDate`.
  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 100000, dueDay: 1 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-15' });
  const plan: MonthlyBillingPlan = { type: 'monthly', amount: 100000, dueDay: 1 };
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-15' });
  assertEqual(suggested.amount, 100000, 'día 15 = primer vencimiento (mora real), pero sin recargos automáticos: sigue siendo el importe original');

  const result = await markCurrentMonthAsPaid({ studentId: 's1', amount: suggested.amount, paidAt: '2026-08-15', now: new Date('2026-08-15T15:00:00.000Z') }, deps);
  assertEqual(result.allocation?.amount, 100000, 'el pago registrado es exactamente el importe base, nunca con recargo');

  const finalSummary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-15' });
  assertEqual(finalSummary.chargeStates[0].balance, 0, 'saldo final $0');
});

asyncTest('doble toque: dos llamadas concurrentes a markCurrentMonthAsPaid nunca duplican el pago ni exceden el saldo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 80000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);

  const attempt = (paymentSuffix: string) =>
    markCurrentMonthAsPaid({ studentId: 's1', amount: 80000, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps).then(
      (r) => ({ ok: true as const, r }),
      (error: unknown) => ({ ok: false as const, error, paymentSuffix })
    );

  const [first, second] = await Promise.all([attempt('a'), attempt('b')]);
  const successes = [first, second].filter((outcome) => outcome.ok);
  assertEqual(successes.length, 1, 'exactamente una de las dos pulsaciones concurrentes tiene éxito');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].paidAmount, 80000, 'un único pago de 80.000, nunca 160.000');
  assertEqual(summary.chargeStates[0].balance, 0, 'saldo final $0, nunca negativo por doble asignación');
});

asyncTest('varios alumnos, distintos importes: la corrección funciona igual sin lógica hardcodeada por alumno/monto', async () => {
  const pairs: Array<{ studentId: string; from: number; to: number }> = [
    { studentId: 'alumno_a', from: 50000, to: 60000 },
    { studentId: 'alumno_b', from: 185000, to: 192000 },
    { studentId: 'alumno_c', from: 192000, to: 185000 },
    { studentId: 'alumno_d', from: 154700, to: 170300 },
  ];

  for (const { studentId, from, to } of pairs) {
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

    await generateMonthlyChargesForCandidates([{ studentId, price: from }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
    const changePlan = await applyPriceChange(controller.applyMutation, studentId, '2026-08', to, 'this_month', '2026-08-05');
    assertEqual(changePlan.chargeUpdated, true, `(${studentId}: ${from}->${to}) el cargo se actualiza`);

    const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
    const plan: MonthlyBillingPlan = { type: 'monthly', amount: from, dueDay: 1, ...changePlan.planPatch };
    const suggested = resolveSuggestedMonthlyPaymentAmount({ plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
    assertEqual(suggested.amount, to, `(${studentId}) el pago sugerido es siempre el importe corregido`);

    const result = await markCurrentMonthAsPaid({ studentId, amount: suggested.amount, paidAt: '2026-08-05', now: new Date('2026-08-05T15:00:00.000Z') }, deps);
    assert(result.allocation !== null, `(${studentId}) la confirmación nunca es rechazada por el motor`);
    assertEqual(result.allocation?.amount, to, `(${studentId}) se asigna exactamente el importe corregido`);

    const finalSummary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
    assertEqual(finalSummary.chargeStates[0].balance, 0, `(${studentId}) saldo final en $0`);
  }
});

asyncTest('E02: applyFirstMonthSituation (alta de alumno nuevo) también acepta deps inyectables, mismo servicio que usa NewStudentScreen', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const result = await applyFirstMonthSituation(
    { studentId: 's1', situation: 'paid', amount: 75000, paidAt: '2026-08-05', method: 'efectivo', now: new Date('2026-08-05T15:00:00.000Z') },
    deps
  );
  assert(result.chargeToCreate !== null, 'crea el cargo del primer mes con el adaptador inyectado, nunca AsyncStorage real');
  assertEqual(result.allocation?.amount, 75000, 'asigna el importe completo declarado');
});

// Corrección 2026-08-16 (a pedido de Joaquín — E04, corrección integral
// post-simulación): "prueba dirigida" que confirma la hipótesis con datos
// 100% ficticios ('s1', 'estudiante_x'...) — nunca información personal de
// un alumno real. Cubre los 10 casos obligatorios de la Fase 6.

asyncTest('E04 — restauración día 1: "cobrar desde este mes" genera el cargo, en término (0% recargo)', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 80000) });

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-01T15:00:00.000Z') }, deps, profileDeps);
  assertEqual(result.billingPeriod, '2026-08', 'el período de cobro es el mes actual');
  assert(result.chargeCreated, 'se crea el cargo del mes actual');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-01' });
  assertEqual(summary.chargeStates[0].stage, 'on_time', 'día 1: pendiente en término');
  assertEqual(summary.chargeStates[0].surchargeAmount, 0, 'sin recargo el día 1');
  const updatedPlan = profiles.get('s1')?.billingPlan;
  assertEqual(updatedPlan?.type, 'monthly', 'el plan sigue siendo mensual');
  assertEqual(updatedPlan?.type === 'monthly' ? updatedPlan.startPeriod : undefined, '2026-08', 'el plan queda con vigencia desde el mes actual');
});

asyncTest('E04 — restauración día 10 (límite inclusive): sigue en término, sin recargo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 80000) });

  await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-10T15:00:00.000Z') }, deps, profileDeps);
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-10' });
  assertEqual(summary.chargeStates[0].stage, 'on_time', 'día 10 sigue en término');
});

asyncTest('E04 — restauración día 13: el cargo generado hoy ya muestra "primer vencimiento" (mora real) al evaluarlo, sin recargo automático', async () => {
  // dueDay: 1 del perfil, pero el 1° de agosto de 2026 es sábado — el
  // vencimiento real se ajusta al lunes 3 (`resolveMonthlyDueDate`); el día
  // 13 (10 días de mora desde ese vencimiento real) es el equivalente
  // exacto al "día 11" de antes de este ajuste de fin de semana.
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 100000) });

  await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-13T15:00:00.000Z') }, deps, profileDeps);
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-13' });
  assertEqual(summary.chargeStates[0].stage, 'first_late', 'día 13: primer vencimiento (mora real, nunca "al día")');
  assertEqual(summary.chargeStates[0].surchargeAmount, 0, 'nunca hay recargo automático, ni en mora real');
});

asyncTest('E04 — restauración día 22: segundo vencimiento, cargo generado igual (sin cargo previo no era un impedimento)', async () => {
  // Mismo ajuste de fin de semana que el caso anterior (dueDay: 1 -> lunes
  // 3 de agosto de 2026): el día 22 es el equivalente exacto al "día 20" de
  // antes del ajuste.
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 100000) });

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-22T15:00:00.000Z') }, deps, profileDeps);
  assert(result.chargeCreated, 'se genera el cargo aunque ya sea tarde en el mes');
  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-22' });
  assertEqual(summary.chargeStates[0].stage, 'second_late', 'día 22: segundo vencimiento');
});

asyncTest('E04 — mes CON cargo anterior (alumno pagado antes de archivarse): "cobrar desde este mes" nunca duplica ni reescribe el cargo/pago existente', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 90000) });

  // El alumno ya estaba pagado ANTES de archivarse (el cargo/pago sobreviven a archivar, que nunca toca pagos).
  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 90000 }], '2026-08', '2026-08-01T09:00:00.000Z', deps);
  await registerPaymentForStudent({ studentId: 's1', amount: 90000, method: 'efectivo', paidAt: '2026-08-03', now: new Date('2026-08-03T15:00:00.000Z') }, deps);
  const beforeCharges = controller.getSnapshot().charges.length;

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-15T15:00:00.000Z') }, deps, profileDeps);
  assert(!result.chargeCreated, 'el cargo ya existía — no se crea uno nuevo');
  assertEqual(controller.getSnapshot().charges.length, beforeCharges, 'nunca duplica el cargo');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-15' });
  assertEqual(summary.chargeStates[0].balance, 0, 'sigue saldado, nunca se reabre la deuda');
  assertEqual(summary.chargeStates[0].paidAmount, 90000, 'el pago original se conserva intacto');
});

asyncTest('E04 — mes SIN cargo: "cobrar desde este mes" genera exactamente uno', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 65000) });

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-12T15:00:00.000Z') }, deps, profileDeps);
  assert(result.chargeCreated, 'genera el único cargo del mes');
  assertEqual(controller.getSnapshot().charges.length, 1, 'exactamente un cargo, nunca cero ni más de uno');
});

asyncTest('E04 — restaurar dos veces seguidas ("this_month"): nunca duplica el cargo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 55000) });

  await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-05T15:00:00.000Z') }, deps, profileDeps);
  const secondResult = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-06T15:00:00.000Z') }, deps, profileDeps);

  assert(!secondResult.chargeCreated, 'la segunda vez ya no crea otro cargo — reutiliza el existente');
  assertEqual(controller.getSnapshot().charges.length, 1, 'restaurar dos veces nunca duplica el cargo');
});

asyncTest('E04 — alumno con deuda de un mes ANTERIOR: "cobrar desde este mes" nunca toca ni salda la deuda vieja', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 70000) });

  // Julio quedó impago (deuda anterior real, previa a archivar/restaurar).
  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: 70000 }], '2026-07', '2026-07-01T09:00:00.000Z', deps);

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'this_month', now: new Date('2026-08-05T15:00:00.000Z') }, deps, profileDeps);
  assert(result.chargeCreated, 'se crea el cargo de agosto');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.charges.length, 2, 'julio (deuda vieja) y agosto (nuevo) conviven, ninguno se pisa');
  assert(summary.overdueBalance > 0, 'la deuda de julio sigue vencida — restaurar en agosto no la borra ni la toca');
  const augustCharge = summary.chargeStates.find((s) => s.chargeId.includes('2026-08'));
  assertEqual(augustCharge?.balance, 70000, 'agosto nace con su propio saldo completo, independiente de julio');
});

asyncTest('E04 — "comienza el próximo mes": no genera deuda actual, y el cambio de mes posterior genera el cargo correcto', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ s1: makeMonthlyProfile('s1', 60000) });

  const result = await resumeMonthlyBillingAfterRestore({ studentId: 's1', choice: 'next_month', now: new Date('2026-08-15T15:00:00.000Z') }, deps, profileDeps);
  assertEqual(result.billingPeriod, '2026-09', 'el próximo período de cobro es septiembre');
  assert(!result.chargeCreated, 'nunca se crea deuda en el mes actual');
  assertEqual(controller.getSnapshot().charges.length, 0, 'agosto no genera ningún cargo');

  const summary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-08-15' });
  assertEqual(summary.charges.length, 0, 'el alumno no muestra ninguna obligación en agosto');

  // Cambio de mes posterior: septiembre debe generarse con normalidad para este alumno.
  const plan = profiles.get('s1')!.billingPlan as MonthlyBillingPlan;
  assertEqual(plan.startPeriod, '2026-09', 'el plan quedó con vigencia desde septiembre');
  await generateMonthlyChargesForCandidates([{ studentId: 's1', price: resolveEffectiveMonthlyAmount(plan, '2026-09') }], '2026-09', '2026-09-01T09:00:00.000Z', deps);
  const septemberSummary = buildStudentPaymentsSummary({ studentId: 's1', state: controller.getSnapshot(), evaluationDate: '2026-09-01' });
  assertEqual(septemberSummary.charges.length, 1, 'septiembre genera exactamente un cargo para este alumno');
  assertEqual(septemberSummary.chargeStates[0].originalAmount, 60000, 'con el importe correcto');
});
