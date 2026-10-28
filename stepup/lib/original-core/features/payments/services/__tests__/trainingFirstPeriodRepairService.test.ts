// Puerto VERBATIM del original (`src/features/payments/services/__tests__/trainingFirstPeriodRepairService.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
 * ENTRENAMIENTOS, reparación de cargos ya generados con la regla vieja):
 * pruebas del motor puro (`planTrainingFirstPeriodChargeRepair`) y de la
 * orquestación real (`runTrainingFirstPeriodChargeRepair`) contra un store
 * en memoria — mismo patrón que `voidChargeService.test.ts`, sin tocar
 * AsyncStorage. Identidades ficticias `qa_*`, nunca alumnos reales — la
 * reparación debe corregir el caso real (Agostina/Bianca) sin depender de
 * su nombre, importe o fecha; estas pruebas nunca los usan.
 */
import type { CalendarLesson, RecurrenceRule, RecurrenceWeek } from '../../../calendar/types/index.ts';
import type { PaymentAllocation, PaymentCharge, PaymentsRepositoryState, TrainingBillingAgreement } from '../../types/index.ts';
import { planTrainingFirstPeriodChargeRepair } from '../../utils/trainingChargeGenerationPlan.ts';
import { buildTrainingBillingAgreement } from '../../utils/trainingBilling.ts';
import { buildTrainingChargeId } from '../../utils/paymentIdempotency.ts';
import { runTrainingFirstPeriodChargeRepair, type TrainingFirstPeriodRepairStoreDeps } from '../trainingFirstPeriodRepairService.ts';
import { parsePersistedMonthlyAmountCorrectionLog } from '../../hooks/monthlyAmountCorrectionLogStore.ts';
import { assert, assertEqual, asyncTest, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function trainingRule(overrides: Partial<RecurrenceRule> & { weeks: RecurrenceWeek[] }): RecurrenceRule {
  return {
    recurrenceId: 'qa_rule',
    studentId: 'qa_alumno_1',
    participantIds: ['qa_alumno_1'],
    type: 'weekly',
    cycleLengthWeeks: 1,
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-09-14', // lunes real de la semana del sábado 19/09.
    endDate: null,
    status: 'active',
    activityKind: 'training',
    trainingBillingAgreementId: 'qa_agreement_1',
    ...overrides,
  };
}

const SATURDAY_SESSION: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 5, hour: 10, minute: 0, durationMinutes: 60 }] }];

function agreement(overrides: Partial<TrainingBillingAgreement> = {}): TrainingBillingAgreement {
  return buildTrainingBillingAgreement({
    id: 'qa_agreement_1',
    monthlyFee: 80000,
    startPeriod: '2026-09',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });
}

/** Cargo generado con la regla VIEJA: cuota completa y vencimiento día 10, para un primer período que en realidad era proporcional. */
function wrongLegacyCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-09'),
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 80000,
    currency: 'ARS',
    dueDate: '2026-09-10',
    createdAt: '2026-09-01T00:00:00.000Z',
    billingPeriod: '2026-09',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Motor puro: planTrainingFirstPeriodChargeRepair
// ---------------------------------------------------------------------------

