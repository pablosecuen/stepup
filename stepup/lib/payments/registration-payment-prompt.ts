/**
 * Aviso para registrar el pago al guardar una clase (el «¿cómo quedó el pago?» de la app original). Al completar un registro que genera un cobro por clase con saldo
 * pendiente, la pantalla abre sola un diálogo por alumno: identifica alumno, clase, fecha, importe y saldo real, y deja registrar el pago de ESE cobro o elegir «Más tarde».
 * Quién entra a la cola lo decide esta función pura:
 *  - sólo cobros por clase VIGENTES de ese registro con saldo mayor a 0 (una clase ya pagada no se vuelve a pedir; con pago parcial se ofrece sólo el saldo; sin importe
 *    exigible o entrenamiento cubierto por su acuerdo y período no hay cobro, así que no hay aviso);
 *  - al completar el registro por primera vez, todos esos cobros; al editar un registro ya finalizado, sólo los cobros NUEVOS de ese guardado (los que ya existían antes de
 *    abrir la pantalla no se vuelven a preguntar): reabrir, editar o recargar nunca repite el aviso.
 */
export interface RegistrationPaymentPrompt {
  chargeId: string;
  studentId: string;
  studentName: string;
  /** Importe de la clase. */
  total: number;
  /** Ya pagado a ESTE cobro (sólo pagos vigentes). */
  paid: number;
  /** Saldo real = lo que se puede pagar ahora. */
  balance: number;
}

export function selectPaymentPrompts<T extends { chargeId: string; balance: number; state: string }>(
  statuses: readonly T[],
  options: { firstCompletion: boolean; knownChargeIds: ReadonlySet<string> }
): T[] {
  return statuses.filter((status) => status.balance > 0 && status.state !== "pagada" && (options.firstCompletion || !options.knownChargeIds.has(status.chargeId)));
}

/** Importe a pagar válido: entero positivo y no mayor al saldo; si no, el mensaje para la profesora. */
export function validatePromptAmount(raw: string, balance: number): { amount: number } | { error: string } {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "El importe tiene que ser mayor a 0." };
  if (amount > balance) return { error: "El importe no puede ser mayor al saldo de la clase." };
  return { amount };
}
