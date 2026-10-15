"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatCivilMonthAbbrev, formatCivilMonthLongYear } from "@/lib/format/date-format";
import { formatMoney } from "@/lib/format/number-format";
import type { MonthlyCollectedPoint } from "@/lib/reports/monthly-collected";

const TIP_ID = "collected-evolution-tip";

interface Tip {
  text: string;
  left: number;
  top: number;
}

/**
 * «Evolución de cobros»: barras VERDES (ingresos) con el dinero efectivamente cobrado de cada mes, en orden cronológico. Sólo
 * datos reales de la cuenta (ninguna barra ficticia: un mes sin cobros no dibuja barra y un gráfico sin cobros muestra un estado
 * vacío). Rojo y terracota quedan reservados para vencidos y alertas.
 *
 * Accesibilidad: cada barra es un botón con el nombre completo («octubre 2026: $ 120.000»); una sola parada de Tab y flechas,
 * Inicio y Fin para recorrerlas; el tooltip (`role="tooltip"`) aparece al pasar el puntero o enfocar con el teclado y se cierra con
 * Escape; y debajo hay una tabla con los mismos datos («Ver datos en tabla»), de modo que nada depende del color, del puntero ni del
 * gráfico.
 */
export function CollectedEvolutionChart({ series, caption }: { series: readonly MonthlyCollectedPoint[]; caption: string }) {
  const total = series.reduce((sum, point) => sum + Math.round(point.amount * 100), 0) / 100;
  const max = series.reduce((highest, point) => Math.max(highest, point.amount), 0);
  const peak = series.find((point) => point.amount === max);
  const [activeIndex, setActiveIndex] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!tip) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setTip(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [tip]);

  const label = (point: MonthlyCollectedPoint) => `${formatCivilMonthLongYear(point.month)}: ${formatMoney(point.amount)}`;

  function showTip(target: HTMLElement, point: MonthlyCollectedPoint) {
    const rect = target.getBoundingClientRect();
    const width = typeof window === "undefined" ? 1200 : window.innerWidth;
    setTip({ text: label(point), left: Math.max(8, Math.min(rect.left + rect.width / 2 - 80, width - 176)), top: rect.top - 8 });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = series.length - 1;
    const next = event.key === "ArrowRight" ? Math.min(index + 1, last) : event.key === "ArrowLeft" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
    buttons.current[next]?.focus();
    buttons.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  if (series.length === 0 || total <= 0) {
    return (
      <div>
        <p className="max-w-[540px] rounded-md border-2 border-dashed border-borderMid px-4 py-3.5 text-[14.5px] text-textMuted">
          Todavía no hay cobros registrados en estos meses. Cuando cobres, vas a ver acá cómo evolucionan mes a mes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13.5px] text-textMuted">
        {caption}
        {peak && (
          <>
            {" · "}Mayor cobro: <b className="font-[650] text-textSecondary tf-num">{label(peak)}</b>
          </>
        )}
      </p>

      <div role="group" aria-label="Cobrado por mes. Recorré los meses con las flechas." className="mt-3 overflow-x-auto pb-1">
        <ul className="flex min-w-full items-end gap-1.5 border-b-[1.5px] border-borderMid" style={{ width: series.length > 6 ? `${series.length * 44}px` : undefined }}>
          {series.map((point, index) => {
            const height = point.amount > 0 && max > 0 ? Math.max(2, Math.round((point.amount / max) * 100)) : 0;
            return (
              <li key={point.month} className="min-w-11 flex-1">
                <button
                  ref={(element) => {
                    buttons.current[index] = element;
                  }}
                  type="button"
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-label={label(point)}
                  aria-describedby={tip && tip.text === label(point) ? TIP_ID : undefined}
                  onFocus={(event) => {
                    setActiveIndex(index);
                    if (event.currentTarget.matches(":focus-visible")) showTip(event.currentTarget, point);
                  }}
                  onBlur={() => setTip(null)}
                  onMouseEnter={(event) => showTip(event.currentTarget, point)}
                  onMouseLeave={() => setTip(null)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className="group flex h-44 w-full items-end justify-center rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1"
                >
                  <span aria-hidden className="block w-[62%] max-w-[44px] rounded-t-md bg-ok transition-opacity group-hover:opacity-85 motion-reduce:transition-none" style={{ height: `${height}%` }} />
                </button>
              </li>
            );
          })}
        </ul>
        <ul aria-hidden className="mt-1.5 flex min-w-full gap-1.5" style={{ width: series.length > 6 ? `${series.length * 44}px` : undefined }}>
          {series.map((point, index) => {
            const showYear = index === 0 || point.month.endsWith("-01");
            return (
              <li key={point.month} className="min-w-11 flex-1 text-center text-[12.5px] font-medium leading-tight text-textMuted">
                <span className="block">{formatCivilMonthAbbrev(point.month)}</span>
                <span className="block text-[11px] tf-num">{showYear ? point.month.slice(0, 4) : " "}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <details className="mt-3 rounded-md border-[1.5px] border-border bg-surface2">
        <summary className="flex min-h-11 cursor-pointer items-center px-3.5 text-[14px] font-[650] text-textSecondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-inset">Ver datos en tabla</summary>
        <div className="overflow-x-auto px-3.5 pb-3">
          <table className="w-full min-w-[260px] text-left text-[14px]">
            <caption className="sr-only">Importe cobrado por mes, en orden cronológico</caption>
            <thead>
              <tr className="border-b border-border text-textMuted">
                <th scope="col" className="py-2 pr-3 font-[650]">
                  Mes
                </th>
                <th scope="col" className="py-2 text-right font-[650]">
                  Cobrado
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.month} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 pr-3 font-normal text-textSecondary">
                    {formatCivilMonthLongYear(point.month)}
                  </th>
                  <td className="py-2 text-right font-[650] tf-num text-textPrimary">{formatMoney(point.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-[1.5px] border-borderMid">
                <th scope="row" className="py-2 pr-3 font-[650] text-textPrimary">
                  Total
                </th>
                <td className="py-2 text-right font-bold tf-num text-textPrimary">{formatMoney(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </details>

      {tip && (
        <div id={TIP_ID} role="tooltip" className="pointer-events-none fixed z-[60] w-max max-w-[260px] -translate-y-full rounded-md bg-ink px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-background shadow-panel tf-num" style={{ left: tip.left, top: tip.top }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
