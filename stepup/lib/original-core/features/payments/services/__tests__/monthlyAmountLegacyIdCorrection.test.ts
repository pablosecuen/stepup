// Puerto VERBATIM del original (`src/features/payments/services/__tests__/monthlyAmountLegacyIdCorrection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
 * mensual y obligación desincronizadas, cualquier alumno/monto/período):
 * `monthlyAmountCorrectionService.ts` ya buscaba el cargo vigente por
 * identidad SEMÁNTICA (alumno + `mensual` + billingPeriod + no anulado) para
 * calcular `currentChargeState` — pero `planMonthlyAmountChange` volvía a
 * buscarlo por `buildMonthlyChargeId`, exclusivamente. Un cargo real con
 * OTRO id (creado por una versión anterior del sistema, o por cualquier otro
 * camino) quedaba invisible para esa segunda búsqueda: la función entraba a
 * la rama "sin cargo vigente" y CREABA un segundo cargo con el importe
 * nuevo, dejando el cargo real (viejo, con el importe anterior) intacto —
 * exactamente el bug reportado (plan $168.000, "Registrar pago del mes"
 * seguía proponiendo $160.000 del cargo legacy).
 *
 * Este archivo prueba el recorrido REAL — `correctMonthlyAmount`, el mismo
 * servicio que llama `EditMonthlyAmountSheet` — contra cargos con id
 * LEGACY (nunca generados por `buildMonthlyChargeId`), algo que ninguna
 * prueba anterior de este proyecto ejercitaba (todas usaban exclusivamente
 * el id determinístico, por eso el gap real nunca se detectó). Identidad
 * ficticia aislada: `qa_finanzas_legacy_*`. $160.000/$168.000 sólo aparecen
 * en el caso de aceptación explícito (caso 1) — el resto de los casos usa
 * importes arbitrarios distintos a propósito.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { registerPaymentForStudent } from '../registerPaymentService.ts';
import { correctMonthlyAmount, type CorrectMonthlyAmountProfileDeps, type CorrectMonthlyAmountStoreDeps } from '../monthlyAmountCorrectionService.ts';
import { planDuplicateMonthlyChargeRepair } from '../../utils/financialReconciliation.ts';
import { resolveEffectiveMonthlyAmount } from '../../../student-profile/utils/studentBillingPlan.ts';
import { resolveSuggestedMonthlyPaymentAmount } from '../../utils/monthlyPeriodStatus.ts';
import { calculateAssignableDebt } from '../../utils/registerPaymentPlan.ts';
import { buildStudentPaymentsSummary } from '../../utils/studentPaymentsSummary.ts';
import type { MonthlyBillingPlan, StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// PRNG determinista local (mulberry32) — misma fórmula que el resto de las
// matrices de este módulo (`monthlyAmountMatrix.test.ts`), reimplementada
// acá localmente por el mismo motivo (aislamiento de tsconfig).
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

function makeMonthlyProfile(id: string, amount: number, extra: Partial<StudentProfile> = {}): StudentProfile {
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
    ...extra,
  };
}

function makeFakeProfileStore(initial: Record<string, StudentProfile> = {}) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: CorrectMonthlyAmountProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

/** Un cargo mensual con un id LEGACY — a propósito nunca `buildMonthlyChargeId(...)`. */
function legacyMonthlyCharge(overrides: Partial<PaymentCharge> & { id: string; studentId: string; billingPeriod: string }): PaymentCharge {
  return {
    type: 'mensual',
    currency: 'ARS',
    originalAmount: 20000,
    dueDate: `${overrides.billingPeriod}-01`,
    createdAt: `${overrides.billingPeriod}-01T09:00:00.000Z`,
    calendarLessonId: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

const PERIOD = '2026-08';
const NOW = new Date('2026-08-05T15:00:00.000Z'); // día 5: en término, sin recargo de por medio.

async function setupWithLegacyCharge(studentId: string, planAmount: number, legacyChargeAmount: number, legacyId: string) {
  const { adapter, store } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  const deps: CorrectMonthlyAmountStoreDeps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, planAmount) });
  const legacyCharge = legacyMonthlyCharge({ id: legacyId, studentId, billingPeriod: PERIOD, originalAmount: legacyChargeAmount });
  return { adapter, store, controller, deps, profiles, profileDeps, legacyCharge };
}

