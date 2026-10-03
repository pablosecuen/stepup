"use client";

import { useEffect, useState, useTransition } from "react";
import { listImportRunsAction, previewUndoImportAction, applyUndoImportAction, discardImportUndoAction } from "@/lib/actions/backup";
import { guardNetwork } from "@/lib/actions/network-guard";
import { computeUndoAvailability, type ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";
import type { UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import { FormErrorBox, FormInfoBox } from "@/components/auth/form-boxes";
import { LoadingState } from "@/components/ui/states";

// Fase 9 — historial real de importaciones. Sobrevive a recarga, cierre
// del navegador y otra sesión web porque lee `import_runs` real (nunca
// depende de estado en memoria de React) — se carga fresco cada vez que
// este componente monta.

const STATUS_LABEL: Record<ImportRunHistoryRow["status"], string> = {
  applied: "Aplicada",
  undone: "Deshecha",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function HistoryRow({ run, onChanged }: { run: ImportRunHistoryRow; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [undoState, setUndoState] = useState<UndoBlockedPreview | null>(null);

  const availability = computeUndoAvailability(run, new Date());

  function handlePreviewUndo() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => previewUndoImportAction(run.id));
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos revisar si se puede deshacer. Intentá de nuevo.");
        return;
      }
      setUndoState(result.data);
    });
  }

  function handleApplyUndo() {
    if (!undoState) return;
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => applyUndoImportAction(undoState.undoPreviewId));
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos deshacer la importación. Nada se tocó — intentá de nuevo.");
        return;
      }
      setUndoState(null);
      onChanged();
    });
  }

  function handleDiscardUndo() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => discardImportUndoAction(run.id));
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos descartar la posibilidad de deshacer. Seguís pudiendo deshacer esta importación.");
        return;
      }
      onChanged();
    });
  }

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-textPrimary">{formatDate(run.createdAt)}</p>
          <p className="text-xs text-textMuted">
            {STATUS_LABEL[run.status]} · versión de esquema {run.schemaVersion ?? "—"}
            {run.appVersion ? ` · app ${run.appVersion}` : ""} · checksum {run.checksum ? `${run.checksum.slice(0, 12)}…` : "—"}
          </p>
        </div>
        <p className="text-xs text-textSecondary">{run.totalRowsWritten} fila(s) escrita(s)</p>
      </div>

      {run.countsByTable && (
        <p className="mt-1 text-xs text-textMuted">
          {Object.entries(run.countsByTable)
            .map(([table, count]) => `${table}: ${count}`)
            .join(", ")}
        </p>
      )}

      <p className="mt-1 text-xs text-textMuted">
        {run.status === "undone"
          ? `Deshecha el ${run.undoneAt ? formatDate(run.undoneAt) : "—"}.`
          : `Se puede deshacer hasta el ${formatDate(run.undoExpiresAt)}.`}
        {run.payloadPurged ? " El contenido del respaldo ya se purgó (dato técnico, sólo queda el resumen)." : ""}
      </p>

      {error && (
        <div className="mt-2">
          <FormErrorBox message={error} />
        </div>
      )}

      {availability.kind === "already_undone" && <p className="mt-2 text-xs text-textMuted">Ya fue deshecha.</p>}
      {availability.kind === "snapshots_purged" && (
        <p className="mt-2 text-xs text-textMuted">El respaldo necesario para deshacerla ya se purgó — no se puede deshacer.</p>
      )}
      {availability.kind === "expired" && <p className="mt-2 text-xs text-textMuted">El plazo para deshacerla venció.</p>}

      {availability.kind === "available" && !undoState && (
        <button type="button" disabled={pending} onClick={handlePreviewUndo} className="mt-2 text-xs font-semibold text-statusRojo hover:underline">
          Previsualizar deshacer
        </button>
      )}

      {availability.kind === "available" && undoState && (
        <div className="mt-2 rounded-md border border-border bg-background p-2.5">
          {undoState.isSafe ? (
            <>
              <p className="text-xs text-textSecondary">Se puede deshacer de forma segura — nada se editó desde la importación.</p>
              <div className="mt-2 flex gap-2">
                <button type="button" disabled={pending} onClick={handleApplyUndo} className="rounded-md bg-statusRojo px-3 py-1.5 text-xs font-semibold text-white">
                  Confirmar deshacer
                </button>
                <button type="button" onClick={() => setUndoState(null)} className="rounded-md border border-border px-3 py-1.5 text-xs text-textSecondary">
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-statusRojo">{undoState.explanation}</p>
              <ul className="mt-1 flex flex-col gap-1 text-xs text-textMuted">
                {undoState.blockedRows.map((r, i) => (
                  <li key={i}>
                    {r.entityLabel} tiene datos posteriores que dependen de él:
                    <ul className="ml-3 mt-0.5 list-disc">
                      {r.dependencies.map((dep, j) => (
                        <li key={j}>{dep}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {availability.kind === "available" && (
        <button type="button" disabled={pending} onClick={handleDiscardUndo} className="mt-2 block text-xs font-medium text-textMuted hover:underline">
          Ya revisé los resultados, no necesito poder deshacer esto
        </button>
      )}
    </li>
  );
}

export function ImportHistory() {
  const [runs, setRuns] = useState<ImportRunHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    guardNetwork(() => listImportRunsAction()).then((result) => {
      if (result.error || !result.data) {
        setError(result.error ?? "No pudimos cargar el historial de importaciones.");
        return;
      }
      setError(null);
      setRuns(result.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <FormErrorBox message={error} />;
  if (runs === null) return <LoadingState label="Cargando historial de importaciones…" />;
  if (runs.length === 0) return <FormInfoBox>Todavía no importaste ningún respaldo.</FormInfoBox>;

  return (
    <ul className="flex flex-col gap-2">
      {runs.map((run) => (
        <HistoryRow key={run.id} run={run} onChanged={load} />
      ))}
    </ul>
  );
}
