import type { ReactNode } from "react";
import { CARD_CLASS } from "@/components/ui/surfaces";
import type { FinancialPeriodPreset } from "@/lib/reports/period";

/**
 * Piezas de «Resumen financiero» compartidas por el contenido real y por su esqueleto de carga (29/10/2026): el mismo marcado, las mismas clases
 * y los mismos textos fijos, así el esqueleto ocupa EXACTAMENTE el mismo lugar en cualquier ancho (la cifra se ajusta al ancho de su tarjeta y las
 * pastillas de período se parten en renglones igual que las reales). El esqueleto sólo cambia el valor (un bloque del mismo tamaño de letra).
 */
export const FINANCIAL_PRESETS: FinancialPeriodPreset[] = ["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"];

/** Pastilla de período (la real es un enlace; el esqueleto, un `span` con estas mismas clases). */
export function periodPillClass(selected: boolean): string {
  return `inline-flex min-h-11 items-center gap-1.5 rounded-pill border-[1.5px] px-4 text-[14.5px] font-[650] transition-colors duration-150 ${
    selected ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary hover:border-ink"
  }`;
}

export function Kpi({ label, value, valueClass = "text-textPrimary", foot }: { label: string; value: ReactNode; valueClass?: string; foot?: ReactNode }) {
  return (
    <div className={`${CARD_CLASS} [container-type:inline-size]`}>
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      {/* El importe se ajusta al ancho de SU tarjeta (nunca se parte un número en dos renglones): 36 px cuando hay lugar, menos cuando la tarjeta es angosta. */}
      <p className={`mt-1.5 whitespace-nowrap font-display text-[clamp(16px,11cqw,34px)] font-medium leading-none tracking-tight tf-num ${valueClass}`}>{value}</p>
      {foot && <p className="mt-2 text-[13px] text-textMuted">{foot}</p>}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-lavenderSoft/40 px-3.5 py-3">
      <p className="text-[13px] font-[650] text-textMuted">{label}</p>
      <p className="mt-1 font-display text-[30px] font-semibold leading-none tracking-tight tf-num text-textPrimary [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

/** Título de tarjeta (el mismo `h2` en el contenido y en el esqueleto). */
export const CARD_TITLE_CLASS = "font-display text-card font-semibold";
