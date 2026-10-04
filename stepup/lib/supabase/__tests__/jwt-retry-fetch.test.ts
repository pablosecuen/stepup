import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServerClient } from "@supabase/ssr";
import { createJwtRejectionRetryFetch, formatJwtRejectionRetryLog, type JwtRejectionRetryEvent } from "../jwt-retry-fetch.ts";

/**
 * Regresión del hallazgo de Production (4/oct, 00:48:38): login con contraseña seguido de inmediato por la carga de
 * Inicio. Con el MISMO token recién emitido, `/auth/v1/user`, `students` y `calendar_lessons` respondieron 200 y
 * `recurrence_rules` respondió 401 PGRST303; Inicio entero mostró "No pudimos cargar Inicio".
 *
 * Se prueba con los clientes reales de supabase-js/@supabase/ssr y un Supabase de mentira (Auth + PostgREST) que
 * reproduce ese rechazo puntual. Las consultas de Inicio se copian tal cual de los repositorios (`from(...).select("*")
 * .eq("owner_id", …)`): los repositorios importan `server-only` y no se pueden cargar bajo `node --test`.
 */
const URL_BASE = "https://proyecto.supabase.co";
const ANON_KEY = "sb_publishable_clave_de_prueba";
const USER_ID = "8ba16f57-dda0-4923-b45c-0ee0704eff02";
const EMAIL = "cuenta-nueva@example.com";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const makeJwt = (iat: number) => `${b64({ alg: "ES256", typ: "JWT" })}.${b64({ sub: USER_ID, role: "authenticated", aud: "authenticated", iat, exp: iat + 3600 })}.firma`;

const rejection = (message = "JWT expired") =>
  new Response(JSON.stringify({ code: "PGRST303", details: null, hint: null, message }), { status: 401, headers: { "content-type": "application/json" } });
const emptyList = () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface RestCall {
  table: string;
  token: string;
}

/** Supabase de mentira: Auth real-ish + PostgREST. `restBehavior` decide cada consulta de datos. */
function createFakeSupabase(restBehavior: (call: RestCall, attempt: number) => Response) {
  const restCalls: RestCall[] = [];
  const attemptsByTable = new Map<string, number>();
  let issuedToken = "";

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");

    if (url.includes("/auth/v1/token") && url.includes("grant_type=password")) {
      const iat = Math.floor(Date.now() / 1000);
      issuedToken = makeJwt(iat);
      return json({
        access_token: issuedToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: iat + 3600,
        refresh_token: "refresh-nuevo",
        user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T03:45:56Z" },
      });
    }
    if (url.includes("/auth/v1/user")) {
      return json({ id: USER_ID, aud: "authenticated", role: "authenticated", email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: "2026-10-04T03:45:56Z" });
    }
    if (url.includes("/rest/v1/")) {
      const table = url.split("/rest/v1/")[1].split("?")[0];
      const attempt = (attemptsByTable.get(table) ?? 0) + 1;
      attemptsByTable.set(table, attempt);
      const call = { table, token };
      restCalls.push(call);
      return restBehavior(call, attempt);
    }
    throw new Error(`URL inesperada en la prueba: ${url}`);
  };

  return { fetchImpl, restCalls, attemptsByTable, token: () => issuedToken };
}

/** Un "dispositivo": su jar de cookies persiste entre requests, igual que el navegador. */
function newCookieJar() {
  const jar = new Map<string, string>();
  return {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (cookies: { name: string; value: string }[]) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
  };
}

function clientFor(jar: ReturnType<typeof newCookieJar>, fetchImpl: typeof fetch) {
  return createServerClient(URL_BASE, ANON_KEY, { cookies: jar, global: { fetch: fetchImpl }, auth: { flowType: "pkce" } });
}

/** Las consultas de `loadHomeData` que salen en paralelo (repositorios reales: mismo cliente, mismo `ownerId`). */
function loadInicioQueries(supabase: ReturnType<typeof clientFor>) {
  return Promise.all([
    supabase.from("recurrence_rules").select("*").eq("owner_id", USER_ID),
    supabase.from("students").select("*").eq("owner_id", USER_ID).order("name", { ascending: true }),
    supabase.from("recurrence_rules").select("*").eq("owner_id", USER_ID), // loadCalendarViewForRange → listRecurrenceRules
    supabase.from("calendar_lessons").select("*").eq("owner_id", USER_ID).gte("start_at", "2026-10-04T03:00:00Z").lte("start_at", "2026-10-05T02:59:59Z"),
  ]);
}

