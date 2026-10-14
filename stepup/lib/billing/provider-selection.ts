/**
 * Qué adaptador de proveedor usa el servidor — PURO. Regla de seguridad: el adaptador FALSO (que nunca cobra ni habla con la red)
 * sólo existe fuera de Production. En Production siempre es el de Mobbex, que sin credenciales queda CERRADO (cada operación
 * devuelve «no configurado» y nada sale de la red). Así, ni por un error de configuración una cuenta real puede «suscribirse»
 * contra el doble de prueba.
 */
export type ProviderChoice = "mobbex" | "fake";

export function resolveProviderChoice(env: Readonly<Record<string, string | undefined>>): ProviderChoice {
  const requested = env.BILLING_PROVIDER?.trim().toLowerCase();
  if (requested === "fake" && env.VERCEL_ENV !== "production") return "fake";
  return "mobbex";
}

/** Simulaciones de demostración (pantallas con estados de ejemplo): únicamente en el servidor de desarrollo local. */
export function demoScenariosAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NODE_ENV === "development" && env.VERCEL_ENV === undefined && env.BILLING_PROVIDER?.trim().toLowerCase() === "fake";
}
