// Puerto VERBATIM del original (`src/features/payments/services/voidChargeService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { voidCharge } from '../utils/paymentMutations.ts';
import { applyPaymentsMutation, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';

export interface VoidChargeInput {
  chargeId: string;
  reason: string;
  now?: Date;
}

/** Inyectable para probar la cola real sin AsyncStorage — mismo patrón que `VoidPaymentStoreDeps`. */
export type VoidChargeStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: VoidChargeStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

/**
 * Anula un cargo generado por error (Problema 3 — "ANULAR UN COBRO ERRÓNEO
 * DESDE EL ALUMNO"): nunca lo borra — `voidCharge` sólo marca
 * `voidedAt`/`voidReason` (mismo mecanismo, ya existente en
 * `paymentMutations.ts`, que usa `voidPayment` para pagos). Un cargo
 * anulado desaparece automáticamente de toda vista de pendientes/vencidos/
 * Centro de cobros porque `recalculateAllChargeStates`,
 * `calculateAssignableDebt` y el resto del motor financiero ya filtran
 * `voidedAt === null` en todos lados — no hace falta (ni se debe agregar)
 * un segundo filtro paralelo acá.
 *
 * Bloqueo obligatorio: un cargo con al menos una asignación vigente (pago
 * activo aplicado) NUNCA se anula directamente — anularlo dejaría esa
 * `PaymentAllocation` apuntando a un cargo inexistente-para-fines-prácticos
 * (un movimiento huérfano). La profesora debe anular primero el/los pagos
 * involucrados (`voidPaymentForStudent`, ya existente) y recién entonces
 * puede anular el cargo. Nunca se auto-revierte el pago por ella: cambiar
 * dinero ya cobrado sin que lo pida explícitamente sería la clase de acción
 * silenciosa que este proyecto prohíbe.
 *
 * Idempotente por construcción: `voidCharge` ya lanza si el cargo no existe
 * o ya está anulado (nunca anula dos veces, nunca un doble toque anula "la
 * próxima" obligación por error de índice — siempre por `chargeId` exacto).
 */
export async function voidChargeForStudent(
  input: VoidChargeInput,
  deps: VoidChargeStoreDeps = defaultStoreDeps
): Promise<void> {
  await deps.hydrate();
  const now = input.now ?? new Date();
  await deps.applyMutation((current) => {
    const hasActiveAllocation = current.allocations.some((allocation) => {
      if (allocation.chargeId !== input.chargeId) return false;
      const payment = current.payments.find((item) => item.id === allocation.paymentId);
      return payment !== undefined && payment.voidedAt === null;
    });
    if (hasActiveAllocation) {
      throw new Error(
        'Este cobro tiene pagos asignados. Anulá primero esos pagos y después volvé a intentar anular el cobro.'
      );
    }
    return {
      ...current,
      charges: voidCharge(current.charges, input.chargeId, input.reason, now.toISOString()),
    };
  });
}
