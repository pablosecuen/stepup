import { generateOccurrences, applyExceptionsToOccurrences } from "./recurrence-engine.ts";
import { resolveOccurrenceStudentLabel, type StudentForLabel } from "./occurrence-student-label.ts";
import type { ActivityKind, CalendarLessonStatus, CalendarLessonType, CalendarModality, ClosedOutcome, RecurrenceRuleForEngine } from "./types.ts";

/**
 * Combina reglas de recurrencia (generadas en memoria, nunca
 * materializadas por adelantado) + excepciones + clases ya materializadas
 * en una única lista de "lo que se ve" en un rango — la misma estrategia
 * que el móvil (CalendarTabScreen.tsx): una serie es sólo
 * `recurrence_rules` + `weeks`; las ocurrencias virtuales se generan al
 * vuelo para el rango pedido (semana/día visible), nunca se guarda una
 * fila por cada clase futura.
 */

export interface CalendarViewItem {
  /** Id estable para React/acciones — el id real de `calendar_lessons` si está materializada, o `virtual:<occurrenceKey>` si no. */
  id: string;
  recurrenceId: string | null;
  occurrenceKey: string | null;
  materializedLessonId: string | null;
  isMaterialized: boolean;
  studentId: string | null;
  participantIds: string[];
  /**
   * Nombres de TODOS los alumnos de esta clase (el principal primero), para mostrarlos en el detalle: `studentName` es sólo el del principal,
   * así que una clase compartida parecía de un único alumno. Sólo alumnos conocidos; ausente = usar `studentName`.
   */
  participantNames?: string[];
  studentName: string;
  level: string;
  lessonType: CalendarLessonType;
  title: string | null;
  start: string;
  end: string;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  /** Ver `ClosedOutcome`: sólo rotula, nunca cambia color, cobros ni asistencia. */
  closedOutcome?: ClosedOutcome | null;
  activityKind: ActivityKind;
  isRecurring: boolean;
  freedByLessonId: string | null;
  notes: string | null;
}

/** Nombres de los participantes, el principal primero; sin repetir y sólo de alumnos conocidos. */
export function resolveParticipantNames(primaryStudentId: string | null, participantIds: readonly string[], students: ReadonlyMap<string, { name: string }>): string[] {
  const ordered = primaryStudentId ? [primaryStudentId, ...participantIds.filter((id) => id !== primaryStudentId)] : [...participantIds];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    const student = students.get(id);
    if (student) names.push(student.name);
  }
  return names;
}

/** Forma mínima real de una fila de `calendar_lessons` para el merge. */
export interface MaterializedLessonForMerge {
  id: string;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  primaryStudentId: string;
  studentName: string;
  level: string;
  lessonType: CalendarLessonType;
  startAt: string;
  endAt: string;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  closedOutcome?: ClosedOutcome | null;
  isRecurring: boolean;
  classTitle: string | null;
  activityKind: ActivityKind;
  freedByLessonId: string | null;
  notes: string | null;
  participantIds: string[];
}

export interface RecurrenceExceptionForMerge {
  recurrenceId: string;
  occurrenceKey: string;
  type: "cancelled" | "rescheduled" | "excluded";
  replacementLessonId: string | null;
}

function materializationToLessonStatus(status: "virtual" | "materialized" | "cancelled" | "rescheduled"): CalendarLessonStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "rescheduled") return "rescheduled";
  return "scheduled"; // 'virtual' y 'materialized' (sin excepción) se muestran como programada
}

/** Lo mínimo que hace falta saber de TODAS las clases de serie (de cualquier fecha) para reconocer qué ocurrencias ya tienen su clase. */
export interface OccurrenceMarker {
  id: string;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  status: CalendarLessonStatus;
}

/**
 * Construye la vista completa de un rango con la MISMA regla que la app anterior (`buildLessonsInRange` / calendario semanal): lo que se ve es
 *   (1) toda clase REAL (`calendar_lessons`, de serie o suelta) por su PROPIO horario — una clase de serie movida, ajustada o reprogramada aparece donde está, no donde la generó la serie;
 *   (2) las ocurrencias de las series que siguen realmente VIRTUALES (sin clase, sin cancelar, sin reprogramar, sin excluir).
 * Una ocurrencia con excepción (cancelada/reprogramada/excluida) o con su clase ya creada NO se dibuja como virtual: su clase real (si existe) es la que se ve, y la clase de reemplazo de una
 * reprogramación aparece por su cuenta en su nuevo horario. Para reconocer las ocurrencias que ya tienen clase hace falta saber de TODAS las clases de la serie (también las que caen fuera del
 * rango): `occurrenceMarkers` las trae; sin ese dato se usan las clases del rango (comportamiento anterior). Pura — no consulta Supabase.
 */
