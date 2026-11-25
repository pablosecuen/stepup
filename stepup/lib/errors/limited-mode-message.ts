/**
 * Mensaje del modo limitado — PURO (sin entorno, red ni React). Lo comparten la guarda del servidor (cuerpo del 403), el traductor de errores
 * (`domainErrorMessage`) y la interfaz (que reconoce el texto para ofrecer el acceso a Facturación). Una sola fuente: si el texto cambia, cambia en todos.
 */

/** Código que devuelve la guarda del servidor cuando bloquea una escritura de una cuenta limitada. Un error técnico real NUNCA usa este código. */
export const BILLING_LIMITED_CODE = "TF_BILLING_LIMITED";

/** Código SQLSTATE que levanta la compuerta de la base (compuerta de la base, migración 20261125130000) cuando bloquea una escritura. Mismo significado que el anterior. */
export const BILLING_LIMITED_DB_CODE = "TF006";

/** Texto breve que ve la persona. El acceso a Facturación lo agrega la interfaz (enlace), no el texto. */
export const LIMITED_MODE_USER_MESSAGE = "Tu cuenta está en modo limitado: no podés crear ni modificar datos hasta regularizar tu suscripción.";

export function isLimitedModeMessage(value: unknown): boolean {
  return typeof value === "string" && value.trim() === LIMITED_MODE_USER_MESSAGE;
}
