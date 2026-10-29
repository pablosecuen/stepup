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