async function loginAndLoadInicio(fake: ReturnType<typeof createFakeSupabase>, fetchImpl: typeof fetch) {
  const jar = newCookieJar();

  // Request 1 (Server Action de /login): inicia sesión y deja la sesión en las cookies.
  const signIn = await clientFor(jar, fetchImpl).auth.signInWithPassword({ email: EMAIL, password: "contraseña-de-prueba-1" });
  assert.equal(signIn.error, null, "el inicio de sesión funciona");

  // Request 2 (GET /inicio, inmediatamente después): un cliente NUEVO leído de las cookies, como en Next.
  const supabase = clientFor(jar, fetchImpl);
  const { data } = await supabase.auth.getUser();
  assert.equal(data.user?.id, USER_ID, "getUser reconoce la sesión recién creada");
  const results = await loadInicioQueries(supabase);
  return { results, fake };
}

test("reproduce el hallazgo: sin protección, UNA consulta rechazada con PGRST303 tumba la carga de Inicio aunque las demás respondan 200", async () => {
  const fake = createFakeSupabase((call, attempt) => (call.table === "recurrence_rules" && attempt === 1 ? rejection() : emptyList()));
  const { results } = await loginAndLoadInicio(fake, fake.fetchImpl as typeof fetch);

  const [rules, students, , lessons] = results;
  assert.equal(rules.error?.code, "PGRST303", "recurrence_rules: 401 PGRST303, como en el registro de Supabase");
  assert.equal(students.error, null);
  assert.equal(lessons.error, null);
  // El repositorio hace `if (error) throw error`: Inicio caería en "No pudimos cargar Inicio".
});

test("con el reintento acotado: login con contraseña + carga inmediata de Inicio carga completa, con listas vacías autenticadas", async () => {
  const fake = createFakeSupabase((call, attempt) => (call.table === "recurrence_rules" && attempt === 1 ? rejection() : emptyList()));
  const events: JwtRejectionRetryEvent[] = [];
  const retryFetch = createJwtRejectionRetryFetch(fake.fetchImpl as typeof fetch, { delayMs: 0, onRetry: (event) => events.push(event) });

  const { results } = await loginAndLoadInicio(fake, retryFetch);

  for (const result of results) {
    assert.equal(result.error, null, "ninguna consulta de Inicio falla");
    assert.deepEqual(result.data, [], "cuenta sin reglas/alumnos/clases: lista vacía, no error");
  }
  assert.equal(fake.restCalls.length, 5, "4 consultas + 1 reintento de la rechazada");
  assert.ok(fake.restCalls.every((call) => call.token === fake.token()), "todas llevan el token del usuario recién creado (nunca la clave anónima)");
  assert.notEqual(fake.token(), "", "se emitió un token real");
  assert.deepEqual(events, [{ table: "recurrence_rules", code: "PGRST303", detail: "JWT expired", recovered: true, waitedMs: 0 }]);
});

test("cuenta sin reglas de recurrencia: la consulta autenticada devuelve una lista vacía (200), no un error ni un estado inventado", async () => {
  const fake = createFakeSupabase(() => emptyList());
  const retryFetch = createJwtRejectionRetryFetch(fake.fetchImpl as typeof fetch, { delayMs: 0 });
  const { results } = await loginAndLoadInicio(fake, retryFetch);

  assert.equal(results[0].status, 200);
  assert.deepEqual(results[0].data, []);
  assert.equal(fake.restCalls.length, 4, "sin rechazos no hay reintentos");
});

test("si el rechazo persiste, el error SIGUE llegando (no se silencia ni se vuelve una lista vacía)", async () => {
  const fake = createFakeSupabase((call) => (call.table === "recurrence_rules" ? rejection() : emptyList()));
  const events: JwtRejectionRetryEvent[] = [];
  const retryFetch = createJwtRejectionRetryFetch(fake.fetchImpl as typeof fetch, { delayMs: 0, onRetry: (event) => events.push(event) });

  const { results } = await loginAndLoadInicio(fake, retryFetch);

  assert.equal(results[0].error?.code, "PGRST303");
  assert.equal(results[0].data, null, "nunca [] cuando falla");
  assert.equal(results[2].error?.code, "PGRST303");
  assert.equal(fake.attemptsByTable.get("recurrence_rules"), 4, "2 consultas × (intento + UN reintento): nunca un bucle");
  assert.ok(events.every((event) => event.recovered === false));
});

