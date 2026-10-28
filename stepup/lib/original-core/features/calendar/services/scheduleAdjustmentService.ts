// Puerto VERBATIM del original (`src/features/calendar/services/scheduleAdjustmentService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../types/index.ts';
import type { ScheduleAdjustmentDirection, ScheduleAdjustmentMinutes, ScheduleAdjustmentReason } from '../../new-class/types/index.ts';
import { getStudentsStore, hydrateStudentsStore } from '../../students/hooks/studentStore.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../hooks/calendarStore.ts';
import { applyRecurrenceMutation, type RecurrenceSnapshot } from '../hooks/recurrenceMutationQueue.ts';
import { getTeacherAvailability, hydrateTeacherAvailability } from '../hooks/teacherAvailabilityStore.ts';
import { publishExternalCalendarChange } from '../hooks/calendarExternalSyncEvents.ts';
import { buildRescheduledOccurrence, upsertMaterializedOccurrence, upsertRecurrenceException } from '../utils/calendarRecurrenceMutations.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, generateOccurrences, resolveOccurrenceParticipants } from '../utils/calendarRecurrenceEngine.ts';
import { planScheduleAdjustment, type ScheduleAdjustmentPlan } from '../utils/scheduleAdjustment.ts';
import { syncNextClassAtFromLessons } from '../utils/calendarNextClassAtSync.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda — ciclo real de
 * clase y puntualidad): orquesta "Ajustar horario" desde Inicio, REUTILIZANDO
 * exactamente los mismos servicios/entidades que ya usa Calendario para
 * reprogramar una ocurrencia (`buildRescheduledOccurrence`,
 * `calendarStore.ts`, `teacherAvailabilityStore.ts`,
 * `calendarExternalSyncEvents.ts`) — nunca un sistema de clases paralelo.
 * Deliberadamente NO usa `useWeeklyCalendar` (ese hook administra toda la
 * grilla semanal, de más para lo que Inicio necesita); en cambio lee un
 * snapshot fresco de AsyncStorage en cada llamada, calcula, persiste y
 * publica el cambio por el mismo canal que ya usan la baja de alumnos y la
 * restauración de respaldo.
 */
