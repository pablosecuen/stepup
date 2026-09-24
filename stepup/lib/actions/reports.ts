"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { getStudent } from "@/lib/repositories/students";
import { listCompletedRegistrationsForStudentReport } from "@/lib/repositories/lesson-registrations";
import {
  listReportRecordsForStudent,
  getReportRecord,
  createReportRecord,
  attachReportPdf,
  getSignedReportPdfUrl,
  deleteReportRecord,
  sweepPendingReportPdfCleanupJobs,
  ReportRecordNotFoundError,
} from "@/lib/repositories/reports";
import { claimReportDraft, startNewReportDraft, type ReportDraftTransition } from "@/lib/repositories/report-drafts";
import type { ReportRecordSummary } from "@/lib/repositories/reports-mapping";
import { getStudentMonthsWithClasses, computeSelectedMonthsRange, buildMonthsSummaryLabel } from "@/lib/reports/months";
import { evaluateGenerateReportOutcome } from "@/lib/reports/generate-outcome";
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

export interface GenerateStudentReportResult {
  report: ReportRecordSummary;
  /** true si esta llamada convergió en una fila YA existente en vez de crear una nueva (idempotencia real). */
  reused: boolean;
  /** true si la fila reutilizada YA estaba completa y corresponde a OTROS meses — nunca se devuelve en silencio como si fuera lo recién pedido. */
  staleClaim: boolean;
  warning: string | null;
}

export async function generateStudentReportAction(input: GenerateStudentReportInput): Promise<ActionResult<GenerateStudentReportResult>> {
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

    // Reclama (o reutiliza) el borrador activo REAL — atómico en la base
    // vía RPC (`claim_report_draft`). Dos requests concurrentes (doble
    // clic, dos pestañas, reintento tras respuesta perdida) convergen
    // siempre en el mismo operation_id, sin importar nada calculado en el
    // cliente. Nunca rota el claim acá — eso es una transición EXPLÍCITA
    // aparte (`startNewReportDraftAction`), nunca automática dentro de la
    // generación ni implícita en la previsualización.
    const operationId = await claimReportDraft(ctx, input.studentId);

    const { record, wasCreated } = await createReportRecord(ctx, {
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

    const outcome = evaluateGenerateReportOutcome(
      {
        selectedMonths: record.selectedMonths,
        pdfPath: record.pdfPath,
        narrativeText: record.snapshot.narrativeText,
        teacherNotes: record.snapshot.teacherNotes,
        includeClassDetail: record.snapshot.includeClassDetail,
        includePunctualitySummary: record.snapshot.includePunctualitySummary,
      },
      {
        selectedMonths: input.selectedMonths,
        narrativeText: input.narrativeText,
        teacherNotes: input.teacherNotes,
        includeClassDetail: input.includeClassDetail,
        includePunctualitySummary: input.includePunctualitySummary,
      },
      wasCreated
    );

    // Claim obsoleto: la fila reutilizada ya estaba completa y pertenece a
    // OTROS meses — nunca se renderiza/adjunta nada a nombre de este
    // request (no es su reporte), y se devuelve el reporte canónico real
    // junto con el aviso, nunca datos viejos disfrazados de nuevos.
    if (!outcome.staleClaim && !record.pdfPath) {
      // El PDF se renderiza SIEMPRE a partir de `record.snapshot` — nunca
      // de las variables locales recién calculadas por ESTE request: si
      // perdió la carrera de creación contra otro request concurrente, el
      // snapshot realmente persistido puede pertenecer al ganador, y el
      // PDF tiene que coincidir siempre con lo que la fila efectivamente
      // guardó.
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
    return {
      data: {
        report: {
          id: record.id,
          title: record.title,
          selectedMonths: record.selectedMonths,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
          generatedAt: record.generatedAt,
          hasPdf: outcome.staleClaim ? record.pdfPath !== null : true,
        },
        reused: outcome.reused,
        staleClaim: outcome.staleClaim,
        warning: outcome.warning,
      },
    };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

/**
 * Transición EXPLÍCITA para empezar una generación nueva — se dispara
 * cuando la usuaria elige armar otro reporte (nunca automáticamente apenas
 * llega una respuesta exitosa). Rota el `operation_id` server-side sólo si
 * el borrador activo ya tiene un reporte completo (`start_new_report_draft`,
 * atómica en Postgres); si sigue en curso, no rota nada. Devuelve
 * `transition` para que el llamador (la UI) sepa si REALMENTE arrancó una
 * operación nueva (`created`/`rotated`, seguro limpiar el formulario) o si
 * el claim seguía en curso (`in_progress`, nunca hay que limpiar nada).
 */
export async function startNewReportDraftAction(studentId: string): Promise<ActionResult<{ transition: ReportDraftTransition }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const student = await getStudent(ctx, studentId);
    if (!student) return { error: "Alumno no encontrado." };
    const { transition } = await startNewReportDraft(ctx, studentId);
    return { data: { transition } };
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
    // Reintento oportunista de limpieza pendiente — así un trabajo nunca
    // queda abandonado sólo porque la usuaria no vuelve a eliminar otro
    // reporte. Best-effort: nunca bloquea ni rompe la carga del historial.
    await sweepPendingReportPdfCleanupJobs(ctx).catch(() => {});
    return { data: reports };
  } catch (error) {
    return { error: friendlyErrorMessage(error) };
  }
}

/** Acción explícita de recuperación — reintenta toda limpieza de Storage pendiente del owner real, sin esperar a la próxima eliminación. */
export async function retryPendingReportCleanupAction(): Promise<ActionResult<{ resolvedCount: number }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const resolvedCount = await sweepPendingReportPdfCleanupJobs(ctx);
    return { data: { resolvedCount } };
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
