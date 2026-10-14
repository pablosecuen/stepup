import { notFound } from "next/navigation";
import { BackLink, PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/billing/subscription-card";
import { AutoRefresh } from "@/components/billing/auto-refresh";
import { Notice } from "@/components/ui/notice";
import { loadBillingPageData, requestPriorityPoll } from "@/lib/billing/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resultado del pago · TeacherFlow" };

/**
 * Pantalla a la que vuelve la persona desde el sitio de pago. IGNORA POR COMPLETO la URL de retorno (estado, referencias, importes,
 * parámetros): volver de allá nunca activa nada. Sólo muestra el estado que tiene guardado la conciliación autenticada y pide que
 * se mire de nuevo este suscriptor con prioridad.
 */
export default async function ResultadoPage({ searchParams }: { searchParams: Promise<{ escenario?: string | string[] }> }) {
  const data = await loadBillingPageData(await searchParams);
  if (!data) notFound();
  if (!data.demo) await requestPriorityPoll();
  const { view } = data;
  const waiting = view.state === "processing" || view.state === "none";

  return (
    <div className={PAGE_WIDTH.narrow}>
      <div className="mb-3">
        <BackLink href="/facturacion">Facturación</BackLink>
      </div>
      <PageHeader title="Resultado del pago" subtitle={waiting ? "Estamos confirmando tu pago con el servicio de cobro." : "Esto es lo que tenemos confirmado hoy."} />
      <div className="mt-7 flex flex-col gap-5">
        {waiting && (
          <Notice tone="info" title="Puede demorar unos minutos">
            Esta pantalla se actualiza sola. Tu suscripción se activa únicamente cuando el pago queda confirmado: si cerraste la página de pago sin terminar, no se hizo ningún cobro y podés volver a elegir un plan.
          </Notice>
        )}
        <SubscriptionCard view={view} demo={data.demo} />
        {waiting && !data.demo && <AutoRefresh />}
      </div>
    </div>
  );
}
