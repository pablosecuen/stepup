import type { PunctualitySummary } from "@/lib/payments/engine/features/new-class/utils/punctualityScoring";
import { PUNCTUALITY_CATEGORY_LABELS, type PunctualityCategory } from "@/lib/payments/engine/features/new-class/utils/punctualityScoring";
import { formatCivilMonthAbbrev } from "@/lib/format/date-format";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const CATEGORY_TONE: Record<PunctualityCategory, BadgeTone> = { excelente: "ok", buena: "info", irregular: "warn", impuntualidad_frecuente: "bad", insuficiente: "neutral" };

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-[22px] font-semibold leading-none tf-num">{value}</p>
      <p className="mt-1 text-[13px] text-textSecondary">{label}</p>
    </div>
  );
}

/**
 * «Puntualidad» (puerto de `PunctualitySection`): comportamiento REGISTRADO, separado del de pago — nunca se mezclan. Con menos de 3 clases evaluadas no se inventa ningún porcentaje. La categoría va
 * siempre con texto además del color.
 */
export function PunctualitySection({ summary }: { summary: PunctualitySummary }) {
  const insufficient = summary.category === "insuficiente";
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-card font-semibold">Puntualidad</h2>
        <Badge tone={CATEGORY_TONE[summary.category]} dot>
          {PUNCTUALITY_CATEGORY_LABELS[summary.category]}
        </Badge>
      </div>
      {insufficient ? (
        <p className="mt-3 text-[14.5px] text-textSecondary">Todavía no hay al menos 3 clases evaluadas para calcular un comportamiento confiable.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 nav:grid-cols-4">
            <Tile label="Clases evaluadas" value={String(summary.evaluatedClasses)} />
            <Tile label="Dentro de horario/tolerancia" value={summary.onTimeOrGracePercent !== null ? `${summary.onTimeOrGracePercent}%` : "—"} />
            <Tile label="Demora promedio" value={summary.averageLateMinutes !== null ? `${summary.averageLateMinutes} min` : "—"} />
            <Tile label="Llegadas tarde" value={String(summary.lateArrivalsCount)} />
          </div>
          {summary.monthlyEvolution.length > 0 && (
            <>
              <h3 className="mt-5 text-[14px] font-[650] text-textPrimary">Evolución mensual</h3>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {summary.monthlyEvolution.map((month) => (
                  <li key={month.monthKey} className="text-center">
                    <span className="block font-display text-[18px] font-semibold tf-num">{month.averageScore}</span>
                    <span className="block text-[12.5px] text-textSecondary">
                      {formatCivilMonthAbbrev(month.monthKey)} {month.monthKey.slice(0, 4)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}
