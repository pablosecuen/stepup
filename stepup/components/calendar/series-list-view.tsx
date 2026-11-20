import { CheckCircleIcon, ExclamationTriangleIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import Link from "@/components/nav/private-link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { BackLink, PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { listLineagePredecessors, selectFinishedRecurrenceSeries, selectManageableRecurrenceSeries } from "@/lib/calendar/lineage";
import { formatCivilDate, formatCivilDayMonth } from "@/lib/format/date-format";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import type { RecurrenceRuleRecord } from "@/lib/repositories/recurrence-rules";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { SeriesStatusActions } from "@/app/(app)/calendario/series/series-status-actions";
import { FinishedSeriesDate } from "@/app/(app)/calendario/series/finished-series-date";
import type { SwapOption } from "@/components/calendar/series-swap-panel";

const WEEKDAY_LABELS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

const STATUS_BADGE: Record<string, { label: string; tone: "ok" | "warn" | "neutral" }> = {
  active: { label: "Activa", tone: "ok" },
  paused: { label: "Pausada", tone: "warn" },
  ended: { label: "Finalizada", tone: "neutral" },
};

/**
 * Lista de series vigentes (presentación). La página carga las reglas y los alumnos; esta vista agrupa por linaje, arma los
 * textos y dibuja cada serie con sus acciones. Sin consultas propias.
 */
type RuleWithLineageId = RecurrenceRuleRecord & { recurrenceId: string };

/** `lineage.ts` usa `recurrenceId` (nombre del móvil); el repositorio usa `id` (mismo criterio que el resto de la web) — se adapta acá, nunca se renombra el campo real de la tabla. */
export function withLineageIds(rules: RecurrenceRuleRecord[]): RuleWithLineageId[] {
  return rules.map((rule) => ({ ...rule, recurrenceId: rule.id }));
}

/** Las series que se pueden intercambiar (vigentes y activas), con su horario para reconocerlas. */
export function swapOptionsOf(manageable: RuleWithLineageId[], students: StudentRecord[]): SwapOption[] {
  const nameOf = (id: string) => students.find((student) => student.id === id)?.name ?? "Alumno";
  return manageable
    .filter((rule) => rule.status === "active")
    .map((rule) => ({ id: rule.id, label: rule.classTitle || rule.participantIds.map(nameOf).join(", ") || "Serie", schedule: scheduleOf(rule.weeks) }));
}

function scheduleOf(weeks: RecurrenceRuleRecord["weeks"]): string {
  return (
    weeks
      .flatMap((week) => week.sessions)
      .map((s) => `${WEEKDAY_LABELS[s.weekday]} ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}`)
      .join(" · ") || "Sin horario"
  );
}

/**
 * Tarjeta de UNA serie vigente (datos, tramos anteriores y acciones). La usan la lista de Series y la pantalla de una serie
 * concreta (`/calendario/series/[id]`): la misma composición de alumnos y de horario en las dos entradas.
 */
export function SeriesCard({
  rule,
  rulesForLineage,
  students,
  nowIso,
  swapOptions = [],
  highlighted = false,
  directEditFuture,
}: {
  swapOptions?: SwapOption[];
  rule: RuleWithLineageId;
  rulesForLineage: RuleWithLineageId[];
  students: StudentRecord[];
  nowIso: string;
  highlighted?: boolean;
  /** Llegó desde «Administrar serie»: «Editar futuras» se abre solo y al cancelar o guardar se vuelve a `returnTo` (el Calendario de origen). */
  directEditFuture?: { returnTo: string };
}) {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const namesOf = (ids: string[]) => ids.map((id) => studentsById.get(id)?.name ?? "Alumno").join(", ") || "Sin alumnos";
  const participantNames = namesOf(rule.participantIds);
  const scheduleLabel = scheduleOf(rule.weeks);
  // Tramos de un split "esta y las siguientes": la sucesora rige DESDE su fecha efectiva y la original HASTA su fin —
  // las dos se muestran, ninguna se oculta.
  const sinceLabel = rule.supersedesRecurrenceId && rule.effectiveFromDate ? `Desde ${formatCivilDayMonth(rule.effectiveFromDate)} · ` : "";
  const earlierSegments = listLineagePredecessors(rulesForLineage, rule, nowIso);
  const badge = STATUS_BADGE[rule.status] ?? STATUS_BADGE.ended;

  return (
    <Card className={highlighted ? "ring-2 ring-ink ring-offset-2" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p title={rule.classTitle || participantNames} className="line-clamp-2 font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{rule.classTitle || participantNames}</p>
          {rule.classTitle && <p title={participantNames} className="mt-0.5 line-clamp-1 text-[14px] text-textMuted [overflow-wrap:anywhere]">{participantNames}</p>}
        </div>
        <SeriesStatusActions ruleId={rule.id} status={rule.status} weeks={rule.weeks} participantIds={rule.participantIds} primaryStudentId={rule.primaryStudentId} students={students} seriesLabel={rule.classTitle || participantNames} scheduleLabel={`${scheduleLabel} · ${MODALITY_LABEL[rule.modality]}`} swapOptions={swapOptions} training={rule.activityKind === "training" ? { agreementId: rule.trainingBillingAgreementId } : null} directEditFuture={directEditFuture} seriesEndDate={rule.endDate} patternStartDate={rule.startDate} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-textSecondary">
        <span title={`${sinceLabel}${scheduleLabel} · ${MODALITY_LABEL[rule.modality]}`} className="line-clamp-2 [overflow-wrap:anywhere]">
          {sinceLabel}
          {scheduleLabel} · {MODALITY_LABEL[rule.modality]}
        </span>
        {rule.endDate && rule.status !== "ended" && <span className="font-[650] text-textPrimary">Hasta {formatCivilDate(rule.endDate)}</span>}
        {rule.activityKind !== "class" && <Badge>{ACTIVITY_KIND_LABEL[rule.activityKind]}</Badge>}
        <Badge tone={badge.tone} dot>
          {badge.label}
        </Badge>
        {rule.participantIds.length === 0 && (
          <Badge tone="warn" icon={<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />}>
            Sin alumnos asignados
          </Badge>
        )}
      </p>
      {earlierSegments.map((segment) => (
        <p key={segment.id} className="mt-1.5 text-[13.5px] text-textMuted [overflow-wrap:anywhere]">
          Tramo anterior: {scheduleOf(segment.weeks)} · {segment.endDate ? `hasta ${formatCivilDayMonth(segment.endDate)}` : "sin fecha de fin"} · {namesOf(segment.participantIds)}
        </p>
      ))}
    </Card>
  );
}

/**
 * Tarjeta de una serie que LLEGÓ a su fecha de finalización («Finalizadas»). Dice cuándo terminó y deja una sola acción: cambiar esa fecha. No es una serie eliminada
 * (ésas no se listan) ni se reactiva sola: seguir o no seguir es una decisión de la profesora.
 */
export function FinishedSeriesCard({ rule, students }: { rule: RuleWithLineageId; students: StudentRecord[] }) {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const participantNames = rule.participantIds.map((id) => studentsById.get(id)?.name ?? "Alumno").join(", ") || "Sin alumnos";
  const scheduleLabel = `${scheduleOf(rule.weeks)} · ${MODALITY_LABEL[rule.modality]}`;
  const seriesLabel = rule.classTitle || participantNames;
  const seriesEnd = rule.seriesEndDate ?? rule.endDate ?? "";
  return (
    <Card>
      <div className="min-w-0">
        <p title={seriesLabel} className="line-clamp-2 font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{seriesLabel}</p>
        {rule.classTitle && <p title={participantNames} className="mt-0.5 line-clamp-1 text-[14px] text-textMuted [overflow-wrap:anywhere]">{participantNames}</p>}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-textSecondary">
        <span title={scheduleLabel} className="line-clamp-2 [overflow-wrap:anywhere]">{scheduleLabel}</span>
        {rule.activityKind !== "class" && <Badge>{ACTIVITY_KIND_LABEL[rule.activityKind]}</Badge>}
        <Badge icon={<CheckCircleIcon className="h-3.5 w-3.5" aria-hidden />}>Finalizada</Badge>
        <span className="font-[650] text-textPrimary">Finalizó el {formatCivilDate(seriesEnd)}</span>
      </p>
      <div className="mt-3">
        <FinishedSeriesDate ruleId={rule.id} seriesLabel={seriesLabel} scheduleLabel={scheduleLabel} seriesEndDate={seriesEnd} weeksJson={JSON.stringify(rule.weeks)} participantIds={rule.participantIds} />
      </div>
    </Card>
  );
}

export type SeriesListFilter = "vigentes" | "finalizadas";

/** `?estado=finalizadas` abre «Finalizadas»; cualquier otro valor (o ninguno) deja «Vigentes». */
export function parseSeriesListFilter(value: string | string[] | undefined): SeriesListFilter {
  return (Array.isArray(value) ? value[0] : value) === "finalizadas" ? "finalizadas" : "vigentes";
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function SeriesListView({ rules, students, nowIso, filter = "vigentes" }: { rules: RecurrenceRuleRecord[]; students: StudentRecord[]; nowIso: string; filter?: SeriesListFilter }) {
  // Agrupación por LINAJE real (supersedesRecurrenceId), NUNCA por studentId — dos series del mismo alumno, o una serie sin alumno
  // principal, quedan siempre como tarjetas independientes.
  const rulesForLineage = withLineageIds(rules);
  const manageable = selectManageableRecurrenceSeries(rulesForLineage, nowIso);
  const swapOptions = swapOptionsOf(manageable, students);
  // «Finalizadas»: series que llegaron a su fecha de finalización. Su total NUNCA se mezcla con el de «Vigentes».
  const finished = selectFinishedRecurrenceSeries(rulesForLineage, nowIso);
  const showingFinished = filter === "finalizadas";
  const tabs: { key: SeriesListFilter; label: string; count: number; href: string }[] = [
    { key: "vigentes", label: "Vigentes", count: manageable.length, href: "/calendario/series" },
    { key: "finalizadas", label: "Finalizadas", count: finished.length, href: "/calendario/series?estado=finalizadas" },
  ];

  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/calendario">Volver al Calendario</BackLink>
      <div data-tf-header="" className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Series</PageTitle>
          <p className="mt-1.5 text-[15px] text-textMuted">
            {showingFinished
              ? `${finished.length} ${plural(finished.length, "serie finalizada", "series finalizadas")}.`
              : `${manageable.length} ${plural(manageable.length, "serie vigente", "series vigentes")}.`}
          </p>
        </div>
      </div>

      <nav aria-label="Estado de las series" className="mt-4">
        <ul className="flex gap-1 border-b-[1.5px] border-border">
          {tabs.map((tab) => {
            const active = tab.key === filter;
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`-mb-[1.5px] inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-[3px] px-3.5 text-[14.5px] transition-colors duration-150 ease-premium ${
                    active ? "border-accent font-bold text-textPrimary" : "border-transparent font-[650] text-textSecondary hover:text-textPrimary"
                  }`}
                >
                  {tab.label}
                  <span className="tf-num rounded-pill bg-paperDeep px-2 text-[12.5px] font-[650] text-textSecondary">{tab.count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {showingFinished ? (
        finished.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={CheckCircleIcon} message="Ninguna serie llegó todavía a su fecha de finalización." />
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-3.5">
            {finished.map((rule) => (
              <li key={rule.id} id={`series-${rule.id}`} className="scroll-mt-4">
                <FinishedSeriesCard rule={rule} students={students} />
              </li>
            ))}
          </ul>
        )
      ) : manageable.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Squares2X2Icon} message="Todavía no hay series recurrentes." action={{ label: "Crear una clase", href: "/calendario/nueva" }} />
        </div>
      ) : (
        // Un único desplazamiento: el de la página. Una lista con su propio scroll interno parecía terminar con tarjetas todavía ocultas debajo.
        <ul className="mt-6 flex flex-col gap-3.5">
          {manageable.map((rule) => (
            <li key={rule.id} id={`series-${rule.id}`} className="scroll-mt-4">
              <SeriesCard rule={rule} rulesForLineage={rulesForLineage} students={students} nowIso={nowIso} swapOptions={swapOptions} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
