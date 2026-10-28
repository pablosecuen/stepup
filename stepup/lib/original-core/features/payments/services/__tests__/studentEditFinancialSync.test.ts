// Puerto VERBATIM del original (`src/features/payments/services/__tests__/studentEditFinancialSync.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — ERROR GENERAL: EDICIÓN DE
 * CUOTA Y ESTADO DE PAGO DESINCRONIZADOS): las 26 pruebas generales
 * obligatorias, corridas contra los servicios financieros REALES
 * (`applyFirstMonthSituation`, `correctMonthlyAmount`,
 * `resumeMonthlyBillingAfterRestore`), con adaptadores en memoria
 * inyectados — nunca AsyncStorage real, nunca las cuentas de Joaquín ni
 * Lara Gómez Sand. Identidad ficticia aislada: `qa-edit-*`.
 *
 * Complementa (no duplica) `monthlyAmountMatrix.test.ts` (210 pares
 * fijos+pseudoaleatorios ya cubriendo exhaustivamente `correctMonthlyAmount`
 * en sí) — acá el foco es la CADENA COMPLETA reportada: alta -> edición de
 * cuota -> lo que "Registrar pago" terminaría mostrando, tal como
 * `mapStudentToEditableForm`/`resolveSuggestedMonthlyPaymentAmount` lo leen
 * en la app real.
 */
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { MonthlyBillingPlan, StudentBillingPlan, StudentProfile } from '../../../student-profile/types/index.ts';
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { applyFirstMonthSituation, markCurrentMonthAsPaid, resumeMonthlyBillingAfterRestore } from '../initialMonthlyBillingService.ts';
import { correctMonthlyAmount, type CorrectMonthlyAmountProfileDeps } from '../monthlyAmountCorrectionService.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { selectMonthlyChargeCandidates } from '../../utils/monthlyChargeGenerationPlan.ts';
import { resolveEffectiveMonthlyAmount, resolveStudentBillingPlan } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount, resolveStudentMonthlyCardStatus } from '../../utils/monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import { voidPayment, recordPayment, allocatePayment } from '../../utils/paymentMutations.ts';
import { nextBillingPeriod, billingPeriodOfDateKey } from '../../utils/paymentDates.ts';
import { mapStudentToEditableForm } from '../../../new-student/utils/studentMapper.ts';
import { validateBackupFileContents } from '../../../../shared/backup/restoreValidation.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// PRNG determinista local (mulberry32) — mismo criterio que
// monthlyAmountMatrix.test.ts (reimplementado localmente, ver ese archivo
// para la explicación de por qué no se comparte entre proyectos de prueba).
// ---------------------------------------------------------------------------
type Rng = () => number;
function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function mulberry32(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
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

function makeProfile(id: string, overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id,
    name: `Ficticio ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    dateJoined: '2026-01-01T00:00:00.000Z',
    lastReactivatedAt: null,
    statusChangeDate: null,
    usualDurationMinutes: 60,
    weeklyFrequency: 1,
    price: 10000,
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
    ...overrides,
  };
}

function makeFakeProfileStore(initial: Record<string, StudentProfile>) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: CorrectMonthlyAmountProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

const PERIOD = '2026-08';
const NOW = new Date('2026-08-05T15:00:00.000Z');

/**
 * Helper de prueba: registra un pago y lo asigna a un cargo DENTRO de la
 * misma mutación atómica — `allocatePayment` exige que el pago referenciado
 * ya exista en el `state` que recibe, así que arma un estado intermedio con
 * el pago ya incluido antes de asignar (mismo orden exacto que
 * `planEnsureMonthlyChargeSituation` en `initialMonthlyBillingPlan.ts`).
 */
function recordAndAllocate(
  current: PaymentsRepositoryState,
  input: { paymentId: string; allocationId: string; studentId: string; chargeId: string; amount: number; paidAt: string; recordedAt: string; todayDateKey: string }
): PaymentsRepositoryState {
  const charge = current.charges.find((c) => c.id === input.chargeId)!;
  const payment = recordPayment({
    id: input.paymentId,
    studentId: input.studentId,
    amount: input.amount,
    method: 'efectivo',
    paidAt: input.paidAt,
    recordedAt: input.recordedAt,
    todayDateKey: input.todayDateKey,
  });
  const stateWithPayment: PaymentsRepositoryState = { ...current, payments: [...current.payments, payment] };
  const allocation = allocatePayment({
    id: input.allocationId,
    paymentId: payment.id,
    chargeId: charge.id,
    amount: input.amount,
    state: stateWithPayment,
  });
  return { ...stateWithPayment, allocations: [...stateWithPayment.allocations, allocation] };
}

// ---------------------------------------------------------------------------
// 1) Nuevo mensual con el mes actual ya pagado
// ---------------------------------------------------------------------------
asyncTest('1) nuevo alumno mensual con "el mes ya está pagado": crea PaymentCharge + Payment + PaymentAllocation reales, saldo $0, nunca un booleano', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  // clampPaidAtToDueDate: false — misma bandera que NewStudentScreen.tsx ya
  // pasa siempre para 'paid' desde que la fecha es una elección real y
  // explícita de la profesora (ver el comentario en
  // applyFirstMonthSituationIfNeeded), nunca una declaración ambigua.
  const result = await applyFirstMonthSituation(
    { studentId: 'qa-edit-s1', situation: 'paid', amount: 50000, paidAt: '2026-08-05', now: NOW, clampPaidAtToDueDate: false },
    deps
  );

  assert(result.chargeToCreate !== null, 'crea la obligación mensual del período actual');
  assert(result.payment !== null, 'crea un Payment real');
  assert(result.allocation !== null, 'lo asigna completamente mediante PaymentAllocation');
  assertEqual(result.payment?.paidAt, '2026-08-05', 'paidAt es la fecha real elegida');
  assertEqual(result.payment?.amount, 50000, 'el pago cubre el importe completo');

  const state = controller.getSnapshot();
  const summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s1', state, evaluationDate: '2026-08-05' });
  assertEqual(summary.pendingBalance, 0, 'saldo del período en cero');
  assertEqual(summary.overdueBalance, 0, 'sin mora ni recargo');
});

// ---------------------------------------------------------------------------
// 2) Nuevo mensual con el mes pendiente
// ---------------------------------------------------------------------------
asyncTest('2) nuevo alumno mensual con el mes pendiente: crea la obligación, respeta vencimientos normales', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  const result = await applyFirstMonthSituation(
    { studentId: 'qa-edit-s2', situation: 'pending', amount: 30000, now: NOW },
    deps
  );
  assert(result.chargeToCreate !== null, 'crea la obligación mensual pendiente');
  assertEqual(result.payment, null, 'sin ningún pago todavía');

  const state = controller.getSnapshot();
  const summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s2', state, evaluationDate: '2026-08-05' });
  assertEqual(summary.pendingBalance, 30000, 'saldo pendiente completo');
  assertEqual(summary.overdueBalance, 0, 'día 5: todavía en término');
});

// ---------------------------------------------------------------------------
// 3) Nuevo por clase sin opción de mes pagado — cubierto estructuralmente en
// studentEditBillingSync.test.ts (test:students). Acá se confirma que el
// modelo puro nunca genera una obligación mensual para un plan por clase.
// ---------------------------------------------------------------------------
test('3) selectMonthlyChargeCandidates nunca incluye a un alumno con plan por clase', () => {
  const candidates = selectMonthlyChargeCandidates({
    students: [{ id: 'qa-edit-s3', status: 'activo' }],
    resolvePlan: () => ({ type: 'per_class', amount: 9000 }),
    billingPeriod: PERIOD,
  });
  assertEqual(candidates.length, 0, 'un plan por clase nunca genera una mensualidad');
});

// ---------------------------------------------------------------------------
// 4) Alta los días 1, 10 y 11
// ---------------------------------------------------------------------------
[
  { day: '2026-08-01', label: 'día 1' },
  { day: '2026-08-10', label: 'día 10' },
  { day: '2026-08-11', label: 'día 11' },
].forEach(({ day, label }) => {
  asyncTest(`4) alta "el mes ya está pagado" el ${label}: nunca queda vencida (clamp al vencimiento)`, async () => {
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const result = await applyFirstMonthSituation(
      { studentId: `qa-edit-alta-${day}`, situation: 'paid', amount: 40000, paidAt: day, now: new Date(`${day}T12:00:00.000Z`) },
      deps
    );
    const state = controller.getSnapshot();
    const summary = buildStudentPaymentsSummary({ studentId: `qa-edit-alta-${day}`, state, evaluationDate: day });
    assertEqual(summary.overdueBalance, 0, `${label}: "pagado" nunca puede nacer vencido`);
    assert(result.payment !== null, `${label}: el pago se registra igual`);
  });
});

// ---------------------------------------------------------------------------
// 5) Pago inicial retroactivo
// ---------------------------------------------------------------------------
asyncTest('5) pago inicial retroactivo: paidAt anterior a hoy se respeta tal cual (dentro del mes)', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const result = await applyFirstMonthSituation(
    {
      studentId: 'qa-edit-retro',
      situation: 'paid',
      amount: 40000,
      paidAt: '2026-08-03',
      now: new Date('2026-08-09T12:00:00.000Z'),
      clampPaidAtToDueDate: false,
    },
    deps
  );
  assertEqual(result.payment?.paidAt, '2026-08-03', 'conserva la fecha retroactiva real elegida, no la reemplaza por hoy');
});

// ---------------------------------------------------------------------------
// 6) Cuota impaga: cambiar importe y pagar el nuevo importe — la cadena
// completa reportada, incluyendo el mismo mapeador que usa "Editar alumno".
// ---------------------------------------------------------------------------
asyncTest('6) cuota impaga: tras cambiar el importe, mapStudentToEditableForm y "Registrar pago" muestran AMBOS el importe nuevo, nunca el viejo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s6': makeProfile('qa-edit-s6', { billingPlan: { type: 'monthly', amount: 50000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s6', price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  await correctMonthlyAmount({ studentId: 'qa-edit-s6', newAmount: 65000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  const updatedProfile = profiles.get('qa-edit-s6')!;
  const editable = mapStudentToEditableForm(updatedProfile);
  assertEqual(editable.price, 65000, 'GAP REAL corregido: "Editar alumno" ya muestra el importe nuevo, nunca el viejo');

  const state = controller.getSnapshot();
  const summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s6', state, evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({
    plan: resolveStudentBillingPlan(updatedProfile) as MonthlyBillingPlan,
    charges: summary.charges,
    chargeStates: summary.chargeStates,
    evaluationDate: '2026-08-05',
  });
  assertEqual(suggested.amount, 65000, 'GAP REAL corregido: "Registrar pago" ya sugiere el importe nuevo, nunca la cuota anterior');
});

// ---------------------------------------------------------------------------
// 7) Cuota parcialmente pagada: aumentar importe
// ---------------------------------------------------------------------------
asyncTest('7) cuota parcialmente pagada: aumentar el importe conserva el pago y recalcula el saldo contra el nuevo importe', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s7': makeProfile('qa-edit-s7', { billingPlan: { type: 'monthly', amount: 50000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s7', price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await controller.applyMutation((current) =>
    recordAndAllocate(current, {
      paymentId: 'qa-edit-p7',
      allocationId: 'qa-edit-a7',
      studentId: 'qa-edit-s7',
      chargeId: current.charges[0].id,
      amount: 20000,
      paidAt: '2026-08-03',
      recordedAt: '2026-08-03T09:00:00.000Z',
      todayDateKey: '2026-08-05',
    })
  );

  const { plan } = await correctMonthlyAmount({ studentId: 'qa-edit-s7', newAmount: 70000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assert(plan.chargeUpdated, 'el cargo se actualiza sin borrar el pago ya asignado');

  const state = controller.getSnapshot();
  assertEqual(state.payments.length, 1, 'el pago sigue existiendo, nunca se borra');
  assertEqual(state.allocations.length, 1, 'la asignación sigue existiendo, nunca se duplica');
  const summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s7', state, evaluationDate: '2026-08-05' });
  assertEqual(summary.pendingBalance, 50000, 'saldo recalculado: 70000 nuevo - 20000 ya pagado');
});

// ---------------------------------------------------------------------------
// 8) Cuota parcialmente pagada: reducir de forma segura
// ---------------------------------------------------------------------------
asyncTest('8) cuota parcialmente pagada: reducir por debajo de lo ya asignado se impide, nunca genera saldo a favor en silencio', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s8': makeProfile('qa-edit-s8', { billingPlan: { type: 'monthly', amount: 50000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s8', price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await controller.applyMutation((current) =>
    recordAndAllocate(current, {
      paymentId: 'qa-edit-p8',
      allocationId: 'qa-edit-a8',
      studentId: 'qa-edit-s8',
      chargeId: current.charges[0].id,
      amount: 30000,
      paidAt: '2026-08-03',
      recordedAt: '2026-08-03T09:00:00.000Z',
      todayDateKey: '2026-08-05',
    })
  );

  let threw = false;
  try {
    await correctMonthlyAmount({ studentId: 'qa-edit-s8', newAmount: 20000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch {
    threw = true;
  }
  assert(threw, 'reducir por debajo de lo ya pagado (30000) se rechaza — nunca modificación silenciosa');

  const state = controller.getSnapshot();
  assertEqual(state.charges[0].originalAmount, 50000, 'el cargo nunca quedó a medio actualizar');
});

// ---------------------------------------------------------------------------
// 9) Cuota completamente pagada: cambio desde el mes siguiente
// ---------------------------------------------------------------------------
asyncTest('9) cuota completamente pagada: "este mes" se rechaza, "próximo mes" informa desde cuándo rige', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s9': makeProfile('qa-edit-s9', { billingPlan: { type: 'monthly', amount: 50000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s9', price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await controller.applyMutation((current) =>
    recordAndAllocate(current, {
      paymentId: 'qa-edit-p9',
      allocationId: 'qa-edit-a9',
      studentId: 'qa-edit-s9',
      chargeId: current.charges[0].id,
      amount: 50000,
      paidAt: '2026-08-02',
      recordedAt: '2026-08-02T09:00:00.000Z',
      todayDateKey: '2026-08-05',
    })
  );

  let threw = false;
  try {
    await correctMonthlyAmount({ studentId: 'qa-edit-s9', newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch {
    threw = true;
  }
  assert(threw, 'un mes ya saldado nunca se reescribe retroactivamente');

  const { plan } = await correctMonthlyAmount({ studentId: 'qa-edit-s9', newAmount: 60000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  assert(!plan.chargeUpdated, 'el mes actual (ya pagado) nunca se toca');
  const updatedPlan = profiles.get('qa-edit-s9')!.billingPlan as MonthlyBillingPlan;
  assertEqual(updatedPlan.pendingAmountEffectiveFrom, nextBillingPeriod(PERIOD), 'informa exactamente desde qué período rige el cambio');
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 50000, 'agosto conserva el importe viejo');
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, nextBillingPeriod(PERIOD)), 60000, 'el próximo período ya usa el nuevo');
});

// ---------------------------------------------------------------------------
// 10/11) Anular pago -> vuelve a pendiente -> registrar de nuevo
// ---------------------------------------------------------------------------
asyncTest('10/11) anular un pago recalcula inmediatamente a pendiente; registrar de nuevo después funciona sin duplicar', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s10', price: 40000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await controller.applyMutation((current) =>
    recordAndAllocate(current, {
      paymentId: 'qa-edit-p10',
      allocationId: 'qa-edit-a10',
      studentId: 'qa-edit-s10',
      chargeId: current.charges[0].id,
      amount: 40000,
      paidAt: '2026-08-02',
      recordedAt: '2026-08-02T09:00:00.000Z',
      todayDateKey: '2026-08-05',
    })
  );

  let summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s10', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.pendingBalance, 0, 'punto de partida: saldado');

  await controller.applyMutation((current) => ({
    ...current,
    payments: voidPayment(current.payments, 'qa-edit-p10', 'Error de carga', '2026-08-06T00:00:00.000Z'),
  }));

  summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s10', state: controller.getSnapshot(), evaluationDate: '2026-08-06' });
  assertEqual(summary.pendingBalance, 40000, '10) tras anular, vuelve inmediatamente a pendiente');
  assertEqual(summary.activePayments.length, 0, 'sin pagos activos');
  assertEqual(summary.voidedPayments.length, 1, 'el pago anulado queda en el historial, nunca se borra');

  await controller.applyMutation((current) =>
    recordAndAllocate(current, {
      paymentId: 'qa-edit-p10-b',
      allocationId: 'qa-edit-a10-b',
      studentId: 'qa-edit-s10',
      chargeId: current.charges[0].id,
      amount: 40000,
      paidAt: '2026-08-06',
      recordedAt: '2026-08-06T09:00:00.000Z',
      todayDateKey: '2026-08-06',
    })
  );

  const finalState = controller.getSnapshot();
  summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s10', state: finalState, evaluationDate: '2026-08-06' });
  assertEqual(summary.pendingBalance, 0, '11) el nuevo pago salda el período de nuevo');
  assertEqual(finalState.payments.length, 2, 'exactamente dos pagos en total: el anulado + el nuevo, nunca más');
});

// ---------------------------------------------------------------------------
// 12) Cambiar varias veces la cuota antes de pagar
// ---------------------------------------------------------------------------
asyncTest('12) cambiar la cuota varias veces antes de pagar: siempre queda un único cargo, con el ÚLTIMO importe', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s12': makeProfile('qa-edit-s12', { billingPlan: { type: 'monthly', amount: 30000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s12', price: 30000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  for (const amount of [45000, 12000, 99000, 33000]) {
    await correctMonthlyAmount({ studentId: 'qa-edit-s12', newAmount: amount, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  }

  const state = controller.getSnapshot();
  assertEqual(state.charges.length, 1, 'un único cargo mensual en todo momento, nunca uno por cada cambio');
  assertEqual(state.charges[0].originalAmount, 33000, 'queda con el último importe elegido');
});

// ---------------------------------------------------------------------------
// 13) Cambios consecutivos y doble toque (concurrencia real)
// ---------------------------------------------------------------------------
asyncTest('13) dos cambios de cuota concurrentes (doble toque) nunca se pisan: el store los serializa, nunca deja un cargo a medio actualizar', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s13': makeProfile('qa-edit-s13', { billingPlan: { type: 'monthly', amount: 30000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s13', price: 30000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const results = await Promise.allSettled([
    correctMonthlyAmount({ studentId: 'qa-edit-s13', newAmount: 50000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps),
    correctMonthlyAmount({ studentId: 'qa-edit-s13', newAmount: 55000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert(fulfilled.length >= 1, 'al menos una de las dos corridas concurrentes se aplica con éxito');

  const state = controller.getSnapshot();
  assertEqual(state.charges.length, 1, 'nunca queda más de un cargo mensual, incluso con dos escrituras concurrentes');
  assert([50000, 55000].includes(state.charges[0].originalAmount), 'el cargo final es uno de los dos importes pedidos, nunca uno intermedio corrupto');
});

// ---------------------------------------------------------------------------
// 14/15) Cambio de mes, incluyendo diciembre -> enero
// ---------------------------------------------------------------------------
test('14) nextBillingPeriod avanza correctamente de un mes cualquiera al siguiente', () => {
  assertEqual(nextBillingPeriod('2026-08'), '2026-09', 'agosto -> septiembre');
});

test('15) nextBillingPeriod cruza diciembre -> enero correctamente, incluyendo el cambio de año', () => {
  assertEqual(nextBillingPeriod('2026-12'), '2027-01', 'diciembre 2026 -> enero 2027');
});

asyncTest('14b) cambio de mes real: "próximo mes" aplicado en agosto rige en septiembre, sin tocar agosto', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s14': makeProfile('qa-edit-s14', { billingPlan: { type: 'monthly', amount: 30000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s14', price: 30000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
  await correctMonthlyAmount({ studentId: 'qa-edit-s14', newAmount: 40000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  const plan = profiles.get('qa-edit-s14')!.billingPlan as MonthlyBillingPlan;
  assertEqual(billingPeriodOfDateKey('2026-08-15'), PERIOD, 'agosto sigue siendo agosto');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-08'), 30000, 'agosto no cambia');
  assertEqual(resolveEffectiveMonthlyAmount(plan, '2026-09'), 40000, 'septiembre ya usa el nuevo importe');
});

// ---------------------------------------------------------------------------
// 16) Mensual -> clase suelta
// ---------------------------------------------------------------------------
test('16) mensual -> clase suelta: deja de ser candidato a mensualidades futuras, pero conserva mensualidades/pagos históricos', () => {
  const historicalCharge: PaymentCharge = {
    id: 'charge_mensual_qa-edit-s16_2026-07',
    studentId: 'qa-edit-s16',
    type: 'mensual',
    originalAmount: 30000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T09:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
  };
  // Después del cambio de plan, resolvePlan ya devuelve 'per_class' — el
  // generador de mensualidades futuras nunca vuelve a incluir a este
  // alumno (selectMonthlyChargeCandidates ya probado en el caso 3).
  const candidatesAfterSwitch = selectMonthlyChargeCandidates({
    students: [{ id: 'qa-edit-s16', status: 'activo' }],
    resolvePlan: () => ({ type: 'per_class', amount: 9000 }),
    billingPeriod: '2026-09',
  });
  assertEqual(candidatesAfterSwitch.length, 0, 'nunca se genera una mensualidad futura tras el cambio de plan');
  assertEqual(historicalCharge.voidedAt, null, 'el cambio de plan nunca anula/borra la mensualidad histórica ya generada');
});

// ---------------------------------------------------------------------------
// 17) Clase suelta -> mensual
// ---------------------------------------------------------------------------
asyncTest('17) clase suelta -> mensual: "el mes ya está pagado" (equivalente a markCurrentMonthAsPaid) genera la mensualidad correspondiente', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const result = await markCurrentMonthAsPaid({ studentId: 'qa-edit-s17', amount: 55000, paidAt: '2026-08-05', now: NOW }, deps);
  assert(result.chargeToCreate !== null, 'crea la mensualidad correspondiente al cambiar a mensual');
  assert(result.payment !== null, 'el pago se registra en el acto, con la cuota nueva');
  assertEqual(result.payment?.amount, 55000, 'usa la cuota nueva, nunca un precio por clase residual');
});

// ---------------------------------------------------------------------------
// 18) Cierre y rehidratación
// ---------------------------------------------------------------------------
asyncTest('18) cierre y rehidratación: un nuevo controller sobre el mismo adaptador conserva cargo+pago+asignación exactos', async () => {
  const { adapter } = makeFakeAdapter();
  const controllerA = createPaymentsStoreController(adapter);
  const depsA = { hydrate: controllerA.hydrate, applyMutation: controllerA.applyMutation };
  await applyFirstMonthSituation({ studentId: 'qa-edit-s18', situation: 'paid', amount: 25000, paidAt: '2026-08-05', now: NOW }, depsA);

  // "Cierre" simulado: un controller NUEVO sobre el MISMO adaptador
  // persistido (nunca el mismo objeto en memoria).
  const controllerB = createPaymentsStoreController(adapter);
  const rehydrated = await controllerB.hydrate();

  assertEqual(rehydrated.charges.length, 1, 'el cargo sobrevive al cierre/reapertura');
  assertEqual(rehydrated.payments.length, 1, 'el pago sobrevive');
  assertEqual(rehydrated.allocations.length, 1, 'la asignación sobrevive');
  const summary = buildStudentPaymentsSummary({ studentId: 'qa-edit-s18', state: rehydrated, evaluationDate: '2026-08-05' });
  assertEqual(summary.pendingBalance, 0, 'el resultado (saldo $0) se conserva exactamente igual tras reabrir');
});

// ---------------------------------------------------------------------------
// 19) Backup y restauración
// ---------------------------------------------------------------------------
asyncTest('19) backup y restauración: un plan mensual con cargo+pago+asignación reales pasa la validación de respaldo intacto', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  await applyFirstMonthSituation({ studentId: 'qa-edit-s19', situation: 'paid', amount: 60000, paidAt: '2026-08-05', now: NOW }, deps);
  const state = controller.getSnapshot();

  const backupDoc = {
    schemaVersion: 2,
    exportedAt: '2026-08-10T12:00:00.000Z',
    appVersion: '1.0.0',
    students: [
      {
        id: 'qa-edit-s19',
        name: 'Alumno Ficticio Diecinueve',
        level: 'B1',
        modality: 'presencial',
        status: 'activo',
        nextClassAt: null,
        paymentStatus: 'verde',
        averageGrade: 8,
        classesThisMonth: 0,
        lastPaymentAt: null,
        isFeatured: false,
        isNew: false,
        hasOverduePayment: false,
        hasPendingReport: false,
        hasPendingHomework: false,
      },
    ],
    profiles: {},
    pedagogicalLessons: [],
    calendarLessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    teacherAvailability: { schemaVersion: 1, timezone: 'America/Argentina/Buenos_Aires', weeklyBlocks: [], exceptions: [] },
    paymentCharges: state.charges,
    payments: state.payments,
    paymentAllocations: state.allocations,
    paymentAdjustments: state.adjustments,
  };

  const result = validateBackupFileContents(JSON.stringify(backupDoc));
  assert(result.ok, 'el respaldo con cargo+pago+asignación reales debe ser válido');
  if (!result.ok) return;
  assertEqual(result.backup.paymentCharges.length, 1, 'conserva el cargo');
  assertEqual(result.backup.payments.length, 1, 'conserva el pago');
  assertEqual(result.backup.paymentAllocations.length, 1, 'conserva la asignación');
});

// ---------------------------------------------------------------------------
// 20) Actualización inmediata de todas las pantallas
// ---------------------------------------------------------------------------
asyncTest('20) tras corregir la cuota, buildStudentPaymentsSummary (misma fuente que Cobros/lista/Home/recordatorios) refleja el cambio de inmediato, sin ningún paso extra', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({
    'qa-edit-s20': makeProfile('qa-edit-s20', { billingPlan: { type: 'monthly', amount: 20000, dueDay: 1 } }),
  });
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s20', price: 20000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const before = buildStudentPaymentsSummary({ studentId: 'qa-edit-s20', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(before.pendingBalance, 20000, 'antes del cambio');

  await correctMonthlyAmount({ studentId: 'qa-edit-s20', newAmount: 27000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  const after = buildStudentPaymentsSummary({ studentId: 'qa-edit-s20', state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(after.pendingBalance, 27000, 'inmediatamente después: refleja el nuevo importe, sin recargar nada aparte');
});

// ---------------------------------------------------------------------------
// 21/22) Ausencia de cargos/pagos/asignaciones duplicados
// ---------------------------------------------------------------------------
asyncTest('21) applyFirstMonthSituation llamado dos veces (\'pending\') nunca duplica el cargo mensual', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  await applyFirstMonthSituation({ studentId: 'qa-edit-s21', situation: 'pending', amount: 30000, now: NOW }, deps);
  await applyFirstMonthSituation({ studentId: 'qa-edit-s21', situation: 'pending', amount: 30000, now: NOW }, deps);
  const state = controller.getSnapshot();
  assertEqual(state.charges.length, 1, 'nunca más de un cargo mensual para el mismo alumno/período');
});

asyncTest('22) marcar "pagado" dos veces sobre el mismo período nunca duplica el pago (la segunda se rechaza)', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  await applyFirstMonthSituation({ studentId: 'qa-edit-s22', situation: 'paid', amount: 30000, paidAt: '2026-08-05', now: NOW }, deps);

  let threw = false;
  try {
    await applyFirstMonthSituation({ studentId: 'qa-edit-s22', situation: 'paid', amount: 30000, paidAt: '2026-08-05', now: NOW }, deps);
  } catch {
    threw = true;
  }
  assert(threw, 'un período ya saldado rechaza un segundo "pagado" en vez de duplicar el pago');

  const state = controller.getSnapshot();
  assertEqual(state.payments.length, 1, 'exactamente un pago, nunca dos');
  assertEqual(state.allocations.length, 1, 'exactamente una asignación, nunca dos');
});

// ---------------------------------------------------------------------------
// 23) Rollback completo si falla cualquier escritura
// ---------------------------------------------------------------------------
asyncTest('23a) correctMonthlyAmount: si falla guardar el perfil DESPUÉS de corregir el cargo, el cargo se revierte al importe anterior', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const failingProfileDeps: CorrectMonthlyAmountProfileDeps = {
    getProfile: () => makeProfile('qa-edit-s23a', { billingPlan: { type: 'monthly', amount: 30000, dueDay: 1 } }),
    saveProfile: async () => {
      throw new Error('Fallo simulado al guardar el perfil');
    },
  };
  await generateMonthlyChargesForCandidates([{ studentId: 'qa-edit-s23a', price: 30000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  let threw = false;
  try {
    await correctMonthlyAmount({ studentId: 'qa-edit-s23a', newAmount: 50000, effectiveFrom: 'this_month', now: NOW }, deps, failingProfileDeps);
  } catch {
    threw = true;
  }
  assert(threw, 'el error del perfil se relanza');
  const state = controller.getSnapshot();
  assertEqual(state.charges[0].originalAmount, 30000, 'rollback completo: el cargo nunca queda con el importe nuevo si el perfil no se pudo guardar');
});

asyncTest('23b) applyFirstMonthSituation: si la escritura del store de pagos falla, no queda ningún cargo/pago/asignación a medio crear', async () => {
  const failingAdapter: PaymentsPersistenceAdapter = {
    readAll: async () => emptyPaymentsState(),
    writeAll: async () => {
      throw new Error('Fallo simulado de escritura');
    },
  };
  const controller = createPaymentsStoreController(failingAdapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };

  let threw = false;
  try {
    await applyFirstMonthSituation({ studentId: 'qa-edit-s23b', situation: 'paid', amount: 30000, paidAt: '2026-08-05', now: NOW }, deps);
  } catch {
    threw = true;
  }
  assert(threw, 'la falla de escritura se relanza');
  const state = controller.getSnapshot();
  assertEqual(state.charges.length, 0, 'ningún cargo a medio crear');
  assertEqual(state.payments.length, 0, 'ningún pago a medio crear');
  assertEqual(state.allocations.length, 0, 'ninguna asignación a medio crear');
});

// ---------------------------------------------------------------------------
// 24) Matriz con al menos 100 importes ficticios diferentes — combinada con
// el mapeador real de "Editar alumno" para probar la cadena completa, no
// sólo correctMonthlyAmount en aislamiento (esa parte YA tiene su propia
// matriz de 210 pares en monthlyAmountMatrix.test.ts).
// ---------------------------------------------------------------------------
const MATRIX_SEED = 810200;
const rng = createRng(MATRIX_SEED);
const AMOUNT_PAIRS = Array.from({ length: 120 }, () => {
  const from = randInt(rng, 1000, 3000000);
  let to = randInt(rng, 1000, 3000000);
  if (to === from) to += 1;
  return { from, to };
});

AMOUNT_PAIRS.forEach((pair, index) => {
  asyncTest(`24) matriz #${index + 1}: $${pair.from} -> $${pair.to} — mapStudentToEditableForm siempre refleja el importe nuevo`, async () => {
    const studentId = `qa-edit-matrix-${index}`;
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const { profiles, deps: profileDeps } = makeFakeProfileStore({
      [studentId]: makeProfile(studentId, { billingPlan: { type: 'monthly', amount: pair.from, dueDay: 1 } }),
    });
    await generateMonthlyChargesForCandidates([{ studentId, price: pair.from }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

    await correctMonthlyAmount({ studentId, newAmount: pair.to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

    const editable = mapStudentToEditableForm(profiles.get(studentId)!);
    assertEqual(editable.price, pair.to, `(${pair.from}->${pair.to}) el formulario de edición nunca vuelve a mostrar el importe viejo`);
    const state = controller.getSnapshot();
    assertEqual(state.charges.length, 1, `(${pair.from}->${pair.to}) un único cargo, sin duplicados`);
  });
});

