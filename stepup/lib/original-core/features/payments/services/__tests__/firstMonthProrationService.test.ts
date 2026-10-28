// Puerto VERBATIM del original (`src/features/payments/services/__tests__/firstMonthProrationService.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
 * alumno a una serie): pruebas de punta a punta de `confirmFirstMonthProration`
 * — EXACTAMENTE el servicio real que usaría la UI, con adaptadores en
 * memoria (nunca AsyncStorage real, nunca datos de un alumno real — sólo
 * identidades `qa_*`). Cubre casos QA 5, 6, 7, 16, 17, 18, 19, 20, 25, 26,
 * 29, 30.
 */
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { confirmFirstMonthProration, FirstMonthProrationHasMovementsError, type ConfirmFirstMonthProrationProfileDeps } from '../firstMonthProrationService.ts';
import { FIRST_MONTH_PRORATION_RULE_VERSION, type FirstMonthProrationSuggestion } from '../../utils/firstMonthProration.ts';
import { determineMonthlyDueStage } from '../../utils/paymentDueStage.ts';
import { DEFAULT_SURCHARGE_TIER_VALUES } from '../../utils/surchargeSettings.ts';
import { buildMonthlyChargeId } from '../../utils/paymentIdempotency.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import type { PaymentsRepositoryState } from '../../types/index.ts';
import type { RecurrenceRule } from '../../../calendar/types/index.ts';
import { assert, assertEqual, asyncTest } from '../../../calendar/utils/__tests__/testHarness.ts';

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
    name: `Alumno ficticio ${id}`,
    levels: ['B1'],
    initialLevel: 'B1',
    modality: 'presencial',
    status: 'activo',
    category: 'adulto_interes_personal',
    billingType: 'mensual',
    billingPlan: { type: 'monthly', amount, dueDay: 1 },
    dateJoined: '2026-08-18T00:00:00.000Z',
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

function makePerClassProfile(id: string, amount: number): StudentProfile {
  return { ...makeMonthlyProfile(id, amount), billingType: 'por_clase', billingPlan: { type: 'per_class', amount } };
}

function baseSuggestion(overrides: Partial<FirstMonthProrationSuggestion> = {}): FirstMonthProrationSuggestion {
  return {
    studentId: 'qa_s1',
    billingPeriod: '2026-08',
    effectiveJoinDate: '2026-08-18',
    classesRemaining: 2,
    classesPerFullPeriod: 4,
    permanentMonthlyAmount: 80000,
    proportionalAmount: 40000,
    ...overrides,
  };
}

// --- 5) Opción "Cobrar mes completo" -----------------------------------------
asyncTest('5) criterion "full": crea el cargo por la cuota completa, ignorando el proporcional sugerido', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'full', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assert(result.chargeCreated, 'crea un cargo nuevo');
  assertEqual(result.decision.chargedAmount, 80000, 'cobra la cuota completa, no el proporcional');
  const charge = controller.getSnapshot().charges[0];
  assertEqual(charge.originalAmount, 80000, 'el cargo real también queda en la cuota completa');
});

// --- 6) Importe personalizado -------------------------------------------------
asyncTest('6) criterion "custom": crea el cargo con el importe que ingresó la profesora', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'custom', customAmount: 55000, now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assertEqual(result.decision.chargedAmount, 55000, 'usa exactamente el importe personalizado');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 55000, 'el cargo real refleja el importe personalizado');
});

// --- 7) Opción "No cobrar este primer mes" -----------------------------------
asyncTest('7) criterion "no_charge": nunca crea un cargo, empuja el plan a startPeriod = mes siguiente', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { profiles, deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'no_charge', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assert(!result.chargeCreated, 'nunca crea un cargo para el período actual');
  assertEqual(result.decision.chargedAmount, 0, 'el importe cargado registrado es 0');
  assertEqual(result.decision.chargeId, null, 'no hay ningún cargo asociado a esta decisión');
  assertEqual(controller.getSnapshot().charges.length, 0, 'ningún cargo real quedó creado');
  const plan = profiles.get('qa_s1')!.billingPlan as { startPeriod?: string };
  assertEqual(plan.startPeriod, '2026-09', 'el plan queda vigente recién desde septiembre — mismo mecanismo que "empieza el mes que viene"');
});

