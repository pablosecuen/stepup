import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listRecurrenceRules } from "@/lib/repositories/recurrence-rules";
import { listStudents } from "@/lib/repositories/students";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { withoutExcludedRules, withoutExcludedStudents } from "@/lib/data-exclusion/exclusion";
import { findManageableForRule } from "@/lib/calendar/lineage";
import { getLocalDateKey } from "@/lib/calendar/timezone";
import { parseSeriesId, seriesBackTarget } from "@/lib/calendar/series-return";
import { formatCivilDayMonth } from "@/lib/format/date-format";
import { ErrorState } from "@/components/ui/states";
import { Notice } from "@/components/ui/notice";
import { PrivateButtonLink } from "@/components/ui/button";
import { BackLink, PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { SeriesCard, swapOptionsOf, withLineageIds } from "@/components/calendar/series-list-view";
import { SeriesSwapPanel } from "@/components/calendar/series-swap-panel";
import { selectManageableRecurrenceSeries } from "@/lib/calendar/lineage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Serie · TeacherFlow" };

interface SeriesDetailSearchParams {
  /** Semana o día del Calendario desde el que se abrió (ruta interna); «Volver» regresa ahí. */
  volver?: string;
}

/**
 * Administración de UNA serie concreta, abierta desde el detalle de una clase del Calendario con la identidad real de su serie (nunca
 * una búsqueda por nombre). Muestra la misma tarjeta que la lista de Series —mismos alumnos, horario y acciones—; si la clase es de
 * un tramo anterior de la serie se avisa y se muestra la serie vigente, donde se hacen los cambios. La lista general sigue en
 * `/calendario/series`.
 */
export default async function SeriesDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SeriesDetailSearchParams> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }

  const [{ id: rawId }, query] = await Promise.all([params, searchParams]);
  const id = parseSeriesId(rawId);
  const back = seriesBackTarget(query.volver);

  let rules;
  let students;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [allRules, allStudents, excludedStudentIds] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx), loadExcludedStudentIds(ctx)]);
    rules = withoutExcludedRules(allRules, excludedStudentIds);
    students = withoutExcludedStudents(allStudents, excludedStudentIds);
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
        <BackLink href={back}>Volver al Calendario</BackLink>
        <div className="mt-2">
          <PageTitle>Serie</PageTitle>
        </div>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar la serie." />
          </div>
          <PrivateButtonLink href={id ? `/calendario/series/${id}` : "/calendario/series"} variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  const nowIso = new Date().toISOString();
  const rulesForLineage = withLineageIds(rules);
  const exact = id ? rulesForLineage.find((rule) => rule.id === id) : undefined;

  if (!exact) {
    return (
      <div className={PAGE_WIDTH.wide}>
        <BackLink href={back}>Volver al Calendario</BackLink>
        <div className="mt-2">
          <PageTitle>Serie</PageTitle>
        </div>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No encontramos esa serie. Puede haberse reemplazado o ya no existir." />
          </div>
          <PrivateButtonLink href="/calendario/series" variant="secondary">
            Ver todas las series
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  const head = findManageableForRule(rulesForLineage, exact.id, nowIso);
  const isOwnHead = head?.id === exact.id;
  // Un tramo ya terminado (o con fecha de fin pasada) se muestra como finalizado: sin acciones de edición.
  const today = getLocalDateKey(nowIso, exact.timezone);
  const exactEnded = exact.status === "ended" || (exact.endDate !== null && exact.endDate < today);
  const shown = head ?? { ...exact, status: exactEnded ? ("ended" as const) : exact.status };
  const swapOptions = swapOptionsOf(selectManageableRecurrenceSeries(rulesForLineage, nowIso), students);
  const namesOf = (ids: string[]) => ids.map((participantId) => students.find((student) => student.id === participantId)?.name ?? "Alumno").join(", ") || "Sin alumnos";

  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href={back}>Volver al Calendario</BackLink>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Serie</PageTitle>
          <p className="mt-1.5 text-[15px] text-textMuted">La serie de la clase que abriste.</p>
        </div>
        <PrivateButtonLink href="/calendario/series" variant="secondary">
          Ver todas las series
        </PrivateButtonLink>
      </div>

      <div className="mt-5 flex flex-col gap-3.5">
        {head && !isOwnHead && (
          <Notice tone="info" title="Esa clase es de un tramo anterior de la serie">
            Ese tramo era {namesOf(exact.participantIds)}{exact.endDate ? ` hasta el ${formatCivilDayMonth(exact.endDate)}` : ""}. Los cambios se hacen en la serie vigente, que está abajo.
          </Notice>
        )}
        {!head && (
          <Notice tone="warn" title="Esta serie ya terminó">
            No tiene clases por venir, así que no hay nada que cambiar. Sus clases dictadas y registros se conservan.
          </Notice>
        )}
        <SeriesCard rule={shown} rulesForLineage={rulesForLineage} students={students} nowIso={nowIso} highlighted />
        {head && swapOptions.length >= 2 && swapOptions.some((option) => option.id === head.id) && <SeriesSwapPanel options={swapOptions} fixedId={head.id} />}
      </div>
    </div>
  );
}