// ---------------------------------------------------------------------------
// Los 13 casos obligatorios pedidos.
// ---------------------------------------------------------------------------

// 1. Cargo impago con ID antiguo: $160.000 → $168.000 (caso de aceptación real).
asyncTest('caso 1 (ACEPTACIÓN): cargo impago con ID LEGACY $160.000 → corregir a $168.000 actualiza el MISMO cargo, nunca crea uno nuevo', async () => {
  const studentId = 'qa_finanzas_legacy_c1';
  const legacyId = 'obligacion_generada_por_una_version_anterior_del_sistema';
  const { controller, deps, profiles, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 160000, 160000, legacyId);
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 168000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  assertEqual(plan.chargeUpdated, true, 'el cargo real (id legacy) se actualiza');
  assertEqual(plan.chargeCreated, false, 'NUNCA se crea un segundo cargo — ya existía uno real, aunque con otro id');
  assertEqual(plan.chargeId, legacyId, 'el plan reporta el id REAL del cargo corregido, nunca uno inventado');

  const state = controller.getSnapshot();
  assertEqual(state.charges.filter((c) => c.studentId === studentId).length, 1, 'un único cargo mensual vigente para agosto');
  const finalCharge = state.charges[0];
  assertEqual(finalCharge.id, legacyId, 'sigue siendo el MISMO cargo real, id legacy intacto');
  assertEqual(finalCharge.originalAmount, 168000, 'obligación agosto: original $168.000');

  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 168000, 'monto mensual actual: $168.000');

  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].originalAmount, 168000, 'obligación agosto: original $168.000 (vista Cobros/Registrar pago)');
  assertEqual(summary.chargeStates[0].balance, 168000, 'obligación agosto: saldo $168.000');
  const assignable = calculateAssignableDebt({ studentId, state, evaluationDate: '2026-08-05' });
  assertEqual(assignable, 168000, 'Registrar pago del mes: importe sugerido $168.000, nunca $160.000');
});

// 2. Cualquier aumento (con id legacy).
asyncTest('caso 2: aumento sobre cargo con id legacy', async () => {
  const studentId = 'qa_finanzas_legacy_c2';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 30000, 30000, 'vieja_obligacion_2');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 45000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeCreated, false, 'actualiza el cargo legacy existente');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 45000, 'aumento aplicado sobre el cargo real');
});

// 3. Cualquier reducción válida (con id legacy).
asyncTest('caso 3: reducción válida sobre cargo con id legacy, sin pagos', async () => {
  const studentId = 'qa_finanzas_legacy_c3';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 90000, 90000, 'vieja_obligacion_3');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeCreated, false, 'actualiza el cargo legacy existente');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 60000, 'reducción aplicada sobre el cargo real');
});

// 4. Pago parcial y aumento (con id legacy).
asyncTest('caso 4: pago parcial sobre cargo legacy + aumento — el saldo se recalcula contra el nuevo importe', async () => {
  const studentId = 'qa_finanzas_legacy_c4';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 50000, 50000, 'vieja_obligacion_4');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  await registerPaymentForStudent({ studentId, amount: 20000, method: 'efectivo', paidAt: '2026-08-03', now: NOW }, deps);

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 80000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeCreated, false, 'sigue siendo el mismo cargo legacy');
  const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].originalAmount, 80000, 'importe corregido');
  assertEqual(summary.chargeStates[0].balance, 60000, 'saldo: 80.000 - 20.000 ya pagados');
});

// 5. Reducción igual a lo ya pagado (con id legacy).
asyncTest('caso 5: reducir exactamente a lo ya pagado sobre cargo legacy — se acepta, saldo $0', async () => {
  const studentId = 'qa_finanzas_legacy_c5';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 90000, 90000, 'vieja_obligacion_5');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  await registerPaymentForStudent({ studentId, amount: 60000, method: 'efectivo', paidAt: '2026-08-03', now: NOW }, deps);

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 60000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, true, 'reducir exactamente a lo ya pagado se acepta');
  const summary = buildStudentPaymentsSummary({ studentId, state: controller.getSnapshot(), evaluationDate: '2026-08-05' });
  assertEqual(summary.chargeStates[0].balance, 0, 'saldo final $0, nunca negativo');
});

