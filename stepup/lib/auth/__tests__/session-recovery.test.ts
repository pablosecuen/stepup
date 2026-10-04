import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  ISSUED_AT_FUTURE_DETAIL,
  SESSION_RECOVERED_DESTINATION,
  SESSION_RECOVERY_DELAYS_MS,
  SESSION_RECOVERY_PATH,
  SESSION_RECOVERY_TOTAL_LIMIT_MS,
  formatSessionRecoveryLog,
  isIssuedAtFutureError,
  isIssuedAtFutureFailure,
  probeSessionReadiness,
  runSessionRecovery,
  type ReadOnlyProbeClient,
  type SessionReadiness,
} from "../session-recovery.ts";
import { describeLoadFailure } from "../../errors/load-failure.ts";

/**
 * Recuperación de sesión ante `PGRST303 · "JWT issued at future"` (hallado en Production, 4/oct): Inicio redirige a una
 * pantalla transitoria que espera con backoff, comprueba con consultas de SÓLO LECTURA y recién entonces vuelve a Inicio.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative: string) => readFileSync(ROOT + relative, "utf8");
/** Código sin comentarios: las guardas miran el código, no lo que explican los comentarios. */
const code = (relative: string) => read(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const URL_BASE = "https://proyecto.supabase.co";
const USER_ID = "8ba16f57-dda0-4923-b45c-0ee0704eff02";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejection = (message: string, code = "PGRST303") => json({ code, details: null, hint: null, message }, 401);
const issuedAtFuture = () => rejection(ISSUED_AT_FUTURE_DETAIL);
const emptyList = () => json([]);

interface Seen {
  method: string;
  table: string;
  query: string;
}

/** Cliente real de supabase-js sobre un PostgREST de mentira. `behave` decide cada respuesta con el reloj virtual. */
function clientOver(behave: (seen: Seen, now: number) => Response, clock: { now: number }) {
  const requests: Seen[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const seen: Seen = { method: (init?.method ?? "GET").toUpperCase(), table: url.pathname.replace("/rest/v1/", ""), query: url.search };
    requests.push(seen);
    return behave(seen, clock.now);
  }) as typeof fetch;
  const client = createClient(URL_BASE, "sb_publishable_clave_de_prueba", { global: { fetch: fetchImpl }, auth: { persistSession: false, autoRefreshToken: false }, accessToken: async () => "token-de-prueba" });
  return { client: client as unknown as ReadOnlyProbeClient, raw: client, requests };
}

// ----------------------------------------------------------------------------------------------------------------
// Constantes y reconocimiento del caso exacto
// ----------------------------------------------------------------------------------------------------------------

test("límite explícito: pocas comprobaciones, espera progresiva y total igual a la suma declarada", () => {
  assert.ok(SESSION_RECOVERY_DELAYS_MS.length >= 1 && SESSION_RECOVERY_DELAYS_MS.length <= 3, "pocos intentos");
  for (let i = 1; i < SESSION_RECOVERY_DELAYS_MS.length; i += 1) assert.ok(SESSION_RECOVERY_DELAYS_MS[i] > SESSION_RECOVERY_DELAYS_MS[i - 1], "backoff progresivo");
  assert.equal(SESSION_RECOVERY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0), SESSION_RECOVERY_TOTAL_LIMIT_MS, "el límite total declarado es la suma real de las esperas");
  assert.ok(SESSION_RECOVERY_TOTAL_LIMIT_MS <= 12_000, "el login no queda esperando más de ~12 s");
  assert.equal(SESSION_RECOVERY_PATH, "/iniciando-sesion");
  assert.equal(SESSION_RECOVERED_DESTINATION, "/inicio?recuperada=1");
});

