"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import {
  startLessonRegistration,
  saveParticipantRegistration,
  changeLessonRegistrationOutcome,
  finalizeLessonRegistration,
  editCompletedLessonRegistration,
  getLessonRegistrationDetailByCalendarLessonId,
  getLessonRegistrationDetail,
  LessonRegistrationNotFoundError,
  type LessonRegistrationRecord,
} from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { cancelCalendarOccurrence, getCalendarLesson } from "@/lib/repositories/calendar-lessons";
import { getLessonContent } from "@/lib/repositories/lesson-content";
import { absenceAttendanceStatus, validateOutcomeDraft, type AbsenceNotice } from "@/lib/lessons/registration-outcome";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { adhocEndAt, isAdhocClassHeld, validateAdhocRegistrationInput, type AdhocOutcome, type LateCancellationPolicy } from "@/lib/lessons/adhoc";
import { computePerClassBilledAmount } from "@/lib/payments/adhoc-billing";
import { resolveStudentBillingPlan, type MonthlyBillingPlan } from "@/lib/payments/billing-plan";
import { syncPerClassCharge } from "@/lib/repositories/payments";
import { listStudentsCoveredByTrainingPlan } from "@/lib/repositories/training-coverage";
import { actionErrorMessage } from "@/lib/errors/action-error";

const TIMEZONE = "America/Argentina/Buenos_Aires";

// Server Actions — Registro de clases. Nunca reciben `ownerId` del
// navegador; siempre resuelven la sesión real en el servidor. Se llaman
// directo desde manejadores de click con `startTransition` (mismo patrón
// que `real-lesson-detail-modal.tsx`/`series-status-actions.tsx`), nunca
// como `<form action={...}>` — así ningún formulario de evaluación/
// asistencia queda expuesto al reset nativo de React 19 que forzó el
// mecanismo de eco de valores en `new-lesson-form.tsx`; acá no hace falta
// porque nunca hay un `<form>` nativo de por medio.

import { validatePedagogicalContent, type PedagogicalContentInput } from "@/lib/lessons/pedagogical-content";
import { saveLessonContentDraft } from "@/lib/repositories/lesson-registrations";

export interface ActionResult<T = undefined> {
  error?: string;
  data?: T;
}

async function findCalendarItem(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, calendarLessonId: string | null, recurrenceId: string | null, occurrenceKey: string | null): Promise<CalendarViewItem | null> {
  // Rango amplio (1 año atrás, 1 día adelante) para ubicar la ocurrencia real sin depender de que el llamador ya la tenga en memoria.
  const rangeEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const rangeStart = new Date(rangeEnd.getTime() - 366 * 24 * 60 * 60 * 1000);
  const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd, undefined, { includeTestData: true });
  if (calendarLessonId) return items.find((i) => i.materializedLessonId === calendarLessonId) ?? null;
  if (recurrenceId && occurrenceKey) return items.find((i) => i.recurrenceId === recurrenceId && i.occurrenceKey === occurrenceKey) ?? null;
  return null;
}

export interface StartRegistrationActionInput {
  calendarLessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
}

/** Empieza (o retoma) el registro de una ocurrencia real del calendario — materializa si hace falta, nunca duplica. */
export async function startRegistrationAction(input: StartRegistrationActionInput): Promise<ActionResult<{ registration: LessonRegistrationRecord; calendarLessonId: string }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const calendarItem = await findCalendarItem(ctx, input.calendarLessonId, input.recurrenceId, input.occurrenceKey);
    if (!calendarItem) return { error: "No encontramos esa clase en el calendario." };

    const students = await listStudents(ctx);
    const participants = calendarItem.participantIds.map((id) => students.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (participants.length === 0) return { error: "Esta clase no tiene alumnos activos disponibles." };
    const primary = participants[0];

    const registration = await startLessonRegistration(ctx, {
      calendarLessonId: calendarItem.materializedLessonId,
      recurrenceId: input.recurrenceId,
      occurrenceKey: input.occurrenceKey,
      recurrenceIndex: input.recurrenceIndex,
      primaryStudentId: primary.id,
      studentName: primary.name,
      level: primary.levels[0] ?? "",
      lessonType: participants.length > 1 ? "group" : "individual",
      startAt: calendarItem.start,
      endAt: calendarItem.end,
      modality: calendarItem.modality,
      classTitle: calendarItem.title,
      activityKind: calendarItem.activityKind,
      countsAsClass: true,
      color: calendarItem.modality === "online" ? "#DDEBFF" : calendarItem.modality === "mixta" ? "#F2E8FF" : "#FFE4D2",
      participants: participants.map((p) => ({ studentId: p.id, studentName: p.name, level: p.levels[0] ?? "" })),
    });
    return { data: { registration, calendarLessonId: registration.calendarLessonId as string } };
  } catch (error) {
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
}

