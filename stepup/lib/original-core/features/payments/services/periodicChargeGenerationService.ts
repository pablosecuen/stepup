// Puerto VERBATIM del original (`src/features/payments/services/periodicChargeGenerationService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { getStudentsStore } from '../../students/hooks/studentStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';
import { ARGENTINA_TIME_ZONE, addDaysToDateKey, biweeklyPeriodKey, isoWeekKey, localDateKeyInTimeZone, startOfIsoWeek } from '../utils/paymentDates.ts';
import { planPeriodicChargeGeneration, type PeriodicChargeCandidateStudent, type PeriodicChargeSkipped } from '../utils/periodicChargeGenerationPlan.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface PeriodicChargeGenerationOutcome {
  kind: 'semanal' | 'quincenal';
  createdChargeIds: string[];
  skipped: PeriodicChargeSkipped[];
}

export type PeriodicChargeGenerationStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: PeriodicChargeGenerationStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): generaliza `generateMonthlyChargesForCandidates` a
 * `'semanal'`/`'quincenal'` — mismo criterio de idempotencia vía la cola
 * interna de `applyMutation` (el plan se recalcula DENTRO del updater,
 * contra el estado ya confirmado, así dos llamadas concurrentes nunca
 * duplican un cargo).
 */
export async function generatePeriodicChargesForCandidates(
  kind: 'semanal' | 'quincenal',
  candidates: PeriodicChargeCandidateStudent[],
  createdAt: string,
  deps: PeriodicChargeGenerationStoreDeps = defaultStoreDeps
): Promise<PeriodicChargeGenerationOutcome> {
  await deps.hydrate();

  let outcome: PeriodicChargeGenerationOutcome = { kind, createdChargeIds: [], skipped: [] };

  await deps.applyMutation((current) => {
    const plan = planPeriodicChargeGeneration({
      kind,
      candidates,
      existingCharges: current.charges,
      createdAt,
    });
    outcome = { kind, createdChargeIds: plan.toCreate.map((charge) => charge.id), skipped: plan.skipped };
    if (plan.toCreate.length === 0) return current;
    return { ...current, charges: [...current.charges, ...plan.toCreate] };
  });

  return outcome;
}

/**
 * Fecha de vencimiento (date key) del cargo semanal dentro de la semana ISO
 * que empieza en `weekStartMonday`: `dueWeekday` usa la convención
 * JS (0=domingo..6=sábado); una semana ISO va de lunes a domingo, así que
 * el domingo (0) es el último día de esa semana (offset 6), no el primero.
 */
function dueDateForWeekday(weekStartMonday: string, dueWeekday: number): string {
  const offset = (dueWeekday - 1 + 7) % 7;
  return addDaysToDateKey(weekStartMonday, offset);
}

/**
 * Orquesta la generación automática de semanales y quincenales del período
 * actual (AR) al iniciar la app, análoga a `runMonthlyChargeGeneration`:
 * recorre alumnos activos, resuelve su `StudentBillingPlan` real (nunca
 * `billingType` directo — ver `resolveStudentBillingPlan`) y arma un
 * candidato con el período/vencimiento que corresponde a su plan.
 * Idempotente — llamarla varias veces nunca duplica cargos.
 */
export async function runPeriodicChargeGeneration(
  now: Date = new Date()
): Promise<PeriodicChargeGenerationOutcome[]> {
  const todayKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const createdAt = now.toISOString();

  const weeklyCandidates: PeriodicChargeCandidateStudent[] = [];
  const biweeklyCandidates: PeriodicChargeCandidateStudent[] = [];

  getStudentsStore()
    .filter((student) => student.status === 'activo')
    .forEach((student) => {
      const profile = getStudentProfile(student.id);
      if (!profile) return;
      const plan = resolveStudentBillingPlan(profile);

      if (plan.type === 'weekly') {
        const weekStart = startOfIsoWeek(todayKey);
        weeklyCandidates.push({
          studentId: student.id,
          amount: plan.amount,
          periodKey: isoWeekKey(todayKey),
          dueDate: dueDateForWeekday(weekStart, plan.dueWeekday),
        });
        return;
      }

      if (plan.type === 'biweekly') {
        const periodKey = biweeklyPeriodKey(todayKey, plan.anchorDate);
        biweeklyCandidates.push({
          studentId: student.id,
          amount: plan.amount,
          periodKey,
          dueDate: periodKey,
        });
      }
    });

  return Promise.all([
    generatePeriodicChargesForCandidates('semanal', weeklyCandidates, createdAt),
    generatePeriodicChargesForCandidates('quincenal', biweeklyCandidates, createdAt),
  ]);
}
