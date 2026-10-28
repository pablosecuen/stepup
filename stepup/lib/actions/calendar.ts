"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { planEndSeriesFromDate } from "@/lib/calendar/end-series";
import { createSingleLesson, findCalendarLessonIdByOperationId, cancelCalendarOccurrence, rescheduleCalendarOccurrence, getCalendarLesson, CalendarLessonNotFoundError, editCalendarLesson, restoreCalendarOccurrence, deleteCancelledCalendarLesson, type EditCalendarLessonInput } from "@/lib/repositories/calendar-lessons";
import { endRecurrenceSeriesFromDate, createRecurrenceSeries, setRecurrenceRuleStatus, changeRecurrenceParticipantsFromDate, getRecurrenceRule, listRecurrenceRules, editRecurrenceClassTitle, RecurrenceRuleNotFoundError } from "@/lib/repositories/recurrence-rules";
import { listPredecessorsRunningFrom, resolveEditableSegment } from "@/lib/calendar/lineage";
import { splitRecurrenceThisAndFuture, swapRecurrencePatterns } from "@/lib/repositories/recurrence-split";
import { describeWeeks, planSeriesSwap } from "@/lib/calendar/swap";
import { affectedFutureLessons, type AffectedLessons } from "@/lib/calendar/affected-lessons";
import { listCalendarLessonsForRecurrence } from "@/lib/repositories/calendar-lessons";
import { getTeacherAvailability, saveTeacherAvailability } from "@/lib/repositories/teacher-availability";
import { listStudents } from "@/lib/repositories/students";
import { evaluateAvailability, type TeacherAvailability } from "@/lib/calendar/availability";
import { findCalendarConflicts, hasBlockingConflict, type ConflictCandidateLesson } from "@/lib/calendar-conflicts";
import { loadCalendarViewForRange } from "@/lib/calendar/view";
import { toConflictCandidates } from "@/lib/calendar/conflict-candidates";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { describeFutureConflicts, findFutureRecurrenceConflicts, futureValidationRange, occurrencesAsCandidates, FUTURE_VALIDATION_HORIZON_DAYS } from "@/lib/calendar/future-conflicts";
import { formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import type { RecurrenceRuleForEngine } from "@/lib/calendar/types";
import { addDaysToDateKey } from "@/lib/calendar/timezone";
import { formatCivilDate } from "@/lib/format/date-format";
import { generateOccurrences } from "@/lib/calendar/recurrence-engine";
import { getLocalDateKey, localDateTimeToInstantIso } from "@/lib/calendar/timezone";
import { mondayOfWeekContaining } from "@/lib/calendar/weekday";
import { resolveExplicitPrimaryStudentId } from "@/lib/calendar/primary-selection";
import { MISSING_OPERATION_ID_MESSAGE, parseOperationId } from "@/lib/calendar/operation-id";
import type { CalendarModality, CalendarLessonType, ActivityKind } from "@/lib/db/database.types";
import type { RecurrenceWeek } from "@/lib/calendar/types";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { CLASS_TITLE_MAX_LENGTH, applyDurationToWeeks, computeEndFromDuration, isValidDurationOption, normalizeClassTitle, sessionSlotForInstant, type LessonEditScope, type SessionSlot } from "@/lib/calendar/lesson-edit";

// Server Actions — Calendario. Nunca reciben `ownerId` del navegador;
// siempre resuelven la sesión real en el servidor. Toda validación de
// conflictos/disponibilidad corre acá (servidor), nunca sólo en el
// navegador.

export interface FormState {
  error?: string;
  /**
   * El error es un choque de horario que la profesora puede aceptar a propósito (`allowOverlap`): la pantalla ofrece «Guardar igual». Así dos series
   * pueden intercambiar horarios en dos pasos (cada paso avisa) en vez de quedar bloqueadas una contra la otra.
   */
  conflict?: boolean;
  /** El cambio reemplazaría cambios ya programados de la serie (tramos posteriores): se muestran y hay que confirmarlos (`confirmReplace`). */
  replaces?: boolean;
  values?: NewLessonFormValues;
  /**
   * Señal de creación canónica (clase única / serie): el servidor confirma que la
   * operación con esta clave existe, así que el cliente recién ahora puede rotar la
   * clave del borrador. Nunca se usa un `redirect()` del servidor en estos caminos —
   * el cliente navega después de rotar la clave (ver `new-lesson-form.tsx`).
   */
  createdOperationId?: string;
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
  primaryStudentId: string;
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
  /** Qué se estaba creando (para volver al mismo modo tras un error de validación). */
  mode: "single" | "series";
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function friendlyErrorMessage(error: unknown): string {
  return actionErrorMessage("calendar", error);
}

const TIMEZONE = "America/Argentina/Buenos_Aires";

async function buildConflictCandidates(
  ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>,
  aroundIso: string,
  excludeRecurrenceId?: string
): Promise<ConflictCandidateLesson[]> {
  const center = new Date(aroundIso);
  const rangeStart = new Date(center.getTime() - 14 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(center.getTime() + 90 * 24 * 60 * 60 * 1000);
  const items = await loadCalendarViewForRange(ctx, rangeStart, rangeEnd, undefined, { includeTestData: true });
  return toConflictCandidates(items, { excludeRecurrenceId });
}

/**
 * «Editar futuras»: el nuevo patrón se valida ANTES de guardar contra el resto del calendario (clases sueltas, otras series y la
 * disponibilidad), igual que la app original. Devuelve el mensaje para la profesora o null si no choca con nada.
 */
async function checkFuturePatternConflicts(
  ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>,
  input: { original: Awaited<ReturnType<typeof getRecurrenceRule>> & object; replacedRuleIds: string[]; successorEndDate: string | null; effectiveDate: string; todayDate: string; weeks: RecurrenceWeek[]; participantIds: string[] }
): Promise<string | null> {
  const { original, effectiveDate, todayDate, weeks } = input;
  const successor = {
    recurrenceId: "nuevo-patron",
    studentId: original.primaryStudentId,
    participantIds: input.participantIds,
    cycleLengthWeeks: weeks.length,
    weeks,
    modality: original.modality,
    timezone: original.timezone,
    startDate: mondayOfWeekContaining(effectiveDate),
    endDate: input.successorEndDate,
    status: "active" as const,
    classTitle: original.classTitle,
    activityKind: original.activityKind,
  };
  const rangeStart = new Date(localDateTimeToInstantIso({ date: effectiveDate, hour: 0, minute: 0, timeZone: original.timezone }));
  const horizonBase = effectiveDate > todayDate ? effectiveDate : todayDate;
  const rangeEnd = new Date(localDateTimeToInstantIso({ date: addDaysToDateKey(horizonBase, FUTURE_VALIDATION_HORIZON_DAYS + 1), hour: 0, minute: 0, timeZone: original.timezone }));
  const [items, availability, hiddenStudentIds] = await Promise.all([loadCalendarViewForRange(ctx, rangeStart, rangeEnd, undefined, { includeTestData: true }), getTeacherAvailability(ctx), loadExcludedStudentIds(ctx)]);
  // La serie que se reemplaza deja de generar clases desde la fecha efectiva: no cuenta como ocupación. Los datos de prueba ocultos SÍ cuentan (el aviso lo aclara).
  const candidates = toConflictCandidates(items, { excludeRecurrenceIds: input.replacedRuleIds, hiddenStudentIds });
  const conflicts = findFutureRecurrenceConflicts({ successor, effectiveDate, todayDate, candidates, availability });
  return conflicts.length > 0 ? describeFutureConflicts(conflicts, original.timezone) : null;
}

/** Lo que un cambio «desde una fecha» reemplaza o deja registrado: tramos posteriores ya programados, clases reprogramadas y canceladas. */
function describeReplacements(
  superseded: { weeks: RecurrenceWeek[]; effectiveFromDate: string | null; startDate: string }[],
  affected: AffectedLessons
): string {
  const parts: string[] = [];
  if (superseded.length > 0) {
    const list = superseded.map((rule) => `${describeWeeks(rule.weeks)} desde el ${formatCivilDate(rule.effectiveFromDate ?? rule.startDate)}`).join("; ");
    parts.push(`Este cambio reemplaza ${superseded.length === 1 ? "un cambio ya programado" : `${superseded.length} cambios ya programados`} de la serie: ${list}.`);
  }
  if (affected.rescheduled.length > 0) parts.push(`Se reemplazan por el nuevo patrón ${affected.rescheduled.length === 1 ? "esta clase reprogramada" : "estas clases reprogramadas"}: ${affected.rescheduled.join("; ")}.`);
  if (affected.cancelled.length > 0) parts.push(`Siguen registradas como canceladas: ${affected.cancelled.join("; ")}.`);
  return `${parts.join(" ")} Todavía no se guardó nada.`;
}

/** Clases reprogramadas y canceladas de los tramos que reemplaza un cambio, desde la fecha efectiva. */
async function loadAffectedLessons(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, ruleIds: string[], effectiveDate: string, timeZone: string): Promise<AffectedLessons> {
  const lessons = (await Promise.all(ruleIds.map((ruleId) => listCalendarLessonsForRecurrence(ctx, ruleId)))).flat();
  return affectedFutureLessons(lessons, effectiveDate, timeZone);
}

async function checkConflictsAndAvailability(
  ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>,
  startAt: string,
  endAt: string,
  ignoredLessonId?: string,
  excludeRecurrenceId?: string,
  allowBlocked=false,
  allowOverlap=false
): Promise<string | null> {
  const [candidates, availability] = await Promise.all([buildConflictCandidates(ctx, startAt, excludeRecurrenceId), getTeacherAvailability(ctx)]);
  const conflicts = findCalendarConflicts(startAt, endAt, candidates, ignoredLessonId);
  if (hasBlockingConflict(conflicts)&&!allowOverlap) {
    return "El horario elegido se superpone con otra clase ya agendada.";
  }
  try {
    const evaluation = evaluateAvailability(startAt, endAt, availability);
    if (!evaluation.isAvailable && !allowBlocked) {
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
  const primaryStudentIdRaw = readString(formData, "primaryStudentId");
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
  const operationId = parseOperationId(readString(formData, "operationId"));

  const values: NewLessonFormValues = {
    participantIds: studentIds,
    primaryStudentId: primaryStudentIdRaw,
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
    mode: "single",
  };

  if (!operationId) return { error: MISSING_OPERATION_ID_MESSAGE, values };
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

    const primaryResult = resolveExplicitPrimaryStudentId(
      selected.map((s) => s.id),
      primaryStudentIdRaw || null
    );
    if ("error" in primaryResult) return { error: primaryResult.error, values };

    const startAt = localDateTimeToInstantIso({ date, hour, minute, timeZone: TIMEZONE });
    const endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60_000).toISOString();

    // Reintento tras una respuesta perdida: la clase ya existe, así que NO se re-evalúa el
    // solapamiento (chocaría con la clase que esta misma operación creó). La unicidad real la
    // decide el índice UNIQUE parcial dentro de la RPC — esta consulta es sólo un atajo de UX.
    // Si hay conflicto, se re-consulta una vez: una operación simultánea con la misma clave
    // pudo crear la clase entre medio.
    if (!(await findCalendarLessonIdByOperationId(ctx, operationId))) {
      const conflictMessage = await checkConflictsAndAvailability(ctx, startAt, endAt,undefined,undefined,readString(formData,'allowBlocked')==='true',readString(formData,'allowOverlap')==='true');
      if (conflictMessage && !(await findCalendarLessonIdByOperationId(ctx, operationId))) return { error: conflictMessage, values };
    }

    const primary = selected.find((s) => s.id === primaryResult.primaryStudentId)!;
    await createSingleLesson(ctx, {
      operationId,
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

  revalidatePath("/calendario");
  return { createdOperationId: operationId };
}

// ---------------------------------------------------------------------------
// Crear serie recurrente
// ---------------------------------------------------------------------------

export async function createRecurrenceSeriesAction(_prevState: FormState, formData: FormData): Promise<FormState> {
  const studentIds = formData.getAll("participantIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const primaryStudentIdRaw = readString(formData, "primaryStudentId");
  const startDate = readString(formData, "startDate");
  const endDateRaw = readString(formData, "endDate");
  const endDate = endDateRaw.trim() || null;
  const modality = readString(formData, "modality") as CalendarModality;
  const activityKind = readString(formData, "activityKind") as ActivityKind;
  const classTitleRaw = readString(formData, "classTitle");
  const classTitle = classTitleRaw.trim() || null;
  const weeksJsonRaw = readString(formData, "weeksJson");
  const operationId = parseOperationId(readString(formData, "operationId"));

  const values: NewLessonFormValues = {
    participantIds: studentIds,
    primaryStudentId: primaryStudentIdRaw,
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
    mode: "series",
  };

  let weeks: RecurrenceWeek[];
  try {
    weeks = JSON.parse(weeksJsonRaw);
  } catch {
    return { error: "El patrón semanal no es válido.", values };
  }
  if (!operationId) return { error: MISSING_OPERATION_ID_MESSAGE, values };
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

    const primaryResult = resolveExplicitPrimaryStudentId(
      selected.map((s) => s.id),
      primaryStudentIdRaw || null
    );
    if ("error" in primaryResult) return { error: primaryResult.error, values };

    // El lunes real de la semana de `startDate` — nunca otro día (regla del motor de recurrencia).
    // La primera ocurrencia REAL sigue cayendo en `startDate` (o después, según el patrón
    // elegido) — `mondayOfWeekContaining` sólo ancla el registro técnico de la regla, nunca
    // mueve la fecha visible/facturable. Ver comentario de la función.
    const monday = mondayOfWeekContaining(startDate);

    const {data:previousSeries,error:previousSeriesError}=await ctx.supabase.from('recurrence_rules').select('id').eq('owner_id',ctx.ownerId).eq('operation_id',operationId).maybeSingle();
    if(previousSeriesError)throw previousSeriesError;
    if(previousSeries){revalidatePath('/calendario');revalidatePath('/calendario/series');return {createdOperationId:operationId};}

    const checkStart=localDateTimeToInstantIso({date:startDate,hour:0,minute:0,timeZone:TIMEZONE});
    const checkEnd=new Date(Date.parse(checkStart)+FUTURE_VALIDATION_HORIZON_DAYS*86400000);
    const [otherItems,availability]=await Promise.all([loadCalendarViewForRange(ctx,new Date(checkStart),checkEnd,undefined,{includeTestData:true}),getTeacherAvailability(ctx)]);
    const planned=generateOccurrences({recurrenceId:'new-series',studentId:primaryResult.primaryStudentId,participantIds:studentIds,cycleLengthWeeks:weeks.length,weeks,modality,timezone:TIMEZONE,startDate:monday,endDate:endDate||null,status:'active',classTitle,activityKind},new Date(checkStart),checkEnd);
    for(const occurrence of planned){
      const evaluation=evaluateAvailability(occurrence.start,occurrence.end,availability);
      if(!evaluation.isAvailable&&readString(formData,'allowBlocked')!=='true')return {error:`Ese horario está bloqueado en tu disponibilidad (${evaluation.label??'no disponible'}).`,values};
      if(otherItems.some(item=>item.status!=='cancelled'&&item.occupiesSlot!==false&&item.start<occurrence.end&&item.end>occurrence.start)&&readString(formData,'allowOverlap')!=='true')return {error:'El patrón se superpone con otra clase ya agendada.',values};
    }

    const created = await createRecurrenceSeries(ctx, {
      operationId,
      primaryStudentId: primaryResult.primaryStudentId,
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
      // Se excluye la PROPIA serie recién creada: la vista ya incluye sus ocurrencias y se
      // solaparían consigo mismas (falso conflicto en toda creación). Cualquier otra serie o
      // clase suelta sigue detectándose.
      const conflictMessage = await checkConflictsAndAvailability(ctx, occurrence.start, occurrence.end, undefined, created.id,readString(formData,'allowBlocked')==='true',readString(formData,'allowOverlap')==='true');
      if (conflictMessage) {
        // La serie ya quedó creada (la profesora la ve y decide qué hacer) —
        // nunca se revierte en silencio; se informa el conflicto real
        // encontrado para que lo resuelva desde "Series"/"Editar futuras".
        // Nunca se re-popula el formulario acá a propósito: la serie ya
        // existe. `createdOperationId` hace que el cliente rote la clave de
        // idempotencia: reenviar con la clave VIEJA devolvería esta misma serie
        // (nunca una segunda), y un envío nuevo sí crea una serie nueva.
        // La profesora la resuelve desde "Series"/"Editar futuras".
        return { error: `Serie creada, pero hay un conflicto real: ${conflictMessage}`, createdOperationId: operationId };
      }
    }
  } catch (error) {
    return { error: friendlyErrorMessage(error), values };
  }

  // Sólo se llega hasta acá si no hubo conflicto (el `return` con error
  // dentro del for de arriba corta el flujo antes). Sin `redirect()`: el cliente
  // navega después de rotar la clave de idempotencia (ver `new-lesson-form.tsx`).
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  return { createdOperationId: operationId };
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

/**
 * «Esta y todas las series»: quita LA serie elegida (su tramo vigente y los anteriores que todavía generan clases) desde HOY. Como la app original («Eliminar esta y todas las siguientes»): lo
 * anterior a hoy se conserva (sólo se le pone fecha de fin) y nunca se toca otra serie de la cuenta. No borra nada: clases dictadas, registros, cobros, pagos y adjuntos quedan. Las clases ya creadas
 * de la serie, futuras, programadas y sin registro, pasan a canceladas para que no queden sueltas en la agenda. Todo en UNA transacción (RPC `end_recurrence_series_from_date`): o se hace todo o no cambia nada.
 */
export async function endSeriesFromTodayAction(ruleId: string): Promise<FormState & { removedFrom?: string }> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDate = getLocalDateKey(new Date().toISOString(), TIMEZONE);
    const rules = (await listRecurrenceRules(ctx)).map((rule) => ({ ...rule, recurrenceId: rule.id }));
    const plan = planEndSeriesFromDate(rules, ruleId, todayDate);
    if (!plan) return { error: "Esta serie ya estaba terminada." };
    // Una sola transacción: cortes, cierres y cancelación de las clases futuras sin registro, o nada. Repetir no cambia nada.
    await endRecurrenceSeriesFromDate(ctx, { plan, effectiveDate: todayDate, timezone: TIMEZONE });
    revalidatePath("/calendario");
    revalidatePath("/calendario/series");
    return { removedFrom: todayDate };
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "La serie cambió o ya no existe. No se cambió nada: volvé a abrir la pantalla y reintentá." };
    return { error: friendlyErrorMessage(error) };
  }
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
  // Cambios que NO tocan el patrón (nombre, duración de una sesión): el patrón y los alumnos son los del tramo que rige en esa fecha (`keepPattern`).
  const keepPattern = readString(formData, "keepPattern") === "true";
  let participantIds = formData.getAll("participantIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  let weeks: RecurrenceWeek[] = [];
  if (!keepPattern) {
    try {
      weeks = JSON.parse(readString(formData, "weeksJson"));
    } catch {
      return { error: "El patrón semanal no es válido." };
    }
  }
  const titleChange = formData.has("classTitle") ? normalizeClassTitle(readString(formData, "classTitle")) : undefined;
  if (typeof titleChange === "string" && titleChange.length > CLASS_TITLE_MAX_LENGTH) return { error: `El nombre no puede superar los ${CLASS_TITLE_MAX_LENGTH} caracteres.` };
  let durationPatch: { slot: SessionSlot; minutes: number } | null = null;
  if (keepPattern && formData.has("durationPatchJson")) {
    try {
      const parsed = JSON.parse(readString(formData, "durationPatchJson")) as { weekday: number; hour: number; minute: number; minutes: number };
      if (![parsed.weekday, parsed.hour, parsed.minute, parsed.minutes].every(Number.isInteger) || !isValidDurationOption(parsed.minutes)) throw new Error("duración");
      durationPatch = { slot: { weekday: parsed.weekday, hour: parsed.hour, minute: parsed.minute }, minutes: parsed.minutes };
    } catch {
      return { error: "La duración elegida no es válida." };
    }
  }
  if (!effectiveDate) return { error: "Elegí la fecha efectiva." };
  if (!keepPattern && participantIds.length === 0) return { error: "Elegí al menos un alumno." };

  try {
    const ctx = await requireAuthenticatedDbContext();
    const todayDate = getLocalDateKey(new Date().toISOString(), TIMEZONE);

    // "Editar futuras" nunca deja cambiar el roster desde esta pantalla
    // (eso es "Modificar participantes", acción separada) — el principal
    // real de la serie se resuelve siempre del lado del servidor, contra
    // la regla actual, nunca se recibe del cliente ni se infiere de
    // `participantIds` (que acá siempre es el roster viejo sin cambios).
    let currentRule = await getRecurrenceRule(ctx, originalRecurrenceId);
    if (!currentRule) return { error: "Serie no encontrada." };
    if (keepPattern) participantIds = currentRule.participantIds;
    if (!currentRule.primaryStudentId || !participantIds.includes(currentRule.primaryStudentId)) {
      return { error: "El alumno principal de la serie ya no forma parte del grupo — usá \"Modificar participantes\" primero." };
    }

    // La fecha puede caer ANTES del inicio de la serie vigente (típico tras un cambio mal fechado): el patrón de esa fecha lo da el tramo
    // anterior que la cubre. Se corta ESE tramo en la fecha, la sucesora toma el fin de la vigente y las vigentes posteriores se
    // finalizan (el patrón nuevo las reemplaza). Antes se rechazaba y no había forma de corregir «desde hoy».
    const allRules = (await listRecurrenceRules(ctx)).map((rule) => ({ ...rule, recurrenceId: rule.id }));
    const segment = resolveEditableSegment(allRules, originalRecurrenceId, effectiveDate);
    if (!segment) {
      return { error: `Ningún tramo de esta serie rige el ${formatCivilDate(effectiveDate)} (empieza el ${formatCivilDate(currentRule.startDate)}). Elegí una fecha dentro de la serie.` };
    }
    const target = segment.target;
    if (keepPattern) {
      // El tramo que rige en la fecha puede ser otro que el de la clase tocada: sus alumnos, su principal y su patrón son los que continúan.
      const targetRule = target.id === currentRule.id ? currentRule : await getRecurrenceRule(ctx, target.id);
      if (!targetRule || !targetRule.primaryStudentId) return { error: "Serie no encontrada." };
      currentRule = targetRule;
      participantIds = targetRule.participantIds;
      weeks = targetRule.weeks;
      if (durationPatch) {
        const patched = applyDurationToWeeks(weeks, durationPatch.slot, durationPatch.minutes);
        if (patched.matched === 0) return { error: "No se encontró el horario de esta clase en el patrón de la serie: no se cambió nada." };
        weeks = patched.weeks;
      }
    }
    const primaryStudentId = currentRule.primaryStudentId;
    if (!primaryStudentId) return { error: "Serie no encontrada." };
    const replacedRuleIds = [target.id, ...segment.superseded.map((rule) => rule.id)];
    const successorEndDate = segment.superseded.length > 0 ? currentRule.endDate : target.endDate;

    // Nada se finaliza en silencio: si el cambio reemplaza cambios futuros ya programados (tramos posteriores a la fecha), se muestran y la
    // profesora los confirma. La finalización de esos tramos va en la MISMA transacción que el corte.
    const affected = await loadAffectedLessons(ctx, replacedRuleIds, effectiveDate, target.timezone);
    if ((segment.superseded.length > 0 || affected.rescheduled.length > 0) && readString(formData, "confirmReplace") !== "true") {
      return { error: describeReplacements(segment.superseded, affected), replaces: true };
    }

    // Igual que la app original: el nuevo horario no puede superponerse con otra clase ni caer en un horario bloqueado.
    // Se valida ANTES de guardar; si choca no se escribe nada.
    // La profesora puede aceptar el choque a propósito (`allowOverlap`, tras ver el aviso): nunca queda un conflicto en silencio.
    const allowOverlap = readString(formData, "allowOverlap") === "true";
    const patternUnchanged = keepPattern && !durationPatch;
    if (!allowOverlap && !patternUnchanged) {
      const conflictMessage = await checkFuturePatternConflicts(ctx, { original: currentRule, replacedRuleIds, successorEndDate, effectiveDate, todayDate, weeks, participantIds });
      if (conflictMessage) return { error: conflictMessage, conflict: true };
    }

    await splitRecurrenceThisAndFuture(ctx, {
      originalRecurrenceId: target.id,
      effectiveDate,
      todayDate,
      ruleType: weeks.length > 1 ? "custom" : "weekly",
      cycleLengthWeeks: weeks.length as 1 | 2 | 3 | 4,
      weeks,
      participantIds,
      primaryStudentId,
      ...(titleChange !== undefined ? { classTitle: titleChange ?? "" } : {}),
      successorEndDate,
      // Los tramos posteriores al de la fecha ya no generan clases: los reemplaza la sucesora (mismo RPC, misma transacción).
      endRuleIds: segment.superseded.map((rule) => rule.id),
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
  /** Elegido explícitamente por la profesora para el roster NUEVO — nunca inferido del orden de `newParticipantIds` (Fase 10, 20261001140000). */
  primaryStudentId: string | null;
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

  const primaryResult = resolveExplicitPrimaryStudentId(input.newParticipantIds, input.primaryStudentId);
  if ("error" in primaryResult) return { error: primaryResult.error };

  try {
    const ctx = await requireAuthenticatedDbContext();
    const now = new Date();
    const effectiveDateIso = localDateTimeToInstantIso({ date: input.effectiveDate, hour: 0, minute: 0, timeZone: TIMEZONE });
    // El cambio rige `desde una fecha` para TODA la serie: también para los tramos anteriores que siguen generando clases desde esa
    // fecha (la serie vigente puede ser la sucesora de otra que todavía llega hasta su inicio). Primero los anteriores y al final la
    // vigente: si algo falla a mitad, reintentar es seguro (reemplazar el grupo por el mismo grupo no cambia nada más).
    const allRules = await listRecurrenceRules(ctx);
    const predecessors = listPredecessorsRunningFrom(
      allRules.map((rule) => ({ ...rule, recurrenceId: rule.id })),
      input.ruleId,
      input.effectiveDate
    );
    for (const predecessor of predecessors) {
      await changeRecurrenceParticipantsFromDate(ctx, {
        ruleId: predecessor.id,
        effectiveDateIso,
        now,
        newParticipantIds: input.newParticipantIds,
        newPrimaryStudentId: primaryResult.primaryStudentId,
      });
    }
    await changeRecurrenceParticipantsFromDate(ctx, {
      ruleId: input.ruleId,
      effectiveDateIso,
      now,
      newParticipantIds: input.newParticipantIds,
      newPrimaryStudentId: primaryResult.primaryStudentId,
    });
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "Serie no encontrada." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  return {};
}

// ---------------------------------------------------------------------------
// Intercambio de horarios entre dos series
// ---------------------------------------------------------------------------

export interface SeriesSwapInput {
  seriesAId: string;
  seriesBId: string;
  effectiveDate: string;
}

export interface SwapPreviewSide {
  seriesId: string;
  label: string;
  before: string;
  after: string;
  /** «viernes, 23 de octubre, 19:00». */
  firstClass: string | null;
  /** Cambios ya programados de esa serie que el intercambio reemplaza (se muestran antes de confirmar). */
  replaces: string[];
  /** Clases reprogramadas que el nuevo patrón reemplaza, y canceladas que siguen registradas como tales. */
  rescheduledReplaced: string[];
  cancelledKept: string[];
}

export interface SeriesSwapResult {
  error?: string;
  preview?: { effectiveDate: string; sides: [SwapPreviewSide, SwapPreviewSide] };
}

/**
 * Arma el intercambio y valida el RESULTADO FINAL de las dos series contra el resto del calendario (terceras clases y disponibilidad) y entre sí:
 * el choque entre ambas HOY es justamente lo que el intercambio resuelve, pero ninguna de las dos puede quedar superpuesta con una tercera.
 * No hay forma de ignorar un conflicto. Devuelve el error o la vista previa y las entradas del RPC.
 */
async function prepareSeriesSwap(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, input: SeriesSwapInput) {
  const now = new Date();
  const nowIso = now.toISOString();
  const todayDate = getLocalDateKey(nowIso, TIMEZONE);
  const [records, students] = await Promise.all([listRecurrenceRules(ctx), listStudents(ctx)]);
  const rules = records.map((rule) => ({ ...rule, recurrenceId: rule.id }));
  const plan = planSeriesSwap(rules, input.seriesAId, input.seriesBId, input.effectiveDate, todayDate, nowIso);
  if (!plan.ok) return { error: plan.error } as const;

  const { a, b } = plan;
  const timeZone = a.head.timezone;
  const studentName = (id: string) => students.find((student) => student.id === id)?.name ?? "Alumno";
  const labelOf = (head: typeof a.head) => head.classTitle || head.participantIds.map(studentName).join(", ") || "Serie";
  const successorOf = (side: typeof a): RecurrenceRuleForEngine => ({
    recurrenceId: `nuevo-${side.head.id}`,
    studentId: side.head.primaryStudentId,
    participantIds: side.head.participantIds,
    cycleLengthWeeks: side.newWeeks.length,
    weeks: side.newWeeks,
    modality: side.head.modality,
    timezone: side.head.timezone,
    startDate: mondayOfWeekContaining(input.effectiveDate),
    endDate: side.successorEndDate,
    status: "active",
    classTitle: side.head.classTitle,
    activityKind: side.head.activityKind,
  });
  const successorA = successorOf(a);
  const successorB = successorOf(b);

  const { rangeStart, rangeEnd } = futureValidationRange(input.effectiveDate, todayDate, timeZone);
  const [items, availability, hiddenStudentIds] = await Promise.all([
    loadCalendarViewForRange(ctx, rangeStart, new Date(rangeEnd.getTime() + 86_400_000), undefined, { includeTestData: true }),
    getTeacherAvailability(ctx),
    loadExcludedStudentIds(ctx),
  ]);
  // Las dos series dejan de generar sus patrones viejos desde la fecha efectiva: no cuentan como ocupación; el resultado final de cada una sí.
  const replacedIds = [a.target, ...a.superseded, b.target, ...b.superseded].map((rule) => rule.id);
  const thirdParties = toConflictCandidates(items, { excludeRecurrenceIds: replacedIds, hiddenStudentIds });
  const problems: string[] = [];
  for (const [side, successor, other, otherSuccessor] of [
    [a, successorA, b, successorB],
    [b, successorB, a, successorA],
  ] as const) {
    const candidates = [...thirdParties, ...occurrencesAsCandidates(otherSuccessor, rangeStart, rangeEnd, labelOf(other.head))];
    const conflicts = findFutureRecurrenceConflicts({ successor, effectiveDate: input.effectiveDate, todayDate, candidates, availability });
    if (conflicts.length > 0) problems.push(`${labelOf(side.head)}: ${describeFutureConflicts(conflicts, timeZone).replace(" Todavía no se guardó nada.", "")}`);
  }
  if (problems.length > 0) {
    return { error: `Con ese intercambio quedaría un choque con otra clase o con tu disponibilidad. ${problems.join(" ")} No se cambió ninguna de las dos series.` } as const;
  }

  const firstClassOf = (successor: RecurrenceRuleForEngine): string | null => {
    const [first] = generateOccurrences(successor, rangeStart, rangeEnd);
    return first ? `${formatCivilDayLabelShort(instantDateKey(first.start))}, ${instantTimeLabel(first.start)}` : null;
  };
  const [affectedA, affectedB] = await Promise.all(
    [a, b].map((side) => loadAffectedLessons(ctx, [side.target, ...side.superseded].map((rule) => rule.id), input.effectiveDate, timeZone))
  );
  const sideOf = (side: typeof a, successor: RecurrenceRuleForEngine, affected: AffectedLessons): SwapPreviewSide => ({
    seriesId: side.head.id,
    label: labelOf(side.head),
    before: describeWeeks(side.target.weeks),
    after: describeWeeks(side.newWeeks),
    firstClass: firstClassOf(successor),
    replaces: side.superseded.map((rule) => `${describeWeeks(rule.weeks)} desde el ${formatCivilDate(rule.effectiveFromDate ?? rule.startDate)}`),
    rescheduledReplaced: affected.rescheduled,
    cancelledKept: affected.cancelled,
  });
  return {
    plan,
    todayDate,
    preview: { effectiveDate: input.effectiveDate, sides: [sideOf(a, successorA, affectedA), sideOf(b, successorB, affectedB)] as [SwapPreviewSide, SwapPreviewSide] },
  } as const;
}

/** Vista previa del intercambio (no escribe nada): cómo queda cada serie, su primera clase y qué cambios ya programados reemplaza. */
export async function previewSeriesSwapAction(input: SeriesSwapInput): Promise<SeriesSwapResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const prepared = await prepareSeriesSwap(ctx, input);
    if ("error" in prepared) return { error: prepared.error };
    return { preview: prepared.preview };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

/**
 * Intercambia los horarios de dos series desde la fecha efectiva: los dos cambios (y la finalización de los tramos que reemplazan) se guardan
 * en UNA transacción — ambos o ninguno. Se recalcula y se valida todo en el servidor; la vista previa del navegador es sólo informativa.
 */
export async function swapSeriesAction(input: SeriesSwapInput): Promise<SeriesSwapResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const prepared = await prepareSeriesSwap(ctx, input);
    if ("error" in prepared) return { error: prepared.error };
    const { a, b } = prepared.plan;
    if (!a.head.primaryStudentId || !b.head.primaryStudentId) return { error: "Alguna de las series no tiene alumno principal: arreglalo con «Modificar participantes» primero." };
    const sideInput = (side: typeof a) => ({
      input: {
        originalRecurrenceId: side.target.id,
        effectiveDate: input.effectiveDate,
        todayDate: prepared.todayDate,
        ruleType: (side.newWeeks.length > 1 ? "custom" : "weekly") as "weekly" | "custom",
        cycleLengthWeeks: side.newWeeks.length as 1 | 2 | 3 | 4,
        weeks: side.newWeeks,
        participantIds: side.head.participantIds,
        primaryStudentId: side.head.primaryStudentId as string,
        successorEndDate: side.successorEndDate,
      },
      endRuleIds: side.superseded.map((rule) => rule.id),
    });
    await swapRecurrencePatterns(ctx, [sideInput(a), sideInput(b)]);
    revalidatePath("/calendario");
    revalidatePath("/calendario/series");
    return { preview: prepared.preview };
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "Una de las series ya no existe. No se cambió ninguna." };
    return { error: `${friendlyErrorMessage(error)} No se cambió ninguna de las dos series.` };
  }
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

// ---------------------------------------------------------------------------
// Acciones de una clase: nombre, duración, restaurar, eliminar (paridad con la hoja de acciones de la app original)
// ---------------------------------------------------------------------------

/** La clase tal como la ve la pantalla. Los nombres y niveles de los alumnos NUNCA se toman del navegador: se resuelven acá contra los alumnos reales de la cuenta. */
export interface LessonRefInput {
  /** Id de la tarjeta (`virtual:<clave>` si todavía no es una clase creada): se usa para no contar la propia clase como choque de horario. */
  viewItemId: string;
  lessonId: string | null;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  primaryStudentId: string;
  participantIds: string[];
  lessonType: CalendarLessonType;
  startAt: string;
  endAt: string;
  modality: CalendarModality;
  classTitle: string | null;
  activityKind: ActivityKind;
}

const MODALITY_COLOR: Record<string, string> = { online: "#DDEBFF", mixta: "#F2E8FF", presencial: "#FFE4D2" };

async function resolveMaterializeBase(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, ref: LessonRefInput): Promise<{ error: string } | { base: NonNullable<EditCalendarLessonInput["base"]> }> {
  const students = await listStudents(ctx);
  const byId = new Map(students.map((student) => [student.id, student]));
  const primary = byId.get(ref.primaryStudentId);
  if (!primary) return { error: "El alumno principal ya no está disponible." };
  const participants = ref.participantIds.map((id) => byId.get(id));
  if (participants.some((student) => !student)) return { error: "Alguno de los alumnos ya no está disponible." };
  return {
    base: {
      primaryStudentId: primary.id,
      studentName: primary.name,
      level: primary.levels[0] ?? "",
      lessonType: ref.lessonType,
      startAt: ref.startAt,
      endAt: ref.endAt,
      modality: ref.modality,
      color: MODALITY_COLOR[ref.modality] ?? MODALITY_COLOR.presencial,
      recurrenceIndex: null,
      classTitle: ref.classTitle,
      activityKind: ref.activityKind,
      participants: participants.map((student) => ({ studentId: student!.id, studentName: student!.name, level: student!.levels[0] ?? "" })),
    },
  };
}

/** «Sólo esta clase» (una clase suelta, o una ocurrencia de serie que se crea en su horario): cambia nombre y/o fin con `edit_calendar_lesson`. */
async function editSingleLesson(ctx: Awaited<ReturnType<typeof requireAuthenticatedDbContext>>, ref: LessonRefInput, changes: { classTitle?: string | null; endAt?: string }): Promise<FormState> {
  let base: NonNullable<EditCalendarLessonInput["base"]> | undefined;
  if (!ref.lessonId) {
    if (!ref.recurrenceId || !ref.occurrenceKey) return { error: "No se pudo identificar la clase. Recargá el calendario." };
    const resolved = await resolveMaterializeBase(ctx, ref);
    if ("error" in resolved) return { error: resolved.error };
    base = resolved.base;
  }
  await editCalendarLesson(ctx, { lessonId: ref.lessonId, recurrenceId: ref.recurrenceId, occurrenceKey: ref.occurrenceKey, ...(base ? { base } : {}), changes });
  return {};
}

function futureEditFormData(ref: LessonRefInput, extra: Record<string, string>, flags: { confirmReplace?: boolean; allowOverlap?: boolean }): FormData {
  const formData = new FormData();
  formData.set("originalRecurrenceId", ref.recurrenceId ?? "");
  // Fecha civil de la clase tocada (hora de la cuenta): desde ahí rige el cambio. Nunca «hoy».
  formData.set("effectiveDate", getLocalDateKey(ref.startAt, TIMEZONE));
  formData.set("keepPattern", "true");
  for (const [key, value] of Object.entries(extra)) formData.set(key, value);
  if (flags.confirmReplace) formData.set("confirmReplace", "true");
  if (flags.allowOverlap) formData.set("allowOverlap", "true");
  return formData;
}

function revalidateCalendar() {
  revalidatePath("/calendario");
  revalidatePath("/calendario/series");
  revalidatePath("/inicio");
}

export interface EditLessonTitleActionInput {
  ref: LessonRefInput;
  /** Vacío = volver al nombre automático según los alumnos. */
  title: string;
  scope: LessonEditScope;
  confirmReplace?: boolean;
}

export async function editLessonTitleAction(input: EditLessonTitleActionInput): Promise<FormState> {
  const title = normalizeClassTitle(input.title);
  if (title !== null && title.length > CLASS_TITLE_MAX_LENGTH) return { error: `El nombre no puede superar los ${CLASS_TITLE_MAX_LENGTH} caracteres.` };
  const { ref } = input;
  const scope: LessonEditScope = ref.recurrenceId ? input.scope : "occurrence";
  try {
    const ctx = await requireAuthenticatedDbContext();
    if (scope === "occurrence") {
      const result = await editSingleLesson(ctx, ref, { classTitle: title });
      if (result.error) return result;
    } else if (scope === "series") {
      await editRecurrenceClassTitle(ctx, { ruleId: ref.recurrenceId as string, classTitle: title });
    } else {
      const result = await editFutureRecurrenceAction({}, futureEditFormData(ref, { classTitle: title ?? "" }, { confirmReplace: input.confirmReplace }));
      if (result.error) return result;
    }
  } catch (error) {
    if (error instanceof CalendarLessonNotFoundError) return { error: "Clase no encontrada." };
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "La serie ya no existe. Recargá el calendario." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidateCalendar();
  return {};
}

export interface ChangeLessonDurationActionInput {
  ref: LessonRefInput;
  minutes: number;
  /** La duración sólo admite «sólo esta clase» o «esta y las siguientes». */
  scope: Exclude<LessonEditScope, "series">;
  confirmReplace?: boolean;
  allowOverlap?: boolean;
}

export async function changeLessonDurationAction(input: ChangeLessonDurationActionInput): Promise<FormState> {
  if (!Number.isInteger(input.minutes) || !isValidDurationOption(input.minutes)) return { error: "Elegí una duración de la lista." };
  const { ref } = input;
  const scope = ref.recurrenceId ? input.scope : "occurrence";
  try {
    const ctx = await requireAuthenticatedDbContext();
    if (scope === "occurrence") {
      const newEnd = computeEndFromDuration(ref.startAt, input.minutes);
      if (!input.allowOverlap) {
        // Igual que reprogramar: la nueva duración no puede superponerse con otra clase ni caer en un horario bloqueado (la propia clase no cuenta como choque).
        const conflictMessage = await checkConflictsAndAvailability(ctx, ref.startAt, newEnd, ref.viewItemId);
        if (conflictMessage) return { error: conflictMessage, conflict: true };
      }
      const result = await editSingleLesson(ctx, ref, { endAt: newEnd });
      if (result.error) return result;
    } else {
      const timezone = (await getRecurrenceRule(ctx, ref.recurrenceId as string))?.timezone ?? TIMEZONE;
      const slot = sessionSlotForInstant(ref.startAt, timezone);
      const result = await editFutureRecurrenceAction(
        {},
        futureEditFormData(ref, { durationPatchJson: JSON.stringify({ ...slot, minutes: input.minutes }) }, { confirmReplace: input.confirmReplace, allowOverlap: input.allowOverlap })
      );
      if (result.error) return result;
    }
  } catch (error) {
    if (error instanceof CalendarLessonNotFoundError) return { error: "Clase no encontrada." };
    if (error instanceof RangeError) return { error: "La duración elegida no es válida." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidateCalendar();
  return {};
}

export interface RestoreOccurrenceActionInput {
  lessonId: string;
  /** La profesora vio el aviso de superposición/bloqueo y decidió restaurar igual. */
  confirmOverlap?: boolean;
}

/** Restaurar una ocurrencia cancelada o reprogramada a su fecha original. Como la app original, avisa si ese horario está bloqueado y deja restaurar igual si la profesora lo decide. */
export async function restoreOccurrenceAction(input: RestoreOccurrenceActionInput): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const lesson = await getCalendarLesson(ctx, input.lessonId);
    if (!lesson) return { error: "Clase no encontrada." };
    if (lesson.status !== "scheduled" && !input.confirmOverlap) {
      const originalStart = lesson.recurrenceOriginalStart ?? lesson.startAt;
      const originalEnd = new Date(new Date(originalStart).getTime() + (new Date(lesson.endAt).getTime() - new Date(lesson.startAt).getTime())).toISOString();
      const message = await checkConflictsAndAvailability(ctx, originalStart, originalEnd, lesson.id);
      if (message) return { error: `${message} ¿Querés restaurarla igual?`, conflict: true };
    }
    await restoreCalendarOccurrence(ctx, input.lessonId);
  } catch (error) {
    if (error instanceof CalendarLessonNotFoundError) return { error: "Clase no encontrada." };
    return { error: friendlyErrorMessage(error) };
  }
  revalidateCalendar();
  return {};
}

/** Eliminar la tarjeta de una clase cancelada. Nunca con registro o cobro asociado (lo valida la base). */
export async function deleteCancelledLessonAction(input: { lessonId: string }): Promise<FormState> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await deleteCancelledCalendarLesson(ctx, input.lessonId);
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
  revalidateCalendar();
  return {};
}

/** «Eliminar esta y todas las siguientes»: quita la serie DESDE la fecha de esta clase (las anteriores se conservan; las clases futuras sin registro pasan a canceladas). */
export async function deleteSeriesFromOccurrenceAction(input: { ruleId: string; startAt: string }): Promise<FormState & { removedFrom?: string }> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const effectiveDate = getLocalDateKey(input.startAt, TIMEZONE);
    const rules = (await listRecurrenceRules(ctx)).map((rule) => ({ ...rule, recurrenceId: rule.id }));
    const plan = planEndSeriesFromDate(rules, input.ruleId, effectiveDate);
    if (!plan) return { error: "Esta serie ya estaba terminada." };
    await endRecurrenceSeriesFromDate(ctx, { plan, effectiveDate, timezone: TIMEZONE });
    revalidateCalendar();
    return { removedFrom: effectiveDate };
  } catch (error) {
    if (error instanceof RecurrenceRuleNotFoundError) return { error: "La serie cambió o ya no existe. No se cambió nada: volvé a abrir el calendario y reintentá." };
    return { error: friendlyErrorMessage(error) };
  }
}
