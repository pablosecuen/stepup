import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import * as edgeCookies from "next/dist/compiled/@edge-runtime/cookies/index.js";
import { getSupabaseCookieOptions, withSessionCookieAttributes } from "../cookie-options.ts";

/**
 * Regresión: un navegador con una sesión VIEJA (vencida, vigente, revocada, de una sola cookie o fragmentada en
 * `.0/.1/…`) inicia sesión con contraseña y la primera carga de Inicio debe usar ÚNICAMENTE la sesión nueva.
 *
 * Se emulan, con los clientes reales de @supabase/ssr + auth-js y las clases de cookies reales de Next:
 * - el navegador (jar con path, orden de envío por path y borrado por Max-Age=0);
 * - la Server Action de login (cookies() mutables → Set-Cookie, con el mismo getAll/setAll que lib/supabase/server.ts);
 * - la pre-renderización que Next hace del redirect (cookie = pedido original + Set-Cookie de la acción, igual que
 *   `getForwardedHeaders` de Next);
 * - la primera navegación real del navegador a /inicio;
 * - y en cada una, el proxy (getClaims con ES256 y JWKS reales + setAll como proxy.ts) y la página (getUser + consultas).
 * Los nombres/paths/cantidades de cookies se comparan; los valores nunca se imprimen.
 */
const { RequestCookies, ResponseCookies } = ((edgeCookies as unknown as { default?: typeof edgeCookies }).default ?? edgeCookies) as typeof edgeCookies;

const URL_BASE = "https://proyecto.supabase.co";
const COOKIE = "sb-proyecto-auth-token";
const USER_ID = "8ba16f57-dda0-4923-b45c-0ee0704eff02";
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const nowSec = () => Math.floor(Date.now() / 1000);

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const JWK = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig", key_ops: ["verify"] };

