// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/firstMonthProrationReviewNeeds.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
 * CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): `needs_manual_review`
 * (ronda anterior) protegía correctamente el dato, pero no dejaba ninguna
 * acción visible — el cargo histórico seguía en la cuota completa, sin
 * forma de que la profesora indicara la proporción correcta. Pruebas de las
 * dos funciones puras nuevas (`findFirstMonthProrationReviewNeeds`,
 * `buildFirstMonthProrationSuggestionFromDecision`) y del flujo de punta a
 * punta real (confirmar 2 de 4 → media cuota, mismo cargo, `source: 'manual'`)
 * — con adaptadores en memoria, nunca AsyncStorage/Supabase reales, sólo
 * identidades `qa_*` e importes/fechas genéricos.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { confirmFirstMonthProration, FirstMonthProrationHasMovementsError, type ConfirmFirstMonthProrationProfileDeps } from '../../services/firstMonthProrationService.ts';
import { buildFirstMonthProrationSuggestionFromDecision, computeProportionalAmount, findFirstMonthProrationReviewNeeds } from '../firstMonthProration.ts';
import { buildMonthlyChargeId } from '../paymentIdempotency.ts';
import { buildMonthlyCharge, allocatePayment, recordPayment } from '../paymentMutations.ts';
import type { FirstMonthProrationDecision, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function makeFakeAdapter(initial: PaymentsRepositoryState = emptyPaymentsState()) {
  const store = { persisted: initial };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

function makeFakeProfileStore(initial: Record<string, StudentProfile> = {}) {
  const profiles = new Map<string, StudentProfile>(Object.entries(initial));
  const deps: ConfirmFirstMonthProrationProfileDeps = {
    getProfile: (studentId) => profiles.get(studentId) ?? null,
    saveProfile: async (profile) => {
      profiles.set(profile.id, profile);
    },
  };
  return { profiles, deps };
}

function makeMonthlyProfile(id: string, amount: number): StudentProfile {
  return {
    id,
    name: `Alumna ficticia ${id}`,
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

function decision(
  overrides: Partial<FirstMonthProrationDecision> & { id: string; studentId: string; billingPeriod: string; chargeId: string | null }
): FirstMonthProrationDecision {
  return {
    effectiveJoinDate: `${overrides.billingPeriod}-18`,
    criterion: 'proportional',
    classesRemaining: 2,
    classesPerFullPeriod: 4,
    permanentMonthlyAmount: 80000,
    chargedAmount: 80000,
    createdAt: '2026-08-18T09:00:00.000Z',
    confirmedAt: '2026-08-18T09:00:00.000Z',
    ...overrides,
  };
}

function fakeDecisionLog(initial: FirstMonthProrationDecision[] = []) {
  let entries = [...initial];
  return {
    entries: () => entries,
    appendDecision: async (entry: FirstMonthProrationDecision) => {
      entries = [...entries, entry];
    },
  };
}

// ---------------------------------------------------------------------------
// buildFirstMonthProrationSuggestionFromDecision
// ---------------------------------------------------------------------------

test('buildFirstMonthProrationSuggestionFromDecision: reconstruye la sugerencia exacta a partir de los campos ya congelados de la decisión', () => {
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId: 'c1', classesRemaining: 2, classesPerFullPeriod: 4, permanentMonthlyAmount: 80000 });
  const suggestion = buildFirstMonthProrationSuggestionFromDecision(d);
  assertEqual(suggestion.studentId, 'qa_s1', '');
  assertEqual(suggestion.billingPeriod, '2026-08', '');
  assertEqual(suggestion.effectiveJoinDate, '2026-08-18', '');
  assertEqual(suggestion.classesRemaining, 2, '');
  assertEqual(suggestion.classesPerFullPeriod, 4, '');
  assertEqual(suggestion.permanentMonthlyAmount, 80000, '');
  assertEqual(suggestion.proportionalAmount, computeProportionalAmount(80000, 2, 4), 'misma fórmula canónica, nunca otra');
});

// ---------------------------------------------------------------------------
// findFirstMonthProrationReviewNeeds
// ---------------------------------------------------------------------------

test('un cargo mensual sin ninguna decisión asociada nunca aparece como necesitando revisión', () => {
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [], charges: [charge], allocations: [] });
  assertEqual(needs.length, 0, 'sin decisión: nada que revisar');
});

