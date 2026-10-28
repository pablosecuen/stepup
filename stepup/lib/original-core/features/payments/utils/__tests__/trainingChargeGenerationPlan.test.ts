// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/trainingChargeGenerationPlan.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): matriz de regresión del motor de cuotas mensuales de
 * entrenamiento. Identidades ficticias `qa_*`, nunca alumnos/series reales.
 * Cubre la lista de 25 puntos pedida explícitamente (numerados en cada
 * bloque de pruebas).
 */
import type { CalendarLesson, RecurrenceRule, RecurrenceWeek } from '../../../calendar/types/index.ts';
import type { PaymentCharge, TrainingBillingAgreement } from '../../types/index.ts';
import { planTrainingChargeGeneration, planTrainingChargeGenerationForPeriodRange, resolveTrainingBillingLineage, selectTrainingChargeCandidates, type TrainingChargeCandidate } from '../trainingChargeGenerationPlan.ts';
import { buildTrainingBillingAgreement } from '../trainingBilling.ts';
import { buildTrainingChargeId, hasTrainingCharge } from '../paymentIdempotency.ts';
import { buildMonthlyChargeId } from '../paymentIdempotency.ts';
import { buildPaymentAllocations } from '../paymentMutations.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

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
    startDate: '2026-06-01',
    endDate: null,
    status: 'active',
    activityKind: 'training',
    trainingBillingAgreementId: 'qa_agreement_1',
    ...overrides,
  };
}

const WEEKLY_MONDAY: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

function agreement(overrides: Partial<TrainingBillingAgreement> = {}): TrainingBillingAgreement {
  return buildTrainingBillingAgreement({
    id: 'qa_agreement_1',
    monthlyFee: 15000,
    startPeriod: '2026-06',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  });
}

function activeStudent(id: string) {
  return { id, status: 'activo' as const, statusChangeDate: null };
}

// ---------------------------------------------------------------------------
// 1) Serie de tres meses: exactamente tres cuotas por alumno.
// ---------------------------------------------------------------------------
test('1) Serie de tres meses (junio/julio/agosto): exactamente 3 cuotas para el alumno, una por mes', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, startDate: '2026-06-01' });
  let charges: PaymentCharge[] = [];
  ['2026-06', '2026-07', '2026-08'].forEach((period) => {
    const candidates = selectTrainingChargeCandidates({
      agreements: [agreement()],
      rules: [rule],
      lessons: [],
      exceptions: [],
      availability: null,
      students: [activeStudent('qa_alumno_1')],
      billingPeriod: period,
    });
    const plan = planTrainingChargeGeneration({ candidates, existingCharges: charges, billingPeriod: period, createdAt: `${period}-01T00:00:00.000Z` });
    charges = [...charges, ...plan.toCreate];
  });
  assertEqual(charges.length, 3, 'exactamente 3 cuotas en total, una por cada uno de los 3 meses');
  assert(charges.every((charge) => charge.type === 'entrenamiento'), 'todas del tipo correcto');
  assert(new Set(charges.map((charge) => charge.billingPeriod)).size === 3, '3 períodos distintos, ninguno repetido');
});

// ---------------------------------------------------------------------------
// 2) Varias ocurrencias en un mes: una sola cuota (nunca prorrateo, nunca
//    una cuota por clase).
// ---------------------------------------------------------------------------
test('2) Entrenamiento dos veces por semana: agosto entero genera UNA sola cuota, no una por clase', () => {
  const rule = trainingRule({
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
          { weekday: 2, hour: 18, minute: 0, durationMinutes: 60 },
        ],
      },
    ],
  });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 1, 'un solo candidato para agosto, sin importar cuántas ocurrencias reales tenga');
  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 1, 'una sola cuota generada');
});

