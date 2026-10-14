/**
 * Textos mínimos de la suscripción (renovación, cancelación, cobros rechazados, devoluciones, privacidad del documento y tratamiento
 * del pago). Son un BORRADOR de producto: describen exactamente lo que el sistema hace hoy y NO son asesoramiento legal.
 * Todo lo que depende de una decisión de TeacherFlow o de su asesoría queda marcado «[A DEFINIR: …]» y listado en `LEGAL_PENDING`;
 * mientras `BILLING_LEGAL_REVIEWED` no sea «true» la página lo dice con un aviso visible. No hay razón social, CUIT ni domicilio
 * inventados. Módulo puro: sin entorno ni servidor.
 */
export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const LEGAL_PENDING: readonly string[] = [
  "Razón social, CUIT y domicilio del responsable de la suscripción.",
  "Política y plazos para solicitar una devolución.",
  "Política de aviso previo ante un cambio de precio.",
  "Texto definitivo de privacidad y de términos, revisado por asesoría legal.",
];

export const LEGAL_SECTIONS: readonly LegalSection[] = [
  {
    id: "responsable",
    title: "Quién ofrece la suscripción",
    paragraphs: ["TeacherFlow. [A DEFINIR: razón social, CUIT y domicilio del responsable]."],
  },
  {
    id: "renovacion",
    title: "Renovación automática",
    paragraphs: [
      "La suscripción se renueva sola al terminar cada período (mensual, trimestral, semestral o anual) y se cobra el precio completo del plan elegido, en pesos argentinos, con el mismo medio de pago, hasta que la canceles.",
      "No hay período de prueba, costo de alta ni cuotas. [A DEFINIR: aviso previo ante un cambio de precio].",
      "Si cambiás de plan, el cambio rige desde la próxima renovación, sin prorrateo ni crédito.",
    ],
  },
  {
    id: "cancelacion",
    title: "Cancelación",
    paragraphs: [
      "Podés cancelar cuando quieras desde Facturación. Conservás el acceso completo hasta el final del período que ya pagaste y no se vuelve a cobrar.",
      "Cancelar nunca borra tus datos. Si eliminás tu cuenta, primero cancelamos y confirmamos la cancelación en el servicio de cobro.",
    ],
  },
  {
    id: "rechazo",
    title: "Si un cobro es rechazado",
    paragraphs: [
      "Tenés 5 días corridos con acceso completo y un aviso para actualizar tu medio de pago. Si no se regulariza, tu cuenta pasa a modo limitado desde las 00:00 del sexto día: podés ingresar, ver y exportar tus datos, administrar tu facturación y contactar a soporte, pero no crear, editar ni importar información.",
      "Cuando el pago se regulariza, el acceso completo vuelve. Tus datos nunca se borran por un pago fallido.",
    ],
  },
  {
    id: "devoluciones",
    title: "Devoluciones y disputas",
    paragraphs: [
      "Una devolución total confirmada por el servicio de cobro cierra el período devuelto: no lo extiende y termina el acceso que otorgaba. Una devolución parcial o dudosa la revisamos manualmente.",
      "Si tu banco o la tarjeta informan una disputa (contracargo) y se confirma, el acceso queda en modo limitado hasta resolverla.",
      "[A DEFINIR: plazo y condiciones para solicitar una devolución].",
    ],
  },
  {
    id: "privacidad",
    title: "Tu DNI o CUIT/CUIL",
    paragraphs: [
      "Te lo pedimos una sola vez, al contratar, porque el servicio de cobro lo exige para registrar la suscripción. Viaja directo de nuestro servidor al servicio de cobro.",
      "TeacherFlow no lo guarda: no queda en la base de datos, en registros, en direcciones web, en mensajes de error ni en analítica, y se borra de la pantalla apenas continuás.",
      "Al eliminar tu cuenta conservamos 10 años, por obligación de conservación de documentación fiscal, un registro mínimo y seudonimizado de cada operación (referencia, fecha, importe, moneda, estado y comprobante), sin tu documento ni datos de tarjeta.",
    ],
  },
  {
    id: "pago",
    title: "Cómo se procesa el pago",
    paragraphs: [
      "El pago lo procesa un servicio de cobro externo (Mobbex), en su sitio seguro. TeacherFlow nunca ve ni guarda los datos de tu tarjeta.",
      "Los avisos que el servicio de cobro nos envía se tratan como simples señales: antes de cambiar tu acceso, consultamos el estado real del pago de forma autenticada. Volver desde el sitio de pago, por sí solo, tampoco activa nada.",
    ],
  },
];

export const LEGAL_DRAFT_NOTICE = "Borrador pendiente de revisión legal. Describe lo que el sistema hace hoy; lo marcado «A DEFINIR» lo completa TeacherFlow.";

/** ¿Ya se revisó el texto? Sólo el valor exacto «true» lo da por revisado; cualquier otro (o la falta) deja el aviso de borrador visible. */
export function isLegalReviewed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.BILLING_LEGAL_REVIEWED?.trim() === "true";
}