function startOfLocalDay(iso: string): Date {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfLocalDay(iso: string): Date {
  const date = startOfLocalDay(iso);
  date.setDate(date.getDate() + 1);
  return date;
}

function isSameOccurrence(candidate: CalendarLesson, target: CalendarLesson): boolean {
  if (candidate.id === target.id) return true;
  return Boolean(
    target.recurrenceId &&
      target.recurrenceOccurrenceKey &&
      candidate.recurrenceId === target.recurrenceId &&
      candidate.recurrenceOccurrenceKey === target.recurrenceOccurrenceKey
  );
}

export interface ApplyScheduleAdjustmentInput {
  lessonId: string;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  /** Sólo para saber qué día generar/buscar — nunca se usa para el cálculo del nuevo horario. */
  approximateStart: string;
  direction: ScheduleAdjustmentDirection;
  minutes: ScheduleAdjustmentMinutes;
  reason: ScheduleAdjustmentReason;
}

/**
 * Calcula, verifica conflictos y —si no hay ninguno— persiste el ajuste de
 * ÚNICAMENTE esta ocurrencia. Nunca modifica la regla de repetición
 * original; si la clase pertenece a una serie, crea/reutiliza una
 * excepción `rescheduled` (mismo mecanismo que "Reprogramar clase"). Ante
 * cualquier conflicto, no guarda nada — devuelve el mismo resultado que
 * `planScheduleAdjustment` para que la hoja "Ajustar horario" lo muestre
 * sin cerrar el panel.
 */
export async function applyScheduleAdjustment(input: ApplyScheduleAdjustmentInput): Promise<ScheduleAdjustmentPlan> {
  await Promise.all([hydrateTeacherAvailability(), hydrateStudentsStore()]);
  const [storedLessons, storedRules, storedExceptions] = await Promise.all([
    loadCalendarLessons(),
    loadRecurrenceRules(),
    loadRecurrenceExceptions(),
  ]);
  const lessons = storedLessons ?? [];
  const recurrenceRules = storedRules ?? [];
  const recurrenceExceptions = storedExceptions ?? [];

  const dayStart = startOfLocalDay(input.approximateStart);
  const dayEnd = endOfLocalDay(input.approximateStart);
  const studentById = new Map(getStudentsStore().map((student) => [student.id, student]));
  const virtualLessonsToday = recurrenceRules.flatMap((rule) =>
    applyExceptionsToOccurrences(generateOccurrences(rule, dayStart, dayEnd), recurrenceExceptions, lessons)
      .filter((occurrence) => occurrence.materializationStatus === 'virtual')
      .map((occurrence) => {
        const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
        return primary ? buildLessonFromOccurrence(occurrence, primary, additional) : null;
      })
      .filter((lesson): lesson is CalendarLesson => lesson !== null)
  );

  const candidates = [...lessons, ...virtualLessonsToday];
  const target = candidates.find((candidate) =>
    input.recurrenceId && input.recurrenceOccurrenceKey
      ? candidate.recurrenceId === input.recurrenceId && candidate.recurrenceOccurrenceKey === input.recurrenceOccurrenceKey
      : candidate.id === input.lessonId
  );
  if (!target) {
    throw new Error('No se encontró la clase a ajustar — puede que ya haya cambiado.');
  }

  const otherLessons = candidates.filter((candidate) => !isSameOccurrence(candidate, target));

  const plan = planScheduleAdjustment({
    lesson: target,
    direction: input.direction,
    minutes: input.minutes,
    reason: input.reason,
    otherLessons,
    availability: getTeacherAvailability(),
  });

  if (!plan.ok) return plan;

  // Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" AUSENTE O EN EL
  // PASADO, requisito "reprogramar"): "Ajustar horario" corre por su
  // propio servicio, fuera de `CalendarTabScreen.tsx` — sin este recálculo,
  // adelantar/atrasar la ocurrencia que hoy es la "próxima clase" de un
  // alumno podía dejar el valor persistido desactualizado respecto del
  // nuevo horario real.
  const affectedStudentIds = target.participants.map((participant) => participant.studentId);

  // Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
  // independiente, punto 2): `lessons`/`recurrenceRules`/`recurrenceExceptions`
  // se leyeron al PRINCIPIO de esta función (antes de calcular disponibilidad
  // y el plan, potencialmente varios `await` atrás) — encolar directamente
  // un array ya armado con esos valores podía sobrescribir un cambio
  // concurrente real (por ejemplo, un vínculo de entrenamiento) que hubiera
  // llegado mientras tanto. La escritura real se recalcula acá adentro
  // contra `current`, el snapshot REALMENTE persistido en el momento en que
  // le toca su turno en la cola — `recurrenceRules` nunca se toca en esta
  // función, así que el spread de `...current` alcanza para conservar
  // cualquier cambio ajeno sobre las reglas.
  if (target.recurrenceId && target.recurrenceOccurrenceKey) {
    const mutation = buildRescheduledOccurrence(target, plan.newStart, plan.newEnd, plan.adjustment.adjustedAt);
    const adjustedLesson: CalendarLesson = { ...mutation.lesson, scheduleAdjustment: plan.adjustment };
    const verified = await applyRecurrenceMutation((current: RecurrenceSnapshot) => ({
      ...current,
      lessons: upsertMaterializedOccurrence(current.lessons, adjustedLesson),
      exceptions: upsertRecurrenceException(current.exceptions, mutation.exception),
    }));
    publishExternalCalendarChange({
      lessons: verified.lessons,
      recurrenceRules: verified.rules,
      recurrenceExceptions: verified.exceptions,
    });
    affectedStudentIds.forEach((studentId) =>
      syncNextClassAtFromLessons(studentId, verified.lessons, verified.rules, verified.exceptions)
    );
  } else {
    const adjustedLesson: CalendarLesson = {
      ...target,
      start: plan.newStart,
      end: plan.newEnd,
      scheduleAdjustment: plan.adjustment,
    };
    const verified = await applyRecurrenceMutation((current: RecurrenceSnapshot) => ({
      ...current,
      lessons: current.lessons.some((item) => item.id === adjustedLesson.id)
        ? current.lessons.map((item) => (item.id === adjustedLesson.id ? adjustedLesson : item))
        : [...current.lessons, adjustedLesson],
    }));
    publishExternalCalendarChange({
      lessons: verified.lessons,
      recurrenceRules: verified.rules,
      recurrenceExceptions: verified.exceptions,
    });
    affectedStudentIds.forEach((studentId) =>
      syncNextClassAtFromLessons(studentId, verified.lessons, verified.rules, verified.exceptions)
    );
  }

  return plan;
}
