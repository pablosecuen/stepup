// Puerto VERBATIM del original (`src/features/payments/utils/trainingChargeGenerationPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TeacherAvailability } from '../../calendar/types/teacherAvailability.ts';
import { countRuleRealOccurrencesInRange, hasRuleOccurrenceForParticipantInPeriod, resolveEarliestParticipantOccurrenceDateInRange } from '../../calendar/utils/calendarOccurrenceCounting.ts';
import { getLocalDateKey } from '../../calendar/utils/calendarTimezone.ts';
import type { StudentStatus } from '../../student-profile/types/index.ts';
import type { PaymentAllocation, PaymentCharge, TrainingBillingAgreement } from '../types/index.ts';
import { DEFAULT_MONTHLY_DUE_DAY } from '../../student-profile/utils/studentBillingPlan.ts';
import { firstDayOfBillingPeriod, lastDayOfBillingPeriod, nextBillingPeriod, resolveMonthlyDueDate } from './paymentDates.ts';
import { computeProportionalAmount } from './firstMonthProration.ts';
import { resolveFirstPeriodDueDate } from './firstPeriodDueDate.ts';
import { hasTrainingCharge } from './paymentIdempotency.ts';
import { buildTrainingCharge } from './paymentMutations.ts';
import { buildTrainingBillingAgreement, resolveEffectiveTrainingMonthlyFee } from './trainingBilling.ts';
import type { TrainingBillingConfigurationPlan } from '../services/trainingBillingConfigurationCoordinator.ts';

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): única función pura de planificación de cuotas mensuales
 * de entrenamiento — mismo patrón que `monthlyChargeGenerationPlan.ts`
 * (candidatos puros + plan puro, idempotente por `buildTrainingChargeId`),
 * pero cruzando datos de calendario (participantes reales por ocurrencia,
 * ver `hasRuleOccurrenceForParticipantInPeriod`) con el dominio de pagos —
 * mismo cruce que ya hace `firstMonthProration.ts`, nunca el primer caso de
 * payments importando calendar.
 *
 * Reglas económicas aplicadas acá (todas ya pedidas explícitamente):
 *   - Se cobra la cuota COMPLETA del mes si el alumno tuvo al menos una
 *     ocurrencia real de la serie durante ese mes mientras era participante
 *     — nunca prorrateo.
 *   - No se generan meses anteriores a `agreement.startPeriod` (protege
 *     contra deuda retroactiva en creación/conversión/configuración).
 *   - Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural,
 *     "ALUMNOS INACTIVOS"): regla MÁS ESTRICTA que la mensualidad de
 *     clases a propósito — un alumno cuyo estado ACTUAL no es `'activo'`
 *     nunca es candidato a una cuota NUEVA, sin importar cuándo ocurrió la
 *     baja (aunque haya sido durante el propio mes evaluado, con actividad
 *     real antes de esa baja). `isStudentBillableForPeriod` (fecha-
 *     consciente, permite el período de la propia baja) es la regla
 *     correcta para la mensualidad de clases, pero el pedido explícito acá
 *     es más conservador: "si el estado actual no es activo, nunca crear
 *     un cargo nuevo" — nunca se reinterpreta como excepción. Un cargo YA
 *     generado mientras el alumno estaba activo nunca se toca (esta
 *     función sólo decide altas nuevas, jamás borra ni modifica cargos
 *     existentes).
 *   - El vencimiento reutiliza la regla global del día 10
 *     (`DEFAULT_MONTHLY_DUE_DAY`/`resolveMonthlyDueDate`) — nunca un
 *     calendario de vencimientos propio.
 *   - Un alumno en dos series de entrenamiento recibe una cuota por CADA
 *     serie (identidad = agreement + alumno + período, nunca sólo alumno +
 *     período) — nunca se fusionan ni se duplican.
 */

