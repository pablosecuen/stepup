import { notFound } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/auth/config";
import { AuthNotConfigured } from "@/components/auth/auth-not-configured";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getLessonRegistrationDetail, listPendingHomeworkTasksForStudent } from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { listChargeStatusForRegistration } from "@/lib/repositories/payments";
import { activityKindSupportsHomework, ACTIVITY_KIND_LABEL } from "@/lib/calendar/activity-kind";
import { ADHOC_OUTCOME_LABEL } from "@/lib/lessons/adhoc";
import { ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { logLoadFailure } from "@/lib/errors/load-failure";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { RegistroPageFrame } from "@/components/registro/registro-page-frame";
import { RegistrationWorkspace } from "../../[calendarLessonId]/registration-workspace";
import { formatParticipantNamesSentence } from "@/lib/lessons/registration-form";
import { formatInstantDayLongTime } from "@/lib/format/date-format";
import { LessonContentCard } from "@/components/registro/lesson-content-card";
import { getLessonContent, listMaterialLibrary } from "@/lib/repositories/lesson-content";
import { loadRegistrationIncidents } from "@/lib/repositories/origin-incidents";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { OriginIncidentsCard } from "@/components/registro/origin-incidents-card";
import type { LessonContent, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";

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
  let lessonContent: LessonContent | null = null;
  let materialLibrary: LibraryMaterial[] = [];
  let incidents: OriginIncidentView[] = [];
  // Cobros de esta clase que ya existían al abrir la pantalla (al editar no se vuelven a preguntar).
  let knownChargeIds: string[] = [];
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

      if (detail.registration.status === "completed") knownChargeIds = (await listChargeStatusForRegistration(ctx, detail.registration.id).catch(() => [])).map((status) => status.chargeId);
      lessonContent = await getLessonContent(ctx, detail.registration.id);
      // La biblioteca es complementaria: si no se puede leer, el registro igual se puede completar (sin elegir materiales).
      materialLibrary = await listMaterialLibrary(ctx).catch(() => []);
      // Las incidencias heredadas son información complementaria: si no se pueden leer, la pantalla sigue como siempre.
      incidents = (await loadRegistrationIncidents(ctx, [detail.registration.id]).catch(() => ({}) as Record<string, OriginIncidentView[]>))[detail.registration.id] ?? [];

      if (detail.registration.countsAsClass && activityKindSupportsHomework(detail.registration.activityKind)) {
        const entries = await Promise.all(
          detail.participants.map(async (p) => [p.studentId, await listPendingHomeworkTasksForStudent(ctx, p.studentId, { excludeOriginLessonRegistrationId: detail!.registration.id })] as const)
        );
        pendingHomeworkByStudentId = Object.fromEntries(entries);
      }
    }
  } catch (error) {
    // Antes no quedaba rastro: sólo el tipo y el código (nunca el mensaje ni datos) para poder diagnosticar un fallo pasajero.
    logLoadFailure("registro-libre", error);
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Clase no programada</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar este registro." />
          </div>
          <div className="flex flex-wrap gap-2">
            <PrivateButtonLink href={`/registro/libre/${registrationId}`} variant="primary">
              Reintentar
            </PrivateButtonLink>
            <PrivateButtonLink href="/registro" variant="secondary">
              Volver
            </PrivateButtonLink>
          </div>
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

  const participantNames = participantsInfo.map((p) => p.name);
  const typeLine = `${ACTIVITY_KIND_LABEL[registration.activityKind]} ${participantNames.length > 1 ? "grupal" : "individual"} · Clase suelta`;

  return (
    <RegistroPageFrame
      title="Clase no programada"
      lines={[typeLine, formatParticipantNamesSentence(participantNames)].filter((line) => line !== "")}
      subtitle={
        <>
          {formatInstantDayLongTime(scheduledStartAt)} · {ADHOC_OUTCOME_LABEL[registration.outcome]}
          {registration.modality ? ` · ${registration.modality === "presencial" ? "Presencial" : registration.modality === "online" ? "Online" : "Mixta"}` : ""}
        </>
      }
      kindLabel={ACTIVITY_KIND_LABEL[registration.activityKind]}
    >
      <OriginIncidentsCard incidents={incidents} />
      {lessonContent && !detail.registration.countsAsClass && <LessonContentCard includePedagogy={false} content={lessonContent} studentNames={Object.fromEntries(participantsInfo.map((p) => [p.studentId, p.name]))} />}
      <RegistrationWorkspace
        classLabel={`${ACTIVITY_KIND_LABEL[registration.activityKind]} · ${formatInstantDayLongTime(scheduledStartAt)}`}
        knownChargeIds={knownChargeIds}
        initialContent={lessonContent}
        materialLibrary={materialLibrary}
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
