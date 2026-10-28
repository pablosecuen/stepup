// Puerto VERBATIM del original (`src/features/payments/services/registerPaymentService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentMethod } from '../types/index.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { planPaymentRegistration, type RegisterPaymentPlanResult } from '../utils/registerPaymentPlan.ts';
import { planMonthlyAmountReconciliationRepair } from '../utils/financialReconciliation.ts';
import type { SurchargeSettings } from '../utils/surchargeSettings.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore } from '../hooks/surchargeSettingsStore.ts';
import { loadFirstMonthProrationDecisionLog } from '../hooks/firstMonthProrationDecisionStore.ts';
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan } from '../../student-profile/utils/studentBillingPlan.ts';

export interface RegisterPaymentInput {
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD, elegida con el selector nativo
  notes?: string;
  now?: Date;
}

/**
 * Sólo lo que este servicio necesita del store de pagos — inyectable para
 * probar la cola real sin AsyncStorage (mismo patrón que
 * `MonthlyChargeGenerationStoreDeps`). Los dos campos de recargos son
 * OPCIONALES a propósito (corrección 2026-08-31, ERROR FINANCIERO: recargo
 * desactivado que seguía apareciendo como deuda): un llamador real (deps por
 * defecto) los usa para leer la configuración VIGENTE; una prueba que no los
 * provee sigue calculando con `surchargeSettings: undefined` (el mismo
 * `DEFAULT_SURCHARGE_SETTINGS` que ya usaban todas las pruebas existentes de
 * este servicio) — nunca toca AsyncStorage real sin que el llamador lo pida.
 */
export type RegisterPaymentStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'> & {
  hydrateSurchargeSettings?: () => Promise<SurchargeSettings>;
  getSurchargeSettingsSnapshot?: () => SurchargeSettings;
};

const defaultStoreDeps: RegisterPaymentStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
  hydrateSurchargeSettings: hydrateSurchargeSettingsStore,
  getSurchargeSettingsSnapshot,
};

/**
 * Orquesta el registro de un pago: hidrata, arma el plan puro (Payment +
 * PaymentAllocation[] distribuidos desde la obligación más antigua) y lo
 * persiste con una única `applyPaymentsMutation` — nunca se escribe el pago
 * sin sus asignaciones ni al revés. Si el plan es inválido (excede lo
 * asignable, etc.), `applyPaymentsMutation` nunca llega a ejecutarse
 * (el updater lanza antes de tocar el estado) y no se guarda nada parcial.
 *
 * Corrección 2026-08-10 (a pedido de Joaquín — BUG CRÍTICO GENERAL: cuota
 * mensual y obligación desincronizadas): ANTES de armar el plan de pago, se
 * reconcilia el cargo mensual vigente de este alumno con el importe
 * efectivo de su plan (`planMonthlyAmountReconciliationRepair`, mismo
 * criterio exacto que la reparación automática de arranque/foreground) —
 * así "Registrar pago" nunca propone un importe desincronizado ni por un
 * instante, sin depender de que la app haya vuelto a primer plano desde que
 * quedó desincronizado. Sólo se trata como alumno "activo" para este único
 * cargo puntual: registrar un pago para él es en sí mismo la señal de que
 * está siendo facturado ahora — nunca amplía el alcance a otros alumnos.
 */
export async function registerPaymentForStudent(
  input: RegisterPaymentInput,
  deps: RegisterPaymentStoreDeps = defaultStoreDeps
): Promise<RegisterPaymentPlanResult> {
  await deps.hydrate();
  // Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
  // desactivado que seguía apareciendo como deuda): snapshot VIGENTE de la
  // configuración real de recargos — nunca el default. Se usa tanto para la
  // reconciliación previa como para el plan de pago en sí.
  if (deps.hydrateSurchargeSettings) await deps.hydrateSurchargeSettings();
  const surchargeSettings = deps.getSurchargeSettingsSnapshot?.();

  const now = input.now ?? new Date();
  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const evaluationDate = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const paymentId = `payment_${input.studentId}_${now.getTime()}`;
  const firstMonthProrationDecisions = await loadFirstMonthProrationDecisionLog();

  let result: RegisterPaymentPlanResult | null = null;
  await deps.applyMutation((current) => {
    const profile = getStudentProfile(input.studentId);
    const plan = profile ? resolveStudentBillingPlan(profile) : null;
    const reconciliation =
      plan && plan.type === 'monthly'
        ? planMonthlyAmountReconciliationRepair({
            state: current,
            students: [{ id: input.studentId, status: 'activo' }],
            resolvePlan: () => plan,
            evaluationDate,
            firstMonthProrationDecisions,
            surchargeSettings,
          })
        : null;
    const reconciledState = reconciliation ? { ...current, charges: reconciliation.updatedCharges } : current;

    result = planPaymentRegistration({
      paymentId,
      studentId: input.studentId,
      amount: input.amount,
      method: input.method,
      paidAt: input.paidAt,
      recordedAt: now.toISOString(),
      todayDateKey,
      notes: input.notes,
      state: reconciledState,
      allocationIdPrefix: `${paymentId}_alloc_`,
      surchargeSettings,
    });
    return {
      ...reconciledState,
      payments: [...reconciledState.payments, result.payment],
      allocations: [...reconciledState.allocations, ...result.allocations],
    };
  });

  if (!result) {
    // Inalcanzable: si `planPaymentRegistration` lanza dentro del updater,
    // `applyPaymentsMutation` rechaza y este código nunca se ejecuta.
    throw new Error('No se pudo registrar el pago.');
  }
  return result;
}