/**
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural de
 * `aba94e0`, punto 1: "SERIE HISTÓRICA INCORRECTAMENTE AGRUPADA"): ÚNICA
 * función real que resuelve el linaje de reglas de un acuerdo de
 * entrenamiento — usada tanto por `selectTrainingChargeCandidates` (abajo)
 * como por `TrainingBillingAgreementSheet.tsx` (previsualización y
 * confirmación de "Configurar cuota"), para que las dos partes SIEMPRE vean
 * exactamente el mismo alcance.
 *
 * Nunca agrupa por igualdad de `undefined`: dos reglas sin
 * `trainingBillingAgreementId` NO son "del mismo linaje" sólo porque a
 * ambas les falta el campo — si `rule` todavía no tiene identidad estable,
 * su alcance es EXCLUSIVAMENTE ella misma; sólo cuando ya tiene una
 * identidad real se agrupa por ese id exacto.
 */
export function resolveTrainingBillingLineage(rule: RecurrenceRule, rules: RecurrenceRule[]): RecurrenceRule[] {
  if (!rule.trainingBillingAgreementId) return [rule];
  const agreementId = rule.trainingBillingAgreementId;
  return rules.filter((candidate) => candidate.trainingBillingAgreementId === agreementId);
}

export interface TrainingChargeCandidate {
  studentId: string;
  trainingBillingAgreementId: string;
  /** Copia del nombre de la serie en el momento de evaluar — ver `PaymentCharge.trainingSeriesName`. */
  trainingSeriesName: string;
  /** Importe a cobrar — cuota completa, o el proporcional del primer período (ver `isFirstPeriod`). */
  price: number;
  /** Vencimiento a usar — día 10 normal, o en el primer período max(fecha efectiva de incorporación, primer vencimiento global). */
  dueDate: string;
  /** true si este candidato corresponde al primer período jamás facturado de este (acuerdo, alumno) — ver `computeTrainingFirstPeriodCharge`. */
  isFirstPeriod: boolean;
  /** Sólo cuando `isFirstPeriod` — evidencia congelada para auditoría/pruebas, nunca recalculada después. */
  effectiveJoinDate?: string;
  classesRemaining?: number;
  classesPerFullPeriod?: number;
}

export interface TrainingFirstPeriodComputation {
  /** YYYY-MM-DD — fecha real más temprana del período en la que el participante tiene una ocurrencia real. */
  effectiveJoinDate: string;
  classesRemaining: number;
  classesPerFullPeriod: number;
  amount: number;
  /** Mismo criterio que el primer mes proporcional de clases: max(fecha efectiva de incorporación, primer vencimiento global ajustado a día hábil) — ver `resolveFirstPeriodDueDate`. */
  dueDate: string;
}

/**
 * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
 * ENTRENAMIENTOS que comienzan o incorporan un participante a mitad de
 * mes): núcleo puro del primer período de una cuota de entrenamiento —
 * reutiliza EXACTAMENTE `computeProportionalAmount` (la MISMA fórmula ya
 * probada del primer mes proporcional de clases, `firstMonthProration.ts`,
 * nunca una fórmula paralela) sobre el conteo canónico de ocurrencias
 * (`countRuleOccurrencesInRange`) y la fecha efectiva de incorporación
 * (`resolveEarliestParticipantOccurrenceDateInRange`, ambas en
 * `calendarOccurrenceCounting.ts`). Usada tanto por `selectTrainingChargeCandidates`
 * (candidatos nuevos) como por la reparación de cargos ya generados con la
 * regla vieja (`planTrainingFirstPeriodChargeRepair`, abajo) — nunca dos
 * fórmulas distintas del mismo cálculo.
 *
 * `null` si el participante no tiene ninguna ocurrencia real dentro del
 * período para el linaje dado — nunca inventa una fecha.
 */
