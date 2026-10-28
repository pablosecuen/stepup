// Puerto VERBATIM del original (`src/shared/backup/dataIntegrity.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { isValidBillingPeriod } from '../../features/payments/utils/paymentDates.ts';
import type { TeacherFlowBackupV2 } from './backupTypes.ts';

/**
 * Mismo criterio de relación studentId <-> colección que ya usa
 * `buildStudentDeletionCascade` (features/students/utils/studentDeletionCascade.ts)
 * para borrar un alumno completo. Acá sólo se lee, nunca se reasigna nada.
 * Las cuatro colecciones financieras son parte de v2; un respaldo v1 llega
 * acá ya migrado con esas colecciones vacías (ver `restoreValidation.ts`),
 * así que nunca hace falta un `Partial` para ellas.
 */
export type IntegritySources = Pick<
  TeacherFlowBackupV2,
  | 'students'
  | 'profiles'
  | 'pedagogicalLessons'
  | 'calendarLessons'
  | 'recurrenceRules'
  | 'recurrenceExceptions'
  | 'paymentCharges'
  | 'payments'
  | 'paymentAllocations'
  | 'paymentAdjustments'
>;

export type IntegrityIssueType =
  | 'profile_without_student'
  | 'student_without_profile'
  | 'profile_key_mismatch'
  | 'duplicate_student_id'
  | 'rule_without_student'
  | 'exception_without_rule'
  | 'pedagogical_lesson_missing_student'
  | 'calendar_lesson_missing_student'
  | 'calendar_participant_missing_student'
  | 'payment_charge_without_student'
  | 'payment_without_student'
  | 'payment_allocation_without_payment'
  | 'payment_allocation_without_charge'
  | 'payment_adjustment_without_charge'
  | 'payment_allocation_student_mismatch'
  | 'payment_student_charge_mismatch'
  | 'payment_adjustment_student_mismatch'
  | 'payment_overallocated'
  | 'payment_charge_missing_saved_lesson'
  | 'payment_charge_billing_period_mismatch'
  | 'payment_replaces_missing_payment'
  | 'duplicate_payment_charge_id'
  | 'duplicate_payment_id'
  | 'duplicate_payment_allocation_id'
  | 'duplicate_payment_adjustment_id';

/**
 * `id`/`relatedId` son siempre identificadores técnicos (studentId,
 * recurrenceId, occurrenceKey, lessonId) — nunca nombre, teléfono, whatsapp,
 * email ni ningún otro dato personal. Ningún campo de este tipo debe
 * poblarse jamás con contenido de `StudentProfile.name/phone/whatsapp/...`.
 */
export interface IntegrityIssue {
  type: IntegrityIssueType;
  id: string;
  relatedId?: string;
}

export type IntegrityIssueCounts = Record<IntegrityIssueType, number>;

export interface IntegrityReport {
  issues: IntegrityIssue[];
  counts: IntegrityIssueCounts;
  totalIssues: number;
}

const EMPTY_COUNTS: IntegrityIssueCounts = {
  profile_without_student: 0,
  student_without_profile: 0,
  profile_key_mismatch: 0,
  duplicate_student_id: 0,
  rule_without_student: 0,
  exception_without_rule: 0,
  pedagogical_lesson_missing_student: 0,
  calendar_lesson_missing_student: 0,
  calendar_participant_missing_student: 0,
  payment_charge_without_student: 0,
  payment_without_student: 0,
  payment_allocation_without_payment: 0,
  payment_allocation_without_charge: 0,
  payment_adjustment_without_charge: 0,
  payment_allocation_student_mismatch: 0,
  payment_student_charge_mismatch: 0,
  payment_adjustment_student_mismatch: 0,
  payment_overallocated: 0,
  payment_charge_missing_saved_lesson: 0,
  payment_charge_billing_period_mismatch: 0,
  payment_replaces_missing_payment: 0,
  duplicate_payment_charge_id: 0,
  duplicate_payment_id: 0,
  duplicate_payment_allocation_id: 0,
  duplicate_payment_adjustment_id: 0,
};

/** Ids duplicados dentro de la misma colección (comparar por `id`, no por contenido). */
function findDuplicateIds(items: Array<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  items.forEach((item) => {
    if (seen.has(item.id)) duplicates.add(item.id);
    seen.add(item.id);
  });
  return Array.from(duplicates);
}