test("sólo el código PGRST303 con el motivo EXACTO 'JWT issued at future' activa la recuperación", () => {
  assert.equal(isIssuedAtFutureFailure(describeLoadFailure({ code: "PGRST303", message: "JWT issued at future" })), true);
  assert.equal(isIssuedAtFutureError({ code: "PGRST303", message: "JWT issued at future" }), true);

  // Otros PGRST303
  for (const message of ["JWT expired", "JWT claims validation failed", "JWT not yet valid", "JWT issued at future time", "jwt issued at future", "JWT issued at futur"]) {
    assert.equal(isIssuedAtFutureFailure(describeLoadFailure({ code: "PGRST303", message })), false, message);
    assert.equal(isIssuedAtFutureError({ code: "PGRST303", message }), false, message);
  }
  // Otros códigos con el mismo texto, y errores sin motivo
  for (const code of ["PGRST301", "PGRST302", "PGRST300", "42501", "PGRST116", "57014", ""]) {
    assert.equal(isIssuedAtFutureFailure(describeLoadFailure({ code, message: "JWT issued at future" })), false, code);
  }
  assert.equal(isIssuedAtFutureFailure(describeLoadFailure({ code: "PGRST303" })), false, "sin motivo");
  assert.equal(isIssuedAtFutureFailure(null), false);
  assert.equal(isIssuedAtFutureFailure(undefined), false);
  assert.equal(isIssuedAtFutureFailure(describeLoadFailure(new TypeError("fetch failed"))), false);
  assert.equal(isIssuedAtFutureError(null), false);
  // Un mensaje que traiga un token u otros datos no pasa por el filtro del motivo
  assert.equal(isIssuedAtFutureFailure(describeLoadFailure({ code: "PGRST303", message: "JWT issued at future eyJhbGciOi.eyJzdWIi.firma" })), false);
});

// ----------------------------------------------------------------------------------------------------------------
// Comprobación de sólo lectura
// ----------------------------------------------------------------------------------------------------------------

test("la comprobación SÓLO LEE: únicamente GET con select y limit 1 sobre las tablas de Inicio, filtrado por el dueño; nunca POST, PATCH, DELETE ni RPC", async () => {
  const clock = { now: 0 };
  const { client, requests } = clientOver(() => emptyList(), clock);

  assert.deepEqual(await probeSessionReadiness(client, USER_ID), { status: "ready" });

  assert.equal(requests.length, 6, "3 tablas × 2 consultas en paralelo");
  assert.ok(requests.every((request) => request.method === "GET"), "sólo GET");
  assert.deepEqual([...new Set(requests.map((request) => request.table))].sort(), ["calendar_lessons", "recurrence_rules", "students"]);
  assert.ok(requests.every((request) => request.query.includes("select=id") && request.query.includes("limit=1") && request.query.includes(`owner_id=eq.${USER_ID}`)), "select mínimo, limit 1 y filtro por el dueño");
  assert.ok(requests.every((request) => !request.table.startsWith("rpc/")), "ninguna RPC (las RPC de Inicio generan cargos)");
});

test("rechazo exacto en todas o en algunas consultas → 'esperar'; todas sanas → 'listo'", async () => {
  const clock = { now: 0 };
  assert.deepEqual(await probeSessionReadiness(clientOver(() => issuedAtFuture(), clock).client, USER_ID), { status: "waiting" });

  // Una sola consulta rechazada entre seis: NO se da por listo (volver a Inicio podría caer en la misma instancia).
  let count = 0;
  const some = clientOver(() => (++count === 3 ? issuedAtFuture() : emptyList()), clock);
  assert.deepEqual(await probeSessionReadiness(some.client, USER_ID), { status: "waiting" });

  assert.deepEqual(await probeSessionReadiness(clientOver(() => emptyList(), clock).client, USER_ID), { status: "ready" });
});

