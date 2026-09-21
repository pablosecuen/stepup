"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import {
  startLessonRegistration,
  saveParticipantRegistration,
  finalizeLessonRegistration,
  editCompletedLessonRegistration,
  getLessonRegistrationDetailByCalendarLessonId,
  LessonRegistrationNotFoundError,
  type LessonRegistrationRecord,
} from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";
import { localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { isAdhocClassHeld, validateAdhocRegistrationInput, type AdhocOutcome } from "@/lib/lessons/adhoc";

const TIMEZONE = "America/Argentina/Buenos_Aires";

// Server Actions — Registro de clases. Nunca reciben `ownerId` del
// navegador; siempre resuelven la sesión real en el servidor. Se llaman
// directo desde manejadores de click con `startTransition` (mismo patrón
// que `real-lesson-detail-modal.tsx`/`series-status-actions.tsx`), nunca
// como `<form action={...}>` — así ningún formulario de evaluación/
// asistencia queda expuesto al reset nativo de React 19 que forzó el
// mecanismo de eco de valores en `new-lesson-form.tsx`; acá no hace falta
// porque nunca hay un `<form>` nativo de por medio.

export interface ActionResult<T = undefined> {
  error?: string;
  data?: T;
}

async function findCalendarItem(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, calendarLessonId: string | null, recurrenceId: string | null, occurrenceKey: string | null): Promise<CalendarViewItem | null> {
  // Rango amplio (1 año atrás, 1 día adelante) para ubicar la ocurrencia real sin depender de que el llamador ya la tenga en memoria.
  const rangeEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const rangeStart = new Date(rangeEnd.getTime() - 366 * 24 * 60 * 60 * 1000);
  const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
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
    return { error: error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo." };
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
    const endAt = new Date(new Date(startAt).getTime() + input.durationMinutes * 60_000).toISOString();
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
    });
    return { data: { registrationId: registration.id } };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo." };
  }
}

export interface SaveParticipantActionInput {
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
  try {
    const ctx = await requireAuthenticatedDbContext();
    await saveParticipantRegistration(ctx, {
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
    return { error: error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo." };
  }
  revalidatePath("/registro");
  return {};
}

export interface FinalizeRegistrationActionInput {
  lessonRegistrationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  actualDurationMinutes?: number | null;
  scheduledStartAt?: string | null;
}

export async function finalizeRegistrationAction(input: FinalizeRegistrationActionInput): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const startIso = input.scheduledStartAt ?? null;
    const endIso = startIso && input.actualDurationMinutes ? new Date(new Date(startIso).getTime() + input.actualDurationMinutes * 60_000).toISOString() : undefined;
    await finalizeLessonRegistration(ctx, {
      lessonRegistrationId: input.lessonRegistrationId,
      homeworkDescription: input.homeworkDescription,
      homeworkDueDate: input.homeworkDueDate,
      actualStartedAt: startIso ?? undefined,
      actualEndedAt: endIso,
    });
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo." };
  }
  revalidatePath("/registro");
  revalidatePath("/calendario");
  return {};
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
  lessonRegistrationId: string;
  /** Idempotencia real de ESTA edición — generado UNA vez del lado del cliente por cada intento de "Guardar cambios" (`useState(() => crypto.randomUUID())`), nunca regenerado en un reintento. */
  editOperationId: string;
  homeworkDescription?: string | null;
  homeworkDueDate?: string | null;
  actualDurationMinutes?: number | null;
  scheduledStartAt?: string | null;
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
  if (!input.editOperationId) return { error: "Falta el identificador de la edición. Recargá la página e intentá de nuevo." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const startIso = input.scheduledStartAt ?? null;
    const endIso = startIso && input.actualDurationMinutes ? new Date(new Date(startIso).getTime() + input.actualDurationMinutes * 60_000).toISOString() : undefined;
    await editCompletedLessonRegistration(ctx, {
      lessonRegistrationId: input.lessonRegistrationId,
      editOperationId: input.editOperationId,
      homeworkDescription: input.homeworkDescription,
      homeworkDueDate: input.homeworkDueDate,
      actualStartedAt: startIso ?? undefined,
      actualEndedAt: endIso,
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
  } catch (error) {
    if (error instanceof LessonRegistrationNotFoundError) return { error: "Registro no encontrado." };
    return { error: error instanceof Error ? error.message : "Ocurrió un error inesperado. Intentá de nuevo." };
  }
  revalidatePath("/registro");
  return {};
}

export async function getLessonRegistrationForCalendarLessonAction(calendarLessonId: string) {
  const ctx = await requireAuthenticatedDbContext();
  return getLessonRegistrationDetailByCalendarLessonId(ctx, calendarLessonId);
}
