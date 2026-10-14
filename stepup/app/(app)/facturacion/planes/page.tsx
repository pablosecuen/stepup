import { notFound } from "next/navigation";
import { BackLink, PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { PlanPicker } from "@/components/billing/plan-picker";
import { BillingRules } from "@/components/billing/billing-rules";
import { PrivateButtonLink } from "@/components/ui/button";
import { loadBillingPageData } from "@/lib/billing/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planes · TeacherFlow" };

export default async function PlanesPage({ searchParams }: { searchParams: Promise<{ escenario?: string | string[] }> }) {
  const data = await loadBillingPageData(await searchParams);
  if (!data) notFound();
  const { view } = data;
  const canSubscribe = view.actions.subscribe;
  const canChange = view.actions.changePlan;

  return (
    <div className={PAGE_WIDTH.medium}>
      <div className="mb-3">
        <BackLink href="/facturacion">Facturación</BackLink>
      </div>
      <PageHeader title={canChange ? "Cambiar de plan" : "Planes"} subtitle="Cuatro formas de pagar lo mismo: cuanto más largo el plan, menos pagás por mes." />
      <div className="mt-7 flex flex-col gap-6">
        {canSubscribe || canChange ? (
          <PlanPicker
            options={data.options}
            mode={canChange ? "change" : "subscribe"}
            currentPlanCode={canChange ? (view.plan?.code ?? null) : null}
            grandfathered={view.state === "grandfathered"}
            demo={data.demo}
          />
        ) : (
          <Notice tone="info" title={view.state === "unavailable" ? "No pudimos consultar tu suscripción" : "No hace falta elegir un plan ahora"}>
            {view.state === "unavailable"
              ? "Probá de nuevo en unos minutos. No se hizo ningún cambio ni ningún cobro."
              : "Ya tenés una suscripción en curso. Podés ver su estado, actualizar tu medio de pago o cancelarla desde Facturación."}
            <div className="mt-3">
              <PrivateButtonLink href="/facturacion" variant="secondary">
                Ir a Facturación
              </PrivateButtonLink>
            </div>
          </Notice>
        )}
        <BillingRules />
      </div>
    </div>
  );
}
