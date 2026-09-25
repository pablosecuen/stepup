/**
 * Fase 9 — shapes TS del backup móvil (`TeacherFlowBackupV1`/`V2`), puerto
 * de `src/shared/backup/backupTypes.ts` (móvil) — sólo los campos que esta
 * ronda realmente lee/importa o necesita reportar como excluida. Nunca se
 * inventa un campo que no esté confirmado por la auditoría real del móvil.
 */

export const BACKUP_SCHEMA_VERSION_V1 = 1;
export const BACKUP_SCHEMA_VERSION_V2 = 2;

export interface RawStudent {
  id: string;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  usualDays?: string[];
  usualTime?: string | null;
  notes?: string | null;
  birthDate?: string | null;
  levels: string[];
  initialLevel: string;
  modality: "presencial" | "online" | "mixta";
  status: "activo" | "pausado" | "inactivo" | "archivado";
  category: string;
  billingType: "por_clase" | "mensual";
  billingPlan?: Record<string, unknown> | null;
  dateJoined: string;
  lastReactivatedAt?: string | null;
  statusChangeDate?: string | null;
  usualDurationMinutes: number;
  weeklyFrequency: number;
  price: number;
  pendingHomework?: string | null;
  alerts?: string[];
  currentGoals?: string[];
  strengths?: string[];
  areasToImprove?: string[];
  isFeatured?: boolean;
  isNew?: boolean;
}

export interface RawProfile {
  id: string;
  levelHistory?: Array<{
    id?: string;
    level: string;
    date: string;
    fromLevel?: string | null;
    recordedAt?: string;
    previousMilestoneAt?: string | null;
    durationDays?: number | null;
    note?: string;
    origin?: "manual";
  }>;
  // statusHistory/priceHistory existen en el backup real pero v1 los
  // excluye a propósito (sin clave estable, ver auditoría) — se cuentan
  // para el resumen de excluidas, nunca se leen campo por campo acá.
  statusHistory?: unknown[];
  priceHistory?: unknown[];
}

export interface RawCustomLevel {
  id: string;
  name: string;
  createdAt: string;
}

export interface RawTeacherAvailability {
  timezone: string;
  weeklyBlocks: unknown[];
  exceptions: unknown[];
}

export interface RawTeacherProfile {
  displayName: string;
}

export interface RawSurchargeSettings {
  current: {
    enabled: boolean;
    graceDay: number;
    firstLateDay: number;
    firstLatePercentage: number;
    secondLateDay: number;
    secondLatePercentage: number;
    lastLateDay: number;
    lastLatePercentage: number;
  };
  pending?: Record<string, unknown> | null;
  pendingEffectiveFrom?: string | null;
}

export interface RawBudgetDistribution {
  distribution: { needs: number; wants: number; savings: number };
  savingsGoal: { enabled: boolean; targetAmount: number | null; targetDate: string | null };
}

export interface RawTrainingBillingAgreement {
  id: string;
  monthlyFee: number;
  pendingMonthlyFee?: number | null;
  pendingMonthlyFeeEffectiveFrom?: string | null;
  startPeriod: string;
}

export interface RawRecurrenceRule {
  id: string;
  primaryStudentId?: string | null;
  ruleType: "weekly" | "custom";
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: unknown;
  modality: string;
  timezone: string;
  startDate: string;
  endDate?: string | null;
  status: "active" | "paused" | "ended";
  supersedesRecurrenceId?: string | null;
  supersededByRecurrenceId?: string | null;
  effectiveFromDate?: string | null;
  classTitle?: string | null;
  activityKind?: "class" | "training";
  trainingBillingAgreementId?: string | null;
  participantStudentIds?: string[];
}

export interface RawRecurrenceException {
  recurrenceId: string;
  occurrenceKey: string;
  exceptionType: "cancelled" | "rescheduled" | "excluded";
  replacementLessonId?: string | null;
}

export interface RawCalendarLesson {
  id: string;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: "individual" | "group";
  startAt: string;
  endAt: string;
  modality: string;
  status: string;
  color: string;
  overlapAllowed?: boolean;
  overlapGroupId?: string | null;
  notes?: string | null;
  isRecurring?: boolean;
  recurrenceId?: string | null;
  recurrenceOccurrenceKey?: string | null;
  recurrenceIndex?: number | null;
  recurrenceOriginalStart?: string | null;
  scheduleAdjustment?: Record<string, unknown> | null;
  classTitle?: string | null;
  freedByLessonId?: string | null;
  activityKind?: "class" | "training";
  participants?: Array<{ studentId: string; studentName: string; level: string }>;
}

