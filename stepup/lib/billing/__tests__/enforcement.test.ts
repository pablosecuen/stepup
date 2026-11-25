import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ACCESS_CACHE_MS, createAccessResolver, guardFetch, maybeGuardFetch } from "../enforcement.ts";
import { encodeLastKnown } from "../last-known.ts";
import { LIMITED_MODE_MESSAGE, LIMITED_MODE_RPC, LIMITED_MODE_TABLE_WRITES, NOT_USER_CLIENT_RPC, NOT_USER_CLIENT_RPC_PREFIXES, RPC_DEFINED_OUTSIDE_THIS_REPO, WRITE_RPC, classifyRequest } from "../write-guard.ts";
import type { BillingStore } from "../store.ts";
import { ar, snap } from "./helpers.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ORIGIN = "https://proyecto.supabase.test";
const OWNER = "00000000-0000-4000-8000-0000000000aa";
const SECRET = "s".repeat(48);
const ENV_ON = { BILLING_ENABLED: "true", BILLING_ENFORCEMENT_ENABLED: "true", BILLING_GRANDFATHER_CUTOFF: "2026-10-14T14:20:36.871Z", BILLING_STATE_COOKIE_SECRET: SECRET };
const at = (date: string, hour = 12, minute = 0) => new Date(Date.parse(ar(date, hour, minute)));

// ───────────────────────────────────────────── clasificación (pura)

const verdict = (method: string, path: string) => classifyRequest({ method, url: `${ORIGIN}${path}`, supabaseOrigin: ORIGIN });

test("lecturas, sesión y pedidos ajenos a Supabase pasan siempre; las escrituras se clasifican por función, tabla o almacenamiento", () => {
  for (const [method, path] of [["GET", "/rest/v1/students?select=*"], ["HEAD", "/rest/v1/calendar_lessons"], ["OPTIONS", "/rest/v1/students"], ["POST", "/auth/v1/token?grant_type=refresh_token"], ["POST", "/auth/v1/logout"], ["PUT", "/auth/v1/user"], ["GET", "/storage/v1/object/lesson-files/a.png"]] as const) {
    const v = verdict(method, path);
    assert.equal(v.writes, false, `${method} ${path}`);
    assert.equal(v.allowedInLimitedMode, true, `${method} ${path}`);
  }
  assert.equal(classifyRequest({ method: "POST", url: "https://otro.example.test/rest/v1/students", supabaseOrigin: ORIGIN }).allowedInLimitedMode, true, "otro origen: no es de Supabase");
  assert.equal(classifyRequest({ method: "POST", url: "no-es-una-url", supabaseOrigin: ORIGIN }).allowedInLimitedMode, true);
  // Escrituras de datos operativos: bloqueadas.
  for (const [method, path] of [["POST", "/rest/v1/rpc/create_student_with_operation"], ["POST", "/rest/v1/rpc/register_payment"], ["POST", "/rest/v1/rpc/create_calendar_lesson"], ["POST", "/rest/v1/rpc/funcion_nueva_que_nadie_clasifico"],
    ["POST", "/rest/v1/students"], ["PATCH", "/rest/v1/students?id=eq.1"], ["DELETE", "/rest/v1/custom_levels?id=eq.1"], ["POST", "/rest/v1/report_records"], ["PUT", "/rest/v1/recurrence_rules"],
    ["POST", "/storage/v1/object/lesson-files/a.png"], ["POST", "/storage/v1/object/upload/sign/lesson-files/a.png"], ["PUT", "/storage/v1/object/lesson-files/a.png"], ["POST", "/functions/v1/algo"], ["POST", "/otra-ruta"]] as const) {
    const v = verdict(method, path);
    assert.equal(v.writes, true, `${method} ${path}`);
    assert.equal(v.allowedInLimitedMode, false, `${method} ${path}: falla cerrado`);
  }
});

