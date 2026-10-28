// Puerto VERBATIM del original (`src/features/payments/services/monthlyChargeGenerationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { planMonthlyChargeGeneration, selectMonthlyChargeCandidates, type MonthlyChargeCandidateStudent, type MonthlyChargeSkipped } from '../utils/monthlyChargeGenerationPlan.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface MonthlyChargeGenerationOutcome {
  billingPeriod: string;
  createdChargeIds: string[];
  skipped: MonthlyChargeSkipped[];
}

/** Sólo lo que esta pieza necesita del store de pagos — inyectable para probar la cola real sin AsyncStorage. */
export type MonthlyChargeGenerationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: MonthlyChargeGenerationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Genera las mensualidades faltantes para `candidates` en `billingPeriod`.
 * El plan se calcula DENTRO del updater de `applyMutation`, contra
 * `current.charges` (el estado ya confirmado en ese momento de la cola),
 * no contra un snapshot leído antes de entrar a la mutación — así dos
 * llamadas concurrentes (por ejemplo, dos aperturas casi simultáneas de la
 * app) nunca pueden planificar ambas sobre el mismo estado "vacío" y
 * terminar creando el mismo cargo dos veces: la cola interna del store
 * serializa las escrituras, así que la segunda llamada siempre planifica
 * viendo lo que la primera ya agregó.
 */
export async function generateMonthlyChargesForCandidates(
  candidates: MonthlyChargeCandidateStudent[],
  billingPeriod: string,
  createdAt: string,
  deps: MonthlyChargeGenerationStoreDeps = defaultStoreDeps
): Promise<MonthlyChargeGenerationOutcome> {
  await deps.hydrate();

  let outcome: MonthlyChargeGenerationOutcome = { billingPeriod, createdChargeIds: [], skipped: [] };

  await deps.applyMutation((current) => {
    const plan = planMonthlyChargeGeneration({
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
 * Orquesta la generación automática de la mensualidad del mes actual (AR)
 * al iniciar la app: alumnos activos cuyo `StudentBillingPlan` resuelto
 * (`resolveStudentBillingPlan` — nunca `billingType` directo, corrección
 * 2026-07-26) es `'monthly'`, usando el importe VIGENTE del plan (no un
 * precio histórico). Idempotente — llamarla varias veces (varios inicios de
 * la app en el mismo mes, incluso simultáneos) nunca duplica cargos. Nunca
 * genera meses anteriores: siempre usa el mes actual resuelto en huso
 * horario de Buenos Aires, sin importar el huso del dispositivo.
 *
 * `plan.startPeriod` (opcional): un alumno que eligió "comienza a pagar el
 * mes siguiente" al darse de alta guarda ese primer período en
 * `startPeriod` — mientras `billingPeriod` (el mes que se está generando)
 * sea anterior a `startPeriod`, el alumno se excluye de los candidatos por
 * completo, así nunca se le genera una obligación de un mes en el que
 * todavía no debía empezar a pagar. Comparar dos 'YYYY-MM' con `<` ya da el
 * orden cronológico correcto (mismo ancho fijo).
 */
export async function runMonthlyChargeGeneration(now: Date = new Date()): Promise<MonthlyChargeGenerationOutcome> {
  const billingPeriod = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE).slice(0, 7);
  const createdAt = now.toISOString();

  const candidates: MonthlyChargeCandidateStudent[] = selectMonthlyChargeCandidates({
    // Corrección 2026-09-02 (a pedido de Joaquín — ESTADO INACTIVO): la
    // fecha efectiva del cambio de estado vive en el perfil completo
    // (`StudentProfile.statusChangeDate`), no en el `StudentListItem`
    // liviano — se resuelve acá, una vez por alumno, igual que ya se hace
    // para el plan de cobro.
    students: getStudentsStore().map((student) => ({
      id: student.id,
      status: student.status,
      statusChangeDate: getStudentProfile(student.id)?.statusChangeDate ?? null,
    })),
    resolvePlan: (studentId) => {
      const profile = getStudentProfile(studentId);
      return profile ? resolveStudentBillingPlan(profile) : null;
    },
    billingPeriod,
  });

  return generateMonthlyChargesForCandidates(candidates, billingPeriod, createdAt);
}