test('decisión de origen AMBIGUO (sin source, criterion proportional) con cargo real vigente: aparece como necesitando revisión', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [charge], allocations: [] });
  assertEqual(needs.length, 1, 'origen ambiguo: necesita revisión');
  assertEqual(needs[0].chargeId, charge.id, 'apunta al cargo real correcto');
  assertEqual(needs[0].hasMovements, false, 'sin pagos ni asignaciones');
});

test('decisión MANUAL válida nunca aparece como necesitando revisión', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, source: 'manual' });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [charge], allocations: [] });
  assertEqual(needs.length, 0, 'decisión manual válida: nunca se ofrece revisión innecesaria');
});

test('decisión AUTOMÁTICA válida nunca aparece como necesitando revisión', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, source: 'automatic' });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [charge], allocations: [] });
  assertEqual(needs.length, 0, 'decisión automática válida: nunca se ofrece revisión');
});

test('decisión ambigua cuyo cargo ya no existe (anulado o eliminado): nunca aparece — no hay nada real que reparar', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const voided = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [{ ...voided, voidedAt: '2026-08-19T00:00:00.000Z', voidReason: 'motivo' }], allocations: [] });
  assertEqual(needs.length, 0, 'sin cargo real vigente: nada que reparar desde acá');
});

test('con varias decisiones para el mismo (alumno, período), sólo se evalúa la MÁS RECIENTE', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const older = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, confirmedAt: '2026-08-18T09:00:00.000Z' });
  const newerManual = decision({
    id: 'd2',
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    chargeId,
    source: 'manual',
    confirmedAt: '2026-08-19T09:00:00.000Z',
  });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [older, newerManual], charges: [charge], allocations: [] });
  assertEqual(needs.length, 0, 'la más reciente es manual: la ambigua vieja queda superada, nunca se vuelve a ofrecer');
});

test('la acción aparece sin importar qué tan viejo sea el período — la función nunca recibe ni usa "ahora"', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2020-01');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2020-01', dueDate: '2020-01-18', originalAmount: 50000, createdAt: '2020-01-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2020-01', chargeId, permanentMonthlyAmount: 50000, chargedAmount: 50000 });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [charge], allocations: [] });
  assertEqual(needs.length, 1, 'un período de hace años sigue siendo elegible — ninguna fecha "actual" entra en juego');
});

test('una mensualidad histórica que NO es el primer mes (sin decisión propia) nunca aparece, aunque el alumno tenga otra decisión de otro período', () => {
  const augustChargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const augustCharge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const septemberCharge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-09', dueDate: '2026-09-01', originalAmount: 80000, createdAt: '2026-09-01T09:00:00.000Z', existingCharges: [augustCharge] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId: augustChargeId });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [augustCharge, septemberCharge], allocations: [] });
  assertEqual(needs.length, 1, 'sólo agosto (con su propia decisión) aparece');
  assertEqual(needs[0].chargeId, augustCharge.id, 'nunca setiembre, que no tiene ninguna decisión propia');
});

test('un cargo con pagos/asignaciones reales igual aparece (visibilidad), marcado con hasMovements — la confirmación real sigue protegida aparte', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId });
  const paymentRecord = recordPayment({ id: 'p1', studentId: 'qa_s1', amount: 30000, method: 'efectivo', paidAt: '2026-08-19', recordedAt: '2026-08-19T10:00:00.000Z', todayDateKey: '2026-08-19' });
  const alloc = allocatePayment({ id: 'a1', paymentId: 'p1', chargeId, amount: 30000, state: { ...emptyPaymentsState(), charges: [charge], payments: [paymentRecord] } });
  const needs = findFirstMonthProrationReviewNeeds({ decisions: [d], charges: [charge], allocations: [alloc] });
  assertEqual(needs.length, 1, 'la acción sigue visible — la profesora puede al menos inspeccionar');
  assertEqual(needs[0].hasMovements, true, 'marca correctamente que tiene movimientos reales');
});