export interface StartAdhocRegistrationActionInput {
  studentIds: string[];
  date: string; // YYYY-MM-DD, Argentina
  time: string; // HH:mm, Argentina
  durationMinutes: number;
  modality: string;
  activityKind: "class"; // el móvil (NewClassScreen.tsx) nunca ofrece "training" en el camino ad-hoc — diferencia real, no inventada.
  outcome: AdhocOutcome;
  holidayException: boolean;
  /**
   * Idempotencia real (a pedido explícito de Joaquín): UUID generado UNA
   * VEZ del lado del cliente al montar `/registro/nuevo`
   * (`useState(() => crypto.randomUUID())`), nunca acá — esta acción nunca
   * genera su propio id, sólo lo reenvía tal cual a la RPC, que lo hace
   * cumplir con una restricción UNIQUE real. Doble clic, reintento tras una
   * respuesta perdida, dos pestañas o dos requests genuinamente
   * simultáneas con el mismo `operationId` siempre convergen en la MISMA
   * fila — nunca en la protección visual de `disabled`, que sólo evita el
   * caso más obvio.
   */
  operationId: string;
  /** Sólo tienen efecto real cuando `outcome === 'cancelada_tarde'` — Fase 5, cierre de Cancelada/Reprogramada. */
  lateCancellationPolicy?: LateCancellationPolicy | null;
  lateCancellationPercentage?: number | null;
  /** Enlace de trazabilidad opcional: si ESTA clase es la recuperación real de una anterior con `outcome: 'reprogramada'`, apunta al id de ESA otra registración — nunca al revés. */
  rescheduledFromRegistrationId?: string | null;
}

/**
 * Registro de una clase SIN reserva previa de Calendario — puerto real de
 * `NewClassScreen.tsx` (móvil). Nunca crea ni materializa ninguna fila en
 * `calendar_lessons`: llama a la MISMA `start_lesson_registration` con
 * `calendar_lesson_id: null`.
 */
