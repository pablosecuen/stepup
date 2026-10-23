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
import { LessonPhotoThumbnail } from "@/components/registro/lesson-photo-thumbnail";
import { MAX_REPORT_PHOTOS } from "@/lib/reports/evidence";
import type { ReportRecordSummary } from "@/lib/repositories/reports-mapping";
import { ArrowDownTrayIcon, ArrowPathIcon, CheckIcon, DocumentTextIcon, ExclamationTriangleIcon, TrashIcon } from "@heroicons/react/24/outline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextArea } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { formatCivilDate, formatCivilDateRange, formatCivilMonth, formatInstantDate } from "@/lib/format/date-format";
import { formatGrade, formatHours, formatPercent } from "@/lib/format/number-format";

/** Reemplaza (si ya existe, por id) o agrega al frente la fila canónica devuelta por el servidor — nunca una entrada construida desde el formulario local. */
function upsertHistoryEntry(prev: ReportRecordSummary[], entry: ReportRecordSummary): ReportRecordSummary[] {
  return [entry, ...prev.filter((r) => r.id !== entry.id)];
}

const CHECKBOX = "h-5 w-5 shrink-0 rounded border-[1.5px] border-borderStrong accent-ink";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border-[1.5px] border-border bg-surface2 px-3.5 py-3">
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      <p className="mt-1 font-display text-[26px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

