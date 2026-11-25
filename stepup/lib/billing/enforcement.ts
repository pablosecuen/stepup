import { resolveBillingAccess, type BillingAccess } from "./access.ts";
import { readBillingFlags } from "./flags.ts";
import { decodeLastKnown, encodeLastKnown } from "./last-known.ts";
import type { BillingStore } from "./store.ts";
import { BILLING_LIMITED_CODE } from "../errors/limited-mode-message.ts";
import { LIMITED_MODE_MESSAGE, allowedWhenBlocked, classifyRequest } from "./write-guard.ts";

/**
 * Control de acceso por suscripción en el SERVIDOR (apagado por defecto: `BILLING_ENFORCEMENT_ENABLED`). Dos piezas, ambas sin interfaz:
 *
 *  - `createAccessResolver`: decide el acceso de UNA cuenta con `resolveBillingAccess` (la regla de M1) leyendo su estado con el almacén de servicio
 *    (que además crea la fila si falta: las cuentas anteriores al corte nacen `grandfathered`, las nuevas `pending`). Guarda el resultado unos segundos
 *    para no consultar en cada pedido.
 *  - `guardFetch`: envuelve el `fetch` del cliente de Supabase del servidor. Un pedido de ESCRITURA que una cuenta limitada no puede hacer recibe un 403
 *    sin llegar a la base. Las lecturas, la sesión, Facturación (cliente de servicio aparte) y todo lo permitido pasan sin consultar nada.
 *
 * Con el interruptor apagado `maybeGuardFetch` devuelve `undefined` y NADA cambia (ni una consulta más). Con un error propio al leer el estado, la regla
 * de M1 decide (cuenta anterior al corte → acceso; nueva sin verificar → limitada).
 */
export const ACCESS_CACHE_MS = 10_000;
export const STATE_COOKIE = "tf-billing-state";
export const STATE_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600;

export interface CookieIo {
  read(): Promise<string | undefined>;
  write(value: string): Promise<void>;
}

export interface AccessResolverDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly ownerId: string;
  /** Alta de la cuenta en Auth (ISO), si se conoce. */
  readonly accountCreatedAt: string | null;
  readonly store: BillingStore | null;
  readonly now: () => Date;
  readonly cookie?: CookieIo;
}

export function createAccessResolver(deps: AccessResolverDeps): () => Promise<BillingAccess> {
  let cached: { readonly at: number; readonly access: BillingAccess } | null = null;
  let inflight: Promise<BillingAccess> | null = null;
  const compute = async (): Promise<BillingAccess> => {
    const flags = readBillingFlags(deps.env);
    const secret = deps.env.BILLING_STATE_COOKIE_SECRET;
    let snapshot = null;
    let read: "ok" | "failed" = "ok";
    try {
      if (!deps.store) throw new Error("sin almacén");
      snapshot = await deps.store.ensureAccount(deps.ownerId);
    } catch {
      read = "failed";
    }
    let token: string | undefined;
    try {
      token = await deps.cookie?.read();
    } catch {
      token = undefined;
    }
    const now = deps.now();
    const access = resolveBillingAccess({
      flags,
      snapshot,
      now,
      read,
      lastKnown: decodeLastKnown(secret, deps.ownerId, token, now),
      account: { createdAt: deps.accountCreatedAt },
      grandfatherCutoff: deps.env.BILLING_GRANDFATHER_CUTOFF ?? null,
    });
    // Comprobante firmado de la última verificación buena (sólo cuenta con acceso pagado o grandfathered; sirve si más adelante NUESTRA base falla).
    if (read === "ok" && snapshot && access.status && deps.cookie && access.level !== "blocked") {
      const value = encodeLastKnown(secret, deps.ownerId, { status: access.status, grandfathered: snapshot.grandfathered, verifiedAt: now.toISOString() });
      if (value) await deps.cookie.write(value).catch(() => undefined); // sólo se puede escribir dentro de una acción del servidor; en un render se ignora
    }
    return access;
  };
  return async () => {
    const nowMs = deps.now().getTime();
    if (cached && nowMs - cached.at < ACCESS_CACHE_MS) return cached.access;
    inflight ??= compute().finally(() => {
      inflight = null;
    });
    const access = await inflight;
    cached = { at: deps.now().getTime(), access };
    return access;
  };
}

function describe(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): { method: string; url: string } {
  if (typeof input === "string") return { method: init?.method ?? "GET", url: input };
  if (input instanceof URL) return { method: init?.method ?? "GET", url: input.toString() };
  return { method: init?.method ?? input.method ?? "GET", url: input.url };
}

