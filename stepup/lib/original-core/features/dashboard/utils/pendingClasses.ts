// Puerto VERBATIM del original (`src/features/dashboard/utils/pendingClasses.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { buildCalendarReservationKey } from '../../calendar/utils/calendarRecurrenceMutations.ts';
import { lessonDisplayTitle } from '../../calendar/utils/calendarParticipants.ts';
import type { CalendarLesson } from '../../calendar/types/index.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import type { PendingClass } from '../types/index.ts';
import { buildLessonsInRange, type CalendarOccurrenceSources } from './calendarOccurrenceRange.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — Home/navegación/búsqueda),
 * endurecida 2026-08-13 (a pedido de Joaquín — CORRECCIÓN: ÚNICA RUTA PARA
 * REGISTRAR UNA CLASE).
 *
 * Corrección P0 2026-08-21, tercera ronda (a pedido de Joaquín —
 * "CLASES POR REGISTRAR SÓLO DESPUÉS DE FINALIZAR"): antes una ocurrencia
 * quedaba "pendiente de registrar" desde su HORA DE INICIO — se cambió para
 * exigir que ya hubiera terminado.
 *
 * Corrección 2026-08-26 (a pedido de Joaquín — "PERMITIR REGISTRAR UNA
 * CLASE DIEZ MINUTOS ANTES DE SU FINALIZACIÓN"): la regla anterior ("recién
 * después de terminar") llegaba demasiado tarde en la práctica — la
 * profesora necesita completar asistencia/evaluación/materiales en los
 * últimos minutos de la clase, sobre todo con otro alumno inmediatamente
 * después. Regla final, ÚNICA fuente de verdad
 * (`computePendingRegistrationAvailableFrom`):
 *
 *     disponibleDesde = máximo(inicioReal, finalReal - 10 minutos)
 *     elegible cuando  ahora >= disponibleDesde
 *
 * El `máximo(...)` es lo que evita habilitar una clase ANTES de que
 * arranque cuando dura 10 minutos o menos (finalReal - 10min caería antes
 * del inicio) — nunca se habilita antes de `lesson.start`. `lesson.end`/
 * `lesson.start` ya son el horario EFECTIVO (reprogramación, excepción,
 * duración editada) — mantenidos sincronizados por los mismos mecanismos ya
 * probados (`buildRescheduledOccurrence`, `computeEndFromDuration`/
 * `calendarDurationEdit.ts`, ajuste de horario) — nunca se recalculan acá
 * aparte, y nunca se usa el horario nominal de la serie si la ocurrencia fue
 * reprogramada (excluida por `applyExceptionsToOccurrences`, ver
 * `calendarOccurrenceRange.ts`). Además sigue exigiendo: (2) no está
 * cancelada/eliminada (`status` filtrado); (3) todavía no tiene un
 * `SavedLesson` con el mismo `calendarReservationKey` — el mismo
 * identificador estable de ocurrencia que ya usa
 * `lessonRegistrationDomain.ts` para evitar registros duplicados. Funciona
 * igual con el seguimiento en vivo activado o desactivado: no depende de
 * `ActiveClassSession` ni de ningún campo de sesión real, sólo del horario
 * efectivo de la clase y de si existe (o no) su registro pedagógico.
 *
 * Habilitar la ACCIÓN de registrar nunca completa, marca asistencia, ni
 * modifica nada por sí sola — sólo decide si el botón/tarjeta aparece.
 * Guardar sigue siendo, como siempre, un paso explícito de la profesora vía
 * el mismo formulario/servicio de registro existente.
 *
 * `isOccurrenceEligibleForPendingRegistration` es la ÚNICA función que
 * decide esta elegibilidad — Inicio (`buildDashboardData.ts`), la lista
 * completa (`PendingClassesScreen.tsx`, vía el mismo `useDashboardData`) y
 * cualquier contador (`useFinancialAnalytics.ts`) pasan siempre por acá
 * dentro de `buildPendingClasses`; ninguna pantalla vuelve a comparar
 * fechas/estado por su cuenta.
 *
 * Una clase compartida (`participants.length > 1`) es UN solo
 * `CalendarLesson` — nunca aparece más de una vez en la lista resultante.
 */
export interface PendingClassesSources extends CalendarOccurrenceSources {
  now: Date;
  savedLessons: SavedLesson[];
  /** Cuántos días hacia atrás se revisan — por defecto 30. */
  lookbackDays?: number;
}

/** Ventana de anticipación: la clase se habilita para registrar hasta 10 minutos antes de su finalización real. */
export const PENDING_REGISTRATION_LEAD_TIME_MS = 10 * 60 * 1000;

/**
 * Función pura canónica única: el instante exacto desde el cual esta
 * ocurrencia puede registrarse — `máximo(inicioReal, finalReal - 10min)`.
 * `lesson.start`/`lesson.end` ya son el horario efectivo (reprogramación,
 * excepción, duración editada incluidas), así que nunca hace falta volver a
 * resolverlos acá. El `máximo` es lo único que impide habilitar una clase
 * de 10 minutos o menos ANTES de que arranque.
 */
export function computePendingRegistrationAvailableFrom(lesson: CalendarLesson): Date {
  const startMs = new Date(lesson.start).getTime();
  const endMs = new Date(lesson.end).getTime();
  return new Date(Math.max(startMs, endMs - PENDING_REGISTRATION_LEAD_TIME_MS));
}

/**
 * Función pura central: ¿esta ocurrencia puede aparecer en "Clases por
 * registrar"? Exige `now >= computePendingRegistrationAvailableFrom(lesson)`
 * — una clase que llega EXACTAMENTE a ese instante ya puede aparecer
 * (comparación `<=`, nunca `<`). `now` siempre llega como `Date` real (zona
 * horaria del dispositivo, la misma que usa el resto del calendario — nunca
 * se reinterpreta ni se corrige acá) y la comparación es un simple
 * `getTime()`, así que nunca adelanta ni atrasa la habilitación por sí sola.
 */
export function isOccurrenceEligibleForPendingRegistration(
  lesson: CalendarLesson,
  now: Date,
  hasCompletedRegistration: (lesson: CalendarLesson) => boolean
): boolean {
  if (lesson.status !== 'scheduled' && lesson.status !== 'rescheduled') return false;
  if (computePendingRegistrationAvailableFrom(lesson).getTime() > now.getTime()) return false;
  if (hasCompletedRegistration(lesson)) return false;
  return true;
}

export function buildPendingClasses(sources: PendingClassesSources): PendingClass[] {
  const lookbackDays = sources.lookbackDays ?? 30;
  // `buildLessonsInRange` filtra CANDIDATAS por `start < rangeEnd` (límite
  // EXCLUSIVO, correcto para su otro consumidor — la grilla semanal). Acá
  // sólo hace falta reunir "toda clase que ya empezó" (start <= now) como
  // universo candidato — con la regla de 10 minutos antes del final, ninguna
  // clase puede volverse elegible antes de arrancar (el `máximo(...)` de
  // `computePendingRegistrationAvailableFrom` lo garantiza: disponibleDesde
  // siempre es >= lesson.start), así que "start > now" sigue implicando
  // "todavía no elegible", sin necesidad de mirar más allá; se suma 1ms para
  // que una clase que empieza justo en `sources.now` entre en el rango
  // candidato. La regla real de elegibilidad la decide únicamente
  // `isOccurrenceEligibleForPendingRegistration`, comparando
  // `computePendingRegistrationAvailableFrom(lesson)` contra `sources.now`
  // real, sin este ajuste de 1ms.
  const rangeEnd = new Date(sources.now.getTime() + 1);
  const rangeStart = new Date(sources.now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  /**
   * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E
   * INTUITIVO DEL REGISTRO DE CLASES, "progreso parcial grupal"): un
   * `SavedLesson` con `registrationStatus === 'partially_registered'` es un
   * BORRADOR grupal todavía sin terminar — la clase debe seguir apareciendo
   * como pendiente (nunca desaparecer sólo porque ya existe ALGÚN registro
   * con esa reserva). Sólo cuentan como "ya registrada" los `SavedLesson`
   * `completed` o SIN este campo (todo registro creado antes de esta fase,
   * o cualquier registro individual/atómico de siempre — compatibilidad
   * total, sin migración).
   */
  const completedByReservationKey = new Map(
    sources.savedLessons
      .filter((lesson) => lesson.registrationStatus !== 'partially_registered')
      .map((lesson) => [lesson.calendarReservationKey, lesson] as const)
      .filter((entry): entry is [string, SavedLesson] => Boolean(entry[0]))
  );
  const draftByReservationKey = new Map(
    sources.savedLessons
      .filter((lesson) => lesson.registrationStatus === 'partially_registered')
      .map((lesson) => [lesson.calendarReservationKey, lesson] as const)
      .filter((entry): entry is [string, SavedLesson] => Boolean(entry[0]))
  );

  const candidateLessons = buildLessonsInRange(sources, rangeStart, rangeEnd);

  return candidateLessons
    .filter((lesson) =>
      isOccurrenceEligibleForPendingRegistration(lesson, sources.now, (candidate) =>
        completedByReservationKey.has(buildCalendarReservationKey(candidate))
      )
    )
    .map((lesson) => {
      const reservationKey = buildCalendarReservationKey(lesson);
      const draft = draftByReservationKey.get(reservationKey);
      return {
        reservationKey,
        calendarLessonId: lesson.id,
        studentId: lesson.studentId,
        studentNames: lesson.participants.map((participant) => participant.studentName),
        participants: lesson.participants.map((participant) => ({
          studentId: participant.studentId,
          studentName: participant.studentName,
        })),
        displayTitle: lessonDisplayTitle(lesson),
        classTitle: lesson.classTitle,
        activityKind: lesson.activityKind,
        isGroupClass: lesson.lessonType === 'group',
        start: lesson.start,
        end: lesson.end,
        durationMinutes: Math.max(
          0,
          Math.round((new Date(lesson.end).getTime() - new Date(lesson.start).getTime()) / 60_000)
        ),
        modality: lesson.modality,
        isRecurring: Boolean(lesson.recurrenceId),
        status: lesson.status,
        groupProgress: draft?.groupProgress,
        // Copia profunda — nunca la referencia mutable del store en memoria
        // (mismo criterio que `prepareSavedLesson`, ver `lessonRegistrationDomain.ts`).
        draftForm: draft ? (JSON.parse(JSON.stringify(draft.form)) as SavedLesson['form']) : undefined,
        // Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN
        // RESPUESTA PRESELECCIONADA): sin esto, reabrir un borrador grupal
        // perdía las respuestas de tareas ya elegidas — nunca llegaban a la
        // pantalla, que las volvía a mostrar sin responder.
        homeworkReviews: draft?.homeworkReviews
          ? (JSON.parse(JSON.stringify(draft.homeworkReviews)) as SavedLesson['homeworkReviews'])
          : undefined,
        calendarRegistration: {
          reservationKey,
          lessonId: lesson.id,
          studentId: lesson.studentId,
          start: lesson.start,
          end: lesson.end,
          modality: lesson.modality,
          recurrenceId: lesson.recurrenceId,
          recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
        },
      };
    })
    .sort((first, second) => new Date(second.start).getTime() - new Date(first.start).getTime());
}
