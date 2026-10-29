import type { StudentRecord } from "@/lib/repositories/students-mapping";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { listStatusHistory, listLevelHistory, listPriceHistory } from "@/lib/repositories/student-history";
import { listLessonRegistrationsForStudent, listPendingHomeworkTasksForStudent, listEvaluationsForStudent, listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import { listChargesForStudent, listPaymentsForStudent, listAllocationsForStudent } from "@/lib/repositories/payments";
import { loadChargeIncidents, loadRegistrationIncidents } from "@/lib/repositories/origin-incidents";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { listReportRecordsForStudent } from "@/lib/repositories/reports";
import { getStudentMonthsWithClasses } from "@/lib/reports/months";
import { loadProfileClassStats, loadStudentNextClass, loadStudentTotalCollected } from "@/lib/students/load-profile-overview";
import { buildProfileClassStats, type ProfileClassStats, type StudentNextClass } from "@/lib/students/profile-overview";
import { localDateKeyInTimeZone } from "@/lib/payments/dates";
import type { AttendanceStatus } from "@/lib/lessons/attendance";
import { buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";
import type { ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { StudentProfileTabContent } from "@/components/students/profile/student-profile-view";

/**
 * Cuerpo de la pestaña activa del perfil (29/10/2026): el ÚNICO lugar que consulta los datos de la pestaña. Vive en su propio límite de carga
 * (`<Suspense key={tab}>` en la página), así el encabezado y las pestañas del alumno aparecen apenas llega el alumno y el contenido de la pestaña
 * entra después en su lugar, sin esperar la una a la otra ni volver a dibujar lo que ya estaba. Cada pestaña carga SÓLO lo suyo y todo es de
 * sólo lectura (las tareas de fondo las dispara la página). Un fallo muestra su mensaje y «Reintentar» en el lugar de la pestaña, nunca un esqueleto
 * infinito ni la pantalla entera reemplazada.
 */
export async function ProfileTabBody({ ctx, student, tab }: { ctx: AuthenticatedDbContext; student: StudentRecord; tab: ProfileTabKey }) {
  const id = student.id;
  let statusHistory: Awaited<ReturnType<typeof listStatusHistory>> = [];
  let levelHistory: Awaited<ReturnType<typeof listLevelHistory>> = [];
  let priceHistory: Awaited<ReturnType<typeof listPriceHistory>> = [];
  let registrations: Awaited<ReturnType<typeof listLessonRegistrationsForStudent>> = [];
  let pendingTasks: Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>> = [];
  let evaluationEntries: Awaited<ReturnType<typeof listEvaluationsForStudent>> = [];
  let charges: Awaited<ReturnType<typeof listChargesForStudent>> = [];
  let payments: Awaited<ReturnType<typeof listPaymentsForStudent>> = [];
  let allocations: Awaited<ReturnType<typeof listAllocationsForStudent>> = [];
  let registrationIncidents: Record<string, OriginIncidentView[]> = {};
  let chargeIncidents: Record<string, OriginIncidentView[]> = {};
  let monthsWithClasses: string[] = [];
  let reportHistory: Awaited<ReturnType<typeof listReportRecordsForStudent>> = [];
  let stats: ProfileClassStats = buildProfileClassStats([]);
  let nextClass: StudentNextClass = { kind: "none" };
  let totalCollected = 0;
  let attendanceByRegistrationId: Record<string, AttendanceStatus> = {};
  const todayDateKey = localDateKeyInTimeZone(new Date());
  try {
    if (tab === "resumen") {
      // Sólo lecturas: cifras de clases dictadas, próxima clase del calendario y tareas pendientes (la misma fuente que la pestaña Tareas).
      [stats, nextClass, pendingTasks, totalCollected] = await Promise.all([
        loadProfileClassStats(ctx, id),
        loadStudentNextClass(ctx, student),
        listPendingHomeworkTasksForStudent(ctx, id),
        loadStudentTotalCollected(ctx, id),
      ]);
    }
    if (tab === "informacion") {
      [statusHistory, levelHistory, priceHistory, stats, totalCollected] = await Promise.all([
        listStatusHistory(ctx, id),
        listLevelHistory(ctx, id),
        listPriceHistory(ctx, id),
        loadProfileClassStats(ctx, id),
        loadStudentTotalCollected(ctx, id),
      ]);
    }
    if (tab === "clases") {
      const [all, held] = await Promise.all([listLessonRegistrationsForStudent(ctx, id), listCompletedRegistrationsForStudentReport(ctx, id)]);
      registrations = all;
      // Información complementaria: si no se puede leer, el historial se muestra igual.
      registrationIncidents = await loadRegistrationIncidents(ctx, all.map((r) => r.id)).catch(() => ({}));
      attendanceByRegistrationId = Object.fromEntries(held.flatMap((r) => (r.attendance ? [[r.registrationId, r.attendance.status] as const] : [])));
    }
    if (tab === "tareas") pendingTasks = await listPendingHomeworkTasksForStudent(ctx, id);
    if (tab === "progreso") [evaluationEntries, levelHistory] = await Promise.all([listEvaluationsForStudent(ctx, id), listLevelHistory(ctx, id)]);
    if (tab === "cobros") {
      // R2: sólo lectura. Esta pestaña puede abrirse directamente (sin pasar antes por Centro de cobros): la generación de
      // mensualidades/cuotas del período la dispara `ChargeGenerationTrigger` (Server Action) al mostrarse.
      [charges, payments, allocations] = await Promise.all([
        listChargesForStudent(ctx, id),
        listPaymentsForStudent(ctx, id),
        listAllocationsForStudent(ctx, id),
      ]);
      chargeIncidents = await loadChargeIncidents(ctx, charges.map((c) => c.id)).catch(() => ({}));
    }
    if (tab === "reportes") {
      // R2: sólo lectura. El reintento oportunista de la cola de limpieza de PDFs huérfanos (que borra objetos de Storage)
      // ya no corre en este GET: lo dispara `ReportCleanupTrigger` (Server Action) al abrir la pestaña.
      const [registrationsForReport, history] = await Promise.all([
        listCompletedRegistrationsForStudentReport(ctx, id),
        listReportRecordsForStudent(ctx, id),
      ]);
      monthsWithClasses = getStudentMonthsWithClasses(
        registrationsForReport.map((r) => ({ countsAsClass: true, dateKey: r.dateKey })),
        todayDateKey,
      );
      reportHistory = history;
    }
  } catch {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="w-full">
          <ErrorState message="No pudimos cargar esta sección del perfil." />
        </div>
        <a href={`/alumnos/${id}?tab=${tab}`} className={buttonClass({ variant: "secondary" })}>
          Reintentar
        </a>
      </div>
    );
  }

  return (
    <div className="tf-block">
      <StudentProfileTabContent
        student={student}
        tab={tab}
        data={{
          statusHistory,
          levelHistory,
          priceHistory,
          registrations,
          attendanceByRegistrationId,
          pendingTasks,
          evaluationEntries,
          charges,
          payments,
          allocations,
          registrationIncidents,
          chargeIncidents,
          monthsWithClasses,
          reportHistory,
          stats,
          nextClass,
          totalCollected,
          todayDateKey,
        }}
      />
    </div>
  );
}
