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
  const limited = access.level === "blocked";
  const title = limited ? "Suscripción pendiente" : "Tu suscripción termina pronto";
  const body = limited
    ? "Tu acceso está en pausa hasta que se apruebe el pago. Tus datos están a salvo."
    : "Cancelaste la renovación: conservás el acceso completo hasta el final de lo que ya está pago (o de la prueba gratuita) y no se te cobra más.";
  return (
    <div className="px-4 pt-3 nav:px-10">
      {limited && <AccessRecoveryWatcher />}
      <Notice tone="warn" title={title}>
        <p>{body}</p>
        <PrivateLink href={limited ? "/suscripcion-pendiente" : "/facturacion"} className={`${linkClass()} mt-1`}>
          {limited ? "Resolver el pago" : "Ir a Facturación"}
        </PrivateLink>
      </Notice>
    </div>
  );
}