test('ejecutar la detección varias veces sobre los mismos datos nunca duplica avisos (pura, idempotente)', () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const charge = buildMonthlyCharge({ studentId: 'qa_s1', billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: 80000, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
  const d = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId });
  const input = { decisions: [d], charges: [charge], allocations: [] };
  const first = findFirstMonthProrationReviewNeeds(input);
  const second = findFirstMonthProrationReviewNeeds(input);
  const third = findFirstMonthProrationReviewNeeds(input);
  assertEqual(JSON.stringify(first), JSON.stringify(second), 'misma llamada, mismo resultado exacto');
  assertEqual(JSON.stringify(second), JSON.stringify(third), 'repetir la detección nunca acumula ni duplica');
});

// ---------------------------------------------------------------------------
// Flujo de punta a punta: confirmar 2 de 4 -> media cuota, mismo cargo,
// source 'manual', needs_manual_review desaparece.
// ---------------------------------------------------------------------------

asyncTest('confirmar 2 de 4 (proporción real pedida): actualiza el MISMO cargo a media cuota, marca source "manual", y deja de necesitar revisión', async () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const wrongCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 80000, // cuota completa: el estado histórico defectuoso real
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  assertEqual(wrongCharge.id, chargeId, 'mismo id determinístico');

  const ambiguousDecision = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId, classesRemaining: 2, classesPerFullPeriod: 4, permanentMonthlyAmount: 80000, chargedAmount: 80000 });

  const { adapter, store } = makeFakeAdapter({ ...emptyPaymentsState(), charges: [wrongCharge] });
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });
  const decisionLog = fakeDecisionLog([ambiguousDecision]);

  // Reconstruye la sugerencia EXACTAMENTE como haría CobrosTab.tsx desde la
  // decisión ambigua ya persistida — 2 de 4, nunca hardcodeado.
  const suggestion = buildFirstMonthProrationSuggestionFromDecision(ambiguousDecision);
  assertEqual(suggestion.proportionalAmount, computeProportionalAmount(80000, 2, 4), 'mitad exacta de la cuota, por la fórmula canónica');

  const result = await confirmFirstMonthProration(
    { suggestion, criterion: 'proportional', source: 'manual' },
    { hydrate: controller.hydrate, applyMutation: controller.applyMutation },
    profileDeps,
    { appendDecision: decisionLog.appendDecision }
  );

  assertEqual(result.chargeUpdated, true, 'actualiza el cargo existente');
  assertEqual(result.chargeCreated, false, 'nunca crea uno nuevo');

  const charges = controller.getSnapshot().charges.filter((c) => c.studentId === 'qa_s1' && c.type === 'mensual');
  assertEqual(charges.length, 1, 'sigue siendo un único cargo — nunca se duplica');
  assertEqual(charges[0].id, chargeId, 'mismo cargo canónico, misma identidad');
  assertEqual(charges[0].originalAmount, suggestion.proportionalAmount, 'media cuota exacta, 2 de 4');

  assertEqual(result.decision.source, 'manual', 'la decisión final queda marcada como manual');
  assertEqual(decisionLog.entries().length, 2, 'se agrega una entrada nueva — la ambigua anterior nunca se edita ni se borra');

  // "needs_manual_review" desaparece: la MÁS RECIENTE decisión ya es manual.
  const needsAfter = findFirstMonthProrationReviewNeeds({
    decisions: decisionLog.entries(),
    charges: controller.getSnapshot().charges,
    allocations: controller.getSnapshot().allocations,
  });
  assertEqual(needsAfter.length, 0, 'ya no necesita revisión — Centro de cobros/Cobros dejan de ofrecer la acción');

  void store; // referenciado para dejar explícito que la persistencia real (writeAll) también corrió, sin lanzar.
});

