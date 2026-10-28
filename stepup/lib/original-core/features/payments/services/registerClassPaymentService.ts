// Puerto VERBATIM del original (`src/features/payments/services/registerClassPaymentService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentMethod } from '../types/index.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone } from '../utils/paymentDates.ts';
import { planSingleChargePaymentRegistration, type RegisterPaymentPlanResult } from '../utils/registerPaymentPlan.ts';
import { applyPaymentsMutation, hydratePaymentsStore } from '../hooks/paymentsStore.ts';
import { getSurchargeSettingsSnapshot, hydrateSurchargeSettingsStore } from '../hooks/surchargeSettingsStore.ts';

export interface RegisterClassPaymentInput {
  studentId: string;
  /** El cargo "por clase" exacto al que se aplica este pago (nunca se reparte a otra obligación). */
  chargeId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // YYYY-MM-DD, elegida en la pregunta post-clase
  notes?: string;
  now?: Date;
}

/**
 * Orquesta el registro del pago de UNA clase puntual (Fase Pagos 4B.2): el
 * plan se calcula DENTRO del updater de `applyPaymentsMutation`, contra el
 * estado ya confirmado en ese momento — mismo patrón anti-TOCTOU que
 * `registerPaymentService.ts` y los servicios de generación de cargos. Si el
 * plan es inválido (excede la capacidad segura, cargo inexistente, etc.),
 * el updater lanza antes de tocar el estado y no se guarda nada parcial.
 */
export async function registerClassPaymentForStudent(
  input: RegisterClassPaymentInput
): Promise<RegisterPaymentPlanResult> {
  await hydratePaymentsStore();
  // Corrección 2026-08-31 (a pedido de Joaquín — ERROR FINANCIERO: recargo
  // desactivado que seguía apareciendo como deuda): asegura la hidratación
  // y lee el snapshot VIGENTE (nunca el valor congelado de la primera
  // hidratación — la profesora pudo cambiar la configuración después) antes
  // de planificar. Sin esto, la capacidad máxima aceptada para el pago de
  // una clase suelta se calculaba como si los recargos siempre estuvieran
  // activados.
  await hydrateSurchargeSettingsStore();
  const surchargeSettings = getSurchargeSettingsSnapshot();

  const now = input.now ?? new Date();
  const todayDateKey = localDateKeyInTimeZone(now, ARGENTINA_TIME_ZONE);
  const paymentId = `payment_${input.studentId}_${input.chargeId}_${now.getTime()}`;

  let result: RegisterPaymentPlanResult | null = null;
  await applyPaymentsMutation((current) => {
    result = planSingleChargePaymentRegistration({
      paymentId,
      studentId: input.studentId,
      chargeId: input.chargeId,
      amount: input.amount,
      method: input.method,
      paidAt: input.paidAt,
      recordedAt: now.toISOString(),
      todayDateKey,
      notes: input.notes,
      state: current,
      allocationId: `${paymentId}_alloc_1`,
      surchargeSettings,
    });
    return {
      ...current,
      payments: [...current.payments, result.payment],
      allocations: [...current.allocations, ...result.allocations],
    };
  });

  if (!result) {
    // Inalcanzable: si `planSingleChargePaymentRegistration` lanza dentro
    // del updater, `applyPaymentsMutation` rechaza y este código nunca se
    // ejecuta.
    throw new Error('No se pudo registrar el pago de la clase.');
  }
  return result;
}
