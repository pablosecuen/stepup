import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import type { HistoryRowView } from "@/lib/billing/view";

// Historial: «Cobros» (lo que se intentó cobrar y su resultado) y «Períodos de acceso» (lo que cada cobro aprobado compró). Cada fila
// lleva su resultado con texto (Pago aprobado, Pago rechazado, Devuelto, Contracargo, Anulado): nunca sólo color.

function Group({ title, rows }: { title: string; rows: readonly HistoryRowView[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="border-t-[1.5px] border-border bg-surface2 px-4 py-2 text-[13px] font-[650] uppercase tracking-[0.04em] text-textMuted nav:px-5">{title}</h3>
      <ul className="divide-y-[1.5px] divide-border border-t-[1.5px] border-border">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3 nav:px-5">
            <div className="min-w-0">
              <p className="text-[15px] font-[650] text-textPrimary">{row.title}</p>
              <p className="text-[13.5px] text-textMuted">{row.detail}</p>
            </div>
            <div className="flex items-center gap-3">
              {row.tag && <Badge tone={row.tag.tone}>{row.tag.label}</Badge>}
              <span className="text-[15px] font-[650] tabular-nums text-textPrimary">{row.amount}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HistoryList({ rows }: { rows: readonly HistoryRowView[] }) {
  return (
    <Card padded={false} aria-labelledby="historial-titulo">
      <CardHeader title={<span id="historial-titulo">Historial</span>} />
      {rows.length === 0 ? (
        <p className="px-4 pb-5 text-[14.5px] text-textSecondary nav:px-5">Todavía no hay cobros ni períodos. Van a aparecer acá cuando se confirme el primer pago.</p>
      ) : (
        <>
          <Group title="Cobros" rows={rows.filter((row) => row.kind === "charge")} />
          <Group title="Períodos de acceso" rows={rows.filter((row) => row.kind === "period")} />
        </>
      )}
    </Card>
  );
}
