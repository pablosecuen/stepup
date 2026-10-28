import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTableByIds } from "@/lib/db/read";
import { getLocalDateKey } from "@/lib/calendar/timezone";
import { billingPeriodOfDateKey } from "@/lib/payments/dates";
import { isCoveredByTrainingPlan, resolveLooseSessionAgreement, trainingChargeKey } from "@/lib/payments/training-coverage";
import { getRecurrenceRule, listRecurrenceRules } from "./recurrence-rules";

const TIMEZONE = "America/Argentina/Buenos_Aires";

/**
 * Alumnos de una sesión cuyo cobro por clase NO corresponde porque la sesión es de un entrenamiento cubierto por su cuota mensual (ver `lib/payments/training-coverage.ts`): por el acuerdo de su
 * serie, o —sesión suelta— por el único acuerdo con ese mismo grupo de alumnos y la cuota vigente de ESE acuerdo en el mes de la sesión. Una clase común devuelve vacío.
 */
export async function listStudentsCoveredByTrainingPlan(
  ctx: AuthenticatedDbContext,
  input: { activityKind: string; recurrenceId: string | null; participantIds: string[]; sessionAnchorIso: string;calendarLessonId?:string|null }
): Promise<Set<string>> {
  if (input.activityKind !== "training" || input.participantIds.length === 0) return new Set();
  const seriesRule = input.recurrenceId ? await getRecurrenceRule(ctx, input.recurrenceId) : null;
  let seriesAgreementId = seriesRule?.trainingBillingAgreementId ?? null;
  if(!seriesAgreementId&&input.calendarLessonId){const {data,error}=await ctx.supabase.from('calendar_lessons').select('training_billing_agreement_id').eq('owner_id',ctx.ownerId).eq('id',input.calendarLessonId).maybeSingle();if(error)throw error;seriesAgreementId=data?.training_billing_agreement_id??null;}
  const dateKey = getLocalDateKey(input.sessionAnchorIso, TIMEZONE);

  let matchedAgreementId: string | null = null;
  let trainingChargeKeys = new Set<string>();
  if (!seriesAgreementId) {
    const rules = await listRecurrenceRules(ctx);
    matchedAgreementId = resolveLooseSessionAgreement({
      participantIds: input.participantIds,
      dateKey,
      rules: rules.map((rule) => ({ id: rule.id, activityKind: rule.activityKind, status: rule.status, startDate: rule.startDate, endDate: rule.endDate, agreementId: rule.trainingBillingAgreementId, participantIds: rule.participantIds })),
    });
    if (matchedAgreementId) {
      const charges = await readTableByIds<{ id: string; student_id: string; training_billing_agreement_id: string | null }>(ctx.supabase, "payment_charges", {
        columns: "id, student_id, training_billing_agreement_id",
        matchColumn: "student_id",
        ids: input.participantIds,
        filter: (query) => query.eq("owner_id", ctx.ownerId).eq("charge_type", "entrenamiento").eq("billing_period", billingPeriodOfDateKey(dateKey)).eq("training_billing_agreement_id", matchedAgreementId).is("voided_at", null),
      });
      trainingChargeKeys = new Set(charges.map((charge) => trainingChargeKey(matchedAgreementId as string, charge.student_id)));
    }
  }
  return new Set(input.participantIds.filter((studentId) => isCoveredByTrainingPlan({ activityKind: input.activityKind, seriesAgreementId, matchedAgreementId, studentId, trainingChargeKeys })));
}
