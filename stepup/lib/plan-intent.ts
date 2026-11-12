/**
 * Intención de contratar un plan — PURO. Quien elige un plan en la página pública (`/planes`) puede no tener cuenta todavía: la elección viaja en una cookie corta (sólo el
 * CÓDIGO del plan, sin datos personales; el precio, el período y todo lo demás los resuelve siempre el servidor desde el catálogo) y sobrevive al registro, la
 * confirmación del correo y el inicio de sesión. Sirve sólo para preseleccionar el plan: no activa nada ni crea ningún pago.
 */
export const PLAN_INTENT_COOKIE = "tf_plan_intent";
export const PLAN_INTENT_MAX_AGE_SECONDS = 7 * 24 * 3600;

const PLAN_CODE_SHAPE = /^tf_[a-z]{3,12}_ars_v[0-9]{1,3}$/;

/** El código si tiene la forma de un código de plan; si no, `null`. La validación contra el catálogo vigente la hace el servidor al armar la pantalla. */
export function parsePlanIntent(value: string | null | undefined): string | null {
  return typeof value === "string" && PLAN_CODE_SHAPE.test(value) ? value : null;
}

/** A dónde llevar a quien ya tiene sesión y venía de elegir un plan. */
export function planIntentDestination(planCode: string): string {
  return `/facturacion/planes?plan=${encodeURIComponent(planCode)}`;
}