// 6. Reducción menor a lo pagado: rechazar sin mutaciones (con id legacy).
asyncTest('caso 6: reducir por debajo de lo ya pagado sobre cargo legacy — se rechaza, SIN mutaciones', async () => {
  const studentId = 'qa_finanzas_legacy_c6';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 90000, 90000, 'vieja_obligacion_6');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  await registerPaymentForStudent({ studentId, amount: 70000, method: 'efectivo', paidAt: '2026-08-03', now: NOW }, deps);

  const beforeState = controller.getSnapshot();
  let rejectedMessage = '';
  try {
    await correctMonthlyAmount({ studentId, newAmount: 50000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch (error) {
    rejectedMessage = error instanceof Error ? error.message : String(error);
  }
  assert(/no puede ser menor a lo ya pagado/.test(rejectedMessage), 'nunca se acepta un importe menor a lo ya asignado');
  const afterState = controller.getSnapshot();
  assertEqual(afterState.charges[0].originalAmount, beforeState.charges[0].originalAmount, 'el cargo legacy queda intacto, sin mutación parcial');
  assertEqual(JSON.stringify(afterState), JSON.stringify(beforeState), 'ninguna mutación ocurrió — el rechazo es atómico');
});

// 7. Período totalmente pagado: no reescribir (con id legacy).
asyncTest('caso 7: cargo legacy ya saldado por completo — "este mes" se rechaza, nunca reescribe historia', async () => {
  const studentId = 'qa_finanzas_legacy_c7';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 40000, 40000, 'vieja_obligacion_7');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));
  await registerPaymentForStudent({ studentId, amount: 40000, method: 'efectivo', paidAt: '2026-08-03', now: NOW }, deps);

  let rejectedMessage = '';
  try {
    await correctMonthlyAmount({ studentId, newAmount: 55000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  } catch (error) {
    rejectedMessage = error instanceof Error ? error.message : String(error);
  }
  assert(/ya está pagado/.test(rejectedMessage), 'un cargo legacy saldado nunca se reescribe silenciosamente');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'el importe histórico real queda intacto');
});

// 8. Cambio desde próximo mes (con id legacy).
asyncTest('caso 8: "próximo mes" sobre cargo legacy — el cargo actual NUNCA se toca, el cambio queda pendiente', async () => {
  const studentId = 'qa_finanzas_legacy_c8';
  const { controller, deps, profiles, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 35000, 35000, 'vieja_obligacion_8');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 52000, effectiveFrom: 'next_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeUpdated, false, 'el cargo legacy del mes actual no se toca');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 35000, 'agosto conserva su importe legacy original');
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, '2026-09'), 52000, 'septiembre ya usa el importe nuevo');
});

