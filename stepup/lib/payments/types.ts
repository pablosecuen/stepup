/**
 * Tipos puros del dominio Cobros — espejan `payments/types/index.ts` del
 * móvil, acotados a lo que Fase 5 realmente porta (mensual, por_clase,
 * entrenamiento). `charge_type` en la base admite además 'semanal',
 * 'quincenal' y 'paquete' (mismo check constraint que el móvil), pero esos
 * tres tipos nunca se generan desde esta fase — no están en el alcance
 * pedido, quedan documentados como pendiente en WEB_PARITY_PLAN.md.
 */
export type PaymentChargeType = "mensual" | "por_clase" | "semanal" | "quincenal" | "paquete" | "entrenamiento";

export type PaymentDueStage = "on_time" | "first_late" | "second_late" | "last_late";

export type PaymentMethod = "efectivo" | "transferencia" | "otro";

export interface PaymentChargeLike {
  id: string;
  chargeType: PaymentChargeType;
  originalAmount: number;
  dueDate: string; // YYYY-MM-DD
  voidedAt: string | null;
}

export interface PaymentAllocationLike {
  chargeId: string;
  amount: number;
  paymentVoidedAt: string | null;
}