test("otros PGRST303, otros 401 y otros errores NO se tratan como este caso: salen como error", async () => {
  const clock = { now: 0 };
  const probeWith = (response: () => Response) => probeSessionReadiness(clientOver(response, clock).client, USER_ID);

  assert.deepEqual(await probeWith(() => rejection("JWT expired")), { status: "error", code: "PGRST303" });
  assert.deepEqual(await probeWith(() => rejection("JWT claims validation failed")), { status: "error", code: "PGRST303" });
  assert.deepEqual(await probeWith(() => rejection("JWT cryptographic operation failed", "PGRST301")), { status: "error", code: "PGRST301" });
  assert.deepEqual(await probeWith(() => rejection("Anonymous access is disabled", "PGRST302")), { status: "error", code: "PGRST302" });
  assert.deepEqual(await probeWith(() => json({ code: "42501", message: "permission denied for table students" }, 403)), { status: "error", code: "42501" });
  assert.deepEqual(await probeWith(() => json({ message: "boom" }, 500)), { status: "error", code: null });
  assert.deepEqual(await probeWith(() => new Response("no es json", { status: 401 })), { status: "error", code: null });

  // Mezcla: una consulta con el caso exacto y otra con un error distinto → el error real manda.
  let count = 0;
  const mixed = clientOver(() => (++count % 2 === 0 ? json({ code: "42501", message: "x" }, 403) : issuedAtFuture()), clock);
  assert.deepEqual(await probeSessionReadiness(mixed.client, USER_ID), { status: "error", code: "42501" });
});

test("una falla de red al comprobar es un error (no esperar), y nunca una lista vacía", async () => {
  const failing: ReadOnlyProbeClient = {
    from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.reject(new TypeError("fetch failed")) }) }) }),
  };
  assert.deepEqual(await probeSessionReadiness(failing, USER_ID), { status: "error", code: "network" });
});

// ----------------------------------------------------------------------------------------------------------------
// Bucle de recuperación
// ----------------------------------------------------------------------------------------------------------------

function loop(script: SessionReadiness[] | ((attempt: number) => Promise<SessionReadiness>), options: { cancelAfterChecks?: number } = {}) {
  const sleeps: number[] = [];
  const checks: number[] = [];
  const waits: [number, number][] = [];
  let cancelled = false;
  const promise = runSessionRecovery({
    check: async (attempt) => {
      checks.push(attempt);
      if (options.cancelAfterChecks !== undefined && checks.length >= options.cancelAfterChecks) cancelled = true;
      return typeof script === "function" ? script(attempt) : script[Math.min(attempt - 1, script.length - 1)];
    },
    sleep: async (ms) => void sleeps.push(ms),
    isCancelled: () => cancelled,
    onWait: (attempt, delayMs) => void waits.push([attempt, delayMs]),
  });
  return { promise, sleeps, checks, waits };
}

test("recuperación: la sesión pasa a ser reconocida en la 2.ª comprobación → entra a Inicio, tras esperar 2 s y 3 s", async () => {
  const run = loop([{ status: "waiting" }, { status: "ready" }]);
  assert.deepEqual(await run.promise, { kind: "ready", attempts: 2 });
  assert.deepEqual(run.sleeps, [2000, 3000]);
  assert.deepEqual(run.checks, [1, 2], "ninguna comprobación de más una vez recuperada");
  assert.deepEqual(run.waits, [[1, 2000], [2, 3000]]);
});

test("recuperación inmediata: se reconoce en la 1.ª comprobación", async () => {
  const run = loop([{ status: "ready" }]);
  assert.deepEqual(await run.promise, { kind: "ready", attempts: 1 });
  assert.deepEqual(run.sleeps, [2000]);
  assert.deepEqual(run.checks, [1]);
});

test("límite agotado: exactamente 3 comprobaciones y el total de la espera es el límite declarado; no hay una 4.ª ni un bucle", async () => {
  const run = loop([{ status: "waiting" }]);
  assert.deepEqual(await run.promise, { kind: "exhausted", attempts: 3 });
  assert.deepEqual(run.checks, [1, 2, 3]);
  assert.equal(run.sleeps.reduce((sum, ms) => sum + ms, 0), SESSION_RECOVERY_TOTAL_LIMIT_MS);
  assert.deepEqual(run.sleeps, [...SESSION_RECOVERY_DELAYS_MS]);
});

test("cualquier resultado que no sea 'esperar' corta de inmediato: error distinto, sesión cerrada, falla de la propia comprobación", async () => {
  const error = loop([{ status: "waiting" }, { status: "error", code: "PGRST303" }]);
  assert.deepEqual(await error.promise, { kind: "other_error", code: "PGRST303" });
  assert.deepEqual(error.checks, [1, 2], "no sigue esperando ante un error que no es el caso");

  const signedOut = loop([{ status: "signed_out" }]);
  assert.deepEqual(await signedOut.promise, { kind: "signed_out" });
  assert.deepEqual(signedOut.checks, [1]);

  const thrown = loop(async () => {
    throw new Error("red caída");
  });
  assert.deepEqual(await thrown.promise, { kind: "other_error", code: "network" });
  assert.deepEqual(thrown.checks, [1]);
});

