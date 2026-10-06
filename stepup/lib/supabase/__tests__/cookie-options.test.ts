import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE_SECONDS, getSupabaseCookieOptions, withSessionCookieAttributes } from "../cookie-options.ts";

/**
 * R1 — la cookie de sesión de Supabase: HttpOnly, Secure en Production, SameSite=Lax y 30 días, escrita IGUAL por
 * `lib/supabase/server.ts` y `proxy.ts`. Se ejecutan los clientes reales de @supabase/ssr y auth-js contra un Auth simulado
 * y se leen las opciones que realmente llegan a `setAll` (lo que Next convierte en `Set-Cookie`).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const URL_BASE = "https://proyecto.supabase.co";
const COOKIE = "sb-proyecto-auth-token";
const USER_ID = "8ba16f57-dda0-4923-b45c-0ee0704eff02";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const nowSec = () => Math.floor(Date.now() / 1000);

function jwt(expSec: number): string {
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", session_id: "sesion", iat: nowSec(), exp: expSec })}.AAAAAAAA`;
}
function session(expiresInSec: number, refreshToken: string) {
  const exp = nowSec() + expiresInSec;
  return { access_token: jwt(exp), token_type: "bearer", expires_in: expiresInSec, expires_at: exp, refresh_token: refreshToken, user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "cuenta@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T03:45:56Z" } };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeAuth(passwordSessionExpiresInSec = 3600) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") return json(200, session(passwordSessionExpiresInSec, "refresh-1"));
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") return json(200, session(3600, "refresh-2"));
    if (url.pathname === "/auth/v1/user") return json(200, session(3600, "x").user);
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    return json(404, {});
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

type Written = { name: string; value: string; options: Record<string, unknown> };
/** Cliente con la MISMA configuración que server.ts/proxy.ts (cookieOptions compartidas) y un jar de cookies mínimo. */
function client(jar: Map<string, string>, written: Written[], env: { NODE_ENV?: string }, fetchImpl: typeof fetch) {
  return createServerClient(URL_BASE, "sb_publishable_clave_de_prueba", {
    auth: { flowType: "pkce" },
    cookieOptions: getSupabaseCookieOptions(env),
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      // Igual que server.ts / proxy.ts: los atributos se imponen en TODA escritura (la librería ignora cookieOptions.maxAge).
      setAll: (list) =>
        withSessionCookieAttributes(list, env).forEach(({ name, value, options }) => {
          written.push({ name, value, options: options as Record<string, unknown> });
          if (value === "" || (options as { maxAge?: number }).maxAge === 0) jar.delete(name);
          else jar.set(name, value);
        }),
    },
    global: { fetch: fetchImpl },
  });
}

const EXPECTED = (secure: boolean) => ({ path: "/", sameSite: "lax", httpOnly: true, secure, maxAge: SESSION_COOKIE_MAX_AGE_SECONDS });

test("la librería ignora cookieOptions.maxAge: por eso el maxAge se impone en withSessionCookieAttributes (y un borrado sigue en 0)", () => {
  const [write, removal, wrongRemoval] = withSessionCookieAttributes(
    [
      { name: "a", value: "v", options: { maxAge: 34_560_000, httpOnly: false, secure: false, sameSite: "none", path: "/x" } },
      { name: "b", value: "", options: { maxAge: 0, httpOnly: false } },
      { name: "c", value: "v" },
    ],
    { NODE_ENV: "production" }
  );
  assert.deepEqual(write.options, EXPECTED(true), "una escritura con atributos viejos/débiles se corrige");
  assert.equal(removal.options.maxAge, 0);
  assert.equal(removal.options.httpOnly, true);
  assert.equal(removal.options.secure, true);
  assert.deepEqual(wrongRemoval.options, EXPECTED(true), "sin opciones: se aplican todos los atributos");
});

test("opciones: HttpOnly siempre, Secure sólo en Production, SameSite=Lax, 30 días", () => {
  assert.deepEqual(getSupabaseCookieOptions({ NODE_ENV: "production" }), EXPECTED(true));
  assert.deepEqual(getSupabaseCookieOptions({ NODE_ENV: "development" }), EXPECTED(false));
  assert.deepEqual(getSupabaseCookieOptions({ NODE_ENV: "test" }), EXPECTED(false), "desarrollo/pruebas locales no exigen HTTPS");
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, 2_592_000);
});

test("login real (auth-js + @supabase/ssr): todas las cookies de sesión salen con HttpOnly, Secure, Lax, path / y 30 días", async () => {
  const jar = new Map<string, string>();
  const written: Written[] = [];
  const { fetch: fetchImpl } = fakeAuth();
  const supabase = client(jar, written, { NODE_ENV: "production" }, fetchImpl);
  const { error } = await supabase.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  assert.equal(error, null);
  const sessionCookies = written.filter((cookie) => cookie.name.startsWith(COOKIE));
  assert.ok(sessionCookies.length >= 1, "se escribió la cookie de sesión");
  for (const cookie of sessionCookies) assert.deepEqual(cookie.options, EXPECTED(true), cookie.name);
});

