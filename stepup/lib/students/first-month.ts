import { DEFAULT_MONTHLY_DUE_DAY } from "../payments/billing-plan.ts";
import { resolveMonthlyDueDate } from "../payments/dates.ts";
import type { FirstMonthInput } from "../repositories/students-mapping.ts";
import { DEFAULT_FIRST_MONTH_SITUATION, isFirstMonthSituation } from "./student-form-fields.ts";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const PENDING_CONFIRMATION_MESSAGE = "Confirmá que entendés que el cargo de este mes puede figurar vencido según la fecha configurada.";

/**
 * Arma la «situación del primer mes» del alta de un alumno MENSUAL a partir de lo que llegó del formulario (la verdad la decide el servidor, nunca el navegador):
 * - sin elección vale lo mismo que el original: «Desde el próximo mes»;
 * - «ya está pago» usa la fecha real elegida (hoy por defecto) y nunca una futura;
 * - «pendiente» exige la confirmación explícita (equivale al aviso «Este mes está pendiente» del original);
 * - el vencimiento del cargo nuevo sale del día de vencimiento por defecto del plan (`resolveMonthlyDueDate`), no de un dato del navegador.
 */
export function buildFirstMonthInput(input: {
  billingType: string;
  situationText: string;
  paidAtText: string;
  confirmPending: boolean;
  todayDateKey: string;
}): { firstMonth?: FirstMonthInput; error?: string } {
  if (input.billingType !== "mensual") return {};
  const requested = input.situationText.trim();
  const situation = requested === "" ? DEFAULT_FIRST_MONTH_SITUATION : isFirstMonthSituation(requested) ? requested : null;
  if (!situation) return { error: "Elegí desde cuándo querés comenzar a controlar sus pagos." };
  const currentPeriod = input.todayDateKey.slice(0, 7);
  if (situation === "starts_next_month") return { firstMonth: { situation, currentPeriod } };
  const dueDate = resolveMonthlyDueDate(currentPeriod, DEFAULT_MONTHLY_DUE_DAY);
  if (situation === "pending") {
    if (!input.confirmPending) return { error: PENDING_CONFIRMATION_MESSAGE };
    return { firstMonth: { situation, currentPeriod, dueDate } };
  }
  const paidAt = input.paidAtText.trim() || input.todayDateKey;
  if (!DATE_KEY.test(paidAt)) return { error: "La fecha real del pago no es válida." };
  if (paidAt > input.todayDateKey) return { error: "La fecha del pago no puede ser futura." };
  return { firstMonth: { situation, currentPeriod, dueDate, paidAt } };
}
