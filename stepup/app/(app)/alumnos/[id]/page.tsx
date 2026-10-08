import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listStatusHistory, listLevelHistory, listPriceHistory } from "@/lib/repositories/student-history";
import { listLessonRegistrationsForStudent, listPendingHomeworkTasksForStudent, listEvaluationsForStudent } from "@/lib/repositories/lesson-registrations";
import { ErrorState } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { type ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { StudentProfileView } from "@/components/students/profile/student-profile-view";
import { listChargesForStudent, listPaymentsForStudent, listAllocationsForStudent } from "@/lib/repositories/payments";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { ReportCleanupTrigger } from "@/components/students/profile/report-cleanup-trigger";
import { localDateKeyInTimeZone, billingPeriodOfDateKey } from "@/lib/payments/dates";
import { listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import { listReportRecordsForStudent } from "@/lib/repositories/reports";
import { getStudentMonthsWithClasses } from "@/lib/reports/months";
import { loadProfileClassStats, loadStudentNextClass, loadStudentTotalCollected } from "@/lib/students/load-profile-overview";
import { buildProfileClassStats, type ProfileClassStats, type StudentNextClass } from "@/lib/students/profile-overview";
import type { AttendanceStatus } from "@/lib/lessons/attendance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Perfil del alumno · TeacherFlow" };

const VALID_TABS: ProfileTabKey[] = ["resumen", "clases", "progreso", "tareas", "cobros", "reportes", "informacion"];

export default async function AlumnoProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }

  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: ProfileTabKey = VALID_TABS.includes(rawTab as ProfileTabKey) ? (rawTab as ProfileTabKey) : "resumen";

  let student;
  let statusHistory: Awaited<ReturnType<typeof listStatusHistory>> = [];
  let levelHistory: Awaited<ReturnType<typeof listLevelHistory>> = [];
  let priceHistory: Awaited<ReturnType<typeof listPriceHistory>> = [];
  let registrations: Awaited<ReturnType<typeof listLessonRegistrationsForStudent>> = [];
  let pendingTasks: Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>> = [];
  let evaluationEntries: Awaited<ReturnType<typeof listEvaluationsForStudent>> = [];
  let charges: Awaited<ReturnType<typeof listChargesForStudent>> = [];
  let payments: Awaited<ReturnType<typeof listPaymentsForStudent>> = [];
  let allocations: Awaited<ReturnType<typeof listAllocationsForStudent>> = [];
  let monthsWithClasses: string[] = [];
  let reportHistory: Awaited<ReturnType<typeof listReportRecordsForStudent>> = [];
  let stats: ProfileClassStats = buildProfileClassStats([]);
  let nextClass: StudentNextClass = { kind: "none" };
  let totalCollected = 0;
  let attendanceByRegistrationId: Record<string, AttendanceStatus> = {};
  const todayDateKey = localDateKeyInTimeZone(new Date());
  try {
    const ctx = await requireAuthenticatedDbContext();
    student = await getStudent(ctx, id);
    if (student && tab === "resumen") {
      // Sólo lecturas: cifras de clases dictadas, próxima clase del calendario y tareas pendientes (la misma fuente que la pestaña Tareas).
      [stats, nextClass, pendingTasks] = await Promise.all([
        loadProfileClassStats(ctx, id),
        loadStudentNextClass(ctx, student),
        listPendingHomeworkTasksForStudent(ctx, id),
      ]);
    }
    if (student && tab === "informacion") {
      [statusHistory, levelHistory, priceHistory, stats, totalCollected] = await Promise.all([
        listStatusHistory(ctx, id),
        listLevelHistory(ctx, id),
        listPriceHistory(ctx, id),
        loadProfileClassStats(ctx, id),
        loadStudentTotalCollected(ctx, id),
      ]);
    }
    if (student && tab === "clases") {
      const [all, held] = await Promise.all([listLessonRegistrationsForStudent(ctx, id), listCompletedRegistrationsForStudentReport(ctx, id)]);
      registrations = all;
      attendanceByRegistrationId = Object.fromEntries(held.flatMap((r) => (r.attendance ? [[r.registrationId, r.attendance.status] as const] : [])));
    }
    if (student && tab === "tareas") pendingTasks = await listPendingHomeworkTasksForStudent(ctx, id);
    if (student && tab === "progreso") evaluationEntries = await listEvaluationsForStudent(ctx, id);
    if (student && tab === "cobros") {
      // R2: sólo lectura. Esta pestaña puede abrirse directamente (sin pasar antes por Centro de cobros): la generación de
      // mensualidades/cuotas del período la dispara `ChargeGenerationTrigger` (Server Action) al mostrarse.
      [charges, payments, allocations] = await Promise.all([
        listChargesForStudent(ctx, id),
        listPaymentsForStudent(ctx, id),
        listAllocationsForStudent(ctx, id),
      ]);
    }
    if (student && tab === "reportes") {
      // R2: sólo lectura. El reintento oportunista de la cola de limpieza de PDFs huérfanos (que borra objetos de Storage)
      // ya no corre en este GET: lo dispara `ReportCleanupTrigger` (Server Action) al abrir la pestaña.
      const [registrationsForReport, history] = await Promise.all([
        listCompletedRegistrationsForStudentReport(ctx, id),
        listReportRecordsForStudent(ctx, id),
      ]);
      monthsWithClasses = getStudentMonthsWithClasses(
        registrationsForReport.map((r) => ({ countsAsClass: true, dateKey: r.dateKey })),
        todayDateKey
      );
      reportHistory = history;
    }
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Perfil del alumno</PageTitle>
        <div className="mt-5">
          <ErrorState message="No pudimos cargar este alumno." />
        </div>
        <a href={`/alumnos/${id}`} className={`mt-3 ${buttonClass({ variant: "secondary" })}`}>
          Reintentar
        </a>
      </div>
    );
  }

  if (!student) notFound();

  return (
    <>
      {tab === "cobros" && <ChargeGenerationTrigger />}
      {tab === "reportes" && <ReportCleanupTrigger />}
      <StudentProfileView
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
          monthsWithClasses,
          reportHistory,
          stats,
          nextClass,
          totalCollected,
          todayDateKey,
        }}
      />
    </>
  );
}
