import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import type { CalendarReplacementLinks } from "@/lib/calendar/replacement-visibility";

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
  const byId = new Map(replacements.map(r=>[r.id,r]));
  return {
    lessons: lessons.map(l=>{const replacement=byId.get(l.replacement_lesson_id);return {
      originalLessonId:l.original_lesson_id,replacementLessonId:l.replacement_lesson_id,kind:l.kind,
      replacementActive:!!replacement && replacement.status!=="cancelled" && !(replacement.status==="rescheduled" && replacement.recurrence_original_start===null),
    };}),
    series:series.map(l=>({originalLessonId:l.original_lesson_id,replacementRuleId:l.replacement_rule_id,replacedRuleIds:l.replaced_rule_ids,effectiveDate:l.effective_date})),
  };
}