export function buildCalendarViewForRange(input: {
  rangeStart: Date;
  rangeEnd: Date;
  rules: RecurrenceRuleForEngine[];
  exceptions: RecurrenceExceptionForMerge[];
  lessons: MaterializedLessonForMerge[];
  occurrenceMarkers?: readonly OccurrenceMarker[];
  /**
   * Alumnos conocidos (por id) para ponerle nombre y nivel a las ocurrencias VIRTUALES con la MISMA regla que las clases
   * materializadas (`resolveOccurrenceStudentLabel`). Opcional: sin mapa, las virtuales quedan sin nombre como antes.
   */
  students?: ReadonlyMap<string, StudentForLabel>;
}): CalendarViewItem[] {
  const students = input.students ?? new Map<string, StudentForLabel>();
  const markers: readonly OccurrenceMarker[] =
    input.occurrenceMarkers ??
    input.lessons.filter((lesson) => lesson.recurrenceId !== null).map((lesson) => ({ id: lesson.id, recurrenceId: lesson.recurrenceId, recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey, status: lesson.status }));
  const items: CalendarViewItem[] = [];

  input.rules.forEach((rule) => {
    const raw = generateOccurrences(rule, input.rangeStart, input.rangeEnd);
    const withExceptions = applyExceptionsToOccurrences(
      raw,
      input.exceptions.filter((exception) => exception.recurrenceId === rule.recurrenceId),
      markers.filter((marker) => marker.recurrenceId === rule.recurrenceId).map((marker) => ({ id: marker.id, recurrenceId: marker.recurrenceId, recurrenceOccurrenceKey: marker.recurrenceOccurrenceKey, status: marker.status }))
    );

    withExceptions.forEach((occurrence) => {
      if (occurrence.materializationStatus !== "virtual") return;
      const label = resolveOccurrenceStudentLabel({ primaryStudentId: occurrence.studentId, participantIds: occurrence.participantIds, students });
      items.push({
        id: `virtual:${occurrence.occurrenceKey}`,
        recurrenceId: rule.recurrenceId,
        occurrenceKey: occurrence.occurrenceKey,
        materializedLessonId: null,
        isMaterialized: false,
        studentId: occurrence.studentId,
        participantIds: occurrence.participantIds,
        participantNames: resolveParticipantNames(label.primaryStudentId, occurrence.participantIds, students),
        studentName: label.studentName,
        level: label.level,
        lessonType: occurrence.participantIds.length > 1 ? "group" : "individual",
        title: occurrence.classTitle,
        start: occurrence.start,
        end: occurrence.end,
        modality: occurrence.modality,
        status: materializationToLessonStatus(occurrence.materializationStatus),
        activityKind: occurrence.activityKind,
        isRecurring: true,
        freedByLessonId: null,
        notes: null,
      });
    });
  });

  // Clases reales (de serie o sueltas) por su propio horario dentro del rango.
  input.lessons.forEach((lesson) => {
    const startTime = new Date(lesson.startAt).getTime();
    if (startTime < input.rangeStart.getTime() || startTime > input.rangeEnd.getTime()) return;
    items.push({
      id: lesson.id,
      recurrenceId: lesson.recurrenceId,
      occurrenceKey: lesson.recurrenceOccurrenceKey,
      materializedLessonId: lesson.id,
      isMaterialized: true,
      studentId: lesson.primaryStudentId,
      participantIds: lesson.participantIds,
      participantNames: resolveParticipantNames(lesson.primaryStudentId, lesson.participantIds, students),
      studentName: lesson.studentName,
      level: lesson.level,
      lessonType: lesson.lessonType,
      title: lesson.classTitle,
      start: lesson.startAt,
      end: lesson.endAt,
      modality: lesson.modality,
      status: lesson.status,
      ...(lesson.closedOutcome ? { closedOutcome: lesson.closedOutcome } : {}),
      activityKind: lesson.activityKind,
      isRecurring: lesson.recurrenceId !== null,
      freedByLessonId: lesson.freedByLessonId,
      notes: lesson.notes,
    });
  });

  return items.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * Qué tarjetas se dibujan — misma regla EXACTA que
 * `hideCancelledLessonsWithActiveReplacement` (móvil,
 * `cancelledSlotReuse.ts`) ya portada a `lib/calendar-layout.ts`
 * (`visibleWeekLessons`) para fixtures: nunca dos tarjetas relacionadas en
 * el mismo horario. Ocultar nunca borra el dato — `all` sigue completo
 * para resolver colores (el reemplazo coral necesita ver la cancelada
 * original aunque no se dibuje).
 */
export function isActiveReplacement(item: CalendarViewItem, all: CalendarViewItem[]): boolean {
  if (!item.freedByLessonId) return false;
  const original = all.find((candidate) => candidate.id === item.freedByLessonId);
  return !!original && original.status === "cancelled" && item.status !== "cancelled";
}

function hasActiveReplacementForCancelledSlot(item: CalendarViewItem, all: CalendarViewItem[]): boolean {
  return all.some((other) => other.freedByLessonId === item.id && other.status !== "cancelled");
}

export function visibleCalendarItems(all: CalendarViewItem[]): CalendarViewItem[] {
  return all.filter((item) => {
    if (item.freedByLessonId && item.status === "cancelled") return false;
    if (item.status === "cancelled" && hasActiveReplacementForCancelledSlot(item, all)) return false;
    return true;
  });
}