/**
 * Función pura de sólo lectura: nunca modifica `sources` ni ninguna de sus
 * colecciones anidadas. Compara alumnos, perfiles, clases pedagógicas,
 * clases del calendario, participantes, reglas y excepciones de recurrencia.
 */
export function analyzeDataIntegrity(sources: IntegritySources): IntegrityReport {
  const issues: IntegrityIssue[] = [];

  const studentIds = new Set(sources.students.map((student) => student.id));
  const ruleIds = new Set(sources.recurrenceRules.map((rule) => rule.recurrenceId));

  const seenStudentIds = new Set<string>();
  const duplicatedStudentIds = new Set<string>();
  sources.students.forEach((student) => {
    if (seenStudentIds.has(student.id)) duplicatedStudentIds.add(student.id);
    seenStudentIds.add(student.id);
  });
  duplicatedStudentIds.forEach((id) => issues.push({ type: 'duplicate_student_id', id }));

  Object.entries(sources.profiles).forEach(([profileKey, profile]) => {
    if (!studentIds.has(profileKey)) {
      issues.push({ type: 'profile_without_student', id: profileKey });
    }
    if (profile.id !== profileKey) {
      issues.push({ type: 'profile_key_mismatch', id: profileKey, relatedId: profile.id });
    }
  });

  const profileKeys = new Set(Object.keys(sources.profiles));
  studentIds.forEach((studentId) => {
    if (!profileKeys.has(studentId)) {
      issues.push({ type: 'student_without_profile', id: studentId });
    }
  });

  sources.recurrenceRules.forEach((rule) => {
    // Corrección 2026-07-20 (a pedido de Joaquín — agendar series sin
    // alumnos): studentId === '' es un estado válido ("Serie sin alumnos",
    // pendiente de asignar), no una regla huérfana. Sólo se reporta como
    // problema real cuando apunta a un alumno que existió y ya no está.
    if (rule.studentId && !studentIds.has(rule.studentId)) {
      issues.push({
        type: 'rule_without_student',
        id: rule.recurrenceId,
        relatedId: rule.studentId,
      });
    }
  });

  sources.recurrenceExceptions.forEach((exception) => {
    if (!ruleIds.has(exception.recurrenceId)) {
      issues.push({
        type: 'exception_without_rule',
        id: exception.occurrenceKey,
        relatedId: exception.recurrenceId,
      });
    }
  });

  sources.pedagogicalLessons.forEach((lesson) => {
    lesson.form.studentIds.forEach((studentId) => {
      if (!studentIds.has(studentId)) {
        issues.push({
          type: 'pedagogical_lesson_missing_student',
          id: lesson.id,
          relatedId: studentId,
        });
      }
    });
  });

  sources.calendarLessons.forEach((lesson) => {
    // Corrección 2026-07-20 (a pedido de Joaquín — agendar clases sueltas o
    // series y agregar alumnos después): studentId === '' es el estado
    // válido "Sin alumnos"/"Serie sin alumnos" (pendiente de asignar), no
    // una referencia rota — sólo se reporta cuando apunta a un alumno que
    // existió y ya no está.
    if (lesson.studentId && !studentIds.has(lesson.studentId)) {
      issues.push({
        type: 'calendar_lesson_missing_student',
        id: lesson.id,
        relatedId: lesson.studentId,
      });
    }
    lesson.participants.forEach((participant) => {
      if (!studentIds.has(participant.studentId)) {
        issues.push({
          type: 'calendar_participant_missing_student',
          id: lesson.id,
          relatedId: participant.studentId,
        });
      }
    });
  });

  // Referencias financieras huérfanas o incoherentes: igual que el resto de
  // este analizador, sólo se informan. Nunca se anula, borra ni repara
  // ningún registro financiero acá — eso queda para una revisión manual
  // explícita.
  const chargesById = new Map(sources.paymentCharges.map((charge) => [charge.id, charge]));
  const paymentsById = new Map(sources.payments.map((payment) => [payment.id, payment]));
  const chargeIds = new Set(chargesById.keys());
  const paymentIds = new Set(paymentsById.keys());
  const pedagogicalLessonIds = new Set(sources.pedagogicalLessons.map((lesson) => lesson.id));

  sources.paymentCharges.forEach((charge) => {
    if (!studentIds.has(charge.studentId)) {
      issues.push({ type: 'payment_charge_without_student', id: charge.id, relatedId: charge.studentId });
    }
    if (charge.type === 'por_clase') {
      const savedLessonId = charge.savedLessonId;
      if (savedLessonId === undefined || !pedagogicalLessonIds.has(savedLessonId)) {
        issues.push({
          type: 'payment_charge_missing_saved_lesson',
          id: charge.id,
          relatedId: savedLessonId,
        });
      }
    }
    if (charge.type === 'mensual') {
      const billingPeriod = charge.billingPeriod;
      const isCoherent =
        billingPeriod !== undefined &&
        isValidBillingPeriod(billingPeriod) &&
        charge.dueDate === `${billingPeriod}-01`;
      if (!isCoherent) {
        issues.push({ type: 'payment_charge_billing_period_mismatch', id: charge.id });
      }
    }
  });
  findDuplicateIds(sources.paymentCharges).forEach((id) =>
    issues.push({ type: 'duplicate_payment_charge_id', id })
  );

  sources.payments.forEach((payment) => {
    if (!studentIds.has(payment.studentId)) {
      issues.push({ type: 'payment_without_student', id: payment.id, relatedId: payment.studentId });
    }
    if (payment.replacesPaymentId && !paymentIds.has(payment.replacesPaymentId)) {
      issues.push({
        type: 'payment_replaces_missing_payment',
        id: payment.id,
        relatedId: payment.replacesPaymentId,
      });
    }
  });
  findDuplicateIds(sources.payments).forEach((id) => issues.push({ type: 'duplicate_payment_id', id }));

  const allocatedAmountByPaymentId = new Map<string, number>();
  sources.paymentAllocations.forEach((allocation) => {
    const payment = paymentsById.get(allocation.paymentId);
    const charge = chargesById.get(allocation.chargeId);

    if (!payment) {
      issues.push({
        type: 'payment_allocation_without_payment',
        id: allocation.id,
        relatedId: allocation.paymentId,
      });
    }
    if (!charge) {
      issues.push({ type: 'payment_allocation_without_charge', id: allocation.id, relatedId: allocation.chargeId });
    }

    const allocationStudentMismatch =
      (payment !== undefined && allocation.studentId !== payment.studentId) ||
      (charge !== undefined && allocation.studentId !== charge.studentId);
    if (allocationStudentMismatch) {
      issues.push({ type: 'payment_allocation_student_mismatch', id: allocation.id });
    }
    if (payment !== undefined && charge !== undefined && payment.studentId !== charge.studentId) {
      issues.push({ type: 'payment_student_charge_mismatch', id: allocation.id, relatedId: allocation.paymentId });
    }

    if (payment !== undefined) {
      allocatedAmountByPaymentId.set(
        allocation.paymentId,
        (allocatedAmountByPaymentId.get(allocation.paymentId) ?? 0) + allocation.amount
      );
    }
  });
  findDuplicateIds(sources.paymentAllocations).forEach((id) =>
    issues.push({ type: 'duplicate_payment_allocation_id', id })
  );

  sources.payments.forEach((payment) => {
    const allocated = allocatedAmountByPaymentId.get(payment.id) ?? 0;
    if (allocated > payment.amount) {
      issues.push({ type: 'payment_overallocated', id: payment.id });
    }
  });

  sources.paymentAdjustments.forEach((adjustment) => {
    const charge = chargesById.get(adjustment.chargeId);
    if (!charge) {
      issues.push({
        type: 'payment_adjustment_without_charge',
        id: adjustment.id,
        relatedId: adjustment.chargeId,
      });
    } else if (adjustment.studentId !== charge.studentId) {
      issues.push({
        type: 'payment_adjustment_student_mismatch',
        id: adjustment.id,
        relatedId: adjustment.chargeId,
      });
    }
  });
  findDuplicateIds(sources.paymentAdjustments).forEach((id) =>
    issues.push({ type: 'duplicate_payment_adjustment_id', id })
  );

  const counts: IntegrityIssueCounts = { ...EMPTY_COUNTS };
  issues.forEach((issue) => {
    counts[issue.type] += 1;
  });

  return { issues, counts, totalIssues: issues.length };
}