// --- 16) Alumno por clase: nunca activa el primer mes proporcional -----------
asyncTest('16) alumno con plan "por_clase": confirmFirstMonthProration se rechaza, nunca crea nada', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makePerClassProfile('qa_s1', 9000) });

  let threw = false;
  try {
    await confirmFirstMonthProration({ suggestion: baseSuggestion(), criterion: 'proportional' }, deps, profileDeps);
  } catch (error) {
    threw = true;
    assert(error instanceof Error && /plan de cobro mensual/.test(error.message), 'rechaza explícitamente por no ser plan mensual');
  }
  assert(threw, 'debe rechazar un alumno que no es mensual');
  assertEqual(controller.getSnapshot().charges.length, 0, 'nunca crea ningún cargo');
});

// --- 17) Cambio de serie antes de pagar: recalcula con confirmación ----------
asyncTest('17) recalcular antes de pagar: una segunda confirmación (sin movimientos) ACTUALIZA el mismo cargo, nunca crea uno nuevo', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  const first = await confirmFirstMonthProration(
    { suggestion: baseSuggestion({ classesRemaining: 2, classesPerFullPeriod: 4, proportionalAmount: 40000 }), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assert(first.chargeCreated, 'la primera confirmación crea el cargo');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'primer importe: $40.000');

  // La serie cambió (se agregó otra clase semanal) — se recalcula: ahora 3 de 4.
  const second = await confirmFirstMonthProration(
    { suggestion: baseSuggestion({ classesRemaining: 3, classesPerFullPeriod: 4, proportionalAmount: 60000 }), criterion: 'proportional', now: new Date('2026-08-19T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assert(second.chargeUpdated, 'la segunda confirmación ACTUALIZA el cargo existente');
  assert(!second.chargeCreated, 'nunca crea un segundo cargo');
  assertEqual(controller.getSnapshot().charges.length, 1, 'sigue habiendo un único cargo para el período');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 60000, 'el cargo quedó con el importe recalculado');
});

// --- 18/19) Cargo con movimientos (parcial o total): nunca cambia automáticamente ---
asyncTest('18/19) cargo con al menos una asignación (pago parcial o total): confirmFirstMonthProration se rechaza sin tocar nada', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  const chargeId = buildMonthlyChargeId('qa_s1', '2026-08');

  // Simula un pago parcial ya asignado a ese cargo (fuera de este servicio, como lo haría "Registrar pago").
  await controller.applyMutation((current) => ({
    ...current,
    payments: [
      ...current.payments,
      { id: 'qa_payment_1', studentId: 'qa_s1', amount: 20000, currency: 'ARS', method: 'efectivo', paidAt: '2026-08-19', recordedAt: '2026-08-19T10:00:00.000Z', voidedAt: null, voidReason: null },
    ],
    allocations: [
      ...current.allocations,
      { id: 'qa_alloc_1', paymentId: 'qa_payment_1', chargeId, studentId: 'qa_s1', amount: 20000 },
    ],
  }));

  let threw = false;
  try {
    await confirmFirstMonthProration(
      { suggestion: baseSuggestion({ proportionalAmount: 55000 }), criterion: 'proportional', now: new Date('2026-08-20T12:00:00.000Z') },
      deps,
      profileDeps
    );
  } catch (error) {
    threw = true;
    assert(error instanceof FirstMonthProrationHasMovementsError, 'rechaza con el error específico de movimientos existentes');
  }
  assert(threw, 'nunca recalcula en silencio un cargo con pagos/asignaciones');
  assertEqual(controller.getSnapshot().charges[0].originalAmount, 40000, 'el cargo original nunca se tocó');
});

// --- 20) Repetir la confirmación no duplica el cargo -------------------------
asyncTest('20) repetir exactamente la misma confirmación (mismo criterio, mismo importe): un único cargo, nunca duplicado', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  await confirmFirstMonthProration({ suggestion: baseSuggestion(), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') }, deps, profileDeps);
  await confirmFirstMonthProration({ suggestion: baseSuggestion(), criterion: 'proportional', now: new Date('2026-08-18T12:00:01.000Z') }, deps, profileDeps);

  assertEqual(controller.getSnapshot().charges.length, 1, 'repetir la confirmación nunca duplica el cargo — misma clave (alumno, período)');
});

// --- 25/26) Incorporación posterior al vencimiento general: nunca nace moroso retroactivamente ---
asyncTest('25) el cargo del primer mes vence en la fecha efectiva de incorporación, nunca el día 1 — nunca aparece vencido por días anteriores al alta', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  // Alta el 18/08 — muy posterior al vencimiento general (día 1) y a la
  // gracia por defecto (día 10). Si el vencimiento fuera el día 1, el
  // 18/08 ya sería moroso ("first_late"/"second_late").
  await confirmFirstMonthProration(
    { suggestion: baseSuggestion({ effectiveJoinDate: '2026-08-18' }), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  const charge = controller.getSnapshot().charges[0];
  assertEqual(charge.dueDate, '2026-08-18', 'el vencimiento es la fecha real de incorporación, no el día 1 del período');

  const stageOnJoinDay = determineMonthlyDueStage(charge.dueDate, '2026-08-18');
  assertEqual(stageOnJoinDay, 'on_time', 'el mismo día de la incorporación siempre está en término, nunca moroso retroactivo');

  const stageAfewDaysLater = determineMonthlyDueStage(charge.dueDate, '2026-08-25');
  assertEqual(stageAfewDaysLater, 'on_time', 'dentro del período de gracia contado DESDE la incorporación, sigue en término');
});

asyncTest('26) el motor de recargos (activados o desactivados) sigue funcionando igual sobre el nuevo vencimiento, sin ningún cambio propio', async () => {
  // Recargos ACTIVADOS: la gracia se cuenta desde dueDate = fecha de incorporación, no desde el día 1 — suficientes días después SÍ es mora real, el motor de recargos no se tocó.
  const dueDate = '2026-08-18';
  const stageEnabled = determineMonthlyDueStage(dueDate, '2026-09-20', { ...DEFAULT_SURCHARGE_TIER_VALUES, enabled: true });
  assert(stageEnabled !== 'on_time', 'con recargos activados, suficientes días después del vencimiento real sí es mora');

  // Recargos "desactivados" en la práctica (gracia extendida al máximo): la
  // misma fecha de vencimiento nueva nunca marca mora — confirma que el
  // cálculo de etapas sigue siendo puramente el de siempre, sin ningún caso
  // especial agregado para el primer mes proporcional.
  const stageDisabledTierValues = { ...DEFAULT_SURCHARGE_TIER_VALUES, graceDay: 999, firstLateDay: 999, secondLateDay: 999, lastLateDay: 999 };
  const stageDisabled = determineMonthlyDueStage(dueDate, '2026-09-20', stageDisabledTierValues);
  assertEqual(stageDisabled, 'on_time', 'con una gracia efectivamente "infinita", nunca marca mora');
});

// --- 29) Eliminación o archivo de la serie antes de confirmar ----------------
asyncTest('29) la confirmación opera sobre la sugerencia ya calculada (nunca vuelve a leer la serie) — sigue funcionando aunque la serie ya no exista', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  // La sugerencia se calculó ANTES de que la serie se eliminara/archivara —
  // confirmar nunca vuelve a tocar el calendario, así que nunca puede fallar
  // por eso: el panel opera sobre una foto ya congelada de la decisión.
  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );
  assert(result.chargeCreated, 'confirma con normalidad, sin depender de que la serie siga existiendo');
});

// --- 30) Fallo de persistencia: rollback completo ----------------------------
asyncTest('30a) si falla la escritura del cargo, no queda ningún cargo ni decisión a medias', async () => {
  const failingAdapter: PaymentsPersistenceAdapter = {
    readAll: async () => emptyPaymentsState(),
    writeAll: async () => {
      throw new Error('fallo simulado de escritura');
    },
  };
  const controller = createPaymentsStoreController(failingAdapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  let threw = false;
  try {
    await confirmFirstMonthProration({ suggestion: baseSuggestion(), criterion: 'proportional' }, deps, profileDeps);
  } catch {
    threw = true;
  }
  assert(threw, 'el fallo de persistencia se relanza, nunca se traga en silencio');
  assertEqual(controller.getSnapshot().charges.length, 0, 'el store en memoria nunca quedó con un cargo que no se pudo persistir');
});

asyncTest('30b) si falla guardar el perfil (criterion "no_charge"), se revierte la anulación del cargo antes de relanzar', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  // Primero crea un cargo real (proportional) para tener algo que anular en el segundo paso.
  await confirmFirstMonthProration({ suggestion: baseSuggestion(), criterion: 'proportional', now: new Date('2026-08-18T12:00:00.000Z') }, deps, profileDeps);
  const chargeBefore = controller.getSnapshot().charges[0];

  const failingProfileDeps: ConfirmFirstMonthProrationProfileDeps = {
    getProfile: profileDeps.getProfile,
    saveProfile: async () => {
      throw new Error('fallo simulado al guardar el perfil');
    },
  };

  let threw = false;
  try {
    await confirmFirstMonthProration(
      { suggestion: baseSuggestion(), criterion: 'no_charge', now: new Date('2026-08-19T12:00:00.000Z') },
      deps,
      failingProfileDeps
    );
  } catch {
    threw = true;
  }
  assert(threw, 'el fallo de guardar el perfil se relanza');
  const chargeAfter = controller.getSnapshot().charges.find((c) => c.id === chargeBefore.id);
  assert(chargeAfter !== undefined && chargeAfter.voidedAt === null, 'la anulación del cargo se revierte — nunca queda anulado si el plan no se pudo actualizar');
  assertEqual(chargeAfter?.originalAmount, chargeBefore.originalAmount, 'el importe también vuelve exactamente al valor anterior');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, cuarta ronda (a pedido de Joaquín — SOLUCIÓN
// ESTRUCTURAL DEFINITIVA — PRORRATEO AUTOMÁTICO AL VINCULAR UN ALUMNO):
// `activeSeries` es opcional y SÓLO lo pasa el camino automático (en el
// instante real de la vinculación) — una confirmación MANUAL (el panel de
// revisión, sin `activeSeries` a mano) nunca debe inventar evidencia que no
// tiene.
// ---------------------------------------------------------------------------

asyncTest('31) confirmación MANUAL (sin activeSeries): recurrenceIds/seriesPatternSnapshot quedan sin definir, pero ruleVersion se registra igual', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });

  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'proportional', source: 'manual', now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );

  assertEqual(result.decision.recurrenceIds, undefined, 'sin activeSeries, nunca se inventa una identidad de serie');
  assertEqual(result.decision.seriesPatternSnapshot, undefined, 'sin activeSeries, nunca se inventa un patrón');
  assertEqual(result.decision.ruleVersion, FIRST_MONTH_PRORATION_RULE_VERSION, 'la versión de la regla se registra siempre, manual o automática');
});

