// Puerto VERBATIM del original (`src/features/new-class/utils/editRegisteredLessonDomain.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson } from '../../calendar/types/index.ts';
import { buildCalendarReservationKey } from '../../calendar/utils/calendarRecurrenceMutations.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';
import { applyLessonOutcomeToProfileSnapshot } from '../../student-profile/utils/profileLessonOutcome.ts';
import type { HomeworkReviewEntry, LessonEditAuditEntry, NewClassFormState, SavedLesson } from '../types/index.ts';
import { computeLessonBilledAmount, computeLessonBilledAmountByStudent, buildLessonOutcomeForStudent } from './lessonRegistrationDomain.ts';
import { isClassHeld } from './validation.ts';
import { projectPendingHomeworkSummary, upsertHomeworkReviews } from './homeworkPendingDomain.ts';
import { calculateAverageGrade } from '../../../shared/utils/gradeAverage.ts';

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 2: no se puede
 * editar una clase registrada): dominio PURO de la edición — nunca toca
 * AsyncStorage/Supabase/React, mismo patrón que `lessonRegistrationDomain.ts`.
 * Reutiliza `computeLessonBilledAmount(ByStudent)`/`buildLessonOutcomeForStudent`/
 * `isClassHeld` tal cual — nunca un segundo cálculo paralelo.
 */

// ---------------------------------------------------------------------------
// 1) Lookup: dado un CalendarLesson, encontrar su SavedLesson (si existe)
// ---------------------------------------------------------------------------

/**
 * Mismo criterio de identidad que ya usa `prepareSavedLesson` internamente
 * (`calendarReservationKey`) — nunca por nombre/horario, siempre por la
 * clave estable de la ocurrencia exacta (para una serie recurrente, NUNCA
 * por `recurrenceId` solo, así que nunca puede confundirse con otra fecha
 * de la misma serie).
 */
export function findSavedLessonForCalendarLesson(
  lesson: CalendarLesson,
  savedLessons: SavedLesson[]
): SavedLesson | null {
  const reservationKey = buildCalendarReservationKey(lesson);
  return savedLessons.find((saved) => saved.calendarReservationKey === reservationKey) ?? null;
}

// ---------------------------------------------------------------------------
// 2) Update real — nunca crea un registro nuevo, nunca duplica
// ---------------------------------------------------------------------------

export interface PrepareEditedSavedLessonInput {
  current: SavedLesson[];
  existingId: string;
  form: NewClassFormState;
  studentPrices: Record<string, number>;
  updatedAt: string; // ISO
  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: "editar una clase
   * registrada debe conservar y permitir corregir la revisión"): mismo
   * upsert por taskId que `prepareSavedLesson` — editar y volver a elegir
   * un resultado distinto para la misma tarea la REEMPLAZA, nunca agrega
   * una segunda entrada.
   */
  homeworkReviewEntries?: HomeworkReviewEntry[];
}

export interface PreparedEditedSavedLesson {
  saved: SavedLesson;
  next: SavedLesson[];
}

/**
 * A diferencia de `prepareSavedLesson` (create-once: si encuentra un
 * registro existente, lo devuelve TAL CUAL, ignorando el form nuevo), acá
 * el registro existente SIEMPRE se reemplaza con el form corregido —
 * conservando `id`/`createdAt`/`calendarReservationKey`/`calendarLessonId`/
 * `calendarRegistration`/`profileAppliedAt` intactos (nunca cambia la
 * identidad del registro ni cuándo se creó originalmente). El estado
 * ANTERIOR completo (form/countsAsClass/billedAmount/billedAmountByStudent/
 * appliedPolicy) se agrega al final de `editHistory` — nunca se pierde,
 * nunca se sobrescribe una entrada vieja.
 */