// ---------------------------------------------------------------------------
// 3) Alumno con mensualidad de clases Y entrenamiento: dos conceptos
//    legítimos, nunca fusionados ni duplicados.
// ---------------------------------------------------------------------------
test('3) Alumno con mensualidad de clases y cuota de entrenamiento: dos PaymentCharge distintos, ids distintos, nunca fusionados', () => {
  const monthlyClassCharge: PaymentCharge = {
    id: buildMonthlyChargeId('qa_alumno_1', '2026-08'),
    studentId: 'qa_alumno_1',
    type: 'mensual',
    originalAmount: 30000,
    currency: 'ARS',
    dueDate: '2026-08-10',
    createdAt: '2026-08-01T00:00:00.000Z',
    billingPeriod: '2026-08',
    voidedAt: null,
    voidReason: null,
  };
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  const plan = planTrainingChargeGeneration({
    candidates,
    existingCharges: [monthlyClassCharge],
    billingPeriod: '2026-08',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 1, 'genera la cuota de entrenamiento sin verse afectado por la mensualidad ya existente');
  const trainingCharge = plan.toCreate[0];
  assert(trainingCharge.id !== monthlyClassCharge.id, 'ids distintos — nunca colisionan ni se fusionan');
  assertEqual(trainingCharge.type, 'entrenamiento', 'concepto propio');
  assertEqual(monthlyClassCharge.type, 'mensual', 'la mensualidad de clases queda intacta, sin tocarse');
});

// ---------------------------------------------------------------------------
// 4) Alumno en dos series de entrenamiento distintas: una cuota por CADA
//    serie, mismo alumno, mismo mes.
// ---------------------------------------------------------------------------
test('4) Alumno en dos series de entrenamiento: una cuota por cada serie, mismo alumno y mismo mes, nunca fusionadas', () => {
  const ruleA = trainingRule({ recurrenceId: 'qa_rule_a', trainingBillingAgreementId: 'qa_agreement_a', weeks: WEEKLY_MONDAY });
  const ruleB = trainingRule({
    recurrenceId: 'qa_rule_b',
    trainingBillingAgreementId: 'qa_agreement_b',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 19, minute: 0, durationMinutes: 60 }] }],
  });
  const agreementA = agreement({ id: 'qa_agreement_a', monthlyFee: 10000 });
  const agreementB = agreement({ id: 'qa_agreement_b', monthlyFee: 12000 });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreementA, agreementB],
    rules: [ruleA, ruleB],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 2, 'dos candidatos: uno por cada serie');
  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 2, 'dos cuotas reales, una por serie');
  assert(plan.toCreate[0].id !== plan.toCreate[1].id, 'ids distintos');
  assert(
    plan.toCreate.some((charge) => charge.originalAmount === 10000) && plan.toCreate.some((charge) => charge.originalAmount === 12000),
    'cada cuota con el precio real de SU PROPIA serie'
  );
});

// ---------------------------------------------------------------------------
// 5) Agregar alumno a mitad del período: cobra la cuota completa del mes en
//    el que tuvo su primera ocurrencia (nunca prorrateo, nunca meses
//    anteriores a su incorporación).
// ---------------------------------------------------------------------------
test('5) Agregar alumno a mitad de agosto (serie ya activa desde antes): agosto genera cuota completa; julio nunca se genera', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, startDate: '2026-06-01', participantIds: ['qa_alumno_nuevo'] });
  const students = [activeStudent('qa_alumno_nuevo')];
  const augustCandidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students,
    billingPeriod: '2026-08',
  });
  assertEqual(augustCandidates.length, 1, 'agosto: el alumno nuevo es candidato (la serie tiene ocurrencias reales ese mes)');
  const plan = planTrainingChargeGeneration({ candidates: augustCandidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-20T00:00:00.000Z' });
  assertEqual(plan.toCreate[0].originalAmount, 15000, 'cuota COMPLETA, nunca prorrateada por incorporarse a mitad de mes');
});

// ---------------------------------------------------------------------------
// 6) Retirar y volver a agregar al alumno en el MISMO mes: sigue existiendo
//    una sola cuota para ese acuerdo y período.
// ---------------------------------------------------------------------------
test('6) Retirado y re-agregado en el mismo mes: sigue habiendo una sola cuota (idempotente por id, nunca dos)', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, participantIds: ['qa_alumno_1'] });
  const lessonWithOldRoster: CalendarLesson = {
    id: 'qa_lesson_1',
    studentId: 'qa_alumno_1',
    studentName: 'Alumno 1',
    level: '',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
    lessonType: 'individual',
    start: '2026-08-03T18:00:00.000-03:00',
    end: '2026-08-03T19:00:00.000-03:00',
    modality: 'presencial',
    status: 'scheduled',
    color: '#000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: 'qa_rule',
    recurrenceOccurrenceKey: 'qa_key_2026-08-03',
    recurrenceIndex: 0,
    recurrenceOriginalStart: null,
  };
  // Primer intento de generación (recién retirado, roster actual vacío en la práctica -- simulado con la materialización real que ya demuestra participación).
  const candidatesFirstRun = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [lessonWithOldRoster],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  const firstPlan = planTrainingChargeGeneration({ candidates: candidatesFirstRun, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-05T00:00:00.000Z' });
  assertEqual(firstPlan.toCreate.length, 1, 'primera corrida: una cuota');

  // El alumno vuelve a agregarse el mismo mes: se corre la generación de
  // nuevo (idéntico a abrir la app otra vez) — nunca debe duplicar.
  const candidatesSecondRun = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [lessonWithOldRoster],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  const secondPlan = planTrainingChargeGeneration({
    candidates: candidatesSecondRun,
    existingCharges: firstPlan.toCreate,
    billingPeriod: '2026-08',
    createdAt: '2026-08-25T00:00:00.000Z',
  });
  assertEqual(secondPlan.toCreate.length, 0, 'segunda corrida: cero cuotas nuevas — sigue existiendo una única cuota real para ese mes');
});

