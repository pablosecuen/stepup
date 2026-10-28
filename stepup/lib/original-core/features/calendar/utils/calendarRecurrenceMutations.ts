// Puerto VERBATIM del original (`src/features/calendar/utils/calendarRecurrenceMutations.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
  RecurrenceRuleStatus,
} from '../types/index.ts';

function requireOccurrenceIdentity(lesson: CalendarLesson): {
  recurrenceId: string;
  occurrenceKey: string;
} {
  if (!lesson.recurrenceId || !lesson.recurrenceOccurrenceKey) {
    throw new Error('La clase no pertenece a una repetición identificable.');
  }
  return {
    recurrenceId: lesson.recurrenceId,
    occurrenceKey: lesson.recurrenceOccurrenceKey,
  };
}

function stableLessonId(prefix: string, occurrenceKey: string): string {
  return `${prefix}_${occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export function buildCancelledOccurrence(
  lesson: CalendarLesson,
  createdAt = new Date().toISOString()
): { lesson: CalendarLesson; exception: RecurrenceException } {
  const identity = requireOccurrenceIdentity(lesson);
  return {
    lesson: {
      ...lesson,
      id: stableLessonId('calendar_cancelled', identity.occurrenceKey),
      status: 'cancelled',
      recurrenceOriginalStart: lesson.recurrenceOriginalStart ?? lesson.start,
    },
    exception: {
      ...identity,
      type: 'cancelled',
      createdAt,
    },
  };
}

export function buildCancelledCalendarLessonMutation(
  lesson: CalendarLesson,
  createdAt = new Date().toISOString()
): { lesson: CalendarLesson; exception: RecurrenceException | null } {
  if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
    return buildCancelledOccurrence(lesson, createdAt);
  }
  return {
    lesson: {
      ...lesson,
      status: 'cancelled',
      recurrenceOriginalStart: lesson.recurrenceOriginalStart ?? lesson.start,
    },
    exception: null,
  };
}

/**
 * Corrección 2026-07-16 (a pedido de Joaquín, opción "Agendar ambos" ante
 * un choque de horario): permite marcar la ocurrencia reprogramada como
 * superposición permitida — mismo mecanismo (`overlapAllowed`/
 * `overlapGroupId`) que ya usa `NewCalendarLessonSheet.tsx` para clases
 * sueltas nuevas, extendido acá para que también funcione al reprogramar
 * una ocurrencia de una serie recurrente. Nunca fusiona las dos clases en
 * una sola (eso sería "clase grupal", una decisión distinta): ambas
 * siguen existiendo por separado, cada una visible con su propio alumno.
 */
export function buildRescheduledOccurrence(
  lesson: CalendarLesson,
  start: string,
  end: string,
  createdAt = new Date().toISOString(),
  overrides?: { overlapAllowed?: boolean; overlapGroupId?: string | null }
): { lesson: CalendarLesson; exception: RecurrenceException } {
  const identity = requireOccurrenceIdentity(lesson);
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error('El nuevo horario de finalización debe ser posterior al inicio.');
  }
  const replacementId = stableLessonId(
    'calendar_rescheduled',
    identity.occurrenceKey
  );
  return {
    lesson: {
      ...lesson,
      id: replacementId,
      start,
      end,
      status: 'rescheduled',
      recurrenceOriginalStart: lesson.recurrenceOriginalStart ?? lesson.start,
      overlapAllowed: overrides?.overlapAllowed ?? lesson.overlapAllowed,
      overlapGroupId: overrides?.overlapGroupId ?? lesson.overlapGroupId,
    },
    exception: {
      ...identity,
      type: 'rescheduled',
      replacementLessonId: replacementId,
      createdAt,
    },
  };
}

/**
 * CORRECCIÓN (a pedido de Joaquín — reprogramar una sola ocurrencia y
 * editar su horario): reprograma una clase SUELTA (sin `recurrenceId`/
 * `recurrenceOccurrenceKey` — nunca perteneció a una serie) actualizando
 * directamente su propio horario. A diferencia de `buildRescheduledOccurrence`,
 * nunca crea una `RecurrenceException` (no hay ningún patrón de repetición
 * del que excepcionar) ni un id nuevo (una clase suelta ya es su propia
 * identidad estable, nunca necesita una identidad derivada de una
 * ocurrencia). Mismo criterio de "actualizar el horario en el lugar" que ya
 * usa `scheduleAdjustmentService.ts` en su rama sin recurrencia — nunca un
 * segundo motor de reprogramación paralelo.
 */
export function buildRescheduledStandaloneLesson(
  lesson: CalendarLesson,
  start: string,
  end: string,
  overrides?: { overlapAllowed?: boolean; overlapGroupId?: string | null }
): CalendarLesson {
  if (lesson.recurrenceId || lesson.recurrenceOccurrenceKey) {
    throw new Error('Esta clase pertenece a una repetición — usá buildRescheduledOccurrence.');
  }
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new Error('El nuevo horario de finalización debe ser posterior al inicio.');
  }
  return {
    ...lesson,
    start,
    end,
    status: 'rescheduled',
    recurrenceOriginalStart: lesson.recurrenceOriginalStart ?? lesson.start,
    overlapAllowed: overrides?.overlapAllowed ?? lesson.overlapAllowed,
    overlapGroupId: overrides?.overlapGroupId ?? lesson.overlapGroupId,
  };
}

export function upsertMaterializedOccurrence(
  current: CalendarLesson[],
  incoming: CalendarLesson
): CalendarLesson[] {
  const index = current.findIndex(
    (item) =>
      item.id === incoming.id ||
      (incoming.recurrenceId &&
        incoming.recurrenceOccurrenceKey &&
        item.recurrenceId === incoming.recurrenceId &&
        item.recurrenceOccurrenceKey === incoming.recurrenceOccurrenceKey)
  );
  if (index < 0) return [...current, incoming];
  return current.map((item, itemIndex) =>
    itemIndex === index ? incoming : item
  );
}

export function removeMaterializedOccurrence(
  current: CalendarLesson[],
  lesson: CalendarLesson
): CalendarLesson[] {
  const identity = requireOccurrenceIdentity(lesson);
  return current.filter(
    (item) =>
      !(
        item.recurrenceId === identity.recurrenceId &&
        item.recurrenceOccurrenceKey === identity.occurrenceKey
      )
  );
}

export function buildRestoredOccurrence(
  lesson: CalendarLesson
): CalendarLesson {
  const identity = requireOccurrenceIdentity(lesson);
  const originalStart = lesson.recurrenceOriginalStart ?? lesson.start;
  const durationMs =
    new Date(lesson.end).getTime() - new Date(lesson.start).getTime();
  return {
    ...lesson,
    id: stableLessonId('calendar_restored', identity.occurrenceKey),
    start: originalStart,
    end: new Date(new Date(originalStart).getTime() + durationMs).toISOString(),
    status: 'scheduled',
    recurrenceOriginalStart: originalStart,
  };
}

export function removeRecurrenceException(
  current: RecurrenceException[],
  recurrenceId: string,
  occurrenceKey: string
): RecurrenceException[] {
  return current.filter(
    (item) =>
      !(
        item.recurrenceId === recurrenceId &&
        item.occurrenceKey === occurrenceKey
      )
  );
}

export function buildDeletedCalendarLessonMutation(
  currentLessons: CalendarLesson[],
  currentExceptions: RecurrenceException[],
  lesson: CalendarLesson,
  createdAt = new Date().toISOString()
): { lessons: CalendarLesson[]; exceptions: RecurrenceException[] } {
  if (lesson.status !== 'cancelled') {
    throw new Error('Primero cancelÃ¡ la clase antes de eliminarla definitivamente.');
  }

  if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
    const lessons = currentLessons.filter(
      (item) =>
        !(
          item.id === lesson.id ||
          (item.recurrenceId === lesson.recurrenceId &&
            item.recurrenceOccurrenceKey === lesson.recurrenceOccurrenceKey)
        )
    );
    const exclusion: RecurrenceException = {
      recurrenceId: lesson.recurrenceId,
      occurrenceKey: lesson.recurrenceOccurrenceKey,
      type: 'excluded',
      createdAt,
    };
    return {
      lessons,
      exceptions: upsertRecurrenceException(currentExceptions, exclusion),
    };
  }

  // Suelta o huÃ©rfana legacy: no hay identidad capaz de regenerarla. Se
  // elimina el registro y cualquier excepciÃ³n que lo referencie como reemplazo.
  return {
    lessons: currentLessons.filter((item) => item.id !== lesson.id),
    exceptions: currentExceptions.filter(
      (exception) => exception.replacementLessonId !== lesson.id
    ),
  };
}

export function setRuleStatus(
  rule: RecurrenceRule,
  status: RecurrenceRuleStatus,
  endDate: string | null = rule.endDate
): RecurrenceRule {
  return { ...rule, status, endDate };
}

export function buildCalendarReservationKey(lesson: CalendarLesson): string {
  if (lesson.recurrenceId && lesson.recurrenceOccurrenceKey) {
    return `recurrence:${lesson.recurrenceId}:${lesson.recurrenceOccurrenceKey}`;
  }
  return `lesson:${lesson.id}`;
}

export function buildCompletedCalendarLesson(
  lesson: CalendarLesson,
  savedLessonId: string
): CalendarLesson {
  const logicalId = lesson.recurrenceOccurrenceKey
    ? lesson.recurrenceOccurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')
    : lesson.id;
  return {
    ...lesson,
    id: lesson.recurrenceOccurrenceKey
      ? `calendar_completed_${logicalId}`
      : lesson.id,
    status: 'completed',
    recurrenceOriginalStart: lesson.recurrenceOriginalStart ?? lesson.start,
    notes: [lesson.notes, `Registro pedagógico: ${savedLessonId}`]
      .filter(Boolean)
      .join('\n'),
  };
}

export function upsertRecurrenceException(
  current: RecurrenceException[],
  incoming: RecurrenceException
): RecurrenceException[] {
  const index = current.findIndex(
    (item) =>
      item.recurrenceId === incoming.recurrenceId &&
      item.occurrenceKey === incoming.occurrenceKey
  );
  if (index < 0) return [...current, incoming];
  return current.map((item, itemIndex) =>
    itemIndex === index ? incoming : item
  );
}

export function replaceRecurrenceRule(
  current: RecurrenceRule[],
  incoming: RecurrenceRule
): RecurrenceRule[] {
  const index = current.findIndex(
    (item) => item.recurrenceId === incoming.recurrenceId
  );
  if (index < 0) {
    throw new Error('No se encontró la serie recurrente.');
  }
  return current.map((item, itemIndex) =>
    itemIndex === index ? incoming : item
  );
}