test('24b) la matriz cubre exactamente 120 pares pseudoaleatorios (semilla fija, mínimo 100 pedido)', () => {
  assertEqual(AMOUNT_PAIRS.length, 120, 'ciento veinte pares, por encima del mínimo de 100 pedido');
});

// ---------------------------------------------------------------------------
// 25) Distintas fechas efectivas
// ---------------------------------------------------------------------------
[
  { now: new Date('2026-08-01T10:00:00.000Z'), label: 'inicio de mes' },
  { now: new Date('2026-08-15T10:00:00.000Z'), label: 'mitad de mes' },
  { now: new Date('2026-08-31T23:00:00.000Z'), label: 'fin de mes' },
].forEach(({ now, label }) => {
  asyncTest(`25) fecha efectiva "${label}": correctMonthlyAmount sigue actualizando el mismo cargo del período, sin duplicar`, async () => {
    const studentId = `qa-edit-fecha-${label.replace(/\s/g, '-')}`;
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const { deps: profileDeps } = makeFakeProfileStore({
      [studentId]: makeProfile(studentId, { billingPlan: { type: 'monthly', amount: 20000, dueDay: 1 } }),
    });
    await generateMonthlyChargesForCandidates([{ studentId, price: 20000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
    await correctMonthlyAmount({ studentId, newAmount: 28000, effectiveFrom: 'this_month', now }, deps, profileDeps);
    const state = controller.getSnapshot();
    assertEqual(state.charges.length, 1, `${label}: sigue siendo un único cargo`);
    assertEqual(state.charges[0].originalAmount, 28000, `${label}: importe actualizado correctamente`);
  });
});

// ---------------------------------------------------------------------------
// 26) Diferentes combinaciones de pagos parciales y completos
// ---------------------------------------------------------------------------
const PAYMENT_COMBINATIONS: Array<{ label: string; amounts: number[] }> = [
  { label: 'un solo pago total', amounts: [50000] },
  { label: 'dos pagos parciales que suman el total', amounts: [20000, 30000] },
  { label: 'tres pagos parciales que suman el total', amounts: [10000, 15000, 25000] },
  { label: 'un pago parcial, saldo pendiente', amounts: [15000] },
];

PAYMENT_COMBINATIONS.forEach(({ label, amounts }, index) => {
  asyncTest(`26) combinación de pagos — ${label}`, async () => {
    const studentId = `qa-edit-combo-${index}`;
    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    await generateMonthlyChargesForCandidates([{ studentId, price: 50000 }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

    let total = 0;
    for (let i = 0; i < amounts.length; i += 1) {
      total += amounts[i];
      await controller.applyMutation((current) =>
        recordAndAllocate(current, {
          paymentId: `qa-edit-combo-${index}-p${i}`,
          allocationId: `qa-edit-combo-${index}-a${i}`,
          studentId,
          chargeId: current.charges.find((c) => c.studentId === studentId)!.id,
          amount: amounts[i],
          paidAt: '2026-08-05',
          recordedAt: '2026-08-05T09:00:00.000Z',
          todayDateKey: '2026-08-05',
        })
      );
    }

    const state = controller.getSnapshot();
    const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: '2026-08-05' });
    assertEqual(summary.pendingBalance, Math.max(50000 - total, 0), `${label}: saldo pendiente correcto`);
    assertEqual(state.payments.length, amounts.length, `${label}: exactamente ${amounts.length} pagos, sin duplicados`);
  });
});
