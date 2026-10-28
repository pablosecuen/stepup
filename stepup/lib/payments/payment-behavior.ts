import { recalculateAllChargeStates } from "./engine/features/payments/utils/paymentCalculations.ts";
import { buildLastNMonthsUniqueStudentStats, type MonthlyUniqueStudentPaymentStats } from "./engine/features/payments/utils/paymentStats.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../repositories/payments-mapping.ts";
import { toEnginePaymentsState } from "../students/list-status.ts";

export type PaymentBehaviorMonth = MonthlyUniqueStudentPaymentStats;

export const PAYMENT_BEHAVIOR_SEGMENTS = [
  { key: "studentsOnTime", label: "En término", barClass: "bg-statusVerde" },
  { key: "studentsFirstLate", label: "Primer vencimiento", barClass: "bg-statusAmarillo" },
  { key: "studentsSecondLate", label: "Segundo vencimiento", barClass: "bg-statusNaranja" },
  { key: "studentsLastLate", label: "Último vencimiento", barClass: "bg-statusRojo" },
  // Distinto color a propósito: «último vencimiento» es una obligación que SÍ se terminó pagando (tarde); la deuda sigue sin saldarse. Confundirlas ocultaría el dato más importante.
  { key: "studentsInDebt", label: "Mantiene deuda vencida", barClass: "bg-textPrimary" },
] as const;

/**
 * Comportamiento de pago de los últimos 12 meses: cuántos alumnos únicos pagaron en término, en cada vencimiento o mantienen deuda vencida (cada alumno cuenta UNA vez por mes, en su peor
 * categoría). Calculado con el motor de pagos del original (copia idéntica en `lib/payments/engine`) a partir de cobros, pagos y asignaciones — nunca del estado heredado de un alumno.
 */
export function buildPaymentBehavior(input: { charges: readonly PaymentChargeRecord[]; payments: readonly PaymentRecord[]; allocations: readonly PaymentAllocationRecord[]; todayDateKey: string; months?: number }): PaymentBehaviorMonth[] {
  const state = toEnginePaymentsState({ charges: input.charges, payments: input.payments, allocations: input.allocations });
  const states = recalculateAllChargeStates({ charges: state.charges, allocations: state.allocations, payments: state.payments, adjustments: state.adjustments, evaluationDate: input.todayDateKey });
  return buildLastNMonthsUniqueStudentStats(state.charges, states, input.todayDateKey, input.months ?? 12);
}