export async function startAdhocRegistrationAction(input: StartAdhocRegistrationActionInput): Promise<ActionResult<{ registrationId: string }>> {
  const validationErrors = validateAdhocRegistrationInput(input);
  if (validationErrors.length > 0) return { error: validationErrors.join(" ") };
  if (!input.operationId) return { error: "Falta el identificador de la operación. Recargá la página e intentá de nuevo." };

  try {
    const ctx = await requireAuthenticatedDbContext();
    const students = await listStudents(ctx);
    const activeStudents = input.studentIds
      .map((id) => students.find((s) => s.id === id && s.status === "activo"))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (activeStudents.length === 0) return { error: "Elegí al menos un alumno activo." };

    const [hourStr, minuteStr] = input.time.split(":");
    const startAt = localDateTimeToInstantIso({ date: input.date, hour: Number(hourStr), minute: Number(minuteStr), timeZone: TIMEZONE });
    const endAt = adhocEndAt(startAt, input.durationMinutes);
    const countsAsClass = isAdhocClassHeld(input.outcome, input.holidayException);
    const primary = activeStudents[0];

    const registration = await startLessonRegistration(ctx, {
      calendarLessonId: null,
      recurrenceId: null,
      occurrenceKey: null,
      recurrenceIndex: null,
      primaryStudentId: primary.id,
      studentName: primary.name,
      level: primary.levels[0] ?? "",
      lessonType: activeStudents.length > 1 ? "group" : "individual",
      startAt,
      endAt,
      modality: input.modality,
      classTitle: null,
      activityKind: input.activityKind,
      countsAsClass,
      color: "#FCE4D2",
      participants: activeStudents.map((p) => ({ studentId: p.id, studentName: p.name, level: p.levels[0] ?? "" })),
      outcome: input.outcome,
      holidayException: input.holidayException,
      operationId: input.operationId,
      lateCancellationPolicy: input.lateCancellationPolicy ?? null,
      lateCancellationPercentage: input.lateCancellationPercentage ?? null,
      rescheduledFromRegistrationId: input.rescheduledFromRegistrationId ?? null,
    });

    // Cierre de Cancelada/Reprogramada (Fase 5): cuando el resultado no
    // implica que la clase se dictó (o cobra por política de cancelación
    // tardía), el registro queda 'completed' de inmediato (ver
    // countsAsClass/v_class_held) — sincroniza el cobro por clase ahora
    // mismo para los alumnos con plan 'por_clase', misma lógica que al
    // finalizar un registro normal.
    if (registration.status === "completed") {
      // Cierre de Cancelada/Reprogramada (Fase 5): cuando el resultado no
      // implica que la clase se dictó (o cobra por política de cancelación
      // tardía), el registro queda 'completed' de inmediato — sincroniza el
      // cobro por clase ahora mismo, misma función compartida que usa
      // finalizar/editar un registro normal.
      await syncPerClassChargesForRegistration(ctx, registration.id);
    }

    return { data: { registrationId: registration.id } };
  } catch (error) {
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
}

export interface SaveParticipantActionInput {
  content?: PedagogicalContentInput;
  lessonRegistrationId: string;
  studentId: string;
  participantStatus: "pending" | "completed" | "omitted" | null;
  attendanceStatus: string | null;
  lateMinutes: number | null;
  generalGrade: number | null;
  skillGrades: Record<string, number>;
  strengths: string[];
  areasToImprove: string[];
  individualObservation: string | null;
  individualHomeworkDescription: string | null;
  individualHomeworkDueDate: string | null;
  homeworkReviews: { taskId: string; outcome: string }[];
}

export async function saveParticipantAction(input: SaveParticipantActionInput): Promise<ActionResult> {
  if (input.content !== undefined && !validatePedagogicalContent(input.content)) return { error: "Revisá el contenido pedagógico de la clase." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    await saveParticipantRegistration(ctx, {
      content: input.content,
      lessonRegistrationId: input.lessonRegistrationId,
      studentId: input.studentId,
      participantStatus: input.participantStatus,
      attendance: input.attendanceStatus ? { status: input.attendanceStatus, lateMinutes: input.lateMinutes } : null,
      evaluation: {
        generalGrade: input.generalGrade,
        skillGrades: input.skillGrades,
        strengths: input.strengths,
        areasToImprove: input.areasToImprove,
        individualObservation: input.individualObservation,
        individualHomeworkDescription: input.individualHomeworkDescription,
        individualHomeworkDueDate: input.individualHomeworkDueDate,
        billedAmount: null,
      },
      homeworkReviews: input.homeworkReviews,
    });
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
  revalidatePath("/registro");
  return {};
}

export interface FinalizeRegistrationActionInput {
  content?: PedagogicalContentInput;
  lessonRegistrationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  actualDurationMinutes?: number | null;
  scheduledStartAt?: string | null;
}

export async function finalizeRegistrationAction(input: FinalizeRegistrationActionInput): Promise<ActionResult> {
  if (input.content !== undefined && !validatePedagogicalContent(input.content)) return { error: "Revisá el contenido pedagógico de la clase." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const startIso = input.scheduledStartAt ?? null;
    const endIso = startIso && input.actualDurationMinutes ? new Date(new Date(startIso).getTime() + input.actualDurationMinutes * 60_000).toISOString() : undefined;
    await finalizeLessonRegistration(ctx, {
      lessonRegistrationId: input.lessonRegistrationId,
      content: input.content,
      homeworkDescription: input.homeworkDescription,
      homeworkDueDate: input.homeworkDueDate,
      actualStartedAt: startIso ?? undefined,
      actualEndedAt: endIso,
    });
    await syncPerClassChargesForRegistration(ctx, input.lessonRegistrationId);
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
  revalidatePath("/registro");
  revalidatePath("/calendario");
  revalidatePath("/cobros");
  return {};
}

/**
 * Materializa (o corrige) el cobro por clase real de un registro ya
 * `completed`, para sus participantes con plan `'per_class'` — Fase 5.
 * `counts_as_class` (ya persistido por Fase 4) es exactamente `isClassHeld`
 * para CUALQUIER camino (calendario o ad-hoc) — nunca se recalcula acá.
 * Se llama SIEMPRE inmediatamente después de finalizar/editar, dentro de la
 * misma Server Action — nunca un paso manual aparte.
 */
async function syncPerClassChargesForRegistration(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, registrationId: string): Promise<void> {
  const detail = await getLessonRegistrationDetail(ctx, registrationId);
  if (!detail || detail.registration.status !== "completed") return;

  const students = await listStudents(ctx);
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const outcome = detail.registration.outcome as AdhocOutcome;
  const lateCancellationPolicy = (detail.registration.lateCancellationPolicy ?? null) as LateCancellationPolicy | null;

  // El cobro depende de la ACTIVIDAD: una sesión de entrenamiento cubierta por la cuota mensual de su serie no genera cobro por clase suelta, aunque el alumno pague sus otras clases por clase.
  // Con `amount: null` la sincronización retira sólo un cobro por clase de ESTE registro que siga sin pagos (nunca toca uno con pagos).
  const calendarLesson = detail.registration.calendarLessonId ? await getCalendarLesson(ctx, detail.registration.calendarLessonId) : null;
  // Por alumno: la sesión de entrenamiento cubierta por la cuota mensual de SU acuerdo y SU período (serie con acuerdo, o sesión suelta de un único acuerdo con el mismo grupo y la cuota de ese acuerdo en el mes). Nunca por tener alguna cuota de entrenamiento.
  const sessionAnchor = detail.registration.scheduledStartAt ?? detail.registration.actualStartedAt ?? detail.registration.createdAt;
  const coveredStudents = await listStudentsCoveredByTrainingPlan(ctx, { activityKind: detail.registration.activityKind, recurrenceId: calendarLesson?.recurrenceId ?? null, participantIds: detail.participants.map((p) => p.studentId), sessionAnchorIso: sessionAnchor });
  const isCovered = (studentId: string) => coveredStudents.has(studentId);

  const participants = detail.participants
    .map((p) => {
      const student = studentsById.get(p.studentId);
      if (!student) return null;
      const plan = resolveStudentBillingPlan({ billingPlan: student.billingPlan as MonthlyBillingPlan | null, billingType: student.billingType, price: student.price });
      if (plan.type !== "per_class") return null;
      const amount = isCovered(p.studentId) ? 0 : computePerClassBilledAmount({
        perClassAmount: plan.amount,
        outcome,
        isClassHeld: detail.registration.countsAsClass,
        lateCancellationPolicy,
        lateCancellationPercentage: detail.registration.lateCancellationPercentage,
      });
      return { studentId: p.studentId, amount: amount > 0 ? amount : null };
    })
    .filter((p): p is { studentId: string; amount: number | null } => p !== null);

  if (participants.length > 0) await syncPerClassCharge(ctx, registrationId, participants);
}

export interface EditCompletedRegistrationParticipantActionInput {
  studentId: string;
  attendanceStatus: string | null;
  lateMinutes: number | null;
  generalGrade: number | null;
  skillGrades: Record<string, number>;
  strengths: string[];
  areasToImprove: string[];
  individualObservation: string | null;
  individualHomeworkDescription: string | null;
  individualHomeworkDueDate: string | null;
  homeworkReviews: { taskId: string; outcome: string }[];
}

export interface EditCompletedRegistrationActionInput {
  content?: PedagogicalContentInput;
  lessonRegistrationId: string;
  /** Idempotencia real de ESTA edición — generado UNA vez del lado del cliente por cada intento de "Guardar cambios" (`useState(() => crypto.randomUUID())`), nunca regenerado en un reintento. */
  editOperationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  actualDurationMinutes?: number | null;
  scheduledStartAt?: string | null;
  /** Corrección post-finalización — sólo tiene efecto cuando el `outcome` del registro es `'cancelada_tarde'`. */
  lateCancellationPolicy?: LateCancellationPolicy | null;
  lateCancellationPercentage?: number | null;
  participants: EditCompletedRegistrationParticipantActionInput[];
}

/**
 * Única acción real para editar un registro ya finalizado (a pedido
 * explícito de Joaquín) — llama a una ÚNICA RPC atómica
 * (`edit_completed_lesson_registration`) que hace snapshot de auditoría +
 * aplica todos los cambios académicos (encabezado + N participantes) en la
 * MISMA transacción. Reemplaza el flujo anterior de dos escrituras
 * separadas (snapshot y después guardar) — nunca dos operaciones sueltas
 * del lado del cliente.
 */
export async function editCompletedRegistrationAction(input: EditCompletedRegistrationActionInput): Promise<ActionResult> {
  if (input.content !== undefined && !validatePedagogicalContent(input.content)) return { error: "Revisá el contenido pedagógico de la clase." };
  if (!input.editOperationId) return { error: "Falta el identificador de la edición. Recargá la página e intentá de nuevo." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const startIso = input.scheduledStartAt ?? null;
    const endIso = startIso && input.actualDurationMinutes ? new Date(new Date(startIso).getTime() + input.actualDurationMinutes * 60_000).toISOString() : undefined;
    await editCompletedLessonRegistration(ctx, {
      lessonRegistrationId: input.lessonRegistrationId,
      editOperationId: input.editOperationId,
      content: input.content,
      homeworkDescription: input.homeworkDescription,
      homeworkDueDate: input.homeworkDueDate,
      actualStartedAt: startIso ?? undefined,
      actualEndedAt: endIso,
      lateCancellationPolicy: input.lateCancellationPolicy,
      lateCancellationPercentage: input.lateCancellationPercentage,
      participants: input.participants.map((p) => ({
        studentId: p.studentId,
        attendance: p.attendanceStatus ? { status: p.attendanceStatus, lateMinutes: p.lateMinutes } : null,
        evaluation: {
          generalGrade: p.generalGrade,
          skillGrades: p.skillGrades,
          strengths: p.strengths,
          areasToImprove: p.areasToImprove,
          individualObservation: p.individualObservation,
          individualHomeworkDescription: p.individualHomeworkDescription,
          individualHomeworkDueDate: p.individualHomeworkDueDate,
        },
        homeworkReviews: p.homeworkReviews,
      })),
    });
    await syncPerClassChargesForRegistration(ctx, input.lessonRegistrationId);
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
  revalidatePath("/registro");
  revalidatePath("/cobros");
  return {};
}

export async function getLessonRegistrationForCalendarLessonAction(calendarLessonId: string) {
  const ctx = await requireAuthenticatedDbContext();
  return getLessonRegistrationDetailByCalendarLessonId(ctx, calendarLessonId);
}

/** Persists pedagogy for an unfinished class without completing attendance. */
export async function saveLessonContentDraftAction(input: { lessonRegistrationId: string; content: PedagogicalContentInput; homeworkDescription?: string | null; homeworkDueDate?: string | null; actualDurationMinutes?: number | null; scheduledStartAt?: string | null }): Promise<ActionResult> {
  if (!validatePedagogicalContent(input.content)) return { error: "Revisá el contenido pedagógico de la clase." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    // La duración real se guarda como inicio + duración (igual que al finalizar); sin duración válida no se toca.
    const startIso = input.scheduledStartAt ?? null;
    const duration = input.actualDurationMinutes && input.actualDurationMinutes > 0 ? input.actualDurationMinutes : null;
    const times = startIso && duration ? { actualStartedAt: startIso, actualEndedAt: new Date(new Date(startIso).getTime() + duration * 60_000).toISOString() } : {};
    await saveLessonContentDraft(ctx, input.lessonRegistrationId, input.content, { homeworkDescription: input.homeworkDescription, homeworkDueDate: input.homeworkDueDate, ...times });
  } catch (error) {
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
  revalidatePath("/registro");
  return {};
}

export interface ChangeRegistrationOutcomeActionInput {
  lessonRegistrationId: string;
  outcome: AdhocOutcome;
  /** Sólo con `alumno_ausente` (clase individual). */
  absenceNotice?: AbsenceNotice;
  holidayException?: boolean;
  lateCancellationPolicy?: LateCancellationPolicy | null;
  lateCancellationPercentage?: number | null;
  /** «Observación (opcional)»: se guarda como observación interna de la clase. */
  observation?: string;
}

/**
 * Elige el resultado de una clase programada que está en curso (puerto de «¿Qué pasó con esta clase?» de la app anterior). «Realizada» (o feriado con excepción) deja el
 * formulario abierto; cualquier otro resultado cierra el registro en el acto: no hay asistencia, evaluación ni tarea que cargar. Un alumno ausente guarda su asistencia
 * («ausente» o «ausente con aviso»); «cancelada con aviso» además libera el horario en el calendario; «reprogramada» exige que la clase ya tenga su nueva fecha.
 * Cada paso es idempotente: si algo falla a la mitad, el registro queda en curso y se puede repetir.
 */
export async function changeRegistrationOutcomeAction(input: ChangeRegistrationOutcomeActionInput): Promise<ActionResult<{ closed: boolean }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const detail = await getLessonRegistrationDetail(ctx, input.lessonRegistrationId);
    if (!detail) return { error: "Registro no encontrado." };
    if (detail.registration.status === "completed") return { error: "Este registro ya está finalizado: usá «Guardar cambios» para editarlo." };
    const calendarLesson = detail.registration.calendarLessonId ? await getCalendarLesson(ctx, detail.registration.calendarLessonId) : null;
    const isGroup = detail.participants.length > 1;
    const holidayException = input.outcome === "feriado" && input.holidayException === true;

    const errors = validateOutcomeDraft({
      outcome: input.outcome,
      absenceNotice: input.absenceNotice,
      holidayException,
      lateCancellationPolicy: input.lateCancellationPolicy ?? null,
      lateCancellationPercentage: input.lateCancellationPercentage ?? null,
      alreadyRescheduled: calendarLesson?.status === "rescheduled",
      isGroup,
    });
    if (errors.length > 0) return { error: errors.join(" ") };

    await changeLessonRegistrationOutcome(ctx, {
      lessonRegistrationId: input.lessonRegistrationId,
      outcome: input.outcome,
      holidayException,
      lateCancellationPolicy: input.outcome === "cancelada_tarde" ? input.lateCancellationPolicy ?? null : null,
      lateCancellationPercentage: input.outcome === "cancelada_tarde" && input.lateCancellationPolicy === "cobrar_porcentaje" ? input.lateCancellationPercentage ?? null : null,
    });
    revalidatePath("/registro");

    if (isAdhocClassHeld(input.outcome, holidayException)) return { data: { closed: false } };

    if (input.outcome === "alumno_ausente" && input.absenceNotice) {
      const studentId = detail.participants[0].studentId;
      await saveParticipantRegistration(ctx, {
        lessonRegistrationId: input.lessonRegistrationId,
        studentId,
        participantStatus: null,
        attendance: { status: absenceAttendanceStatus(input.absenceNotice), lateMinutes: null },
        evaluation: null,
        homeworkReviews: [],
      });
    }

    const observation = input.observation?.trim() ?? "";
    if (observation) {
      // La observación va a las notas internas SIN pisar nada de lo que ya se hubiera cargado en el contenido.
      const existing = await getLessonContent(ctx, input.lessonRegistrationId);
      const content: PedagogicalContentInput = {
        topics: existing?.topics ?? [],
        objectives: existing?.objectives ?? [],
        activities: existing?.activities ?? [],
        activityNotes: existing?.activityNotes ?? "",
        internalNotes: observation,
      };
      await saveLessonContentDraft(ctx, input.lessonRegistrationId, content);
    }

    await finalizeLessonRegistration(ctx, { lessonRegistrationId: input.lessonRegistrationId });
    await syncPerClassChargesForRegistration(ctx, input.lessonRegistrationId);

    if (input.outcome === "cancelada_con_aviso" && calendarLesson) {
      await cancelCalendarOccurrence(ctx, {
        lessonId: calendarLesson.id,
        recurrenceId: calendarLesson.recurrenceId,
        occurrenceKey: calendarLesson.recurrenceOccurrenceKey,
        recurrenceIndex: calendarLesson.recurrenceIndex,
        primaryStudentId: calendarLesson.primaryStudentId,
        studentName: calendarLesson.studentName,
        level: calendarLesson.level,
        lessonType: calendarLesson.lessonType,
        startAt: calendarLesson.startAt,
        endAt: calendarLesson.endAt,
        modality: calendarLesson.modality,
        classTitle: calendarLesson.classTitle,
        activityKind: calendarLesson.activityKind,
        color: calendarLesson.modality === "online" ? "#DDEBFF" : calendarLesson.modality === "mixta" ? "#F2E8FF" : "#FFE4D2",
      });
      revalidatePath("/calendario");
    }
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: actionErrorMessage("lesson-registrations", error) };
  }
  revalidatePath("/registro");
  revalidatePath("/calendario");
  revalidatePath("/cobros");
  return { data: { closed: true } };
}
