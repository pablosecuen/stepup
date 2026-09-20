import type { ActivityKind, CalendarModality, RecurrenceRuleRow, RecurrenceRuleStatus } from "../db/database.types.ts";
import type { RecurrenceWeek } from "../calendar/types.ts";

/**
 * Lógica PURA del repositorio de series — separada para poder probarla
 * con `node --test` sin Supabase/Next, mismo patrón que
 * `students-mapping.ts`.
 */
export interface RecurrenceRuleRecord {
  id: string;
  primaryStudentId: string | null;
  ruleType: "weekly" | "custom";
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality: CalendarModality;
  timezone: string;
  startDate: string;
  endDate: string | null;
  status: RecurrenceRuleStatus;
  supersedesRecurrenceId: string | null;
  supersededByRecurrenceId: string | null;
  effectiveFromDate: string | null;
  classTitle: string | null;
  activityKind: ActivityKind;
  trainingBillingAgreementId: string | null;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export function toRecurrenceRuleRecord(row: RecurrenceRuleRow, participantIds: string[]): RecurrenceRuleRecord {
  return {
    id: row.id,
    primaryStudentId: row.primary_student_id,
    ruleType: row.rule_type,
    cycleLengthWeeks: row.cycle_length_weeks as 1 | 2 | 3 | 4,
    weeks: row.weeks as unknown as RecurrenceWeek[],
    modality: row.modality,
    timezone: row.timezone,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    supersedesRecurrenceId: row.supersedes_recurrence_id,
    supersededByRecurrenceId: row.superseded_by_recurrence_id,
    effectiveFromDate: row.effective_from_date,
    classTitle: row.class_title,
    activityKind: row.activity_kind,
    trainingBillingAgreementId: row.training_billing_agreement_id,
    participantIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewRecurrenceSeriesInput {
  primaryStudentId: string | null;
  ruleType: "weekly" | "custom";
  cycleLengthWeeks: 1 | 2 | 3 | 4;
  weeks: RecurrenceWeek[];
  modality: CalendarModality;
  timezone: string;
  startDate: string;
  endDate: string | null;
  classTitle: string | null;
  activityKind: ActivityKind;
  participantIds: string[];
}

export interface RecurrenceSeriesValidationError {
  field: string;
  message: string;
}

/** Validación mínima temprana — la última palabra sigue siendo la base (constraints + assertRecurrenceRule al generar). */
export function validateNewRecurrenceSeriesInput(input: NewRecurrenceSeriesInput): RecurrenceSeriesValidationError[] {
  const errors: RecurrenceSeriesValidationError[] = [];
  if (input.participantIds.length === 0) {
    errors.push({ field: "participantIds", message: "Elegí al menos un alumno." });
  }
  if (input.cycleLengthWeeks < 1 || input.cycleLengthWeeks > 4) {
    errors.push({ field: "cycleLengthWeeks", message: "El ciclo debe tener entre 1 y 4 semanas." });
  }
  if (!input.weeks.some((week) => week.sessions.length > 0)) {
    errors.push({ field: "weeks", message: "Definí al menos un día y horario." });
  }
  if (!input.startDate.trim()) errors.push({ field: "startDate", message: "La fecha de inicio es obligatoria." });
  if (input.endDate && input.endDate < input.startDate) {
    errors.push({ field: "endDate", message: "La fecha de fin no puede ser anterior al inicio." });
  }
  return errors;
}

export function recurrenceSeriesInputToPayload(input: NewRecurrenceSeriesInput): Record<string, unknown> {
  return {
    primary_student_id: input.primaryStudentId,
    rule_type: input.ruleType,
    cycle_length_weeks: input.cycleLengthWeeks,
    weeks: input.weeks,
    modality: input.modality,
    timezone: input.timezone,
    start_date: input.startDate,
    end_date: input.endDate,
    class_title: input.classTitle,
    activity_kind: input.activityKind,
    participant_ids: input.participantIds,
  };
}
