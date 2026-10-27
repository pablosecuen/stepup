/**
 * Aviso para registrar el pago al guardar una clase (el «¿cómo quedó el pago?» de la app original). Al completar un registro que genera un cobro por clase con saldo
 * pendiente, la pantalla abre sola un diálogo por alumno: identifica alumno, clase, fecha, importe y saldo real, y deja registrar el pago de ESE cobro o elegir «Más tarde».
 * Quién entra a la cola lo decide esta función pura:
 *  - sólo cobros por clase VIGENTES de ese registro con saldo mayor a 0 (una clase ya pagada no se vuelve a pedir; con pago parcial se ofrece sólo el saldo; sin importe
 *    exigible o entrenamiento cubierto por su acuerdo y período no hay cobro, así que no hay aviso);
 *  - al completar el registro por primera vez, todos esos cobros; al editar un registro ya finalizado, sólo los cobros NUEVOS de ese guardado (los que ya existían antes de
 *    abrir la pantalla no se vuelven a preguntar): reabrir, editar o recargar nunca repite el aviso.
 */
import { parseMoneyInput } from "../format/money-input.ts";

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
  const parsed = parseMoneyInput(raw);
  if ("error" in parsed) return { error: parsed.error };
  const amount = parsed.amount;
  if (amount <= 0) return { error: "El importe tiene que ser mayor a 0." };
  if (amount > balance) return { error: "El importe no puede ser mayor al saldo de la clase." };
  return { amount };
}

/** Las cinco respuestas del aviso: «Pagó el total», «Pagó una parte», «Ya había pagado» registran dinero; «Quedó pendiente» y «Registrar después» no registran nada y pasan al siguiente alumno. */
export type PromptPaymentMode = "total" | "partial" | "retroactive";

/** Fecha civil real AAAA-MM-DD (rechaza «2026-02-31», vacío y otros formatos). */
export function isValidCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Qué se registra al confirmar cada respuesta, siempre contra el SALDO real del cobro de esa clase (nunca contra otra deuda):
 *  - «total»: el saldo exigible completo, no editable, con la fecha de hoy;
 *  - «partial»: el importe escrito (positivo, estricto, hasta el saldo), con la fecha de hoy;
 *  - «retroactive»: el importe escrito (hasta el saldo) con la fecha REAL del pago, que no puede ser posterior a hoy.
 */
export function resolvePromptPayment(input: { mode: PromptPaymentMode; amountRaw: string; paidAt: string; today: string; balance: number }): { amount: number; paidAt: string } | { error: string } {
  if (!(input.balance > 0)) return { error: "Ya no queda saldo pendiente para esta clase." };
  if (input.mode === "total") return { amount: input.balance, paidAt: input.today };
  if (input.mode === "retroactive") {
    if (!input.paidAt) return { error: "Elegí el día en que se pagó." };
    if (!isValidCivilDate(input.paidAt)) return { error: "La fecha del pago no es válida." };
    if (input.paidAt > input.today) return { error: "La fecha del pago no puede ser posterior a hoy." };
  }
  const parsed = validatePromptAmount(input.amountRaw, input.balance);
  if ("error" in parsed) return { error: parsed.error };
  return { amount: parsed.amount, paidAt: input.mode === "retroactive" ? input.paidAt : input.today };
}

/**
 * Saldo vigente de un cobro después de volver a leerlo del servidor (otro pago pudo registrarse desde otra pestaña o dispositivo): si ya no figura entre los cobros con saldo,
 * la clase está saldada y no se pide ni se registra otro pago. Con el cobro vigente, se muestra lo ya pagado y sólo el saldo restante.
 */
export function settleAfterRefresh(item: { total: number }, fresh: { paid: number; balance: number } | undefined): { paid: number; balance: number } {
  return fresh ? { paid: fresh.paid, balance: fresh.balance } : { paid: item.total, balance: 0 };
}