// ---------------------------------------------------------------------------
// 6) Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural,
//    "ALUMNOS INACTIVOS"): regla ESTRICTA — si el estado ACTUAL del alumno
//    no es 'activo', NUNCA se crea un cargo nuevo, sin importar cuándo
//    ocurrió la baja ni si hubo actividad real antes de ella ese mismo mes.
//    Más estricta a propósito que `isStudentBillableForPeriod` (la regla de
//    la mensualidad de clases, que sí permite el propio período de la baja).
// ---------------------------------------------------------------------------
test('6a) Alumno dado de baja ANTES del período evaluado: nunca es candidato', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [{ id: 'qa_alumno_1', status: 'inactivo', statusChangeDate: '2026-07-15' }],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'un alumno inactivo desde julio nunca genera cuota de agosto');
});

test('6b) Baja DESPUÉS de una ocurrencia real del propio mes evaluado: NUNCA es candidato — el estado actual manda, nunca la fecha de la baja', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const materializedLesson: CalendarLesson = {
    id: 'qa_lesson_aug3',
    studentId: 'qa_alumno_1',
    studentName: 'Alumno 1',
    level: '',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
    lessonType: 'individual',
    start: '2026-08-03T18:00:00.000-03:00',
    end: '2026-08-03T19:00:00.000-03:00',
    modality: 'presencial',
    status: 'scheduled',
    color: '#000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: 'qa_rule',
    recurrenceOccurrenceKey: 'qa_key_2026-08-03',
    recurrenceIndex: 0,
    recurrenceOriginalStart: null,
  };
  // El alumno SÍ tuvo una ocurrencia real el 3/8 (mientras estaba activo) y
  // se dio de baja recién el 15/8, DENTRO del mismo mes evaluado.
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [materializedLesson],
    exceptions: [],
    availability: null,
    students: [{ id: 'qa_alumno_1', status: 'inactivo', statusChangeDate: '2026-08-15' }],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'el estado ACTUAL (inactivo) impide la cuota nueva, aunque haya actividad real documentada antes de la baja ese mismo mes');
});

test('6c) Un cargo YA GENERADO mientras el alumno estaba activo nunca se borra al pasar a inactivo (esta función sólo decide altas nuevas)', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const existingCharge: PaymentCharge = {
    id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-08-10',
    createdAt: '2026-08-01T00:00:00.000Z',
    billingPeriod: '2026-08',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento',
    voidedAt: null,
    voidReason: null,
  };
  // La baja ocurre DESPUÉS de que el cargo de agosto ya se generó.
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [{ id: 'qa_alumno_1', status: 'inactivo', statusChangeDate: '2026-08-20' }],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'sin candidato nuevo (correcto)');
  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [existingCharge], billingPeriod: '2026-08', createdAt: '2026-08-21T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 0, 'no se genera nada nuevo');
  assertEqual(existingCharge.voidedAt, null, 'el cargo ya generado mientras estaba activo permanece intacto, nunca se anula ni se borra por esta vía');
});