test("sólo se reintenta 401 + PGRST303 de /rest/v1/: otros errores, otros códigos y otras URLs pasan sin tocar", async () => {
  const calls: string[] = [];
  const respond = (status: number, code: string) => async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ code, message: "JWT expired" }), { status, headers: { "content-type": "application/json" } });
  };
  const run = async (status: number, code: string, url: string, init?: RequestInit) => {
    calls.length = 0;
    const response = await createJwtRejectionRetryFetch(respond(status, code) as typeof fetch, { delayMs: 0 })(url, init);
    return { status: response.status, attempts: calls.length };
  };

  assert.deepEqual(await run(401, "PGRST303", `${URL_BASE}/rest/v1/students?select=*`), { status: 401, attempts: 2 });
  assert.deepEqual(await run(401, "PGRST301", `${URL_BASE}/rest/v1/students?select=*`), { status: 401, attempts: 1 }, "otro código de PostgREST");
  assert.deepEqual(await run(403, "PGRST303", `${URL_BASE}/rest/v1/students?select=*`), { status: 403, attempts: 1 }, "otro estado");
  assert.deepEqual(await run(500, "PGRST303", `${URL_BASE}/rest/v1/students?select=*`), { status: 500, attempts: 1 });
  assert.deepEqual(await run(401, "PGRST303", `${URL_BASE}/auth/v1/user`), { status: 401, attempts: 1 }, "Auth no se reintenta");
  assert.deepEqual(await run(401, "PGRST303", `${URL_BASE}/storage/v1/object/x`), { status: 401, attempts: 1 });
  assert.deepEqual(await run(401, "PGRST303", `${URL_BASE}/rest/v1/students`, { method: "POST", body: new Uint8Array([1, 2, 3]) }), { status: 401, attempts: 1 }, "cuerpo no repetible");
});

test("una RPC (escritura) rechazada por el JWT se reintenta con el MISMO cuerpo: PostgREST rechaza antes de ejecutar nada", async () => {
  const bodies: (string | undefined)[] = [];
  let attempt = 0;
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    attempt += 1;
    bodies.push(init?.body as string | undefined);
    return attempt === 1 ? rejection() : json(3);
  }) as typeof fetch;

  const payload = JSON.stringify({ p_billing_period: "2026-10", p_candidates: [] });
  const response = await createJwtRejectionRetryFetch(base, { delayMs: 0 })(`${URL_BASE}/rest/v1/rpc/ensure_monthly_charges`, { method: "POST", body: payload });

  assert.equal(response.status, 200);
  assert.deepEqual(bodies, [payload, payload]);
});

test("el reintento preserva EXACTAMENTE método, cuerpo, encabezados, señal y URL, y nunca ocurre más de una vez", async () => {
  const seen: { input: unknown; init: RequestInit | undefined }[] = [];
  const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ input, init });
    return rejection(); // rechaza SIEMPRE: si hubiera un bucle, acá se vería
  }) as typeof fetch;

  const controller = new AbortController();
  const init: RequestInit = {
    method: "PATCH",
    headers: { Authorization: "Bearer token-de-prueba", apikey: ANON_KEY, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ status: "paused" }),
    signal: controller.signal,
  };
  const url = `${URL_BASE}/rest/v1/students?id=eq.1&owner_id=eq.2`;

  const response = await createJwtRejectionRetryFetch(base, { delayMs: 0 })(url, init);

  assert.equal(response.status, 401, "el segundo rechazo se devuelve tal cual");
  assert.equal(seen.length, 2, "un intento + UN reintento, nunca más");
  assert.equal(seen[0].input, seen[1].input, "misma URL");
  assert.equal(seen[0].init, seen[1].init, "mismos init: método, encabezados, cuerpo y señal, sin copiar ni reescribir");
  assert.equal(seen[1].init?.method, "PATCH");
  assert.equal(seen[1].init?.body, init.body);
  assert.deepEqual(seen[1].init?.headers, init.headers);
  assert.equal(seen[1].init?.signal, controller.signal);
});

test("un Request (cuerpo de un solo uso) o una URL ajena a /rest/v1/ nunca se reintenta", async () => {
  let attempts = 0;
  const base = (async () => {
    attempts += 1;
    return rejection();
  }) as typeof fetch;
  const retry = createJwtRejectionRetryFetch(base, { delayMs: 0 });

  await retry(new Request(`${URL_BASE}/rest/v1/students`, { method: "POST", body: "{}" }));
  assert.equal(attempts, 1);
  attempts = 0;
  await retry(`${URL_BASE}/functions/v1/algo`);
  assert.equal(attempts, 1);
});

test("el log del reintento no contiene token, correo ni datos", () => {
  const line = formatJwtRejectionRetryLog({ table: "recurrence_rules", code: "PGRST303", detail: "JWT expired", recovered: true, waitedMs: 350 });
  assert.equal(line, '[jwt-retry] {"table":"recurrence_rules","code":"PGRST303","detail":"JWT expired","recovered":true,"waitedMs":350}');
  assert.doesNotMatch(line, /eyJ|Bearer|@|sb_publishable/);
});

