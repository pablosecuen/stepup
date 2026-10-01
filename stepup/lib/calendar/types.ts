import type { CalendarModality, RecurrenceRuleStatus, ActivityKind, CalendarLessonStatus, CalendarLessonType } from "@/lib/db/database.types";

export type { CalendarModality, RecurrenceRuleStatus, ActivityKind, CalendarLessonStatus, CalendarLessonType };

/** jsonb `weeks` de `recurrence_rules` — misma forma exacta que `RecurrenceWeek[]` del móvil. */
export interface RecurrenceSession {
  weekday: number; // AppWeekday: lunes=0..domingo=6
  hour: number;
  minute: number;
  durationMinutes: number;
}

export interface RecurrenceWeek {
  weekIndex: number;
  sessions: RecurrenceSession[];
}

/** Forma mínima que necesita el motor puro — un subconjunto de RecurrenceRuleRecord real. */
export interface RecurrenceRuleForEngine {
  recurrenceId: string;
  studentId: string | null;
  /** Roster COMPLETO de la serie — studentId (primario) SIEMPRE incluido acá también, nunca sólo los secundarios (contrato confirmado 2026-09-30, ver recurrence_rule_participants en 20260916120200_calendar.sql). */
  participantIds: string[];
  cycleLengthWeeks: number;
  weeks: RecurrenceWeek[];
  modality: CalendarModality;
  timezone: string;
  startDate: string; // YYYY-MM-DD, siempre lunes de la semana 0
  endDate: string | null;
  status: RecurrenceRuleStatus;
  classTitle: string | null;
  activityKind: ActivityKind;
}

export type MaterializationStatus = "virtual" | "materialized" | "cancelled" | "rescheduled";

export interface GeneratedOccurrence {
  occurrenceKey: string;
  recurrenceId: string;
  studentId: string | null;
  participantIds: string[];
  absoluteWeekNumber: number;
  weekIndexInCycle: number;
  weekday: number;
  sessionIndex: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  modality: CalendarModality;
  start: string; // ISO instant
  end: string; // ISO instant
  materializationStatus: MaterializationStatus;
  materializedLessonId: string | null;
  classTitle: string | null;
  activityKind: ActivityKind;
}

/** Forma mínima que necesita `applyExceptionsToOccurrences` de una excepción real. */
export interface RecurrenceExceptionForEngine {
  recurrenceId: string;
  occurrenceKey: string;
  type: "cancelled" | "rescheduled" | "excluded";
  replacementLessonId?: string | null;
}

/** Forma mínima que necesita el motor de una clase materializada real. */
export interface CalendarLessonForEngine {
  id: string;
  recurrenceId: string | null;
  recurrenceOccurrenceKey: string | null;
  status: CalendarLessonStatus;
}
