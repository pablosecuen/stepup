import { SUBSCRIPTION_TERMS, ownerIdentificationLine } from "../business/subscription-terms.ts";
import { PUBLIC_BUSINESS } from "../business/public-profile.ts";

/**
 * Textos mínimos de la suscripción (renovación, cancelación, cobros rechazados, devoluciones, privacidad del documento y tratamiento
 * del pago). Describen lo que el sistema hace hoy y NO son asesoramiento legal: siguen mostrando el aviso de borrador hasta que
 * `BILLING_LEGAL_REVIEWED` sea «true», y ese indicador sólo se enciende cuando una revisión legal efectivamente se hizo.
 *
 * FUENTE ÚNICA (25/11/2026): la identificación del titular y el contacto salen de `lib/business/public-profile.ts` (los mismos datos que
 * muestran los Términos, la Privacidad y Contacto), y lo que se repite en los Términos públicos sale de `lib/business/subscription-terms.ts`.
 * Antes este archivo traía sus propios marcadores «[A DEFINIR]» escritos el 14/10/2026, antes de que esos datos se cargaran (4/11/2026).
 * No se inventan plazos ni condiciones comerciales: lo que sigue sin definirse figura en `LEGAL_PENDING` (para quien revisa), no como un
 * hueco dentro del texto que lee la persona. Módulo puro: sin entorno ni servidor.
 */
export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

/** Lo que todavía necesita una DECISIÓN o una revisión (no se muestra a las personas; ver docs/billing/TEXTOS_PARA_REVISION_20261125.md). */
export const LEGAL_PENDING: readonly string[] = [
  "Revisión legal de los textos de esta página y de los Términos y la Privacidad públicos (con su constancia, antes de encender BILLING_LEGAL_REVIEWED).",
  "Política comercial de devoluciones: si habrá un plazo propio, y su alcance respecto de las comisiones del servicio de cobro (hoy sólo se remite a la legislación vigente; no se promete ninguna devolución).",
  "Plazo en días del aviso previo ante un cambio de precio (hoy: «se informará su alcance y la fecha de entrada en vigencia»).",
  "Confirmar que el titular que figura (persona humana, CUIT declarado ante Rebill) es quien debe figurar como responsable de la suscripción, o cargar una razón social si cambia.",
];

export const LEGAL_SECTIONS: readonly LegalSection[] = [
  {
    id: "responsable",
    title: "Quién ofrece la suscripción",
    paragraphs: [ownerIdentificationLine(), `Para consultas sobre tu suscripción, pagos o datos: ${PUBLIC_BUSINESS.email}.`],
  },
  {
    id: "renovacion",
    title: "Renovación automática",
    paragraphs: [
      "La suscripción se renueva sola al terminar cada período (mensual, trimestral, semestral o anual) y se cobra el precio completo del plan elegido, en pesos argentinos, con el mismo medio de pago, hasta que la canceles.",
      "No hay costo de alta ni cuotas.",
      SUBSCRIPTION_TERMS.trial,
      SUBSCRIPTION_TERMS.priceChange,
      "Por ahora no se ofrece cambiar de plan desde la cuenta: para hacerlo, cancelá la renovación y volvé a suscribirte al terminar el período pagado, o escribinos.",
    ],
  },
  {
    id: "cancelacion",
    title: "Cancelación",
    paragraphs: [
      "Podés cancelar la renovación cuando quieras desde Facturación, o pedirlo por correo. Conservás el acceso completo hasta el final del período que ya pagaste (o de la prueba gratuita, si cancelás durante la prueba: no se cobra) y no se vuelve a cobrar.",
      "Cancelar nunca borra tus datos. Si eliminás tu cuenta, primero cancelamos y confirmamos la cancelación en el servicio de cobro.",
    ],
  },
  {
    id: "rechazo",
    title: "Si un cobro es rechazado",
    paragraphs: [
      SUBSCRIPTION_TERMS.withoutPayment,
      "El servicio de cobro puede reintentar el cobro por su cuenta. Un cobro pendiente o rechazado no habilita el uso; si un reintento se aprueba, el acceso vuelve solo, sin cerrar sesión.",
      "Si el servicio de cobro deja de reintentar sin lograr el cobro, la suscripción termina: tus datos siguen intactos y podés volver a suscribirte desde Facturación para recuperar el acceso completo.",
      "Tus datos nunca se borran por un pago fallido.",
    ],
  },
  {
    id: "devoluciones",
    title: "Devoluciones y disputas",
    paragraphs: [
      SUBSCRIPTION_TERMS.requests,
      "No hay devoluciones automáticas: cada solicitud se evalúa y se responde por correo.",
      "Cuando una devolución total se confirma en el servicio de cobro, el período devuelto se cierra: no se extiende y termina el acceso que otorgaba. Una devolución parcial o dudosa la revisamos manualmente.",
      "Si tu banco o la tarjeta informan una disputa (contracargo) y se confirma, el acceso queda en pausa hasta resolverla.",
    ],
  },
  {
    id: "privacidad",
    title: "Tus datos personales y de pago",
    paragraphs: [
      "Los datos de tu tarjeta, tu nombre y tu documento (DNI o CUIT/CUIL), si el servicio de cobro los pide, los cargás una sola vez en el sitio seguro del servicio de cobro, al contratar. A TeacherFlow sólo le llega el correo de tu cuenta, que se usa para prellenar el pago.",
      "TeacherFlow no guarda tu tarjeta, tu nombre ni tu documento: no quedan en la base de datos, en registros, en direcciones web, en mensajes de error ni en analítica.",
      "El servicio de cobro puede enviarte por su cuenta los comprobantes y avisos de cada cobro al correo que uses al contratar.",
      "Al eliminar tu cuenta conservamos 10 años, por obligación de conservación de documentación fiscal, un registro mínimo y seudonimizado de cada operación (referencia, fecha, importe, moneda, estado y comprobante), sin tu documento ni datos de tarjeta.",
    ],
  },
  {
    id: "pago",
    title: "Cómo se procesa el pago",
    paragraphs: [
      "El pago lo procesa un servicio de cobro externo (Rebill), en su sitio seguro. TeacherFlow nunca ve ni guarda los datos de tu tarjeta.",
      "Los avisos que el servicio de cobro nos envía se tratan como simples señales: antes de cambiar tu acceso, consultamos el estado real del pago de forma autenticada. Volver desde el sitio de pago, por sí solo, tampoco activa nada.",
    ],
  },
];

export const LEGAL_DRAFT_NOTICE = "Borrador pendiente de revisión legal. Describe lo que el sistema hace hoy; la política de devoluciones y el plazo de aviso por cambios de precio todavía se están definiendo.";

/** ¿Ya se revisó el texto? Sólo el valor exacto «true» lo da por revisado; cualquier otro (o la falta) deja el aviso de borrador visible. Debe reflejar una revisión efectivamente realizada. */
export function isLegalReviewed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.BILLING_LEGAL_REVIEWED?.trim() === "true";
}
