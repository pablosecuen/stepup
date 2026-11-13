import type { CalendarViewItem } from "./occurrences.ts";
import { getLocalDateKey } from "./timezone.ts";

export interface LessonReplacementLink {
  originalLessonId: string;
  replacementLessonId: string;
  kind: "moved" | "replaced";
  replacementActive: boolean;
}
export interface SeriesReplacementLink {
  originalLessonId: string;
  replacementRuleId: string;
  replacedRuleIds: string[];
  effectiveDate: string;
}
export interface CalendarReplacementLinks { lessons: LessonReplacementLink[]; series: SeriesReplacementLink[] }

/** Exact persisted links only. Simultaneous unrelated lessons remain visible. */
export function applyReplacementVisibility(items: CalendarViewItem[], links?: CalendarReplacementLinks): CalendarViewItem[] {
  if (!links) return items;
  return items.map((item) => {
    const released = links.lessons.some((link) => link.originalLessonId === item.id &&
      (link.kind === "moved" || link.replacementActive));
    const replacedSeries = item.status === "cancelled" && links.series.some((link) =>
      link.originalLessonId === item.id || (item.recurrenceId && link.replacedRuleIds.includes(item.recurrenceId) &&
        getLocalDateKey(item.start, "America/Argentina/Buenos_Aires") >= link.effectiveDate));
    // A completed class is historical evidence, even if old malformed metadata links it.
    if (item.status === "completed") return item;
    return released || replacedSeries ? { ...item, hiddenByReplacement: true, occupiesSlot: false } : item;
  });
}

/**
 * Arma los vínculos de reemplazo a partir de las filas persistidas (PURA: la comparten el repositorio y las pruebas con las filas reales de la base). Un reemplazo está ACTIVO si su clase existe,
 * no está cancelada y no es una clase «reprogramada» sin origen. Sólo vínculos exactos guardados: nunca coincidencia de horario ni de nombre.
 */
export function buildCalendarReplacementLinks(input: {
  lessons: ReadonlyArray<{ original_lesson_id: string; replacement_lesson_id: string; kind: "moved" | "replaced" }>;
  series: ReadonlyArray<{ original_lesson_id: string; replacement_rule_id: string; replaced_rule_ids: string[]; effective_date: string }>;
  replacementLessons: ReadonlyArray<{ id: string; status: string; recurrence_original_start: string | null }>;
}): CalendarReplacementLinks {
  const byId = new Map(input.replacementLessons.map((lesson) => [lesson.id, lesson]));
  return {
    lessons: input.lessons.map((link) => {
      const replacement = byId.get(link.replacement_lesson_id);
      return {
        originalLessonId: link.original_lesson_id,
        replacementLessonId: link.replacement_lesson_id,
        kind: link.kind,
        replacementActive: !!replacement && replacement.status !== "cancelled" && !(replacement.status === "rescheduled" && replacement.recurrence_original_start === null),
      };
    }),
    series: input.series.map((link) => ({ originalLessonId: link.original_lesson_id, replacementRuleId: link.replacement_rule_id, replacedRuleIds: link.replaced_rule_ids, effectiveDate: link.effective_date })),
  };
}

export function replacementSeriesFamilyIds(rules: { id: string; supersedesRecurrenceId: string | null }[], sourceId: string): Set<string> {
  const family = new Set([sourceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) if ((family.has(rule.id) && rule.supersedesRecurrenceId && !family.has(rule.supersedesRecurrenceId)) ||
      (rule.supersedesRecurrenceId && family.has(rule.supersedesRecurrenceId) && !family.has(rule.id))) {
      family.add(rule.id);
      if (rule.supersedesRecurrenceId) family.add(rule.supersedesRecurrenceId);
      changed = true;
    }
  }
  return family;
}
