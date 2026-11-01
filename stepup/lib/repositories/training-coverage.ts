import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import { getLocalDateKey } from "@/lib/calendar/timezone";
import { billingPeriodOfDateKey } from "@/lib/payments/dates";
import { resolveLooseSessionAgreement, resolveSessionBilling, type ParticipantBillingDecision, type SavedBillingResolution } from "@/lib/payments/training-coverage";
import { getRecurrenceRule, listRecurrenceRules } from "./recurrence-rules";

const TIMEZONE = "America/Argentina/Buenos_Aires";

export interface RegistrationBilling {
  /** Cómo se cobra la sesión para CADA participante (nunca una decisión de grupo). */
  decisions: Map<string, ParticipantBillingDecision>;
  /** Nombre legible de cada acuerdo involucrado (para mostrar «¿a qué entrenamiento pertenece?»). */
  agreementLabels: Map<string, string>;
  /** Acuerdos que se pueden elegir para cada participante: el de la sesión y aquellos a los que pertenece. Una elección fuera de esta lista se rechaza. */
  candidatesByStudent: Map<string, string[]>;
}

/** La tabla de decisiones aún no existe (migración pendiente): se lee como «sin decisiones» en vez de romper el registro. */
const isMissingTable = (error: unknown) => {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "PGRST205";
};

async function readSavedResolutions(ctx: AuthenticatedDbContext, registrationId: string): Promise<Map<string, SavedBillingResolution>> {
  try {
    const rows = await readTable<{ student_id: string; decision: string; training_billing_agreement_id: string | null }>(ctx.supabase, "lesson_registration_billing_resolutions", {
      columns: "id, student_id, decision, training_billing_agreement_id",
      filter: (query) => query.eq("owner_id", ctx.ownerId).eq("lesson_registration_id", registrationId),
    });
    return new Map(rows.map((row) => [row.student_id, { agreementId: row.decision === "covered" ? row.training_billing_agreement_id : null }]));
  } catch (error) {
    if (isMissingTable(error)) return new Map();
    throw error;
  }
}

/**
 * Cómo se cobra una sesión, participante por participante (ver `lib/payments/training-coverage.ts`). Lee SÓLO identidades explícitas: el acuerdo de la serie (o el guardado en la
 * propia clase), la pertenencia de cada alumno a cada acuerdo y las decisiones que la profesora ya tomó para ese registro. Nunca infiere un acuerdo por el nombre ni porque el
 * alumno «tenga alguna cuota»; una clase común devuelve «régimen propio» para todos.
 */
export async function resolveRegistrationBilling(
  ctx: AuthenticatedDbContext,
  input: { registrationId: string; activityKind: string; recurrenceId: string | null; calendarLessonId: string | null; participantIds: string[]; sessionAnchorIso: string }
): Promise<RegistrationBilling> {
  const empty = new Map<string, ReadonlySet<string>>();
  if (input.activityKind !== "training" || input.participantIds.length === 0) {
    return { decisions: resolveSessionBilling({ activityKind: input.activityKind, sessionAgreementId: null, participantIds: input.participantIds, membership: empty, saved: new Map() }), agreementLabels: new Map(), candidatesByStudent: new Map() };
  }

  const seriesRule = input.recurrenceId ? await getRecurrenceRule(ctx, input.recurrenceId) : null;
  let sessionAgreementId = seriesRule?.trainingBillingAgreementId ?? null;
  if (!sessionAgreementId && input.calendarLessonId) {
    const { data, error } = await ctx.supabase.from("calendar_lessons").select("training_billing_agreement_id").eq("owner_id", ctx.ownerId).eq("id", input.calendarLessonId).maybeSingle();
    if (error) throw error;
    sessionAgreementId = data?.training_billing_agreement_id ?? null;
  }

  const dateKey = getLocalDateKey(input.sessionAnchorIso, TIMEZONE);
  const period = billingPeriodOfDateKey(dateKey);
  const [rules, charges, saved] = await Promise.all([
    listRecurrenceRules(ctx),
    readTableByIds<{ id: string; student_id: string; training_billing_agreement_id: string | null; billing_period: string | null; training_series_name: string | null }>(ctx.supabase, "payment_charges", {
      columns: "id, student_id, training_billing_agreement_id, billing_period, training_series_name",
      matchColumn: "student_id",
      ids: input.participantIds,
      filter: (query) => query.eq("owner_id", ctx.ownerId).eq("charge_type", "entrenamiento").is("voided_at", null),
    }),
    readSavedResolutions(ctx, input.registrationId),
  ]);

  const participants = new Set(input.participantIds);
  const membership = new Map<string, Set<string>>();
  const add = (studentId: string, agreementId: string) => {
    if (!participants.has(studentId)) return;
    const set = membership.get(studentId) ?? new Set<string>();
    set.add(agreementId);
    membership.set(studentId, set);
  };
  const labels = new Map<string, string>();
  const trainingRules = rules.filter((rule) => rule.activityKind === "training" && !!rule.trainingBillingAgreementId);
  for (const rule of trainingRules) {
    const agreementId = rule.trainingBillingAgreementId as string;
    if (rule.classTitle && !labels.has(agreementId)) labels.set(agreementId, rule.classTitle);
    // Un acuerdo terminado sólo cuenta si es el de ESTA sesión; para elegir uno nuevo no se ofrecen entrenamientos finalizados.
    if (rule.status === "ended" && agreementId !== sessionAgreementId) continue;
    rule.participantIds.forEach((studentId) => add(studentId, agreementId));
  }
  for (const charge of charges) {
    if (!charge.training_billing_agreement_id) continue;
    if (charge.training_series_name && !labels.has(charge.training_billing_agreement_id)) labels.set(charge.training_billing_agreement_id, charge.training_series_name);
    if (charge.billing_period === period || charge.training_billing_agreement_id === sessionAgreementId) add(charge.student_id, charge.training_billing_agreement_id);
  }

  const looseSuggestionAgreementId = sessionAgreementId
    ? null
    : resolveLooseSessionAgreement({
        participantIds: input.participantIds,
        dateKey,
        rules: trainingRules.map((rule) => ({ id: rule.id, activityKind: rule.activityKind, status: rule.status, startDate: rule.startDate, endDate: rule.endDate, agreementId: rule.trainingBillingAgreementId, participantIds: rule.participantIds })),
      });

  const decisions = resolveSessionBilling({ activityKind: input.activityKind, sessionAgreementId, participantIds: input.participantIds, membership, saved, looseSuggestionAgreementId });
  const candidatesByStudent = new Map(input.participantIds.map((studentId) => [studentId, [...new Set([...(sessionAgreementId ? [sessionAgreementId] : []), ...(membership.get(studentId) ?? [])])]]));
  return { decisions, agreementLabels: labels, candidatesByStudent };
}

/** Guarda la decisión explícita de cobro de UN participante de una sesión de entrenamiento (idempotente: repetirla no cambia nada). */
export async function saveRegistrationBillingResolution(
  ctx: AuthenticatedDbContext,
  input: { registrationId: string; studentId: string; agreementId: string | null }
): Promise<{ changed: boolean }> {
  const { data, error } = await ctx.supabase.rpc("resolve_registration_billing", {
    p_registration_id: input.registrationId,
    p_student_id: input.studentId,
    p_decision: input.agreementId ? "covered" : "own_regime",
    p_agreement_id: input.agreementId,
  });
  if (error) throw error;
  return { changed: (data as { changed?: boolean } | null)?.changed !== false };
}
