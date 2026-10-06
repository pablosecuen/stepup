"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { formatImportCounts } from "@/lib/backup/import-count-labels";
import { listImportRunsAction, previewUndoImportAction, applyUndoImportAction, discardImportUndoAction } from "@/lib/actions/backup";
import { guardNetwork } from "@/lib/actions/network-guard";
import { computeUndoAvailability, type ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";
import type { UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import { countOf, translateImportError, type ImportErrorContext } from "@/lib/backup/import-copy";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { BUTTON_SECONDARY } from "@/components/account/settings-ui";
import { DiscardUndoControl, ImportErrorBox, UndoReviewPanel } from "@/components/backup/import-ui";
import { formatInstantDateTime } from "@/lib/format/date-format";

// Fase 9 — historial real de importaciones. Sobrevive a recarga, cierre
// del navegador y otra sesión web porque lee `import_runs` real (nunca
// depende de estado en memoria de React) — se carga fresco cada vez que
// este componente monta.

const STATUS_LABEL: Record<ImportRunHistoryRow["status"], string> = {
  applied: "Aplicada",
  undone: "Deshecha",
};

function HistoryRow({ run, onChanged }: { run: ImportRunHistoryRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [undoState, setUndoState] = useState<UndoBlockedPreview | null>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const restoreReviewFocus = useRef(false);

  const availability = computeUndoAvailability(run, new Date());

  // Al cerrar la revisión de «deshacer», el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (!undoState && restoreReviewFocus.current) {
      restoreReviewFocus.current = false;
      reviewButtonRef.current?.focus();
    }
  }, [undoState]);

  function fail(result: { error?: string; errorCode?: string }, fallback: string, context: ImportErrorContext) {
    const translated = result.errorCode ? null : translateImportError(result.error ?? fallback, context);
    setError(translated ? translated.message : (result.error ?? fallback));
    setErrorCode(translated ? translated.code : (result.errorCode ?? null));
  }

  function clearError() {
    setError(null);
    setErrorCode(null);
  }

  function handlePreviewUndo() {
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => previewUndoImportAction(run.id));
      if (result.error || !result.data) {
        fail(result, "No pudimos revisar si se puede deshacer. Intentá de nuevo.", "undoPreview");
        return;
      }
      setUndoState(result.data);
    });
  }

  function handleApplyUndo() {
    if (!undoState) return;
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => applyUndoImportAction(undoState.undoPreviewId));
      if (result.error || !result.data) {
        fail(result, "No pudimos deshacer la importación. Nada se tocó — intentá de nuevo.", "undo");
        return;
      }
      setUndoState(null);
      onChanged();
    });
  }

  function handleDiscardUndo() {
    clearError();
    startTransition(async () => {
      const result = await guardNetwork(() => discardImportUndoAction(run.id));
      if (result.error || !result.data) {
        fail(result, "No pudimos quitar la opción de deshacer. Sigue disponible.", "discard");
        return;
      }
      onChanged();
    });
  }

  const counts = run.countsByTable ? formatImportCounts(run.countsByTable) : "";

  return (
    <li className="rounded-md border border-border bg-surface p-3.5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-textPrimary">{formatInstantDateTime(run.createdAt)}</p>
          <p className="text-sm text-textMuted">
            <span className="font-semibold text-textSecondary">{STATUS_LABEL[run.status]}</span>
            {run.appVersion ? ` · app móvil ${run.appVersion}` : ""}
          </p>
        </div>
        <p className="text-sm text-textSecondary">{countOf(run.totalRowsWritten, "elemento importado", "elementos importados")}</p>
      </div>

      {counts && <p className="mt-1 text-sm text-textMuted">{counts}</p>}

      <p className="mt-1 text-sm text-textMuted">
        {run.status === "undone"
          ? `Deshecha el ${run.undoneAt ? formatInstantDateTime(run.undoneAt) : "—"}.`
          : `Se puede deshacer hasta el ${formatInstantDateTime(run.undoExpiresAt)}.`}
        {run.payloadPurged ? " Ya no se conserva el detalle de la copia, solo este resumen." : ""}
      </p>

      {error && (
        <div className="mt-2">
          <ImportErrorBox message={error} code={errorCode} />
        </div>
      )}

      {availability.kind === "already_undone" && <p className="mt-2 text-sm text-textMuted">Ya fue deshecha.</p>}
      {availability.kind === "snapshots_purged" && (
        <p className="mt-2 text-sm text-textMuted">Ya no se puede deshacer: el detalle necesario se eliminó con el tiempo.</p>
      )}
      {availability.kind === "expired" && <p className="mt-2 text-sm text-textMuted">El plazo para deshacerla venció.</p>}

      {availability.kind === "available" && !undoState && (
        <div className="mt-3 flex flex-col gap-2">
          <button ref={reviewButtonRef} type="button" disabled={pending} aria-busy={pending} onClick={handlePreviewUndo} className={`self-start ${BUTTON_SECONDARY}`}>
            {pending ? "Revisando…" : "Revisar si se puede deshacer"}
          </button>
          <DiscardUndoControl pending={pending} onDiscard={handleDiscardUndo} />
        </div>
      )}

      {availability.kind === "available" && undoState && (
        <div className="mt-3">
          <UndoReviewPanel
            undoState={undoState}
            pending={pending}
            onConfirm={handleApplyUndo}
            onCancel={() => {
              restoreReviewFocus.current = true;
              setUndoState(null);
            }}
          />
        </div>
      )}
    </li>
  );
}

export function ImportHistory() {
  const [runs, setRuns] = useState<ImportRunHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  function load() {
    guardNetwork(() => listImportRunsAction()).then((result) => {
      if (result.error || !result.data) {
        const translated = result.errorCode ? null : translateImportError(result.error ?? "", "history");
        setError(translated ? translated.message : (result.error ?? "No pudimos cargar el historial de importaciones."));
        setErrorCode(translated ? translated.code : (result.errorCode ?? null));
        return;
      }
      setError(null);
      setErrorCode(null);
      setRuns(result.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <ImportErrorBox message={error} code={errorCode} />;
  if (runs === null) return <LoadingState label="Cargando historial de importaciones…" />;
  if (runs.length === 0) return <EmptyState message="Todavía no importaste ningún respaldo." />;

  return (
    <ul className="flex flex-col gap-2">
      {runs.map((run) => (
        <HistoryRow key={run.id} run={run} onChanged={load} />
      ))}
    </ul>
  );
}
