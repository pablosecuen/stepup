// Puerto VERBATIM del original (`src/features/calendar/types/teacherAvailability.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { AppWeekday } from './index.ts';

export type AvailabilityBlockReason = 'work' | 'study' | 'personal' | 'other';
export type AvailabilityExceptionReason = 'vacation' | 'holiday' | 'leave' | 'other';

/** Bloque semanal recurrente en el que la docente NO está disponible. */
export interface WeeklyAvailabilityBlock {
  id: string;
  weekday: AppWeekday;
  startTime: string;
  endTime: string;
  reason: AvailabilityBlockReason;
  note?: string;
}

export interface AvailabilityException {
  id: string;
  date: string;
  /** Fecha final inclusive. Si se omite, la excepción dura un solo día. */
  endDate?: string;
  type: 'unavailable_full_day' | 'unavailable_block' | 'available_extra';
  startTime?: string;
  endTime?: string;
  reason: AvailabilityExceptionReason;
  note?: string;
}

export interface TeacherAvailability {
  schemaVersion: 1;
  timezone: string;
  weeklyBlocks: WeeklyAvailabilityBlock[];
  exceptions: AvailabilityException[];
}

export type AvailabilityConflictKind = 'weekly_block' | 'exception';

export interface AvailabilityConflict {
  kind: AvailabilityConflictKind;
  sourceId: string;
  label: string;
  overlapStart: string;
  overlapEnd: string;
}

export interface AvailabilityEvaluation {
  isAvailable: boolean;
  conflict: AvailabilityConflict | null;
  label: string | null;
}

// Contratos previos del calendario: se conservan para que reemplazar este
// archivo no rompa el barrel `calendar/types/index.ts` ni los consumidores
// de detección combinada de conflictos.
export type ConflictKind =
  | 'lesson_overlap'
  | 'availability_block'
  | 'availability_exception';

export interface DetectedConflict {
  kind: ConflictKind;
  studentId: string | null;
  date: string;
  startTime: string;
  durationMinutes: number;
  conflictingLessonId: string | null;
  conflictingOccurrenceKey: string | null;
  overlapMinutes: number;
}
