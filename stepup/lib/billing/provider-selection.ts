/**
 * Qué adaptador de proveedor usa el servidor — PURO. Regla de seguridad: el adaptador FALSO (que nunca cobra ni habla con la red) sólo existe fuera de Production.
 * El proveedor vigente es Rebill; en Production, sin credenciales (o con una configuración que mezcla ambientes), queda CERRADO: cada operación devuelve «no
 * configurado» y nada sale de la red. Mobbex queda sólo como adaptador explícito (`BILLING_PROVIDER=mobbex`) para operaciones históricas; nunca es el valor por defecto.
 * Así, ni por un error de configuración una cuenta real puede «suscribirse» contra el doble de prueba.
 */
export type ProviderChoice = "rebill" | "mobbex" | "fake";

export function resolveProviderChoice(env: Readonly<Record<string, string | undefined>>): ProviderChoice {
  const requested = env.BILLING_PROVIDER?.trim().toLowerCase();
  if (requested === "fake" && env.VERCEL_ENV !== "production") return "fake";
  if (requested === "mobbex") return "mobbex";
  return "rebill";
}

/** Simulaciones de demostración (pantallas con estados de ejemplo): únicamente en el servidor de desarrollo local. */
export function demoScenariosAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV === "development" && env.VERCEL_ENV === undefined && env.BILLING_PROVIDER?.trim().toLowerCase() === "fake";
}

/**
 * ¿Sólo cuentan operaciones REALES? Con Rebill: sí cuando el ambiente configurado es `production` (una operación de prueba, `test_…`, se ignora aunque llegue) y no en
 * `sandbox` (ahí todo es de prueba). Con Mobbex: salvo que se declare sandbox. Con el adaptador falso (sólo fuera de Production) todo vale.
 */
export function expectsLiveOperations(provider: ProviderChoice, env: Readonly<Record<string, string | undefined>>): boolean {
  if (provider === "rebill") return env.REBILL_ENVIRONMENT?.trim().toLowerCase() !== "sandbox";
  if (provider === "mobbex") return env.MOBBEX_SANDBOX?.trim().toLowerCase() !== "true";
  return false;
}