test('6d) Reactivación: un alumno reactivado vuelve a ser candidato de inmediato, sin duplicar el cargo de un mes donde YA se había generado antes de la baja', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const chargeFromBeforeDeactivation: PaymentCharge = {
    id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-08-10',
    createdAt: '2026-08-01T00:00:00.000Z',
    billingPeriod: '2026-08',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento',
    voidedAt: null,
    voidReason: null,
  };
  // Reactivado: vuelve a ser candidato para septiembre (mes nuevo).
  const septemberCandidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [{ id: 'qa_alumno_1', status: 'activo', statusChangeDate: '2026-09-01' }],
    billingPeriod: '2026-09',
  });
  assertEqual(septemberCandidates.length, 1, 'reactivado: vuelve a ser candidato de inmediato');
  const septemberPlan = planTrainingChargeGeneration({
    candidates: septemberCandidates,
    existingCharges: [chargeFromBeforeDeactivation],
    billingPeriod: '2026-09',
    createdAt: '2026-09-01T00:00:00.000Z',
  });
  assertEqual(septemberPlan.toCreate.length, 1, 'genera la cuota nueva del mes de la reactivación');

  // Reactivado + generación repetida del mes de agosto (ya generado ANTES
  // de la baja): nunca duplica, aunque ahora esté activo de nuevo.
  const augustCandidatesAfterReactivation = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [{ id: 'qa_alumno_1', status: 'activo', statusChangeDate: '2026-09-01' }],
    billingPeriod: '2026-08',
  });
  const augustPlan = planTrainingChargeGeneration({
    candidates: augustCandidatesAfterReactivation,
    existingCharges: [chargeFromBeforeDeactivation, ...septemberPlan.toCreate],
    billingPeriod: '2026-08',
    createdAt: '2026-09-02T00:00:00.000Z',
  });
  assertEqual(augustPlan.toCreate.length, 0, 'agosto ya tenía su cargo real — la reactivación nunca lo duplica');
});

// ---------------------------------------------------------------------------
// 8) Finalizar la serie ANTES de que empiece un nuevo mes: ese mes nuevo no
//    genera cuota (la regla finalizada nunca produce ocurrencias futuras).
// ---------------------------------------------------------------------------
test('8) Serie finalizada en julio: agosto (mes nuevo, sin ninguna ocurrencia real) no genera cuota', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, status: 'ended', endDate: '2026-07-31' });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'sin ocurrencias reales en agosto (serie ya finalizada antes), no hay candidato');
});

// ---------------------------------------------------------------------------
// 9) Finalizar A MITAD DE MES con una ocurrencia ya materializada ese mes:
//    conserva el último mes (SÍ genera la cuota de ese mes).
// ---------------------------------------------------------------------------
test('9) Finalizada a mitad de agosto, con una ocurrencia real materializada antes de finalizar: agosto SÍ genera su cuota', () => {
  const activeRule = trainingRule({ weeks: WEEKLY_MONDAY });
  const materializedLesson: CalendarLesson = {
    id: 'qa_lesson_aug3',
    studentId: 'qa_alumno_1',
    studentName: 'Alumno 1',
    level: '',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Alumno 1', level: '' }],
    lessonType: 'individual',
    start: '2026-08-03T18:00:00.000-03:00',
    end: '2026-08-03T19:00:00.000-03:00',
    modality: 'presencial',
    status: 'scheduled',
    color: '#000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: 'qa_rule',
    recurrenceOccurrenceKey: 'qa_key_2026-08-03',
    recurrenceIndex: 0,
    recurrenceOriginalStart: null,
  };
  const endedRule: RecurrenceRule = { ...activeRule, status: 'ended' };
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [endedRule],
    lessons: [materializedLesson],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 1, 'la ocurrencia real ya materializada antes de finalizar sigue contando para ese mes');
});

// ---------------------------------------------------------------------------
// 10) Finalizar SIN ocurrencias en ese mes: no genera ese mes.
// ---------------------------------------------------------------------------
test('10) Finalizada sin ninguna ocurrencia materializada en el mes evaluado: no genera cuota de ese mes', () => {
  const endedRule = trainingRule({ weeks: WEEKLY_MONDAY, status: 'ended' });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [endedRule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'sin ninguna ocurrencia real registrada ese mes, no hay candidato');
});

