// Puerto VERBATIM del original (`src/features/students/hooks/studentDeletionEvents.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../../calendar/types/index.ts';

export interface DeletedStudentCalendarSnapshot {
  studentId: string;
  lessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
}

type Listener = (snapshot: DeletedStudentCalendarSnapshot) => void;
const listeners = new Set<Listener>();

export function subscribeStudentDeletion(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishStudentDeletion(
  snapshot: DeletedStudentCalendarSnapshot
): void {
  listeners.forEach((listener) => listener(snapshot));
}
