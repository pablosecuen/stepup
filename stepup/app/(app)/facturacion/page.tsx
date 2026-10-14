import { notFound } from "next/navigation";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { SubscriptionCard } from "@/components/billing/subscription-card";
import { HistoryList } from "@/components/billing/history-list";
import { BillingRules } from "@/components/billing/billing-rules";
import { loadBillingPageData } from "@/lib/billing/page-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facturación · TeacherFlow" };

// Con la facturación apagada esta ruta NO EXISTE (404): ninguna persona actual nota nada.
export default async function FacturacionPage({ searchParams }: { searchParams: Promise<{ escenario?: string | string[] }> }) {
  const data = await loadBillingPageData(await searchParams);
  if (!data) notFound();

  return (
    <div className={PAGE_WIDTH.medium}>
      <PageHeader title="Facturación" subtitle="Tu suscripción, tus pagos y cómo funciona todo." />
      <div className="mt-7 flex flex-col gap-5">
        <SubscriptionCard view={data.view} demo={data.demo} />
        {data.view.state !== "unavailable" && <HistoryList rows={data.view.history} />}
        <BillingRules />
      </div>
    </div>
  );
}
