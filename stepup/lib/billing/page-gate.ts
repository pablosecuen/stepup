import { getBillingRuntime } from "./runtime";
import { createAccessResolver } from "./enforcement";
import { BLOCKED_ACCOUNT_HOME, isAllowedWhenBlocked } from "./blocked-paths";

/**
 * Compuerta de PÁGINAS para cuentas bloqueadas (la corre `proxy.ts` en cada navegación del área privada, también las del cliente: el layout no se vuelve a ejecutar entre páginas).
 * Devuelve el destino al que hay que redirigir, o `null` si la cuenta puede seguir. Sólo redirige con un resultado DEFINITIVO («bloqueada»); si el estado no se pudo leer
 * (falla propia) no bloquea acá: lo deciden la guarda de datos del servidor y la verificación del layout, que conocen más de la cuenta. Con el control de acceso apagado no hace nada.
 * Es una capa de navegación: lo que realmente impide leer o escribir datos es la guarda de `fetch` del servidor (`enforcement.ts`), que no depende de la URL.
 */
const CACHE_MS = 10_000;
const cache = new Map<string, { readonly at: number; readonly blocked: boolean }>();

export async function resolveBlockedRedirect(input: { readonly userId: string; readonly pathname: string }): Promise<string | null> {
  const runtime = getBillingRuntime();
  if (!runtime.flags.enforcement || isAllowedWhenBlocked(input.pathname)) return null;
  const now = runtime.now().getTime();
  const hit = cache.get(input.userId);
  if (hit && now - hit.at < CACHE_MS) return hit.blocked ? BLOCKED_ACCOUNT_HOME : null;
  const access = await createAccessResolver({ env: process.env, ownerId: input.userId, accountCreatedAt: null, store: runtime.store, now: runtime.now })();
  const blocked = access.level === "blocked" && !access.reason.startsWith("state_unavailable");
  if (cache.size > 5_000) cache.clear();
  cache.set(input.userId, { at: now, blocked });
  return blocked ? BLOCKED_ACCOUNT_HOME : null;
}

/** Sólo para pruebas: olvida lo guardado. */
export function resetPageGateCache(): void {
  cache.clear();
}
