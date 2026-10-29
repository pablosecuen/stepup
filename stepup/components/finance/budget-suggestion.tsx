"use client";

import { useCallback, useState } from "react";
import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import { BudgetAdjustDialog } from "@/components/finance/budget-adjust-dialog";
import { LiveMessage } from "@/components/account/settings-ui";
import { Button } from "@/components/ui/button";
import { splitCollectedByPercent, type BudgetCategory } from "@/lib/payments/budget-suggestion";
import type { BudgetDistribution } from "@/lib/payments/budget-distribution";
import { formatMoney } from "@/lib/format/number-format";

/** Un color por categoría, el mismo en dona, barra, leyenda e indicadores (y en las barras de «Proyección y ahorro»): azul, violeta y verde. Siempre sólidos, sin opacidad. */
const CATEGORY_UI: Record<BudgetCategory, { label: string; swatch: string; stroke: string }> = {
  needs: { label: "Necesidades", swatch: "bg-budgetNeeds", stroke: "stroke-budgetNeeds" },
  wants: { label: "Gustos", swatch: "bg-budgetWants", stroke: "stroke-budgetWants" },
  savings: { label: "Ahorro", swatch: "bg-budgetSavings", stroke: "stroke-budgetSavings" },
};

/** Dona de tres tramos (viewBox 36, circunferencia 100): cada tramo mide exactamente su porcentaje. */
function Donut({ shares }: { shares: ReturnType<typeof splitCollectedByPercent> }) {
  // Cada tramo empieza donde terminó el anterior; el primero arranca arriba (las 12 = desplazamiento 25).
  const offsets = shares.map((_, index) => 25 - shares.slice(0, index).reduce((sum, share) => sum + share.percent, 0));
  const summary = shares.map((share) => `${CATEGORY_UI[share.category].label} ${share.percent} %`).join(", ");
  return (
    <div className="tf-chart-enter relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 36 36" role="img" aria-label={`Distribución sugerida: ${summary}`} className="h-full w-full -rotate-0">
        <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="4.2" className="stroke-paperDeep" />
        {shares.map((share, index) => {
          if (share.percent <= 0) return null;
          const gap = share.percent >= 100 ? 0 : 0.6; // separación fina entre tramos (no depende sólo del color)
          return (
            <circle
              key={share.category}
              cx="18"
              cy="18"
              r="15.9155"
              fill="none"
              strokeWidth="4.2"
              strokeDasharray={`${Math.max(0, share.percent - gap)} ${100 - Math.max(0, share.percent - gap)}`}
              strokeDashoffset={offsets[index]}
              className={CATEGORY_UI[share.category].stroke}
            />
          );
        })}
      </svg>
    </div>
  );
}

/**
 * «Distribución sugerida»: proyección ORIENTATIVA del dinero efectivamente cobrado del período seleccionado (nunca la facturación
 * prevista, lo pendiente ni lo vencido). Dona, barra apilada y leyenda con porcentaje e importe de Necesidades, Gustos y Ahorro (los
 * tres suman 100 %). No presenta estos importes como gastos ni ahorro reales. «Ajustar porcentajes» abre un diálogo compacto que usa
 * la acción de guardado existente.
 */
export function BudgetSuggestion({ collected, distribution }: { collected: number; distribution: BudgetDistribution }) {
  const [adjusting, setAdjusting] = useState(false);
  const [saved, setSaved] = useState(false);
  const shares = splitCollectedByPercent(collected, distribution);
  const sum = shares.reduce((total, share) => total + share.percent, 0);
  const hasCollected = Number.isFinite(collected) && collected > 0;

  const onSaved = useCallback(() => {
    setAdjusting(false);
    setSaved(true);
  }, []);

  return (
    <div>
      <p className="text-[14px] text-textMuted">Proyección orientativa sobre lo cobrado; no representa tus gastos ni tu ahorro real.</p>
      {!hasCollected && (
        <p className="mt-3 max-w-[540px] rounded-md border-2 border-dashed border-borderMid px-4 py-3 text-[14.5px] text-textMuted">
          Todavía no hay dinero cobrado en este período, así que cada categoría muestra {formatMoney(0)}. Los porcentajes ya quedan listos para cuando cobres.
        </p>
      )}

      <p className="mt-4 text-[13px] text-textMuted">Cobrado en el período<span className="mt-1 block whitespace-nowrap font-display text-[26px] text-textPrimary tf-num">{formatMoney(hasCollected ? collected : 0)}</span></p>
      <div className="mt-3 flex max-w-[620px] flex-col items-start gap-5 min-[480px]:flex-row min-[480px]:items-center">
        <Donut shares={shares} />
        <div className="w-full min-w-0 flex-1">
          <div aria-hidden className="flex h-1.5 max-w-[360px] gap-0.5 overflow-hidden rounded-pill bg-paperDeep">
            {shares.map((share) => (
              <div key={share.category} className={`h-full ${CATEGORY_UI[share.category].swatch} ${share.percent > 0 ? "min-w-[3px]" : "hidden"}`} style={{ flexGrow: share.percent }} />
            ))}
          </div>
          <dl className="mt-3 flex flex-col divide-y divide-border">
            {shares.map((share) => (
              <div key={share.category} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2.5 first:pt-0">
                <dt className="flex min-w-0 items-center gap-2 text-[14.5px] font-[650] text-textPrimary">
                  <span aria-hidden className={`h-3 w-3 shrink-0 rounded-sm ${CATEGORY_UI[share.category].swatch}`} />
                  {CATEGORY_UI[share.category].label}
                </dt>
                <dd className="text-right font-bold tf-num text-textPrimary">
                  <span>{share.percent} %</span>
                  <span className="ml-2 font-[650] text-textSecondary [overflow-wrap:anywhere]">{formatMoney(share.amount)}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 flex items-baseline justify-between gap-3 border-t-[1.5px] border-borderMid pt-2.5 text-[14.5px] font-[650] text-textPrimary">
            <span>Suma</span>
            <span className="font-bold tf-num">{sum} %</span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" onClick={() => setAdjusting(true)} aria-haspopup="dialog">
          <AdjustmentsHorizontalIcon className="h-5 w-5" aria-hidden />
          Ajustar porcentajes
        </Button>
        <LiveMessage>{saved && !adjusting ? "Distribución guardada." : null}</LiveMessage>
      </div>

      {adjusting && (
        <BudgetAdjustDialog
          initial={distribution}
          onClose={() => {
            setAdjusting(false);
            setSaved(false);
          }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