asyncTest('cargo con movimientos reales: la confirmación se rechaza, todo el historial (pago, asignación, cargo) queda intacto', async () => {
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');
  const wrongCharge = buildMonthlyCharge({
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-18',
    originalAmount: 80000,
    createdAt: '2026-08-18T09:00:00.000Z',
    existingCharges: [],
  });
  let state: PaymentsRepositoryState = { ...emptyPaymentsState(), charges: [wrongCharge] };
  const paymentRecord = recordPayment({ id: 'qa_payment_review', studentId: 'qa_s1', amount: 30000, method: 'efectivo', paidAt: '2026-08-19', recordedAt: '2026-08-19T10:00:00.000Z', todayDateKey: '2026-08-19' });
  state = { ...state, payments: [...state.payments, paymentRecord] };
  const alloc = allocatePayment({ id: 'qa_alloc_review', paymentId: paymentRecord.id, chargeId, amount: 30000, state });
  state = { ...state, allocations: [...state.allocations, alloc] };

  const ambiguousDecision = decision({ id: 'd1', studentId: 'qa_s1', billingPeriod: '2026-08', chargeId });

  const { adapter } = makeFakeAdapter(state);
  const controller = createPaymentsStoreController(adapter);
  await controller.hydrate();
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });
  const decisionLog = fakeDecisionLog([ambiguousDecision]);
  const beforeSnapshot = JSON.stringify(controller.getSnapshot());

  const suggestion = buildFirstMonthProrationSuggestionFromDecision(ambiguousDecision);
  let threw = false;
  try {
    await confirmFirstMonthProration(
      { suggestion, criterion: 'proportional', source: 'manual' },
      { hydrate: controller.hydrate, applyMutation: controller.applyMutation },
      profileDeps,
      { appendDecision: decisionLog.appendDecision }
    );
  } catch (error) {
    threw = error instanceof FirstMonthProrationHasMovementsError;
  }
  assert(threw, 'se rechaza con el error específico de movimientos reales — nunca se reescribe en silencio');
  assertEqual(JSON.stringify(controller.getSnapshot()), beforeSnapshot, 'cargo, pago y asignación quedan byte a byte idénticos');
  assertEqual(decisionLog.entries().length, 1, 'ninguna decisión nueva agregada sobre un cargo con movimientos');
});

asyncTest('proporciones e importes pseudoaleatorios a través del flujo real de revisión: siempre la fórmula central, nunca hardcodeado', async () => {
  function pseudoRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }
  const random = pseudoRandom(31);
  for (let i = 0; i < 15; i++) {
    const monthlyAmount = 5000 + Math.floor(random() * 500000);
    const classesPerFullPeriod = 2 + Math.floor(random() * 6);
    const classesRemaining = 1 + Math.floor(random() * (classesPerFullPeriod - 1));
    const studentId = `qa_review_random_${i}`;
    const chargeId = buildMonthlyChargeId(studentId, '2026-08');
    const wrongCharge = buildMonthlyCharge({ studentId, billingPeriod: '2026-08', dueDate: '2026-08-18', originalAmount: monthlyAmount, createdAt: '2026-08-18T09:00:00.000Z', existingCharges: [] });
    const ambiguousDecision = decision({ id: `d_${i}`, studentId, billingPeriod: '2026-08', chargeId, classesRemaining, classesPerFullPeriod, permanentMonthlyAmount: monthlyAmount, chargedAmount: monthlyAmount });

    const { adapter } = makeFakeAdapter({ ...emptyPaymentsState(), charges: [wrongCharge] });
    const controller = createPaymentsStoreController(adapter);
    await controller.hydrate();
    const { deps: profileDeps } = makeFakeProfileStore({ [studentId]: makeMonthlyProfile(studentId, monthlyAmount) });
    const decisionLog = fakeDecisionLog([ambiguousDecision]);

    const suggestion = buildFirstMonthProrationSuggestionFromDecision(ambiguousDecision);
    const expected = computeProportionalAmount(monthlyAmount, classesRemaining, classesPerFullPeriod);

    await confirmFirstMonthProration(
      { suggestion, criterion: 'proportional', source: 'manual' },
      { hydrate: controller.hydrate, applyMutation: controller.applyMutation },
      profileDeps,
      { appendDecision: decisionLog.appendDecision }
    );

    const charges = controller.getSnapshot().charges;
    assertEqual(charges.length, 1, `iteración ${i}: un único cargo`);
    assertEqual(charges[0].originalAmount, expected, `iteración ${i}: ${classesRemaining}/${classesPerFullPeriod} de ${monthlyAmount}`);
  }
});
