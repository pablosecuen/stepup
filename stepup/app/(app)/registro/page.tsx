import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { listRegistrationProgressForCalendarLessonIds } from "@/lib/repositories/lesson-registrations";
import { loadLegacyRegisteredOccurrenceKeys } from "@/lib/repositories/legacy-registered-occurrences";
import { buildPendingLessons } from "@/lib/lessons/pending";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { PendingListView } from "@/components/registro/pending-list-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clases por registrar · TeacherFlow" };

// Ventana de búsqueda de pendientes: 90 días atrás — una clase sin
// registrar nunca "vence" en el móvil, pero acotar el rango evita generar
// ocurrencias virtuales sin límite; documentado como decisión de alcance
// real en docs/WEB_PARITY_PLAN.md, no un comportamiento fabricado.
const LOOKBACK_DAYS = 90;

export default async function RegistroPendientesPage() {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  let pending: ReturnType<typeof buildPendingLessons> = [];
  try {
    const ctx = await requireAuthenticatedDbContext();
    const now = new Date();
    const rangeStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const rangeEnd = now;
    const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
    const calendarLessonIds = items.map((i) => i.materializedLessonId).filter((id): id is string => !!id);
    const [registrations, legacyRegisteredOccurrences] = await Promise.all([listRegistrationProgressForCalendarLessonIds(ctx, calendarLessonIds), loadLegacyRegisteredOccurrenceKeys(ctx)]);
    pending = buildPendingLessons({ calendarItems: items, now, registrations, legacyRegisteredOccurrences });
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
        <PageTitle>Clases por registrar</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar las clases por registrar." />
          </div>
          <PrivateButtonLink href="/registro" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  return <PendingListView pending={pending} />;
}
