import { generateOccurrences, applyExceptionsToOccurrences } from "./recurrence-engine.ts";
import type { ActivityKind, CalendarLessonStatus, CalendarLessonType, CalendarModality, RecurrenceRuleForEngine } from "./types.ts";

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
  studentName: string;
  level: string;
  lessonType: CalendarLessonType;
  title: string | null;
  start: string;
  end: string;
  modality: CalendarModality;
  status: CalendarLessonStatus;
  activityKind: ActivityKind;
  isRecurring: boolean;
  freedByLessonId: string | null;
  notes: string | null;
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

/**
 * Construye la vista completa de un rango: ocurrencias virtuales de todas
 * las reglas activas (con excepciones aplicadas) + clases materializadas
 * (recurrentes ya tocadas Y clases sueltas, que tienen `recurrenceId: null`).
 * Pura — no consulta Supabase.
 */
export function buildCalendarViewForRange(input: {
  rangeStart: Date;
  rangeEnd: Date;
  rules: RecurrenceRuleForEngine[];
  exceptions: RecurrenceExceptionForMerge[];
  lessons: MaterializedLessonForMerge[];
}): CalendarViewItem[] {
  const lessonById = new Map(input.lessons.map((lesson) => [lesson.id, lesson]));
  const items: CalendarViewItem[] = [];
  const consumedLessonIds = new Set<string>();

  input.rules.forEach((rule) => {
    const raw = generateOccurrences(rule, input.rangeStart, input.rangeEnd);
    const withExceptions = applyExceptionsToOccurrences(
      raw,
      input.exceptions.filter((exception) => exception.recurrenceId === rule.recurrenceId),
      input.lessons
        .filter((lesson) => lesson.recurrenceId === rule.recurrenceId)
        .map((lesson) => ({ id: lesson.id, recurrenceId: lesson.recurrenceId, recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey, status: lesson.status }))
    );

    withExceptions.forEach((occurrence) => {
      const materialized = occurrence.materializedLessonId ? lessonById.get(occurrence.materializedLessonId) : undefined;
      if (materialized) {
        consumedLessonIds.add(materialized.id);
        items.push({
          id: materialized.id,
          recurrenceId: rule.recurrenceId,
          occurrenceKey: occurrence.occurrenceKey,
          materializedLessonId: materialized.id,
          isMaterialized: true,
          studentId: materialized.primaryStudentId,
          participantIds: materialized.participantIds,
          studentName: materialized.studentName,
          level: materialized.level,
          lessonType: materialized.lessonType,
          title: materialized.classTitle,
          start: materialized.startAt,
          end: materialized.endAt,
          modality: materialized.modality,
          status: materialized.status,
          activityKind: materialized.activityKind,
          isRecurring: true,
          freedByLessonId: materialized.freedByLessonId,
          notes: materialized.notes,
        });
        return;
      }

      items.push({
        id: `virtual:${occurrence.occurrenceKey}`,
        recurrenceId: rule.recurrenceId,
        occurrenceKey: occurrence.occurrenceKey,
        materializedLessonId: null,
        isMaterialized: false,
        studentId: occurrence.studentId,
        participantIds: occurrence.participantIds,
        studentName: "",
        level: "",
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

  // Clases sueltas (recurrenceId null) dentro del rango — nunca generadas
  // por ninguna regla, se agregan directo. Defensa adicional:
  // `consumedLessonIds` evita duplicar una materializada ya incluida
  // arriba si, por algún motivo, también apareciera en `input.lessons`
  // sin `recurrenceId` (nunca debería pasar, pero nunca confiar en una
  // sola fuente de verdad para no duplicar).
  input.lessons.forEach((lesson) => {
    if (lesson.recurrenceId !== null) return;
    if (consumedLessonIds.has(lesson.id)) return;
    const startTime = new Date(lesson.startAt).getTime();
    if (startTime < input.rangeStart.getTime() || startTime > input.rangeEnd.getTime()) return;
    items.push({
      id: lesson.id,
      recurrenceId: null,
      occurrenceKey: null,
      materializedLessonId: lesson.id,
      isMaterialized: true,
      studentId: lesson.primaryStudentId,
      participantIds: lesson.participantIds,
      studentName: lesson.studentName,
      level: lesson.level,
      lessonType: lesson.lessonType,
      title: lesson.classTitle,
      start: lesson.startAt,
      end: lesson.endAt,
      modality: lesson.modality,
      status: lesson.status,
      activityKind: lesson.activityKind,
      isRecurring: false,
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
