import Link from "@/components/nav/private-link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { ErrorState } from "@/components/ui/states";
import { RealCalendarToolbar } from "@/components/calendar/real-calendar-toolbar";
import { RealCalendarGrid } from "@/components/calendar/real-calendar-grid";
import { resolveCalendarWindow } from "@/lib/calendar/civil-calendar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · TeacherFlow" };

interface CalendarioSearchParams {
  view?: string;
  week?: string;
  day?: string;
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<CalendarioSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const params = await searchParams;
  // Días como claves civiles YYYY-MM-DD (nunca Date): ver lib/calendar/civil-calendar.ts.
  const { view, weekStartKey, dayKey, dayKeys, rangeStartIso, rangeEndIso } = resolveCalendarWindow(params, new Date());

  let items;
  try {
    const ctx = await requireAuthenticatedDbContext();
    items = await loadCalendarViewForRange(ctx, new Date(rangeStartIso), new Date(rangeEndIso));
  } catch (error) {
    if (error instanceof DbUnauthenticatedError) {
      return <ErrorState message="Tu sesión expiró. Volvé a iniciar sesión." />;
    }
    return (
      <div>
        <div className="px-4 pt-8 sm:px-8">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Calendario</h1>
        </div>
        <div className="px-4 py-6 sm:px-8">
          <ErrorState message="No pudimos cargar el calendario." />
          <Link href="/calendario" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
            Reintentar
          </Link>
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-8 sm:px-8">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Calendario</h1>
          <nav aria-label="Secciones del calendario" className="mt-1 flex flex-wrap items-center gap-x-4">
            <Link href="/calendario/series" className="inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
              Series
            </Link>
            <Link href="/calendario/disponibilidad" className="inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
              Disponibilidad
            </Link>
            <Link href="/registro" className="inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
              Clases por registrar
            </Link>
          </nav>
        </div>
        <Link
          href="/calendario/nueva"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          + Nueva clase
        </Link>
      </div>

      <RealCalendarToolbar view={view} weekStartKey={weekStartKey} dayKey={dayKey} buildHref={buildHref} />
      <RealCalendarGrid dayKeys={dayKeys} items={items} />
    </div>
  );
}
