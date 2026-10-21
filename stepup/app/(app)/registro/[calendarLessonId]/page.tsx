import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getLessonRegistrationDetailByCalendarLessonId, listPendingHomeworkTasksForStudent } from "@/lib/repositories/lesson-registrations";
import { getCalendarLesson } from "@/lib/repositories/calendar-lessons";
import { listStudents } from "@/lib/repositories/students";
import { activityKindSupportsHomework, ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { RegistroPageFrame } from "@/components/registro/registro-page-frame";
import { RegistrationWorkspace } from "./registration-workspace";
import { LessonContentCard } from "@/components/registro/lesson-content-card";
import { getLessonContent } from "@/lib/repositories/lesson-content";
import { loadRegistrationIncidents } from "@/lib/repositories/origin-incidents";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { OriginIncidentsCard } from "@/components/registro/origin-incidents-card";
import type { LessonContent } from "@/lib/repositories/lesson-content-mapping";
import { formatInstantDayLongTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registrar clase · TeacherFlow" };

export default async function RegistroClasePage({ params }: { params: Promise<{ calendarLessonId: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }
  const { calendarLessonId } = await params;

  let detail;
  let calendarLesson;
  let participantsInfo: { studentId: string; name: string; level: string }[] = [];
  let pendingHomeworkByStudentId: Record<string, Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>>> = {};
  let lessonContent: LessonContent | null = null;
  let incidents: OriginIncidentView[] = [];
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

      lessonContent = await getLessonContent(ctx, detail.registration.id);
      // Las incidencias heredadas son información complementaria: si no se pueden leer, la pantalla sigue como siempre.
      incidents = (await loadRegistrationIncidents(ctx, [detail.registration.id]).catch(() => ({}) as Record<string, OriginIncidentView[]>))[detail.registration.id] ?? [];

      if (activityKindSupportsHomework(detail.registration.activityKind)) {
        const entries = await Promise.all(
          detail.participants.map(async (p) => [p.studentId, await listPendingHomeworkTasksForStudent(ctx, p.studentId, { excludeOriginLessonRegistrationId: detail!.registration.id })] as const)
        );
        pendingHomeworkByStudentId = Object.fromEntries(entries);
      }
    }
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Registrar clase</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar este registro." />
          </div>
          <PrivateButtonLink href="/registro" variant="secondary">
            Volver
          </PrivateButtonLink>
        </div>
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
    <RegistroPageFrame
      title={calendarLesson.classTitle?.trim() || "Registrar clase"}
      subtitle={formatInstantDayLongTime(calendarLesson.startAt)}
      kindLabel={ACTIVITY_KIND_LABEL[detail.registration.activityKind]}
    >
      <OriginIncidentsCard incidents={incidents} />
      {lessonContent && <LessonContentCard includePedagogy={false} content={lessonContent} studentNames={Object.fromEntries(participantsInfo.map((p) => [p.studentId, p.name]))} />}
      <RegistrationWorkspace
        initialContent={lessonContent}
        registration={detail.registration}
        participants={participantsInfo}
        participantStatusByStudentId={Object.fromEntries(detail.participants.map((p) => [p.studentId, p.participantStatus]))}
        attendanceByStudentId={detail.attendanceByStudentId}
        evaluationByStudentId={detail.evaluationByStudentId}
        pendingHomeworkByStudentId={pendingHomeworkByStudentId}
        scheduledStartAt={calendarLesson.startAt}
        scheduledEndAt={calendarLesson.endAt}
      />
    </RegistroPageFrame>
  );
}