/** Motivo técnico por el que un perfil huérfano se conserva. Sin datos personales. */
export type OrphanProfileConflictReason =
  | 'profile_key_mismatch'
  | 'pedagogical_lesson'
  | 'calendar_lesson'
  | 'recurrence_rule'
  | 'recurrence_exception';

export interface OrphanProfileConflict {
  profileId: string;
  reasons: OrphanProfileConflictReason[];
}

export interface OrphanProfileCleanupPlan {
  /** Perfiles sin alumno y sin ninguna referencia viva: seguros de borrar. */
  cleanableProfileIds: string[];
  /** Perfiles sin alumno pero todavía referenciados: se conservan. */
  conflictedProfiles: OrphanProfileConflict[];
}

function findOrphanProfileReferences(
  profileId: string,
  sources: IntegritySources
): OrphanProfileConflictReason[] {
  const reasons: OrphanProfileConflictReason[] = [];

  const inPedagogicalLessons = sources.pedagogicalLessons.some((lesson) =>
    lesson.form.studentIds.includes(profileId)
  );
  if (inPedagogicalLessons) reasons.push('pedagogical_lesson');

  const inCalendarLessons = sources.calendarLessons.some(
    (lesson) =>
      lesson.studentId === profileId ||
      lesson.participants.some((participant) => participant.studentId === profileId)
  );
  if (inCalendarLessons) reasons.push('calendar_lesson');

  const relatedRuleIds = new Set(
    sources.recurrenceRules
      .filter((rule) => rule.studentId === profileId)
      .map((rule) => rule.recurrenceId)
  );
  if (relatedRuleIds.size > 0) reasons.push('recurrence_rule');

  const inExceptions = sources.recurrenceExceptions.some((exception) =>
    relatedRuleIds.has(exception.recurrenceId)
  );
  if (inExceptions) reasons.push('recurrence_exception');

  return reasons;
}

