import { PUBLIC_BUSINESS } from "./public-profile.ts";

/**
 * Textos de la suscripción a TeacherFlow que se muestran en MÁS DE UN lugar (Términos y Condiciones públicos y «Condiciones de la
 * suscripción» de Facturación). Existen una sola vez acá: antes cada pantalla tenía su propia redacción y podían contradecirse (la de
 * Facturación nació el 14/10/2026, antes de que el titular y su contacto se cargaran en `public-profile.ts` el 4/11/2026, y quedó con
 * marcadores «A DEFINIR»). Sólo dicen lo que ya está decidido: no inventan plazos, comisiones ni devoluciones.
 */

/** Identificación del titular, tal como la declara `PUBLIC_BUSINESS` (única fuente). */
export function ownerIdentificationLine(): string {
  return `TeacherFlow es ofrecido por ${PUBLIC_BUSINESS.name}, CUIT ${PUBLIC_BUSINESS.cuit}, con domicilio en ${PUBLIC_BUSINESS.address}.`;
}

export const SUBSCRIPTION_TERMS = {
  /** Aviso ante un cambio de precio o de condiciones (sin plazo en días: no está definido). */
  priceChange:
    "Antes de un cambio de precio o de condiciones de una suscripción vigente se informará su alcance y la fecha de entrada en vigencia por los canales de la cuenta, con posibilidad de solicitar la baja antes del siguiente cobro. Los cambios no alteran retroactivamente períodos ya pagados.",
  /** Cómo se pide una baja, el arrepentimiento o una devolución. No promete ninguna devolución ni plazo. */
  requests:
    "Podés solicitar la baja, el arrepentimiento de la contratación o una devolución mediante el correo publicado en Contacto. La solicitud de baja de una suscripción evita renovaciones posteriores a su efectividad y no elimina por sí sola los datos de la cuenta. El acceso al período efectivamente pagado se conserva hasta su finalización, salvo que corresponda una devolución o una obligación legal distinta. Los derechos de revocación y las devoluciones se aplican conforme a la legislación y a las circunstancias de la contratación. Estos términos no limitan derechos irrenunciables. No es necesario iniciar sesión para acceder a Contacto.",
  /** Cobro hoy en preparación (sólo mientras la contratación no esté abierta a todos). */
  contractingInPreparation:
    "La contratación online está en preparación; consultar los planes o crear una cuenta no inicia una suscripción ni autoriza un cobro. Cuando se habilite, se informarán antes de confirmar el pago el importe total, el período, el medio de pago y las condiciones de renovación.",
  /** Cobro habilitado. */
  contractingOpen:
    "Antes de confirmar el pago se informan el importe total, el período, el medio de pago y las condiciones de renovación. Consultar los planes o crear una cuenta no inicia una suscripción ni autoriza un cobro.",
} as const;
