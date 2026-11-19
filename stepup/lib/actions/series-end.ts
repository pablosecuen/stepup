"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listCalendarLessonsForRecurrence } from "@/lib/repositories/calendar-lessons";
import { listRecurrenceExceptionsForRules } from "@/lib/repositories/recurrence-exceptions";
import { readTableByIds } from "@/lib/db/read";
import { lineageMemberIds } from "@/lib/calendar/lineage";
import { getLocalDateKey } from "@/lib/calendar/timezone";
import { lessonOccupiesSlot, planSeriesEndImpact, validateSeriesEndInput, type LessonForSeriesEnd } from "@/lib/calendar/series-end";
import { actionErrorMessage } from "@/lib/errors/action-error";

/**
 * Vista previa de la fecha de finalización de una serie: QUÉ clases ya creadas cambian antes de guardar. No escribe nada. Usa la misma regla pura (`planSeriesEndImpact`) que repite la base dentro de la
 * transacción de guardado: la fecha REAL de cada clase (incluida una reprogramada que cruza el límite), sólo se cancelan las programadas sin registro ni cobro, una posterior con registro o cobro bloquea
 * y sólo vuelven las que había cancelado un límite anterior. Las ocurrencias virtuales no se guardan: el motor deja de generarlas después de la fecha (y vuelve a generarlas al quitarla).
 */
export interface SeriesEndPreviewItem {
  date: string;
  rescheduled: boolean;
}

export interface SeriesEndPreview {
  /** Dejan de figurar como clases vigentes (hasta 12 fechas) y cuántas son en total. */
  cancelled: SeriesEndPreviewItem[];
  cancelledTotal: number;
  /** Vuelven (las había cancelado un límite anterior). */
  restored: SeriesEndPreviewItem[];
  restoredTotal: number;
  /** Tienen registro o cobro y quedarían después del límite: no se puede guardar. */
  blocked: string[];
  blockedTotal: number;
}

const TIMEZONE = "America/Argentina/Buenos_Aires";
const MAX_LISTED = 12;

export async function previewSeriesEndAction(input: { ruleId: string; endDate: string; effectiveDate: string }): Promise<{ preview?: SeriesEndPreview; error?: string }> {
  const message = validateSeriesEndInput(input.endDate ?? "", input.effectiveDate ?? "");
  if (message) return { error: message };
  const endDate = input.endDate.trim() === "" ? null : input.endDate.trim();
  try {
    const ctx = await requireAuthenticatedDbContext();
    const rules = (await listRecurrenceRules(ctx)).map((rule) => ({ ...rule, recurrenceId: rule.id }));
    if (!rules.some((rule) => rule.id === input.ruleId)) return { error: "La serie ya no existe. Actualizá la pantalla." };
    const memberIds = lineageMemberIds(rules, input.ruleId);
    const timezone = rules.find((rule) => rule.id === input.ruleId)?.timezone ?? TIMEZONE;

    const [lessons, exceptions] = await Promise.all([
      Promise.all(memberIds.map((id) => listCalendarLessonsForRecurrence(ctx, id))).then((lists) => lists.flat()),
      listRecurrenceExceptionsForRules(ctx, memberIds),
    ]);
    // Registro y cobro sólo importan para las clases que quedarían después del límite.
    const lateIds = lessons.filter((lesson) => endDate !== null && getLocalDateKey(lesson.startAt, timezone) > endDate).map((lesson) => lesson.id);
    const [registrations, charges] = await Promise.all([
      readTableByIds<{ id: string; calendar_lesson_id: string }>(ctx.supabase, "lesson_registrations", { columns: "id, calendar_lesson_id", matchColumn: "calendar_lesson_id", ids: lateIds, filter: (query) => query.eq("owner_id", ctx.ownerId) }),
      readTableByIds<{ id: string; calendar_lesson_id: string }>(ctx.supabase, "payment_charges", { columns: "id, calendar_lesson_id", matchColumn: "calendar_lesson_id", ids: lateIds, filter: (query) => query.eq("owner_id", ctx.ownerId).is("voided_at", null) }),
    ]);
    const registered = new Set(registrations.map((row) => row.calendar_lesson_id));
    const charged = new Set(charges.map((row) => row.calendar_lesson_id));

    const forPlan: LessonForSeriesEnd[] = lessons.map((lesson) => ({
      id: lesson.id,
      status: lesson.status,
      startAt: lesson.startAt,
      occupiesSlot: lessonOccupiesSlot(lesson, exceptions),
      rescheduled: lesson.status === "rescheduled" && lesson.recurrenceOriginalStart !== null && lesson.recurrenceOccurrenceKey === null,
      cancelledBySeriesLimit: lesson.cancelledBySeriesLimit === true,
      hasRegistration: registered.has(lesson.id),
      hasCharge: charged.has(lesson.id),
    }));
    const impact = planSeriesEndImpact(forPlan, endDate, timezone);
    return {
      preview: {
        cancelled: impact.toCancel.slice(0, MAX_LISTED).map(({ date, rescheduled }) => ({ date, rescheduled })),
        cancelledTotal: impact.toCancel.length,
        restored: impact.toRestore.slice(0, MAX_LISTED).map(({ date, rescheduled }) => ({ date, rescheduled })),
        restoredTotal: impact.toRestore.length,
        blocked: impact.blocked.slice(0, 3).map((lesson) => lesson.date),
        blockedTotal: impact.blocked.length,
      },
    };
  } catch (error) {
    return { error: actionErrorMessage("series-end-preview", error) };
  }
}