test('17) Cargo antiguo de $80.000 sin pagos: se propone corregir al mismo cargo (mismo id) a $40.000, vencimiento 19/09', () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const plan = planTrainingFirstPeriodChargeRepair({
    charges: [charge],
    allocations: [],
    agreements: [agreement()],
    rules: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(plan.toFix.length, 1, 'un cargo a corregir');
  assertEqual(plan.needsReview.length, 0, 'sin pagos: no requiere revisión manual');
  const [fix] = plan.toFix;
  assertEqual(fix.chargeId, charge.id, 'corrige el MISMO cargo estable, nunca crea uno nuevo');
  assertEqual(fix.correctedAmount, 40000, 'importe correcto: 50% de $80.000 (dos ocurrencias reales: 19 y 26)');
  assertEqual(fix.correctedDueDate, '2026-09-19', 'vencimiento correcto: la fecha efectiva de incorporación, nunca el día 10');
});

test('18) Reparación repetida sobre un cargo ya corregido: sin cambios adicionales (idempotente)', () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const alreadyFixedCharge = wrongLegacyCharge({ originalAmount: 40000, dueDate: '2026-09-19' });
  const plan = planTrainingFirstPeriodChargeRepair({
    charges: [alreadyFixedCharge],
    allocations: [],
    agreements: [agreement()],
    rules: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(plan.toFix.length, 0, 'ya coincide con la regla canónica: nada que corregir');
  assertEqual(plan.needsReview.length, 0, 'tampoco requiere revisión');
});

test('19) Cargo antiguo CON pagos/asignaciones reales: nunca se corrige en silencio, queda para revisión manual', () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const allocations: PaymentAllocation[] = [{ id: 'qa_alloc_1', paymentId: 'qa_payment_1', chargeId: charge.id, studentId: 'qa_alumno_1', amount: 80000 }];
  const plan = planTrainingFirstPeriodChargeRepair({
    charges: [charge],
    allocations,
    agreements: [agreement()],
    rules: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(plan.toFix.length, 0, 'con pagos reales, nunca se corrige automáticamente');
  assertEqual(plan.needsReview.length, 1, 'queda marcado para revisión manual con trazabilidad');
  assertEqual(plan.needsReview[0].chargeId, charge.id, 'el candidato marcado es el cargo real con pagos');
});

test('Sin acuerdo real para recalcular: nunca adivina un importe, se omite', () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const plan = planTrainingFirstPeriodChargeRepair({
    charges: [charge],
    allocations: [],
    agreements: [], // sin acuerdo real
    rules: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(plan.toFix.length, 0, 'sin acuerdo, nunca se propone una corrección inventada');
  assertEqual(plan.needsReview.length, 0, 'sin acuerdo, tampoco requiere revisión — no hay nada que evaluar');
});

test('Sólo el cargo MÁS ANTIGUO por (acuerdo, alumno) es candidato — un segundo mes ya facturado con la cuota completa nunca se toca', () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const septemberCharge = wrongLegacyCharge({ id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-09') });
  const octoberCharge = wrongLegacyCharge({
    id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-10'),
    billingPeriod: '2026-10',
    dueDate: '2026-10-10',
    originalAmount: 80000,
  });
  const plan = planTrainingFirstPeriodChargeRepair({
    charges: [septemberCharge, octoberCharge],
    allocations: [],
    agreements: [agreement()],
    rules: [rule],
    exceptions: [],
    existingLessons: [],
    availability: null,
  });
  assertEqual(plan.toFix.length, 1, 'sólo el cargo de septiembre (el más antiguo) es candidato');
  assertEqual(plan.toFix[0].billingPeriod, '2026-09', 'el candidato corregido es el de septiembre');
  assert(!plan.toFix.some((fix) => fix.billingPeriod === '2026-10'), 'octubre (segundo mes, cuota completa correcta) nunca se toca');
});

// ---------------------------------------------------------------------------
// Orquestación real: runTrainingFirstPeriodChargeRepair contra un store en
// memoria (sin AsyncStorage) — aplica la corrección y registra auditoría.
// ---------------------------------------------------------------------------

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function makeStoreDeps(initial: PaymentsRepositoryState): TrainingFirstPeriodRepairStoreDeps & { getState: () => PaymentsRepositoryState } {
  let state = initial;
  return {
    hydrate: async () => state,
    applyMutation: async (updater) => {
      state = updater(state);
      return state;
    },
    getState: () => state,
  };
}

asyncTest('runTrainingFirstPeriodChargeRepair: corrige el cargo real sobre el MISMO id, sin pagos, y registra auditoría', async () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const storeDeps = makeStoreDeps({ ...emptyState(), charges: [charge] });
  const auditEntries: unknown[] = [];

  const summary = await runTrainingFirstPeriodChargeRepair(new Date('2026-09-20T00:00:00.000Z'), {
    storeDeps,
    getSnapshot: () => storeDeps.getState(),
    loadRules: async () => [rule],
    loadLessons: async () => [],
    loadExceptions: async () => [],
    hydrateAvailability: async () => null,
    getAvailability: () => null,
    loadAgreements: async () => [agreement()],
    appendAuditEntry: async (entry) => {
      auditEntries.push(entry);
    },
  });

  assertEqual(summary.repaired, 1, 'un cargo reparado');
  assertEqual(summary.needsManualReview, 0, 'sin casos que requieran revisión manual');

  const fixedCharge = storeDeps.getState().charges.find((item) => item.id === charge.id)!;
  assertEqual(fixedCharge.originalAmount, 40000, 'el MISMO cargo queda corregido a $40.000');
  assertEqual(fixedCharge.dueDate, '2026-09-19', 'el MISMO cargo queda con el vencimiento real');
  assertEqual(storeDeps.getState().charges.length, 1, 'nunca duplica el cargo — se corrige in place');

  assertEqual(auditEntries.length, 1, 'queda un registro auditable de la corrección');
  const roundTripped = parsePersistedMonthlyAmountCorrectionLog(JSON.stringify(auditEntries));
  assertEqual(roundTripped.length, 1, 'el registro de auditoría sobrevive un round-trip real de serialización (mismo store que ya usa el respaldo)');
  assertEqual(roundTripped[0].previousAmount, 80000, 'importe anterior conservado en la auditoría');
  assertEqual(roundTripped[0].newAmount, 40000, 'importe nuevo conservado en la auditoría');
});

asyncTest('runTrainingFirstPeriodChargeRepair: ejecutar dos veces seguidas es idempotente — la segunda vez no corrige ni audita nada más', async () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const storeDeps = makeStoreDeps({ ...emptyState(), charges: [charge] });
  let auditCount = 0;
  const depsFor = () => ({
    storeDeps,
    getSnapshot: () => storeDeps.getState(),
    loadRules: async () => [rule],
    loadLessons: async () => [],
    loadExceptions: async () => [],
    hydrateAvailability: async () => null,
    getAvailability: () => null,
    loadAgreements: async () => [agreement()],
    appendAuditEntry: async () => {
      auditCount += 1;
    },
  });

  const first = await runTrainingFirstPeriodChargeRepair(new Date('2026-09-20T00:00:00.000Z'), depsFor());
  assertEqual(first.repaired, 1, 'primera corrida: repara');
  assertEqual(auditCount, 1, 'primera corrida: una entrada de auditoría');

  const second = await runTrainingFirstPeriodChargeRepair(new Date('2026-09-21T00:00:00.000Z'), depsFor());
  assertEqual(second.repaired, 0, 'segunda corrida: ya está corregido, nada que reparar');
  assertEqual(auditCount, 1, 'segunda corrida: nunca agrega una entrada nueva de auditoría');
});

asyncTest('runTrainingFirstPeriodChargeRepair: un cargo con pago real nunca se toca — queda para revisión manual', async () => {
  const rule = trainingRule({ weeks: SATURDAY_SESSION });
  const charge = wrongLegacyCharge();
  const allocations: PaymentAllocation[] = [{ id: 'qa_alloc_1', paymentId: 'qa_payment_1', chargeId: charge.id, studentId: 'qa_alumno_1', amount: 80000 }];
  const storeDeps = makeStoreDeps({ ...emptyState(), charges: [charge], allocations });

  const summary = await runTrainingFirstPeriodChargeRepair(new Date('2026-09-20T00:00:00.000Z'), {
    storeDeps,
    getSnapshot: () => storeDeps.getState(),
    loadRules: async () => [rule],
    loadLessons: async () => [],
    loadExceptions: async () => [],
    hydrateAvailability: async () => null,
    getAvailability: () => null,
    loadAgreements: async () => [agreement()],
    appendAuditEntry: async () => {},
  });

  assertEqual(summary.repaired, 0, 'nunca se repara en silencio con pagos reales asignados');
  assertEqual(summary.needsManualReview, 1, 'queda señalado para revisión manual');
  assertEqual(storeDeps.getState().charges[0].originalAmount, 80000, 'el cargo real queda completamente intacto');
  assertEqual(storeDeps.getState().allocations.length, 1, 'la asignación real nunca se toca ni se pierde');
});