/** Vista previa del reporte y el formulario para generarlo (presentación; el estado vive en `ReportesTabContent`). */
export function ReportPreviewCard({
  preview,
  narrativeText,
  onNarrativeText,
  generalComment,
  onGeneralComment,
  behaviorAndParticipation,
  onBehaviorAndParticipation,
  nextObjectives,
  onNextObjectives,
  recommendations,
  onRecommendations,
  includeClassDetail,
  onIncludeClassDetail,
  includePunctualitySummary,
  onIncludePunctualitySummary,
  includeIndividualObservations,
  onIncludeIndividualObservations,
  selectedEvidenceIds,
  onToggleEvidence,
  unreadableEvidenceIds,
  onEvidenceUnreadable,
  isGenerating,
  onGenerate,
}: {
  preview: StudentReportPreview;
  narrativeText: string;
  onNarrativeText: (value: string) => void;
  generalComment: string;
  onGeneralComment: (value: string) => void;
  behaviorAndParticipation: string;
  onBehaviorAndParticipation: (value: string) => void;
  nextObjectives: string;
  onNextObjectives: (value: string) => void;
  recommendations: string;
  onRecommendations: (value: string) => void;
  includeClassDetail: boolean;
  onIncludeClassDetail: (value: boolean) => void;
  includePunctualitySummary: boolean;
  onIncludePunctualitySummary: (value: boolean) => void;
  includeIndividualObservations: boolean;
  onIncludeIndividualObservations: (value: boolean) => void;
  /** Fotos y PDF elegidos para el reporte (ninguno viene preseleccionado). */
  selectedEvidenceIds: string[];
  onToggleEvidence: (attachmentId: string) => void;
  /** Fotos que el servidor no pudo leer (HEIC inválido, imagen dañada): se muestran como «no se puede usar» y nunca se pueden elegir. */
  unreadableEvidenceIds: string[];
  onEvidenceUnreadable: (attachmentId: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  const topicsSeen = preview.data.topicsSeen ?? [];
  const evidenceCandidates = preview.data.evidenceCandidates ?? [];
  // Como la app anterior: hasta 12 fotos por reporte (los PDF no cuentan); al llegar al tope las demás fotos quedan sin poder elegirse y el texto lo dice.
  const photoKindById = new Map(evidenceCandidates.map((candidate) => [candidate.attachmentId, candidate.kind]));
  const selectedPhotos = selectedEvidenceIds.filter((id) => photoKindById.get(id) === "image").length;
  const photosFull = selectedPhotos >= MAX_REPORT_PHOTOS;
  return (
    <Card>
      <h2 className="font-display text-section font-semibold">{preview.monthsSummaryLabel}</h2>
      <p className="text-[14px] text-textMuted">{formatCivilDateRange(preview.periodStart, preview.periodEnd)}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Clases dictadas" value={String(preview.data.classesHeld)} />
        <Stat label="Horas reales" value={formatHours(preview.data.hoursTaught)} />
        <Stat label="Asistencia" value={preview.data.attendance.ratePercent !== null ? formatPercent(preview.data.attendance.ratePercent) : "Sin datos"} />
        <Stat label="Promedio general" value={preview.data.generalAverageGrade !== null ? formatGrade(preview.data.generalAverageGrade) : "Sin calificar"} />
      </div>

      {preview.data.skillNotes.some((s) => s.averageGrade !== null) && (
        <div className="mt-4">
          <p className="text-label font-bold uppercase text-textMuted">Habilidades</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {preview.data.skillNotes
              .filter((s) => s.averageGrade !== null)
              .map((s) => (
                <li key={s.skill} className="inline-flex min-h-[26px] items-center rounded-pill border border-border bg-paperDeep px-2.5 text-[12.5px] font-[650] text-textSecondary">
                  {s.label}: {formatGrade(s.averageGrade)}
                </li>
              ))}
          </ul>
        </div>
      )}

      {topicsSeen.length > 0 && (
        <div className="mt-4">
          <p className="text-label font-bold uppercase text-textMuted">Temas trabajados</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {topicsSeen.map((topic) => (
              <li key={topic} className="inline-flex min-h-[26px] items-center rounded-pill border border-border bg-paperDeep px-2.5 text-[12.5px] font-[650] text-textSecondary [overflow-wrap:anywhere]">
                {topic}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-5">
        <Field label="Vista previa (editable)" htmlFor="narrativeText">
          <TextArea id="narrativeText" rows={8} value={narrativeText} onChange={(e) => onNarrativeText(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Comentario general" htmlFor="generalComment">
            <TextArea id="generalComment" rows={3} value={generalComment} onChange={(e) => onGeneralComment(e.target.value)} />
          </Field>
          <Field label="Comportamiento y participación" htmlFor="behaviorAndParticipation">
            <TextArea id="behaviorAndParticipation" rows={3} value={behaviorAndParticipation} onChange={(e) => onBehaviorAndParticipation(e.target.value)} />
          </Field>
          <Field label="Próximos objetivos" htmlFor="nextObjectives">
            <TextArea id="nextObjectives" rows={3} value={nextObjectives} onChange={(e) => onNextObjectives(e.target.value)} />
          </Field>
          <Field label="Recomendaciones" htmlFor="recommendations">
            <TextArea id="recommendations" rows={3} value={recommendations} onChange={(e) => onRecommendations(e.target.value)} />
          </Field>
        </div>
      </div>

      {evidenceCandidates.length > 0 && (
        <fieldset className="mt-5 min-w-0">
          <legend className="text-label font-bold uppercase text-textMuted">Evidencias y materiales (opcional)</legend>
          <p className="mt-1 text-[14px] text-textMuted">Elegí qué fotos o PDF de las clases incluir en el reporte. Ninguna se incluye si no la elegís. Podés incluir hasta {MAX_REPORT_PHOTOS} fotos.</p>
          <p className="mt-1 text-[14px] text-textMuted">Evitá incluir imágenes de alumnos o información sensible sin autorización.</p>
          {photosFull && (
            <p role="status" className="mt-1 text-[14px] font-semibold text-textSecondary">
              Ya elegiste las {MAX_REPORT_PHOTOS} fotos que entran en un reporte. Para sumar otra, sacá una de las elegidas.
            </p>
          )}
          <ul className="mt-2 flex flex-col">
            {evidenceCandidates.map((candidate) => {
              const unreadable = unreadableEvidenceIds.includes(candidate.attachmentId);
              return (
                <li key={candidate.attachmentId}>
                  <label className="flex min-h-11 items-start gap-3 py-2 text-[15px] text-textSecondary">
                    <input type="checkbox" className={`${CHECKBOX} mt-0.5`} checked={!unreadable && selectedEvidenceIds.includes(candidate.attachmentId)} disabled={unreadable || (photosFull && candidate.kind === "image" && !selectedEvidenceIds.includes(candidate.attachmentId))} onChange={() => onToggleEvidence(candidate.attachmentId)} />
                    {candidate.kind === "image" && <LessonPhotoThumbnail id={candidate.attachmentId} name={candidate.name} onUnreadable={onEvidenceUnreadable} />}
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-[650] text-textPrimary">{candidate.name}</span> · {candidate.kind === "image" ? "Foto" : "PDF"} · {formatCivilDate(candidate.dateKey)}
                      {candidate.caption && <span className="block text-[13px] text-textMuted">{candidate.caption}</span>}
                      {unreadable && (
                        <span role="alert" className="block text-[13px] font-semibold text-bad">
                          No se puede usar en el reporte: la foto no se puede leer. El original sigue guardado en la clase.
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div className="mt-4 flex flex-col">
        <label className="flex min-h-11 items-center gap-3 text-[15px] text-textSecondary">
          <input type="checkbox" checked={includeClassDetail} onChange={(e) => onIncludeClassDetail(e.target.checked)} className={CHECKBOX} />
          Incluir detalle clase por clase
        </label>
        <label className="flex min-h-11 items-center gap-3 text-[15px] text-textSecondary">
          <input type="checkbox" checked={includePunctualitySummary} onChange={(e) => onIncludePunctualitySummary(e.target.checked)} className={CHECKBOX} />
          Puntualidad y asistencia
        </label>
        <label className="flex min-h-11 items-start gap-3 py-2 text-[15px] text-textSecondary">
          <input type="checkbox" checked={includeIndividualObservations} onChange={(e) => onIncludeIndividualObservations(e.target.checked)} className={`${CHECKBOX} mt-0.5`} />
          <span>
            Incluir mis observaciones individuales de cada clase
            <span className="block text-[13.5px] text-textMuted">Se publican tal como las escribiste en el registro («puede aparecer en su reporte»). Las observaciones internas de la clase nunca se incluyen.</span>
          </span>
        </label>
      </div>

      <Button variant="accent" onClick={onGenerate} busy={isGenerating} className="mt-5 w-full sm:w-auto">
        {!isGenerating && <DocumentTextIcon className="h-5 w-5" aria-hidden />}
        {isGenerating ? "Generando PDF..." : "Generar PDF"}
      </Button>
    </Card>
  );
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
  // Opción deliberada: lo escrito en el registro no se publica sin que la profesora lo elija para este reporte.
  const [includeIndividualObservations, setIncludeIndividualObservations] = useState(false);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<string[]>([]);
  const [unreadableEvidenceIds, setUnreadableEvidenceIds] = useState<string[]>([]);
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
    setSelectedEvidenceIds([]);
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
    setSelectedEvidenceIds([]);
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
    setSelectedEvidenceIds([]);
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
      includeIndividualObservations,
      selectedEvidenceIds,
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

  const confirmingRecord = confirmingDeleteId ? history.find((r) => r.id === confirmingDeleteId) : undefined;
  const isDeleting = actionState?.kind === "delete" && actionState.id === confirmingDeleteId;

  return (
    <div className="flex flex-col gap-6">
      {error && <Notice tone="bad">{error}</Notice>}
      {warning && (
        <Notice tone="warn">
          {warning}
          <Button variant="secondary" onClick={handleStartNewReport} busy={isStartingNew} className="mt-3">
            {isStartingNew ? "Iniciando..." : "Crear otro reporte"}
          </Button>
        </Notice>
      )}
      {notice && <Notice tone="info">{notice}</Notice>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="font-display text-card font-semibold">Generar reporte</h2>
          <Button variant="ghost" onClick={handleStartNewReport} disabled={isGenerating || isPreviewing} busy={isStartingNew}>
            {isStartingNew ? "Iniciando..." : "Crear otro reporte"}
          </Button>
        </div>
        {monthsWithClasses.length === 0 ? (
          <p className="mt-2 text-[15px] text-textMuted">Este alumno todavía no tiene clases dictadas registradas.</p>
        ) : (
          <>
            <p className="mt-1 text-[14px] text-textMuted">Elegí uno o varios meses reales con clases (no necesariamente consecutivos).</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {monthsWithClasses.map((month) => {
                const selected = selectedMonths.has(month);
                return (
                  <button
                    key={month}
                    type="button"
                    onClick={() => toggleMonth(month)}
                    aria-pressed={selectedMonths.has(month)}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${
                      selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
                    }`}
                  >
                    {selected && <CheckIcon className="h-4 w-4" aria-hidden />}
                    <span className="inline-block first-letter:uppercase">{formatCivilMonth(month)}</span>
                  </button>
                );
              })}
            </div>
            <Button variant={preview ? "secondary" : "primary"} onClick={handlePreview} busy={isPreviewing} disabled={selectedMonths.size === 0} className="mt-4">
              {isPreviewing ? "Calculando..." : "Previsualizar"}
            </Button>
          </>
        )}
      </Card>

      {preview && (
        <ReportPreviewCard
          preview={preview}
          narrativeText={narrativeText}
          onNarrativeText={setNarrativeText}
          generalComment={generalComment}
          onGeneralComment={setGeneralComment}
          behaviorAndParticipation={behaviorAndParticipation}
          onBehaviorAndParticipation={setBehaviorAndParticipation}
          nextObjectives={nextObjectives}
          onNextObjectives={setNextObjectives}
          recommendations={recommendations}
          onRecommendations={setRecommendations}
          includeClassDetail={includeClassDetail}
          onIncludeClassDetail={setIncludeClassDetail}
          includePunctualitySummary={includePunctualitySummary}
          onIncludePunctualitySummary={setIncludePunctualitySummary}
          includeIndividualObservations={includeIndividualObservations}
          onIncludeIndividualObservations={setIncludeIndividualObservations}
          selectedEvidenceIds={selectedEvidenceIds}
          unreadableEvidenceIds={unreadableEvidenceIds}
          onEvidenceUnreadable={(attachmentId) => {
            setUnreadableEvidenceIds((current) => (current.includes(attachmentId) ? current : [...current, attachmentId]));
            setSelectedEvidenceIds((current) => current.filter((id) => id !== attachmentId));
          }}
          onToggleEvidence={(attachmentId) => setSelectedEvidenceIds((current) => (current.includes(attachmentId) ? current.filter((id) => id !== attachmentId) : [...current, attachmentId]))}
          isGenerating={isGenerating}
          onGenerate={handleGenerate}
        />
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-label font-bold uppercase text-textMuted">Historial de reportes</h2>
          <Button variant="ghost" onClick={handleRetryCleanup} busy={isRetryingCleanup}>
            {isRetryingCleanup ? "Reintentando..." : "Reintentar limpieza pendiente"}
          </Button>
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-[15px] text-textMuted">Todavía no se generó ningún reporte para este alumno.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {history.map((record) => {
              const busy = actionState?.id === record.id;
              return (
                <li key={record.id}>
                  <Card className="!p-4">
                    <div className="flex items-start gap-3">
                      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-accentSoft text-accentText">
                        <DocumentTextIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-[19px] font-semibold leading-tight tracking-tight text-textPrimary [overflow-wrap:anywhere]">{record.title}</p>
                        <p className="mt-0.5 text-[13.5px] text-textMuted">
                          {formatCivilDateRange(record.periodStart, record.periodEnd)} · Generado el {formatInstantDate(record.generatedAt)}
                        </p>
                        {!record.hasPdf && (
                          <div className="mt-2">
                            <Badge tone="warn" icon={<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />}>
                              PDF no disponible
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={() => handleView(record.id)} disabled={!record.hasPdf || busy} busy={busy && actionState?.kind === "view"}>
                        {busy && actionState?.kind === "view" ? "Abriendo..." : (
                          <>
                            <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
                            Ver / Descargar
                          </>
                        )}
                      </Button>
                      <Button variant="ghost" onClick={() => handleRegenerate(record.id)} disabled={busy} busy={busy && actionState?.kind === "regenerate"}>
                        {busy && actionState?.kind === "regenerate" ? "Regenerando..." : (
                          <>
                            <ArrowPathIcon className="h-4 w-4" aria-hidden />
                            Regenerar
                          </>
                        )}
                      </Button>
                      <Button variant="dangerGhost" onClick={() => setConfirmingDeleteId(record.id)} aria-haspopup="dialog" className="sm:ml-auto">
                        <TrashIcon className="h-4 w-4" aria-hidden />
                        Eliminar
                      </Button>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {confirmingRecord && (
        <Dialog
          title="Eliminar reporte"
          size="sm"
          onClose={() => setConfirmingDeleteId(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmingDeleteId(null)}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={() => handleDelete(confirmingRecord.id)} busy={isDeleting}>
                {isDeleting ? "Eliminando..." : "Confirmar eliminación"}
              </Button>
            </>
          }
        >
          <p className="text-[15px] text-textSecondary [overflow-wrap:anywhere]">
            Vas a eliminar <b className="text-textPrimary">{confirmingRecord.title}</b> del historial de {studentName}.
          </p>
        </Dialog>
      )}
    </div>
  );
}