export function computeTrainingFirstPeriodCharge(input: {
  lineageRules: RecurrenceRule[];
  studentId: string;
  billingPeriod: string;
  monthlyFee: number;
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
}): TrainingFirstPeriodComputation | null {
  const periodStart = firstDayOfBillingPeriod(input.billingPeriod);
  const periodEnd = `${input.billingPeriod}-${String(lastDayOfBillingPeriod(input.billingPeriod)).padStart(2, '0')}`;

  let effectiveJoinDate: string | null = null;
  input.lineageRules.forEach((rule) => {
    const earliest = resolveEarliestParticipantOccurrenceDateInRange({
      rule,
      studentId: input.studentId,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
      rangeStartDateKey: periodStart,
      rangeEndDateKey: periodEnd,
    });
    if (earliest !== null && (effectiveJoinDate === null || earliest < effectiveJoinDate)) {
      effectiveJoinDate = earliest;
    }
  });
  if (effectiveJoinDate === null) return null;
  const joinDate: string = effectiveJoinDate;

  let classesRemaining = 0;
  let classesPerFullPeriod = 0;
  input.lineageRules.forEach((rule) => {
    classesRemaining += countRuleRealOccurrencesInRange({
      rule,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
      rangeStartDateKey: joinDate,
      rangeEndDateKey: periodEnd,
    });
    classesPerFullPeriod += countRuleRealOccurrencesInRange({
      rule,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
      rangeStartDateKey: periodStart,
      rangeEndDateKey: periodEnd,
    });
  });

  return {
    effectiveJoinDate: joinDate,
    classesRemaining,
    classesPerFullPeriod,
    amount: computeProportionalAmount(input.monthlyFee, classesRemaining, classesPerFullPeriod),
    // Corrección 2026-10-04: max(incorporación, primer vencimiento global) — ver `resolveFirstPeriodDueDate`.
    dueDate: resolveFirstPeriodDueDate(input.billingPeriod, joinDate),
  };
}

/**
 * true si YA existe (anulado o no — un primer período que existió una vez,
 * aunque después se haya anulado por error, deja de ser "el primero" para
 * siempre) algún cargo real de este (acuerdo, alumno) en un período
 * ANTERIOR a `billingPeriod`. Nunca usa sólo alumno+mes: siempre exige el
 * `trainingBillingAgreementId` exacto, para que dos entrenamientos del
 * mismo alumno nunca se confundan entre sí.
 */
function hasEarlierTrainingChargeForParticipant(
  trainingBillingAgreementId: string,
  studentId: string,
  billingPeriod: string,
  charges: PaymentCharge[]
): boolean {
  return charges.some(
    (charge) =>
      charge.trainingBillingAgreementId === trainingBillingAgreementId &&
      charge.studentId === studentId &&
      !!charge.billingPeriod &&
      charge.billingPeriod < billingPeriod
  );
}

/**
 * Todos los alumnos alguna vez relevantes para este acuerdo en el período
 * dado: el roster ACTUAL de cada regla de su linaje, más cualquier alumno
 * que aparezca en el roster CONGELADO de una clase ya materializada dentro
 * del período (cubre a quien fue retirado antes de que se evaluara este
 * período, pero participó de una ocurrencia real mientras estaba adentro).
 */
function collectRelevantStudentIds(
  lineageRules: RecurrenceRule[],
  lessons: CalendarLesson[],
  periodStart: string,
  periodEnd: string
): Set<string> {
  const ids = new Set<string>();
  lineageRules.forEach((rule) => {
    (rule.participantIds && rule.participantIds.length > 0 ? rule.participantIds : rule.studentId ? [rule.studentId] : []).forEach(
      (id) => ids.add(id)
    );
  });
  const ruleById = new Map(lineageRules.map((rule) => [rule.recurrenceId, rule]));
  lessons.forEach((lesson) => {
    if (!lesson.recurrenceId) return;
    const rule = ruleById.get(lesson.recurrenceId);
    if (!rule) return;
    if (lesson.status === 'cancelled') return;
    const logicalDateKey = getLocalDateKey(lesson.recurrenceOriginalStart ?? lesson.start, rule.timezone);
    if (logicalDateKey < periodStart || logicalDateKey > periodEnd) return;
    if (lesson.studentId) ids.add(lesson.studentId);
    lesson.participants.forEach((participant) => ids.add(participant.studentId));
  });
  return ids;
}

