import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { occupiesAgendaSlot } from "@/lib/calendar/agenda";
import { availabilityBlocksForDays, type DayBlockSegment } from "@/lib/calendar/availability-blocks";
import { getTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { CalendarView } from "@/components/calendar/calendar-view";
import { resolveCalendarWindow } from "@/lib/calendar/civil-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · TeacherFlow" };

interface CalendarioSearchParams {
  view?: string;
  week?: string;
  day?: string;
  /** Id de la clase cuyo flujo de «Reprogramar» se abre directo (desde el resultado «Reprogramada» del registro). */
  reprogramar?: string;
  reprogramarAlumno?: string;
  reprogramarInicio?: string;
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<CalendarioSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const params = await searchParams;
  // Días como claves civiles YYYY-MM-DD (nunca Date): ver lib/calendar/civil-calendar.ts.
  const { view, weekStartKey, dayKey, dayKeys, rangeStartIso, rangeEndIso } = resolveCalendarWindow(params, new Date());

  let items;
  // Vacaciones / feriados guardados: el mismo dato con el que se validan las clases. Si no se pudiera leer, el Calendario se muestra igual (sin la señal) en vez de quedar vacío.
  let blocks: Record<string, DayBlockSegment[]> = {};
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [loadedItems, loadedBlocks] = await Promise.all([
      loadCalendarViewForRange(ctx, new Date(rangeStartIso), new Date(rangeEndIso)),
      getTeacherAvailability(ctx).then((availability) => availabilityBlocksForDays(dayKeys, availability)).catch((): Record<string, DayBlockSegment[]> => ({})),
    ]);
    items = loadedItems;
    blocks = loadedBlocks;
  } catch (error) {
    if (error instanceof DbUnauthenticatedError) {
      return <ErrorState message="Tu sesión expiró. Volvé a iniciar sesión." />;
    }
    return (
      <div className={PAGE_WIDTH.wide}>
        <PageTitle>Calendario</PageTitle>
        <div className="mt-6 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar el calendario." />
          </div>
          <PrivateButtonLink href="/calendario" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  function buildHref(overrides: { week?: string; day?: string; view?: "week" | "day" }): string {
    const nextView = overrides.view ?? view;
    const query = new URLSearchParams();
    if (nextView === "day") query.set("view", "day");
    if (nextView === "week" && overrides.week) query.set("week", overrides.week);
    if (nextView === "day" && overrides.day) query.set("day", overrides.day);
    const qs = query.toString();
    return qs ? `/calendario?${qs}` : "/calendario";
  }

  const requestedStudentClass = params.reprogramarAlumno && params.reprogramarInicio ? items.find(item => item.participantIds.includes(params.reprogramarAlumno!) && item.start === params.reprogramarInicio && occupiesAgendaSlot(item) && item.status !== "completed") : undefined;
  return <CalendarView view={view} weekStartKey={weekStartKey} dayKey={dayKey} dayKeys={dayKeys} items={items} blocks={blocks} buildHref={buildHref} rescheduleItemId={params.reprogramar ?? requestedStudentClass?.id} />;
}
