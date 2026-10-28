// Puerto VERBATIM del original (`src/features/students/utils/studentDeletionCascade.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { SavedLesson } from '../../new-class/types/index.ts';
import type { PaymentsRepositoryState } from '../../payments/types/index.ts';
import type { ReportRecord } from '../../reportes/types/index.ts';
import type { StudentProfile } from '../../student-profile/types/index.ts';
import type { StudentListItem } from '../types/index.ts';

export interface StudentDeletionSnapshots {
  students: StudentListItem[];
  profiles: Record<string, StudentProfile>;
  savedLessons: SavedLesson[];
  calendarLessons: CalendarLesson[];
  recurrenceRules: RecurrenceRule[];
  recurrenceExceptions: RecurrenceException[];
  /** Fase Pagos 4B.1: eliminar un alumno también elimina su historial financiero. */
  payments: PaymentsRepositoryState;
  /**
   * Corrección 2026-07-24 (a pedido de Joaquín — tutorial rápido salteable
   * + acciones por deslizamiento en Alumnos, ítem K): antes de esta
   * corrección, el historial de reportes del alumno quedaba huérfano tras
   * una eliminación definitiva (nunca se borraba ni se mostraba en el
   * resumen de lo afectado). Se agrega acá para que la cascada sea
   * completa, igual que ya pasa con las otras seis colecciones.
   */
  reportHistory: ReportRecord[];
}

/**
 * Quita del desglose por alumno de una clase pedagógica la entrada del
 * alumno eliminado y recalcula `billedAmount` como la suma de lo que queda.
 * Sin desglose (registro anterior a Fase 4B.1), `billedAmount` se deja en
 * `null`: no hay forma segura de saber cuánto le correspondía a cada
 * alumno restante, así que nunca se inventa una cifra. Pura.
 */
function recomputeBilledAmountAfterRemoval(
  lesson: Pick<SavedLesson, 'billedAmount' | 'billedAmountByStudent'>,
  studentId: string
): { billedAmount: number | null; billedAmountByStudent: Record<string, number> | undefined } {
  if (!lesson.billedAmountByStudent) {
    return { billedAmount: null, billedAmountByStudent: undefined };
  }
  const remainingEntries = Object.entries(lesson.billedAmountByStudent).filter(([id]) => id !== studentId);
  return {
    billedAmount: remainingEntries.reduce((sum, [, amount]) => sum + amount, 0),
    billedAmountByStudent: Object.fromEntries(remainingEntries),
  };
}

/**
 * Calcula la cascada financiera de una eliminación definitiva: quita las
 * obligaciones y pagos del alumno, y todo lo que dependa de ellos
 * (asignaciones y condonaciones), sin tocar ni un solo registro de otro
 * alumno. "Relacionado" se evalúa por referencia real (chargeId/paymentId),
 * no sólo por el campo `studentId` de cada colección — así una asignación
 * o condonación queda protegida en cuanto CUALQUIERA de sus dos extremos
 * (cargo o pago) pertenecía al alumno eliminado. Pura.
 */
function buildPaymentsDeletionCascade(
  studentId: string,
  payments: PaymentsRepositoryState
): PaymentsRepositoryState {
  const removedChargeIds = new Set(
    payments.charges.filter((charge) => charge.studentId === studentId).map((charge) => charge.id)
  );
  const removedPaymentIds = new Set(
    payments.payments.filter((payment) => payment.studentId === studentId).map((payment) => payment.id)
  );

  return {
    charges: payments.charges.filter((charge) => charge.studentId !== studentId),
    payments: payments.payments.filter((payment) => payment.studentId !== studentId),
    allocations: payments.allocations.filter(
      (allocation) =>
        allocation.studentId !== studentId &&
        !removedChargeIds.has(allocation.chargeId) &&
        !removedPaymentIds.has(allocation.paymentId)
    ),
    adjustments: payments.adjustments.filter(
      (adjustment) => adjustment.studentId !== studentId && !removedChargeIds.has(adjustment.chargeId)
    ),
  };
}