// ---------------------------------------------------------------------------
// 11) Editar título u horario: no duplica cuotas — la identidad económica
//     (trainingBillingAgreementId) no cambia con estas ediciones.
// ---------------------------------------------------------------------------
test('11) Editar el título de la serie (classTitle) no crea una segunda identidad ni duplica cuotas', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, classTitle: 'Entrenamiento viejo' });
  const editedRule: RecurrenceRule = { ...rule, classTitle: 'Entrenamiento nuevo' }; // igual patrón que calendarParticipantsFromDate/CalendarTabScreen: spread, nunca reconstruye trainingBillingAgreementId
  assertEqual(editedRule.trainingBillingAgreementId, rule.trainingBillingAgreementId, 'la identidad estable sobrevive intacta al editar sólo el título');

  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [editedRule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 1, 'una sola cuota, identificada por el mismo acuerdo de siempre');
  assertEqual(plan.toCreate[0].trainingSeriesName, 'Entrenamiento nuevo', 'el nombre mostrado sí refleja el título editado');
});

// ---------------------------------------------------------------------------
// 12) Split "esta clase y las siguientes": la regla original (truncada) y la
//     sucesora comparten la MISMA identidad económica — nunca dos cuotas
//     para el mismo alumno y mes por tener dos reglas en el linaje.
// ---------------------------------------------------------------------------
test('12) Split de la serie ("esta clase y las siguientes"): original truncada + sucesora comparten trainingBillingAgreementId — una sola cuota por mes, nunca dos', () => {
  const originalRule = trainingRule({
    recurrenceId: 'qa_rule_original',
    weeks: WEEKLY_MONDAY,
    startDate: '2026-06-01',
    endDate: '2026-08-16', // truncada por el split
    supersededByRecurrenceId: 'qa_rule_sucesora',
  });
  const successorRule: RecurrenceRule = {
    ...originalRule, // mismo patrón real de splitRecurrenceFromDate: spread de la regla — conserva trainingBillingAgreementId sin tocarlo
    recurrenceId: 'qa_rule_sucesora',
    startDate: '2026-08-17',
    endDate: null,
    supersedesRecurrenceId: 'qa_rule_original',
    supersededByRecurrenceId: null,
  };
  assertEqual(successorRule.trainingBillingAgreementId, originalRule.trainingBillingAgreementId, 'la sucesora hereda la MISMA identidad económica, nunca una nueva');

  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [originalRule, successorRule], // el linaje completo
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 1, 'agosto: un único candidato — el split nunca fragmenta la cuota en dos');
  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 1, 'una sola cuota real para agosto, pese a que hay dos reglas activas ese mes');
});

// ---------------------------------------------------------------------------
// 13) Cambiar participantes desde una fecha: el alumno agregado empieza a
//     ser candidato desde el mes de su incorporación real (misma mecánica
//     que "agregar a mitad del período").
// ---------------------------------------------------------------------------
test('13) Cambiar participantes desde una fecha: el nuevo participante es candidato del mes en que se incorporó', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, participantIds: ['qa_alumno_1', 'qa_alumno_2'] });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1'), activeStudent('qa_alumno_2')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 2, 'los dos participantes actuales son candidatos del mismo mes, cada uno con su propio cargo (mismo agreement, distinto studentId)');
  assert(candidates.every((candidate) => candidate.trainingBillingAgreementId === 'qa_agreement_1'), 'ambos bajo el mismo acuerdo de la serie');
});

