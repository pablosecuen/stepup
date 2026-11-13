"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveBoxIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { formatCivilDayLabelShort, instantDateKey, instantTimeLabel } from "@/lib/calendar/civil-calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { listCancelledClassesAction, restoreOccurrenceAction, type CancelledClassEntry } from "@/lib/actions/calendar";

/**
 * Historial de clases CANCELADAS: acceso secundario y compacto del Calendario, cerrado por defecto. Las canceladas NO se dibujan en la agenda normal (ni generan carriles ni bloquean
 * horarios); acá se las localiza y se restauran con la operación de siempre (`restoreOccurrenceAction`): comprueba el horario ANTES de restaurar y, si está ocupado o bloqueado, muestra el
 * conflicto y sólo restaura si la profesora lo confirma («Restaurar igual»); la base conserva sus protecciones (nunca con registro o cobro asociado, ni una clase ya reemplazada).
 */
type RowState = { busy?: boolean; message?: string; conflict?: boolean };

export function CancelledHistory({ className }: { className: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CancelledClassEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [restoredCount, setRestoredCount] = useState(0);
  const [, startTransition] = useTransition();

  function openHistory() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setRestoredCount(0);
    startTransition(async () => {
      const result = await guardNetwork(() => listCancelledClassesAction());
      setLoading(false);
      if (result.error || !result.items) {
        setError(result.error ?? "No pudimos cargar las clases canceladas.");
        return;
      }
      setItems(result.items);
      setRows({});
    });
  }

  function restore(entry: CancelledClassEntry, confirmOverlap: boolean) {
    setRows((current) => ({ ...current, [entry.lessonId]: { busy: true } }));
    startTransition(async () => {
      const result = await guardNetwork(() => restoreOccurrenceAction({ lessonId: entry.lessonId, confirmOverlap }));
      if (result.error) {
        setRows((current) => ({ ...current, [entry.lessonId]: { message: result.error, conflict: result.conflict === true } }));
        return;
      }
      setItems((current) => (current ?? []).filter((item) => item.lessonId !== entry.lessonId));
      setRestoredCount((count) => count + 1);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className={className} onClick={openHistory} aria-haspopup="dialog">
        <ArchiveBoxIcon className="h-3.5 w-3.5 nav:h-4 nav:w-4" aria-hidden />
        Canceladas
      </button>
      {open && (
        <Dialog
          title="Clases canceladas"
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <Button variant="secondary" onClick={() => setOpen(false)} className="self-end">
              Cerrar
            </Button>
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-[13.5px] text-textMuted">Las últimas de 60 días y las próximas de 120. No figuran en la agenda; sus registros, cobros e historial se conservan.</p>
            {restoredCount > 0 && (
              <Notice tone="ok" role="status">
                {restoredCount === 1 ? "Clase restaurada: ya figura en la agenda." : `${restoredCount} clases restauradas: ya figuran en la agenda.`}
              </Notice>
            )}
            {loading && <p role="status" className="text-[14px] text-textSecondary">Buscando clases canceladas…</p>}
            {error && <Notice tone="bad">{error}</Notice>}
            {!loading && !error && items && items.length === 0 && <p className="text-[14px] text-textSecondary">No hay clases canceladas en este período.</p>}
            {items && items.length > 0 && (
              <ul className="flex flex-col gap-2">
                {items.map((entry) => {
                  const state = rows[entry.lessonId] ?? {};
                  return (
                    <li key={entry.lessonId} className="flex min-w-0 flex-col gap-2 rounded-md border-[1.5px] border-border bg-surface2 p-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold text-textPrimary [overflow-wrap:anywhere]">{entry.title}</p>
                        <p className="text-[13px] text-textSecondary">
                          {formatCivilDayLabelShort(instantDateKey(entry.start))} · {instantTimeLabel(entry.start)}–{instantTimeLabel(entry.end)}
                          {entry.isRecurring ? " · Serie" : ""}
                        </p>
                      </div>
                      {state.message && (
                        <Notice tone={state.conflict ? "warn" : "bad"} role="alert">
                          {state.message}
                        </Notice>
                      )}
                      <Button variant="secondary" busy={state.busy} onClick={() => restore(entry, state.conflict === true)} className="self-start">
                        <ArrowPathIcon className="h-5 w-5" aria-hidden />
                        {state.conflict ? "Restaurar igual" : "Restaurar"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
