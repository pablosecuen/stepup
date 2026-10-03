"use client";

import { useState } from "react";
import {
  previewStudentReportAction,
  generateStudentReportAction,
  startNewReportDraftAction,
  getReportSignedUrlAction,
  regenerateReportPdfAction,
  deleteReportAction,
  retryPendingReportCleanupAction,
  type StudentReportPreview,
} from "@/lib/actions/reports";
import { guardNetwork } from "@/lib/actions/network-guard";
import type { ReportRecordSummary } from "@/lib/repositories/reports-mapping";

const inputClassName =
  "w-full rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted transition-colors duration-150 ease-premium focus:outline-none focus-visible:border-brandBlue focus-visible:ring-2 focus-visible:ring-brandBlue";
const labelClassName = "text-sm font-medium text-textSecondary";

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-");
  const names = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${names[Number(monthNumber) - 1]} ${year}`;
}

/** Reemplaza (si ya existe, por id) o agrega al frente la fila canónica devuelta por el servidor — nunca una entrada construida desde el formulario local. */
function upsertHistoryEntry(prev: ReportRecordSummary[], entry: ReportRecordSummary): ReportRecordSummary[] {
  return [entry, ...prev.filter((r) => r.id !== entry.id)];
}

export function ReportesTabContent({
  studentId,
  studentName,
  monthsWithClasses,
  initialHistory,
}: {
  studentId: string;
  studentName: string;
  monthsWithClasses: string[];
  initialHistory: ReportRecordSummary[];
}) {
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<StudentReportPreview | null>(null);
  const [narrativeText, setNarrativeText] = useState("");
  const [generalComment, setGeneralComment] = useState("");
  const [behaviorAndParticipation, setBehaviorAndParticipation] = useState("");
  const [nextObjectives, setNextObjectives] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [includeClassDetail, setIncludeClassDetail] = useState(true);
  const [includePunctualitySummary, setIncludePunctualitySummary] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStartingNew, setIsStartingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [actionState, setActionState] = useState<{ id: string; kind: "view" | "regenerate" | "delete" } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [isRetryingCleanup, setIsRetryingCleanup] = useState(false);

  function resetForm() {
    setPreview(null);
    setSelectedMonths(new Set());
    setNarrativeText("");
    setGeneralComment("");
    setBehaviorAndParticipation("");
    setNextObjectives("");
    setRecommendations("");
  }

  function toggleMonth(month: string) {
    setSelectedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
    setPreview(null);
  }

  /** Previsualizar NUNCA rota el borrador activo — es una lectura pura, no una transición. */
  async function handlePreview() {
    setError(null);
    setWarning(null);
    setNotice(null);
    if (selectedMonths.size === 0) {
      setError("Elegí al menos un mes.");
      return;
    }
    setIsPreviewing(true);
    const result = await guardNetwork(() => previewStudentReportAction({ studentId, selectedMonths: [...selectedMonths] }));
    setIsPreviewing(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setPreview(result.data ?? null);
    setNarrativeText(result.data?.suggestedNarrative ?? "");
  }

  /** Generar/reintentar: SIEMPRE usa el borrador activo (reclamado server-side) — una respuesta perdida y un reintento posterior convergen en el mismo reporte. */
  async function handleGenerate() {
    if (!preview) return;
    setError(null);
    setWarning(null);
    setNotice(null);
    setIsGenerating(true);
    const result = await guardNetwork(() => generateStudentReportAction({
      studentId,
      selectedMonths: [...selectedMonths],
      narrativeText,
      teacherNotes: { generalComment, behaviorAndParticipation, nextObjectives, recommendations },
      includeClassDetail,
      includePunctualitySummary,
    }));
    setIsGenerating(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    // La fila que se agrega al historial es SIEMPRE la canónica devuelta
    // por el servidor — nunca una construida con los valores del
    // formulario actual, que pudieron no coincidir con la operación real
    // (ver `result.data.staleClaim`).
    const { report, staleClaim, warning: serverWarning } = result.data!;
    setHistory((prev) => upsertHistoryEntry(prev, report));

    if (staleClaim) {
      // El claim activo ya correspondía a un reporte completo con OTROS
      // meses — nunca se presenta en silencio como si fuera lo recién
      // pedido. Se conserva el formulario tal cual (nada se perdió); la
      // usuaria debe elegir "Crear otro reporte" para continuar.
      setWarning(serverWarning);
      return;
    }

    resetForm();
  }

  /**
   * Transición EXPLÍCITA y VISIBLE para empezar una generación nueva — la
   * única forma real de rotar el borrador activo. Si falla, se muestra el
   * error y se conserva todo el estado tal cual (nunca se sigue como si
   * hubiera rotado). El servidor informa `transition`: sólo con
   * 'created'/'rotated' arrancó de verdad una operación nueva y es seguro
   * limpiar el formulario — con 'in_progress' el claim seguía en curso (no
   * se rotó nada) y el formulario se conserva intacto, nunca se pierde
   * trabajo de la profesora por una respuesta exitosa que en realidad no
   * cambió nada.
   */
  async function handleStartNewReport() {
    setError(null);
    setNotice(null);
    setIsStartingNew(true);
    const result = await guardNetwork(() => startNewReportDraftAction(studentId));
    setIsStartingNew(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setWarning(null);
    if (result.data!.transition === "in_progress") {
      setNotice("Ya hay una generación en curso para este alumno — no se inició nada nuevo, tu formulario sigue igual.");
      return;
    }
    resetForm();
  }

  async function handleView(reportId: string) {
    setActionState({ id: reportId, kind: "view" });
    const result = await guardNetwork(() => getReportSignedUrlAction(reportId));
    setActionState(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.data?.url) window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  async function handleRegenerate(reportId: string) {
    setActionState({ id: reportId, kind: "regenerate" });
    const result = await guardNetwork(() => regenerateReportPdfAction(reportId));
    setActionState(null);
    if (result.error) setError(result.error);
  }

  async function handleDelete(reportId: string) {
    setActionState({ id: reportId, kind: "delete" });
    const result = await guardNetwork(() => deleteReportAction(reportId));
    setActionState(null);
    setConfirmingDeleteId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setHistory((prev) => prev.filter((r) => r.id !== reportId));
  }

  /** Acción explícita de recuperación — reintenta toda limpieza de Storage pendiente, sin esperar a la próxima eliminación ni a la próxima carga de página. */
  async function handleRetryCleanup() {
    setError(null);
    setIsRetryingCleanup(true);
    const result = await guardNetwork(() => retryPendingReportCleanupAction());
    setIsRetryingCleanup(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNotice(result.data!.resolvedCount > 0 ? `Se resolvieron ${result.data!.resolvedCount} archivo(s) pendiente(s) de limpieza.` : "No había limpieza pendiente.");
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="rounded-md border border-statusRojo/30 bg-statusRojo/5 px-4 py-3 text-sm text-statusRojo">{error}</div>}
      {warning && (
        <div className="rounded-md border border-statusAmarillo/40 bg-statusAmarillo/10 px-4 py-3 text-sm text-textPrimary">
          {warning}
          <button type="button" onClick={handleStartNewReport} disabled={isStartingNew} className="ml-2 font-semibold text-brandBlue underline hover:no-underline disabled:opacity-60">
            {isStartingNew ? "Iniciando..." : "Crear otro reporte"}
          </button>
        </div>
      )}
      {notice && <div className="rounded-md border border-brandBlue/30 bg-brandBlue/5 px-4 py-3 text-sm text-textPrimary">{notice}</div>}

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-textPrimary">Generar reporte</h2>
          <button
            type="button"
            onClick={handleStartNewReport}
            disabled={isStartingNew || isGenerating || isPreviewing}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary transition-colors hover:border-brandBlue/30 hover:text-brandBlue disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStartingNew ? "Iniciando..." : "Crear otro reporte"}
          </button>
        </div>
        {monthsWithClasses.length === 0 ? (
          <p className="mt-2 text-sm text-textMuted">Este alumno todavía no tiene clases dictadas registradas.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-textMuted">Elegí uno o varios meses reales con clases (no necesariamente consecutivos).</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {monthsWithClasses.map((month) => (
                <button
                  key={month}
                  type="button"
                  onClick={() => toggleMonth(month)}
                  className={`rounded-pill border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selectedMonths.has(month) ? "border-brandBlue bg-brandBlue text-white" : "border-border bg-background text-textSecondary hover:border-brandBlue/30"
                  }`}
                >
                  {monthLabel(month)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing || selectedMonths.size === 0}
              className="mt-4 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-textPrimary transition-colors hover:border-brandBlue/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPreviewing ? "Calculando..." : "Previsualizar"}
            </button>
          </>
        )}
      </section>

      {preview && (
        <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <h2 className="text-sm font-semibold text-textPrimary">{preview.monthsSummaryLabel}</h2>
          <p className="text-xs text-textMuted">
            {preview.periodStart} a {preview.periodEnd}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-textMuted">Clases dictadas</p>
              <p className="font-semibold text-textPrimary">{preview.data.classesHeld}</p>
            </div>
            <div>
              <p className="text-xs text-textMuted">Horas reales</p>
              <p className="font-semibold text-textPrimary">{preview.data.hoursTaught}</p>
            </div>
            <div>
              <p className="text-xs text-textMuted">Asistencia</p>
              <p className="font-semibold text-textPrimary">{preview.data.attendance.ratePercent !== null ? `${preview.data.attendance.ratePercent}%` : "Sin datos"}</p>
            </div>
            <div>
              <p className="text-xs text-textMuted">Promedio general</p>
              <p className="font-semibold text-textPrimary">{preview.data.generalAverageGrade ?? "Sin calificar"}</p>
            </div>
          </div>

          {preview.data.skillNotes.some((s) => s.averageGrade !== null) && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-textSecondary">Habilidades</p>
              <ul className="mt-1.5 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
                {preview.data.skillNotes
                  .filter((s) => s.averageGrade !== null)
                  .map((s) => (
                    <li key={s.skill} className="text-textSecondary">
                      {s.label}: <span className="font-semibold text-textPrimary">{s.averageGrade}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-1.5">
            <label htmlFor="narrativeText" className={labelClassName}>
              Vista previa (editable)
            </label>
            <textarea id="narrativeText" rows={8} value={narrativeText} onChange={(e) => setNarrativeText(e.target.value)} className={inputClassName} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="generalComment" className={labelClassName}>
                Comentario general
              </label>
              <textarea id="generalComment" rows={3} value={generalComment} onChange={(e) => setGeneralComment(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="behaviorAndParticipation" className={labelClassName}>
                Comportamiento y participación
              </label>
              <textarea id="behaviorAndParticipation" rows={3} value={behaviorAndParticipation} onChange={(e) => setBehaviorAndParticipation(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nextObjectives" className={labelClassName}>
                Próximos objetivos
              </label>
              <textarea id="nextObjectives" rows={3} value={nextObjectives} onChange={(e) => setNextObjectives(e.target.value)} className={inputClassName} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="recommendations" className={labelClassName}>
                Recomendaciones
              </label>
              <textarea id="recommendations" rows={3} value={recommendations} onChange={(e) => setRecommendations(e.target.value)} className={inputClassName} />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-textSecondary">
              <input type="checkbox" checked={includeClassDetail} onChange={(e) => setIncludeClassDetail(e.target.checked)} className="h-4 w-4 rounded border-border text-brandBlue" />
              Incluir detalle clase por clase
            </label>
            <label className="flex items-center gap-2 text-sm text-textSecondary">
              <input
                type="checkbox"
                checked={includePunctualitySummary}
                onChange={(e) => setIncludePunctualitySummary(e.target.checked)}
                className="h-4 w-4 rounded border-border text-brandBlue"
              />
              Puntualidad y asistencia
            </label>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mt-5 flex items-center justify-center gap-2 rounded-md bg-brandBlue px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 ease-premium hover:bg-brandBlueDark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? "Generando PDF..." : "Generar PDF"}
          </button>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-textSecondary">Historial de reportes</h2>
          <button
            type="button"
            onClick={handleRetryCleanup}
            disabled={isRetryingCleanup}
            className="text-xs font-semibold text-textMuted underline hover:text-brandBlue disabled:opacity-60"
          >
            {isRetryingCleanup ? "Reintentando..." : "Reintentar limpieza pendiente"}
          </button>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-textMuted">Todavía no se generó ningún reporte para este alumno.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {history.map((record) => (
              <li key={record.id} className="rounded-lg border border-border bg-surface p-4 shadow-card">
                <p className="text-sm font-semibold text-textPrimary">{record.title}</p>
                <p className="mt-0.5 text-xs text-textMuted">
                  {record.periodStart} a {record.periodEnd} · Generado el {new Date(record.generatedAt).toLocaleDateString("es-AR")}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleView(record.id)}
                    disabled={!record.hasPdf || actionState?.id === record.id}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textPrimary hover:border-brandBlue/30 disabled:opacity-50"
                  >
                    {actionState?.id === record.id && actionState.kind === "view" ? "Abriendo..." : "Ver / Descargar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegenerate(record.id)}
                    disabled={actionState?.id === record.id}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textPrimary hover:border-brandBlue/30 disabled:opacity-50"
                  >
                    {actionState?.id === record.id && actionState.kind === "regenerate" ? "Regenerando..." : "Regenerar"}
                  </button>
                  {confirmingDeleteId === record.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDelete(record.id)}
                        disabled={actionState?.id === record.id}
                        className="rounded-md border border-statusRojo/40 px-3 py-1.5 text-xs font-semibold text-statusRojo hover:border-statusRojo disabled:opacity-50"
                      >
                        {actionState?.id === record.id && actionState.kind === "delete" ? "Eliminando..." : "Confirmar eliminación"}
                      </button>
                      <button type="button" onClick={() => setConfirmingDeleteId(null)} className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary">
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(record.id)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-textSecondary hover:border-statusRojo/40 hover:text-statusRojo"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
