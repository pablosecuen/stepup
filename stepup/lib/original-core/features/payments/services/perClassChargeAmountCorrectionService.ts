// Puerto VERBATIM del original (`src/features/payments/services/perClassChargeAmountCorrectionService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { buildPerClassChargeId } from '../utils/paymentIdempotency.ts';
import { applyPaymentsMutation, hydratePaymentsStore, getPaymentsSnapshot, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import type { PaymentCharge } from '../types/index.ts';

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 2: editar una
 * clase registrada debe reflejar sus consecuencias de cobro, usando el
 * motor financiero existente): `reconcilePerClassCharges` es "crear si
 * falta" por id determinístico — nunca actualiza un cargo ya creado. Este
 * servicio es el complemento: ajusta el `originalAmount` de un cargo por
 * clase YA EXISTENTE, pero SÓLO si nadie le asignó un pago todavía (mismo
 * criterio que decide `planPerClassChargeAdjustmentForEdit`, en
 * `new-class/utils/editRegisteredLessonDomain.ts` — este servicio nunca
 * decide por sí mismo, sólo ejecuta lo que ese plan puro ya determinó
 * seguro). Nunca borra ni recrea el cargo — mismo id, mismo `dueDate`,
 * sólo cambia el importe.
 */
export type CorrectPerClassChargeAmountStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: CorrectPerClassChargeAmountStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

export function findPerClassCharge(
  studentId: string,
  savedLessonId: string,
  charges: PaymentCharge[]
): PaymentCharge | null {
  const id = buildPerClassChargeId(studentId, savedLessonId);
  return charges.find((charge) => charge.id === id) ?? null;
}

export function countAllocationsForCharge(
  chargeId: string,
  allocations: Array<{ chargeId: string }>
): number {
  return allocations.filter((allocation) => allocation.chargeId === chargeId).length;
}

/**
 * Ajusta el importe de un cargo por clase existente. Vuelve a comprobar
 * DENTRO de la mutación atómica que sigue sin tener ninguna asignación de
 * pago (mismo motivo que `reconcileChargesForLessons` recalcula dentro de
 * `applyMutation`: nunca confiar en un snapshot leído antes de entrar a la
 * cola) — si alguna asignación llegó mientras tanto, no toca nada y
 * devuelve `blocked: true` en vez de arriesgar un importe inconsistente
 * con un pago ya registrado.
 */
export async function correctPerClassChargeAmount(
  input: { studentId: string; savedLessonId: string; newAmount: number },
  deps: CorrectPerClassChargeAmountStoreDeps = defaultStoreDeps
): Promise<{ corrected: boolean; blocked: boolean }> {
  await deps.hydrate();
  const chargeId = buildPerClassChargeId(input.studentId, input.savedLessonId);
  let corrected = false;
  let blocked = false;

  await deps.applyMutation((current) => {
    const charge = current.charges.find((item) => item.id === chargeId);
    if (!charge) return current;
    const hasAllocations = countAllocationsForCharge(chargeId, current.allocations) > 0;
    if (hasAllocations) {
      blocked = true;
      return current;
    }
    if (charge.originalAmount === input.newAmount) return current;
    corrected = true;
    return {
      ...current,
      charges: current.charges.map((item) =>
        item.id === chargeId ? { ...item, originalAmount: input.newAmount } : item
      ),
    };
  });

  return { corrected, blocked };
}

export function getCurrentPaymentsChargesAndAllocations(): { charges: PaymentCharge[]; allocations: Array<{ chargeId: string }> } {
  const snapshot = getPaymentsSnapshot();
  return { charges: snapshot.charges, allocations: snapshot.allocations };
}
