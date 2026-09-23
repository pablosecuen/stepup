"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import {
  listReportRecordsForStudent,
  getReportRecord,
  getReportRecordByOperationId,
  createReportRecord,
  attachReportPdf,
  getSignedReportPdfUrl,
  deleteReportRecord,
  ReportRecordNotFoundError,
} from "@/lib/repositories/reports";
import { claimReportDraft, releaseReportDraft } from "@/lib/repositories/report-drafts";
import { isClaimStaleForRequest } from "@/lib/reports/draft-claim";
import type { ReportRecordSummary } from "@/lib/repositories/reports-mapping";
import { getStudentMonthsWithClasses, computeSelectedMonthsRange, buildMonthsSummaryLabel } from "@/lib/reports/months";
import { buildStudentReportData, type StudentReportData } from "@/lib/reports/student-report-data";
import { buildDeterministicReportNarrative, type StudentReportTeacherNotes } from "@/lib/reports/narrative";
import { renderReportPdf } from "@/lib/reports/pdf";
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE } from "@/lib/payments/dates";
import type { ActionResult } from "./lesson-registrations";

// Server Actions — Reportes por alumno (Fase 7). Nunca confían en
// studentId/reportId/fechas/texto/operationId enviados por el cliente sin
// re-verificar: cada acción vuelve a resolver la sesión real y filtra
// explícitamente por owner_id (además de RLS), y `getStudent`/
// `getReportRecord` devuelven `null`/lanzan si el recurso no pertenece al
// usuario autenticado — un usuario nunca puede leer, regenerar ni eliminar
// reportes ajenos. El `operation_id` real de idempotencia NUNCA lo manda
// el cliente: nace siempre server-side vía `claimReportDraft` (ver
// `lib/repositories/report-drafts.ts`), que es la única autoridad real de
// que dos pestañas/reintentos concurrentes converjan en un solo reporte.

function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ReportRecordNotFoundError) return "El reporte no existe o no te pertenece.";
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

export interface StudentReportMonthsInfo {
  monthsWithClasses: string[];
}

export async function loadStudentReportMonthsAction(studentId: string): Promise<ActionResult<StudentReportMonthsInfo>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, studentId);
    if (!student) return { error: "Alumno no encontrado." };
    const todayDateKey = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    const registrations = await listCompletedRegistrationsForStudentReport(ctx, studentId);
    const monthsWithClasses = getStudentMonthsWithClasses(
      registrations.map((r) => ({ countsAsClass: true, dateKey: r.dateKey })),
      todayDateKey
    );
    return { data: { monthsWithClasses } };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

export interface StudentReportPreview {
  studentName: string;
  monthsSummaryLabel: string;
  periodStart: string;
  periodEnd: string;
  data: StudentReportData;
  suggestedNarrative: string;
}

