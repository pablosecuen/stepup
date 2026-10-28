// Puerto VERBATIM del original (`src/features/calendar/utils/calendarParticipantsFromDate.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  CalendarLessonParticipant,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';
import { applyExceptionsToOccurrences, generateOccurrences, lessonColorForModality, PENDING_ASSIGNMENT_SERIES_LABEL } from './calendarRecurrenceEngine.ts';
import { getLocalDateKey } from './calendarTimezone.ts';

function formatDateKeyDmy(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

function buildOccurrenceLessonWithParticipants(
  occurrence: ReturnType<typeof generateOccurrences>[number],
  participants: CalendarLessonParticipant[]
): CalendarLesson {
  const primary = participants[0] ?? null;
  return {
    id: `calendar_${occurrence.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    studentId: primary?.studentId ?? '',
    studentName:
      participants.length > 1
        ? `${primary!.studentName} +${participants.length - 1}`
        : primary?.studentName ?? PENDING_ASSIGNMENT_SERIES_LABEL,
    level: primary?.level ?? '',
    participants,
    lessonType: participants.length > 1 ? 'group' : 'individual',
    start: occurrence.start,
    end: occurrence.end,
    modality: occurrence.modality,
    status: 'scheduled',
    color: lessonColorForModality(occurrence.modality),
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: occurrence.recurrenceId,
    recurrenceOccurrenceKey: occurrence.occurrenceKey,
    recurrenceIndex: occurrence.absoluteWeekNumber * 100 + occurrence.sessionIndex,
    recurrenceOriginalStart: null,
  };
}

export interface ParticipantsFromDatePlan {
  nextRule: RecurrenceRule;
  lessonsToUpsert: CalendarLesson[];
}

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — error "La fecha efectiva debe
 * ser posterior al inicio de la serie original" al agregar alumnos):
 * agregar un alumno a una serie "esta clase y las siguientes" NUNCA debe
 * reutilizar `splitRecurrenceFromDate` — esa función crea una serie sucesora
 * nueva (otro `recurrenceId`) pensada para cuando cambia el PATRÓN horario
 * (día/hora), no para agregar un participante al mismo patrón. Reutilizarla
 * acá era la causa real del bug: su validación rechaza una fecha efectiva
 * igual al inicio de la serie porque, para un cambio de horario genuino, esa
 * igualdad no tiene sentido (ver el fix aparte en calendarRecurrenceSplit.ts
 * para ESE caso). Para agregar alumnos, en cambio, alcanza con actualizar
 * `participantIds` en la regla canónica y sincronizar las ocurrencias
 * materializadas — sin crear ninguna serie nueva.
 *
 * `generateOccurrences` sólo genera desde "ahora" en adelante (nunca clases
 * pasadas — ver `DEFAULT_RECURRENCE_HORIZON_DAYS` en calendarRecurrenceEngine
 * y su uso con `rangeStart = new Date()` en todos los llamadores reales), así
 * que cambiar `rule.participantIds` nunca puede resucitar una clase ya
 * ocurrida. Pero SÍ afectaría en el acto cualquier ocurrencia virtual entre
 * "ahora" y `effectiveDate` que todavía no se haya materializado — por eso
 * esas ocurrencias se "congelan" acá con el roster VIEJO antes de que la
 * regla cambie, exactamente igual que ya se materializa una ocurrencia al
 * reprogramarla o cancelarla (mismo mecanismo, nunca uno paralelo).
 */
export function planParticipantsFromDate(input: {
  rule: RecurrenceRule;
  updatedLesson: CalendarLesson;
  oldParticipants: CalendarLessonParticipant[];
  existingLessons: CalendarLesson[];
  exceptions: RecurrenceException[];
  now: Date;
  horizonEnd: Date;
}): ParticipantsFromDatePlan {
  const { rule, updatedLesson, oldParticipants, existingLessons, exceptions, now, horizonEnd } = input;

  if (!updatedLesson.recurrenceOccurrenceKey) {
    throw new Error('La clase no pertenece a una repetición identificable.');
  }
  const newParticipants = updatedLesson.participants;
  if (newParticipants.length === 0) {
    throw new Error('Elegí al menos un alumno antes de guardar.');
  }

  const todayDate = getLocalDateKey(now.toISOString(), rule.timezone);
  const effectiveDate = getLocalDateKey(updatedLesson.start, rule.timezone);

  if (effectiveDate < todayDate) {
    throw new Error('No se puede aplicar este cambio a una clase que ya pasó.');
  }
  if (effectiveDate < rule.startDate) {
    throw new Error(
      `La fecha elegida (${formatDateKeyDmy(effectiveDate)}) es anterior al inicio de la serie (${formatDateKeyDmy(rule.startDate)}).`
    );
  }

  const newParticipantIds = newParticipants.map((participant) => participant.studentId);
  // Corrección 2026-09-02 (a pedido de Joaquín — editar el nombre de una
  // serie antes de guardar): si la profesora NO tocó el nombre en este
  // mismo cambio de participantes, `updatedLesson.classTitle` llega igual
  // a `rule.classTitle` — en ese caso no se toca nada de título, exacto
  // igual que antes de esta corrección. Sólo si de verdad cambió se aplica
  // el mismo mecanismo de "congelar el valor viejo antes del corte" que ya
  // usa `planClassTitleFromDate` para un cambio de nombre puro — nunca una
  // fórmula nueva.
  const titleChanged = updatedLesson.classTitle !== rule.classTitle;
  const nextRule: RecurrenceRule = {
    ...rule,
    studentId: newParticipantIds[0],
    participantIds: newParticipantIds,
    ...(titleChanged ? { classTitle: updatedLesson.classTitle } : {}),
  };

  const relevantLessons = existingLessons.filter(
    (lesson) => lesson.recurrenceId === rule.recurrenceId
  );
  const materializedByKey = new Map(
    relevantLessons
      .filter((lesson): lesson is CalendarLesson & { recurrenceOccurrenceKey: string } =>
        Boolean(lesson.recurrenceOccurrenceKey)
      )
      .map((lesson) => [lesson.recurrenceOccurrenceKey, lesson])
  );

  const occurrences = applyExceptionsToOccurrences(
    generateOccurrences(rule, now, horizonEnd),
    exceptions,
    relevantLessons
  );

  const lessonsToUpsert: CalendarLesson[] = [];

  occurrences.forEach((occurrence) => {
    if (occurrence.occurrenceKey === updatedLesson.recurrenceOccurrenceKey) return;
    if (
      occurrence.materializationStatus === 'cancelled' ||
      occurrence.materializationStatus === 'rescheduled'
    ) {
      // Excepciones persistentes: nunca se reviven ni se tocan acá.
      return;
    }

    const occurrenceDate = getLocalDateKey(occurrence.start, rule.timezone);
    const already = materializedByKey.get(occurrence.occurrenceKey);

    if (occurrenceDate < effectiveDate) {
      if (already) return; // ya tiene su propio roster persistido: nunca se toca.
      const built = buildOccurrenceLessonWithParticipants(occurrence, oldParticipants);
      // Antes del corte: congelada con el título VIEJO (mismo criterio que
      // el roster viejo) — nunca el nuevo, aunque haya cambiado.
      lessonsToUpsert.push(titleChanged ? { ...built, classTitle: rule.classTitle } : built);
      return;
    }

    if (already) {
      const rebuilt = buildOccurrenceLessonWithParticipants(occurrence, newParticipants);
      lessonsToUpsert.push({
        ...already,
        studentId: rebuilt.studentId,
        studentName: rebuilt.studentName,
        level: rebuilt.level,
        participants: newParticipants,
        lessonType: rebuilt.lessonType,
        ...(titleChanged ? { classTitle: updatedLesson.classTitle } : {}),
      });
    } else {
      const built = buildOccurrenceLessonWithParticipants(occurrence, newParticipants);
      lessonsToUpsert.push(titleChanged ? { ...built, classTitle: updatedLesson.classTitle } : built);
    }
  });

  lessonsToUpsert.push(updatedLesson);

  return { nextRule, lessonsToUpsert };
}
