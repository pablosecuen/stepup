// Puerto VERBATIM del original (`src/features/payments/services/voidPaymentService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { voidPayment } from '../utils/paymentMutations.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface VoidPaymentInput {
  paymentId: string;
  reason: string;
  now?: Date;
}

/** Inyectable para probar la cola real sin AsyncStorage — mismo patrón que `RegisterPaymentStoreDeps`. */
export type VoidPaymentStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: VoidPaymentStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Anula un pago (nunca lo borra: `voidPayment` sólo marca `voidedAt`/
 * `voidReason`, el registro sigue visible en el historial). No implementa
 * edición directa — una corrección real es "anular + nuevo pago", que la
 * UI arma como dos pasos separados (este servicio + `registerPaymentForStudent`).
 *
 * Corrección 2026-08-17 (a pedido de Joaquín — auditoría exhaustiva de
 * cambio de monto mensual, hallazgo real detectado por
 * `analyzeFinancialConsistency` durante la prueba del caso 29): las
 * asignaciones (`PaymentAllocation`) del pago anulado quedaban en el
 * array — `PaymentAllocation` no tiene (ni necesita) su propio
 * `voidedAt`: nunca se muestra a la profesora, es sólo la relación interna
 * de reparto para calcular saldos, y `calculatePaidAmountForCharge` ya las
 * excluye correctamente por el `voidedAt` del PAGO. Pero dejarlas en el
 * array es exactamente lo que `voided_payment_with_active_allocations`
 * detecta como inconsistencia real — se quitan acá, en la misma mutación
 * atómica, sin tocar ni perder el `Payment` histórico en sí (que sigue
 * íntegro y visible como anulado).
 */
export async function voidPaymentForStudent(
  input: VoidPaymentInput,
  deps: VoidPaymentStoreDeps = defaultStoreDeps
): Promise<void> {
  await deps.hydrate();
  const now = input.now ?? new Date();
  await deps.applyMutation((current) => ({
    ...current,
    payments: voidPayment(current.payments, input.paymentId, input.reason, now.toISOString()),
    allocations: current.allocations.filter((allocation) => allocation.paymentId !== input.paymentId),
  }));
}
