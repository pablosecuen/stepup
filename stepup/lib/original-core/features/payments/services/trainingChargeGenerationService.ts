// Puerto VERBATIM del original (`src/features/payments/services/trainingChargeGenerationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../../calendar/hooks/calendarStore.ts';
import { getTeacherAvailability, hydrateTeacherAvailability } from '../../calendar/hooks/teacherAvailabilityStore.ts';
import { getTrainingBillingAgreementsSnapshot, hydrateTrainingBillingAgreements } from '../hooks/trainingBillingAgreementsStore.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { planTrainingChargeGeneration, planTrainingChargeGenerationForPeriodRange, selectTrainingChargeCandidates, type TrainingChargeCandidate, type TrainingChargeSkipped } from '../utils/trainingChargeGenerationPlan.ts';
import type { TrainingBillingAgreement } from '../types/index.ts';
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TeacherAvailability } from '../../calendar/types/teacherAvailability.ts';
import type { StudentStatus } from '../../student-profile/types/index.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface TrainingChargeGenerationOutcome {
  billingPeriod: string;
  createdChargeIds: string[];
  skipped: TrainingChargeSkipped[];
}

/** Sólo lo que esta pieza necesita del store de pagos — inyectable para probar la cola real sin AsyncStorage. */
export type TrainingChargeGenerationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: TrainingChargeGenerationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): genera las cuotas de entrenamiento faltantes para
 * `candidates` en `billingPeriod`. Mismo patrón EXACTO que
 * `generateMonthlyChargesForCandidates` (`monthlyChargeGenerationService.ts`):
 * el plan se calcula DENTRO del updater de `applyMutation`, contra
 * `current.charges` (el estado ya confirmado en ese instante de la cola) —
 * nunca contra un snapshot leído antes de entrar a la mutación, así dos
 * llamadas concurrentes nunca duplican el mismo cargo.
 */
export async function generateTrainingChargesForCandidates(
  candidates: TrainingChargeCandidate[],
  billingPeriod: string,
  createdAt: string,
  deps: TrainingChargeGenerationStoreDeps = defaultStoreDeps
): Promise<TrainingChargeGenerationOutcome> {
  await deps.hydrate();

  let outcome: TrainingChargeGenerationOutcome = { billingPeriod, createdChargeIds: [], skipped: [] };

  await deps.applyMutation((current) => {
    const plan = planTrainingChargeGeneration({
      candidates,
      existingCharges: current.charges,
      billingPeriod,
      createdAt,
    });
    outcome = { billingPeriod, createdChargeIds: plan.toCreate.map((charge) => charge.id), skipped: plan.skipped };
    if (plan.toCreate.length === 0) return current;
    return { ...current, charges: [...current.charges, ...plan.toCreate] };
  });

  return outcome;
}

/**
 * Orquesta la generación automática de la cuota de entrenamiento del mes
 * actual (AR) al iniciar la app o volver a primer plano — mismo ciclo que
 * `runMonthlyChargeGeneration`, en paralelo y totalmente independiente (una
 * serie de entrenamiento nunca genera ni afecta la mensualidad de clases, y
 * viceversa). Carga reglas/clases/excepciones/disponibilidad directo de
 * AsyncStorage (variante de arranque, mismo patrón que
 * `repairStaleNextClassAtOnAppStart`) — no depende de que ninguna pantalla
 * de Calendario esté montada. Idempotente por construcción
 * (`buildTrainingChargeId`).
 */
export async function runTrainingChargeGeneration(now: Date = new Date()): Promise<TrainingChargeGenerationOutcome> {
  const billingPeriod = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE).slice(0, 7);
  const createdAt = now.toISOString();

  const [lessons, rules, exceptions, availability] = await Promise.all([
    loadCalendarLessons(),
    loadRecurrenceRules(),
    loadRecurrenceExceptions(),
    hydrateTeacherAvailability(),
  ]);
  const agreements = await hydrateTrainingBillingAgreements();

  // Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
  // ENTRENAMIENTOS): hidrata el store de pagos ANTES de armar los
  // candidatos — `selectTrainingChargeCandidates` necesita los cargos ya
  // reales para saber si un candidato es su primer período facturado o no.
  await defaultStoreDeps.hydrate();
  const existingCharges = getPaymentsSnapshot().charges;

  const candidates: TrainingChargeCandidate[] = selectTrainingChargeCandidates({
    agreements,
    rules: rules ?? [],
    lessons: lessons ?? [],
    exceptions: exceptions ?? [],
    availability: availability ?? getTeacherAvailability(),
    students: getStudentsStore().map((student) => ({
      id: student.id,
      status: student.status,
      statusChangeDate: getStudentProfile(student.id)?.statusChangeDate ?? null,
    })),
    existingCharges,
    billingPeriod,
  });

  return generateTrainingChargesForCandidates(candidates, billingPeriod, createdAt);
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — SERIES EXISTENTES sin
 * configuración financiera): ejecuta, contra el store real de pagos, el
 * MISMO plan de varios períodos que ya vio la profesora en la
 * previsualización (`planTrainingChargeGenerationForPeriodRange`, llamada
 * acá adentro con exactamente los mismos datos, dentro del updater de
 * `applyMutation` — mismo patrón de concurrencia que
 * `generateTrainingChargesForCandidates`). Usada por "Configurar cuota de
 * entrenamiento" al confirmar — nunca genera nada por su cuenta si la
 * profesora no confirmó antes viendo esta misma previsualización.
 */
export async function runTrainingChargeGenerationForPeriodRange(
  input: {
    agreements: TrainingBillingAgreement[];
    rules: RecurrenceRule[];
    lessons: CalendarLesson[];
    exceptions: RecurrenceException[];
    availability: TeacherAvailability | null;
    students: Array<{ id: string; status: StudentStatus; statusChangeDate?: string | null }>;
    startPeriod: string;
    endPeriod: string;
    createdAt: string;
  },
  deps: TrainingChargeGenerationStoreDeps = defaultStoreDeps
): Promise<TrainingChargeGenerationOutcome> {
  await deps.hydrate();

  let outcome: TrainingChargeGenerationOutcome = { billingPeriod: input.endPeriod, createdChargeIds: [], skipped: [] };

  await deps.applyMutation((current) => {
    const plan = planTrainingChargeGenerationForPeriodRange({
      agreements: input.agreements,
      rules: input.rules,
      lessons: input.lessons,
      exceptions: input.exceptions,
      availability: input.availability,
      students: input.students,
      existingCharges: current.charges,
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
      createdAt: input.createdAt,
    });
    outcome = {
      billingPeriod: input.endPeriod,
      createdChargeIds: plan.toCreate.map((charge) => charge.id),
      skipped: plan.skipped,
    };
    if (plan.toCreate.length === 0) return current;
    return { ...current, charges: [...current.charges, ...plan.toCreate] };
  });

  return outcome;
}
