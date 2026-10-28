import type { PaymentAllocationRow, PaymentChargeRow, PaymentMethod, PaymentRow, TrainingBillingAgreementRow } from "@/lib/db/database.types";

export interface PaymentChargeRecord {
  id: string;
  studentId: string;
  chargeType: PaymentChargeRow["charge_type"];
  originalAmount: number;
  dueDate: string;
  billingPeriod: string | null;
  savedLessonId: string | null;
  packageId: string | null;
  trainingBillingAgreementId: string | null;
  trainingSeriesName: string | null;
  calendarLessonId: string | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export function toPaymentChargeRecord(row: PaymentChargeRow): PaymentChargeRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    chargeType: row.charge_type,
    originalAmount: row.original_amount,
    dueDate: row.due_date,
    billingPeriod: row.billing_period,
    savedLessonId: row.saved_lesson_id,
    packageId: row.package_id,
    trainingBillingAgreementId: row.training_billing_agreement_id,
    trainingSeriesName: row.training_series_name,
    calendarLessonId: row.calendar_lesson_id,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

export interface PaymentRecord {
  id: string;
  studentId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  recordedAt: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  replacesPaymentId: string | null;
  operationId: string | null;
  /** `initial_student_setup`: pago DECLARADO («este mes ya está pago») al dar de alta al alumno o al marcar el mes como pagado; nunca un ingreso observado. */
  source?: "initial_student_setup" | null;
}

export function toPaymentRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    amount: row.amount,
    method: row.method,
    paidAt: row.paid_at,
    recordedAt: row.recorded_at,
    notes: row.notes,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    replacesPaymentId: row.replaces_payment_id,
    operationId: row.operation_id,
    source: row.source ?? null,
  };
}

export interface PaymentAllocationRecord {
  id: string;
  paymentId: string;
  chargeId: string;
  studentId: string;
  amount: number;
  /** Parte de `amount` por encima del importe base del cobro (traslado). Ya está incluida en `amount`; los saldos no cambian. 0 si no hay. */
  excessAmount: number;
  excessStatus: "recargo_confirmado" | "pendiente_de_clasificacion" | null;
}

export function toPaymentAllocationRecord(row: PaymentAllocationRow): PaymentAllocationRecord {
  // Antes de la migración R13 la base no devuelve estas columnas: se tratan como «sin exceso».
  const excessAmount = Number(row.excess_amount ?? 0);
  return {
    id: row.id,
    paymentId: row.payment_id,
    chargeId: row.charge_id,
    studentId: row.student_id,
    amount: row.amount,
    excessAmount: Number.isFinite(excessAmount) && excessAmount > 0 ? excessAmount : 0,
    excessStatus: excessAmount > 0 ? (row.excess_status ?? null) : null,
  };
}

export interface TrainingBillingAgreementRecord {
  id: string;
  monthlyFee: number;
  pendingMonthlyFee: number | null;
  pendingMonthlyFeeEffectiveFrom: string | null;
  startPeriod: string;
}

export function toTrainingBillingAgreementRecord(row: TrainingBillingAgreementRow): TrainingBillingAgreementRecord {
  return {
    id: row.id,
    monthlyFee: row.monthly_fee,
    pendingMonthlyFee: row.pending_monthly_fee,
    pendingMonthlyFeeEffectiveFrom: row.pending_monthly_fee_effective_from,
    startPeriod: row.start_period,
  };
}
