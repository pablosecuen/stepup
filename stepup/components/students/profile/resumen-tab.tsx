import PrivateLink from "@/components/nav/private-link";
import { EmptyState } from "@/components/ui/states";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { PendingHomeworkTask } from "@/lib/lessons/homework";
import { ATTENDANCE_STATUS_LABEL } from "@/lib/lessons/attendance";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatGrade, formatHours } from "@/lib/format/number-format";
import { formatInstantDate, formatInstantDayLongTime } from "@/lib/format/date-format";
import { DEFAULT_RECURRENCE_HORIZON_DAYS } from "@/lib/calendar/recurrence-engine";
import {
  resolveProfileAudience,
  type ProfileClassStats,
  type StudentNextClass,
} from "@/lib/students/profile-overview";

const MAX_VISIBLE_TASKS = 3;

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="text-sm font-semibold text-textPrimary">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-textSecondary">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function InfoCard({ label, value, detail, children }: { label: string; value: string; detail?: string | null; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold uppercase tracking-wider text-textMuted">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-textPrimary">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-textMuted">{detail}</p>}
      {children}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-card">
      <p className="text-xs font-medium text-textMuted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-textPrimary">{value}</p>
      {detail && <p className="mt-0.5 text-xs text-textMuted">{detail}</p>}
    </div>
  );
}

function NextClassCard({ nextClass }: { nextClass: StudentNextClass }) {
  if (nextClass.kind === "not-applicable") return <InfoCard label="Próxima clase" value="No aplica" detail="Sólo se agenda a alumnos activos." />;
  if (nextClass.kind === "none") {
    return (
      <InfoCard label="Próxima clase" value="Sin clases agendadas" detail={`No hay clases en los próximos ${DEFAULT_RECURRENCE_HORIZON_DAYS} días.`}>
        <PrivateLink
          href="/calendario/nueva"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          Programar una clase →
        </PrivateLink>
      </InfoCard>
    );
  }
  const modality = MODALITY_LABEL[nextClass.modality as keyof typeof MODALITY_LABEL];
  return (
    <InfoCard
      label={nextClass.timing === "in_progress" ? "Clase en curso" : "Próxima clase"}
      value={formatInstantDayLongTime(nextClass.start)}
      detail={[nextClass.title?.trim(), modality].filter(Boolean).join(" · ") || null}
    />
  );
}

/**
 * Resumen del perfil: sólo datos reales, cada uno con su definición (ver `profile-overview.ts`). Lo que no se puede calcular sin
 * ambigüedad no se muestra; el alumno sin clases dictadas ve un estado vacío en lugar de ceros. Las listas de alertas, objetivos,
 * fortalezas y aspectos a mejorar son datos reales del alumno (se cargan hoy desde la app móvil o una importación).
 */
export function ResumenTabContent({
  student,
  stats,
  nextClass,
  pendingTasks,
}: {
  student: StudentRecord;
  stats: ProfileClassStats;
  nextClass: StudentNextClass;
  pendingTasks: PendingHomeworkTask[];
}) {
  const audience = resolveProfileAudience({ status: student.status, classesHeld: stats.classesHeld });
  const lastClassDetail = stats.lastAttended ? ATTENDANCE_STATUS_LABEL[stats.lastAttended.attendance] : null;

  return (
    <div className="flex flex-col gap-4">
      {audience === "archived" && (
        <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-textSecondary">
          Alumno archivado: conserva todo su historial y no tiene agenda.
        </p>
      )}
      {audience === "inactive" && (
        <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-textSecondary">
          Alumno {student.status === "pausado" ? "pausado" : "inactivo"}: conserva su historial y no tiene próximas clases mientras no esté activo.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NextClassCard nextClass={nextClass} />
        {stats.lastAttended ? (
          <InfoCard label="Última clase" value={formatInstantDate(stats.lastAttended.anchorAt)} detail={lastClassDetail} />
        ) : (
          <InfoCard label="Última clase" value={stats.classesHeld > 0 ? "Sin asistencias registradas" : "Todavía no hay clases"} />
        )}
      </div>

      {stats.classesHeld === 0 ? (
        <EmptyState
          message={
            student.status === "activo"
              ? "Todavía no hay clases dictadas. Las cifras del alumno aparecen cuando registres su primera clase."
              : "No hay clases dictadas registradas para este alumno."
          }
          action={student.status === "activo" ? { label: "Ir a Registro", href: "/registro" } : undefined}
        />
      ) : (
        <section aria-label="Cifras del alumno">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Clases dictadas" value={String(stats.classesHeld)} />
            {stats.attendanceRatePercent !== null && (
              <Metric label="Asistencia" value={`${stats.attendanceRatePercent}%`} detail={`${stats.attended} de ${stats.attendanceBasis} clases`} />
            )}
            {stats.hours !== null && <Metric label="Horas de clase" value={formatHours(stats.hours)} />}
            {stats.averageGrade !== null && <Metric label="Promedio" value={formatGrade(stats.averageGrade)} />}
          </div>
          {(stats.unresolved > 0 || stats.attendedWithoutDuration > 0) && (
            <ul className="mt-2 space-y-0.5 text-xs text-textMuted">
              {stats.unresolved > 0 && (
                <li>
                  {stats.unresolved} clase{stats.unresolved === 1 ? "" : "s"} sin asistencia registrada no se cuenta{stats.unresolved === 1 ? "" : "n"} en asistencia ni horas.
                </li>
              )}
              {stats.attendedWithoutDuration > 0 && (
                <li>
                  {stats.attendedWithoutDuration} clase{stats.attendedWithoutDuration === 1 ? "" : "s"} sin horario no suma{stats.attendedWithoutDuration === 1 ? "" : "n"} horas.
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {pendingTasks.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <p className="text-sm font-semibold text-textPrimary">{pendingTasks.length === 1 ? "Tarea pendiente" : `Tareas pendientes (${pendingTasks.length})`}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-textSecondary">
            {pendingTasks.slice(0, MAX_VISIBLE_TASKS).map((task) => (
              <li key={task.taskId}>{task.description}</li>
            ))}
          </ul>
          {pendingTasks.length > MAX_VISIBLE_TASKS && <p className="mt-2 text-xs text-textMuted">y {pendingTasks.length - MAX_VISIBLE_TASKS} más</p>}
          <PrivateLink
            href={`/alumnos/${student.id}?tab=tareas`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
          >
            Ver tareas →
          </PrivateLink>
        </div>
      )}

      <BulletSection title="Alertas importantes" items={student.alerts} />
      <BulletSection title="Objetivos actuales" items={student.currentGoals} />
      <BulletSection title="Fortalezas" items={student.strengths} />
      <BulletSection title="Aspectos a mejorar" items={student.areasToImprove} />
    </div>
  );
}