test("lo que una cuenta limitada SÍ puede hacer: lecturas por POST, sesión del dispositivo, preferencias, descargas firmadas, borrar archivos y eliminar su cuenta", () => {
  for (const name of LIMITED_MODE_RPC) assert.equal(verdict("POST", `/rest/v1/rpc/${name}`).allowedInLimitedMode, true, name);
  for (const name of ["claim_web_device", "touch_web_device", "end_web_device", "end_active_session", "delete_own_account", "fetch_own_latest_cloud_backup", "list_open_charge_balances", "calendar_agenda_stamp"]) assert.ok(LIMITED_MODE_RPC.has(name), name);
  assert.equal(verdict("POST", "/rest/v1/teacher_interaction_preferences").allowedInLimitedMode, true);
  assert.equal(verdict("POST", "/storage/v1/object/sign/lesson-files/a.png").allowedInLimitedMode, true, "descargar con URL firmada");
  assert.equal(verdict("POST", "/storage/v1/object/list/lesson-files").allowedInLimitedMode, true);
  assert.equal(verdict("DELETE", "/storage/v1/object/report-pdfs").allowedInLimitedMode, true, "eliminar la cuenta limpia sus archivos");
  assert.deepEqual([...LIMITED_MODE_TABLE_WRITES], ["teacher_interaction_preferences"]);
});

// ───────────────────────────────────────────── completitud: toda función de la base que el código usa está clasificada

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "__tests__", "supabase", "docs", "public"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("COMPLETITUD: toda función de la base que el código nombra está clasificada (permitida, bloqueada o interna) — una nueva sin clasificar rompe esta prueba", () => {
  const migrations = join(ROOT, "supabase/migrations");
  const defined = new Set<string>();
  for (const file of readdirSync(migrations)) for (const match of readFileSync(join(migrations, file), "utf8").matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)/g)) defined.add(match[1]);
  assert.ok(defined.size > 150, "se leyeron las migraciones");
  const source = ["app", "lib", "components"].flatMap((dir) => walk(join(ROOT, dir))).map((file) => readFileSync(file, "utf8")).join("\n");
  const used = [...defined].filter((name) => new RegExp(`["'\`]${name}["'\`]`).test(source));
  assert.ok(used.length > 80, `funciones usadas: ${used.length}`);
  const unclassified = used.filter((name) => !LIMITED_MODE_RPC.has(name) && !WRITE_RPC.has(name) && !NOT_USER_CLIENT_RPC.has(name) && !NOT_USER_CLIENT_RPC_PREFIXES.some((prefix) => name.startsWith(prefix)));
  assert.deepEqual(unclassified, [], "clasificá estas funciones en lib/billing/write-guard.ts (permitida en modo limitado, o escritura bloqueada)");
  // Sin solapamientos ni nombres que no existan (typos).
  for (const name of LIMITED_MODE_RPC) assert.equal(WRITE_RPC.has(name), false, `${name} está en ambas listas`);
  for (const name of [...LIMITED_MODE_RPC, ...WRITE_RPC]) assert.ok(defined.has(name) || RPC_DEFINED_OUTSIDE_THIS_REPO.has(name), `${name} no existe en las migraciones`);
});

