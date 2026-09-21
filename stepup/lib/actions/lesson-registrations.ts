"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import {
  startLessonRegistration,
  saveParticipantRegistration,
  finalizeLessonRegistration,
  getLessonRegistrationDetailByCalendarLessonId,
  LessonRegistrationNotFoundError,
  type LessonRegistrationRecord,
} from "@/lib/repositories/lesson-registrations";
import { listStudents } from "@/lib/repositories/students";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import type { CalendarViewItem } from "@/lib/calendar/occurrences";

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

/** Editar un registro ya finalizado — mismo mecanismo que finalizar (idempotente, nunca crea un segundo registro), sólo cambia qué campos toca. */
export async function updateRegistrationHeaderAction(input: FinalizeRegistrationActionInput): Promise<ActionResult> {
  return finalizeRegistrationAction(input);
}

export async function getLessonRegistrationForCalendarLessonAction(calendarLessonId: string) {
  const ctx = await requireAuthenticatedDbContext();
  return getLessonRegistrationDetailByCalendarLessonId(ctx, calendarLessonId);
}
