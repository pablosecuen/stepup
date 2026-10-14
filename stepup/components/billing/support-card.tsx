import { Card } from "@/components/ui/card";
import { linkClass } from "@/components/ui/button";
import PrivateLink from "@/components/nav/private-link";

// «Ayuda y condiciones». El correo llega ya validado desde el servidor (variable de configuración): si no hay contacto configurado
// NO se dibuja ningún enlace de correo (jamás uno inventado ni roto); el enlace a las condiciones siempre está.

export function SupportCard({ support }: { support: { address: string; href: string } | null }) {
  return (
    <Card aria-labelledby="ayuda-titulo">
      <h2 id="ayuda-titulo" className="font-display text-[22px] font-semibold tracking-tight text-textPrimary">
        Ayuda y condiciones
      </h2>
      {support && <p className="mt-2 text-[15px] leading-relaxed text-textSecondary">¿Algo no salió como esperabas con un cobro o con tu suscripción? Escribinos.</p>}
      <div className="mt-1 flex flex-col items-start">
        {support && (
          <a href={support.href} className={linkClass()}>
            {support.address}
          </a>
        )}
        <PrivateLink href="/facturacion/condiciones" className={linkClass()}>
          Condiciones de la suscripción y privacidad del pago
        </PrivateLink>
      </div>
    </Card>
  );
}