test("sesión fragmentada (cookie grande en .0/.1): cada fragmento lleva los mismos atributos", async () => {
  const jar = new Map<string, string>();
  const written: Written[] = [];
  const big = { ...session(3600, "refresh-1") };
  big.user = { ...big.user, user_metadata: { relleno: "x".repeat(6000) } } as typeof big.user;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return url.pathname === "/auth/v1/token" ? json(200, big) : json(404, {});
  }) as typeof fetch;
  const supabase = client(jar, written, { NODE_ENV: "production" }, fetchImpl);
  await supabase.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  const chunks = written.filter((cookie) => /\.\d+$/.test(cookie.name));
  assert.ok(chunks.length >= 2, "la sesión grande se partió en fragmentos");
  for (const cookie of written.filter((c) => c.name.startsWith(COOKIE))) assert.deepEqual(cookie.options, EXPECTED(true), cookie.name);
});

test("renovación (token vencido): la cookie se reescribe con los atributos nuevos y otra ventana de 30 días", async () => {
  const jar = new Map<string, string>();
  const written: Written[] = [];
  const { fetch: fetchImpl, calls } = fakeAuth(30);
  // Una sesión que ya está dentro del margen de vencimiento de auth-js (30 s < 90 s), guardada por el cliente con las mismas opciones.
  const seed = client(jar, written, { NODE_ENV: "production" }, fetchImpl);
  await seed.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  written.length = 0;
  calls.length = 0;
  const proxy = client(jar, written, { NODE_ENV: "production" }, fetchImpl);
  const { data } = await proxy.auth.getClaims();
  assert.ok(calls.some((call) => call.startsWith("/auth/v1/token?grant_type=refresh_token")), "se renovó con el refresh token");
  assert.ok(data?.claims, "la sesión renovada es válida");
  const rewritten = written.filter((cookie) => cookie.name.startsWith(COOKIE));
  assert.ok(rewritten.length >= 1);
  for (const cookie of rewritten) assert.deepEqual(cookie.options, EXPECTED(true), cookie.name);
});

test("cierre de sesión: las cookies se borran (Max-Age=0) conservando HttpOnly/Secure/SameSite/path", async () => {
  const jar = new Map<string, string>();
  const written: Written[] = [];
  const { fetch: fetchImpl } = fakeAuth();
  const supabase = client(jar, written, { NODE_ENV: "production" }, fetchImpl);
  await supabase.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  written.length = 0;
  await supabase.auth.signOut({ scope: "local" });
  const removals = written.filter((cookie) => cookie.name.startsWith(COOKIE));
  assert.ok(removals.length >= 1, "se emitió el borrado");
  for (const cookie of removals) {
    assert.equal(cookie.options.maxAge, 0, cookie.name);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, "lax");
    assert.equal(cookie.options.path, "/");
  }
  assert.equal([...jar.keys()].filter((name) => name.startsWith(COOKIE)).length, 0, "no queda ninguna cookie de sesión");
});

test("desarrollo local: el login funciona sin Secure (http://localhost) y sigue HttpOnly", async () => {
  const jar = new Map<string, string>();
  const written: Written[] = [];
  const { fetch: fetchImpl } = fakeAuth();
  const supabase = client(jar, written, { NODE_ENV: "development" }, fetchImpl);
  const { error } = await supabase.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  assert.equal(error, null);
  for (const cookie of written.filter((c) => c.name.startsWith(COOKIE))) assert.deepEqual(cookie.options, EXPECTED(false));
});

// ---------------------------------------------------------------------------------------------------------------
// Estructura: la misma configuración en server.ts y proxy.ts, y ningún código de navegador usa Supabase
// ---------------------------------------------------------------------------------------------------------------
function sources(dirs: string[], extensions: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (extensions.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

test("server.ts y proxy.ts crean el cliente con la MISMA fuente de cookieOptions (y no existe otro createServerClient)", () => {
  const withCall = ["app", "components", "lib", "."].flatMap((dir) => (dir === "." ? ["proxy.ts"] : sources([dir], /\.(ts|tsx)$/))).filter((file) => /\bcreateServerClient\(/.test(read(file)));
  assert.deepEqual(withCall.sort(), ["lib/supabase/server.ts", "proxy.ts"]);
  for (const file of withCall) {
    const source = read(file);
    assert.match(source, /import \{[^}]*getSupabaseCookieOptions[^}]*\} from "@\/lib\/supabase\/cookie-options";/, file);
    assert.match(source, /cookieOptions: getSupabaseCookieOptions\(\),/, file);
    assert.match(source, /withSessionCookieAttributes\(cookiesToSet\)/, `${file}: toda cookie pasa por withSessionCookieAttributes antes de escribirse`);
    assert.doesNotMatch(source, /httpOnly|sameSite|maxAge/, `${file}: los atributos viven sólo en cookie-options.ts`);
  }
});

test("ningún código de navegador lee la cookie: no hay cliente de Supabase del lado cliente ni `document.cookie`", () => {
  const files = sources(["app", "components", "lib"], /\.(ts|tsx)$/);
  const offenders: string[] = [];
  for (const file of files) {
    const source = read(file);
    const isClient = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(source);
    if (isClient && /@supabase\/|@\/lib\/supabase\/|from "@\/lib\/auth\/supabase-auth-adapter"/.test(source)) offenders.push(`${file}: importa Supabase en un componente cliente`);
    if (/createBrowserClient\(/.test(source)) offenders.push(`${file}: createBrowserClient`);
    if (/document\.cookie/.test(source)) offenders.push(`${file}: document.cookie`);
  }
  assert.deepEqual(offenders, []);
  assert.throws(() => statSync(join(ROOT, "lib/supabase/client.ts")), "el cliente de navegador de Supabase se eliminó (la cookie es HttpOnly: no podría leerla)");
});