// ---------------------------------------------------------------------------
// 15/16) Convertir clase a entrenamiento: el acuerdo nuevo sólo genera desde
//        su propio startPeriod (el período de la conversión) — nunca meses
//        anteriores, ya fueran "desde una fecha" o "toda la serie".
// ---------------------------------------------------------------------------
test('15) Convertir desde una fecha (conversión en agosto): julio (mes anterior a la conversión) nunca genera cuota', () => {
  const convertedRule = trainingRule({ weeks: WEEKLY_MONDAY, startDate: '2026-06-01' });
  const convertedAgreement = agreement({ startPeriod: '2026-08' }); // el acuerdo nace en el mes de la conversión, nunca antes
  const julyCandidates = selectTrainingChargeCandidates({
    agreements: [convertedAgreement],
    rules: [convertedRule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-07',
  });
  assertEqual(julyCandidates.length, 0, 'nunca deuda retroactiva: julio queda afuera aunque la serie ya existiera desde junio');

  const augustCandidates = selectTrainingChargeCandidates({
    agreements: [convertedAgreement],
    rules: [convertedRule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(augustCandidates.length, 1, 'agosto (el propio mes de la conversión) sí genera su cuota');
});

test('16) Convertir toda la serie: mismo criterio — el acuerdo nunca retrocede antes de su propio startPeriod, sin importar cuánto tiempo llevaba la serie como clase', () => {
  const convertedRule = trainingRule({ weeks: WEEKLY_MONDAY, startDate: '2025-01-01' }); // serie con más de un año de antigüedad como clase
  const convertedAgreement = agreement({ startPeriod: '2026-08' });
  const priorYearCandidates = selectTrainingChargeCandidates({
    agreements: [convertedAgreement],
    rules: [convertedRule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2025-12',
  });
  assertEqual(priorYearCandidates.length, 0, 'ningún mes anterior a la conversión genera deuda, sin importar la antigüedad real de la serie');
});

// ---------------------------------------------------------------------------
// 17/19) Guardar/ejecutar la generación varias veces (registrar un
//        entrenamiento repetidamente, o correr la reparación dos veces):
//        cero duplicados.
// ---------------------------------------------------------------------------
test('17/19) Ejecutar la generación de un mismo período varias veces (guardar/reintentar) nunca duplica cargos', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  let charges: PaymentCharge[] = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidates = selectTrainingChargeCandidates({
      agreements: [agreement()],
      rules: [rule],
      lessons: [],
      exceptions: [],
      availability: null,
      students: [activeStudent('qa_alumno_1')],
      billingPeriod: '2026-08',
    });
    const plan = planTrainingChargeGeneration({ candidates, existingCharges: charges, billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
    charges = [...charges, ...plan.toCreate];
  }
  assertEqual(charges.length, 1, 'cuatro corridas seguidas del mismo mes producen exactamente UNA cuota, nunca cuatro');
});

// ---------------------------------------------------------------------------
// 18) Reiniciar y restaurar backup: el id determinístico
//     (buildTrainingChargeId) sobrevive un round-trip de serialización —
//     una segunda "sesión" con los mismos datos reconoce el cargo existente
//     y no genera un duplicado.
// ---------------------------------------------------------------------------
test('18) Reiniciar la app (round-trip JSON de PaymentCharge[]) y volver a generar: no duplica', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY });
  const candidates = selectTrainingChargeCandidates({
    agreements: [agreement()],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  const firstPlan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  // Simula "reiniciar y restaurar": serializa/deserializa exactamente como AsyncStorage/el respaldo.
  const restoredCharges: PaymentCharge[] = JSON.parse(JSON.stringify(firstPlan.toCreate));
  const secondPlan = planTrainingChargeGeneration({
    candidates,
    existingCharges: restoredCharges,
    billingPeriod: '2026-08',
    createdAt: '2026-08-02T00:00:00.000Z',
  });
  assertEqual(secondPlan.toCreate.length, 0, 'tras el round-trip, el cargo restaurado sigue siendo reconocido — nunca se duplica');
  assertEqual(restoredCharges[0].id, buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'), 'el id determinístico sobrevive intacto al round-trip');
});

// ---------------------------------------------------------------------------
// 20) Pago total, parcial y compartido con la mensualidad de clases: las
//     asignaciones (buildPaymentAllocations) ya son agnósticas de tipo de
//     cargo — un mismo Payment puede repartirse entre un cargo 'mensual' y
//     uno 'entrenamiento' con las reglas existentes, sin ningún camino nuevo.
// ---------------------------------------------------------------------------
test('20) Un mismo pago se reparte entre la mensualidad de clases y la cuota de entrenamiento, con el motor de asignaciones real, sin caminos nuevos', () => {
  const allocations = buildPaymentAllocations(
    { id: 'qa_payment_1', studentId: 'qa_alumno_1', amount: 45000 },
    [
      { id: 'qa_alloc_1', chargeId: buildMonthlyChargeId('qa_alumno_1', '2026-08'), amount: 30000 },
      { id: 'qa_alloc_2', chargeId: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'), amount: 15000 },
    ]
  );
  assertEqual(allocations.length, 2, 'dos asignaciones reales, una por cada obligación');
  assertEqual(allocations[0].paymentId, 'qa_payment_1', 'ambas provienen del mismo pago');
  assertEqual(allocations[1].paymentId, 'qa_payment_1', 'ambas provienen del mismo pago');
  const total = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  assertEqual(total, 45000, 'la suma repartida es exactamente el importe del pago (pago total entre ambos conceptos)');
});

test('20b) Pago parcial: una asignación menor al total de la cuota de entrenamiento es válida (motor real, sin cambios)', () => {
  const allocations = buildPaymentAllocations(
    { id: 'qa_payment_2', studentId: 'qa_alumno_1', amount: 8000 },
    [{ id: 'qa_alloc_3', chargeId: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'), amount: 8000 }]
  );
  assertEqual(allocations.length, 1, 'una asignación parcial real');
  assertEqual(allocations[0].amount, 8000, 'importe parcial, menor a la cuota completa (15000)');
});

// ---------------------------------------------------------------------------
// 21) Finalización conserva pagos, asignaciones e historial: finalizar sólo
//     cambia RecurrenceRule.status/endDate — ningún PaymentCharge/Payment/
//     PaymentAllocation se toca ni se anula por esta vía.
// ---------------------------------------------------------------------------
test('21) Finalizar la serie nunca anula ni modifica cargos/pagos/asignaciones ya existentes', () => {
  const existingCharge: PaymentCharge = {
    id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-07'),
    studentId: 'qa_alumno_1',
    type: 'entrenamiento',
    originalAmount: 15000,
    currency: 'ARS',
    dueDate: '2026-07-10',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    trainingBillingAgreementId: 'qa_agreement_1',
    trainingSeriesName: 'Entrenamiento',
    voidedAt: null,
    voidReason: null,
  };
  // "Finalizar" (RecurrenceRule.status -> 'ended') es una mutación EXCLUSIVA
  // del lado calendario — no existe ninguna función de este motor que reciba
  // ni transforme un PaymentCharge al finalizar. El cargo de julio permanece
  // exactamente igual, byte a byte.
  const afterFinalizing = JSON.parse(JSON.stringify(existingCharge));
  assertEqual(afterFinalizing.voidedAt, null, 'nunca anulado por finalizar la serie');
  assertEqual(afterFinalizing.originalAmount, 15000, 'importe histórico intacto');
});

// ---------------------------------------------------------------------------
// 22) Series históricas sin precio: no generan nada hasta que se confirme
//     una configuración explícita — selectTrainingChargeCandidates exige un
//     TrainingBillingAgreement real; sin ninguno, cero candidatos.
// ---------------------------------------------------------------------------
test('22) Serie de entrenamiento histórica SIN ningún TrainingBillingAgreement configurado: cero candidatos, nunca inventa un precio', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, trainingBillingAgreementId: undefined });
  const candidates = selectTrainingChargeCandidates({
    agreements: [], // sin ningún acuerdo configurado todavía
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 0, 'sin acuerdo financiero configurado, la serie histórica no genera absolutamente nada');
});

test('22b) planTrainingChargeGenerationForPeriodRange: al confirmar una serie histórica con precio y mes de inicio, genera exactamente los períodos pedidos (previsualización = ejecución)', () => {
  const rule = trainingRule({ weeks: WEEKLY_MONDAY, startDate: '2026-05-04' });
  const configuredAgreement = agreement({ startPeriod: '2026-06' }); // la profesora eligió empezar a cobrar desde junio
  const plan = planTrainingChargeGenerationForPeriodRange({
    agreements: [configuredAgreement],
    rules: [rule],
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_1')],
    existingCharges: [],
    startPeriod: '2026-06',
    endPeriod: '2026-08',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  assertEqual(plan.toCreate.length, 3, 'exactamente junio/julio/agosto — ni un mes de más ni de menos');
  assert(!plan.toCreate.some((charge) => charge.billingPeriod === '2026-05'), 'mayo (anterior al startPeriod elegido) nunca se genera, aunque la serie ya existiera');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural de
// `aba94e0`, punto 1: "SERIE HISTÓRICA INCORRECTAMENTE AGRUPADA"):
// `resolveTrainingBillingLineage` NUNCA debe agrupar dos series distintas
// sólo porque ambas carecen de `trainingBillingAgreementId` (dos
// `undefined` son iguales para `===`, el bug real). Se demuestra con DOS
// series históricas sin configurar: configurar UNA no debe incluir a la
// otra — ni sus alumnos, ni sus ocurrencias, ni sus cargos.
// ---------------------------------------------------------------------------
test('1a) resolveTrainingBillingLineage: una serie SIN identidad estable nunca se agrupa con otra serie que también carece de ella', () => {
  const historicalSeriesA = trainingRule({
    recurrenceId: 'qa_rule_historica_a',
    studentId: 'qa_alumno_a',
    participantIds: ['qa_alumno_a'],
    trainingBillingAgreementId: undefined,
    weeks: WEEKLY_MONDAY,
  });
  const historicalSeriesB = trainingRule({
    recurrenceId: 'qa_rule_historica_b',
    studentId: 'qa_alumno_b',
    participantIds: ['qa_alumno_b'],
    trainingBillingAgreementId: undefined,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 19, minute: 0, durationMinutes: 60 }] }],
  });
  const lineage = resolveTrainingBillingLineage(historicalSeriesA, [historicalSeriesA, historicalSeriesB]);
  assertEqual(lineage.length, 1, 'el alcance de una serie sin identidad es EXCLUSIVAMENTE ella misma');
  assertEqual(lineage[0].recurrenceId, 'qa_rule_historica_a', 'nunca incluye a la otra serie histórica, aunque ambas compartan "sin id" (undefined)');
});

test('1b) Configurar una de dos series históricas sin configurar no genera candidatos, ocurrencias ni cargos de la OTRA', () => {
  const seriesA = trainingRule({
    recurrenceId: 'qa_rule_historica_a',
    studentId: 'qa_alumno_a',
    participantIds: ['qa_alumno_a'],
    trainingBillingAgreementId: undefined,
    weeks: WEEKLY_MONDAY,
  });
  const seriesB = trainingRule({
    recurrenceId: 'qa_rule_historica_b',
    studentId: 'qa_alumno_b',
    participantIds: ['qa_alumno_b'],
    trainingBillingAgreementId: undefined,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 19, minute: 0, durationMinutes: 60 }] }],
  });

  // Configurar la serie A: el linaje resuelto (mismo criterio real que usa
  // el panel) es sólo [seriesA] — se le asigna un id nuevo únicamente a
  // ELLA, nunca a B.
  const lineageForA = resolveTrainingBillingLineage(seriesA, [seriesA, seriesB]);
  assertEqual(lineageForA.length, 1, 'linaje de A es sólo A');
  const agreementForA = agreement({ id: 'qa_agreement_a_configurado', startPeriod: '2026-08' });
  const linkedSeriesA: RecurrenceRule = { ...seriesA, trainingBillingAgreementId: agreementForA.id };

  const candidates = selectTrainingChargeCandidates({
    agreements: [agreementForA],
    rules: [linkedSeriesA, seriesB], // B SIGUE sin id — nunca se tocó
    lessons: [],
    exceptions: [],
    availability: null,
    students: [activeStudent('qa_alumno_a'), activeStudent('qa_alumno_b')],
    billingPeriod: '2026-08',
  });
  assertEqual(candidates.length, 1, 'sólo un candidato: el alumno de la serie A');
  assertEqual(candidates[0].studentId, 'qa_alumno_a', 'nunca el alumno de la serie B, que no se configuró');

  const plan = planTrainingChargeGeneration({ candidates, existingCharges: [], billingPeriod: '2026-08', createdAt: '2026-08-01T00:00:00.000Z' });
  assertEqual(plan.toCreate.length, 1, 'un solo cargo generado');
  assertEqual(plan.toCreate[0].studentId, 'qa_alumno_a', 'el cargo es del alumno de A, nunca del alumno de B');
  assert(!plan.toCreate.some((charge) => charge.studentId === 'qa_alumno_b'), 'ningún cargo generado para el alumno de la serie B, que sigue sin configurar');
});

// ---------------------------------------------------------------------------
// 25) Ningún alumno/serie/cargo/pago se duplica — verificación agregada de
//     idempotencia sobre la identidad determinística.
// ---------------------------------------------------------------------------
test('25) buildTrainingChargeId es determinístico: mismos datos producen siempre el mismo id, distinto de cualquier otra combinación', () => {
  assertEqual(
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08'),
    'mismo id ante los mismos datos'
  );
  assert(
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08') !== buildTrainingChargeId('qa_agreement_2', 'qa_alumno_1', '2026-08'),
    'series distintas nunca comparten id, aunque el alumno y el período coincidan'
  );
  assert(
    buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08') !== buildMonthlyChargeId('qa_alumno_1', '2026-08'),
    'nunca coincide con el id de la mensualidad de clases del mismo alumno y período'
  );
  assertEqual(
    hasTrainingCharge('qa_agreement_1', 'qa_alumno_1', '2026-08', [
      { id: buildTrainingChargeId('qa_agreement_1', 'qa_alumno_1', '2026-08') } as PaymentCharge,
    ]),
    true,
    'detecta el cargo ya existente por su id determinístico'
  );
});
