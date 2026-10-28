import { projectStudentListPaymentStatus } from "../payments/engine/features/payments/utils/studentListPaymentProjection.ts";
import type { PaymentCharge, PaymentsRepositoryState } from "../payments/engine/features/payments/types/index.ts";
import type { StudentListItem } from "../payments/engine/features/students/types/index.ts";
import type { StudentBillingPlan as EnginePlan } from "../payments/engine/features/student-profile/types/index.ts";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "../payments/billing-plan.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord } from "../repositories/payments-mapping.ts";
import type { StudentRecord } from "../repositories/students-mapping.ts";

/** Registros de la base → estado que entiende el motor de pagos del original (misma forma que sus pruebas; sin ajustes porque los recargos están desactivados). */
export function toEnginePaymentsState(input: { charges: readonly PaymentChargeRecord[]; payments: readonly PaymentRecord[]; allocations: readonly PaymentAllocationRecord[] }): PaymentsRepositoryState {
  return {
    charges: input.charges.map(
      (charge): PaymentCharge => ({
        id: charge.id,
        studentId: charge.studentId,
        type: charge.chargeType,
        originalAmount: charge.originalAmount,
        currency: "ARS",
        dueDate: charge.dueDate,
        createdAt: charge.createdAt,
        billingPeriod: charge.billingPeriod ?? undefined,
        savedLessonId: charge.savedLessonId ?? undefined,
        packageId: charge.packageId ?? undefined,
        trainingBillingAgreementId: charge.trainingBillingAgreementId ?? undefined,
        trainingSeriesName: charge.trainingSeriesName ?? undefined,
        calendarLessonId: charge.calendarLessonId,
        voidedAt: charge.voidedAt,
        voidReason: charge.voidReason,
      }),
    ),
    payments: input.payments.map((payment) => ({
      id: payment.id,
      studentId: payment.studentId,
      amount: payment.amount,
      currency: "ARS" as const,
      method: payment.method,
      paidAt: payment.paidAt,
      recordedAt: payment.recordedAt,
      notes: payment.notes ?? undefined,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      replacesPaymentId: payment.replacesPaymentId,
      source: payment.source ?? undefined,
    })),
    allocations: input.allocations.map((allocation) => ({ id: allocation.id, paymentId: allocation.paymentId, chargeId: allocation.chargeId, studentId: allocation.studentId, amount: allocation.amount })),
    adjustments: [],
  };
}

export interface StudentStatusProjection {
  /** Semáforo de gravedad (verde/amarillo/naranja/rojo): lo que filtra «Estado de pago». */
  paymentStatus: StudentListItem["paymentStatus"];
  hasOverduePayment: boolean;
  overdueDebtLabel: string | null;
  /** Fecha (AAAA-MM-DD) del último pago vigente. */
  lastPaymentAt: string | null;
  monthlyStatusLabel: string | null;
  monthlyStatusKind: StudentListItem["monthlyStatusKind"];
  monthlyStatusColorKey: StudentListItem["monthlyStatusColorKey"];
  monthlyStatusBalance: number;
}

/**
 * Estado de pago de cada alumno para la lista, calculado con `projectStudentListPaymentStatus` del original (copia idéntica en `lib/payments/engine`, probada con sus pruebas
 * originales). Pura: no lee ni escribe nada.
 */
export function projectStudentStatuses(input: { students: readonly StudentRecord[]; payments: PaymentsRepositoryState; todayDateKey: string }): Map<string, StudentStatusProjection> {
  const items: StudentListItem[] = input.students.map((student) => ({
    id: student.id,
    name: student.name,
    levels: student.levels,
    modality: student.modality,
    status: student.status,
    nextClassAt: null,
    paymentStatus: "verde",
    averageGrade: null,
    classesThisMonth: 0,
    lastPaymentAt: null,
    isFeatured: student.isFeatured,
    isNew: student.isNew,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
  }));
  const plans = new Map(input.students.map((student) => [student.id, resolveStudentBillingPlan({ billingPlan: student.billingPlan as StudentBillingPlan | null, billingType: student.billingType, price: student.price }) as unknown as EnginePlan]));
  const projected = projectStudentListPaymentStatus(items, input.payments, input.todayDateKey, (studentId) => plans.get(studentId) ?? null);
  return new Map(
    projected.map((item) => [
      item.id,
      {
        paymentStatus: item.paymentStatus,
        hasOverduePayment: item.hasOverduePayment,
        overdueDebtLabel: item.overdueDebtLabel ?? null,
        lastPaymentAt: item.lastPaymentAt,
        monthlyStatusLabel: item.monthlyStatusLabel ?? null,
        monthlyStatusKind: item.monthlyStatusKind,
        monthlyStatusColorKey: item.monthlyStatusColorKey,
        monthlyStatusBalance: item.monthlyStatusBalance ?? 0,
      },
    ]),
  );
}