test("cancelar (el usuario sale de la pantalla) detiene el bucle: no quedan comprobaciones pendientes", async () => {
  const early = loop([{ status: "waiting" }], { cancelAfterChecks: 1 });
  assert.deepEqual(await early.promise, { kind: "cancelled" });
  assert.deepEqual(early.checks, [1], "tras cancelar no hay más comprobaciones");
});

// ----------------------------------------------------------------------------------------------------------------
// Recorrido completo con clientes reales: login → Inicio falla → recuperación (sólo lectura) → Inicio una sola vez
// ----------------------------------------------------------------------------------------------------------------

test("recorrido: el servidor rechaza 'issued at future' durante 4 s; se recupera en la 2.ª comprobación, SIN escrituras durante la espera y con Inicio cargado una sola vez", async () => {
  const clock = { now: 0 };
  const REJECT_UNTIL_MS = 4000;
  const { client, raw, requests } = clientOver((seen, now) => (now < REJECT_UNTIL_MS ? issuedAtFuture() : emptyList()), clock);

  // 1) Carga de Inicio al iniciar sesión (reloj 0): una consulta rechazada tumba la página → eso es lo que dispara la recuperación.
  const firstLoad = await raw.from("recurrence_rules").select("*").eq("owner_id", USER_ID).limit(1);
  assert.equal(isIssuedAtFutureError(firstLoad.error), true);
  const requestsBeforeRecovery = requests.length;

  // 2) Recuperación: el reloj virtual avanza con cada espera; la comprobación usa el cliente real.
  const outcome = await runSessionRecovery({
    check: (attempt) => probeSessionReadiness(client, USER_ID),
    sleep: async (ms) => void (clock.now += ms),
  });
  assert.deepEqual(outcome, { kind: "ready", attempts: 2 }, "a los 5 s ya es aceptado");

  const duringRecovery = requests.slice(requestsBeforeRecovery);
  assert.equal(duringRecovery.length, 12, "2 comprobaciones × 6 consultas de lectura");
  assert.ok(duringRecovery.every((request) => request.method === "GET" && !request.table.startsWith("rpc/")), "durante la espera nada se escribe ni se repite");

  // 3) Recién ahora se vuelve a cargar Inicio: una sola vez.
  const secondLoad = await raw.from("recurrence_rules").select("*").eq("owner_id", USER_ID);
  assert.equal(secondLoad.error, null);
  assert.deepEqual(secondLoad.data, [], "cuenta sin reglas: lista vacía autenticada");
});

test("recorrido: si el rechazo no cede, se agota el límite (10 s) y NO se vuelve a cargar Inicio ni se devuelve una lista vacía", async () => {
  const clock = { now: 0 };
  const { client, requests } = clientOver(() => issuedAtFuture(), clock);

  const outcome = await runSessionRecovery({
    check: () => probeSessionReadiness(client, USER_ID),
    sleep: async (ms) => void (clock.now += ms),
  });
  assert.deepEqual(outcome, { kind: "exhausted", attempts: 3 });
  assert.equal(clock.now, SESSION_RECOVERY_TOTAL_LIMIT_MS);
  assert.equal(requests.length, 18, "3 comprobaciones × 6 lecturas y nada más");
  assert.ok(requests.every((request) => request.method === "GET"));
});

// ----------------------------------------------------------------------------------------------------------------
// Cableado: Inicio, la pantalla transitoria y la acción
// ----------------------------------------------------------------------------------------------------------------

