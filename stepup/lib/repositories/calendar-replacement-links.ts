import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import { buildCalendarReplacementLinks, type CalendarReplacementLinks } from "@/lib/calendar/replacement-visibility";

export async function listCalendarReplacementLinks(ctx: AuthenticatedDbContext): Promise<CalendarReplacementLinks> {
  const [lessons, series] = await Promise.all([
    readTable<{ original_lesson_id: string; replacement_lesson_id: string; kind: "moved" | "replaced" }>(ctx.supabase,"calendar_replacement_links", {
      columns: "id,original_lesson_id,replacement_lesson_id,kind",
      filter: q => q.eq("owner_id",ctx.ownerId),
    }),
    readTable<{ original_lesson_id: string; replacement_rule_id: string; replaced_rule_ids: string[]; effective_date: string }>(ctx.supabase,"calendar_series_replacement_links", {
      columns: "id,original_lesson_id,replacement_rule_id,replaced_rule_ids,effective_date",
      filter: q => q.eq("owner_id",ctx.ownerId),
    }),
  ]);
  const replacements = await readTableByIds<{ id: string; status: string; recurrence_original_start: string | null }>(ctx.supabase,"calendar_lessons", {
    columns: "id,status,recurrence_original_start", matchColumn: "id", ids: lessons.map(l=>l.replacement_lesson_id),
    filter: q => q.eq("owner_id",ctx.ownerId),
  });
  return buildCalendarReplacementLinks({ lessons, series, replacementLessons: replacements });
}
