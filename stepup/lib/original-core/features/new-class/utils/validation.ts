// Puerto VERBATIM del original (`src/features/new-class/utils/validation.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { AttendanceStatus, NewClassFormState } from '../types/index.ts';

// Si el evento implica que la clase efectivamente se dictó (asistencia,
// contenido, evaluación aplican). El feriado solo cuenta como dictada si
// hay excepción manual.
export function isClassHeld(form: Pick<NewClassFormState, 'eventType' | 'holidayException'>): boolean {
  if (form.eventType === 'clase_dictada') return true;
  if (form.eventType === 'feriado') return form.holidayException;
  return false;
}

export function requiresAttendance(form: NewClassFormState): boolean {
  return isClassHeld(form);
}

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 3: asistencia por
 * integrante en clase grupal): un estado "real" es uno que la profesora
 * efectivamente eligió — Presente, Tarde, Ausente con aviso o Ausente.
 * `undefined` (nunca se tocó ese alumno) y `'sin_registrar'` (valor legado,
 * ya no ofrecido como botón en `AttendanceRow`, pero puede seguir
 * existiendo en registros guardados antes de esta corrección) NUNCA
 * cuentan como una decisión real — ambos se tratan igual: "falta
 * completar".
 *
 * Corrección 2026-08-11: se agrega `ausente_aviso` como estado real
 * (4to botón de `AttendanceRow`).
 */
export function hasResolvedAttendanceStatus(status: AttendanceStatus | undefined | null): boolean {
  return status === 'presente' || status === 'ausente' || status === 'tarde' || status === 'ausente_aviso';
}

/**
 * Alumnos de una clase dictada (o feriado con excepción) que TODAVÍA no
 * tienen un estado de asistencia real. Orden: el mismo de `form.studentIds`
 * — cada pantalla que renderiza las filas en OTRO orden (por ejemplo, el
 * orden de los participantes de la reserva de calendario) calcula su
 * propio primer faltante en base a SU orden real de renderizado, para que
 * el scroll apunte a la fila que la profesora efectivamente ve primero.
 */
export function findMissingAttendanceStudentIds(form: NewClassFormState): string[] {
  if (!requiresAttendance(form)) return [];
  return form.studentIds.filter((id) => {
    const entry = form.attendance.find((a) => a.studentId === id);
    return !hasResolvedAttendanceStatus(entry?.status);
  });
}

export function requiresLateCancellationPolicy(form: NewClassFormState): boolean {
  return form.eventType === 'cancelada_tarde';
}

export function requiresRescheduleLink(form: NewClassFormState): boolean {
  return form.eventType === 'reprogramada';
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export function validateNewClassForm(form: NewClassFormState): ValidationResult {
  const errors: string[] = [];

  if (form.studentIds.length === 0) {
    errors.push('Elegí al menos un alumno.');
  }
  if (!form.date) {
    errors.push('Falta la fecha.');
  }
  if (!form.time) {
    errors.push('Falta la hora.');
  }
  if (!form.scheduledDurationMinutes || form.scheduledDurationMinutes <= 0) {
    errors.push('La duración programada tiene que ser mayor a 0.');
  }

  if (requiresAttendance(form)) {
    const missing = findMissingAttendanceStudentIds(form);
    if (missing.length > 0) {
      errors.push('Falta indicar Presente, Tarde, Ausente con aviso o Ausente para uno o más alumnos.');
    }
    if (!form.actualDurationMinutes || form.actualDurationMinutes <= 0) {
      errors.push('Falta la duración real de la clase.');
    }
  }

  // Corrección 2026-08-07 (a pedido de Joaquín — la tarea no se puede
  // guardar sin fecha de entrega): la fecha de entrega es completamente
  // opcional, con o sin texto de tarea cargado — el modelo
  // (`homeworkDueDate: string | null`) y la validación de respaldo
  // (`isNullableString`) ya la trataban así; esta era la única regla que
  // la exigía. Nunca inventar la fecha de hoy: si la profesora no elige
  // ninguna, queda `null` tal cual.
  if (
    form.homeworkDueDate &&
    form.date &&
    new Date(form.homeworkDueDate).getTime() < new Date(form.date).getTime()
  ) {
    errors.push('La fecha de entrega de la tarea no puede ser anterior a la clase.');
  }

  if (requiresRescheduleLink(form) && !form.rescheduledFromLessonId) {
    errors.push('Una clase reprogramada necesita indicar la clase original.');
  }

  if (requiresLateCancellationPolicy(form)) {
    if (!form.lateCancellationPolicy) {
      errors.push('Elegí qué política de cancelación tardía aplica.');
    }
    if (
      form.lateCancellationPolicy === 'cobrar_porcentaje' &&
      (form.lateCancellationPercentage == null ||
        form.lateCancellationPercentage <= 0 ||
        form.lateCancellationPercentage > 100)
    ) {
      errors.push('Indicá un porcentaje válido (1 a 100).');
    }
  }

  return { isValid: errors.length === 0, errors };
}
