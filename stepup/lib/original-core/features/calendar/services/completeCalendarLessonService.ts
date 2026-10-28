// Puerto VERBATIM del original (`src/features/calendar/services/completeCalendarLessonService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, CalendarLessonRegistration } from '../types/index.ts';
import type { EventType } from '../../new-class/types/index.ts';
import { getStudentsStore, hydrateStudentsStore } from '../../students/hooks/studentStore.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../hooks/calendarStore.ts';
import { applyRecurrenceMutation, type RecurrenceSnapshot } from '../hooks/recurrenceMutationQueue.ts';
import { publishExternalCalendarChange } from '../hooks/calendarExternalSyncEvents.ts';
import { buildCancelledCalendarLessonMutation, buildCompletedCalendarLesson, upsertMaterializedOccurrence, upsertRecurrenceException } from '../utils/calendarRecurrenceMutations.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, generateOccurrences, resolveOccurrenceParticipants } from '../utils/calendarRecurrenceEngine.ts';
import { syncNextClassAtFromLessons } from '../utils/calendarNextClassAtSync.ts';

/**
 * Corrección 2026-08-13 (a pedido de Joaquín — ERROR CRÍTICO: OCURRENCIAS
 * QUE DESAPARECEN DEL CALENDARIO): la única ruta real para registrar una
 * clase (Inicio → "Clases por registrar" → `useSaveClass.ts`, desde la
 * corrección "ÚNICA RUTA PARA REGISTRAR UNA CLASE" de esta misma sesión)
 * nunca tocaba el store propio de Calendario — a diferencia del viejo flujo
 * nativo de Calendario (`completeCalendarLesson` en `useWeeklyCalendar.ts`,
 * disparado antes vía `pendingLessonCompletion`), que sí dejaba una
 * materialización real `completed`. Sin esa materialización, el historial
 * de "esta clase se dictó" dependía enteramente de volver a generarla como
 * ocurrencia virtual — frágil ante cualquier edición futura de la serie
 * (ver `calendarOccurrencePersistenceAudit.test.ts`). Esta función replica
 * EXACTAMENTE la misma materialización (`buildCompletedCalendarLesson` +
 * `upsertMaterializedOccurrence`), pero como servicio independiente de
 * `useWeeklyCalendar` — sigue el mismo patrón ya usado por
 * `scheduleAdjustmentService.ts` (lee un snapshot fresco de AsyncStorage,
 * calcula, persiste, publica por `calendarExternalSyncEvents`) para poder
 * llamarse desde un panel modal (Inicio) que no vive dentro de
 * `CalendarTabScreen`.
 *
 * Nunca lanza: si no hay ninguna ocurrencia real de Calendario que
 * corresponda a esta reserva (dato legacy, o clase ya eliminada), no hace
 * nada — el registro pedagógico (SavedLesson) ya es la fuente de verdad
 * real y no debe bloquearse por esto.
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

/**
 * Corrección 2026-08-18 (a pedido de Joaquín — REUTILIZAR EL HORARIO DE UNA
 * CLASE CANCELADA CON ANTICIPACIÓN): de los 7 resultados posibles al
 * registrar una clase, sólo éste debe liberar el horario de verdad — los
 * demás (incluida "Cancelada tarde") siguen materializando `completed`
 * exactamente como siempre.
 */
const EVENT_TYPES_THAT_FREE_THE_CALENDAR_SLOT: EventType[] = ['cancelada_con_aviso'];

