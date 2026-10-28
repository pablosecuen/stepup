// Puerto VERBATIM del original (`src/features/payments/services/__tests__/monthlyAmountMatrix.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Auditoría 2026-08-17 (a pedido de Joaquín — verificación exhaustiva de
 * cambio de monto mensual): matriz general de importes. $185.000/$192.000
 * son sólo dos de los 210 pares probados acá — nunca un caso especial: cada
 * par se ejecuta contra EXACTAMENTE el mismo camino real
 * (`correctMonthlyAmount`, el servicio que llama `EditMonthlyAmountSheet`),
 * nunca una reimplementación paralela para las pruebas.
 *
 * Identidad ficticia aislada: `qa_finanzas_montos_*` — sólo existe en
 * memoria durante esta corrida (adaptador falso, nunca AsyncStorage/
 * Supabase real) y desaparece al terminar el proceso de pruebas.
 *
 * Semilla pseudoaleatoria: 424242 (mulberry32, misma familia de PRNG que
 * `src/qa/simulation/rng.ts`, reimplementada acá localmente para no cruzar
 * el límite de compilación entre `tsconfig.qa-simulation.json` y
 * `tsconfig.payments-tests.json`).
 *
 * Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA: la cuota
 * nueva no actualizaba el cargo abierto): los 210 pares "este mes" de abajo
 * SIEMPRE pre-generaban el cargo antes de corregir — eso enmascaró la
 * regresión real en todas las corridas anteriores de esta matriz. Se agregó
 * `runTransitionThisMonthNoChargeYet`, que repite los mismos 210 pares SIN
 * pre-generar el cargo (período actual impago y sin cargo materializado
 * todavía) y verifica el estado real de RegisterPaymentSheet con sus mismas
 * funciones (`buildStudentPaymentsSummary` + `calculateAssignableDebt`).
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { generateMonthlyChargesForCandidates } from '../monthlyChargeGenerationService.ts';
import { registerPaymentForStudent } from '../registerPaymentService.ts';
import { correctMonthlyAmount, type CorrectMonthlyAmountProfileDeps } from '../monthlyAmountCorrectionService.ts';
import { resolveEffectiveMonthlyAmount } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount } from '../../utils/monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import { calculateSafeAllocationCapacity } from '../../utils/paymentCalculations.ts';
import { calculateAssignableDebt } from '../../utils/registerPaymentPlan.ts';
import { validateAmountInput } from '../../utils/currencyAmountInput.ts';
import { planMonthlyAmountChange } from '../../utils/monthlyAmountCorrection.ts';
import type { MonthlyBillingPlan, StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// PRNG determinista local (mulberry32) — misma fórmula que ya usa y prueba
// `src/qa/simulation/rng.ts`; reimplementada acá porque esa carpeta compila
// bajo un tsconfig distinto (aislamiento de la simulación anual, no tocado).
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

export const MATRIX_SEED = 424242;

interface AmountPair {
  from: number;
  to: number;
}

// Los 10 pares fijos pedidos explícitamente — $185.000/$192.000 es sólo el
// caso #7 de 210, tratado exactamente igual que el resto.
const FIXED_PAIRS: AmountPair[] = [
  { from: 1, to: 2 },
  { from: 100, to: 250 },
  { from: 999, to: 1000 },
  { from: 1000, to: 999 },
  { from: 12500, to: 18750 },
  { from: 80000, to: 110000 },
  { from: 185000, to: 192000 },
  { from: 192000, to: 185000 },
  { from: 250000, to: 175000 },
  { from: 999999, to: 1250000 },
];

function generateRandomPairs(seed: number, count: number): AmountPair[] {
  const rng = createRng(seed);
  const pairs: AmountPair[] = [];
  for (let i = 0; i < count; i += 1) {
    // Rango amplio: de importes muy chicos a varios millones, para cubrir
    // aumentos, reducciones y saltos grandes sin ningún sesgo hacia los
    // valores de reproducción del caso original.
    const from = randInt(rng, 1, 5000000);
    let to = randInt(rng, 1, 5000000);
    if (to === from) to += 1; // nunca un "cambio" a sí mismo — no aporta a la matriz.
    pairs.push({ from, to });
  }
  return pairs;
}

// Corrección 2026-08-18 (a pedido de Joaquín — Fase 1 de "Estabilización
// final", simulación financiera aislada y general): sube de 100 a 200 pares
// pseudoaleatorios — el mínimo pedido explícitamente en esta ronda.
export const RANDOM_PAIRS = generateRandomPairs(MATRIX_SEED, 200);
export const ALL_PAIRS: AmountPair[] = [...FIXED_PAIRS, ...RANDOM_PAIRS];

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

function makeMonthlyProfile(id: string, amount: number): StudentProfile {
  return {
    id,
    name: `Ficticio ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    billingPlan: { type: 'monthly', amount, dueDay: 1 },
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
const NEXT_PERIOD = '2026-09';
const EVAL_DATE = '2026-08-05'; // día 5: en término (0% recargo) para no mezclar mora en la matriz base.
const NOW = new Date('2026-08-05T15:00:00.000Z');

/**
 * Regla invariable pedida: para CADA transición (sin pagos previos), deben
 * coincidir exactamente: importe efectivo del plan, importe original
 * exigible del cargo, importe mostrado en Cobros (misma función que usa
 * `CobrosTab`: `resolveEffectiveMonthlyAmount`), máximo seguro registrable,
 * y pago total sugerido.
 */
async function runTransitionThisMonth(studentId: string, from: number, to: number): Promise<void> {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, from) });

  await generateMonthlyChargesForCandidates([{ studentId, price: from }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const { plan: changePlan } = await correctMonthlyAmount(
    { studentId, newAmount: to, effectiveFrom: 'this_month', now: NOW },
    deps,
    profileDeps
  );
  assert(changePlan.chargeUpdated, `(${studentId} ${from}->${to} this_month) el cargo del mes debe actualizarse`);

  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  const effectiveAmount = resolveEffectiveMonthlyAmount(updatedPlan, PERIOD);
  assertEqual(effectiveAmount, to, `(${studentId} ${from}->${to}) importe efectivo del plan`);

  const state = controller.getSnapshot();
  const charge = state.charges.find((c) => c.billingPeriod === PERIOD && c.studentId === studentId)!;
  assertEqual(charge.originalAmount, to, `(${studentId} ${from}->${to}) importe original exigible del cargo`);

  // "Importe mostrado en Cobros": CobrosTab.tsx calcula `effectiveAmount` con
  // resolveEffectiveBillingAmount, que para un plan mensual delega
  // exactamente en esta misma llamada (resolveEffectiveMonthlyAmount sobre
  // el plan resuelto) — ver el comentario en CobrosTab.tsx y
  // `resolveEffectiveBillingAmount` en studentBillingPlan.ts.
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), to, `(${studentId} ${from}->${to}) importe mostrado en Cobros`);

  const maxSafe = calculateSafeAllocationCapacity(charge, [], EVAL_DATE, false);
  assertEqual(maxSafe, to, `(${studentId} ${from}->${to}) máximo seguro registrable sin pagos previos`);

  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: EVAL_DATE });
  const suggested = resolveSuggestedMonthlyPaymentAmount({
    plan: updatedPlan,
    charges: summary.charges,
    chargeStates: summary.chargeStates,
    evaluationDate: EVAL_DATE,
  });
  assertEqual(suggested.amount, to, `(${studentId} ${from}->${to}) pago total sugerido, sin pagos previos`);
}

// Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA: la cuota
// nueva no actualizaba el cargo abierto): `runTransitionThisMonth` de arriba
// SIEMPRE pre-genera el cargo antes de corregir — eso es exactamente lo que
// enmascaró la regresión real en todas las corridas previas de esta matriz.
// Este barrido repite los 210 pares SIN pre-generar el cargo (el período
// actual está impago Y sin ningún cargo materializado todavía — el escenario
// real reportado), y verifica el estado que vería RegisterPaymentSheet
// usando exactamente sus mismas funciones (buildStudentPaymentsSummary +
// calculateAssignableDebt), nunca una función pura aislada.
async function runTransitionThisMonthNoChargeYet(studentId: string, from: number, to: number): Promise<void> {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, from) });

  // Sin generar el cargo: el período actual queda impago y sin cargo
  // materializado — la situación real que expuso la regresión.
  assertEqual(controller.getSnapshot().charges.length, 0, `(${studentId} ${from}->${to}) precondición: sin cargo previo`);

  const { plan: changePlan } = await correctMonthlyAmount(
    { studentId, newAmount: to, effectiveFrom: 'this_month', now: NOW },
    deps,
    profileDeps
  );
  assert(changePlan.chargeUpdated, `(${studentId} ${from}->${to}) sin cargo previo: el cargo del período se crea en el acto`);
  assert(changePlan.chargeCreated, `(${studentId} ${from}->${to}) el cargo se marca como recién creado`);

  const state = controller.getSnapshot();
  assertEqual(state.charges.filter((c) => c.studentId === studentId).length, 1, `(${studentId} ${from}->${to}) exactamente un cargo creado, nunca más`);
  const charge = state.charges.find((c) => c.billingPeriod === PERIOD && c.studentId === studentId)!;
  assertEqual(charge.originalAmount, to, `(${studentId} ${from}->${to}) el cargo nace directamente con el importe nuevo`);

  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), to, `(${studentId} ${from}->${to}) el plan efectivo coincide con el cargo`);

  // Estado REAL de RegisterPaymentSheet: mismas dos funciones que usa ese
  // componente, nunca un cálculo paralelo para la prueba.
  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: EVAL_DATE });
  assertEqual(summary.chargeStates[0].originalAmount, to, `(${studentId} ${from}->${to}) RegisterPaymentSheet: importe original ya es el nuevo`);
  assertEqual(summary.chargeStates[0].balance, to, `(${studentId} ${from}->${to}) RegisterPaymentSheet: saldo ya es el nuevo importe completo`);
  const assignable = calculateAssignableDebt({ studentId, state, evaluationDate: EVAL_DATE });
  assertEqual(assignable, to, `(${studentId} ${from}->${to}) RegisterPaymentSheet: máximo registrable ya es el nuevo importe — nunca el viejo`);
}

async function runTransitionNextMonth(studentId: string, from: number, to: number): Promise<void> {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, from) });

  await generateMonthlyChargesForCandidates([{ studentId, price: from }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);

  const { plan: changePlan } = await correctMonthlyAmount(
    { studentId, newAmount: to, effectiveFrom: 'next_month', now: NOW },
    deps,
    profileDeps
  );
  assert(!changePlan.chargeUpdated, `(${studentId} ${from}->${to} next_month) el cargo del mes actual NUNCA se toca`);

  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), from, `(${studentId} ${from}->${to} next_month) el mes actual conserva el importe viejo`);
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, NEXT_PERIOD), to, `(${studentId} ${from}->${to} next_month) el próximo mes ya usa el importe nuevo`);

  const state = controller.getSnapshot();
  const charge = state.charges.find((c) => c.billingPeriod === PERIOD && c.studentId === studentId)!;
  assertEqual(charge.originalAmount, from, `(${studentId} ${from}->${to} next_month) el cargo actual conserva su importe original`);

  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: EVAL_DATE });
  const suggestedThisMonth = resolveSuggestedMonthlyPaymentAmount({
    plan: updatedPlan,
    charges: summary.charges,
    chargeStates: summary.chargeStates,
    evaluationDate: EVAL_DATE,
  });
  assertEqual(suggestedThisMonth.amount, from, `(${studentId} ${from}->${to} next_month) pagar el mes actual sigue proponiendo el importe viejo`);
}

ALL_PAIRS.forEach((pair, index) => {
  asyncTest(`matriz #${index + 1}: $${pair.from} -> $${pair.to} ("este mes")`, async () => {
    await runTransitionThisMonth(`qa_finanzas_montos_tm_${index}`, pair.from, pair.to);
  });
  asyncTest(`matriz #${index + 1}: $${pair.from} -> $${pair.to} ("próximo mes")`, async () => {
    await runTransitionNextMonth(`qa_finanzas_montos_nm_${index}`, pair.from, pair.to);
  });
  asyncTest(`matriz #${index + 1}: $${pair.from} -> $${pair.to} ("este mes", SIN cargo previo — el escenario real de la regresión)`, async () => {
    await runTransitionThisMonthNoChargeYet(`qa_finanzas_montos_nc_${index}`, pair.from, pair.to);
  });
});

