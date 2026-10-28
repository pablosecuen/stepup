import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listAllAllocations, listAllCharges, listAllPayments } from "@/lib/repositories/payments";
import { loadExcludedStudentIds } from "@/lib/repositories/excluded-students";
import { buildPaymentBehavior, PAYMENT_BEHAVIOR_SEGMENTS } from "@/lib/payments/payment-behavior";
import { todayInArgentina, formatCivilMonthLongYear, formatCivilMonthAbbrev } from "@/lib/format/date-format";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { ChartBarIcon } from "@heroicons/react/24/outline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comportamiento de pago · TeacherFlow" };

/** «Comportamiento de pago»: cómo pagaron tus alumnos, mes a mes, en los últimos 12 meses. Cada alumno cuenta una vez por mes, en su peor situación. */
export default async function ComportamientoDePagoPage() {
  let months;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [charges, payments, allocations, excluded] = await Promise.all([listAllCharges(ctx), listAllPayments(ctx), listAllAllocations(ctx), loadExcludedStudentIds(ctx)]);
    // Datos de prueba ocultos (R16): fuera de las estadísticas.
    const keep = <T extends { studentId: string }>(rows: T[]) => rows.filter((row) => !excluded.has(row.studentId));
    months = buildPaymentBehavior({ charges: keep(charges), payments: keep(payments), allocations: keep(allocations), todayDateKey: todayInArgentina() });
  } catch {
    return (
      <div className={PAGE_WIDTH.wide}>
        <PageHeader title="Comportamiento de pago" subtitle="No pudimos calcularlo en este momento." />
        <div className="mt-6 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos cargar el comportamiento de pago. Probá de nuevo en unos minutos." />
          </div>
          <PrivateButtonLink href="/resumen-financiero/comportamiento-de-pago" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  const hasData = months.some((month) => month.totalUniqueStudentsEvaluated > 0);
  const maxTotal = Math.max(1, ...months.map((month) => month.totalUniqueStudentsEvaluated));
  const ordered = [...months].reverse();

  return (
    <div className={PAGE_WIDTH.wide}>
      <PageHeader
        title="Comportamiento de pago"
        subtitle="Cómo pagaron tus alumnos, mes a mes"
        action={
          <PrivateButtonLink href="/resumen-financiero" variant="secondary">
            Volver al Resumen financiero
          </PrivateButtonLink>
        }
      />
      {!hasData ? (
        <div className="mt-6">
          <EmptyState icon={ChartBarIcon} message="Todavía no hay cobros vencidos para mostrar. Aparecen cuando tus alumnos tienen obligaciones con vencimiento." />
        </div>
      ) : (
        <Card className="mt-6">
          <ul className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Referencias">
            {PAYMENT_BEHAVIOR_SEGMENTS.map((segment) => (
              <li key={segment.key} className="flex items-center gap-2 text-[13.5px] text-textSecondary">
                <span aria-hidden className={`h-3 w-3 rounded-sm ${segment.barClass}`} />
                {segment.label}
              </li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-col gap-2.5">
            {ordered.map((month) => (
              <li key={month.period} className="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-3 nav:grid-cols-[120px_minmax(0,1fr)_minmax(0,320px)]">
                <span className="text-[14px] font-[650] text-textPrimary">
                  <span className="nav:hidden">{formatCivilMonthAbbrev(month.period)} {month.period.slice(2, 4)}</span>
                  <span className="hidden nav:inline">{formatCivilMonthLongYear(month.period)}</span>
                </span>
                {month.totalUniqueStudentsEvaluated === 0 ? (
                  <span className="text-[13.5px] text-textMuted">Sin obligaciones vencidas</span>
                ) : (
                  <div className="flex h-5 overflow-hidden rounded-sm bg-paperDeep" style={{ width: `${Math.max(8, Math.round((month.totalUniqueStudentsEvaluated / maxTotal) * 100))}%` }} aria-hidden>
                    {PAYMENT_BEHAVIOR_SEGMENTS.map((segment) => (month[segment.key] > 0 ? <span key={segment.key} className={segment.barClass} style={{ flexGrow: month[segment.key] }} /> : null))}
                  </div>
                )}
                {/* Los números van siempre en texto: el color nunca es la única forma de leer el estado. */}
                <p className="col-span-2 text-[13.5px] text-textSecondary nav:col-span-1">
                  {month.totalUniqueStudentsEvaluated === 0
                    ? ""
                    : PAYMENT_BEHAVIOR_SEGMENTS.filter((segment) => month[segment.key] > 0)
                        .map((segment) => `${segment.label}: ${month[segment.key]}`)
                        .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