asyncTest('32) confirmación AUTOMÁTICA con activeSeries: congela recurrenceIds y el patrón semanal real de la serie', async () => {
  const { adapter } = makeFakeAdapter();
  const controller = createPaymentsStoreController(adapter);
  const deps = { hydrate: controller.hydrate, applyMutation: controller.applyMutation };
  const { deps: profileDeps } = makeFakeProfileStore({ qa_s1: makeMonthlyProfile('qa_s1', 80000) });
  const rule: RecurrenceRule = {
    recurrenceId: 'qa_rule_s1',
    studentId: 'qa_s1',
    type: 'weekly',
    modality: 'presencial',
    timezone: 'America/Argentina/Buenos_Aires',
    startDate: '2026-01-05',
    endDate: null,
    status: 'active',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 18, minute: 0, durationMinutes: 60 }] }],
  };

  const result = await confirmFirstMonthProration(
    { suggestion: baseSuggestion(), criterion: 'proportional', source: 'automatic', activeSeries: [rule], now: new Date('2026-08-18T12:00:00.000Z') },
    deps,
    profileDeps
  );

  assertEqual(JSON.stringify(result.decision.recurrenceIds), JSON.stringify(['qa_rule_s1']), 'identidad real de la serie');
  assertEqual(
    JSON.stringify(result.decision.seriesPatternSnapshot),
    JSON.stringify([{ recurrenceId: 'qa_rule_s1', cycleLengthWeeks: 1, weeks: rule.weeks }]),
    'patrón semanal real congelado'
  );
  assertEqual(result.decision.ruleVersion, FIRST_MONTH_PRORATION_RULE_VERSION, 'versión de la regla');
});
