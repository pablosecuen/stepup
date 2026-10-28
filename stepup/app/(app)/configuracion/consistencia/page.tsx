import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { listStudents } from "@/lib/repositories/students";
import { listAllAllocations, listAllCharges, listAllPayments } from "@/lib/repositories/payments";
import { listFirstMonthProrationDecisions } from "@/lib/repositories/proration-decisions";
import { buildConsistencyReport } from "@/lib/payments/consistency";
import { todayInArgentina } from "@/lib/format/date-format";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { PrivateButtonLink } from "@/components/ui/button";
import { ConsistencyRepairs } from "@/components/payments/consistency-repairs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Revisar consistencia · TeacherFlow" };

/**
 * «Revisar consistencia» (CFG-02): revisión de SÓLO LECTURA de tus cobros con el mismo análisis que la aplicación original. Muestra cantidades y qué conviene hacer, nunca nombres ni importes.
 * No repara nada: cualquier corrección es una acción explícita y con motivo en Cobros del alumno.
 */
export default async function ConsistenciaPage() {
  let view;
  try {
    const ctx = await requireAuthenticatedDbContext();
    const [students, charges, payments, allocations, decisions] = await Promise.all([listStudents(ctx), listAllCharges(ctx), listAllPayments(ctx), listAllAllocations(ctx), listFirstMonthProrationDecisions(ctx)]);
    view = buildConsistencyReport({ students, charges, payments, allocations, decisions, todayDateKey: todayInArgentina() });
  } catch {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageHeader title="Revisar consistencia" subtitle="No pudimos revisar tus cobros en este momento." />
        <div className="mt-6 flex flex-col items-start gap-3">
          <div className="w-full">
            <ErrorState message="No pudimos revisar tus cobros. Probá de nuevo en unos minutos." />
          </div>
          <PrivateButtonLink href="/configuracion/consistencia" variant="secondary">
            Reintentar
          </PrivateButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_WIDTH.medium}>
      <PageHeader
        title="Revisar consistencia"
        subtitle={view.total === 0 ? "Tus cobros y pagos son coherentes." : `Encontramos ${view.total} ${view.total === 1 ? "punto" : "puntos"} para revisar.`}
        action={
          <PrivateButtonLink href="/configuracion" variant="secondary">
            Volver a Configuración
          </PrivateButtonLink>
        }
      />
      <div className="mt-6 flex flex-col gap-3.5">
        {view.items.length === 0 ? (
          <EmptyState icon={CheckCircleIcon} message="No encontramos cobros repetidos, pagos sin cobro ni importes que no coincidan con el plan de este mes." />
        ) : (
          view.items.map((item) => (
            <Card key={item.category}>
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <h2 className="min-w-0 font-display text-card font-semibold [overflow-wrap:anywhere]">{item.title}</h2>
                <Badge tone="warn" icon={<ExclamationTriangleIcon className="h-3.5 w-3.5" aria-hidden />}>
                  {item.count} {item.count === 1 ? "caso" : "casos"}
                </Badge>
              </div>
              <p className="mt-2 text-[14.5px] text-textSecondary">{item.advice}</p>
            </Card>
          ))
        )}
      </div>
      <ConsistencyRepairs />
      <p className="mt-5 text-[13.5px] text-textMuted">La revisión sólo lee. Las correcciones se aplican después de confirmarlas y dejan auditoría; los casos ambiguos se conservan para revisión.</p>
    </div>
  );
}