test("lo que llega al log: sólo tabla/RPC, código, motivo genérico y si se recuperó — nunca query, filtros, JWT, correo ni datos", async () => {
  const events: JwtRejectionRetryEvent[] = [];
  const secretToken = makeJwt(1_790_000_000);
  const base = (async () =>
    new Response(JSON.stringify({ code: "PGRST303", message: `JWT expired ${secretToken}`, details: "sub=8ba16f57", hint: EMAIL }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
  const retry = createJwtRejectionRetryFetch(base, { delayMs: 0, onRetry: (event) => events.push(event) });

  await retry(`${URL_BASE}/rest/v1/students?select=*&owner_id=eq.${USER_ID}&email=eq.${EMAIL}`, { headers: { Authorization: `Bearer ${secretToken}` } });
  await retry(`${URL_BASE}/rest/v1/rpc/ensure_monthly_charges`, { method: "POST", body: JSON.stringify({ p_candidates: [{ student_id: USER_ID }] }) });

  assert.deepEqual(events.map((event) => event.table), ["students", "rpc:ensure_monthly_charges"]);
  assert.ok(events.every((event) => event.detail === null), "un mensaje que trae un JWT u otros datos no pasa el filtro del motivo");
  for (const event of events) {
    const line = formatJwtRejectionRetryLog(event);
    assert.doesNotMatch(line, new RegExp(`eyJ|Bearer|${EMAIL}|${USER_ID}|8ba16f57|owner_id|select=|student_id|p_candidates|\\?`));
  }
});

test("cableado: el cliente del servidor usa el reintento, y Inicio sigue pidiendo reglas, alumnos y clases con el mismo contexto", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const server = readFileSync(root + "lib/supabase/server.ts", "utf8");
  assert.match(server, /createJwtRejectionRetryFetch\(fetch/);
  assert.match(server, /global: \{\s*fetch:/);

  const home = readFileSync(root + "lib/dashboard/load-home-data.ts", "utf8");
  assert.match(home, /Promise\.all\(\[\s*listRecurrenceRules\(ctx\),\s*listStudents\(ctx\),\s*loadCalendarViewForRange\(ctx/);

  const proxy = readFileSync(root + "proxy.ts", "utf8");
  assert.doesNotMatch(proxy, /\.from\(/, "el proxy no consulta datos: sólo refresca la sesión");
});

test("\"JWT issued at future\" (el motivo real hallado en Production): espera hasta que el token cumpla ~3 s de vida, con tope, y sigue siendo UN solo reintento", async () => {
  const waits: number[] = [];
  const events: JwtRejectionRetryEvent[] = [];
  let attempts = 0;
  const base = (async () => {
    attempts += 1;
    return rejection("JWT issued at future");
  }) as typeof fetch;

  const NOW = 1_790_000_000_000;
  const run = async (tokenAgeMs: number | null) => {
    waits.length = 0;
    attempts = 0;
    const token = tokenAgeMs === null ? "no-es-un-jwt" : makeJwt(Math.floor((NOW - tokenAgeMs) / 1000));
    const retry = createJwtRejectionRetryFetch(base, { now: () => NOW, sleep: async (ms) => void waits.push(ms), onRetry: (event) => events.push(event) });
    const response = await retry(`${URL_BASE}/rest/v1/students?select=*`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, attempts, waits: [...waits] };
  };

  assert.deepEqual(await run(1000), { status: 401, attempts: 2, waits: [2000] }, "token de 1 s → espera 2 s para llegar a 3 s");
  assert.deepEqual(await run(0), { status: 401, attempts: 2, waits: [2500] }, "recién emitido → tope de 2,5 s");
  assert.deepEqual(await run(2900), { status: 401, attempts: 2, waits: [350] }, "casi maduro → la espera mínima");
  assert.deepEqual(await run(10_000), { status: 401, attempts: 2, waits: [350] }, "token viejo → la espera mínima");
  assert.deepEqual(await run(null), { status: 401, attempts: 2, waits: [2500] }, "sin iat legible → el tope");
  assert.ok(events.every((event) => event.recovered === false && event.detail === "JWT issued at future"));
  assert.deepEqual(events.map((event) => event.waitedMs), [2000, 2500, 350, 350, 2500]);
});

test("otros motivos (p. ej. \"JWT expired\") conservan la espera corta: sólo \"issued at future\" justifica esperar más", async () => {
  const waits: number[] = [];
  const base = (async () => rejection("JWT expired")) as typeof fetch;
  const retry = createJwtRejectionRetryFetch(base, { now: () => 1_790_000_000_000, sleep: async (ms) => void waits.push(ms) });
  await retry(`${URL_BASE}/rest/v1/students`, { headers: { Authorization: `Bearer ${makeJwt(1_790_000_000)}` } });
  assert.deepEqual(waits, [350]);
});

test("el log de la espera lleva waitedMs y nada del token", () => {
  const line = formatJwtRejectionRetryLog({ table: "students", code: "PGRST303", detail: "JWT issued at future", recovered: true, waitedMs: 2000 });
  assert.equal(line, '[jwt-retry] {"table":"students","code":"PGRST303","detail":"JWT issued at future","recovered":true,"waitedMs":2000}');
});