/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E03, auditoría de simulación
 * anual): antes, una `RecurrenceRule` sólo se tocaba cuando el alumno
 * eliminado era el `studentId` PRIMARIO — y en ese caso se borraba la
 * regla ENTERA, aunque el grupo tuviera otros integrantes vigentes (les
 * borraba la serie sin necesidad). Si el eliminado era sólo un integrante
 * SECUNDARIO (presente únicamente en `participantIds`), la regla ni
 * siquiera se tocaba: seguía generando ocurrencias futuras con el alumno
 * ya eliminado adentro para siempre.
 *
 * Ahora se recorren TODAS las reglas donde el alumno participa (primario o
 * secundario, vía `rule.participantIds ?? [rule.studentId]`):
 *   - si tras quitarlo no queda NINGÚN participante, la regla se elimina
 *     por completo (mismo comportamiento canónico ya existente para "el
 *     único alumno de una clase individual se elimina");
 *   - si queda exactamente uno, la serie se conserva como individual
 *     (`participantIds` vuelve a `undefined`, igual que ya hace la cascada
 *     de `calendarLessons` de acá abajo cuando un grupo queda en un solo
 *     integrante);
 *   - si quedan dos o más, la serie se conserva como grupo, con
 *     `participantIds` recalculado sin el eliminado;
 *   - si el eliminado era el `studentId` primario, se promueve
 *     determinísticamente al primer integrante restante (mismo orden que
 *     ya tenía `participantIds`) — nunca queda una regla sin dueño.
 * `recurrenceIdsToDelete` sólo contiene las reglas que de verdad
 * desaparecen (nadie queda) — es lo único que debe arrastrar la
 * eliminación de `recurrenceExceptions` y el desenlace de
 * `calendarLessons` de abajo.
 */
function computeRecurrenceRulesAfterDeletion(
  rules: RecurrenceRule[],
  studentId: string
): { updatedRules: RecurrenceRule[]; recurrenceIdsToDelete: Set<string> } {
  const recurrenceIdsToDelete = new Set<string>();
  const updatedRules: RecurrenceRule[] = [];

  for (const rule of rules) {
    const participantIds = rule.participantIds ?? [rule.studentId];
    if (!participantIds.includes(studentId)) {
      updatedRules.push(rule);
      continue;
    }

    const remainingParticipants = participantIds.filter((id) => id !== studentId);
    if (remainingParticipants.length === 0) {
      recurrenceIdsToDelete.add(rule.recurrenceId);
      continue;
    }

    updatedRules.push({
      ...rule,
      studentId: remainingParticipants[0],
      participantIds: remainingParticipants.length > 1 ? remainingParticipants : undefined,
    });
  }

  return { updatedRules, recurrenceIdsToDelete };
}

/**
 * Calcula la cascada local de una eliminación definitiva sin escribir stores
 * ni AsyncStorage. Al ser pura, el llamador puede persistir todos los
 * snapshots juntos y conservar el estado anterior para rollback.
 */
export function buildStudentDeletionCascade(
  studentId: string,
  source: StudentDeletionSnapshots
): StudentDeletionSnapshots {
  const { updatedRules, recurrenceIdsToDelete } = computeRecurrenceRulesAfterDeletion(
    source.recurrenceRules,
    studentId
  );

  const profiles = { ...source.profiles };
  delete profiles[studentId];

  const calendarLessons = source.calendarLessons.flatMap<CalendarLesson>((lesson) => {
    const participants = lesson.participants.filter(
      (participant) => participant.studentId !== studentId
    );
    const hadStudentReference =
      lesson.studentId === studentId ||
      participants.length !== lesson.participants.length;

    if (!hadStudentReference) {
      return [lesson];
    }

    if (participants.length === 0) {
      return [];
    }

    const primary = participants[0];
    const removedRecurrence =
      lesson.recurrenceId !== null && recurrenceIdsToDelete.has(lesson.recurrenceId);
    return [
      {
        ...lesson,
        studentId: primary.studentId,
        studentName: primary.studentName,
        level: primary.level,
        participants,
        lessonType: participants.length > 1 ? ('group' as const) : ('individual' as const),
        ...(removedRecurrence
          ? {
              isRecurring: false,
              recurrenceId: null,
              recurrenceOccurrenceKey: null,
              recurrenceIndex: null,
              recurrenceOriginalStart: null,
            }
          : {}),
      },
    ];
  });

  const savedLessons = source.savedLessons.flatMap((lesson) => {
    if (!lesson.form.studentIds.includes(studentId)) {
      return [lesson];
    }

    const studentIds = lesson.form.studentIds.filter((id) => id !== studentId);
    if (studentIds.length === 0) {
      return [];
    }

    const registrationBelongsToDeletedStudent =
      lesson.calendarRegistration?.studentId === studentId;

    const { billedAmount, billedAmountByStudent } = recomputeBilledAmountAfterRemoval(lesson, studentId);

    return [
      {
        ...lesson,
        form: {
          ...lesson.form,
          studentIds,
          attendance: lesson.form.attendance.filter(
            (entry) => entry.studentId !== studentId
          ),
          evaluations: lesson.form.evaluations.filter(
            (entry) => entry.studentId !== studentId
          ),
        },
        billedAmount,
        billedAmountByStudent,
        calendarRegistration: registrationBelongsToDeletedStudent
          ? undefined
          : lesson.calendarRegistration,
        calendarReservationKey: registrationBelongsToDeletedStudent
          ? undefined
          : lesson.calendarReservationKey,
        calendarLessonId: registrationBelongsToDeletedStudent
          ? undefined
          : lesson.calendarLessonId,
      },
    ];
  });

  return {
    students: source.students.filter((student) => student.id !== studentId),
    profiles,
    savedLessons,
    calendarLessons,
    recurrenceRules: updatedRules,
    recurrenceExceptions: source.recurrenceExceptions.filter(
      (exception) => !recurrenceIdsToDelete.has(exception.recurrenceId)
    ),
    payments: buildPaymentsDeletionCascade(studentId, source.payments),
    reportHistory: source.reportHistory.filter((record) => record.studentId !== studentId),
  };
}
