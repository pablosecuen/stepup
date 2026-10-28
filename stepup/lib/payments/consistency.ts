import { analyzeFinancialConsistency, type FinancialInconsistencyCategory } from "./engine/features/payments/utils/financialReconciliation.ts";
import type { FirstMonthProrationDecision } from "./engine/features/payments/types/index.ts";
import type { StudentBillingPlan as EnginePlan } from "./engine/features/student-profile/types/index.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "./billing-plan.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../repositories/payments-mapping.ts";
import type { StudentRecord } from "../repositories/students-mapping.ts";
import { toEnginePaymentsState } from "../students/list-status.ts";

/** Cada categoría del analizador del original, en palabras de la profesora (sin nombres, ids ni importes) y con lo que conviene hacer. Ninguna repara nada por sí sola. */
export const CONSISTENCY_MESSAGES: Record<FinancialInconsistencyCategory, { title: string; advice: string }> = {
  plan_amount_diverges_from_charge: {
    title: "El importe del cargo de este mes no coincide con el plan del alumno",
    advice: "Puede ser un primer mes proporcional o un cambio de monto ya hecho; si no lo es, usá «Modificar monto mensual» en Cobros del alumno. No se cambia ningún cargo anterior.",
  },
  monthly_student_without_current_charge: {
    title: "Alumnos con plan mensual sin cargo de este mes, ya pasado el margen",
    advice: "Abrí Cobros o la ficha del alumno: el cargo del mes se genera al entrar. Si no aparece, revisá que el plan no empiece el mes próximo.",
  },
  duplicate_monthly_charge: { title: "Cargos mensuales repetidos para el mismo mes", advice: "Anulá el que sobra desde Cobros del alumno (con motivo). Nunca se borra ningún pago." },
  charge_without_billing_period: { title: "Cargos por período sin período asignado", advice: "Corresponde revisarlos con soporte: no se pueden ubicar en un mes." },
  charge_without_student: { title: "Cargos de un alumno que ya no existe", advice: "Corresponde revisarlos con soporte." },
  payment_without_student: { title: "Pagos de un alumno que ya no existe", advice: "Corresponde revisarlos con soporte." },
  allocation_without_payment: { title: "Asignaciones de pago sin pago", advice: "Corresponde revisarlas con soporte." },
  allocation_without_charge: { title: "Asignaciones de pago sin cobro", advice: "Corresponde revisarlas con soporte." },
  negative_balance: { title: "Cobros con más dinero asignado que su importe", advice: "Revisá los pagos de ese cobro; si hubo un error de carga, anulá el pago y registralo de nuevo." },
  settled_charge_with_residual_balance: { title: "Cobros saldados que todavía muestran saldo", advice: "Corresponde revisarlos con soporte." },
  voided_charge_with_active_allocations: { title: "Cobros anulados que conservan pagos vigentes", advice: "Corresponde revisarlos con soporte." },
  voided_payment_with_active_allocations: { title: "Pagos anulados que siguen asignados", advice: "No afecta los saldos (las asignaciones de un pago anulado no cuentan)." },
  per_class_charge_incompatible_with_monthly_plan: {
    title: "Cobros por clase de alumnos que hoy tienen plan mensual",
    advice: "Pasa al cambiar de plan en un mes con clases ya cobradas. Se conservan; anulá los que queden cubiertos por la mensualidad.",
  },
};

export interface ConsistencyReportView {
  total: number;
  items: Array<{ category: FinancialInconsistencyCategory; count: number; title: string; advice: string }>;
}

export interface DecisionLike {
  id: string;
  studentId: string;
  billingPeriod: string;
  effectiveJoinDate: string;
  criterion: FirstMonthProrationDecision["criterion"];
  classesRemaining: number;
  classesPerFullPeriod: number;
  permanentMonthlyAmount: number;
  chargedAmount: number;
  chargeId: string | null;
  createdAt: string;
  confirmedAt: string;
  source?: "manual" | "automatic";
}

/**
 * Revisión de consistencia de SÓLO LECTURA con el analizador del original (`analyzeFinancialConsistency`, copia idéntica en `lib/payments/engine`). Compara el plan con el cargo del período
 * VIGENTE (nunca con meses anteriores: un cargo viejo conserva el importe con el que se emitió) y excusa los primeros meses con decisión propia. Devuelve cantidades, nunca nombres.
 */
export function buildConsistencyReport(input: {
  students: readonly StudentRecord[];
  charges: readonly PaymentChargeRecord[];
  payments: readonly PaymentRecord[];
  allocations: readonly PaymentAllocationRecord[];
  decisions: readonly DecisionLike[];
  todayDateKey: string;
}): ConsistencyReportView {
  const plans = new Map(input.students.map((student) => [student.id, resolveStudentBillingPlan({ billingPlan: student.billingPlan as StudentBillingPlan | null, billingType: student.billingType, price: student.price }) as unknown as EnginePlan]));
  const report = analyzeFinancialConsistency({
    state: toEnginePaymentsState({ charges: input.charges, payments: input.payments, allocations: input.allocations }),
    students: input.students.map((student) => ({ id: student.id, status: student.status })),
    resolvePlan: (studentId) => plans.get(studentId) ?? null,
    evaluationDate: input.todayDateKey,
    firstMonthProrationDecisions: input.decisions.map((decision) => ({ ...decision })),
  });
  const items = (Object.keys(CONSISTENCY_MESSAGES) as FinancialInconsistencyCategory[])
    .filter((category) => report.countsByCategory[category] > 0)
    .map((category) => ({ category, count: report.countsByCategory[category], ...CONSISTENCY_MESSAGES[category] }));
  return { total: report.totalFindings, items };
}