export async function previewStudentReportAction(input: { studentId: string; selectedMonths: string[] }): Promise<ActionResult<StudentReportPreview>> {
  if (input.selectedMonths.length === 0) return { error: "Elegí al menos un mes." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, input.studentId);
    if (!student) return { error: "Alumno no encontrado." };

    const todayDateKey = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    const registrations = await listCompletedRegistrationsForStudentReport(ctx, input.studentId);
    const range = computeSelectedMonthsRange(
      registrations.map((r) => ({ countsAsClass: true, dateKey: r.dateKey })),
      input.selectedMonths,
      todayDateKey
    );
    if (!range) return { error: "No hay clases reales en los meses elegidos." };

    const monthSet = new Set(input.selectedMonths);
    const inRange = registrations.filter((r) => monthSet.has(r.dateKey.slice(0, 7)));
    const data = buildStudentReportData(inRange);
    const emptyNotes: StudentReportTeacherNotes = { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" };
    const suggestedNarrative = buildDeterministicReportNarrative(data, emptyNotes);

    return {
      data: {
        studentName: student.name,
        monthsSummaryLabel: buildMonthsSummaryLabel(input.selectedMonths),
        periodStart: range.periodStart,
        periodEnd: range.periodEnd,
        data,
        suggestedNarrative,
      },
    };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

export interface GenerateStudentReportInput {
  studentId: string;
  selectedMonths: string[];
  narrativeText: string;
  teacherNotes: StudentReportTeacherNotes;
  includeClassDetail: boolean;
  includePunctualitySummary: boolean;
}

export async function generateStudentReportAction(input: GenerateStudentReportInput): Promise<ActionResult<{ reportId: string }>> {
  if (input.selectedMonths.length === 0) return { error: "Elegí al menos un mes." };
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, input.studentId);
    if (!student) return { error: "Alumno no encontrado." };

    const todayDateKey = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    const registrations = await listCompletedRegistrationsForStudentReport(ctx, input.studentId);
    const range = computeSelectedMonthsRange(
      registrations.map((r) => ({ countsAsClass: true, dateKey: r.dateKey })),
      input.selectedMonths,
      todayDateKey
    );
    if (!range) return { error: "No hay clases reales en los meses elegidos." };

    const monthSet = new Set(input.selectedMonths);
    const inRange = registrations.filter((r) => monthSet.has(r.dateKey.slice(0, 7)));
    const data = buildStudentReportData(inRange);
    const monthsSummaryLabel = buildMonthsSummaryLabel(input.selectedMonths);
    const title = `Reporte de ${student.name} — ${monthsSummaryLabel}`;

    // Reclama el borrador activo REAL (server-side) para este alumno. Dos
    // requests concurrentes (doble clic, dos pestañas) convergen siempre
    // en el mismo operation_id acá, sin importar nada que hayan calculado
    // por separado en el cliente.
    let operationId = await claimReportDraft(ctx, input.studentId);
    const existing = await getReportRecordByOperationId(ctx, operationId);
    if (isClaimStaleForRequest(existing ? { selectedMonths: existing.selectedMonths, pdfPath: existing.pdfPath } : null, input.selectedMonths)) {
      // El claim activo pertenece a una generación anterior YA completa,
      // con OTROS meses — la usuaria nunca liberó el claim de forma
      // explícita (por ejemplo, la transición posterior al éxito falló),
      // pero pide ahora algo genuinamente distinto. Nunca se le devuelve
      // el reporte viejo: se rota el claim y se reclama uno nuevo.
      await releaseReportDraft(ctx, input.studentId);
      operationId = await claimReportDraft(ctx, input.studentId);
    }

    const record = await createReportRecord(ctx, {
      operationId,
      studentId: input.studentId,
      title,
      selectedMonths: input.selectedMonths,
      periodStart: range.periodStart,
      periodEnd: range.periodEnd,
      snapshot: {
        data,
        narrativeText: input.narrativeText,
        includeClassDetail: input.includeClassDetail,
        includePunctualitySummary: input.includePunctualitySummary,
        teacherNotes: input.teacherNotes,
        studentName: student.name,
        monthsSummaryLabel,
      },
    });

    // El PDF se renderiza SIEMPRE a partir de `record.snapshot` — nunca de
    // las variables locales recién calculadas por ESTE request: si perdió
    // la carrera de creación contra otro request concurrente, el snapshot
    // realmente persistido puede pertenecer al ganador, y el PDF tiene que
    // coincidir siempre con lo que la fila efectivamente guardó.
    if (!record.pdfPath) {
      const pdfBytes = await renderReportPdf({
        studentName: record.snapshot.studentName,
        title: record.title,
        monthsSummaryLabel: record.snapshot.monthsSummaryLabel,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        generatedAtDateKey: todayDateKey,
        data: record.snapshot.data,
        narrativeText: record.snapshot.narrativeText,
        options: { includeClassDetail: record.snapshot.includeClassDetail, includePunctualitySummary: record.snapshot.includePunctualitySummary },
      });
      await attachReportPdf(ctx, record.id, pdfBytes);
    }

    revalidatePath(`/alumnos/${input.studentId}`);
    return { data: { reportId: record.id } };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

/**
 * Transición EXPLÍCITA posterior a un éxito confirmado: sólo después de
 * que la pestaña recibió de verdad la respuesta de
 * `generateStudentReportAction` (nunca automáticamente en el servidor, lo
 * que rompería el reintento ante una respuesta perdida) libera el claim
 * activo, para que una generación nueva e intencional pueda reclamar un
 * `operation_id` distinto.
 */
export async function startNewReportDraftAction(studentId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, studentId);
    if (!student) return { error: "Alumno no encontrado." };
    await releaseReportDraft(ctx, studentId);
    return {};
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

export async function listStudentReportsAction(studentId: string): Promise<ActionResult<ReportRecordSummary[]>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, studentId);
    if (!student) return { error: "Alumno no encontrado." };
    const reports = await listReportRecordsForStudent(ctx, studentId);
    return { data: reports };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

export async function getReportSignedUrlAction(reportId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const url = await getSignedReportPdfUrl(ctx, reportId);
    return { data: { url } };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

/**
 * Reconstruye el PDF EXACTAMENTE igual usando el snapshot ya guardado —
 * nunca vuelve a leer clases/evaluaciones actuales, para no incluir datos
 * posteriores a la generación original del reporte (mismo criterio real
 * del móvil, `handleRegenerate`).
 */
export async function regenerateReportPdfAction(reportId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const record = await getReportRecord(ctx, reportId);
    if (!record) return { error: "El reporte no existe o no te pertenece." };

    const generatedAtDateKey = localDateKeyInTimeZone(new Date(record.generatedAt), ARGENTINA_TIME_ZONE);
    const pdfBytes = await renderReportPdf({
      studentName: record.snapshot.studentName,
      title: record.title,
      monthsSummaryLabel: record.snapshot.monthsSummaryLabel,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      generatedAtDateKey,
      data: record.snapshot.data,
      narrativeText: record.snapshot.narrativeText,
      options: { includeClassDetail: record.snapshot.includeClassDetail, includePunctualitySummary: record.snapshot.includePunctualitySummary },
    });
    await attachReportPdf(ctx, record.id, pdfBytes);
    revalidatePath(`/alumnos/${record.studentId}`);
    return {};
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

export async function deleteReportAction(reportId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const record = await getReportRecord(ctx, reportId);
    if (!record) return { error: "El reporte no existe o no te pertenece." };
    await deleteReportRecord(ctx, reportId);
    revalidatePath(`/alumnos/${record.studentId}`);
    return {};
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}
