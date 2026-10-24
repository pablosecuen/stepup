"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previewSeriesSwapAction, swapSeriesAction, type SeriesSwapResult } from "@/lib/actions/calendar";
import { guardNetwork } from "@/lib/actions/network-guard";
import { formatCivilDayLabel } from "@/lib/calendar/civil-calendar";
import { todayInArgentina } from "@/lib/format/date-format";
import { Button } from "@/components/ui/button";
import { Field, SelectInput, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export interface SwapOption {
  id: string;
  label: string;
  /** «vie 19:00»: el horario vigente, para reconocer la serie en la lista. */
  schedule: string;
}

type Preview = NonNullable<SeriesSwapResult["preview"]>;

/**
 * Intercambio de horarios entre dos series, con fecha efectiva y vista previa de AMBOS resultados. «Confirmar» guarda los dos cambios en una sola
 * transacción (ambos o ninguno): si algo falla no cambia ninguna. El servidor vuelve a validar todo (terceras clases y disponibilidad) y no hay
 * opción de ignorar conflictos. `fixedId`: la serie desde la que se abrió (queda fija como la primera).
 */
export function SeriesSwapPanel({ options, fixedId, onClose }: { options: SwapOption[]; fixedId?: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = useMemo(() => todayInArgentina(), []);
  const [seriesA, setSeriesA] = useState(fixedId ?? "");
  const [seriesB, setSeriesB] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Preview | null>(null);

  function reset(next: { a?: string; b?: string; date?: string }) {
    if (next.a !== undefined) setSeriesA(next.a);
    if (next.b !== undefined) setSeriesB(next.b);
    if (next.date !== undefined) setEffectiveDate(next.date);
    setPreview(null);
    setError(null);
    setDone(null);
  }

  function showPreview() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await guardNetwork(() => previewSeriesSwapAction({ seriesAId: seriesA, seriesBId: seriesB, effectiveDate }));
      if (result.error || !result.preview) {
        setPreview(null);
        setError(result.error ?? "No pudimos preparar el intercambio.");
        return;
      }
      setPreview(result.preview);
    });
  }

  function confirmSwap() {
    setError(null);
    startTransition(async () => {
      const result = await guardNetwork(() => swapSeriesAction({ seriesAId: seriesA, seriesBId: seriesB, effectiveDate }));
      if (result.error || !result.preview) {
        // Nada cambió (ambos o ninguno): se vuelve a mostrar el mensaje y se puede reintentar o corregir.
        setError(result.error ?? "No pudimos hacer el intercambio. No se cambió ninguna de las dos series.");
        return;
      }
      setDone(result.preview);
      setPreview(null);
      router.refresh();
    });
  }

  const canPreview = !!seriesA && !!seriesB && seriesA !== seriesB && !!effectiveDate;
  const optionLabel = (option: SwapOption) => `${option.label} · ${option.schedule}`;
  const fixedOption = fixedId ? options.find((option) => option.id === fixedId) : undefined;

  return (
    <div>
      <>
        <div className="flex flex-col gap-4 rounded-lg border-[1.5px] border-border bg-surface2 p-4">
          <div>
            <h3 className="font-display text-card font-semibold">Intercambiar horarios</h3>
            <p className="mt-0.5 text-[13.5px] text-textMuted">Cada serie toma el horario de la otra desde la fecha elegida. Los alumnos no cambian. Los dos cambios se guardan juntos: o se hacen los dos o no se hace ninguno.</p>
          </div>

          {fixedId ? (
            <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">Esta serie: {fixedOption ? optionLabel(fixedOption) : "—"}</p>
          ) : (
            <Field label="Primera serie" htmlFor="swap-a">
              <SelectInput id="swap-a" value={seriesA} onChange={(e) => reset({ a: e.target.value })}>
                <option value="">Elegí una serie</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {optionLabel(option)}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field label={fixedId ? "Intercambiar con" : "Segunda serie"} htmlFor="swap-b">
            <SelectInput id="swap-b" value={seriesB} onChange={(e) => reset({ b: e.target.value })}>
              <option value="">Elegí una serie</option>
              {options
                .filter((option) => option.id !== seriesA)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {optionLabel(option)}
                  </option>
                ))}
            </SelectInput>
          </Field>
          <Field label="Desde qué fecha" htmlFor="swap-date" hint={effectiveDate ? `Rige desde ${formatCivilDayLabel(effectiveDate)}.` : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput id="swap-date" type="date" min={today} value={effectiveDate} onChange={(e) => reset({ date: e.target.value })} className="min-w-0 flex-1" />
              <Button variant="secondary" onClick={() => reset({ date: today })} disabled={effectiveDate === today}>
                Hoy
              </Button>
            </div>
          </Field>

          {error && <Notice tone="bad">{error}</Notice>}

          {preview && (
            <div className="flex flex-col gap-2.5" role="status" aria-live="polite">
              <p className="text-[15px] font-bold text-textPrimary">Así quedaría desde {formatCivilDayLabel(preview.effectiveDate)}:</p>
              {preview.sides.map((side) => (
                <div key={side.seriesId} className="rounded-md border-[1.5px] border-accentLine bg-accentSoft p-3.5">
                  <p className="font-bold text-textPrimary [overflow-wrap:anywhere]">{side.label}</p>
                  <p className="text-[15px] text-textSecondary">
                    {side.before} → <strong className="text-textPrimary">{side.after}</strong>
                  </p>
                  <p className="text-[14px] text-textMuted">{side.firstClass ? `Primera clase con el nuevo horario: ${side.firstClass}.` : "Sin clases en los próximos 60 días."}</p>
                  {side.replaces.length > 0 && <p className="mt-1 text-[13.5px] font-semibold text-textPrimary">Reemplaza un cambio ya programado: {side.replaces.join("; ")}.</p>}
                  {side.rescheduledReplaced.length > 0 && <p className="mt-1 text-[13.5px] font-semibold text-textPrimary">Se reemplazan por el nuevo patrón estas clases reprogramadas: {side.rescheduledReplaced.join("; ")}.</p>}
                  {side.cancelledKept.length > 0 && <p className="mt-1 text-[13.5px] text-textSecondary">Siguen registradas como canceladas: {side.cancelledKept.join("; ")}.</p>}
                </div>
              ))}
              <p className="text-[13.5px] text-textMuted">Se verificó que ninguna de las dos choque con otra clase ni con tu disponibilidad. Las clases pasadas no se tocan.</p>
            </div>
          )}

          {done && (
            <Notice tone="ok" title="Intercambio hecho">
              {done.sides.map((side) => `${side.label}: ${side.after}`).join(" · ")}. Desde {formatCivilDayLabel(done.effectiveDate)}.
            </Notice>
          )}

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            {preview ? (
              <Button variant="primary" onClick={confirmSwap} busy={pending}>
                {pending ? "Guardando..." : "Confirmar intercambio"}
              </Button>
            ) : (
              <Button variant="primary" onClick={showPreview} busy={pending} disabled={!canPreview}>
                {pending ? "Preparando..." : "Ver vista previa"}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </div>
      </>
    </div>
  );
}