test(`la matriz cubre exactamente 210 pares (10 fijos + 200 pseudoaleatorios, semilla ${MATRIX_SEED})`, () => {
  assertEqual(FIXED_PAIRS.length, 10, 'diez pares fijos exactos');
  assertEqual(RANDOM_PAIRS.length, 200, 'doscientos pares pseudoaleatorios exactos (mínimo pedido en Fase 1)');
  assertEqual(ALL_PAIRS.length, 210, 'doscientos diez transiciones en total');
});

test('la matriz incluye aumentos, reducciones y saltos grandes (nunca sólo un tipo de transición)', () => {
  const increases = ALL_PAIRS.filter((p) => p.to > p.from).length;
  const decreases = ALL_PAIRS.filter((p) => p.to < p.from).length;
  assert(increases > 0, 'debe haber al menos un aumento');
  assert(decreases > 0, 'debe haber al menos una reducción');
  const bigJumps = ALL_PAIRS.filter((p) => Math.abs(p.to - p.from) > p.from).length;
  assert(bigJumps > 0, 'debe haber al menos un cambio donde el nuevo importe sea muy distinto del anterior');
});

// ---------------------------------------------------------------------------
// PROPIEDADES GENERATIVAS
// ---------------------------------------------------------------------------

test('propiedad: para cualquier entero positivo aceptado por el dominio, planMonthlyAmountChange conserva exactamente ese importe (sin cargo previo)', () => {
  const rng = createRng(MATRIX_SEED + 1);
  for (let i = 0; i < 200; i += 1) {
    const amount = randInt(rng, 1, 10000000);
    const plan = planMonthlyAmountChange({
      studentId: 'qa_finanzas_montos_prop1',
      currentBillingPeriod: PERIOD,
      newAmount: amount,
      effectiveFrom: 'this_month',
      existingCharges: [],
      existingCharge: null,
      currentChargeState: null,
      createdAt: `${PERIOD}-05T00:00:00.000Z`,
    });
    assertEqual(plan.newAmount, amount, `propiedad de conservación exacta para ${amount}`);
    assertEqual(plan.planPatch.amount, amount, `planPatch.amount exacto para ${amount}`);
  }
});