function signJwt(label: string, expSec: number): string {
  const data = `${b64({ alg: "ES256", typ: "JWT", kid: "k1" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", session_id: `sesion-${label}`, label, iat: nowSec(), exp: expSec })}`;
  return `${data}.${sign("sha256", Buffer.from(data), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
const labelOf = (token: string): string | null => {
  try {
    return (JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { label?: string }).label ?? null;
  } catch {
    return null;
  }
};

function makeSession(label: string, expiresInSec: number, refreshToken: string, padding: number) {
  const exp = nowSec() + expiresInSec;
  return {
    access_token: signJwt(label, exp),
    token_type: "bearer",
    expires_in: expiresInSec,
    expires_at: exp,
    refresh_token: refreshToken,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "cuenta@example.com", app_metadata: {}, user_metadata: { relleno: "x".repeat(padding) }, created_at: "2026-10-04T03:45:56Z" },
  };
}

// ---------------- navegador ----------------
class Browser {
  private cookies: { name: string; value: string; path: string }[] = [];
  set(name: string, value: string | undefined, path = "/", maxAge?: number) {
    this.cookies = this.cookies.filter((cookie) => !(cookie.name === name && cookie.path === path));
    if (maxAge === 0 || !value) return;
    this.cookies.push({ name, value: encodeURIComponent(value), path });
  }
  header(requestPath: string): string {
    return this.cookies
      .filter((cookie) => requestPath === cookie.path || requestPath.startsWith(cookie.path.endsWith("/") ? cookie.path : `${cookie.path}/`))
      .sort((a, b) => b.path.length - a.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
  }
  /** Sólo nombre@path (nunca valores). */
  inventory(): string[] {
    return this.cookies.map((cookie) => `${cookie.name}@${cookie.path}`).sort();
  }
}

// ---------------- Supabase de mentira ----------------
interface FakeServer {
  fetch: typeof fetch;
  refreshAttempts: string[];
  rest: { phase: string; table: string; label: string | null; status: number }[];
  phase: string;
}

function createFakeServer(options: { newPadding: number; validRefreshTokens: Set<string>; passwordDelayMs: number; refreshDelayMs: number }): FakeServer {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const server: FakeServer = {
    refreshAttempts: [],
    rest: [],
    phase: "login",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const token = (new Headers(init?.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      if (url.includes("/.well-known/jwks.json")) return json({ keys: [JWK] });
      if (url.includes("grant_type=password")) {
        await sleep(options.passwordDelayMs);
        return json(makeSession("NUEVA", 3600, "r-nueva", options.newPadding));
      }
      if (url.includes("grant_type=refresh_token")) {
        await sleep(options.refreshDelayMs);
        const { refresh_token } = JSON.parse(String(init?.body)) as { refresh_token: string };
        server.refreshAttempts.push(`${new Headers(init?.headers).get("x-test-client")}:${refresh_token}`);
        if (!options.validRefreshTokens.has(refresh_token)) return json({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }, 400);
        options.validRefreshTokens.delete(refresh_token);
        return json(makeSession("REFRESCADA", 3600, "r-refrescada", options.newPadding));
      }
      if (url.includes("/auth/v1/user")) {
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "e30", "base64url").toString("utf8")) as { exp?: number };
        if ((claims.exp ?? 0) < nowSec()) return json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT: token is expired" }, 403);
        return json(makeSession("x", 1, "x", 0).user);
      }
      if (url.includes("/rest/v1/")) {
        const table = url.split("/rest/v1/")[1].split("?")[0];
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "e30", "base64url").toString("utf8")) as { exp?: number };
        const expired = (claims.exp ?? 0) < nowSec();
        server.rest.push({ phase: server.phase, table, label: labelOf(token), status: expired ? 401 : 200 });
        return expired ? json({ code: "PGRST303", message: "JWT expired" }, 401) : json([]);
      }
      throw new Error(`URL inesperada: ${url}`);
    }) as typeof fetch,
  };
  return server;
}

// ---------------- Next: Server Action + pre-render del redirect ----------------
async function runLoginAction(browser: Browser, server: FakeServer) {
  const originalHeader = browser.header("/login");
  const requestCookies = new RequestCookies(new Headers({ cookie: originalHeader }));
  const responseCookies = new ResponseCookies(new Headers());
  // cookies() de una Server Action: lecturas con las mutaciones ya aplicadas, escrituras → Set-Cookie
  const cookieStore = {
    getAll: () => requestCookies.getAll(),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      responseCookies.set(name, value, options);
      requestCookies.set(name, value);
    },
  };

  // Mismo cliente y mismo getAll/setAll que lib/supabase/server.ts
  const supabase = createServerClient(URL_BASE, "sb_publishable_clave_de_prueba", {
    cookieOptions: getSupabaseCookieOptions(), // R1: las mismas cookieOptions y atributos que server.ts/proxy.ts
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => withSessionCookieAttributes(list).forEach(({ name, value, options }) => cookieStore.set(name, value, options as Record<string, unknown>)),
    },
    auth: { flowType: "pkce" },
    global: { fetch: server.fetch, headers: { "x-test-client": "login" } },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: "cuenta@example.com", password: "contraseña-de-prueba-1" });
  cookieStore.set("tf_pwd_recovery", "", { maxAge: 0, path: "/" }); // clearRecoveryMarker()

  for (const cookie of responseCookies.getAll()) browser.set(cookie.name, cookie.value, cookie.path ?? "/", cookie.maxAge);

  // Lo que Next reenvía al pre-renderizar el redirect (copia de getForwardedHeaders)
  const merged = new RequestCookies(new Headers({ cookie: originalHeader }));
  for (const cookie of responseCookies.getAll()) {
    if (typeof cookie.value === "undefined") merged.delete(cookie.name);
    else merged.set(cookie);
  }
  return { ok: !error, forwardedHeader: merged.toString() };
}

/** Un request a /inicio: proxy.ts (getClaims + setAll) y después la página (getUser + las consultas de Inicio). */
async function renderInicio(cookieHeader: string, server: FakeServer, phase: string) {
  server.phase = phase;
  const requestCookies = new RequestCookies(new Headers({ cookie: cookieHeader }));

  const proxy = createServerClient(URL_BASE, "sb_publishable_clave_de_prueba", {
    cookies: {
      getAll: () => requestCookies.getAll(),
      setAll: (list) => list.forEach(({ name, value }) => requestCookies.set(name, value)), // como proxy.ts
    },
    global: { fetch: server.fetch, headers: { "x-test-client": "proxy" } },
  });
  const claims = await proxy.auth.getClaims();

  const page = createServerClient(URL_BASE, "sb_publishable_clave_de_prueba", {
    cookies: {
      getAll: () => requestCookies.getAll(),
      setAll: () => {}, // un Server Component no puede escribir cookies
    },
    auth: { flowType: "pkce" },
    global: { fetch: server.fetch, headers: { "x-test-client": "page" } },
  });
  const { data } = await page.auth.getUser();
  const results = await Promise.all([page.from("recurrence_rules").select("*"), page.from("students").select("*"), page.from("calendar_lessons").select("*")]);
  return {
    proxyLabel: claims.data ? (claims.data.claims as unknown as { label?: string }).label : null,
    userOk: data.user?.id === USER_ID,
    errors: results.map((result) => result.error?.code ?? null),
  };
}

/** La sesión que ve el servidor en un header de cookies: misma regla que @supabase/ssr (cookie entera; si no, partes .0 .1 …). */
function sessionInHeader(header: string) {
  const cookies = new RequestCookies(new Headers({ cookie: header }));
  const whole = cookies.get(COOKIE)?.value;
  const parts: string[] = [];
  const chunkNames: string[] = [];
  for (let i = 0; ; i += 1) {
    const part = cookies.get(`${COOKIE}.${i}`)?.value;
    if (!part) break;
    parts.push(part);
    chunkNames.push(`${COOKIE}.${i}`);
  }
  const raw = whole || parts.join("");
  const session = raw ? (JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8")) as { access_token: string; refresh_token: string }) : null;
  const allSbNames = cookies.getAll().filter((cookie) => cookie.name.startsWith("sb-") && cookie.value !== "").map((cookie) => cookie.name);
  return { label: session ? labelOf(session.access_token) : null, refresh: session?.refresh_token ?? null, usedChunks: chunkNames.length, allSbNames };
}

interface Scenario {
  name: string;
  old?: { expiresInSec: number; refreshValid: boolean; padding: number; path?: string };
  newPadding?: number;
  passwordDelayMs?: number;
  refreshDelayMs?: number;
}

async function runScenario(scenario: Scenario) {
  const validRefreshTokens = new Set<string>(scenario.old?.refreshValid ? ["r-vieja"] : []);
  const server = createFakeServer({ newPadding: scenario.newPadding ?? 0, validRefreshTokens, passwordDelayMs: scenario.passwordDelayMs ?? 0, refreshDelayMs: scenario.refreshDelayMs ?? 0 });
  const browser = new Browser();

  if (scenario.old) {
    const oldSession = makeSession("VIEJA", scenario.old.expiresInSec, "r-vieja", scenario.old.padding);
    const encoded = `base64-${Buffer.from(JSON.stringify(oldSession)).toString("base64url")}`;
    if (encodeURIComponent(encoded).length <= 3180) browser.set(COOKIE, encoded, scenario.old.path ?? "/");
    else for (let i = 0, offset = 0; offset < encoded.length; i += 1, offset += 3000) browser.set(`${COOKIE}.${i}`, encoded.slice(offset, offset + 3000), scenario.old.path ?? "/");
  }

  const before = browser.inventory();
  const login = await runLoginAction(browser, server);
  const after = browser.inventory();

  const prerender = await renderInicio(login.forwardedHeader, server, "pre-render");
  const navigation = await renderInicio(browser.header("/inicio"), server, "navegación");

  return { server, before, after, login, forwarded: sessionInHeader(login.forwardedHeader), fromBrowser: sessionInHeader(browser.header("/inicio")), prerender, navigation };
}

const OLD_EXPIRED_VALID = { expiresInSec: -7200, refreshValid: true, padding: 0 };
const OLD_EXPIRED_REVOKED = { expiresInSec: -7200, refreshValid: false, padding: 0 };

const SCENARIOS: Scenario[] = [
  { name: "navegador limpio (ventana incógnita)" },
  { name: "sesión vieja VENCIDA con refresh válido (1 cookie)", old: OLD_EXPIRED_VALID },
  { name: "sesión vieja VENCIDA con refresh REVOCADO (1 cookie)", old: OLD_EXPIRED_REVOKED },
  { name: "sesión vieja VIGENTE", old: { expiresInSec: 1800, refreshValid: true, padding: 0 } },
  { name: "vieja FRAGMENTADA → nueva de una sola cookie", old: { ...OLD_EXPIRED_REVOKED, padding: 4000 } },
  { name: "vieja de una cookie → nueva FRAGMENTADA", old: OLD_EXPIRED_REVOKED, newPadding: 4000 },
  { name: "vieja con 4 partes → nueva con 2 partes", old: { ...OLD_EXPIRED_REVOKED, padding: 8000 }, newPadding: 2600 },
  { name: "vieja con 2 partes → nueva con 4 partes", old: { ...OLD_EXPIRED_VALID, padding: 2600 }, newPadding: 8000 },
  { name: "cookie vieja en OTRO path (/login): el navegador no la manda a /inicio", old: { ...OLD_EXPIRED_REVOKED, path: "/login" } },
  { name: "carrera: el refresh de la sesión vieja termina ANTES del login", old: OLD_EXPIRED_VALID, passwordDelayMs: 80, refreshDelayMs: 5 },
  { name: "carrera: el refresh de la sesión vieja termina DESPUÉS del login", old: OLD_EXPIRED_VALID, passwordDelayMs: 5, refreshDelayMs: 80 },
  { name: "carrera con refresh revocado que falla DESPUÉS del login", old: OLD_EXPIRED_REVOKED, passwordDelayMs: 5, refreshDelayMs: 80 },
];

for (const scenario of SCENARIOS) {
  test(`login con contraseña desde un navegador con restos de sesión: ${scenario.name} → la primera carga de Inicio usa SOLO la sesión nueva`, async () => {
    const run = await runScenario(scenario);

    assert.equal(run.login.ok, true, "el inicio de sesión funciona");

    // Cookies del navegador tras el login: sólo la sesión nueva en el path "/", sin partes viejas sobrantes
    const rootSession = run.after.filter((entry) => entry.startsWith(COOKIE) && entry.endsWith("@/"));
    assert.ok(rootSession.length >= 1, "queda la cookie de sesión nueva");
    assert.deepEqual(run.after.filter((entry) => entry.startsWith("tf_pwd_recovery")), [], "el marcador de recuperación no queda");

    for (const [fuente, seen] of [
      ["pre-render del redirect de la Server Action", run.forwarded],
      ["primera navegación del navegador a /inicio", run.fromBrowser],
    ] as const) {
      assert.equal(seen.label, "NUEVA", `${fuente}: la sesión que ve el servidor es la nueva`);
      assert.equal(seen.refresh, "r-nueva", `${fuente}: con el refresh token nuevo`);
      assert.ok(seen.allSbNames.every((name) => name === COOKIE || /^sb-proyecto-auth-token\.\d+$/.test(name)), `${fuente}: ninguna cookie sb- ajena`);
      const indices = seen.allSbNames.filter((name) => name !== COOKIE).map((name) => Number(name.split(".").pop())).sort((a, b) => a - b);
      assert.deepEqual(indices, indices.map((_, i) => i), `${fuente}: las partes son contiguas (.0, .1, …) y no sobra ninguna vieja`);
    }

    for (const [fuente, render] of [
      ["pre-render", run.prerender],
      ["navegación", run.navigation],
    ] as const) {
      assert.equal(render.userOk, true, `${fuente}: getUser reconoce la sesión`);
      assert.equal(render.proxyLabel, "NUEVA", `${fuente}: el proxy verifica el token nuevo`);
      assert.deepEqual(render.errors, [null, null, null], `${fuente}: las tres consultas de Inicio terminan bien`);
    }

    const restCalls = run.server.rest;
    assert.equal(restCalls.length, 6, "3 consultas × 2 cargas, ninguna repetida ni perdida");
    assert.ok(restCalls.every((call) => call.label === "NUEVA" && call.status === 200), "ninguna consulta usó el token viejo ni dio 401");
    // El cliente del login puede intentar refrescar la sesión vieja (auth-js lo hace al crearse); ni el proxy ni la página, nunca.
    assert.deepEqual(run.server.refreshAttempts.filter((attempt) => !attempt.startsWith("login:")), [], "el proxy y la página de Inicio nunca intentan refrescar una sesión");
  });
}

test("el cliente del login y el de Inicio se arman con la misma configuración de cookies (getAll completo, setAll con tolerancia en Server Components)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const server = readFileSync(`${root}lib/supabase/server.ts`, "utf8");
  assert.match(server, /getAll\(\) \{\s*return cookieStore\.getAll\(\);/);
  assert.match(server, /cookieStore\.set\(name, value, options\)/);
  const actions = readFileSync(`${root}lib/auth/actions.ts`, "utf8");
  assert.match(actions, /signInWithPassword\(email, password, \{ captchaToken: captchaTokenFromFormData\(formData\) \}\);\s*if \(!result\.ok\) return \{ error: result\.error\.message \};\s*\/\/[^\n]*\n\s*await clearRecoveryMarker\(\);\s*redirect\(/);
});