/**
 * Evalúa, para cada perfil sin alumno actual, si todavía tiene alguna
 * referencia viva (clases pedagógicas, clases/participantes de calendario,
 * reglas o excepciones de recurrencia). Nunca "repara" nada por sí sola:
 * sólo separa los perfiles en "limpiables" y "en conflicto" para que quien
 * llame decida. Es pura — no modifica `sources`.
 */
export function planOrphanProfileCleanup(sources: IntegritySources): OrphanProfileCleanupPlan {
  const studentIds = new Set(sources.students.map((student) => student.id));
  const cleanableProfileIds: string[] = [];
  const conflictedProfiles: OrphanProfileConflict[] = [];

  Object.entries(sources.profiles).forEach(([profileKey, profile]) => {
    if (studentIds.has(profileKey)) return;

    const reasons = findOrphanProfileReferences(profileKey, sources);
    // Una clave distinta del id interno es un caso ambiguo: podría tratarse
    // de un perfil válido guardado bajo una clave incorrecta. Se informa y
    // conserva para revisión manual; nunca se elimina automáticamente.
    if (profile.id !== profileKey) reasons.unshift('profile_key_mismatch');
    if (reasons.length === 0) {
      cleanableProfileIds.push(profileKey);
    } else {
      conflictedProfiles.push({ profileId: profileKey, reasons });
    }
  });

  return { cleanableProfileIds, conflictedProfiles };
}

/**
 * Quita del Record de perfiles sólo las claves indicadas. Pura, no muta
 * `profiles`. Llamarla de nuevo con ids que ya no existen no produce ningún
 * cambio (es la base de que la limpieza sea repetible sin daño).
 */
export function removeCleanableOrphanProfiles<T>(
  profiles: Record<string, T>,
  cleanableProfileIds: string[]
): Record<string, T> {
  const idsToRemove = new Set(cleanableProfileIds);
  const next: Record<string, T> = {};
  Object.entries(profiles).forEach(([key, value]) => {
    if (!idsToRemove.has(key)) next[key] = value;
  });
  return next;
}

/** Motivo técnico por el que una reserva de calendario con alumno inexistente se conserva. */
export type OrphanCalendarLessonConflictReason =
  /** Mezcla un alumno actual (principal o participante) con uno inexistente: ambiguo. */
  | 'mixed_active_and_missing_students'
  | 'not_scheduled'
  | 'is_recurring';

export interface OrphanCalendarLessonConflict {
  lessonId: string;
  reasons: OrphanCalendarLessonConflictReason[];
}