export function selectTrainingChargeCandidates(input: {
  agreements: TrainingBillingAgreement[];
  /** TODAS las reglas de recurrencia reales — se filtran acá adentro por `activityKind === 'training'` y el agreement correspondiente. */
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
  exceptions: RecurrenceException[];
  availability: TeacherAvailability | null;
  students: Array<{ id: string; status: StudentStatus; statusChangeDate?: string | null }>;
  /**
   * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
   * ENTRENAMIENTOS): cargos reales ya existentes (persistidos, o ya
   * planificados en la misma corrida de varios períodos) — determina si un
   * candidato corresponde a su PRIMER período jamás facturado para ese
   * (acuerdo, alumno), único caso en el que aplica el proporcional. Opcional
   * por compatibilidad — sin datos, se asume "sin historial" (primer
   * período) para cada candidato, igual que arrancar de cero.
   */
  existingCharges?: PaymentCharge[];
  billingPeriod: string; // YYYY-MM, el mes actual (AR)
}): TrainingChargeCandidate[] {
  const periodStart = firstDayOfBillingPeriod(input.billingPeriod);
  const periodEnd = `${input.billingPeriod}-${String(lastDayOfBillingPeriod(input.billingPeriod)).padStart(2, '0')}`;
  const studentById = new Map(input.students.map((student) => [student.id, student]));
  const existingCharges = input.existingCharges ?? [];
  const dueDateNormal = resolveMonthlyDueDate(input.billingPeriod, DEFAULT_MONTHLY_DUE_DAY);
  const candidates: TrainingChargeCandidate[] = [];

  input.agreements.forEach((agreement) => {
    if (input.billingPeriod < agreement.startPeriod) return; // nunca antes del inicio confirmado del acuerdo.

    const lineageRules = input.rules.filter(
      (rule) => rule.activityKind === 'training' && rule.trainingBillingAgreementId === agreement.id
    );
    if (lineageRules.length === 0) return;

    const relevantStudentIds = collectRelevantStudentIds(lineageRules, input.lessons, periodStart, periodEnd);
    const seriesName = lineageRules.find((rule) => rule.classTitle)?.classTitle ?? 'Entrenamiento';
    const monthlyFee = resolveEffectiveTrainingMonthlyFee(agreement, input.billingPeriod);

    relevantStudentIds.forEach((studentId) => {
      const student = studentById.get(studentId);
      if (!student) return; // alumno desconocido (eliminado u otro origen de datos): nunca se factura.
      // Regla estricta pedida: el estado ACTUAL decide, nunca la fecha de
      // baja — un alumno inactivo hoy nunca recibe una cuota nueva, ni
      // siquiera para el propio mes de su baja.
      if (student.status !== 'activo') return;

      const hadOccurrence = lineageRules.some((rule) =>
        hasRuleOccurrenceForParticipantInPeriod({
          rule,
          studentId,
          exceptions: input.exceptions,
          existingLessons: input.lessons,
          availability: input.availability,
          rangeStartDateKey: periodStart,
          rangeEndDateKey: periodEnd,
        })
      );
      if (!hadOccurrence) return;

      const isFirstPeriod = !hasEarlierTrainingChargeForParticipant(agreement.id, studentId, input.billingPeriod, existingCharges);

      if (isFirstPeriod) {
        const computation = computeTrainingFirstPeriodCharge({
          lineageRules,
          studentId,
          billingPeriod: input.billingPeriod,
          monthlyFee,
          exceptions: input.exceptions,
          existingLessons: input.lessons,
          availability: input.availability,
        });
        // `computation` sólo puede ser `null` si el participante no tuvo
        // ninguna ocurrencia real en el período — pero `hadOccurrence` ya lo
        // garantizó arriba con el mismo rango; nunca debería darse, pero se
        // omite en vez de adivinar un importe si pasara.
        if (!computation || computation.amount <= 0) return;
        candidates.push({
          studentId,
          trainingBillingAgreementId: agreement.id,
          trainingSeriesName: seriesName,
          price: computation.amount,
          dueDate: computation.dueDate,
          isFirstPeriod: true,
          effectiveJoinDate: computation.effectiveJoinDate,
          classesRemaining: computation.classesRemaining,
          classesPerFullPeriod: computation.classesPerFullPeriod,
        });
        return;
      }

      candidates.push({
        studentId,
        trainingBillingAgreementId: agreement.id,
        trainingSeriesName: seriesName,
        price: monthlyFee,
        dueDate: dueDateNormal,
        isFirstPeriod: false,
      });
    });
  });

  return candidates;
}

