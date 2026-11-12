import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { BackLink, PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { PlanPicker } from "@/components/billing/plan-picker";
import { BillingRules } from "@/components/billing/billing-rules";
import { PrivateButtonLink } from "@/components/ui/button";
import { loadBillingPageData } from "@/lib/billing/page-data";
import { PLAN_INTENT_COOKIE } from "@/lib/plan-intent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Planes · TeacherFlow" };

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PlanesPage({ searchParams }: { searchParams: Promise<{ escenario?: string | string[]; plan?: string | string[] }> }) {
  const params = await searchParams;
  const data = await loadBillingPageData(params);
  if (!data) notFound();
  // El plan elegido en la página pública (por la dirección o por la cookie de intención que sobrevive al registro y la confirmación del correo): sólo cuenta si es uno del catálogo vigente.
  let requestedPlan = firstOf(params.plan) ?? null;
  if (!requestedPlan) {
    try {
      requestedPlan = (await cookies()).get(PLAN_INTENT_COOKIE)?.value ?? null;
    } catch {
      requestedPlan = null;
    }
  }
  const initialPlan = data.options.find((option) => option.code === requestedPlan)?.code ?? null;
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
            askIdentity={data.askIdentity}
            initialPlan={initialPlan}
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