test('propiedad: nunca se aceptan decimales, negativos, NaN, Infinity, cero ni valores fuera del límite admitido (rechazo ANTES de persistir)', () => {
  const invalidValues: Array<number | null> = [0, -1, -100, 1.5, NaN, Infinity, -Infinity, null, Number.MAX_VALUE];
  invalidValues.forEach((value) => {
    const validation = validateAmountInput(value);
    assert(!validation.isValid, `${String(value)} debe rechazarse por validateAmountInput`);
  });

  // La capa de dominio (planMonthlyAmountChange) es la segunda barrera —
  // nunca persiste un importe inválido aunque alguien la llame directo,
  // saltándose la validación de la UI.
  [0, -1, 1.5, NaN, Infinity].forEach((value) => {
    let threw = false;
    try {
      planMonthlyAmountChange({
        studentId: 'qa_finanzas_montos_prop2',
        currentBillingPeriod: PERIOD,
        newAmount: value,
        effectiveFrom: 'this_month',
        existingCharges: [],
        existingCharge: null,
        currentChargeState: null,
        createdAt: `${PERIOD}-05T00:00:00.000Z`,
      });
    } catch {
      threw = true;
    }
    assert(threw, `planMonthlyAmountChange debe rechazar ${String(value)} aunque no pase por la UI`);
  });
});