export type TrainingChargeSkipReason = 'precio_invalido';

export interface TrainingChargeSkipped {
  studentId: string;
  trainingBillingAgreementId: string;
  reason: TrainingChargeSkipReason;
}

export interface TrainingChargeGenerationPlan {
  toCreate: PaymentCharge[];
  skipped: TrainingChargeSkipped[];
}

/**
 * Decide qué cuotas de entrenamiento faltan crear para `billingPeriod`, dado
 * un snapshot de candidatos y los cargos ya existentes. Idempotente por
 * construcción: nunca duplica un cargo que ya existe (persistido, o ya
 * planificado más arriba en la misma corrida), gracias a
 * `buildTrainingChargeId(trainingBillingAgreementId, studentId, billingPeriod)`.
 * Nunca genera cargos en cero: un precio inválido se omite y se reporta en
 * `skipped`. Pura — no muta `existingCharges` ni `candidates`.
 */
export function planTrainingChargeGeneration(input: {
  candidates: TrainingChargeCandidate[];
  existingCharges: PaymentCharge[];
  billingPeriod: string;
  createdAt: string;
}): TrainingChargeGenerationPlan {
  const toCreate: PaymentCharge[] = [];
  const skipped: TrainingChargeSkipped[] = [];

  input.candidates.forEach((candidate) => {
    if (!Number.isFinite(candidate.price) || candidate.price <= 0) {
      skipped.push({
        studentId: candidate.studentId,
        trainingBillingAgreementId: candidate.trainingBillingAgreementId,
        reason: 'precio_invalido',
      });
      return;
    }

    const chargesSoFar = [...input.existingCharges, ...toCreate];
    if (hasTrainingCharge(candidate.trainingBillingAgreementId, candidate.studentId, input.billingPeriod, chargesSoFar)) {
      return; // ya existe (persistido o ya planificado en esta misma corrida): idempotente, no es un error.
    }

    toCreate.push(
      buildTrainingCharge({
        studentId: candidate.studentId,
        trainingBillingAgreementId: candidate.trainingBillingAgreementId,
        trainingSeriesName: candidate.trainingSeriesName,
        billingPeriod: input.billingPeriod,
        dueDate: candidate.dueDate,
        originalAmount: candidate.price,
        createdAt: input.createdAt,
        existingCharges: chargesSoFar,
      })
    );
  });

  return { toCreate, skipped };
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — SERIES EXISTENTES sin
 * configuración financiera): "la simulación y la ejecución deben usar el
 * mismo plan inmutable" — esta función recorre varios períodos seguidos
 * (desde `startPeriod` hasta `endPeriod`, ambos 'YYYY-MM' inclusive)
 * reutilizando EXACTAMENTE `selectTrainingChargeCandidates` +
 * `planTrainingChargeGeneration` período por período, acumulando los cargos
 * ya planificados de un período como "existentes" para el siguiente (nunca
 * se planifican dos veces por el mismo período). La pantalla de
 * previsualización la llama sobre un snapshot (sin persistir nada); la
 * confirmación real la vuelve a llamar con los mismos datos dentro de la
 * mutación atómica del store de pagos — mismo código, mismo resultado.
 * Pura — no muta ningún array de entrada.
 */
