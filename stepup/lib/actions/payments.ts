"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext, type AuthenticatedDbContext } from "@/lib/db/server-context";
import {
  registerPayment,
  voidPayment,
  voidCharge,
  configureTrainingBilling,
  editTrainingBillingFee,
  PaymentNotFoundError,
  ChargeNotFoundError,
} from "@/lib/repositories/payments";
import { getRecurrenceRule } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsForRecurrence } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { listStudents } from "@/lib/repositories/students";
import { computeTrainingFirstPeriodCharge } from "@/lib/payments/training-charge-plan";
import { billingPeriodOfDateKey, localDateKeyInTimeZone } from "@/lib/payments/dates";
import type { ActionResult } from "./lesson-registrations";
import { actionErrorMessage } from "@/lib/errors/action-error";

// Server Actions — Cobros. Mismo patrón que Fase 4: nunca reciben ownerId
// del navegador, siempre ActionResult<T> uniforme, nunca lanzan al cliente.

export interface RegisterPaymentActionInput {
  operationId: string;
  studentId: string;
  amount: number;
  method: "efectivo" | "transferencia" | "otro";
  paidAt: string;
  notes?: string | null;
  chargeId?: string | null;
  replacesPaymentId?: string | null;
}

export async function registerPaymentAction(input: RegisterPaymentActionInput): Promise<ActionResult<{ paymentId: string }>> {
  if (!input.operationId) return { error: "Falta el identificador de la operación. Recargá la página e intentá de nuevo." };
  if (!input.amount || input.amount <= 0) return { error: "El importe tiene que ser mayor a 0." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const payment = await registerPayment(ctx, input);
    return { data: { paymentId: payment.id } };
  } catch (error) {
    return { error: friendlyPaymentError(error) };
  } finally {
    revalidatePath("/cobros");
    revalidatePath("/alumnos");
  }
}

export async function voidPaymentAction(input: { paymentId: string; voidReason: string }): Promise<ActionResult> {
  if (!input.voidReason?.trim()) return { error: "Indicá el motivo de la anulación." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    await voidPayment(ctx, input);
  } catch (error) {
    if (error instanceof PaymentNotFoundError) return { error: "El pago no existe o no te pertenece." };
    return { error: friendlyPaymentError(error) };
  }
  revalidatePath("/cobros");
  revalidatePath("/alumnos");
  return {};
}

export async function voidChargeAction(input: { chargeId: string; voidReason: string }): Promise<ActionResult> {
  if (!input.voidReason?.trim()) return { error: "Indicá el motivo de la anulación." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    await voidCharge(ctx, input);
  } catch (error) {
    if (error instanceof ChargeNotFoundError) return { error: "El cobro no existe o no te pertenece." };
    return { error: friendlyPaymentError(error) };
  }
  revalidatePath("/cobros");
  revalidatePath("/alumnos");
  return {};
}

function friendlyPaymentError(error: unknown): string {
  return actionErrorMessage("payments", error);
}

// ---------------------------------------------------------------------------
// Configuración de cuota de entrenamiento — buildTrainingBillingConfigurationPlan
// es la ÚNICA función que arma el plan (acuerdo + serie a vincular + cargos
// del período vigente), reutilizada TAL CUAL por la previsualización y por
// la confirmación real — estructuralmente imposible que diverjan (cierra el
// bug real del commit móvil 2068b3a).
// ---------------------------------------------------------------------------

export interface TrainingBillingChargePreview {
  studentId: string;
  studentName: string;
  amount: number;
  dueDate: string;
  billingPeriod: string;
  isFirstPeriod: boolean;
  classesRemaining: number;
  classesPerFullPeriod: number;
}

export interface TrainingBillingConfigurationPlan {
  recurrenceRuleIds: string[];
  monthlyFee: number;
  trainingSeriesName: string | null;
  startPeriod: string;
  charges: TrainingBillingChargePreview[];
}

const TIMEZONE = "America/Argentina/Buenos_Aires";

