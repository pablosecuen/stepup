import PrivateLink from "@/components/nav/private-link";
import { Notice } from "@/components/ui/notice";
import { linkClass } from "@/components/ui/button";
import { AccessRecoveryWatcher } from "@/components/billing/limited-mode-action";
import type { BillingAccess } from "@/lib/billing/access";

/**
 * Aviso del área privada cuando el control de acceso está encendido y la cuenta no tiene acceso completo (sólo texto + ícono + enlace: nunca sólo color).
 * Es información: lo que realmente impide escribir es la guarda del servidor (lib/billing/enforcement.ts), no este aviso.
 */
export function AccessBanner({ access }: { access: BillingAccess | null }) {
  if (!access || access.level === "full") return null;
  const limited = access.level === "limited";
  const title = limited ? "Tu cuenta está en modo limitado" : access.reason === "subscription_ending" ? "Tu suscripción termina pronto" : "Hay un problema con tu pago";
  const body = limited
    ? "Podés ver y exportar tus datos, pero no crear ni modificar información hasta regularizar tu suscripción. Tus datos están a salvo."
    : access.reason === "subscription_ending"
      ? "Cancelaste la renovación: conservás el acceso completo hasta el final del período que ya pagaste."
      : "No pudimos cobrar tu suscripción. Seguís con acceso completo unos días: actualizá tu medio de pago para no pasar a modo limitado.";
  return (
    <div className="px-4 pt-3 nav:px-10">
      {limited && <AccessRecoveryWatcher />}
      <Notice tone="warn" title={title}>
        <p>{body}</p>
        <PrivateLink href="/facturacion" className={`${linkClass()} mt-1`}>
          Ir a Facturación
        </PrivateLink>
      </Notice>
    </div>
  );
}