export interface OrphanCalendarLessonCleanupPlan {
  /** Reservas con todos sus alumnos inexistentes, sueltas y en `scheduled`: seguras de borrar. */
  cleanableLessonIds: string[];
  /** Reservas con alumno inexistente pero ambiguas: se conservan. */
  conflictedLessons: OrphanCalendarLessonConflict[];
  /**
   * Clases pedagógicas (`SavedLesson`) con algún alumno inexistente. Sólo
   * se reportan: esta función nunca las toca ni las marca para borrar.
   */
  protectedPedagogicalLessonIds: string[];
}

/**
 * Evalúa cada reserva de calendario que involucre al menos un alumno
 * inexistente (como principal o como participante) y decide si es segura
 * de borrar. Reglas de seguridad (todas deben cumplirse):
 *  - el alumno principal no existe;
 *  - ningún participante corresponde a un alumno actual (nunca se borra una
 *    reserva que además tenga algún alumno real, sea principal o
 *    participante — eso sería ambiguo);
 *  - status === 'scheduled' (nunca completed/cancelled/rescheduled);
 *  - no es recurrente (sin recurrenceId/recurrenceOccurrenceKey ni relación
 *    con una excepción de reprogramación).
 * Las clases pedagógicas con alumno inexistente sólo se cuentan/listan,
 * nunca se tocan acá. Es pura — no modifica `sources`.
 */
export function planOrphanCalendarLessonCleanup(
  sources: IntegritySources
): OrphanCalendarLessonCleanupPlan {
  const studentIds = new Set(sources.students.map((student) => student.id));
  const cleanableLessonIds: string[] = [];
  const conflictedLessons: OrphanCalendarLessonConflict[] = [];

  sources.calendarLessons.forEach((lesson) => {
    // Corrección 2026-07-20 (a pedido de Joaquín — agendar clases sueltas o
    // series y agregar alumnos después): studentId === '' es el estado
    // válido "Sin alumnos"/"Serie sin alumnos" (pendiente de asignar), no
    // un alumno faltante — nunca debe entrar a este análisis de huérfanos
    // ni terminar en `cleanableLessonIds` (se borraría una reserva válida).
    const primaryMissing = lesson.studentId !== '' && !studentIds.has(lesson.studentId);
    const primaryExists = lesson.studentId === '' ? false : studentIds.has(lesson.studentId);
    const hasMissingParticipant = lesson.participants.some(
      (participant) => !studentIds.has(participant.studentId)
    );
    const involvesMissingStudent = primaryMissing || hasMissingParticipant;
    if (!involvesMissingStudent) return; // no tiene ningún alumno inexistente: no participa de este análisis

    const hasActiveParticipant = lesson.participants.some((participant) =>
      studentIds.has(participant.studentId)
    );
    const isRecurringLesson =
      lesson.isRecurring ||
      lesson.recurrenceId !== null ||
      lesson.recurrenceOccurrenceKey !== null ||
      lesson.recurrenceIndex !== null ||
      lesson.recurrenceOriginalStart !== null;
    const referencedAsReplacement = sources.recurrenceExceptions.some(
      (exception) => exception.replacementLessonId === lesson.id
    );

    const reasons: OrphanCalendarLessonConflictReason[] = [];
    if (primaryExists || hasActiveParticipant) {
      reasons.push('mixed_active_and_missing_students');
    }
    if (lesson.status !== 'scheduled') reasons.push('not_scheduled');
    if (isRecurringLesson || referencedAsReplacement) reasons.push('is_recurring');

    if (reasons.length === 0) {
      cleanableLessonIds.push(lesson.id);
    } else {
      conflictedLessons.push({ lessonId: lesson.id, reasons });
    }
  });

  const protectedPedagogicalLessonIds = Array.from(
    new Set(
      sources.pedagogicalLessons
        .filter((lesson) => lesson.form.studentIds.some((studentId) => !studentIds.has(studentId)))
        .map((lesson) => lesson.id)
    )
  );

  return { cleanableLessonIds, conflictedLessons, protectedPedagogicalLessonIds };
}

/**
 * Quita del array de reservas sólo los ids indicados. Pura, no muta
 * `lessons`. Llamarla de nuevo con ids que ya no existen no produce ningún
 * cambio (misma base de repetibilidad sin daño que `removeCleanableOrphanProfiles`).
 */
export function removeCleanableOrphanCalendarLessons<T extends { id: string }>(
  lessons: T[],
  cleanableLessonIds: string[]
): T[] {
  const idsToRemove = new Set(cleanableLessonIds);
  return lessons.filter((lesson) => !idsToRemove.has(lesson.id));
}
