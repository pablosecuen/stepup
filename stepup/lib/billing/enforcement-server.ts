import "server-only";
import { cookies } from "next/headers";
import type { AuthUser } from "@/lib/auth/auth-adapter";
import { getBillingRuntime } from "./runtime";
import { STATE_COOKIE, STATE_COOKIE_MAX_AGE_SECONDS, createAccessResolver, maybeGuardFetch, type CookieIo } from "./enforcement";
import { logBilling } from "./log";

/** Comprobante firmado de la última verificación (cookie HttpOnly): sólo se puede escribir dentro de una acción del servidor; en un render `set` lanza y se ignora. */
const cookieIo: CookieIo = {
  async read() {
    return (await cookies()).get(STATE_COOKIE)?.value;
  },
  async write(value) {
    (await cookies()).set(STATE_COOKIE, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: STATE_COOKIE_MAX_AGE_SECONDS });
  },
};

/**
 * `fetch` protegido para el cliente de Supabase de ESTA persona, o `undefined` si el control de acceso está apagado (ver `enforcement.ts`).
 * Es el único lugar donde se arma: `requireAuthenticatedDbContext` lo usa para TODA lectura/escritura de datos de la web.
 */
export function enforcementFetchFor(user: AuthUser, supabaseUrl: string): typeof fetch | undefined {
  const runtime = getBillingRuntime();
  return maybeGuardFetch({
    env: process.env,
    ownerId: user.id,
    accountCreatedAt: user.createdAt ?? null,
    store: runtime.store,
    now: runtime.now,
    cookie: cookieIo,
    supabaseOrigin: supabaseUrl,
    onBlocked: ({ reason, status }) => logBilling("access", "write_blocked", { reason, status: status ?? "unknown" }, "warn"),
  });
}

/** Acceso de la persona para MOSTRAR el aviso del layout (la decisión real de cada escritura la toma la guarda de `fetch`). `null` con el control apagado. */
export async function resolveAccessForNotice(user: AuthUser): Promise<import("./access").BillingAccess | null> {
  const runtime = getBillingRuntime();
  if (!runtime.flags.enforcement) return null;
  return createAccessResolver({ env: process.env, ownerId: user.id, accountCreatedAt: user.createdAt ?? null, store: runtime.store, now: runtime.now, cookie: cookieIo })();
}
