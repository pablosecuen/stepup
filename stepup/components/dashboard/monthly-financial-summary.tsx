import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllCharges, listAllAllocations, listAllPayments } from "@/lib/repositories/payments";
import { buildPeriodFinancialSummary } from "@/lib/reports/financial-summary";
import { resolveFinancialPeriodRange } from "@/lib/reports/period";
import { localDateKeyInTimeZone, ARGENTINA_TIME_ZONE } from "@/lib/payments/dates";
import { formatMoney } from "@/lib/format/number-format";
import PrivateLink from "@/components/nav/private-link";

/** Mismo cálculo contable que Resumen financiero; no genera ni modifica cargos. */
export async function MonthlyFinancialSummary() {
  let summary;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [charges, allocations, payments] = await Promise.all([
      listAllCharges(ctx), listAllAllocations(ctx), listAllPayments(ctx),
    ]);
    const evaluationDate = localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE);
    summary = buildPeriodFinancialSummary({ charges, allocations, payments,
      evaluationDate, range: resolveFinancialPeriodRange("current_month", evaluationDate) });
  } catch {
    return <p role="status" className="mt-5 text-sm text-textSecondary">No pudimos cargar el resumen del mes. <PrivateLink className="inline-flex min-h-11 items-center underline" href="/resumen-financiero">Reintentar en Resumen financiero</PrivateLink></p>;
  }
  return <section aria-labelledby="inicio-finanzas" className="mt-5 rounded-xl border-[1.5px] border-border bg-surface p-4 shadow-card nav:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="inicio-finanzas" className="font-display text-xl font-semibold">Resumen del mes</h2>
        <PrivateLink href="/resumen-financiero" className="min-h-11 py-3 text-sm font-semibold underline">Ver resumen financiero</PrivateLink>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-4 nav:grid-cols-4">
        {([['Facturación prevista', summary.generated], ['Cobrado', summary.collected], ['Pendiente', summary.pending], ['Vencido', summary.overdue]] as const).map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-sm text-textSecondary">{label}</dt>
          <dd className="mt-1 break-words font-display text-2xl tf-num">{formatMoney(value)}</dd>
        </div>)}
      </dl>
      <p className="mt-3 text-xs text-textMuted">Prevista: cargos que vencen este mes. Cobrado: pagos de este mes. Son bases distintas.</p>
    </section>;
}