export function prepareEditedSavedLesson(input: PrepareEditedSavedLessonInput): PreparedEditedSavedLesson {
  const existing = input.current.find((lesson) => lesson.id === input.existingId);
  if (!existing) {
    throw new Error('No se encontró el registro pedagógico a editar.');
  }

  const auditEntry: LessonEditAuditEntry = {
    editedAt: input.updatedAt,
    previousForm: existing.form,
    previousCountsAsClass: existing.countsAsClass,
    previousBilledAmount: existing.billedAmount,
    previousBilledAmountByStudent: existing.billedAmountByStudent,
    previousAppliedPolicy: existing.appliedPolicy,
  };

  // Corrección 2026-08-12 (a pedido de Joaquín — BUG CRÍTICO: el registro
  // de clase aparenta guardarse pero pierde la información, regla "copiar
  // en profundidad formularios... nunca compartir referencias mutables con
  // el estado de React"): mismo criterio que `prepareSavedLesson` — nunca
  // guardar la referencia mutable del formulario de React, que el
  // componente puede seguir usando (o resetear) inmediatamente después de
  // llamar a esta función.
  const formCopy: NewClassFormState = JSON.parse(JSON.stringify(input.form));

  const updated: SavedLesson = {
    ...existing,
    form: formCopy,
    countsAsClass: isClassHeld(input.form),
    billedAmount: computeLessonBilledAmount(input.form, input.studentPrices),
    billedAmountByStudent: computeLessonBilledAmountByStudent(input.form, input.studentPrices) ?? undefined,
    appliedPolicy: input.form.eventType === 'cancelada_tarde' ? input.form.lateCancellationPolicy : null,
    updatedAt: input.updatedAt,
    editHistory: [...(existing.editHistory ?? []), auditEntry],
    homeworkReviews: input.homeworkReviewEntries?.length
      ? upsertHomeworkReviews(existing.homeworkReviews, input.homeworkReviewEntries)
      : existing.homeworkReviews,
  };

  return {
    saved: updated,
    next: input.current.map((lesson) => (lesson.id === input.existingId ? updated : lesson)),
  };
}

// ---------------------------------------------------------------------------
// 3) Recompute puro de los campos derivados del perfil, desde CERO,
// plegando TODO el historial real de SavedLesson del alumno.
// ---------------------------------------------------------------------------

/**
 * Corrección 2026-08-07: `applyLessonOutcomeToProfileSnapshot` es
 * puramente ADITIVO (nunca reversible — no guarda qué lección generó qué
 * delta). Editar una clase antigua después de que ya se registraron otras
 * clases posteriores del mismo alumno vuelve inválido cualquier intento de
 * "restar el delta viejo, sumar el nuevo": la fórmula de promedio ponderado
 * no es invertible sin conocer el estado exacto anterior a ESA lección en
 * particular, que nunca se guardó. La única corrección general y correcta
 * es recomputar los 9 campos derivados desde CERO, plegando
 * `applyLessonOutcomeToProfileSnapshot` sobre TODAS las `SavedLesson` reales
 * del alumno, en orden cronológico real de la clase (no de creación del
 * registro). Confirmado por auditoría de código: estos 9 campos NUNCA se
 * escriben desde ningún otro lugar de la app salvo la creación inicial del
 * alumno (en cero) y `applyLessonOutcomeToProfileSnapshot` — así que
 * recomputar desde cero nunca pierde datos que vinieran de otra fuente.
 * Todo lo demás del perfil (nivel, plan de cobro, estado, etc.) queda
 * exactamente igual que en `baseProfile`.
 *
 * Corrección P0 2026-08-21 (a pedido de Joaquín — PROMEDIOS REALES): causa
 * raíz real de "promedios como 5.0, 3.5 o 3.0" — el fold de
 * `applyLessonOutcomeToProfileSnapshot` computaba el promedio como una
 * media ponderada usando `totalClasses` (TODAS las clases dictadas) como
 * denominador, aunque el numerador sólo sumara las clases que en verdad
 * tenían una nota general cargada (opcional). Un alumno con 10 clases
 * dictadas y una sola nota real de 9 terminaba mostrando 9/10 = 0.9, no 9.
 * Acá se IGNORA el promedio que produjo el fold (sigue sirviendo para
 * totalClasses/horas/asistencia/última clase/fortalezas, que no tienen este
 * problema) y se recalcula aparte, con `calculateAverageGrade` — única
 * función pura, sólo sobre las notas generales explícitas (no 0, no null)
 * de las clases realmente dictadas (`countsAsClass`) de este alumno.
 */
/**
 * Corrección P0 2026-08-21, segunda ronda (a pedido de Joaquín — el
 * problema seguía sin resolverse en varios alumnos): las notas generales
 * EXPLÍCITAS reales de un alumno, sólo de sus clases realmente dictadas
 * (`countsAsClass`) — única extracción real, reutilizada tanto por
 * `recomputeStudentLessonDerivedFields` (alta/edición) como por la
 * reparación en hidratación (`repairStaleAverageGradeForAllStudents` en
 * `useStudentProfile.ts`), para que nunca existan dos criterios distintos
 * de "qué cuenta como nota real".
 */
export function extractStudentGeneralGrades(
  studentId: string,
  lessons: SavedLesson[]
): Array<number | null> {
  return lessons
    .filter((lesson) => lesson.countsAsClass && lesson.form.studentIds.includes(studentId))
    .flatMap((lesson) => lesson.form.evaluations)
    .filter((evaluation) => evaluation.studentId === studentId)
    .map((evaluation) => evaluation.generalGrade);
}

