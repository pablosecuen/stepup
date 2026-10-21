import { billingPeriodOfDateKey, toDateKey } from "../payments/dates.ts";
import { calculateChargeBalance } from "../payments/charge-balance.ts";

/**
 * Las tres cifras del mes en curso que la app muestra junto a «Facturación prevista / Cobrado / Pendiente / Vencido» (puerto de `buildHomeFinancialSummary`, móvil):
 *  - Deuda de meses anteriores: saldo positivo de cargos activos cuyo vencimiento es ANTERIOR al mes actual (un pago del mes pasado nunca salda el período nuevo).
 *  - Alumnos que pagaron este mes: alumnos ÚNICOS con una asignación vigente cuyo pago real (`paidAt`) cae en el mes actual — nunca la cantidad de pagos.
 *  - Alumnos con deuda: alumnos ÚNICOS con saldo pendiente (en término o vencido) mayor a cero.
 * Un cargo de un alumno que no está «activo» nunca cuenta como deuda vigente (misma regla única de cobros), pero un pago ya cobrado sigue contando como pagado. Cargos y pagos anulados se ignoran. PURO.
 */
export interface MonthSnapshotInput {
  charges: readonly { id: string; studentId: string; originalAmount: number; dueDate: string; voidedAt: string | null }[];
  allocations: readonly { chargeId: string; paymentId: string; amount: number }[];
  payments: readonly { id: string; paidAt: string; voidedAt: string | null }[];
  studentStatusById: ReadonlyMap<string, string>;
  /** Fecha civil de hoy (Argentina), `YYYY-MM-DD`. */
  evaluationDate: string;
}

export interface MonthSnapshot {
  priorPeriodsDebt: number;
  studentsPaidThisMonth: number;
  studentsWithDebt: number;
}

export function buildMonthSnapshot(input: MonthSnapshotInput): MonthSnapshot {
  const currentMonth = billingPeriodOfDateKey(input.evaluationDate);
  const activeCharges = input.charges.filter((charge) => charge.voidedAt === null);
  const chargeById = new Map(activeCharges.map((charge) => [charge.id, charge]));
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));

  const paidAmountByCharge = new Map<string, number>();
  const studentsPaid = new Set<string>();
  input.allocations.forEach((allocation) => {
    const charge = chargeById.get(allocation.chargeId);
    const payment = paymentById.get(allocation.paymentId);
    if (!charge || !payment || payment.voidedAt !== null) return;
    paidAmountByCharge.set(charge.id, (paidAmountByCharge.get(charge.id) ?? 0) + allocation.amount);
    if (billingPeriodOfDateKey(toDateKey(payment.paidAt)) === currentMonth) studentsPaid.add(charge.studentId);
  });

  let priorPeriodsDebt = 0;
  const studentsWithDebt = new Set<string>();
  activeCharges.forEach((charge) => {
    const { balance } = calculateChargeBalance(charge, paidAmountByCharge.get(charge.id) ?? 0);
    if (balance <= 0) return;
    // Mismo criterio que el resto de cobros: sólo un alumno activo es una deuda vigente.
    if ((input.studentStatusById.get(charge.studentId) ?? "activo") !== "activo") return;
    if (billingPeriodOfDateKey(charge.dueDate) < currentMonth) priorPeriodsDebt += balance;
    studentsWithDebt.add(charge.studentId);
  });

  return { priorPeriodsDebt, studentsPaidThisMonth: studentsPaid.size, studentsWithDebt: studentsWithDebt.size };
}
