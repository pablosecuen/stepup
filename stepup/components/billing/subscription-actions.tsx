"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, PrivateButtonLink } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { guardNetwork } from "@/lib/actions/network-guard";
import { cancelSubscriptionAction, reactivateSubscriptionAction, updatePaymentMethodAction, type BillingActionResult } from "@/lib/actions/billing";
import { actionError, safeProviderRedirect } from "@/lib/billing/redirect";
import type { ViewActions } from "@/lib/billing/view";

// Acciones de la suscripción. Sólo aparece lo que funciona (el servidor ya filtró por capacidades validadas). Cancelar pide
// confirmación y dice exactamente qué pasa: hasta cuándo conserva el acceso y que no se borra nada.

export function SubscriptionActions({ actions, cancelAccessUntil, demo }: { actions: ViewActions; cancelAccessUntil: string | null; demo: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const any = actions.subscribe || actions.cancel || actions.reactivate || actions.changePlan || actions.updatePaymentMethod;
  if (!any) return null;

  function run(action: () => Promise<BillingActionResult>, after?: (result: BillingActionResult) => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      const failure = actionError(result);
      if (failure) {
        setError(failure);
        return;
      }
      setConfirming(false);
      after?.(result);
      router.refresh();
    });
  }

  function goToProvider(result: BillingActionResult) {
    const target = result.ok ? safeProviderRedirect(result.redirectUrl, window.location.origin) : null;
    if (target) window.location.assign(target);
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        {actions.subscribe && (
          <PrivateButtonLink href="/facturacion/planes" variant="accent">
            Elegir un plan
          </PrivateButtonLink>
        )}
        {actions.changePlan && (
          <PrivateButtonLink href="/facturacion/planes" variant="secondary">
            Cambiar de plan
          </PrivateButtonLink>
        )}
        {actions.updatePaymentMethod && (
          <Button variant="secondary" busy={pending} disabled={demo} onClick={() => run(() => guardNetwork(() => updatePaymentMethodAction()), goToProvider)}>
            Actualizar medio de pago
          </Button>
        )}
        {actions.reactivate && (
          <Button variant="accent" busy={pending} disabled={demo} onClick={() => run(() => guardNetwork(() => reactivateSubscriptionAction()))}>
            Reactivar suscripción
          </Button>
        )}
        {actions.cancel && (
          <Button variant="dangerGhost" disabled={demo} onClick={() => setConfirming(true)} aria-haspopup="dialog">
            Cancelar suscripción
          </Button>
        )}
      </div>

      {error && !confirming && <FormErrorBox message={error} />}

      {confirming && (
        <Dialog
          title="¿Cancelar tu suscripción?"
          size="sm"
          busy={pending}
          onClose={() => (pending ? undefined : setConfirming(false))}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
                Mantener suscripción
              </Button>
              <Button variant="danger" busy={pending} onClick={() => run(() => guardNetwork(() => cancelSubscriptionAction()))}>
                {pending ? "Cancelando..." : "Sí, cancelar"}
              </Button>
            </>
          }
        >
          <p className="text-[15px] leading-relaxed text-textSecondary">
            {cancelAccessUntil ? (
              <>
                Vas a conservar el acceso completo hasta el <strong className="text-textPrimary">{cancelAccessUntil}</strong>, que es el final de lo que ya pagaste. Después no se te vuelve a cobrar.
              </>
            ) : (
              <>No se te va a cobrar más.</>
            )}{" "}
            <strong className="text-textPrimary">No se borra ninguno de tus datos</strong>: podés ingresar, verlos y exportarlos cuando quieras, y reactivar o volver a suscribirte más adelante.
          </p>
          {error && <FormErrorBox message={error} />}
        </Dialog>
      )}
    </div>
  );
}