/**
 * Promedio real de un alumno a partir de TODO su historial de
 * `SavedLesson` — misma función pura (`calculateAverageGrade`) que usa
 * `recomputeStudentLessonDerivedFields`, sin recalcular ningún otro campo
 * del perfil. Pensada para la reparación en hidratación: sólo el promedio,
 * nunca totalClasses/horas/asistencia/etc.
 */
export function calculateStudentAverageGradeFromLessons(
  studentId: string,
  lessons: SavedLesson[]
): number | null {
  return calculateAverageGrade(extractStudentGeneralGrades(studentId, lessons));
}

export function recomputeStudentLessonDerivedFields(
  baseProfile: StudentProfile,
  studentId: string,
  lessons: SavedLesson[]
): StudentProfile {
  const zeroed: StudentProfile = {
    ...baseProfile,
    totalClasses: 0,
    totalHoursTaken: 0,
    classesThisMonth: 0,
    averageGrade: null,
    attendanceRate: 100,
    lastClassAt: null,
    pendingHomework: null,
    strengths: [],
    areasToImprove: [],
    skillGradesHistory: [],
  };

  const studentLessons = lessons
    .filter((lesson) => lesson.form.studentIds.includes(studentId))
    .slice()
    .sort((first, second) => {
      const firstIso = `${first.form.date}T${first.form.time || '00:00'}:00`;
      const secondIso = `${second.form.date}T${second.form.time || '00:00'}:00`;
      return new Date(firstIso).getTime() - new Date(secondIso).getTime();
    });

  const folded = studentLessons.reduce(
    (profile, lesson) =>
      applyLessonOutcomeToProfileSnapshot(
        profile,
        buildLessonOutcomeForStudent(lesson.form, studentId, lesson.countsAsClass)
      ),
    zeroed
  );

  const averageGrade = calculateAverageGrade(extractStudentGeneralGrades(studentId, studentLessons));

  // Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
  // tareas pendientes): `applyLessonOutcomeToProfileSnapshot` ya NO decide
  // `pendingHomework` (no tiene visibilidad de las revisiones de otras
  // clases) — se proyecta acá, con el historial COMPLETO real (`lessons`,
  // no sólo `studentLessons` reordenadas), después del fold.
  return {
    ...folded,
    averageGrade,
    pendingHomework: projectPendingHomeworkSummary(studentId, lessons),
  };
}

// ---------------------------------------------------------------------------
// 4) Consecuencia financiera de la edición — nunca reimplementa el motor de
// cargos, sólo decide qué hacer con el cargo YA EXISTENTE de esta clase.
// ---------------------------------------------------------------------------

export type PerClassChargeAdjustmentPlan =
  | { kind: 'no_charge_exists' }
  | { kind: 'no_change'; charge: { id: string; originalAmount: number } }
  | { kind: 'safe_to_adjust'; charge: { id: string; originalAmount: number }; newAmount: number }
  | { kind: 'blocked_has_payments'; charge: { id: string; originalAmount: number }; newAmount: number };

/**
 * `reconcilePerClassCharges`/`planPerClassChargesForLesson` son
 * "crear si falta" por id determinístico — nunca actualizan un cargo ya
 * creado (`hasPerClassCharge` corta apenas encuentra el id, sin comparar
 * importes). Esta función decide, para UN alumno puntual de una clase que
 * se está editando, qué corresponde hacer con su cargo por clase ya
 * existente (si lo hay):
 *   - no existe cargo todavía → `reconcilePerClassCharges()` (ya se vuelve
 *     a llamar después de guardar la edición, sin cambios) lo crea con el
 *     importe correcto, como siempre.
 *   - existe, mismo importe → nada que hacer.
 *   - existe, importe distinto, SIN ninguna asignación de pago todavía →
 *     seguro ajustar `originalAmount` directamente (nunca se tocó dinero
 *     real todavía).
 *   - existe, importe distinto, CON al menos una asignación de pago → NUNCA
 *     se ajusta solo/en silencio (podría dejar un pago ya registrado
 *     apuntando a un importe que ya no es el real) — se bloquea y la UI debe
 *     mostrarlo como una consecuencia a resolver manualmente desde Cobros.
 */
export function planPerClassChargeAdjustmentForEdit(input: {
  existingCharge: { id: string; originalAmount: number } | null;
  allocationsForCharge: number;
  newAmount: number | null;
}): PerClassChargeAdjustmentPlan {
  if (!input.existingCharge) return { kind: 'no_charge_exists' };
  const newAmount = input.newAmount ?? 0;
  if (input.existingCharge.originalAmount === newAmount) {
    return { kind: 'no_change', charge: input.existingCharge };
  }
  if (input.allocationsForCharge > 0) {
    return { kind: 'blocked_has_payments', charge: input.existingCharge, newAmount };
  }
  return { kind: 'safe_to_adjust', charge: input.existingCharge, newAmount };
}