export interface RawLessonRegistration {
  id: string;
  calendarLessonId?: string | null;
  activityKind?: "class" | "training";
  countsAsClass?: boolean;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  billedAmount?: number | null;
  scheduledStartAt?: string | null;
  actualStartedAt?: string | null;
  actualEndedAt?: string | null;
  outcome?: string;
  holidayException?: boolean;
  modality?: string | null;
  scheduledEndAt?: string | null;
  lateCancellationPolicy?: string | null;
  lateCancellationPercentage?: number | null;
  rescheduledFromRegistrationId?: string | null;
  roster?: Array<{ studentId: string }>;
  attendance?: Array<{ studentId: string; status: string; lateMinutes?: number | null }>;
  evaluations?: Array<{
    studentId: string;
    generalGrade?: number | null;
    skillGrades?: Record<string, number>;
    strengths?: string[];
    areasToImprove?: string[];
    individualObservation?: string | null;
    individualHomeworkDescription?: string | null;
    individualHomeworkDueDate?: string | null;
    billedAmount?: number | null;
  }>;
  homeworkReviews?: Array<{ studentId: string; taskId: string; outcome: string; reviewedAt: string }>;
}

export interface RawPackagePurchase {
  id: string;
  studentId: string;
  includedClasses: number;
  amount: number;
  validFrom: string;
  validUntil?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface RawPackageCreditMovement {
  id: string;
  packageId: string;
  studentId: string;
  movementType: "consumo" | "ajuste_manual";
  amount: number;
  savedLessonId?: string | null;
  reason?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface RawPaymentCharge {
  id: string;
  studentId: string;
  chargeType: "mensual" | "por_clase" | "semanal" | "quincenal" | "paquete" | "entrenamiento";
  originalAmount: number;
  currency: "ARS";
  dueDate: string;
  billingPeriod?: string | null;
  savedLessonId?: string | null;
  packageId?: string | null;
  trainingBillingAgreementId?: string | null;
  trainingSeriesName?: string | null;
  calendarLessonId?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface RawPayment {
  id: string;
  studentId: string;
  amount: number;
  currency: "ARS";
  method: "efectivo" | "transferencia" | "otro";
  paidAt: string;
  notes?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  replacesPaymentId?: string | null;
  source?: "initial_student_setup" | null;
}

export interface RawPaymentAllocation {
  id: string;
  paymentId: string;
  chargeId: string;
  studentId: string;
  amount: number;
}

export interface RawPaymentAdjustment {
  id: string;
  chargeId: string;
  studentId: string;
  reason: string;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface RawMonthlyAmountCorrection {
  id: string;
  studentId: string;
  billingPeriod: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string;
  reason: string;
  effectiveFrom?: "this_month" | "next_month" | null;
}

export interface RawInitialPaidSurchargeCorrection {
  id: string;
  studentId: string;
  billingPeriod: string;
  previousSurchargeAmount: number;
  voidedPaymentId?: string | null;
  newPaymentId?: string | null;
  correctedAt: string;
  reason: string;
}

export interface RawFirstMonthProrationDecision {
  id: string;
  studentId: string;
  billingPeriod: string;
  effectiveJoinDate: string;
  criterion: string;
  classesRemaining: number;
  classesPerFullPeriod: number;
  permanentMonthlyAmount: number;
  chargedAmount: number;
  chargeId?: string | null;
  confirmedAt: string;
  source?: "manual" | "automatic" | null;
}

export interface RawReportRecord {
  id: string;
  studentId: string;
  title: string;
  selectedMonths: string[];
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  snapshot: Record<string, unknown>;
  schemaVersion: number;
}

export interface TeacherFlowBackup {
  schemaVersion: 1 | 2;
  exportedAt: string;
  appVersion: string | null;
  students: RawStudent[];
  profiles: Record<string, RawProfile>;
  recurrenceRules: RawRecurrenceRule[];
  recurrenceExceptions: RawRecurrenceException[];
  calendarLessons: RawCalendarLesson[];
  teacherAvailability: RawTeacherAvailability | null;
  pedagogicalLessons: RawLessonRegistration[];
  paymentCharges: RawPaymentCharge[];
  payments: RawPayment[];
  paymentAllocations: RawPaymentAllocation[];
  paymentAdjustments: RawPaymentAdjustment[];
  reportRecords?: RawReportRecord[];
  packagePurchases?: RawPackagePurchase[];
  packageCreditMovements?: RawPackageCreditMovement[];
  teacherProfile?: RawTeacherProfile | null;
  monthlyAmountCorrections?: RawMonthlyAmountCorrection[];
  initialPaidSurchargeCorrections?: RawInitialPaidSurchargeCorrection[];
  surchargeSettings?: RawSurchargeSettings | null;
  budgetDistribution?: RawBudgetDistribution | null;
  firstMonthProrationDecisions?: RawFirstMonthProrationDecision[];
  trainingBillingAgreements?: RawTrainingBillingAgreement[];
  customLevels?: RawCustomLevel[];
}