export function planTrainingChargeGenerationForPeriodRange(input: {
  agreements: TrainingBillingAgreement[];
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
  exceptions: RecurrenceException[];
  availability: TeacherAvailability | null;
  students: Array<{ id: string; status: StudentStatus; statusChangeDate?: string | null }>;
  existingCharges: PaymentCharge[];
  startPeriod: string; // YYYY-MM, inclusive
  endPeriod: string; // YYYY-MM, inclusive
  createdAt: string;
}): TrainingChargeGenerationPlan {
  const allToCreate: PaymentCharge[] = [];
  const allSkipped: TrainingChargeSkipped[] = [];
  let chargesSoFar = input.existingCharges;
  let cursor = input.startPeriod;

  while (cursor <= input.endPeriod) {
    const candidates = selectTrainingChargeCandidates({
      agreements: input.agreements,
      rules: input.rules,
      lessons: input.lessons,
      exceptions: input.exceptions,
      availability: input.availability,
      students: input.students,
      existingCharges: chargesSoFar,
      billingPeriod: cursor,
    });
    const plan = planTrainingChargeGeneration({
      candidates,
      existingCharges: chargesSoFar,
      billingPeriod: cursor,
      createdAt: input.createdAt,
    });
    allToCreate.push(...plan.toCreate);
    allSkipped.push(...plan.skipped);
    chargesSoFar = [...chargesSoFar, ...plan.toCreate];
    cursor = nextBillingPeriod(cursor);
  }

  return { toCreate: allToCreate, skipped: allSkipped };
}

export interface TrainingBillingConfigurationPlanWithPreview extends TrainingBillingConfigurationPlan {
  /** `agreement.id` — expuesto aparte por comodidad de lectura para el llamador. */
  agreementId: string;
  /** Cargos completos (para mostrar la previsualización) — sus ids, EN EL MISMO ORDEN, forman `expectedChargeIds`. */
  toCreate: PaymentCharge[];
}

/**
 * Corrección 2026-09-16, TERCERA ronda (a pedido de Joaquín — CAUSA RAÍZ
 * REAL, confirmada con video físico: "Configurar cuota" fallaba SIEMPRE
 * con "Algunos cargos esperados no se pudieron verificar al releerlos",
 * aunque el acuerdo y los cargos reales SÍ se hubieran persistido bien):
 * `TrainingBillingAgreementSheet.tsx` calculaba la previsualización con un
 * id de acuerdo HIPOTÉTICO propio (`'__preview__'`) y, por separado, la
 * confirmación real con el id DETERMINÍSTICO verdadero
 * (`training_agreement_<recurrenceId>`) — dos fórmulas distintas para "el
 * mismo" acuerdo, así que `expectedChargeIds` (calculados en la
 * previsualización) nunca podían coincidir con los ids de los cargos
 * REALES (calculados con el id verdadero) que `runTrainingBillingConfiguration`
 * termina verificando.
 *
 * Única función real que arma el plan completo — el id del acuerdo, el
 * acuerdo en sí, el linaje a vincular y los cargos esperados — a partir de
 * `rule` y el resto del snapshot real. Se llama UNA sola vez por apertura
 * de "Configurar cuota"; tanto la previsualización como la confirmación
 * (`TrainingBillingAgreementSheet.tsx`) usan el MISMO resultado, así que
 * preview y ejecución son estructuralmente imposibles de desincronizar —
 * nunca dos fórmulas del mismo id en dos lugares distintos.
 *
 * Reutiliza `resolveTrainingBillingLineage` (misma identidad de linaje que
 * ya usa el motor de candidatos, arriba) y `planTrainingChargeGenerationForPeriodRange`
 * (mismo motor puro que la ejecución real, en `trainingChargeGenerationService.ts`)
 * — nunca una tercera implementación de "qué cargos corresponden".
 */
