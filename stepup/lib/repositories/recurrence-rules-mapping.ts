import type { ActivityKind, CalendarModality, RecurrenceRuleRow, RecurrenceRuleStatus } from "../db/database.types.ts";
import type { RecurrenceWeek } from "../calendar/types.ts";
import { parseOperationId } from "../calendar/operation-id.ts";
import { deriveRuleEnd } from "../calendar/series-end.ts";

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
  /** Fin EFECTIVO del tramo: el menor entre su fin propio (`rawEndDate`) y la fecha de finalización de la serie. Es el que usan el motor, el linaje y todo lo que genera o cuenta clases. */
  endDate: string | null;
  /** Fin propio de la fila (corte de «esta y las siguientes» o fin fijado al crear la serie). Lo que se COPIA a una sucesora o se persiste, nunca `endDate`. */
  rawEndDate: string | null;
  /** Fecha de finalización de la serie entera (null = sin fecha). */
  seriesEndDate: string | null;
  /** Estado de la FILA tal cual está guardada (`status` puede salir `ended` sólo porque la fecha de la serie cae antes de que el tramo empiece a regir). */
  dbStatus: RecurrenceRuleStatus;
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
  const derived = deriveRuleEnd({ startDate: row.start_date, effectiveFromDate: row.effective_from_date, endDate: row.end_date, seriesEndDate: row.series_end_date ?? null, status: row.status });
  return {
    id: row.id,
    primaryStudentId: row.primary_student_id,
    ruleType: row.rule_type,
    cycleLengthWeeks: row.cycle_length_weeks as 1 | 2 | 3 | 4,
    weeks: row.weeks as unknown as RecurrenceWeek[],
    modality: row.modality,
    timezone: row.timezone,
    startDate: row.start_date,
    endDate: derived.endDate,
    rawEndDate: row.end_date,
    seriesEndDate: row.series_end_date ?? null,
    dbStatus: row.status,
    status: derived.status,
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
  /** UUID estable del borrador, generado una sola vez en el cliente — idempotencia real de la creación (20261001150000). Nunca se genera acá ni en la Server Action. */
  operationId: string;
  /** Elegido explícitamente por la profesora — nunca inferido del orden de `participantIds` (Fase 10, 20261001140000). Siempre obligatorio y siempre dentro de `participantIds`, validado acá y de nuevo en el RPC. */
  primaryStudentId: string;
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
  if (!parseOperationId(input.operationId)) {
    errors.push({ field: "operationId", message: "Falta la clave de idempotencia de la operación." });
  }
  if (input.participantIds.length === 0) {
    errors.push({ field: "participantIds", message: "Elegí al menos un alumno." });
  }
  if (!input.primaryStudentId) {
    errors.push({ field: "primaryStudentId", message: "Elegí quién es el alumno principal." });
  } else if (!input.participantIds.includes(input.primaryStudentId)) {
    errors.push({ field: "primaryStudentId", message: "El alumno principal debe estar entre los participantes seleccionados." });
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
    operation_id: input.operationId,
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
