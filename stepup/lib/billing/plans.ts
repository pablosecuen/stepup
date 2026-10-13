/**
 * Catálogo AUTORITATIVO de planes (M1). Es la única fuente de precios, monedas, intervalos y períodos de acceso:
 *
 *  - el navegador NUNCA envía ni decide precio, plan, período, moneda ni propietaria: sólo puede pedir un `code` del catálogo,
 *    y el servidor resuelve todo lo demás desde acá (`getPlan`);
 *  - la interfaz recibe los precios ya resueltos del servidor (`listPublicPlans`); ningún componente cliente duplica un precio;
 *  - el importe se guarda en la unidad mínima (centavos de peso, entero): `amountMinor = 2_490_000` es $ 24.900,00. Nunca se
 *    calcula con decimales flotantes;
 *  - el espejo SQL (`billing_plans`, migración `20261014100000_m1_billing_core.sql`) debe coincidir con este archivo: una prueba
 *    estructural compara código, importes, intervalos y versión de ambos lados.
 *
 * Sin período de prueba, sin costo de alta y sin cuotas internas: cada plan cobra el precio completo de su período.
 */

export const BILLING_CURRENCY = "ARS" as const;
export type BillingCurrency = typeof BILLING_CURRENCY;

/** Unidades de importe: 100 centavos = 1 peso. */
export const MINOR_UNITS_PER_PESO = 100;

export const PLAN_CODES = ["tf_monthly_ars_v1", "tf_quarterly_ars_v1", "tf_semiannual_ars_v1", "tf_annual_ars_v1"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** Intervalos que admite el proveedor (Mobbex, `interval` de una suscripción dinámica): 1m, 3m, 6m y 1y. */
export type ProviderInterval = "1m" | "3m" | "6m" | "1y";

export interface BillingPlan {
  readonly code: PlanCode;
  readonly name: string;
  readonly currency: BillingCurrency;
  /** Precio completo del período, en centavos (entero). */
  readonly amountMinor: number;
  readonly interval: { readonly unit: "month"; readonly count: number };
  /** Meses de acceso que compra un cobro aprobado de este plan. */
  readonly monthsOfAccess: number;
  readonly providerInterval: ProviderInterval;
  readonly active: boolean;
  /** Versión del precio: un cambio de precio crea un código nuevo (`..._v2`), nunca edita el vigente. */
  readonly priceVersion: number;
}

const PLANS: Readonly<Record<PlanCode, BillingPlan>> = Object.freeze({
  tf_monthly_ars_v1: Object.freeze({
    code: "tf_monthly_ars_v1",
    name: "Mensual",
    currency: BILLING_CURRENCY,
    amountMinor: 2_490_000,
    interval: Object.freeze({ unit: "month", count: 1 }),
    monthsOfAccess: 1,
    providerInterval: "1m",
    active: true,
    priceVersion: 1,
  }),
  tf_quarterly_ars_v1: Object.freeze({
    code: "tf_quarterly_ars_v1",
    name: "Trimestral",
    currency: BILLING_CURRENCY,
    amountMinor: 6_990_000,
    interval: Object.freeze({ unit: "month", count: 3 }),
    monthsOfAccess: 3,
    providerInterval: "3m",
    active: true,
    priceVersion: 1,
  }),
  tf_semiannual_ars_v1: Object.freeze({
    code: "tf_semiannual_ars_v1",
    name: "Semestral",
    currency: BILLING_CURRENCY,
    amountMinor: 13_390_000,
    interval: Object.freeze({ unit: "month", count: 6 }),
    monthsOfAccess: 6,
    providerInterval: "6m",
    active: true,
    priceVersion: 1,
  }),
  tf_annual_ars_v1: Object.freeze({
    code: "tf_annual_ars_v1",
    name: "Anual",
    currency: BILLING_CURRENCY,
    amountMinor: 24_900_000,
    interval: Object.freeze({ unit: "month", count: 12 }),
    monthsOfAccess: 12,
    providerInterval: "1y",
    active: true,
    priceVersion: 1,
  }),
});

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && (PLAN_CODES as readonly string[]).includes(value);
}

/** Plan del catálogo o `null`. Acepta `unknown`: el valor suele venir del navegador o del proveedor y nunca se asume válido. */
export function getPlan(code: unknown): BillingPlan | null {
  return isPlanCode(code) ? PLANS[code] : null;
}

/** Planes que se pueden contratar hoy, en orden de período creciente. */
export function listActivePlans(): readonly BillingPlan[] {
  return PLAN_CODES.map((code) => PLANS[code]).filter((plan) => plan.active);
}

/** Vista que sale del servidor hacia la interfaz: precio ya resuelto, nada que la pantalla tenga que calcular o duplicar. */
export interface PublicPlanView {
  readonly code: PlanCode;
  readonly name: string;
  readonly currency: BillingCurrency;
  readonly amountMinor: number;
  readonly amountPesos: number;
  readonly monthsOfAccess: number;
}

export function listPublicPlans(): readonly PublicPlanView[] {
  return listActivePlans().map((plan) => ({
    code: plan.code,
    name: plan.name,
    currency: plan.currency,
    amountMinor: plan.amountMinor,
    amountPesos: plan.amountMinor / MINOR_UNITS_PER_PESO,
    monthsOfAccess: plan.monthsOfAccess,
  }));
}

export type PlanMismatch = "unknown_plan" | "inactive_plan" | "currency_mismatch" | "amount_mismatch";

/**
 * Valida un cobro informado (importe, moneda y plan) contra el catálogo del servidor. Cualquier diferencia —por mínima que
 * sea— se rechaza: un importe distinto del precio completo del plan nunca activa ni renueva nada.
 */
export function validateAgainstCatalog(input: { planCode: unknown; amountMinor: unknown; currency: unknown }): { ok: true; plan: BillingPlan } | { ok: false; reason: PlanMismatch } {
  const plan = getPlan(input.planCode);
  if (!plan) return { ok: false, reason: "unknown_plan" };
  if (!plan.active) return { ok: false, reason: "inactive_plan" };
  if (input.currency !== plan.currency) return { ok: false, reason: "currency_mismatch" };
  if (typeof input.amountMinor !== "number" || !Number.isSafeInteger(input.amountMinor) || input.amountMinor !== plan.amountMinor) return { ok: false, reason: "amount_mismatch" };
  return { ok: true, plan };
}
