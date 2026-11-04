import { TextLink } from "@/components/auth/public-links";
import { PUBLIC_BUSINESS } from "@/lib/business/public-profile";

export function PublicFooterLinks() {
  return <nav aria-label="Información comercial y legal" className="flex flex-wrap justify-center gap-x-5 gap-y-1">
    <TextLink href="/planes">Planes y precios</TextLink>
    {PUBLIC_BUSINESS.contactConfirmed && <>
      <TextLink href="/terminos-y-condiciones">Términos y Condiciones</TextLink>
      <TextLink href="/politica-de-privacidad">Política de Privacidad</TextLink>
      <TextLink href="/contacto">Contacto</TextLink>
    </>}
  </nav>;
}