asyncTest('propiedad: cambiar el monto (este mes o próximo mes) nunca modifica pagos históricos ya registrados', async () => {
  const rng = createRng(MATRIX_SEED + 2);
  for (let i = 0; i < 20; i += 1) {
    const from = randInt(rng, 1000, 500000);
    const to = randInt(rng, 1000, 500000);
    if (to === from) continue;
    const studentId = `qa_finanzas_montos_prop3_${i}`;

    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const { deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, from) });

    // Mes anterior, ya con un pago histórico completo — nunca debe tocarse.
    await generateMonthlyChargesForCandidates([{ studentId, price: from }], '2026-07', '2026-07-01T09:00:00.000Z', deps);
    await registerPaymentForStudent({ studentId, amount: from, method: 'efectivo', paidAt: '2026-07-03', now: new Date('2026-07-03T12:00:00.000Z') }, deps);
    const historicalPaymentBefore = controller.getSnapshot().payments.find((p) => p.studentId === studentId)!;

    await generateMonthlyChargesForCandidates([{ studentId, price: from }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
    await correctMonthlyAmount({ studentId, newAmount: to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

    const historicalPaymentAfter = controller.getSnapshot().payments.find((p) => p.id === historicalPaymentBefore.id)!;
    assertEqual(historicalPaymentAfter.amount, historicalPaymentBefore.amount, `(${studentId}) el pago histórico de julio nunca cambia de importe`);
    assertEqual(historicalPaymentAfter.paidAt, historicalPaymentBefore.paidAt, `(${studentId}) el pago histórico nunca cambia de fecha`);
    assertEqual(historicalPaymentAfter.voidedAt, historicalPaymentBefore.voidedAt, `(${studentId}) el pago histórico nunca queda anulado por un cambio de monto`);
  }
});

asyncTest('propiedad: repetir la MISMA corrección (mismo importe, misma vigencia) es idempotente en el resultado final observable — nunca duplica cargos', async () => {
  const rng = createRng(MATRIX_SEED + 3);
  for (let i = 0; i < 15; i += 1) {
    const from = randInt(rng, 1000, 900000);
    const to = randInt(rng, 1000, 900000);
    if (to === from) continue;
    const studentId = `qa_finanzas_montos_prop4_${i}`;

    const { adapter } = makeFakeAdapter();
    const controller = createPaymentsStoreController(adapter);
    const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
    const { deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, from) });

    await generateMonthlyChargesForCandidates([{ studentId, price: from }], PERIOD, `${PERIOD}-01T09:00:00.000Z`, deps);
    await correctMonthlyAmount({ studentId, newAmount: to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
    const chargesAfterFirst = controller.getSnapshot().charges.filter((c) => c.studentId === studentId);
    assertEqual(chargesAfterFirst.length, 1, `(${studentId}) un único cargo tras la primera corrección`);

    // Repetir exactamente la misma corrección (mismo importe ya vigente):
    // no debe crear un segundo cargo ni un segundo cambio real.
    await correctMonthlyAmount({ studentId, newAmount: to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
    const chargesAfterSecond = controller.getSnapshot().charges.filter((c) => c.studentId === studentId);
    assertEqual(chargesAfterSecond.length, 1, `(${studentId}) repetir la misma corrección nunca duplica el cargo`);
    assertEqual(chargesAfterSecond[0].originalAmount, to, `(${studentId}) el importe final sigue siendo el correcto`);
  }
});