// 9. Cargo anulado (con id legacy): nunca se confunde con el vigente.
asyncTest('caso 9: cargo legacy ANULADO del mismo período — nunca se lo confunde con un cargo vigente, se crea uno nuevo real', async () => {
  const studentId = 'qa_finanzas_legacy_c9';
  const { controller, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 25000, 25000, 'vieja_obligacion_9');
  const voidedLegacy: PaymentCharge = { ...legacyCharge, voidedAt: '2026-08-02T00:00:00.000Z', voidReason: 'anulado por error de carga' };
  await controller.applyMutation((current) => ({ ...current, charges: [voidedLegacy] }));

  const { plan } = await correctMonthlyAmount({ studentId, newAmount: 40000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(plan.chargeCreated, true, 'un cargo anulado nunca cuenta como "vigente" — se crea uno real nuevo');
  const state = controller.getSnapshot();
  const activeCharge = state.charges.find((c) => c.voidedAt === null)!;
  assertEqual(activeCharge.originalAmount, 40000, 'el cargo nuevo nace con el importe corregido');
  const stillVoided = state.charges.find((c) => c.id === legacyCharge.id)!;
  assertEqual(stillVoided.voidedAt, voidedLegacy.voidedAt, 'el cargo anulado queda intacto, nunca se revive ni se le cambia el importe');
});

// 10. Dos cargos semánticamente duplicados: detectar y no crear un tercero.
asyncTest('caso 10: dos cargos legacy semánticamente duplicados (mismo alumno+período, ids distintos) — corregir el monto nunca crea un TERCERO', async () => {
  const studentId = 'qa_finanzas_legacy_c10';
  const { controller, deps, profileDeps } = await setupWithLegacyCharge(studentId, 30000, 30000, 'vieja_obligacion_10a');
  const chargeA = legacyMonthlyCharge({ id: 'vieja_obligacion_10a', studentId, billingPeriod: PERIOD, originalAmount: 30000, createdAt: `${PERIOD}-01T09:00:00.000Z` });
  const chargeB = legacyMonthlyCharge({ id: 'vieja_obligacion_10b', studentId, billingPeriod: PERIOD, originalAmount: 30000, createdAt: `${PERIOD}-01T09:05:00.000Z` });
  await controller.applyMutation((current) => ({ ...current, charges: [chargeA, chargeB] }));

  await correctMonthlyAmount({ studentId, newAmount: 44000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
  assertEqual(
    controller.getSnapshot().charges.filter((c) => c.studentId === studentId).length,
    2,
    'sigue habiendo exactamente dos cargos — nunca se crea un tercero al corregir el monto'
  );

  // La reparación de duplicados (ya wireada automáticamente en App.tsx) es
  // la que resuelve la ambigüedad — se prueba acá que, combinada con la
  // corrección de monto, el resultado final NUNCA excede un único cargo
  // vigente para el período.
  const repairPlan = planDuplicateMonthlyChargeRepair({ state: controller.getSnapshot(), voidedAt: '2026-08-06T00:00:00.000Z' });
  assertEqual(repairPlan.actions.length, 1, 'la reparación de duplicados detecta el par y decide sin ambigüedad (ninguno tiene pagos)');
  const afterRepair = repairPlan.updatedCharges.filter((c) => c.studentId === studentId && c.voidedAt === null);
  assertEqual(afterRepair.length, 1, 'tras la reparación automática, un único cargo mensual vigente para el período');
});

// 11. Persistencia después de hidratar nuevamente (con id legacy).
asyncTest('caso 11: corregir un cargo legacy persiste tras cerrar y volver a abrir (nueva hidratación)', async () => {
  const studentId = 'qa_finanzas_legacy_c11';
  const { adapter, deps, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 55000, 55000, 'vieja_obligacion_11');
  const firstOpen = createPaymentsStoreController(adapter);
  await firstOpen.hydrate();
  await firstOpen.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));

  await correctMonthlyAmount(
    { studentId, newAmount: 71000, effectiveFrom: 'this_month', now: NOW },
    { hydrate: firstOpen.hydrate, applyMutation: firstOpen.applyMutation },
    profileDeps
  );

  const secondOpen = createPaymentsStoreController(adapter);
  const rehydrated = await secondOpen.hydrate();
  assertEqual(rehydrated.charges.length, 1, 'un único cargo tras re-hidratar');
  assertEqual(rehydrated.charges[0].id, legacyCharge.id, 'sigue siendo el mismo cargo legacy, mismo id de siempre');
  assertEqual(rehydrated.charges[0].originalAmount, 71000, 'el importe corregido sobrevive a la re-hidratación');
  void deps; // el controlador usado en la corrección es firstOpen, no deps (ver arriba).
});

// 12. Actualización inmediata en Cobros y Registrar pago (con id legacy).
asyncTest('caso 12: tras corregir un cargo legacy, Cobros (CobrosTab) y Registrar pago (RegisterPaymentSheet) reflejan el nuevo importe de inmediato', async () => {
  const studentId = 'qa_finanzas_legacy_c12';
  const { controller, deps, profiles, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, 62000, 62000, 'vieja_obligacion_12');
  await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));

  await correctMonthlyAmount({ studentId, newAmount: 88000, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);

  const state = controller.getSnapshot();
  const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;

  // Cobros (CobrosTab.tsx): resolveEffectiveMonthlyAmount + resolveSuggestedMonthlyPaymentAmount.
  assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), 88000, 'Cobros: monto mensual actual ya es el nuevo');
  const summary = buildStudentPaymentsSummary({ studentId, state, evaluationDate: '2026-08-05' });
  const suggested = resolveSuggestedMonthlyPaymentAmount({ plan: updatedPlan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: '2026-08-05' });
  assertEqual(suggested.amount, 88000, 'Cobros: "Marcar mes actual como pagado" ya propone el nuevo importe');

  // Registrar pago (RegisterPaymentSheet.tsx): buildStudentPaymentsSummary + calculateAssignableDebt.
  assertEqual(summary.chargeStates[0].originalAmount, 88000, 'Registrar pago: importe original ya es el nuevo');
  const assignable = calculateAssignableDebt({ studentId, state, evaluationDate: '2026-08-05' });
  assertEqual(assignable, 88000, 'Registrar pago: importe sugerido/máximo registrable ya es el nuevo, nunca el legacy ($62.000)');
});

