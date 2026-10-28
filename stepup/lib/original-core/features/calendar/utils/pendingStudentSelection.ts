// Puerto VERBATIM del original (`src/features/calendar/utils/pendingStudentSelection.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../students/types/index.ts';
import type { CalendarModality } from '../types/index.ts';

/**
 * Alta "normal" de un alumno (sin horario elegido de antemano — ver
 * `NewStudentScreen`/`RootNavigator`, distinto del flujo de
 * `PendingLessonDraft` que ya existía para cuando el alumno se crea DESDE
 * un horario de "Nueva clase"): el Calendario recuerda el id recién creado
 * como "pendiente de agendar" hasta que la profesora toque un espacio
 * disponible, cancele explícitamente, o el alumno deje de existir o de
 * estar activo. Siempre por `studentId` — nunca por nombre.
 */
export interface PendingStudentSelection {
  studentId: string;
}

export function createPendingStudentSelection(studentId: string): PendingStudentSelection {
  return { studentId };
}

/**
 * Único punto de verdad para decidir si un alumno pendiente sigue siendo
 * agendable: tiene que existir y seguir "activo". Se usa tanto al CONSUMIR
 * el parámetro de navegación recién llegado como, después, cada vez que
 * cambia el store de alumnos (por si se archiva/elimina mientras el aviso
 * "Agendando a…" sigue visible en pantalla).
 */
export function isStudentAgendable(student: StudentListItem | null | undefined): boolean {
  return Boolean(student) && student!.status === 'activo';
}

export interface SlotPresetFromPendingStudent {
  presetStudentId: string;
  presetDurationMinutes?: number;
  presetModality?: CalendarModality;
}

/**
 * Deriva el preset con el que se abre `NewCalendarLessonSheet` al tocar un
 * espacio disponible mientras hay un alumno pendiente. La duración y la
 * modalidad iniciales vienen del perfil recién creado, no de un valor por
 * defecto genérico — `usualDurationMinutes` puede faltar (perfil todavía no
 * disponible / dato antiguo inválido); en ese caso se omite y el sheet cae a
 * su propio default, nunca se inventa un número.
 */
export function resolveSlotPresetFromPendingStudent(
  pending: PendingStudentSelection,
  student: StudentListItem,
  profileUsualDurationMinutes: number | null | undefined
): SlotPresetFromPendingStudent {
  return {
    presetStudentId: pending.studentId,
    presetDurationMinutes:
      typeof profileUsualDurationMinutes === 'number' && profileUsualDurationMinutes > 0
        ? profileUsualDurationMinutes
        : undefined,
    presetModality: student.modality,
  };
}

/**
 * El alumno pendiente se libera recién cuando SU clase se guardó de
 * verdad — nunca antes (un error de validación/conflicto no llega a llamar
 * a esta función, porque ocurre antes de que la clase se agregue de
 * verdad). Cubre clases grupales: alcanza con que el alumno pendiente sea
 * uno de los participantes.
 */
export function shouldClearPendingStudentAfterLesson(
  pending: PendingStudentSelection | null,
  participantStudentIds: string[]
): boolean {
  return Boolean(pending) && participantStudentIds.includes(pending!.studentId);
}

/** Misma idea que `shouldClearPendingStudentAfterLesson`, para el alta de una serie recurrente. */
export function shouldClearPendingStudentAfterRecurrence(
  pending: PendingStudentSelection | null,
  recurrenceStudentId: string
): boolean {
  return Boolean(pending) && pending!.studentId === recurrenceStudentId;
}
