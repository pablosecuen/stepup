"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { getRecurrenceRule, listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { replacementSeriesFamilyIds } from "@/lib/calendar/replacement-visibility";
import { resolveEditableSegment } from "@/lib/calendar/lineage";
import { planSeriesSlotMove } from "@/lib/calendar/slot-move";
import { getLocalDateKey } from "@/lib/calendar/timezone";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { editFutureRecurrenceAction, type FormState } from "@/lib/actions/calendar";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const DAY_MS = 86_400_000;

export interface UpcomingSeriesOccurrence {
  id: string;
  start: string;
  end: string;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  materializedLessonId: string | null;
  title: string | null;
  studentName: string;
  participantNames: string[];
  status: string;
}

/** Próximas clases de UNA serie (con sus tramos anteriores y posteriores), sin canceladas ni reprogramadas: es lo que se puede elegir para cambiarle el horario. */
export async function upcomingSeriesOccurrencesAction(ruleId: string): Promise<{ items?: UpcomingSeriesOccurrence[]; error?: string }> {
  try {
    if (!ruleId) throw new Error("Serie inválida");
    const ctx = await requireAuthenticatedDbContext();
    const family = replacementSeriesFamilyIds(await listRecurrenceRules(ctx), ruleId);
    const from = new Date();
    const items = await loadCalendarViewForRange(ctx, from, new Date(from.getTime() + 75 * DAY_MS), undefined, { includeTestData: true });
    const upcoming = items
      .filter((item) => !!item.recurrenceId && family.has(item.recurrenceId) && item.status !== "cancelled" && item.status !== "rescheduled" && item.status !== "completed" && item.start > from.toISOString())
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 12)
      .map((item) => ({
        id: item.id,
        start: item.start,
        end: item.end,
        recurrenceId: item.recurrenceId,
        occurrenceKey: item.occurrenceKey,
        materializedLessonId: item.materializedLessonId,
        title: item.title,
        studentName: item.studentName,
        participantNames: item.participantNames ?? [],
        status: item.status,
      }));
    return { items: upcoming };
  } catch (error) {
    return { error: actionErrorMessage("series-upcoming", error) };
  }
}

export interface ChangeSeriesSlotInput {
  ruleId: string;
  /** Inicio (ISO) de la clase de la serie que se mueve. */
  originalStart: string;
  targetDate: string;
  targetTime: string;
  confirmReplace?: boolean;
}

/**
 * «Cambiar horario — esta y las siguientes»: la sesión semanal de la serie que cae en la clase elegida pasa al día y hora nuevos y las demás no cambian. El patrón se vuelve a calcular
 * ACÁ (nunca se confía en el del navegador) y el guardado es el mismo corte atómico de «Editar futuras» (`editFutureRecurrenceAction`): se valida contra otras clases, bloqueos de
 * disponibilidad y los tramos que se reemplazan, sin «guardar igual». La clase original queda reemplazada por UNA sola ocurrencia (la nueva); el pasado, los registros, las
 * asistencias, tareas, adjuntos, cobros y pagos no se tocan.
 */
export async function changeSeriesSlotAction(input: ChangeSeriesSlotInput): Promise<FormState> {
  try {
    if (!input?.ruleId || !input.originalStart || Number.isNaN(Date.parse(input.originalStart))) return { error: "Elegí la clase que querés cambiar." };
    const ctx = await requireAuthenticatedDbContext();
    const todayDate = getLocalDateKey(new Date().toISOString(), TIMEZONE);
    const originalDate = getLocalDateKey(input.originalStart, TIMEZONE);
    const effectiveDate = input.targetDate < originalDate ? input.targetDate : originalDate;
    const rules = (await listRecurrenceRules(ctx)).map((rule) => ({ ...rule, recurrenceId: rule.id }));
    const segment = resolveEditableSegment(rules, input.ruleId, effectiveDate);
    if (!segment) return { error: "Ningún tramo de esta serie rige esa fecha. Elegí otro día." };
    const target = (await getRecurrenceRule(ctx, segment.target.id)) ?? null;
    if (!target) return { error: "Serie no encontrada." };

    const plan = planSeriesSlotMove({
      rule: { weeks: target.weeks, startDate: target.startDate, endDate: target.endDate, timezone: target.timezone },
      originalStartIso: input.originalStart,
      targetDate: input.targetDate,
      targetTime: input.targetTime,
      todayDate,
    });
    if (!plan.ok) return { error: plan.error };

    const formData = new FormData();
    formData.set("originalRecurrenceId", input.ruleId);
    formData.set("effectiveDate", plan.effectiveDate);
    formData.set("keepPattern", "true");
    formData.set("weeksPatchJson", JSON.stringify(plan.weeks));
    if (input.confirmReplace) formData.set("confirmReplace", "true");
    return await editFutureRecurrenceAction({}, formData);
  } catch (error) {
    return { error: actionErrorMessage("series-slot-change", error) };
  }
}
