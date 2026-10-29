import { NextResponse } from "next/server";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { listRegistrationProgressForCalendarLessonIds } from "@/lib/repositories/lesson-registrations";
import { loadLegacyRegisteredOccurrenceKeys } from "@/lib/repositories/legacy-registered-occurrences";
import { buildPendingLessons } from "@/lib/lessons/pending";

export const dynamic = "force-dynamic";

/** Same 90-day window and domain projection as Registro; GET is strictly read-only. */
export async function GET() {
  try {
    const ctx = await requireAuthenticatedDbContext(), now = new Date();
    const items = await loadCalendarViewForRange(ctx, new Date(now.getTime() - 90 * 86400000), now);
    const ids = items.flatMap(item => item.materializedLessonId ? [item.materializedLessonId] : []);
    const [registrations, legacyRegisteredOccurrences] = await Promise.all([
      listRegistrationProgressForCalendarLessonIds(ctx, ids), loadLegacyRegisteredOccurrenceKeys(ctx),
    ]);
    const count = buildPendingLessons({ calendarItems: items, now, registrations, legacyRegisteredOccurrences }).length;
    return NextResponse.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudieron consultar los pendientes." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
}