test("la guarda se arma en UN solo punto (requireAuthenticatedDbContext) y el navegador no habla con Supabase para datos", () => {
  const context = readFileSync(join(ROOT, "lib/db/server-context.ts"), "utf8");
  assert.match(context, /enforcementFetchFor\(user, config\.url\)/);
  assert.match(context, /createSupabaseServerClient\(\{ fetch: enforcementFetchFor/);
  const server = readFileSync(join(ROOT, "lib/supabase/server.ts"), "utf8");
  assert.match(server, /options\.fetch \?\? defaultEnforcementFetch\(config\.url\)/, "sin guarda propia, la guarda por defecto (cuenta del JWT)");
  assert.match(server, /global: \{ fetch: guardedFetch \}/);
  const clientFiles = ["app", "components", "lib"].flatMap((dir) => walk(join(ROOT, dir))).filter((file) => /createBrowserClient|@supabase\/ssr/.test(readFileSync(file, "utf8")) && !/lib[\\/]supabase[\\/]server\.ts$|proxy\.ts$|lib[\\/]auth[\\/]/.test(file));
  assert.deepEqual(clientFiles.map((file) => file.slice(ROOT.length)), [], "ningún componente de datos usa un cliente de Supabase en el navegador");
});

// ───────────────────────────────────────────── la guarda del servidor, con estados reales de cuenta

function storeOf(snapshot: ReturnType<typeof snap> | "fail"): BillingStore {
  return { ensureAccount: async () => { if (snapshot === "fail") throw new Error("base caída"); return snapshot; } } as unknown as BillingStore;
}

interface Calls { readonly urls: string[] }
function harness(options: { snapshot: ReturnType<typeof snap> | "fail"; now: Date; env?: Record<string, string | undefined>; createdAt?: string | null; token?: string }) {
  const calls: Calls = { urls: [] };
  const inner = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.urls.push(`${init?.method ?? "GET"} ${typeof input === "string" ? input : String(input)}`);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  let clock = options.now;
  const written: string[] = [];
  const blocked: string[] = [];
  const fetchGuarded = maybeGuardFetch({
    env: options.env ?? ENV_ON, ownerId: OWNER, accountCreatedAt: options.createdAt ?? "2026-10-04T03:45:56Z", store: storeOf(options.snapshot), now: () => clock, supabaseOrigin: ORIGIN, inner,
    cookie: { read: async () => options.token, write: async (value) => { written.push(value); } },
    onBlocked: ({ reason }) => blocked.push(reason),
  });
  return { fetchGuarded, calls, written, blocked, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); } };
}
const write = (guarded: typeof fetch | undefined, path = "/rest/v1/rpc/create_student_with_operation") => guarded!(`${ORIGIN}${path}`, { method: "POST", body: "{}" });
const read = (guarded: typeof fetch | undefined, path = "/rest/v1/students?select=*") => guarded!(`${ORIGIN}${path}`);

