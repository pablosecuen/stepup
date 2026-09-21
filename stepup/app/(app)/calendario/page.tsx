import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext, DbUnauthenticatedError } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { ErrorState } from "@/components/ui/states";
import { RealCalendarToolbar } from "@/components/calendar/real-calendar-toolbar";
import { RealCalendarGrid } from "@/components/calendar/real-calendar-grid";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendario · TeacherFlow" };

const TIMEZONE = "America/Argentina/Buenos_Aires";

interface CalendarioSearchParams {
  view?: string;
  week?: string;
  day?: string;
}

function todayInArgentina(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return new Date(year, month - 1, day);
}

function parseDateKeyLocal(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const jsDay = d.getDay();
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function CalendarioPage({ searchParams }: { searchParams: Promise<CalendarioSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const params = await searchParams;
  const view: "week" | "day" = params.view === "day" ? "day" : "week";
  const today = todayInArgentina();
  const weekStart = params.week ? (parseDateKeyLocal(params.week) ?? startOfWeek(today)) : startOfWeek(today);
  const day = params.day ? (parseDateKeyLocal(params.day) ?? today) : today;

  const days = view === "week" ? Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)) : [day];
  const rangeStart = new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 0, 0, 0);
  const rangeEnd = new Date(days[days.length - 1].getFullYear(), days[days.length - 1].getMonth(), days[days.length - 1].getDate(), 23, 59, 59);

  let items;
  try {
    const ctx = await requireAuthenticatedDbContext();
    items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
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
          <Link href="/calendario" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
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
          <p className="mt-1.5 text-sm text-textMuted">
            <Link href="/calendario/series" className="font-semibold text-brandBlue hover:underline">
              Series
            </Link>{" "}
            ·{" "}
            <Link href="/calendario/disponibilidad" className="font-semibold text-brandBlue hover:underline">
              Disponibilidad
            </Link>{" "}
            ·{" "}
            <Link href="/registro" className="font-semibold text-brandBlue hover:underline">
              Clases por registrar
            </Link>
          </p>
        </div>
        <Link
          href="/calendario/nueva"
          className="rounded-md bg-brandBlue px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue focus-visible:ring-offset-2"
        >
          + Nueva clase
        </Link>
      </div>

      <RealCalendarToolbar view={view} weekStart={weekStart} day={day} buildHref={buildHref} />
      <RealCalendarGrid days={days} items={items} />
    </div>
  );
}
