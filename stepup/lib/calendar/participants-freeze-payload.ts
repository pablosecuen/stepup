import { resolveOccurrenceStudentLabel, type StudentForLabel } from "./occurrence-student-label.ts";

/**
 * Payload de `freeze_occurrences` del RPC `apply_recurrence_participants_from_date` (frontera TypeScript → SQL).
 * CONTRATO: toda clave es snake_case (también la de cada elemento de `participants`). Lo que lee el SQL por elemento:
 * occurrence_key, recurrence_index, start_at, end_at, primary_student_id, student_name, level, lesson_type, modality,
 * class_title, activity_kind, color y `participants[]` { student_id, student_name, level }. Ver
 * docs/CALENDAR_RPC_PAYLOAD_CONTRACT.md y el test de contrato `split-rpc-contract.test.ts`.
 */
export interface FreezeOccurrencePayload {
  occurrence_key: string;
  recurrence_index: number;
  start_at: string;
  end_at: string;
  primary_student_id: string | null;
  student_name: string;
  level: string;
  lesson_type: "group" | "individual";
  modality: string;
  class_title: string | null;
  activity_kind: string;
  color: string;
  participants: { student_id: string; student_name: string; level: string }[];
}

export function buildParticipantFreezePayload(input: {
  occurrences: { occurrenceKey: string; recurrenceIndex: number; start: string; end: string }[];
  rule: { primaryStudentId: string | null; participantIds: readonly string[]; modality: string; classTitle: string | null; activityKind: string };
  students: ReadonlyMap<string, StudentForLabel & { id: string }>;
}): FreezeOccurrencePayload[] {
  const { rule, students } = input;
  // Roster VIEJO completo de la serie (todos sus participantes conocidos, principal incluido).
  const oldParticipants = rule.participantIds.map((id) => students.get(id)).filter((student): student is NonNullable<typeof student> => !!student);
  // Principal = el que la serie tiene guardado de verdad — la MISMA regla que las ocurrencias virtuales del Calendario.
  const primary = resolveOccurrenceStudentLabel({ primaryStudentId: rule.primaryStudentId, participantIds: rule.participantIds, students });
  const color = rule.modality === "online" ? "#DDEBFF" : rule.modality === "mixta" ? "#F2E8FF" : "#FFE4D2";

  return input.occurrences.map((occurrence) => ({
    occurrence_key: occurrence.occurrenceKey,
    recurrence_index: occurrence.recurrenceIndex,
    start_at: occurrence.start,
    end_at: occurrence.end,
    primary_student_id: primary.primaryStudentId,
    student_name: primary.studentName,
    level: primary.level,
    lesson_type: oldParticipants.length > 1 ? "group" : "individual",
    modality: rule.modality,
    class_title: rule.classTitle,
    activity_kind: rule.activityKind,
    color,
    participants: oldParticipants.map((student) => ({ student_id: student.id, student_name: student.name, level: student.levels[0] ?? "" })),
  }));
}
