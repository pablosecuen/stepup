"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { createSingleLesson, cancelCalendarOccurrence, rescheduleCalendarOccurrence, getCalendarLesson, CalendarLessonNotFoundError } from "@/lib/repositories/calendar-lessons";
import { createRecurrenceSeries, setRecurrenceRuleStatus, changeRecurrenceParticipantsFromDate, getRecurrenceRule, RecurrenceRuleNotFoundError } from "@/lib/repositories/recurrence-rules";
import { splitRecurrenceThisAndFuture } from "@/lib/repositories/recurrence-split";
import { getTeacherAvailability, saveTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { listStudents } from "@/lib/repositories/students";
import { evaluateAvailability, type TeacherAvailability } from "@/lib/calendar/availability";
import { findCalendarConflicts, hasBlockingConflict, type ConflictCandidateLesson } from "@/lib/calendar-conflicts";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { generateOccurrences } from "@/lib/calendar/recurrence-engine";
import { getLocalDateKey, localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { mondayOfWeekContaining } from "@/lib/calendar/weekday";
import type { CalendarModality, CalendarLessonType, ActivityKind } from "@/lib/db/database.types";
import type { RecurrenceWeek } from "@/lib/calendar/types";

// Server Actions — Calendario. Nunca reciben `ownerId` del navegador;
// siempre resuelven la sesión real en el servidor. Toda validación de
// conflictos/disponibilidad corre acá (servidor), nunca sólo en el
// navegador.

export interface FormState {
  error?: string;
  values?: NewLessonFormValues;
}

/**
 * "Eco" de lo que la profesora ya había completado en `/calendario/nueva`
 * cuando el servidor rechaza el envío. Next.js remonta el Client Component
 * del formulario en cada ida y vuelta de un Server Action (confirmado:
 * el nodo `<form>` sobrevive, pero todo el estado de React del componente
 * se reinicia) — así que ni los inputs no controlados ni el estado local
 * (`useState`) sobreviven por sí solos. `state` de `useActionState` es la
 * única parte que sí persiste a través de esa transición, así que el
 * servidor devuelve acá los valores enviados para que el cliente los use
 * como fuente real de los campos, en vez de depender del DOM o de un
 * `useState` que se pierde.
 */
export interface NewLessonFormValues {
  participantIds: string[];
  modality: string;
  activityKind: string;
  classTitle: string;
  date: string;
  hour: string;
  minute: string;
  durationMinutes: string;
  startDate: string;
  endDate: string;
  weeksJson: string;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

const TIMEZONE = "America/Argentina/Buenos_Aires";

async function buildConflictCandidates(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, aroundIso: string): Promise<ConflictCandidateLesson[]> {
  const center = new Date(aroundIso);
  const rangeStart = new Date(center.getTime() - 14 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(center.getTime() + 90 * 24 * 60 * 60 * 1000);
  const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd);
  return items.map((item) => ({
    id: item.id,
    start: item.start,
    end: item.end,
    status: item.status,
    isRecurring: item.isRecurring,
    lessonType: item.lessonType,
    overlapAllowed: false,
  }));
}

async function checkConflictsAndAvailability(
  ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>,
  startAt: string,
  endAt: string,
  ignoredLessonId?: string
): Promise<string | null> {
  const [candidates, availability] = await Promise.all([buildConflictCandidates(ctx, startAt), getTeacherAvailability(ctx)]);
  const conflicts = findCalendarConflicts(startAt, endAt, candidates, ignoredLessonId);
  if (hasBlockingConflict(conflicts)) {
    return "El horario elegido se superpone con otra clase ya agendada.";
  }
  try {
    const evaluation = evaluateAvailability(startAt, endAt, availability);
    if (!evaluation.isAvailable) {
      return `Ese horario está bloqueado en tu disponibilidad (${evaluation.label ?? "no disponible"}).`;
    }
  } catch {
    // Rango inválido ya se habría rechazado antes por validación propia del formulario.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Crear clase única
// ---------------------------------------------------------------------------

export async function createSingleLessonAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const studentIds = formData.getAll("participantIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const date = readString(formData, "date");
  const hourRaw = readString(formData, "hour");
  const minuteRaw = readString(formData, "minute");
  const durationRaw = readString(formData, "durationMinutes");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const durationMinutes = Number(durationRaw);
  const modality = readString(formData, "modality") as CalendarModality;
  const activityKind = readString(formData, "activityKind") as ActivityKind;
  const classTitleRaw = readString(formData, "classTitle");
  const classTitle = classTitleRaw.trim() || null;
  const notes = readString(formData, "notes").trim() || null;
  const freedByLessonId = readString(formData, "freedByLessonId").trim() || null;

  const values: NewLessonFormValues = {
    participantIds: studentIds,
    modality,
    activityKind,
    classTitle: classTitleRaw,
    date,
    hour: hourRaw,
    minute: minuteRaw,
    durationMinutes: durationRaw,
    startDate: "",
    endDate: "",
    weeksJson: "",
  };

  if (studentIds.length === 0) return { error: "Elegí al menos un alumno.", values };
  if (!date || Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(durationMinutes) || durationMinutes <= 0) {
    return { error: "Completá fecha, hora y duración.", values };
  }

  try {
    const ctx = await requireAuthenticatedDbContext();
    const students = await listStudents(ctx);
    const selected = studentIds.map((id) => students.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (selected.length !== studentIds.length) return { error: "Alguno de los alumnos elegidos ya no está disponible.", values };
    if (selected.some((s) => s.status === "archivado")) return { error: "No se puede agendar un alumno archivado.", values };

    const startAt = localDateTimeToInstantIso({ date, hour, minute, timeZone: TIMEZONE });
    const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString();

    const conflictMessage = await checkConflictsAndAvailability(ctx, startAt, endAt);
    if (conflictMessage) return { error: conflictMessage, values };

    const primary = selected[0];
    await createSingleLesson(ctx, {
      primaryStudentId: primary.id,
      studentName: primary.name,
      level: primary.levels[0] ?? "",
      lessonType: selected.length > 1 ? "group" : "individual",
      startAt,
      endAt,
      modality,
      classTitle,
      activityKind,
      notes,
      color: modality === "online" ? "#DDEBFF" : modality === "mixta" ? "#F2E8FF" : "#FFE4D2",
      participants: selected.map((s) => ({ studentId: s.id, studentName: s.name, level: s.levels[0] ?? "" })),
      freedByLessonId,
    });
  } catch (error) {
    return { error: friendlyErrorMessage(error), values };
  }

  // redirect() lanza una excepción especial de Next.js — siempre fuera del
  // try/catch de arriba, nunca dentro (si quedara dentro, el catch genérico
  // la atraparía y la mostraría como un error real).
  revalidatePath("/calendario");
  redirect("/calendario");
}

// ---------------------------------------------------------------------------
// Crear serie recurrente
// ---------------------------------------------------------------------------

export async function createRecurrenceSeriesAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const studentIds = formData.getAll("participantIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const startDate = readString(formData, "startDate");
  const endDateRaw = readString(formData, "endDate");
  const endDate = endDateRaw.trim() || null;
  const modality = readString(formData, "modality") as CalendarModality;
  const activityKind = readString(formData, "activityKind") as ActivityKind;
  const classTitleRaw = readString(formData, "classTitle");
  const classTitle = classTitleRaw.trim() || null;
  const weeksJsonRaw = readString(formData, "weeksJson");

  const values: NewLessonFormValues = {
    participantIds: studentIds,
    modality,
    activityKind,
    classTitle: classTitleRaw,
    date: "",
    hour: "",
    minute: "",
    durationMinutes: "",
    startDate,
    endDate: endDateRaw,
    weeksJson: weeksJsonRaw,
  };

  let weeks: RecurrenceWeek[];
  try {
    weeks = JSON.parse(weeksJsonRaw);
  } catch {
    return { error: "El patrón semanal no es válido.", values };
  }
  if (studentIds.length === 0) return { error: "Elegí al menos un alumno.", values };
  if (!startDate) return { error: "La fecha de inicio es obligatoria.", values };
  if (!Array.isArray(weeks) || weeks.length === 0 || !weeks.some((w) => w.sessions.length > 0)) {
    return { error: "Definí al menos un día y horario.", values };
  }

  try {
    const ctx = await requireAuthenticatedDbContext();
    const students = await listStudents(ctx);
    const selected = studentIds.map((id) => students.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (selected.length !== studentIds.length) return { error: "Alguno de los alumnos elegidos ya no está disponible.", values };
    if (selected.some((s) => s.status === "archivado")) return { error: "No se puede agendar un alumno archivado.", values };

    // El lunes real de la semana de `startDate` — nunca otro día (regla del motor de recurrencia).
    // La primera ocurrencia REAL sigue cayendo en `startDate` (o después, según el patrón
    // elegido) — `mondayOfWeekContaining` sólo ancla el registro técnico de la regla, nunca
    // mueve la fecha visible/facturable. Ver comentario de la función.
    const monday = mondayOfWeekContaining(startDate);

    const created = await createRecurrenceSeries(ctx, {
      primaryStudentId: selected[0]?.id ?? null,
      ruleType: weeks.length > 1 ? "custom" : "weekly",
      cycleLengthWeeks: weeks.length as 1 | 2 | 3 | 4,
      weeks,
      modality,
      timezone: TIMEZONE,
      startDate: monday,
      endDate,
      classTitle,
      activityKind,
      participantIds: selected.map((s) => s.id),
    });

    // Conflicto/disponibilidad sobre las próximas ocurrencias reales — nunca
    // un horizonte infinito, mismo criterio que el móvil
    // (DEFAULT_RECURRENCE_HORIZON_DAYS).
    const engineRule = {
      recurrenceId: created.id,
      studentId: created.primaryStudentId,
      participantIds: created.participantIds,
      cycleLengthWeeks: created.cycleLengthWeeks,
      weeks: created.weeks,
      modality: created.modality,
      timezone: created.timezone,
      startDate: created.startDate,
      endDate: created.endDate,
      status: created.status,
      classTitle: created.classTitle,
      activityKind: created.activityKind,
    };
    const horizonStart = new Date(`${monday}T00:00:00.000Z`);
    const horizonEnd = new Date(horizonStart.getTime() + 60 * 24 * 60 * 60 * 1000);
    const occurrences = generateOccurrences(engineRule, horizonStart, horizonEnd);
    for (const occurrence of occurrences.slice(0, 8)) {
      const conflictMessage = await checkConflictsAndAvailability(ctx, occurrence.start, occurrence.end);
      if (conflictMessage) {
        // La serie ya quedó creada (la profesora la ve y decide qué hacer) —
        // nunca se revierte en silencio; se informa el conflicto real
        // encontrado para que lo resuelva desde "Series"/"Editar futuras".
        // Nunca se re-popula el formulario acá a propósito: la serie ya
        // existe, reenviar el mismo formulario crearía una segunda serie
        // duplicada. La profesora la resuelve desde "Series"/"Editar futuras".
        return { error: `Serie creada, pero hay un conflicto real: ${conflictMessage}` };
      }
    }
  } catch (error) {
    return { error: friendlyErrorMessage(error), values };
  }

  // Sólo se llega hasta acá si no hubo conflicto (el `return` con error
  // dentro del for de arriba corta el flujo antes) — redirect() siempre
  // fuera del try/catch, nunca dentro.
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  redirect("/calendario");
}

// ---------------------------------------------------------------------------
// Cancelar / reprogramar una ocurrencia
// ---------------------------------------------------------------------------

export interface CancelOccurrenceActionInput {
  lessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  recurrenceIndex: number | null;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: "individual" | "group";
  startAt: string;
  endAt: string;
  modality: string;
  classTitle: string | null;
  activityKind: string;
}

export async function cancelOccurrenceAction(input: CancelOccurrenceActionInput): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await cancelCalendarOccurrence(ctx, {
      ...input,
      color: input.modality === "online" ? "#DDEBFF" : input.modality === "mixta" ? "#F2E8FF" : "#FFE4D2",
    });
  } catch (error) {
    if (error instanceof CalendarLessonNotFoundError) return { error: "Clase no encontrada." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  return {};
}

export interface RescheduleOccurrenceActionInput {
  recurrenceId: string | null;
  occurrenceKey: string | null;
  originalLessonId: string | null;
  originalStartAt: string;
  primaryStudentId: string;
  participantIds: string[];
  lessonType: "individual" | "group";
  modality: string;
  classTitle: string | null;
  activityKind: string;
  newDate: string;
  newHour: number;
  newMinute: number;
  durationMinutes: number;
}

export async function rescheduleOccurrenceAction(input: RescheduleOccurrenceActionInput): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const newStartAt = localDateTimeToInstantIso({ date: input.newDate, hour: input.newHour, minute: input.newMinute, timeZone: TIMEZONE });
    const newEndAt = new Date(new Date(newStartAt).getTime() + input.durationMinutes * 60_000).toISOString();

    const conflictMessage = await checkConflictsAndAvailability(ctx, newStartAt, newEndAt, input.originalLessonId ?? undefined);
    if (conflictMessage) return { error: conflictMessage };

    // Los nombres/niveles nunca se toman del cliente — se resuelven acá
    // contra los alumnos reales del profesor, mismo criterio que crear una
    // clase nueva (evita nombres vacíos o falsificados en la clase reprogramada).
    const students = await listStudents(ctx);
    const studentsById = new Map(students.map((s) => [s.id, s]));
    const primary = studentsById.get(input.primaryStudentId);
    if (!primary) return { error: "El alumno principal ya no está disponible." };
    const participants = input.participantIds.map((id) => studentsById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (participants.length !== input.participantIds.length) return { error: "Alguno de los alumnos ya no está disponible." };

    await rescheduleCalendarOccurrence(ctx, {
      recurrenceId: input.recurrenceId,
      occurrenceKey: input.occurrenceKey,
      originalLessonId: input.originalLessonId,
      originalStartAt: input.originalStartAt,
      primaryStudentId: input.primaryStudentId,
      studentName: primary.name,
      level: primary.levels[0] ?? "",
      lessonType: input.lessonType,
      newStartAt,
      newEndAt,
      modality: input.modality,
      classTitle: input.classTitle,
      activityKind: input.activityKind,
      color: input.modality === "online" ? "#DDEBFF" : input.modality === "mixta" ? "#F2E8FF" : "#FFE4D2",
      participants: participants.map((s) => ({ studentId: s.id, studentName: s.name, level: s.levels[0] ?? "" })),
    });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  return {};
}

// ---------------------------------------------------------------------------
// Series: pausar / reanudar / finalizar / editar futuras (split)
// ---------------------------------------------------------------------------

export async function setRecurrenceStatusAction(ruleId: string, status: "active" | "paused" | "ended"): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await setRecurrenceRuleStatus(ctx, ruleId, status);
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "Serie no encontrada." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  return {};
}

export interface EditFutureActionInput {
  originalRecurrenceId: string;
  effectiveDate: string;
  weeksJson: string;
  modality?: string;
  classTitle?: string | null;
  activityKind?: "class" | "training";
  participantIds: string[];
}

export async function editFutureRecurrenceAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const originalRecurrenceId = readString(formData, "originalRecurrenceId");
  const effectiveDate = readString(formData, "effectiveDate");
  const participantIds = formData.getAll("participantIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  let weeks: RecurrenceWeek[];
  try {
    weeks = JSON.parse(readString(formData, "weeksJson"));
  } catch {
    return { error: "El patrón semanal no es válido." };
  }
  if (!effectiveDate) return { error: "Elegí la fecha efectiva." };
  if (participantIds.length === 0) return { error: "Elegí al menos un alumno." };

  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDate = getLocalDateKey(new Date().toISOString(), TIMEZONE);
    await splitRecurrenceThisAndFuture(ctx, {
      originalRecurrenceId,
      effectiveDate,
      todayDate,
      ruleType: weeks.length > 1 ? "custom" : "weekly",
      cycleLengthWeeks: weeks.length as 1 | 2 | 3 | 4,
      weeks,
      participantIds,
    });
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  return {};
}

export interface ChangeParticipantsActionInput {
  ruleId: string;
  effectiveDate: string;
  newParticipantIds: string[];
}

/**
 * Cambiar participantes de una serie desde una fecha — acción SEPARADA de
 * "Editar futuras" (que sólo cambia el patrón día/hora y crea una serie
 * sucesora). Nunca crea una serie nueva: muta el roster de la MISMA regla,
 * congelando primero con el roster viejo cualquier ocurrencia virtual entre
 * ahora y la fecha efectiva (ver `changeRecurrenceParticipantsFromDate`).
 */
export async function changeParticipantsAction(input: ChangeParticipantsActionInput): Promise<FormState> {
  if (input.newParticipantIds.length === 0) return { error: "Elegí al menos un alumno." };
  if (!input.effectiveDate) return { error: "Elegí la fecha efectiva." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const now = new Date();
    const effectiveDateIso = localDateTimeToInstantIso({ date: input.effectiveDate, hour: 0, minute: 0, timeZone: TIMEZONE });
    await changeRecurrenceParticipantsFromDate(ctx, { ruleId: input.ruleId, effectiveDateIso, now, newParticipantIds: input.newParticipantIds });
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "Serie no encontrada." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  return {};
}

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

export async function saveAvailabilityAction(availability: TeacherAvailability): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await saveTeacherAvailability(ctx, availability);
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario/disponibilidad");
  return {};
}

export async function getRecurrenceRuleAction(ruleId: string) {
  const ctx = await requireAuthenticatedDbContext();
  return getRecurrenceRule(ctx, ruleId);
}

export async function getCalendarLessonAction(lessonId: string) {
  const ctx = await requireAuthenticatedDbContext();
  return getCalendarLesson(ctx, lessonId);
}
