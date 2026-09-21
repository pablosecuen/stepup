import Link from "next/link";
import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getLessonRegistrationDetail, listPendingHomeworkTasksForStudent } from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { activityKindSupportsHomework, ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { ErrorState } from "@/components/ui/states";
import { RegistrationWorkspace } from "../../[calendarLessonId]/registration-workspace";

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
    return <AuthNotConfigured />;
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
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        <ErrorState message="No pudimos cargar este registro." />
        <Link href="/registro" className="mt-3 inline-block text-sm font-semibold text-brandBlue hover:underline">
          Volver
        </Link>
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
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
      <Link href="/registro" className="text-sm font-medium text-brandBlue hover:underline">
        ← Volver a Clases por registrar
      </Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-textPrimary">Clase no programada</h1>
        <span className="rounded-pill bg-background px-2.5 py-1 text-xs font-semibold text-textSecondary">{ACTIVITY_KIND_LABEL[registration.activityKind]}</span>
      </div>
      <p className="mt-1.5 text-sm text-textMuted">
        {new Date(scheduledStartAt).toLocaleString("es-AR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} ·{" "}
        {ADHOC_OUTCOME_LABEL[registration.outcome]}
        {registration.modality ? ` · ${registration.modality === "presencial" ? "Presencial" : registration.modality === "online" ? "Online" : "Mixta"}` : ""}
      </p>

      <div className="mt-6">
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
      </div>
    </div>
  );
}
