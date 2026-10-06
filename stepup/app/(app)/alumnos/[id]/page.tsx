import Link from "@/components/nav/private-link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listStatusHistory, listLevelHistory, listPriceHistory } from "@/lib/repositories/student-history";
import { listLessonRegistrationsForStudent, listPendingHomeworkTasksForStudent, listEvaluationsForStudent } from "@/lib/repositories/lesson-registrations";
import { ErrorState } from "@/components/ui/states";
import { StudentStatusBadge } from "@/components/students/student-status-badge";
import { ChangeStatusForm } from "@/components/students/change-status-form";
import { ProfileTabsNav, type ProfileTabKey } from "@/components/students/profile/profile-tabs-nav";
import { ResumenTabContent } from "@/components/students/profile/resumen-tab";
import { InformacionTabContent } from "@/components/students/profile/informacion-tab";
import { ClasesTabContent } from "@/components/students/profile/clases-tab";
import { TareasTabContent } from "@/components/students/profile/tareas-tab";
import { ProgresoTabContent } from "@/components/students/profile/progreso-tab";
import { CobrosTabContent } from "@/components/students/profile/cobros-tab";
import { listChargesForStudent, listPaymentsForStudent, listAllocationsForStudent } from "@/lib/repositories/payments";
import { ChargeGenerationTrigger } from "@/components/payments/charge-generation-trigger";
import { ReportCleanupTrigger } from "@/components/students/profile/report-cleanup-trigger";
import { localDateKeyInTimeZone, billingPeriodOfDateKey } from "@/lib/payments/dates";
import { listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import { listReportRecordsForStudent } from "@/lib/repositories/reports";
import { getStudentMonthsWithClasses } from "@/lib/reports/months";
import { ReportesTabContent } from "@/components/students/profile/reportes-tab";
import { loadProfileClassStats, loadStudentNextClass, loadStudentTotalCollected } from "@/lib/students/load-profile-overview";
import { buildProfileClassStats, type ProfileClassStats, type StudentNextClass } from "@/lib/students/profile-overview";
import { MODALITY_LABEL } from "@/lib/students/constants";
import { formatCivilDate } from "@/lib/format/date-format";
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
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar este alumno." />
        <a href={`/alumnos/${id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brandBlue hover:underline">
          Reintentar
        </a>
      </div>
    );
  }

  if (!student) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/alumnos" className="inline-flex min-h-11 items-center text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Alumnos
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">{student.name}</h1>
          <div className="mt-1.5 flex items-center gap-2">
            <StudentStatusBadge status={student.status} />
            <span className="text-sm text-textMuted">{student.levels.length > 0 ? student.levels.join(", ") : "Sin nivel"}</span>
          </div>
          <p className="mt-1 text-sm text-textMuted">
            {MODALITY_LABEL[student.modality]} · Alumno desde {formatCivilDate(student.dateJoined)}
          </p>
        </div>
        <Link
          href={`/alumnos/${id}/editar`}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-textPrimary shadow-card transition-colors duration-150 ease-premium hover:border-brandBlue/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brandBlue"
        >
          Editar alumno
        </Link>
      </div>

      <div className="mt-6">
        <ProfileTabsNav studentId={id} active={tab} />
      </div>

      <div className="mt-5">
        {tab === "resumen" && (
          <div className="flex flex-col gap-5">
            <ResumenTabContent student={student} stats={stats} nextClass={nextClass} pendingTasks={pendingTasks} />
            <ChangeStatusForm studentId={id} currentStatus={student.status} />
          </div>
        )}
        {tab === "clases" && <ClasesTabContent registrations={registrations} attendanceByRegistrationId={attendanceByRegistrationId} />}
        {tab === "progreso" && <ProgresoTabContent entries={evaluationEntries} />}
        {tab === "tareas" && <TareasTabContent tasks={pendingTasks} />}
        {tab === "cobros" && (
          <>
            <ChargeGenerationTrigger />
            <CobrosTabContent studentId={id} charges={charges} payments={payments} allocations={allocations} todayDateKey={todayDateKey} />
          </>
        )}
        {tab === "reportes" && (
          <>
            <ReportCleanupTrigger />
            <ReportesTabContent studentId={id} studentName={student.name} monthsWithClasses={monthsWithClasses} initialHistory={reportHistory} />
          </>
        )}
        {tab === "informacion" && (
          <InformacionTabContent
            student={student}
            statusHistory={statusHistory}
            levelHistory={levelHistory}
            priceHistory={priceHistory}
            stats={stats}
            totalCollected={totalCollected}
          />
        )}
      </div>
    </div>
  );
}