export interface GuardOptions {
  readonly supabaseOrigin: string;
  readonly resolve: () => Promise<BillingAccess>;
  /** Para registrar (sin datos de la persona) que se bloqueó una escritura. */
  readonly onBlocked?: (info: { readonly reason: string; readonly status: string | null }) => void;
}

export function guardFetch(inner: typeof fetch, options: GuardOptions): typeof fetch {
  return async (input, init) => {
    const { method, url } = describe(input, init);
    const verdict = classifyRequest({ method, url, supabaseOrigin: options.supabaseOrigin });
    // La sesión y lo ajeno a Supabase no consultan nada. Todo lo demás (lecturas y escrituras de datos) depende del acceso: una cuenta BLOQUEADA no lee ni escribe datos operativos.
    if (verdict.reason !== "pass" && verdict.reason !== "auth") {
      const access = await options.resolve();
      if (access.level === "blocked" && !allowedWhenBlocked({ method, url, supabaseOrigin: options.supabaseOrigin })) {
        options.onBlocked?.({ reason: verdict.writes ? verdict.reason : `read_blocked:${verdict.reason}`, status: access.status });
        // Misma forma que un error de PostgREST: el cliente de Supabase la entrega como `error` con este mensaje.
        return new Response(JSON.stringify({ code: BILLING_LIMITED_CODE, message: LIMITED_MODE_MESSAGE, details: null, hint: null }), { status: 403, headers: { "content-type": "application/json" } });
      }
    }
    return inner(input, init);
  };
}

/** `undefined` (sin envoltura, comportamiento de siempre) si el control de acceso está apagado. */
export function maybeGuardFetch(deps: AccessResolverDeps & { readonly supabaseOrigin: string; readonly inner?: typeof fetch; readonly onBlocked?: GuardOptions["onBlocked"] }): typeof fetch | undefined {
  if (!readBillingFlags(deps.env).enforcement) return undefined;
  return guardFetch(deps.inner ?? fetch, { supabaseOrigin: deps.supabaseOrigin, resolve: createAccessResolver(deps), onBlocked: deps.onBlocked });
}

// ───────────────────────────────────────────── red de seguridad: clientes de servidor que NO pasan por `requireAuthenticatedDbContext`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cuenta a la que pertenece el pedido, leída del `Authorization: Bearer <jwt>` que ya viaja (no se verifica acá: Supabase lo verifica; un valor falso sólo haría que se rechace el pedido). `null` si es anónimo. */
export function ownerFromAuthorization(header: string | null | undefined): string | null {
  const token = /^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(header ?? "")?.[1];
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; role?: unknown }).sub;
    return typeof sub === "string" && UUID.test(sub) ? sub.toLowerCase() : null;
  } catch {
    return null;
  }
}

function authorizationOf(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): string | null {
  const fromInit = init?.headers ? new Headers(init.headers).get("authorization") : null;
  if (fromInit) return fromInit;
  return typeof input === "object" && "headers" in input ? input.headers.get("authorization") : null;
}

/**
 * Misma guarda, pero para un cliente que se crea SIN el contexto de la persona (cualquier otro llamador de `createSupabaseServerClient`): la cuenta sale
 * del JWT de cada pedido. Hoy ningún otro llamador escribe datos (una prueba lo fija); esto cubre al que se agregue mañana.
 */
export function guardFetchByJwt(deps: Omit<AccessResolverDeps, "ownerId" | "accountCreatedAt"> & { readonly supabaseOrigin: string; readonly inner?: typeof fetch; readonly onBlocked?: GuardOptions["onBlocked"] }): typeof fetch {
  const resolvers = new Map<string, () => Promise<BillingAccess>>();
  const inner = deps.inner ?? fetch;
  return async (input, init) => {
    const { method, url } = describe(input, init);
    const verdict = classifyRequest({ method, url, supabaseOrigin: deps.supabaseOrigin });
    if (verdict.writes && !verdict.allowedInLimitedMode) {
      const ownerId = ownerFromAuthorization(authorizationOf(input, init));
      if (ownerId) {
        if (resolvers.size > 500) resolvers.clear();
        let resolve = resolvers.get(ownerId);
        if (!resolve) {
          resolve = createAccessResolver({ ...deps, ownerId, accountCreatedAt: null });
          resolvers.set(ownerId, resolve);
        }
        return guardFetch(inner, { supabaseOrigin: deps.supabaseOrigin, resolve, onBlocked: deps.onBlocked })(input, init);
      }
    }
    return inner(input, init);
  };
}

export function maybeGuardFetchByJwt(deps: Parameters<typeof guardFetchByJwt>[0]): typeof fetch | undefined {
  return readBillingFlags(deps.env).enforcement ? guardFetchByJwt(deps) : undefined;
}
