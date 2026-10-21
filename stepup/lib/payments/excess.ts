/**
 * Exceso pagado sobre el importe base de un cobro (traslado desde TeacherFlow anterior). Es SÓLO presentación: el importe original, lo pagado y el saldo se calculan como siempre
 * (`charge-balance.ts`) y no cambian. El exceso ya está incluido en el monto de la asignación; acá sólo se lo separa para mostrarlo vinculado a su pago.
 *
 * Nunca se presenta como recargo confirmado salvo que su estado lo diga: `pendiente_de_clasificacion` significa que NO se pudo confirmar su causa y no se le atribuye ninguna.
 */

export type ExcessStatus = "recargo_confirmado" | "pendiente_de_clasificacion";

export interface AllocationExcessLike {
  id: string;
  chargeId: string;
  paymentId: string;
  excessAmount: number;
  excessStatus: ExcessStatus | null;
}

export interface ExcessLine {
  allocationId: string;
  paymentId: string;
  amount: number;
  status: ExcessStatus;
}

/** Líneas de exceso de un cobro: sólo de pagos NO anulados (el exceso de un pago anulado ya no se cobró). */
export function excessLinesForCharge(chargeId: string, allocations: readonly AllocationExcessLike[], voidedAtByPaymentId: ReadonlyMap<string, string | null>): ExcessLine[] {
  return allocations
    .filter((a) => a.chargeId === chargeId && a.excessAmount > 0 && a.excessStatus !== null && (voidedAtByPaymentId.get(a.paymentId) ?? null) === null)
    .map((a) => ({ allocationId: a.id, paymentId: a.paymentId, amount: a.excessAmount, status: a.excessStatus as ExcessStatus }));
}

/** Exceso por pago (para mostrarlo en el historial de pagos): sólo pagos no anulados. */
export function excessLinesForPayment(paymentId: string, allocations: readonly AllocationExcessLike[], voidedAtByPaymentId: ReadonlyMap<string, string | null>): ExcessLine[] {
  if ((voidedAtByPaymentId.get(paymentId) ?? null) !== null) return [];
  return allocations
    .filter((a) => a.paymentId === paymentId && a.excessAmount > 0 && a.excessStatus !== null)
    .map((a) => ({ allocationId: a.id, paymentId: a.paymentId, amount: a.excessAmount, status: a.excessStatus as ExcessStatus }));
}

export function sumExcess(lines: readonly ExcessLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.amount * 100, 0)) / 100;
}

/** Texto del estado (siempre con palabras, nunca sólo color). */
export const EXCESS_STATUS_LABEL: Record<ExcessStatus, string> = {
  recargo_confirmado: "Recargo confirmado",
  pendiente_de_clasificacion: "Pendiente de clasificación",
};

/** Qué significa, en lenguaje simple. El pendiente aclara que NO está confirmado como recargo. */
export function excessExplanation(status: ExcessStatus): string {
  return status === "recargo_confirmado"
    ? "Coincide con el recargo que TeacherFlow anterior calculaba el día en que se saldó el cobro. El importe original y el saldo no cambian."
    : "Se cobró por encima del importe base. Todavía no se confirmó como recargo ni se clasificó de otra forma, y no se le atribuye ninguna causa. El importe original y el saldo no cambian.";
}
