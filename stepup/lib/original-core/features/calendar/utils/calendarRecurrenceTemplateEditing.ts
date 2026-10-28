// Puerto VERBATIM del original (`src/features/calendar/utils/calendarRecurrenceTemplateEditing.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  PendingRecurrenceDraft,
  RecurrenceSession,
  RecurrenceWeek,
} from '../types/index.ts';

/**
 * Corrección 2026-07-26 (a pedido de Joaquín — simplificar serie
 * personalizada): lógica pura de transición de estado para
 * `RecurrenceOptions.tsx` — extraída del componente para poder probarla
 * directamente (la suite de pruebas de calendario compila sólo `.ts`, nunca
 * `.tsx`). Nunca hay una segunda implementación: el componente importa
 * exactamente estas funciones, no las repite.
 */

function cloneSession(source: RecurrenceSession): RecurrenceSession {
  return { ...source };
}

export function sessionsEqual(a: RecurrenceSession[], b: RecurrenceSession[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((session, index) => {
    const other = b[index];
    return (
      session.weekday === other.weekday &&
      session.hour === other.hour &&
      session.minute === other.minute &&
      session.durationMinutes === other.durationMinutes
    );
  });
}

/**
 * Ajusta la cantidad de semanas del ciclo. Las semanas ya existentes se
 * conservan tal cual (nunca se pierde una personalización sólo por cambiar
 * el largo del ciclo); las semanas nuevas copian la plantilla (semana 0).
 */
export function resizeWeeksToCycle(
  weeks: RecurrenceWeek[],
  cycleLengthWeeks: 1 | 2 | 3 | 4
): RecurrenceWeek[] {
  const templateSessions = weeks[0]?.sessions.length
    ? weeks[0].sessions.map(cloneSession)
    : [{ weekday: 0 as const, hour: 18, minute: 0, durationMinutes: 60 }];

  return Array.from({ length: cycleLengthWeeks }, (_, weekIndex) => {
    const existing = weeks.find((week) => week.weekIndex === weekIndex);
    return existing ?? { weekIndex, sessions: templateSessions.map(cloneSession) };
  });
}

/**
 * ¿Alguna semana del ciclo (fuera de la semana modelo) tiene horarios
 * distintos a la plantilla? Se usa para decidir si hace falta pedir
 * confirmación antes de sobrescribir — nunca se pregunta si no hay nada
 * real que perder.
 */
export function weeksDifferFromModel(
  weeks: RecurrenceWeek[],
  modelWeekIndex = 0
): boolean {
  const template = weeks.find((week) => week.weekIndex === modelWeekIndex)?.sessions ?? [];
  return weeks
    .filter((week) => week.weekIndex !== modelWeekIndex)
    .some((week) => !sessionsEqual(week.sessions, template));
}

/**
 * "Restablecer todas desde la semana modelo": copia los horarios de la
 * semana modelo a todas las demás semanas del ciclo. Pura — el llamador
 * decide si hace falta confirmar antes (`weeksDifferFromModel`).
 */
export function resetWeeksFromModel(
  weeks: RecurrenceWeek[],
  modelWeekIndex = 0
): RecurrenceWeek[] {
  const template = weeks.find((week) => week.weekIndex === modelWeekIndex)?.sessions ?? [];
  return weeks.map((week) =>
    week.weekIndex === modelWeekIndex ? week : { ...week, sessions: template.map(cloneSession) }
  );
}

/**
 * Activa o desactiva "Personalizar semanas". Activar copia la plantilla
 * habitual (semana 0) a un ciclo de `defaultCycleLengthWeeks` (o conserva
 * el ciclo actual si ya era > 1). Desactivar colapsa todo a una única
 * semana 0 con la plantilla — nunca fabrica una semana 0 vacía.
 */
export function toggleCustomizeWeeksOnDraft(
  draft: PendingRecurrenceDraft,
  customize: boolean,
  defaultCycleLengthWeeks: 2 | 3 | 4 = 2
): PendingRecurrenceDraft {
  if (customize) {
    const cycleLengthWeeks = draft.cycleLengthWeeks > 1 ? draft.cycleLengthWeeks : defaultCycleLengthWeeks;
    return {
      ...draft,
      mode: 'custom',
      cycleLengthWeeks,
      weeks: resizeWeeksToCycle(draft.weeks, cycleLengthWeeks),
    };
  }
  const template = draft.weeks[0]?.sessions ?? [];
  return {
    ...draft,
    mode: draft.mode === 'single' ? 'single' : 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: template.map(cloneSession) }],
  };
}
