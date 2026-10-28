import PrivateLink from "@/components/nav/private-link";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { Card, CardHeader } from "@/components/ui/card";
import { linkClass, buttonClass } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { EmptyState } from "@/components/ui/states";
import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { PendingHomeworkTask } from "@/lib/lessons/homework";
import { ATTENDANCE_STATUS_LABEL } from "@/lib/lessons/attendance";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatGrade, formatHours, formatMoney } from "@/lib/format/number-format";
import { instantDateKey } from "@/lib/calendar/civil-calendar";
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
    <Card>
      <h2 className="font-display text-card font-semibold">{title}</h2>
      <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-[15px] text-textSecondary marker:text-borderStrong">
        {items.map((item, index) => (
          <li key={index} className="[overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InfoCard({ label, value, detail, children }: { label: string; value: string; detail?: string | null; children?: React.ReactNode }) {
  return (
    <Card>
      <p className="text-label font-bold uppercase text-textMuted">{label}</p>
      <p className="mt-2 font-display text-[24px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{value}</p>
      {detail && <p className="mt-1 text-[14px] text-textMuted [overflow-wrap:anywhere]">{detail}</p>}
      {children}
    </Card>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string | null }) {
  return (
    <Card className="!p-4">
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      <p className="mt-1.5 font-display text-[32px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">{value}</p>
      {detail && <p className="mt-1.5 text-[13px] text-textMuted">{detail}</p>}
    </Card>
  );
}

function NextClassCard({ nextClass }: { nextClass: StudentNextClass }) {
  if (nextClass.kind === "not-applicable") return <InfoCard label="Próxima clase" value="No aplica" detail="Sólo se agenda a alumnos activos." />;
  if (nextClass.kind === "none") {
    return (
      <InfoCard label="Próxima clase" value="Sin clases agendadas" detail={`No hay clases en los próximos ${DEFAULT_RECURRENCE_HORIZON_DAYS} días.`}>
        <PrivateLink href="/calendario/nueva" className={`mt-2 ${linkClass()}`}>
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
  totalCollected,
}: {
  student: StudentRecord;
  stats: ProfileClassStats;
  nextClass: StudentNextClass;
  pendingTasks: PendingHomeworkTask[];
  totalCollected: number;
}) {
  const audience = resolveProfileAudience({ status: student.status, classesHeld: stats.classesHeld });
  const lastClassDetail = stats.lastAttended ? ATTENDANCE_STATUS_LABEL[stats.lastAttended.attendance] : null;
  const bulletSections = [
    { title: "Alertas importantes", items: student.alerts },
    { title: "Objetivos actuales", items: student.currentGoals },
    { title: "Fortalezas", items: student.strengths },
    { title: "Aspectos a mejorar", items: student.areasToImprove },
  ].filter((section) => section.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <Card><h2 className="font-display text-card font-semibold">Acciones rápidas</h2><div className="mt-3 flex flex-wrap gap-2">
        {student.status === "activo" && <PrivateLink href={`/registro/nuevo?alumno=${encodeURIComponent(student.id)}`} className={buttonClass({variant:"secondary"})}>Registrar clase</PrivateLink>}
        <PrivateLink href={`/alumnos/${student.id}?tab=cobros`} className={buttonClass({variant:"secondary"})}>Registrar pago</PrivateLink>
        {student.status === "activo" && nextClass.kind === "found" && <PrivateLink href={`/calendario?view=day&day=${instantDateKey(nextClass.start)}&reprogramarAlumno=${encodeURIComponent(student.id)}&reprogramarInicio=${encodeURIComponent(nextClass.start)}`} className={buttonClass({variant:"secondary"})}>Reprogramar clase</PrivateLink>}
        <PrivateLink href={`/alumnos/${student.id}/editar`} className={buttonClass({variant:"secondary"})}>Editar alumno</PrivateLink>
      </div></Card>
      <Metric label="Inversión histórica" value={formatMoney(totalCollected)} detail="Pagos vigentes asignados a los cobros del alumno." />
      {audience === "archived" && <Notice tone="info">Alumno archivado: conserva todo su historial y no tiene agenda.</Notice>}
      {audience === "inactive" && (
        <Notice tone="info">
          Alumno {student.status === "pausado" ? "pausado" : "inactivo"}: conserva su historial y no tiene próximas clases mientras no esté activo.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <NextClassCard nextClass={nextClass} />
        {stats.lastAttended ? (
          <InfoCard label="Última clase" value={formatInstantDate(stats.lastAttended.anchorAt)} detail={lastClassDetail} />
        ) : (
          <InfoCard label="Última clase" value={stats.classesHeld > 0 ? "Sin asistencias registradas" : "Todavía no hay clases"} />
        )}
      </div>

      {stats.classesHeld === 0 ? (
        <EmptyState
          icon={ChartBarIcon}
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
            <ul className="mt-2.5 space-y-0.5 text-[13px] text-textMuted">
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
        <Card padded={false}>
          <CardHeader
            title={pendingTasks.length === 1 ? "Tarea pendiente" : `Tareas pendientes (${pendingTasks.length})`}
            meta={
              <PrivateLink href={`/alumnos/${student.id}?tab=tareas`} className={linkClass()}>
                Ver tareas →
              </PrivateLink>
            }
          />
          <div className="px-4 pb-4 nav:px-5 nav:pb-5">
            <ul className="list-disc space-y-1.5 pl-5 text-[15px] text-textSecondary marker:text-borderStrong">
              {pendingTasks.slice(0, MAX_VISIBLE_TASKS).map((task) => (
                <li key={task.taskId} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {task.description}
                </li>
              ))}
            </ul>
            {pendingTasks.length > MAX_VISIBLE_TASKS && <p className="mt-2 text-[13px] text-textMuted">y {pendingTasks.length - MAX_VISIBLE_TASKS} más</p>}
          </div>
        </Card>
      )}

      {bulletSections.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
          {bulletSections.map((section) => (
            <BulletSection key={section.title} title={section.title} items={section.items} />
          ))}
        </div>
      )}
    </div>
  );
}
