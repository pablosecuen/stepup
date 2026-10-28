import { buildStudentPaymentsSummary } from "./engine/features/payments/utils/studentPaymentsSummary.ts";
import { buildStudentPaymentHistory, type StudentPaymentHistory } from "./engine/features/payments/utils/studentPaymentHistory.ts";
import {
  resolveCurrentMonthlyPeriodStatus,
  resolveSuggestedMonthlyPaymentAmount,
  type CurrentMonthlyPeriodStatus,
  type SuggestedMonthlyPaymentAmount,
} from "./engine/features/payments/utils/monthlyPeriodStatus.ts";
import type { ScoreCategory } from "./engine/features/payments/types/index.ts";
import type { StudentMonthlyPaymentCategory } from "./engine/features/payments/utils/paymentStats.ts";
import { toEnginePaymentsState } from "../students/list-status.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../repositories/payments-mapping.ts";
import type { StudentBillingPlan } from "./billing-plan.ts";

/** Categorías del puntaje de un alumno, siempre con TEXTO (nunca sólo color). */
export const SCORE_CATEGORY_LABEL: Record<ScoreCategory, string> = {
  excelente: "Excelente",
  buena: "Buena",
  irregular: "Irregular",
  riesgo_de_deuda: "Riesgo de deuda",
  historial_insuficiente: "Historial insuficiente",
};

export const MONTH_CATEGORY_LABEL: Record<StudentMonthlyPaymentCategory, string> = {
  en_termino: "en término",
  primer_vencimiento: "primer vencimiento",
  segundo_vencimiento: "segundo vencimiento",
  ultimo_vencimiento: "saldada tarde (último vencimiento)",
  mantiene_deuda: "deuda vigente sin saldar",
};

export interface StudentCobrosOverview {
  history: StudentPaymentHistory;
  /** Estado del mes actual de un alumno mensual (`null` para los demás planes). */
  currentMonth: CurrentMonthlyPeriodStatus | null;
  /** Importe a proponer para «Marcar mes actual como pagado» (el saldo REAL del cargo si existe; `null` si el plan no es mensual). */
  suggested: SuggestedMonthlyPaymentAmount | null;
  /** Pagos vigentes del mes actual que son una DECLARACIÓN de situación inicial (no un ingreso observado). */
  declaredInitialPaymentIds: string[];
}

/**
 * Historial y estado financiero de UN alumno, con el motor del original (copia idéntica en `lib/payments/engine`): `buildStudentPaymentHistory` (12 meses, puntaje, en término/fuera de término, deuda actual y
 * racha), `resolveCurrentMonthlyPeriodStatus` y `resolveSuggestedMonthlyPaymentAmount`. Se recalcula siempre desde cobros, pagos y asignaciones del propio alumno; los recargos están desactivados.
 */
export function buildStudentCobrosOverview(input: {
  studentId: string;
  plan: StudentBillingPlan;
  charges: readonly PaymentChargeRecord[];
  payments: readonly PaymentRecord[];
  allocations: readonly PaymentAllocationRecord[];
  todayDateKey: string;
}): StudentCobrosOverview {
  const ownCharges = input.charges.filter((charge) => charge.studentId === input.studentId);
  const ownPayments = input.payments.filter((payment) => payment.studentId === input.studentId);
  const ownAllocations = input.allocations.filter((allocation) => allocation.studentId === input.studentId);
  const state = toEnginePaymentsState({ charges: ownCharges, payments: ownPayments, allocations: ownAllocations });
  const history = buildStudentPaymentHistory({ studentId: input.studentId, state, evaluationDate: input.todayDateKey });
  const summary = buildStudentPaymentsSummary({ studentId: input.studentId, state, evaluationDate: input.todayDateKey });
  const currentMonth = resolveCurrentMonthlyPeriodStatus({ plan: input.plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: input.todayDateKey });
  const suggested = input.plan.type === "monthly" ? resolveSuggestedMonthlyPaymentAmount({ plan: input.plan, charges: summary.charges, chargeStates: summary.chargeStates, evaluationDate: input.todayDateKey }) : null;
  const period = input.todayDateKey.slice(0, 7);
  const declaredInitialPaymentIds = summary.activePayments.filter((payment) => payment.source === "initial_student_setup" && payment.paidAt.slice(0, 7) === period).map((payment) => payment.id);
  return { history, currentMonth, suggested, declaredInitialPaymentIds };
}