export async function markCalendarLessonCompleted(
  registration: CalendarLessonRegistration,
  savedLessonId: string,
  eventType: EventType
): Promise<void> {
  await hydrateStudentsStore();
  const [storedLessons, storedRules, storedExceptions] = await Promise.all([
    loadCalendarLessons(),
    loadRecurrenceRules(),
    loadRecurrenceExceptions(),
  ]);
  const lessons = storedLessons ?? [];
  const recurrenceRules = storedRules ?? [];
  const recurrenceExceptions = storedExceptions ?? [];

  let target: CalendarLesson | undefined =
    registration.recurrenceId && registration.recurrenceOccurrenceKey
      ? lessons.find(
          (lesson) =>
            lesson.recurrenceId === registration.recurrenceId &&
            lesson.recurrenceOccurrenceKey === registration.recurrenceOccurrenceKey
        )
      : lessons.find((lesson) => lesson.id === registration.lessonId);

  // Ocurrencia todavía puramente virtual (nunca materializada antes) — se
  // regenera puntualmente para ESE día, mismo patrón que
  // `scheduleAdjustmentService.ts`, nunca una reimplementación paralela.
  if (!target && registration.recurrenceId && registration.recurrenceOccurrenceKey) {
    const rule = recurrenceRules.find((item) => item.recurrenceId === registration.recurrenceId);
    if (rule) {
      const dayStart = startOfLocalDay(registration.start);
      const dayEnd = endOfLocalDay(registration.start);
      const studentById = new Map(getStudentsStore().map((student) => [student.id, student]));
      const occurrence = applyExceptionsToOccurrences(
        generateOccurrences(rule, dayStart, dayEnd),
        recurrenceExceptions,
        lessons
      ).find((item) => item.occurrenceKey === registration.recurrenceOccurrenceKey);
      if (occurrence) {
        const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
        target = primary || additional.length > 0 ? buildLessonFromOccurrence(occurrence, primary, additional) : undefined;
      }
    }
  }

  if (!target) return;

  // Corrección 2026-08-18 (a pedido de Joaquín — REUTILIZAR EL HORARIO DE
  // UNA CLASE CANCELADA CON ANTICIPACIÓN): "Cancelada con aviso" es el
  // ÚNICO resultado que debe dejar el horario realmente libre en el
  // Calendario (gris, excluido de conflictos por `findCalendarConflicts`)
  // en vez de `completed` (verde, sigue bloqueando ese horario). Reutiliza
  // EXACTAMENTE el mismo mecanismo ya usado por "Cancelar esta clase"
  // (`buildCancelledCalendarLessonMutation`) — nunca una segunda
  // implementación de cancelación. El registro pedagógico ya quedó
  // guardado en `SavedLesson` (fuente de verdad real de lo que pasó) antes
  // de llegar acá — esto sólo decide cómo se ve/comporta la tarjeta del
  // Calendario.
  // Corrección P0 (a pedido de Joaquín — "PRÓXIMA CLASE" AUSENTE O EN EL
  // PASADO: "después de dictar o registrar una clase de hoy, algunos
  // alumnos muestran 'Sin datos' o conservan una fecha pasada"): causa raíz
  // real — esta función materializa la clase como completada (o cancelada,
  // "cancelada con aviso") pero nunca recalculaba `nextClassAt` de sus
  // participantes. Como la clase recién registrada deja de calificar como
  // candidata (`calculateNextClassAt` sólo cuenta `scheduled`/`rescheduled`),
  // el valor persistido quedaba apuntando a esa clase (ya en el pasado, o
  // "hoy") indefinidamente — nunca se reemplazaba por la siguiente
  // ocurrencia real de la serie. Mismo mecanismo canónico que usan los 17
  // puntos de mutación de `CalendarTabScreen.tsx`, nunca un cálculo paralelo.
  const affectedStudentIds = target.participants.map((participant) => participant.studentId);

  if (EVENT_TYPES_THAT_FREE_THE_CALENDAR_SLOT.includes(eventType)) {
    const mutation = buildCancelledCalendarLessonMutation(target, new Date().toISOString());
    const cancelledLesson: CalendarLesson = {
      ...mutation.lesson,
      notes: [mutation.lesson.notes, `Registro pedagógico: ${savedLessonId}`].filter(Boolean).join('\n'),
    };
    // Corrección 2026-09-14, tercera ronda (a pedido de Joaquín — "todas las
    // escrituras que modifiquen calendarLessons/recurrenceRules/
    // recurrenceExceptions deben pasar por una única serialización
    // compartida"): antes esto disparaba DOS escrituras separadas en
    // paralelo (`Promise.all`) — ahora es una única escritura coordinada de
    // las tres colecciones, encolada detrás de cualquier otra mutación en
    // curso (`recurrenceMutationQueue.ts`), nunca dos operaciones sueltas.
    //
    // Corrección 2026-09-14, CUARTA ronda (punto 2): `lessons`/
    // `recurrenceExceptions` se leyeron al principio de esta función — la
    // escritura real recalcula la misma mutación pura contra `current`, el
    // snapshot REALMENTE persistido al llegar su turno, nunca contra esa
    // copia potencialmente vieja.
    const verified = await applyRecurrenceMutation((current: RecurrenceSnapshot) => ({
      ...current,
      lessons: upsertMaterializedOccurrence(current.lessons, cancelledLesson),
      exceptions: mutation.exception
        ? upsertRecurrenceException(current.exceptions, mutation.exception)
        : current.exceptions,
    }));
    publishExternalCalendarChange({
      lessons: verified.lessons,
      recurrenceRules: verified.rules,
      recurrenceExceptions: verified.exceptions,
    });
    affectedStudentIds.forEach((studentId) =>
      syncNextClassAtFromLessons(studentId, verified.lessons, verified.rules, verified.exceptions)
    );
    return;
  }

  const completed = buildCompletedCalendarLesson(target, savedLessonId);
  const verified = await applyRecurrenceMutation((current: RecurrenceSnapshot) => ({
    ...current,
    lessons: upsertMaterializedOccurrence(current.lessons, completed),
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
