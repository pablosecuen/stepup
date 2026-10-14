import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getLessonRegistrationDetail, listPendingHomeworkTasksForStudent } from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { activityKindSupportsHomework, ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { RegistroPageFrame } from "@/components/registro/registro-page-frame";
import { RegistrationWorkspace } from "../../[calendarLessonId]/registration-workspace";
import { formatInstantDayLongTime } from "@/lib/format/date-format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registrar clase · TeacherFlow" };

/**
 * Detalle/edición de un registro AD-HOC (sin reserva de Calendario, puerto
 * de `NewClassScreen.tsx` — móvil). Mismo `RegistrationWorkspace` que
 * `/registro/[calendarLessonId]` (nunca se duplica la lógica de guardado);
 * la única diferencia real es de dónde viene la hora programada — acá de
 * la propia fila de `lesson_registrations` (`scheduled_start_at`/
 * `scheduled_end_at`), nunca de `calendar_lessons` (no existe ninguna para
 * un registro ad-hoc, a propósito).
 */
export default async function RegistroLibrePage({ params }: { params: Promise<{ registrationId: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }
  const { registrationId } = await params;

  let detail;
  let participantsInfo: { studentId: string; name: string; level: string }[] = [];
  let pendingHomeworkByStudentId: Record<string, Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>>> = {};
  try {
    const ctx = await requireAuthenticatedDbContext();
    detail = await getLessonRegistrationDetail(ctx, registrationId);

    if (detail) {
      const students = await listStudents(ctx);
      const studentById = new Map(students.map((s) => [s.id, s]));
      participantsInfo = detail.participants.map((p) => {
        const student = studentById.get(p.studentId);
        return { studentId: p.studentId, name: student?.name ?? "Alumno", level: student?.levels[0] ?? "" };
      });

      if (detail.registration.countsAsClass && activityKindSupportsHomework(detail.registration.activityKind)) {
        const entries = await Promise.all(
          detail.participants.map(async (p) => [p.studentId, await listPendingHomeworkTasksForStudent(ctx, p.studentId, { excludeOriginLessonRegistrationId: detail!.registration.id })] as const)
        );
        pendingHomeworkByStudentId = Object.fromEntries(entries);
      }
    }
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Clase no programada</PageTitle>
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
  // fuera del try/catch de arriba (mismo criterio ya corregido en
  // `alumnos/[id]/page.tsx` y `/registro/[calendarLessonId]/page.tsx`).
  // `calendar_lesson_id` no nulo acá significa que a esta ruta llegó un
  // registro que en realidad está ligado a Calendario — rechazarlo también
  // como "no encontrado" (la ruta real de ese registro es la otra).
  if (!detail || detail.registration.calendarLessonId !== null) notFound();

  const { registration } = detail;
  const scheduledStartAt = registration.scheduledStartAt ?? new Date().toISOString();
  const scheduledEndAt = registration.scheduledEndAt ?? scheduledStartAt;

  return (
    <RegistroPageFrame
      title="Clase no programada"
      subtitle={
        <>
          {formatInstantDayLongTime(scheduledStartAt)} · {ADHOC_OUTCOME_LABEL[registration.outcome]}
          {registration.modality ? ` · ${registration.modality === "presencial" ? "Presencial" : registration.modality === "online" ? "Online" : "Mixta"}` : ""}
        </>
      }
      kindLabel={ACTIVITY_KIND_LABEL[registration.activityKind]}
    >
      <RegistrationWorkspace
        registration={registration}
        participants={participantsInfo}
        participantStatusByStudentId={Object.fromEntries(detail.participants.map((p) => [p.studentId, p.participantStatus]))}
        attendanceByStudentId={detail.attendanceByStudentId}
        evaluationByStudentId={detail.evaluationByStudentId}
        pendingHomeworkByStudentId={pendingHomeworkByStudentId}
        scheduledStartAt={scheduledStartAt}
        scheduledEndAt={scheduledEndAt}
      />
    </RegistroPageFrame>
  );
}
