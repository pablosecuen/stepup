import Link from "@/components/nav/private-link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getLessonRegistrationDetailByCalendarLessonId, listPendingHomeworkTasksForStudent } from "@/lib/repositories/lesson-registrations";
import { getCalendarLesson } from "@/lib/repositories/calendar-lessons";
import { listStudents } from "@/lib/repositories/students";
import { activityKindSupportsHomework, ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ErrorState } from "@/components/ui/states";
import { RegistrationWorkspace } from "./registration-workspace";
import { formatInstantDayLongTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registrar clase · TeacherFlow" };

export default async function RegistroClasePage({ params }: { params: Promise<{ calendarLessonId: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured />;
  }
  const { calendarLessonId } = await params;

  let detail;
  let calendarLesson;
  let participantsInfo: { studentId: string; name: string; level: string }[] = [];
  let pendingHomeworkByStudentId: Record<string, Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>>> = {};
  try {
    const ctx = await requireAuthenticatedDbContext();
    [detail, calendarLesson] = await Promise.all([
      getLessonRegistrationDetailByCalendarLessonId(ctx, calendarLessonId),
      getCalendarLesson(ctx, calendarLessonId),
    ]);

    if (detail && calendarLesson) {
      const students = await listStudents(ctx);
      const studentById = new Map(students.map((s) => [s.id, s]));
      participantsInfo = detail.participants.map((p) => {
        const student = studentById.get(p.studentId);
        return { studentId: p.studentId, name: student?.name ?? "Alumno", level: student?.levels[0] ?? "" };
      });

      if (activityKindSupportsHomework(detail.registration.activityKind)) {
        const entries = await Promise.all(
          detail.participants.map(async (p) => [p.studentId, await listPendingHomeworkTasksForStudent(ctx, p.studentId, { excludeOriginLessonRegistrationId: detail!.registration.id })] as const)
        );
        pendingHomeworkByStudentId = Object.fromEntries(entries);
      }
    }
  } catch {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar este registro." />
        <Link href="/registro" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Volver
        </Link>
      </div>
    );
  }

  // `notFound()` lanza una señal interna de Next.js — debe quedar SIEMPRE
  // fuera del try/catch de arriba, nunca dentro. Si quedara adentro, el
  // catch genérico la atraparía como si fuera un error real y mostraría
  // "No pudimos cargar este registro." en vez del 404 real (mismo criterio
  // ya aplicado en `alumnos/[id]/page.tsx`).
  if (!detail || !calendarLesson) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/registro" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Clases por registrar
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">{calendarLesson.classTitle?.trim() || "Registrar clase"}</h1>
        <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[detail.registration.activityKind]}</span>
      </div>
      <p className="mt-1.5 text-sm text-textMuted">
        {formatInstantDayLongTime(calendarLesson.startAt)}
      </p>

      <div className="mt-6">
        <RegistrationWorkspace
          registration={detail.registration}
          participants={participantsInfo}
          participantStatusByStudentId={Object.fromEntries(detail.participants.map((p) => [p.studentId, p.participantStatus]))}
          attendanceByStudentId={detail.attendanceByStudentId}
          evaluationByStudentId={detail.evaluationByStudentId}
          pendingHomeworkByStudentId={pendingHomeworkByStudentId}
          scheduledStartAt={calendarLesson.startAt}
          scheduledEndAt={calendarLesson.endAt}
        />
      </div>
    </div>
  );
}