test("Inicio: sólo el caso exacto redirige a la pantalla transitoria, una sola vez; el resto sigue siendo el error normal y nunca se oculta", () => {
  const page = code("app/(app)/inicio/page.tsx");
  assert.match(page, /isIssuedAtFutureFailure\(failure\)/);
  assert.match(page, /if \(sessionNotRecognizedYet && recuperada !== "1"\) redirect\(SESSION_RECOVERY_PATH\);/);
  assert.equal((page.match(/redirect\(/g) ?? []).length, 1, "un único redirect en toda la página");
  assert.match(page, /logLoadFailure\("inicio", error\)/, "el fallo sigue registrándose");
  assert.match(page, /<ErrorState/, "los demás errores muestran el error normal");
  assert.doesNotMatch(page, /catch \{/, "no hay catch vacío");
  assert.doesNotMatch(page, /\bdata = (\{|\[\])/, "ningún error se convierte en datos vacíos");
});

test("pantalla transitoria: fuera de (app), sin navegación privada, sin enlaces ni precargas", () => {
  const page = code("app/iniciando-sesion/page.tsx");
  const client = code("app/iniciando-sesion/session-recovery.tsx");
  for (const [name, source] of [["page.tsx", page], ["session-recovery.tsx", client]] as const) {
    assert.doesNotMatch(source, /next\/link/, `${name}: sin next/link (los <Link> precargan rutas)`);
    assert.doesNotMatch(source, /<Link\b|<a\s|prefetch|PrimaryNav|AuthShell/, `${name}: sin enlaces, precargas, navegación privada ni AuthShell (que trae un <Link>)`);
  }
  assert.match(page, /signOutAction/, "la acción de cerrar sesión es un formulario, no un enlace");
  assert.match(page, /robots: \{ index: false/, "sin indexar");
  assert.match(page, /if \(!user\) redirect\("\/login"\)/, "sin sesión no hay pantalla");

  // No hereda el layout privado: la ruta vive fuera del grupo (app).
  assert.throws(() => read("app/(app)/iniciando-sesion/page.tsx"));
});

test("pantalla transitoria: un único ciclo por intento del usuario, sin reinicio automático, con acciones claras si se agota", () => {
  const client = code("app/iniciando-sesion/session-recovery.tsx");
  assert.equal((client.match(/runSessionRecovery\(/g) ?? []).length, 1, "un solo bucle");
  assert.match(client, /\}, \[run, router\]\);/, "el efecto sólo se repite si el usuario pulsa Reintentar");
  assert.match(client, /router\.replace\(SESSION_RECOVERED_DESTINATION\)/);
  assert.match(client, /Estamos terminando de iniciar tu sesión…/);
  assert.match(client, /No pudimos cargar Inicio\./);
  assert.match(client, />\s*Reintentar\s*</);
  assert.match(client, /signOutForm/, "ofrece cerrar sesión");
  assert.match(client, /role="alert"/);
  assert.match(client, /role="status"/);
  assert.doesNotMatch(client, /setInterval|setTimeout\([^)]*checkSessionReadyAction/, "la espera sólo la maneja el bucle acotado");
});

test("la acción de comprobación no escribe: sólo select, sin RPC, insert, update, upsert ni delete; y su log no lleva datos", () => {
  const action = code("lib/auth/session-recovery-action.ts");
  const pure = code("lib/auth/session-recovery.ts");
  assert.match(action, /^\s*"use server";/);
  for (const source of [action, pure]) assert.doesNotMatch(source, /\.(rpc|insert|update|upsert|delete)\(/);
  assert.match(pure, /\.select\("id"\)\.eq\("owner_id", ownerId\)\.limit\(1\)/);

  assert.equal(formatSessionRecoveryLog({ attempt: 2, status: "waiting" }), '[session-recovery] {"attempt":2,"status":"waiting","code":null}');
  assert.equal(formatSessionRecoveryLog({ attempt: 1, status: "error", code: "PGRST303" }), '[session-recovery] {"attempt":1,"status":"error","code":"PGRST303"}');
  assert.doesNotMatch(action, /console\.(log|warn|error)\([^)]*(token|email|user\.id|ownerId)/i);
});

test("el reintento a nivel de fetch se retiró: ya no hay un segundo mecanismo que espere dentro del request", () => {
  const server = read("lib/supabase/server.ts");
  assert.doesNotMatch(server, /jwt-retry|createJwtRejectionRetryFetch|global:/);
});
