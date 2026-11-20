"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { editFutureRecurrenceAction } from "@/lib/actions/calendar";
import { previewSeriesEndAction, type SeriesEndPreview } from "@/lib/actions/series-end";
import { guardNetwork } from "@/lib/actions/network-guard";
import { validateSeriesEndInput } from "@/lib/calendar/series-end";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { Field, TextInput, checkClass, choiceGroupClass, choiceRowClass } from "@/components/ui/field";
import { formatCivilDate, todayInArgentina } from "@/lib/format/date-format";

type Choice = "date" | "none";

/**
 * «Cambiar fecha de finalización» de una serie que YA llegó a su fecha. Es la única acción de la tarjeta de «Finalizadas»: pausar, intercambiar, editar el horario o eliminar
 * no tienen sentido en una serie terminada. Reutiliza la misma Server Action y la misma vista previa que el editor de «Administrar serie» (un solo circuito): fijar una fecha
 * desde hoy, o dejarla sin fecha, devuelve la serie a «Vigentes» y vuelven sólo las clases que había quitado ese límite — nunca una cancelación manual. Abrir la pantalla no cambia nada.
 */
export function FinishedSeriesDate({ ruleId, seriesLabel, scheduleLabel, seriesEndDate, weeksJson, participantIds }: { ruleId: string; seriesLabel: string; scheduleLabel: string; seriesEndDate: string; weeksJson: string; participantIds: string[] }) {
  const router = useRouter();
  const today = useMemo(() => todayInArgentina(), []);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<SeriesEndPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ endDate: string | null } | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  const message = choice === "date" ? validateSeriesEndInput(date, today) ?? (date === "" ? "Elegí la nueva fecha de finalización." : null) : null;
  const nextEnd = choice === "none" ? "" : choice === "date" && !message ? date : null;
  const blocked = (preview?.blockedTotal ?? 0) > 0;
  const canSave = nextEnd !== null && !blocked && !pending && preview !== null;

  function requestPreview(end: string | null) {
    const id = ++request.current;
    setPreview(null);
    setPreviewError(null);
    if (end === null) return;
    void guardNetwork(() => previewSeriesEndAction({ ruleId, endDate: end, effectiveDate: today })).then((result) => {
      if (id !== request.current) return;
      if (result.error) setPreviewError(result.error);
      else setPreview(result.preview ?? null);
    });
  }

  function close() {
    if (pending) return;
    const wasSaved = saved !== null;
    setOpen(false);
    setChoice(null);
    setDate("");
    setPreview(null);
    setPreviewError(null);
    setError(null);
    setSaved(null);
    request.current += 1;
    if (wasSaved) router.refresh();
    else window.setTimeout(() => openerRef.current?.focus(), 0);
  }

  function save() {
    if (!canSave || nextEnd === null || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    const formData = new FormData();
    formData.set("originalRecurrenceId", ruleId);
    formData.set("effectiveDate", today);
    formData.set("weeksJson", weeksJson);
    formData.set("seriesEndDate", nextEnd);
    formData.set("expectedSeriesEnd", seriesEndDate);
    participantIds.forEach((id) => formData.append("participantIds", id));
    startTransition(async () => {
      try {
        const result = await guardNetwork(() => editFutureRecurrenceAction({}, formData));
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved({ endDate: nextEnd === "" ? null : nextEnd });
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      <Button ref={openerRef} variant="secondary" onClick={() => setOpen(true)} aria-label={`Cambiar la fecha de finalización de ${seriesLabel}`}>
        <CalendarDaysIcon className="h-5 w-5" aria-hidden />
        Cambiar fecha de finalización
      </Button>
      {open && (
        <Dialog
          title="Cambiar fecha de finalización"
          size="md"
          onClose={close}
          busy={pending}
          footer={
            saved ? (
              <Button variant="primary" onClick={close} data-autofocus>
                Listo
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={close} disabled={pending}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={save} busy={pending} disabled={!canSave}>
                  {pending ? "Guardando..." : choice === "none" ? "Seguir sin fecha de finalización" : "Guardar nueva fecha"}
                </Button>
              </>
            )
          }
        >
          {saved ? (
            <Notice tone="ok" role="status" title="Cambio guardado">
              {saved.endDate ? `La serie vuelve a «Vigentes» y continúa hasta el ${formatCivilDate(saved.endDate)}.` : "La serie vuelve a «Vigentes» y continúa sin fecha de finalización."} Se conservan sus clases dictadas, registros y cobros.
            </Notice>
          ) : (
            <div className="flex min-w-0 flex-col gap-3.5">
              <div className="rounded-md border-[1.5px] border-border bg-surface2 p-3">
                <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{seriesLabel}</p>
                <p className="text-[14px] text-textSecondary [overflow-wrap:anywhere]">{scheduleLabel}</p>
                <p className="text-[14px] font-[650] text-textPrimary">Finalizó el {formatCivilDate(seriesEndDate)}.</p>
              </div>
              <fieldset className="min-w-0">
                <legend className="text-sm font-[650] text-textSecondary">¿Cómo sigue la serie?</legend>
                <div className={`${choiceGroupClass} mt-2`}>
                  <label className={choiceRowClass}>
                    <input
                      type="radio"
                      name={`finished-choice-${ruleId}`}
                      className={checkClass}
                      checked={choice === "date"}
                      onChange={() => {
                        setChoice("date");
                        setError(null);
                        requestPreview(date && !validateSeriesEndInput(date, today) ? date : null);
                      }}
                    />
                    <span className="text-[15px] font-[650] text-textPrimary">Continúa hasta una nueva fecha</span>
                  </label>
                  <label className={choiceRowClass}>
                    <input
                      type="radio"
                      name={`finished-choice-${ruleId}`}
                      className={checkClass}
                      checked={choice === "none"}
                      onChange={() => {
                        setChoice("none");
                        setError(null);
                        requestPreview("");
                      }}
                    />
                    <span className="text-[15px] font-[650] text-textPrimary">Continúa sin fecha de finalización</span>
                  </label>
                </div>
              </fieldset>
              {choice === "date" && (
                <Field label="Nueva fecha de finalización" htmlFor={`finished-date-${ruleId}`} hint={date && !message ? `La serie continúa hasta el ${formatCivilDate(date)} inclusive.` : "Desde hoy en adelante."} error={date ? message : undefined}>
                  <TextInput
                    id={`finished-date-${ruleId}`}
                    type="date"
                    min={today}
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setError(null);
                      requestPreview(event.target.value && !validateSeriesEndInput(event.target.value, today) ? event.target.value : null);
                    }}
                    className="min-w-0"
                  />
                </Field>
              )}
              {nextEnd !== null && (
                <div role="status" aria-live="polite" className="rounded-md border-[1.5px] border-accentLine bg-accentSoft p-3.5 text-[14px] text-textSecondary">
                  {previewError ? (
                    <p className="font-semibold text-bad">{previewError}</p>
                  ) : !preview ? (
                    <p className="font-[650] text-textPrimary">Calculando lo que cambia…</p>
                  ) : blocked ? (
                    <p role="alert" className="font-semibold text-bad">La clase del {formatCivilDate(preview.blocked[0])} ya tiene registro o cobro y quedaría después de esa fecha: no se puede guardar. Elegí una fecha posterior.</p>
                  ) : (
                    <>
                      <p className="font-[650] text-textPrimary">La serie vuelve a «Vigentes».</p>
                      {preview.restoredTotal > 0 && <p className="mt-1">{preview.restoredTotal === 1 ? "Vuelve 1 clase" : `Vuelven ${preview.restoredTotal} clases`} que había quitado la fecha anterior: {preview.restored.map((item) => formatCivilDate(item.date)).join(", ")}.</p>}
                      <p className="mt-1 text-textMuted">No se reactiva ninguna clase cancelada a mano, y no se toca ningún registro, cobro ni pago.</p>
                    </>
                  )}
                </div>
              )}
              {error && (
                <Notice tone="bad" role="alert">
                  <p className="[overflow-wrap:anywhere]">{error}</p>
                </Notice>
              )}
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