async function buildTrainingBillingConfigurationPlan(
  ctx: AuthenticatedDbContext,
  input: { recurrenceRuleId: string; monthlyFee: number },
): Promise<TrainingBillingConfigurationPlan> {
  const rule = await getRecurrenceRule(ctx, input.recurrenceRuleId);
  if (!rule) throw new Error("La serie no existe o no te pertenece.");
  if (rule.activityKind !== "training") throw new Error("Sólo las series de entrenamiento admiten cuota configurable.");

  const [students, existingLessons, exceptions] = await Promise.all([
    listStudents(ctx),
    listCalendarLessonsForRecurrence(ctx, rule.id),
    listRecurrenceExceptionsForRules(ctx, [rule.id]),
  ]);
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const todayDateKey = localDateKeyInTimeZone(new Date(), TIMEZONE);
  const currentPeriod = billingPeriodOfDateKey(todayDateKey);

  const engineRule = {
    recurrenceId: rule.id,
    studentId: rule.primaryStudentId,
    participantIds: rule.participantIds,
    cycleLengthWeeks: rule.cycleLengthWeeks,
    weeks: rule.weeks,
    modality: rule.modality,
    timezone: rule.timezone,
    startDate: rule.startDate,
    endDate: rule.endDate,
    status: rule.status,
    classTitle: rule.classTitle,
    activityKind: rule.activityKind,
  };

  const charges: TrainingBillingChargePreview[] = [];
  for (const studentId of rule.participantIds) {
    const student = studentsById.get(studentId);
    if (!student || student.status !== "activo") continue; // alumno retirado/inactivo nunca recibe cargo nuevo.

    // El primer período jamás facturado de esta (serie, alumno) usa la fecha
    // efectiva real (hoy o el inicio de la serie, lo que sea más tarde) y el
    // motor proporcional — el resto de los meses usa la cuota completa desde
    // el día 10, igual criterio que la mensualidad de clases.
    const effectiveJoinDate = rule.startDate > todayDateKey ? rule.startDate : todayDateKey;
    const first = computeTrainingFirstPeriodCharge({
      rule: engineRule,
      exceptions,
      existingLessons,
      effectiveJoinDate,
      monthlyFee: input.monthlyFee,
    });

    charges.push({
      studentId,
      studentName: student.name,
      amount: first.amount,
      dueDate: first.dueDate,
      billingPeriod: first.billingPeriod,
      isFirstPeriod: true,
      classesRemaining: first.classesRemaining,
      classesPerFullPeriod: first.classesPerFullPeriod,
    });
  }

  return {
    recurrenceRuleIds: [rule.id],
    monthlyFee: input.monthlyFee,
    trainingSeriesName: rule.classTitle,
    startPeriod: currentPeriod,
    charges,
  };
}

export async function previewTrainingBillingConfigurationAction(input: {
  recurrenceRuleId: string;
  monthlyFee: number;
}): Promise<ActionResult<TrainingBillingConfigurationPlan>> {
  if (!input.monthlyFee || input.monthlyFee <= 0) return { error: "La cuota tiene que ser mayor a 0." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const plan = await buildTrainingBillingConfigurationPlan(ctx, input);
    return { data: plan };
  } catch (error) {
    return { error: actionErrorMessage("payments", error) };
  }
}

export async function confirmTrainingBillingConfigurationAction(input: {
  operationId: string;
  recurrenceRuleId: string;
  monthlyFee: number;
}): Promise<ActionResult<{ agreementId: string }>> {
  if (!input.operationId) return { error: "Falta el identificador de la operación. Recargá la página e intentá de nuevo." };
  if (!input.monthlyFee || input.monthlyFee <= 0) return { error: "La cuota tiene que ser mayor a 0." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    // MISMA función que la previsualización — nunca un cálculo paralelo.
    const plan = await buildTrainingBillingConfigurationPlan(ctx, input);
    const result = await configureTrainingBilling(ctx, {
      operationId: input.operationId,
      recurrenceRuleIds: plan.recurrenceRuleIds,
      monthlyFee: plan.monthlyFee,
      trainingSeriesName: plan.trainingSeriesName,
      startPeriod: plan.startPeriod,
      charges: plan.charges.map((c) => ({ studentId: c.studentId, amount: c.amount, dueDate: c.dueDate, billingPeriod: c.billingPeriod })),
    });
    revalidatePath("/calendario/series");
    revalidatePath("/cobros");
    return { data: { agreementId: result.agreementId } };
  } catch (error) {
    return { error: actionErrorMessage("payments", error) };
  }
}

export async function editTrainingBillingFeeAction(input: {
  agreementId: string;
  pendingMonthlyFee: number;
  pendingMonthlyFeeEffectiveFrom: string;
}): Promise<ActionResult> {
  if (!input.pendingMonthlyFee || input.pendingMonthlyFee <= 0) return { error: "La cuota tiene que ser mayor a 0." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    await editTrainingBillingFee(ctx, input);
  } catch (error) {
    return { error: actionErrorMessage("payments", error) };
  }
  revalidatePath("/calendario/series");
  return {};
}