const PAID = { planCode: "tf_monthly_ars_v2", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") } as const;

test("con el interruptor APAGADO no se envuelve nada: ni una consulta más, ni un bloqueo (comportamiento de siempre)", () => {
  for (const env of [{}, { BILLING_ENABLED: "true" }, { BILLING_ENFORCEMENT_ENABLED: "true" }, { BILLING_ENABLED: "true", BILLING_ENFORCEMENT_ENABLED: "false" }]) {
    assert.equal(harness({ snapshot: snap({ status: "pending" }), now: at("2026-11-20"), env }).fetchGuarded, undefined, JSON.stringify(env));
  }
});

test("CUENTA EXISTENTE (anterior al corte, grandfathered): acceso completo siempre; escribe aunque pasen los años", async () => {
  const h = harness({ snapshot: snap({ status: "grandfathered", grandfathered: true }), now: at("2030-01-01") });
  assert.equal((await write(h.fetchGuarded)).status, 200);
  assert.equal(h.blocked.length, 0);
});

test("CUENTA NUEVA sin pago (pending): BLOQUEADA — no lee ni escribe datos operativos EN EL SERVIDOR (403) sin llegar a la base; sí ingresa, ve su facturación y puede eliminar la cuenta", async () => {
  const h = harness({ snapshot: snap({ status: "pending" }), now: at("2026-11-20"), createdAt: "2026-11-19T10:00:00Z" });
  assert.equal((await read(h.fetchGuarded)).status, 403, "ni siquiera lee alumnos: no es modo de sólo lectura");
  assert.equal((await read(h.fetchGuarded, "/rest/v1/billing_subscriptions?select=*")).status, 200, "su propia facturación");
  assert.equal((await read(h.fetchGuarded, "/rest/v1/teacher_profiles?select=*")).status, 200, "perfil (Configuración)");
  assert.equal((await write(h.fetchGuarded, "/rest/v1/rpc/calendar_agenda_stamp")).status, 403, "ni las lecturas operativas por función");
  assert.equal((await h.fetchGuarded!(`${ORIGIN}/auth/v1/token`, { method: "POST" })).status, 200, "sesión");
  assert.equal((await write(h.fetchGuarded, "/rest/v1/rpc/touch_web_device")).status, 200, "dispositivo");
  assert.equal((await write(h.fetchGuarded, "/rest/v1/rpc/delete_own_account")).status, 200, "eliminar la cuenta");
  const denied = await write(h.fetchGuarded);
  assert.equal(denied.status, 403);
  const body = (await denied.json()) as { code: string; message: string };
  assert.equal(body.code, "TF_BILLING_LIMITED");
  assert.equal(body.message, LIMITED_MODE_MESSAGE);
  assert.equal((await write(h.fetchGuarded, "/rest/v1/students")).status, 403);
  assert.equal((await write(h.fetchGuarded, "/storage/v1/object/lesson-files/x.png")).status, 403);
  assert.ok(!h.calls.urls.some((url) => /create_student_with_operation|\/rest\/v1\/students$|object\/lesson-files\/x/.test(url) && url.startsWith("POST")), "los bloqueados nunca llegaron a Supabase");
  assert.ok(h.blocked.length >= 3 && h.blocked.every((reason) => /_blocked|storage_blocked|read_blocked/.test(reason)));
});

test("CICLO COMPLETO de una cuenta que pagó: activa → vence → SIN gracia (bloqueada, ni lee ni escribe) → paga → vuelve todo", async () => {
  // active
  let h = harness({ snapshot: snap({ status: "active", ...PAID }), now: at("2026-10-20") });
  assert.equal((await write(h.fetchGuarded)).status, 200, "período pagado");
  // vencido sin resultado confirmado: BLOQUEADA (no hay gracia); apenas se confirme el pago vuelve sola
  h = harness({ snapshot: snap({ status: "active", ...PAID }), now: at("2026-11-02") });
  assert.equal((await write(h.fetchGuarded)).status, 403, "renovación sin confirmar: sin acceso");
  assert.equal((await read(h.fetchGuarded)).status, 403);
  // cobro rechazado: tampoco hay gracia, ningún día
  const graceSnap = snap({ status: "grace_period", ...PAID, renewalRejectedDueAt: ar("2026-11-01") });
  for (const day of ["2026-11-02", "2026-11-06", "2026-11-07"]) {
    const rejected = harness({ snapshot: graceSnap, now: at(day) });
    assert.equal((await write(rejected.fetchGuarded)).status, 403, `sin gracia ${day}`);
    assert.equal((await read(rejected.fetchGuarded)).status, 403, `ni lectura ${day}`);
  }
  // paga de nuevo: nuevo período confirmado → vuelve el acceso completo
  const paid = harness({ snapshot: snap({ status: "active", ...PAID, currentPeriodStart: ar("2026-11-08"), currentPeriodEnd: ar("2026-12-08"), graceEndsAt: ar("2026-12-14"), renewalRejectedDueAt: null }), now: at("2026-11-08", 12) });
  assert.equal((await write(paid.fetchGuarded)).status, 200, "pagó: recupera el acceso completo");
});

test("cancelada (conserva lo pagado), terminada y contracargo: lo pagado se respeta, lo demás se limita", async () => {
  const cancelling = harness({ snapshot: snap({ status: "cancel_at_period_end", ...PAID, cancelRequestedAt: ar("2026-10-10") }), now: at("2026-10-20") });
  assert.equal((await write(cancelling.fetchGuarded)).status, 200, "conserva el acceso hasta el fin del período pagado");
  const ended = harness({ snapshot: snap({ status: "canceled", ...PAID, cancelRequestedAt: ar("2026-10-10") }), now: at("2026-11-20") });
  assert.equal((await write(ended.fetchGuarded)).status, 403);
  const chargeback = harness({ snapshot: snap({ status: "active", ...PAID, chargebackAt: ar("2026-10-15") }), now: at("2026-10-20") });
  assert.equal((await write(chargeback.fetchGuarded)).status, 403, "contracargo conciliado: limitada de inmediato");
});

test("falla PROPIA al leer el estado: una cuenta anterior al corte sigue; una nueva sin verificar se limita; una que pagó conserva 72 h con su comprobante firmado", async () => {
  const existing = harness({ snapshot: "fail", now: at("2026-11-20"), createdAt: "2026-10-04T03:45:56Z" });
  assert.equal((await write(existing.fetchGuarded)).status, 200, "cuenta existente: nunca se castiga por una falla propia");
  const brandNew = harness({ snapshot: "fail", now: at("2026-11-20"), createdAt: "2026-11-19T10:00:00Z" });
  assert.equal((await write(brandNew.fetchGuarded)).status, 403);
  const token = encodeLastKnown(SECRET, OWNER, { status: "active", grandfathered: false, verifiedAt: at("2026-11-19").toISOString() })!;
  const paid = harness({ snapshot: "fail", now: at("2026-11-20"), createdAt: "2026-11-01T10:00:00Z", token });
  assert.equal((await write(paid.fetchGuarded)).status, 200, "dentro de las 72 h del último comprobante firmado");
  const expired = harness({ snapshot: "fail", now: at("2026-11-23"), createdAt: "2026-11-01T10:00:00Z", token });
  assert.equal((await write(expired.fetchGuarded)).status, 403, "vencida la tolerancia");
  const forged = harness({ snapshot: "fail", now: at("2026-11-20"), createdAt: "2026-11-01T10:00:00Z", token: token.slice(0, -2) + "xx" });
  assert.equal((await write(forged.fetchGuarded)).status, 403, "un comprobante alterado no sirve");
  // Sin corte configurado no se puede probar que una cuenta sea nueva: se la trata como existente (nunca se castiga por configuración faltante).
  const noCutoff = harness({ snapshot: "fail", now: at("2026-11-20"), createdAt: "2026-11-19T10:00:00Z", env: { BILLING_ENABLED: "true", BILLING_ENFORCEMENT_ENABLED: "true" } });
  assert.equal((await write(noCutoff.fetchGuarded)).status, 200);
});

test("el comprobante firmado se emite sólo con una verificación buena y acceso pagado/existente; el resultado se guarda unos segundos (no consulta en cada pedido)", async () => {
  let reads = 0;
  const store = { ensureAccount: async () => { reads += 1; return snap({ status: "active", ...PAID }); } } as unknown as BillingStore;
  const written: string[] = [];
  let now = at("2026-10-20");
  const resolve = createAccessResolver({ env: ENV_ON, ownerId: OWNER, accountCreatedAt: null, store, now: () => now, cookie: { read: async () => undefined, write: async (value) => { written.push(value); } } });
  await Promise.all([resolve(), resolve(), resolve()]);
  await resolve();
  assert.equal(reads, 1, "un solo viaje a la base dentro de la ventana");
  assert.equal(written.length, 1);
  assert.doesNotMatch(written[0], new RegExp(OWNER), "el comprobante no lleva el id de la cuenta ni datos personales");
  now = new Date(now.getTime() + ACCESS_CACHE_MS + 1);
  await resolve();
  assert.equal(reads, 2, "pasada la ventana, vuelve a mirar");
  // Una cuenta limitada no emite comprobante.
  const limitedWritten: string[] = [];
  const limitedResolve = createAccessResolver({ env: ENV_ON, ownerId: OWNER, accountCreatedAt: null, store: storeOf(snap({ status: "pending" })), now: () => now, cookie: { read: async () => undefined, write: async (value) => { limitedWritten.push(value); } } });
  assert.equal((await limitedResolve()).level, "blocked");
  assert.equal(limitedWritten.length, 0);
});

test("la guarda decide en el SERVIDOR por pedido: no confía en la interfaz ni en el navegador (una acción invocada sin pantalla igual se bloquea)", async () => {
  const resolved: string[] = [];
  const inner = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const guarded = guardFetch(inner, { supabaseOrigin: ORIGIN, resolve: async () => { resolved.push("x"); return { level: "blocked", capabilities: { createOperationalData: false, modifyOperationalData: false, viewOperationalData: false }, status: "pending" } as never; } });
  assert.equal((await guarded(new Request(`${ORIGIN}/rest/v1/rpc/register_payment`, { method: "POST", body: "{}" }))).status, 403, "también con un Request");
  assert.equal((await guarded(new URL(`${ORIGIN}/rest/v1/students`), { method: "DELETE" })).status, 403, "también con una URL");
  assert.equal(resolved.length, 2);
  assert.equal((await guarded(`${ORIGIN}/rest/v1/students`)).status, 403, "una cuenta bloqueada tampoco LEE datos operativos");
  assert.equal((await guarded(`${ORIGIN}/auth/v1/user`)).status, 200, "la sesión nunca consulta el estado");
  assert.equal((await guarded(`${ORIGIN}/rest/v1/billing_subscriptions`)).status, 200, "su propia facturación");
  assert.equal(resolved.length, 4);
});
