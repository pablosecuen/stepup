import type { ReportRecordRow } from "../db/database.types.ts";
import type { StudentReportData } from "../reports/student-report-data.ts";
import type { StudentReportTeacherNotes } from "../reports/narrative.ts";

/**
 * Lógica PURA del repositorio de reportes — espeja `ReportRecord`/
 * `ReportRecordSnapshot` (móvil). El snapshot guarda TODO lo necesario
 * para regenerar el PDF sin volver a consultar clases/evaluaciones —
 * nunca se recalcula al ver o regenerar un reporte ya generado.
 */
export interface ReportRecordSnapshot {
  data: StudentReportData;
  narrativeText: string;
  includeClassDetail: boolean;
  includePunctualitySummary: boolean;
  teacherNotes: StudentReportTeacherNotes;
  studentName: string;
  monthsSummaryLabel: string;
}

export const REPORT_RECORD_SCHEMA_VERSION = 1;

export interface ReportRecord {
  id: string;
  studentId: string;
  title: string;
  selectedMonths: string[];
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  pdfPath: string | null;
  snapshot: ReportRecordSnapshot;
  schemaVersion: number;
  operationId: string | null;
}

/** DTO mínimo real para el historial — nunca el snapshot completo (que puede ser pesado y no hace falta para listar). */
export interface ReportRecordSummary {
  id: string;
  title: string;
  selectedMonths: string[];
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  hasPdf: boolean;
}

export function toReportRecord(row: ReportRecordRow): ReportRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    title: row.title,
    selectedMonths: row.selected_months,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    pdfPath: row.pdf_url,
    snapshot: row.snapshot as unknown as ReportRecordSnapshot,
    schemaVersion: row.schema_version,
    operationId: row.operation_id,
  };
}

export function toReportRecordSummary(row: ReportRecordRow): ReportRecordSummary {
  return {
    id: row.id,
    title: row.title,
    selectedMonths: row.selected_months,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    generatedAt: row.generated_at,
    hasPdf: row.pdf_url !== null,
  };
}