export function buildTrainingBillingConfigurationPlan(input: {
  rule: RecurrenceRule;
  rules: RecurrenceRule[];
  lessons: CalendarLesson[];
  exceptions: RecurrenceException[];
  availability: TeacherAvailability | null;
  students: Array<{ id: string; status: StudentStatus; statusChangeDate?: string | null }>;
  existingCharges: PaymentCharge[];
  monthlyFee: number;
  startPeriod: string;
  endPeriod: string;
  createdAt: string;
}): TrainingBillingConfigurationPlanWithPreview {
  const agreementId = input.rule.trainingBillingAgreementId ?? `training_agreement_${input.rule.recurrenceId}`;
  const lineageRules = resolveTrainingBillingLineage(input.rule, input.rules);
  const hypotheticalLineage = lineageRules.map((candidate) => ({ ...candidate, trainingBillingAgreementId: agreementId }));
  const agreement = buildTrainingBillingAgreement({
    id: agreementId,
    monthlyFee: input.monthlyFee,
    startPeriod: input.startPeriod,
    createdAt: input.createdAt,
  });
  const plan = planTrainingChargeGenerationForPeriodRange({
    agreements: [agreement],
    rules: hypotheticalLineage,
    lessons: input.lessons,
    exceptions: input.exceptions,
    availability: input.availability,
    students: input.students,
    existingCharges: input.existingCharges,
    startPeriod: input.startPeriod,
    endPeriod: input.endPeriod,
    createdAt: input.createdAt,
  });
  return {
    agreementId,
    agreement,
    startPeriod: input.startPeriod,
    endPeriod: input.endPeriod,
    recurrenceIdsToLink: lineageRules.map((candidate) => candidate.recurrenceId),
    toCreate: plan.toCreate,
    expectedChargeIds: plan.toCreate.map((charge) => charge.id),
  };
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
// ENTRENAMIENTOS, reparación de cargos ya generados con la regla vieja "si
// tuvo una ocurrencia, cuota completa"): reparación pura, idempotente y sin
// nombres/importes/fechas de ningún caso real — recalcula el cargo MÁS
// ANTIGUO real (nunca anulado) de cada (acuerdo, alumno), el único que puede
// ser genuinamente su primer período, con la MISMA fórmula canónica que ya
// usan los candidatos nuevos (`computeTrainingFirstPeriodCharge`, arriba).
// ---------------------------------------------------------------------------

export interface TrainingFirstPeriodRepairCandidate {
  chargeId: string;
  studentId: string;
  trainingBillingAgreementId: string;
  billingPeriod: string;
  previousAmount: number;
  previousDueDate: string;
  correctedAmount: number;
  correctedDueDate: string;
}

/**
 * Corrección 2026-10-04 (a pedido de Joaquín): primer período cuya fecha de incorporación NO se puede comprobar (no hay
 * acuerdo, no hay serie real o no hay ninguna ocurrencia real del alumno en el período). El cargo queda byte-idéntico;
 * sólo se informa — con ids y fechas, nunca nombres — cuando su vencimiento no coincide con el global.
 */
export interface TrainingFirstPeriodUnverifiable {
  chargeId: string;
  studentId: string;
  trainingBillingAgreementId: string;
  billingPeriod: string;
  currentDueDate: string;
  /** Primer vencimiento global del período (referencia: nunca se aplica sin evidencia de la incorporación). */
  globalDueDate: string;
}

export interface TrainingFirstPeriodRepairPlan {
  /** Sin pagos/asignaciones reales: se pueden corregir solos, sobre el mismo cargo estable. */
  toFix: TrainingFirstPeriodRepairCandidate[];
  /** Con pagos/asignaciones reales: nunca se tocan en silencio — quedan para revisión manual con trazabilidad. */
  needsReview: TrainingFirstPeriodRepairCandidate[];
  /** Sin fecha de incorporación comprobable: nunca se adivina — quedan intactos, con evidencia para revisión. */
  unverifiable: TrainingFirstPeriodUnverifiable[];
}

/**
 * Recorre todos los cargos de entrenamiento vigentes (nunca anulados),
 * encuentra el más antiguo por (acuerdo, alumno) — el único candidato real a
 * "primer período" — y lo recalcula. Si ya coincide, no hace nada
 * (idempotente: correr esto de nuevo después de una corrección real no
 * vuelve a proponer el mismo cambio). Si no hay acuerdo o serie real para
 * recalcular, se omite — nunca adivina un importe o una fecha. Pura: no muta
 * nada, no lee ningún store.
 */
export function planTrainingFirstPeriodChargeRepair(input: {
  charges: PaymentCharge[];
  allocations: PaymentAllocation[];
  agreements: TrainingBillingAgreement[];
  rules: RecurrenceRule[];
  exceptions: RecurrenceException[];
  existingLessons: CalendarLesson[];
  availability: TeacherAvailability | null;
}): TrainingFirstPeriodRepairPlan {
  const toFix: TrainingFirstPeriodRepairCandidate[] = [];
  const needsReview: TrainingFirstPeriodRepairCandidate[] = [];
  const unverifiable: TrainingFirstPeriodUnverifiable[] = [];

  const trainingCharges = input.charges.filter((charge) => charge.type === 'entrenamiento' && charge.voidedAt === null);
  const earliestByParticipant = new Map<string, PaymentCharge>();
  trainingCharges.forEach((charge) => {
    if (!charge.trainingBillingAgreementId || !charge.billingPeriod) return;
    const key = `${charge.trainingBillingAgreementId}__${charge.studentId}`;
    const current = earliestByParticipant.get(key);
    if (!current || charge.billingPeriod < (current.billingPeriod as string)) {
      earliestByParticipant.set(key, charge);
    }
  });

  earliestByParticipant.forEach((charge) => {
    const agreementId = charge.trainingBillingAgreementId as string;
    const billingPeriod = charge.billingPeriod as string;
    const markUnverifiable = () => {
      const globalDueDate = resolveMonthlyDueDate(billingPeriod, DEFAULT_MONTHLY_DUE_DAY);
      if (charge.dueDate === globalDueDate) return; // coincide con el global: no hay nada que revisar.
      unverifiable.push({
        chargeId: charge.id,
        studentId: charge.studentId,
        trainingBillingAgreementId: agreementId,
        billingPeriod,
        currentDueDate: charge.dueDate,
        globalDueDate,
      });
    };
    const agreement = input.agreements.find((item) => item.id === agreementId);
    if (!agreement) return markUnverifiable(); // sin acuerdo real: nunca se adivina el precio.

    const lineageRules = input.rules.filter(
      (rule) => rule.activityKind === 'training' && rule.trainingBillingAgreementId === agreementId
    );
    if (lineageRules.length === 0) return markUnverifiable(); // sin serie real: nunca se adivina la fecha/conteo.

    const monthlyFee = resolveEffectiveTrainingMonthlyFee(agreement, billingPeriod);
    const computation = computeTrainingFirstPeriodCharge({
      lineageRules,
      studentId: charge.studentId,
      billingPeriod,
      monthlyFee,
      exceptions: input.exceptions,
      existingLessons: input.existingLessons,
      availability: input.availability,
    });
    if (!computation) return markUnverifiable(); // sin evidencia real de ocurrencia: nunca se adivina.

    if (computation.amount === charge.originalAmount && computation.dueDate === charge.dueDate) {
      return; // ya coincide con la regla canónica: idempotente, nada que hacer.
    }

    const candidate: TrainingFirstPeriodRepairCandidate = {
      chargeId: charge.id,
      studentId: charge.studentId,
      trainingBillingAgreementId: agreementId,
      billingPeriod,
      previousAmount: charge.originalAmount,
      previousDueDate: charge.dueDate,
      correctedAmount: computation.amount,
      correctedDueDate: computation.dueDate,
    };

    const hasMovements = input.allocations.some((allocation) => allocation.chargeId === charge.id);
    if (hasMovements) {
      needsReview.push(candidate);
    } else {
      toFix.push(candidate);
    }
  });

  return { toFix, needsReview, unverifiable };
}
