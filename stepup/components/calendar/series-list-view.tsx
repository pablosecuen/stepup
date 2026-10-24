import { ExclamationTriangleIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { BackLink, PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { listLineagePredecessors, selectManageableRecurrenceSeries } from "@/lib/calendar/lineage";
import { formatCivilDayMonth } from "@/lib/format/date-format";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import type { RecurrenceRuleRecord } from "@/lib/repositories/recurrence-rules";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import { SeriesStatusActions } from "@/app/(app)/calendario/series/series-status-actions";
import { ScrollToLastSeries } from "@/components/calendar/scroll-to-last-series";
import { TrainingBillingConfigButton } from "@/components/payments/training-billing-config";
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
}: {
  swapOptions?: SwapOption[];
  rule: RuleWithLineageId;
  rulesForLineage: RuleWithLineageId[];
  students: StudentRecord[];
  nowIso: string;
  highlighted?: boolean;
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
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <p className="font-display text-[20px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{rule.classTitle || participantNames}</p>
          {rule.classTitle && <p className="mt-0.5 text-[14px] text-textMuted [overflow-wrap:anywhere]">{participantNames}</p>}
        </div>
        <Badge>{ACTIVITY_KIND_LABEL[rule.activityKind]}</Badge>
      </div>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] text-textSecondary">
        <span className="[overflow-wrap:anywhere]">
          {sinceLabel}
          {scheduleLabel} · {MODALITY_LABEL[rule.modality]}
        </span>
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
      <SeriesStatusActions ruleId={rule.id} status={rule.status} weeks={rule.weeks} participantIds={rule.participantIds} primaryStudentId={rule.primaryStudentId} students={students} seriesLabel={rule.classTitle || participantNames} scheduleLabel={`${scheduleLabel} · ${MODALITY_LABEL[rule.modality]}`} swapOptions={swapOptions} />
      {rule.activityKind === "training" && (
        <div className="mt-3">
          <TrainingBillingConfigButton recurrenceRuleId={rule.id} agreementId={rule.trainingBillingAgreementId} seriesLabel={rule.classTitle || participantNames} />
        </div>
      )}
    </Card>
  );
}

export function SeriesListView({ rules, students, nowIso }: { rules: RecurrenceRuleRecord[]; students: StudentRecord[]; nowIso: string }) {
  // Agrupación por LINAJE real (supersedesRecurrenceId), NUNCA por studentId — dos series del mismo alumno, o una serie sin alumno
  // principal, quedan siempre como tarjetas independientes.
  const rulesForLineage = withLineageIds(rules);
  const manageable = selectManageableRecurrenceSeries(rulesForLineage, nowIso);
  const swapOptions = swapOptionsOf(manageable, students);

  return (
    <div className={PAGE_WIDTH.wide}>
      <BackLink href="/calendario">Volver al Calendario</BackLink>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <PageTitle>Series</PageTitle>
          <p className="mt-1.5 text-[15px] text-textMuted">
            {manageable.length} serie{manageable.length === 1 ? "" : "s"} vigente{manageable.length === 1 ? "" : "s"}.
          </p>
        </div>
        {manageable.length > 4 && <ScrollToLastSeries lastRuleId={manageable[manageable.length - 1].id} />}
      </div>

      {manageable.length === 0 ? (
        <div className="mt-6">
          <EmptyState icon={Squares2X2Icon} message="Todavía no hay series recurrentes." action={{ label: "Crear una clase", href: "/calendario/nueva" }} />
        </div>
      ) : (
        <ul className="mt-6 flex max-h-[70vh] flex-col gap-3.5 overflow-y-auto pr-1">
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