// ---------------------------------------------------------------------------
// 13. Matriz de 200+ pares pseudoaleatorios — TODOS con cargos de id LEGACY
// (nunca `buildMonthlyChargeId`), sin ningún monto hardcodeado como
// "solución" — el mismo par sirve para cualquier alumno.
// ---------------------------------------------------------------------------

const MATRIX_SEED = 731731;
interface AmountPair {
  from: number;
  to: number;
}
function generateRandomPairs(seed: number, count: number): AmountPair[] {
  const rng = createRng(seed);
  const pairs: AmountPair[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = randInt(rng, 1, 5000000);
    let to = randInt(rng, 1, 5000000);
    if (to === from) to += 1;
    pairs.push({ from, to });
  }
  return pairs;
}
const LEGACY_MATRIX_PAIRS = generateRandomPairs(MATRIX_SEED, 210);

test(`la matriz de ids legacy cubre 210 pares pseudoaleatorios (semilla ${MATRIX_SEED})`, () => {
  assertEqual(LEGACY_MATRIX_PAIRS.length, 210, 'doscientos diez pares');
});

LEGACY_MATRIX_PAIRS.forEach((pair, index) => {
  asyncTest(`matriz id legacy #${index + 1}: $${pair.from} -> $${pair.to} sobre cargo con id no-determinístico`, async () => {
    const studentId = `qa_finanzas_legacy_matrix_${index}`;
    const legacyId = `obligacion_legacy_generada_externamente_${index}_${pair.from}`;
    const { controller, deps, profiles, profileDeps, legacyCharge } = await setupWithLegacyCharge(studentId, pair.from, pair.from, legacyId);
    await controller.applyMutation((current) => ({ ...current, charges: [legacyCharge] }));

    const { plan } = await correctMonthlyAmount({ studentId, newAmount: pair.to, effectiveFrom: 'this_month', now: NOW }, deps, profileDeps);
    assertEqual(plan.chargeCreated, false, `(#${index + 1}) el cargo legacy real se actualiza, nunca se crea uno segundo`);
    assertEqual(plan.chargeId, legacyId, `(#${index + 1}) conserva el id real del cargo`);

    const state = controller.getSnapshot();
    assertEqual(state.charges.filter((c) => c.studentId === studentId).length, 1, `(#${index + 1}) un único cargo, nunca dos`);
    assertEqual(state.charges[0].originalAmount, pair.to, `(#${index + 1}) importe corregido en el cargo real`);

    const updatedPlan = profiles.get(studentId)!.billingPlan as MonthlyBillingPlan;
    assertEqual(resolveEffectiveMonthlyAmount(updatedPlan, PERIOD), pair.to, `(#${index + 1}) plan efectivo coincide con el cargo`);

    const assignable = calculateAssignableDebt({ studentId, state, evaluationDate: '2026-08-05' });
    assertEqual(assignable, pair.to, `(#${index + 1}) Registrar pago propone el importe nuevo, nunca el legacy ($${pair.from})`);
  });
});
