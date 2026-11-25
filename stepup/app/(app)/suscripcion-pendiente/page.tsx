import { redirect } from "next/navigation";
import { PageHeader, PAGE_WIDTH } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { SubscriptionCard } from "@/components/billing/subscription-card";
import { SupportCard } from "@/components/billing/support-card";
import { AutoRefresh } from "@/components/billing/auto-refresh";
import { AccessRecoveryWatcher, AccessRestoredRedirect } from "@/components/billing/limited-mode-action";
import { getRenderUser } from "@/lib/auth/render-user";
import { loadBillingPageData, requestPriorityPoll } from "@/lib/billing/page-data";
import { resolveAccessForNotice } from "@/lib/billing/enforcement-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suscripción pendiente · TeacherFlow" };

/**
 * Pantalla a la que va toda cuenta BLOQUEADA: terminó la prueba gratuita o el período pagado y no hay un pago aprobado que lo cubra. Muestra el importe y lo que hay que hacer
 * (pagar, elegir un plan o actualizar el medio de pago). No es sólo lectura: sin un pago aprobado no se usa TeacherFlow. No se borra nada: los datos siguen intactos.
 * Se actualiza sola mientras se confirma un pago: apenas Rebill lo aprueba, el acceso vuelve sin cerrar sesión. Si la cuenta NO está bloqueada, vuelve a Inicio.
 */
export default async function SuscripcionPendientePage() {
  const data = await loadBillingPageData();
  const user = await getRenderUser();
  const access = user ? await resolveAccessForNotice(user).catch(() => null) : null;
  if (!data) redirect("/inicio");
  // Pago confirmado (o cuenta al día): vuelve a Inicio sola. Del lado del servidor al entrar; del lado del cliente durante una actualización suave (ver `AccessRestoredRedirect`).
  if (access?.level !== "blocked") {
    return (
      <div className={PAGE_WIDTH.medium}>
        <PageHeader title="Tu suscripción está al día" subtitle="Te llevamos a Inicio." />
        <AccessRestoredRedirect />
      </div>
    );
  }
  if (!data.demo) await requestPriorityPoll();
  const { view } = data;
  const confirming = view.state === "processing" || view.state === "renewing" || view.state === "payment_failed";

  return (
    <div className={PAGE_WIDTH.medium}>
      <PageHeader title="Suscripción pendiente" subtitle="Tu acceso a TeacherFlow está en pausa hasta que se apruebe el pago. Tus alumnos, clases, registros y pagos están a salvo." />
      <div className="mt-7 flex flex-col gap-5">
        {view.plan ? (
          <Notice tone="warn" title="Importe a pagar">
            {view.plan.price} {view.plan.cadence} (plan {view.plan.name}). Apenas se apruebe el pago, TeacherFlow vuelve a abrirse solo: no hace falta cerrar sesión.
          </Notice>
        ) : (
          <Notice tone="warn" title="Elegí un plan para continuar">
            Podés pagar por mes, trimestre, semestre o año. Apenas se apruebe el pago, TeacherFlow se abre solo.
          </Notice>
        )}
        <SubscriptionCard view={view} demo={data.demo} />
        {confirming && !data.demo && <AutoRefresh />}
        {!data.demo && <AccessRecoveryWatcher />}
        <SupportCard support={data.support} />
      </div>
    </div>
  );
}
