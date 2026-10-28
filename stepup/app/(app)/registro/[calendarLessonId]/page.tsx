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
import { RegistrationChargeCard, type RegistrationChargeLine } from "@/components/registro/registration-charge-card";
import { listStudentsCoveredByTrainingPlan } from "@/lib/repositories/training-coverage";
import { listChargeStatusForRegistration } from "@/lib/repositories/payments";
import { logLoadFailure } from "@/lib/errors/load-failure";
import { PAGE_WIDTH, PageTitle } from "@/components/ui/page-header";
import { RegistroPageFrame } from "@/components/registro/registro-page-frame";
import { RegistrationWorkspace } from "./registration-workspace";
import { LessonContentCard } from "@/components/registro/lesson-content-card";
import { getLessonContent, listMaterialLibrary } from "@/lib/repositories/lesson-content";
import { loadRegistrationIncidents } from "@/lib/repositories/origin-incidents";
import type { OriginIncidentView } from "@/lib/repositories/origin-incidents-mapping";
import { OriginIncidentsCard } from "@/components/registro/origin-incidents-card";
import type { LessonContent, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { formatInstantDayLongTime } from "@/lib/format/date-format";
import { resolveRegistrationHeader } from "@/lib/lessons/registration-form";
import { instantDateKey } from "@/lib/calendar/civil-calendar";
import { safeCalendarReturn } from "@/lib/registro/return-path";
import { resolveStudentBillingPlan, type StudentBillingPlan } from "@/lib/payments/billing-plan";

export const dynamic = "force-dynamic";
export const metadata = { title: "Registrar clase · TeacherFlow" };

export default async function RegistroClasePage({ params, searchParams }: { params: Promise<{ calendarLessonId: string }>; searchParams: Promise<{ volver?: string }> }) {
  if (!isSupabaseConfigured()) {
    return <AuthNotConfigured inShell />;
  }
  const { calendarLessonId } = await params;
  // «Editar registro» desde el Calendario: se vuelve a la misma semana o día (sólo rutas internas del Calendario).
  const returnHref = safeCalendarReturn((await searchParams).volver);

  let detail;
  let calendarLesson;
  let participantsInfo: { studentId: string; name: string; level: string }[] = [];
  let showPerClassBillingControls = false;
  let pendingHomeworkByStudentId: Record<string, Awaited<ReturnType<typeof listPendingHomeworkTasksForStudent>>> = {};
  let lessonContent: LessonContent | null = null;
  let materialLibrary: LibraryMaterial[] = [];
  let incidents: OriginIncidentView[] = [];
  let chargeLines: RegistrationChargeLine[] = [];
  let coveredByTrainingPlan = false;
  try {
    const ctx = await requireAuthenticatedDbContext();
    [detail, calendarLesson] = await Promise.all([
      getLessonRegistrationDetailByCalendarLessonId(ctx, calendarLessonId),
      getCalendarLesson(ctx, calendarLessonId),
    ]);

    if (detail && calendarLesson) {
      const students = await listStudents(ctx);
      const studentById = new Map(students.map((s) => [s.id, s]));
      showPerClassBillingControls = detail.participants.some(p => { const s = studentById.get(p.studentId); return s && resolveStudentBillingPlan({billingPlan:s.billingPlan as StudentBillingPlan|null,billingType:s.billingType,price:s.price}).type === "per_class"; });
      participantsInfo = detail.participants.map((p) => {
        const student = studentById.get(p.studentId);
        return { studentId: p.studentId, name: student?.name ?? "Alumno", level: student?.levels[0] ?? "" };
      });

      // Cobro de ESTA clase (sólo informativo: si no se puede leer, la pantalla sigue como siempre).
      if (detail.registration.status === "completed") {
        const participantIds = detail.participants.map((p: { studentId: string }) => p.studentId);
        const coveredStudents = await listStudentsCoveredByTrainingPlan(ctx, { activityKind: detail.registration.activityKind, recurrenceId: calendarLesson.recurrenceId, participantIds, sessionAnchorIso: calendarLesson.startAt }).catch(() => new Set<string>());
        coveredByTrainingPlan = participantIds.length > 0 && participantIds.every((studentId: string) => coveredStudents.has(studentId));
        const statuses = coveredByTrainingPlan ? [] : await listChargeStatusForRegistration(ctx, detail.registration.id).catch(() => []);
        chargeLines = statuses.map((status) => ({ chargeId: status.chargeId, studentId: status.studentId, studentName: studentById.get(status.studentId)?.name ?? "Alumno", total: status.total, paid: status.paid, balance: status.balance, state: status.state, payments: status.payments }));
      }

      lessonContent = await getLessonContent(ctx, detail.registration.id);
      // La biblioteca es complementaria: si no se puede leer, el registro igual se puede completar (sin elegir materiales).
      materialLibrary = await listMaterialLibrary(ctx).catch(() => []);
      // Las incidencias heredadas son información complementaria: si no se pueden leer, la pantalla sigue como siempre.
      incidents = (await loadRegistrationIncidents(ctx, [detail.registration.id]).catch(() => ({}) as Record<string, OriginIncidentView[]>))[detail.registration.id] ?? [];

      if (activityKindSupportsHomework(detail.registration.activityKind)) {
        const entries = await Promise.all(
          detail.participants.map(async (p) => [p.studentId, await listPendingHomeworkTasksForStudent(ctx, p.studentId, { excludeOriginLessonRegistrationId: detail!.registration.id })] as const)
        );
        pendingHomeworkByStudentId = Object.fromEntries(entries);
      }
    }
  } catch (error) {
    // Antes no quedaba rastro: sólo el tipo y el código (nunca el mensaje ni datos) para poder diagnosticar un fallo pasajero.
    logLoadFailure("registro", error);
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Registrar clase</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar este registro." />
          </div>
          <div className="flex flex-wrap gap-2">
            <PrivateButtonLink href={`/registro/${calendarLessonId}${returnHref ? `?volver=${encodeURIComponent(returnHref)}` : ""}`} variant="primary">
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
  // fuera del try/catch de arriba, nunca dentro. Si quedara adentro, el
  // catch genérico la atraparía como si fuera un error real y mostraría
  // "No pudimos cargar este registro." en vez del 404 real (mismo criterio
  // ya aplicado en `alumnos/[id]/page.tsx`).
  if (!calendarLesson) notFound();
  if (!detail) {
    // La clase existe pero no tiene registro asociado (p. ej. figura como registrada sin su registro guardado): se explica, no se muestra un 404.
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageTitle>Registro de la clase</PageTitle>
        <div className="mt-5 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No encontramos el registro de esta clase." />
          </div>
          <PrivateButtonLink href={returnHref ?? "/registro"} variant="secondary">
            {returnHref ? "Volver al Calendario" : "Volver"}
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  // Encabezado como en la app: el alumno (clase individual) o el nombre del grupo, el tipo de clase y, en un grupo, quiénes participan.
  const header = resolveRegistrationHeader({
    participantNames: participantsInfo.map((p) => p.name),
    classTitle: calendarLesson.classTitle,
    kindLabel: ACTIVITY_KIND_LABEL[detail.registration.activityKind],
    isRecurring: calendarLesson.isRecurring,
  });

  return (
    <RegistroPageFrame
      title={header.title}
      subtitle={formatInstantDayLongTime(calendarLesson.startAt)}
      lines={[header.typeLine, ...(header.participantsLine ? [header.participantsLine] : [])]}
      kindLabel={ACTIVITY_KIND_LABEL[detail.registration.activityKind]}
      backHref={returnHref ?? undefined}
      backLabel={returnHref ? "Volver al Calendario" : undefined}
    >
      <OriginIncidentsCard incidents={incidents} />
      <RegistrationChargeCard lines={chargeLines} coveredByTrainingPlan={coveredByTrainingPlan} />
      {lessonContent && !detail.registration.countsAsClass && <LessonContentCard includePedagogy={false} content={lessonContent} studentNames={Object.fromEntries(participantsInfo.map((p) => [p.studentId, p.name]))} />}
      <RegistrationWorkspace
        // Al cambiar el resultado de la clase el formulario se vuelve a armar con lo que quedó guardado.
        key={`${detail.registration.outcome}:${detail.registration.holidayException}:${detail.registration.countsAsClass}`}
        outcomeField={{ alreadyRescheduled: calendarLesson.status === "rescheduled", rescheduleHref: `/calendario?view=day&day=${instantDateKey(calendarLesson.startAt)}&reprogramar=${calendarLesson.id}` }}
        returnHref={returnHref}
        classLabel={`${ACTIVITY_KIND_LABEL[detail.registration.activityKind as keyof typeof ACTIVITY_KIND_LABEL] ?? "Clase"} · ${formatInstantDayLongTime(calendarLesson.startAt)}`}
        knownChargeIds={chargeLines.map((line) => line.chargeId)}
        initialContent={lessonContent}
        showPerClassBillingControls={showPerClassBillingControls}
        materialLibrary={materialLibrary}
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
