// Puerto VERBATIM del original (`src/features/calendar/hooks/calendarExternalSyncEvents.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../types/index.ts';

/**
 * Canal genérico para avisar a `useWeeklyCalendar` que lessons/rules/
 * exceptions cambiaron por una operación externa a ese hook (por ejemplo,
 * la limpieza de reservas huérfanas desde "Datos y respaldo"). Mismo
 * propósito que `studentDeletionEvents.ts`, pero sin atarlo a un
 * `studentId` — esta limpieza puede afectar a varios alumnos inexistentes
 * a la vez, ninguno de los cuales es "el alumno borrado".
 */
export interface ExternalCalendarSnapshot {
  lessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
}

type Listener = (snapshot: ExternalCalendarSnapshot) => void;
const listeners = new Set<Listener>();

export function subscribeExternalCalendarChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishExternalCalendarChange(snapshot: ExternalCalendarSnapshot): void {
  listeners.forEach((listener) => listener(snapshot));
}
