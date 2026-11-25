// CONTROL DE ACCESO — prueba en un entorno AISLADO: supabase-js REAL → guarda de escrituras REAL (lib/billing/enforcement.ts) → pasarela local con la semántica de PostgREST →
// Postgres REAL (embedded-postgres 17, TODAS las migraciones reales, RLS y roles reales). Sin Production, sin usuarios reales, sin red.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/access_enforcement.mjs
//
// QUÉ ES Y QUÉ NO: la pasarela traduce los pedidos HTTP de PostgREST (rpc, GET/POST/PATCH/DELETE de tablas, /auth y /storage) a SQL ejecutado con el rol `authenticated` y
// `auth.uid()` del JWT; NO es el Supabase alojado (no hay Docker ni un proyecto de prueba). Lo que se prueba tal cual es el cliente de supabase-js, la guarda, la clasificación de
// pedidos, el estado de facturación y la base (funciones, RLS, permisos). Lo que NO se prueba: el despliegue de Next/Vercel ni la verificación de firma del JWT de GoTrue.
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { maybeGuardFetch, maybeGuardFetchByJwt, ACCESS_CACHE_MS } = await importLib("billing/enforcement.ts");
const { LIMITED_MODE_MESSAGE } = await importLib("billing/write-guard.ts");

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.message ?? error).split("\n").slice(0, 5).join("\n        ")}`);
  }
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwtFor = (sub) => `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub, role: "authenticated" })}.sin-firma`;
const subOf = (authorization) => JSON.parse(Buffer.from(String(authorization ?? "").replace(/^Bearer\s+/i, "").split(".")[1] ?? "", "base64url").toString("utf8") || "{}").sub;
const IDENT = /^[a-z_][a-z0-9_]*$/;

const pg = await start({ port: 5871 + Math.floor(Math.random() * 300) });
const hits = [];
let gateway;
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const admin = pg.admin;

  // ───────────────────────────────────────────── pasarela local con la semántica de PostgREST
  gateway = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, "http://localhost");
    hits.push(`${req.method} ${url.pathname}`);
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/storage/v1/")) return send(200, {});
    const uid = subOf(req.headers.authorization);
    const session = await pg.session(uid);
    try {
      const rpc = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
      const table = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(url.pathname);
      const body = raw ? JSON.parse(raw) : null;
      const filters = [...url.searchParams.entries()].filter(([key, value]) => /^eq\./.test(value) && IDENT.test(key));
      const where = filters.length ? ` where ${filters.map(([key], i) => `${key} = $${i + 1}`).join(" and ")}` : "";
      const whereArgs = filters.map(([, value]) => value.slice(3));
      let result;
      if (rpc) {
        const keys = Object.keys(body ?? {});
        result = await session.query(`select * from public.${rpc[1]}(${keys.map((key, i) => `${key} => $${i + 1}`).join(", ")})`, keys.map((key) => (typeof body[key] === "object" && body[key] !== null ? JSON.stringify(body[key]) : body[key])));
      } else if (table && req.method === "GET") {
        result = await session.query(`select * from public.${table[1]}${where}`, whereArgs);
      } else if (table && req.method === "POST") {
        const rows = Array.isArray(body) ? body : [body];
        for (const row of rows) {
          const keys = Object.keys(row);
          await session.query(`insert into public.${table[1]} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")})`, keys.map((key) => (typeof row[key] === "object" && row[key] !== null ? JSON.stringify(row[key]) : row[key])));
        }
        return send(201);
      } else if (table && req.method === "PATCH") {
        const keys = Object.keys(body);
        const r = await session.query(`update public.${table[1]} set ${keys.map((key, i) => `${key} = $${i + 1}`).join(", ")}${where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + keys.length}`)}`, [...keys.map((key) => body[key]), ...whereArgs]);
        return send(r.rowCount ? 204 : 200, r.rowCount ? undefined : []);
      } else if (table && req.method === "DELETE") {
        await session.query(`delete from public.${table[1]}${where}`, whereArgs);
        return send(204);
      } else return send(404, { message: "ruta no emulada" });
      return send(200, req.headers.accept?.includes("vnd.pgrst.object") ? (result.rows[0] ?? null) : result.rows);
    } catch (error) {
      return send(/permission denied|denied/i.test(String(error.message)) ? 403 : 400, { code: error.code ?? "x", message: String(error.message), details: null, hint: null });
    } finally {
      await session.end();
    }
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const URL_BASE = `http://127.0.0.1:${gateway.address().port}`;

  // ───────────────────────────────────────────── cuentas y estado de facturación
  const svcConn = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svcConn));
  const [E, N, P, X] = [1, 2, 3, 4].map((n) => uuidFor(n * 100));
  // E: cuenta EXISTENTE (alta anterior al corte); N: cuenta nueva sin pago; P: cuenta nueva que paga; X: otra cuenta (para ver que no se mezclan).
  await admin.query("insert into auth.users (id, email, created_at) values ($1, 'e@example.test', now() - interval '30 days')", [E]);
  for (const [id, tag] of [[N, "n"], [P, "p"], [X, "x"]]) await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now())", [id, `${tag}@example.test`]);
  await store.ensureAccount(E);
  await store.ensureAccount(N);
  await store.ensureAccount(P);
  await store.ensureAccount(X);
  assert.equal((await admin.query("select grandfathered from public.billing_subscriptions where owner_id = $1", [E])).rows[0].grandfathered, true, "E es grandfathered por el corte real de la base");
  assert.equal((await admin.query("select status from public.billing_subscriptions where owner_id = $1", [N])).rows[0].status, "pending");
  const cutoff = (await admin.query("select grandfather_cutoff from public.billing_settings")).rows[0].grandfather_cutoff.toISOString();

  const ENV_ON = { BILLING_ENABLED: "true", BILLING_ENFORCEMENT_ENABLED: "true", BILLING_GRANDFATHER_CUTOFF: cutoff, BILLING_STATE_COOKIE_SECRET: "k".repeat(48) };
  let clockOffset = 0;
  const now = () => new Date(Date.now() + clockOffset);
  const blocked = [];
  const guarded = (owner, createdAt) => maybeGuardFetch({ env: ENV_ON, ownerId: owner, accountCreatedAt: createdAt, store, now, supabaseOrigin: URL_BASE, inner: fetch, onBlocked: ({ reason }) => blocked.push(reason) });
  const clientFor = (owner, fetchImpl) => createClient(URL_BASE, "clave-anon-de-prueba", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: `Bearer ${jwtFor(owner)}` }, ...(fetchImpl ? { fetch: fetchImpl } : {}) } });
  const student = (owner, id, name) => admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price) values ($1,$2,$3,'presencial','otro','por_clase','2026-01-01',1000)", [id, owner, name]);
  const [SE, SN, SX] = [uuidFor(9001), uuidFor(9002), uuidFor(9003)];
  await student(E, SE, "Alumno de E");
  await student(N, SN, "Alumno de N");
  await student(X, SX, "Alumno de X");

  const userE = clientFor(E, guarded(E, "2026-10-01T00:00:00Z"));
  const userN = clientFor(N, guarded(N, new Date().toISOString()));
  const mark = () => hits.length;
  const since = (from) => hits.slice(from);
  const gatewayWrites = (from) => since(from).filter((h) => /^(POST|PATCH|PUT|DELETE) \/(rest|storage)\//.test(h));

  // ============================================================================================== cuenta EXISTENTE
  await step("1. cuenta EXISTENTE (grandfathered): lee y ESCRIBE (tabla y función) con la guarda encendida; nada se bloquea", async () => {
    const before = blocked.length;
    const read = await userE.from("students").select("*");
    assert.equal(read.error, null);
    assert.deepEqual(read.data.map((row) => row.name), ["Alumno de E"], "RLS: sólo ve lo suyo");
    const patched = await userE.from("students").update({ name: "Alumno de E (editado)" }).eq("id", SE);
    assert.equal(patched.error, null, JSON.stringify(patched.error));
    const rpc = await userE.rpc("change_student_status", { p_student_id: SE, p_status: "pausado", p_occurred_on: "2026-11-01", p_reason: null, p_internal_note: null });
    assert.equal(rpc.error, null, JSON.stringify(rpc.error));
    assert.equal((await admin.query("select name, status from public.students where id = $1", [SE])).rows[0].name, "Alumno de E (editado)");
    assert.equal(blocked.length, before, "ninguna escritura bloqueada");
  });

  // ============================================================================================== cuenta NUEVA sin pago (limitada)
  await step("2. cuenta NUEVA sin pago (limitada): PUEDE leer y exportar sus datos (RLS aislado), pero NO escribir", async () => {
    const read = await userN.from("students").select("*");
    assert.equal(read.error, null);
    assert.deepEqual(read.data.map((row) => row.name), ["Alumno de N"]);
    const rpcRead = await userN.rpc("list_open_charge_balances", {});
    assert.equal(rpcRead.error, null, "una función de LECTURA expuesta como POST pasa");
  });

  await step("3. cuenta limitada: toda ESCRITURA de datos operativos se bloquea EN EL SERVIDOR (403 con el mensaje de modo limitado) y NO llega a la pasarela ni a la base", async () => {
    const from = mark();
    const attempts = [
      ["update", () => userN.from("students").update({ name: "HACKEADO" }).eq("id", SN)],
      ["insert", () => userN.from("students").insert({ id: uuidFor(9100), owner_id: N, name: "Nuevo", modality: "presencial", category: "otro", billing_type: "por_clase", date_joined: "2026-01-01", price: 1 })],
      ["delete", () => userN.from("students").delete().eq("id", SN)],
      ["rpc change_student_status", () => userN.rpc("change_student_status", { p_student_id: SN, p_status: "pausado", p_occurred_on: "2026-11-01", p_reason: null, p_internal_note: null })],
      ["rpc función nueva sin clasificar", () => userN.rpc("funcion_que_nadie_clasifico", {})],
      ["storage subir", () => userN.storage.from("lesson-files").upload("x/y.png", new Uint8Array([1, 2, 3]))],
    ];
    for (const [name, run] of attempts) {
      const result = await run();
      assert.ok(result.error, `${name}: debía fallar`);
      assert.equal(result.error.message, LIMITED_MODE_MESSAGE, `${name}: ${result.error.message}`);
    }
    assert.deepEqual(gatewayWrites(from), [], "ninguna escritura llegó a la pasarela");
    const row = (await admin.query("select name from public.students where id = $1", [SN])).rows[0];
    assert.equal(row.name, "Alumno de N", "la base quedó intacta");
    assert.equal((await admin.query("select count(*)::int n from public.students where owner_id = $1", [N])).rows[0].n, 1);
    assert.ok(blocked.length >= attempts.length);
  });

  await step("4. cuenta limitada: SÍ puede lo necesario para seguir (preferencias de uso, descargas firmadas, borrar archivos) y Facturación/cobro por el cliente de servicio", async () => {
    const from = mark();
    const prefs = await userN.from("teacher_interaction_preferences").insert({ owner_id: N, live_tracking: true });
    assert.equal(prefs.error, null, JSON.stringify(prefs.error));
    assert.equal((await userN.storage.from("lesson-files").createSignedUrl("x/y.png", 60)).error?.message ?? null, null);
    assert.equal((await userN.storage.from("lesson-files").remove(["x/y.png"])).error?.message ?? null, null);
    assert.ok(gatewayWrites(from).length >= 3, "esas escrituras SÍ llegaron");
    // Facturación (cliente de servicio, otro camino): iniciar un cobro funciona para una cuenta limitada.
    const checkout = await store.openCheckoutAttempt({ ownerId: N, plan: { code: "tf_monthly_ars_v2" }, provider: "rebill", idempotencyKey: "acceso-key-0001", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(checkout.ok, true, JSON.stringify(checkout));
  });

  await step("5. el estado de una cuenta no se mezcla con otra: la cuenta X (nueva) también está limitada, E sigue escribiendo", async () => {
    const userX = clientFor(X, guarded(X, new Date().toISOString()));
    assert.ok((await userX.from("students").update({ name: "no" }).eq("id", SX)).error);
    assert.equal((await userE.from("students").update({ name: "otra vez" }).eq("id", SE)).error, null);
  });

  // ============================================================================================== pagar: recupera el acceso
  await step("6. al PAGAR (período aprobado y conciliado) la cuenta limitada vuelve a escribir; la guarda decide por el estado real de la base", async () => {
    const userP = clientFor(P, guarded(P, new Date().toISOString()));
    const sp = uuidFor(9004);
    await student(P, sp, "Alumno de P");
    assert.ok((await userP.from("students").update({ name: "antes de pagar" }).eq("id", sp)).error, "sin pago: bloqueado");
    // Un pago APROBADO y su período (la base no admite un período sin un cobro que lo respalde), y recién entonces el estado de la cuenta.
    const paidAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await store.commitBatch({ executions: [{ ownerId: P, provider: "rebill", executionUid: "exe_acceso_p1", providerPaymentId: "pay_acceso_p1", outcome: "approved", planCode: "tf_monthly_ars_v2", amountMinor: 2590000, currency: "ARS", dueAt: paidAt, occurredAt: paidAt }], periods: [{ ownerId: P, provider: "rebill", executionUid: "exe_acceso_p1", planCode: "tf_monthly_ars_v2", priceVersion: 2, amountMinor: 2590000, currency: "ARS", periodStart: paidAt, periodEnd: endsAt }], subscriptions: [], reconciliations: [], events: [] });
    await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v2', grandfathered = false, current_period_start = $2, current_period_end = $3, grace_ends_at = $3::timestamptz + interval '5 days', version = version + 1 where owner_id = $1", [P, paidAt, endsAt]);
    clockOffset += ACCESS_CACHE_MS + 1_000; // pasa la ventana de caché de 10 s
    assert.equal((await userP.from("students").update({ name: "después de pagar" }).eq("id", sp)).error, null, "con el período pagado: escribe");
    assert.equal((await admin.query("select name from public.students where id = $1", [sp])).rows[0].name, "después de pagar");
    // y al terminar el período + la gracia vuelve a limitarse (reloj de la prueba)
    clockOffset += 60 * 24 * 3_600_000;
    assert.ok((await userP.from("students").update({ name: "vencida" }).eq("id", sp)).error, "terminado el período y la gracia: limitada otra vez");
  });

  // ============================================================================================== RUTAS QUE PODRÍAN ELUDIR EL fetch PROTEGIDO
  await step("7. cliente de SERVICIO (facturación): sólo funciones `billing_*`; un usuario autenticado NO puede ejecutarlas por el camino de la API", async () => {
    const stores = ["lib/billing/rpc-store.ts", "lib/billing/supabase-store.ts"].map((file) => readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8")).join("\n");
    const names = [...stores.matchAll(/this\.rpc\("([a-z_0-9]+)"/g)].map((match) => match[1]);
    assert.ok(names.length >= 15);
    assert.deepEqual(names.filter((name) => !name.startsWith("billing_")), [], "el cliente de servicio sólo llama a billing_*");
    const denied = await clientFor(N).rpc("billing_commit_batch", { p: { subscriptions: [] } });
    assert.ok(denied.error, "authenticated no puede ejecutar billing_commit_batch");
    assert.match(String(denied.error.message), /permission denied|denied/i);
    const ownDelete = await clientFor(N).rpc("billing_ensure_account", { p_owner: X });
    assert.ok(ownDelete.error, "tampoco billing_ensure_account sobre otra cuenta");
  });

  await step("8. clientes de servidor SIN contexto (guarda por JWT): la cuenta sale del Authorization de cada pedido; N queda bloqueada y E no", async () => {
    const byJwt = maybeGuardFetchByJwt({ env: ENV_ON, store, now, supabaseOrigin: URL_BASE, inner: fetch });
    const bareN = clientFor(N, byJwt);
    const bareE = clientFor(E, byJwt);
    const from = mark();
    assert.equal((await bareN.from("students").update({ name: "x" }).eq("id", SN)).error?.message, LIMITED_MODE_MESSAGE);
    assert.deepEqual(gatewayWrites(from), []);
    assert.equal((await bareE.from("students").update({ name: "E sin contexto" }).eq("id", SE)).error, null);
    assert.equal((await bareN.from("students").select("*")).error, null, "leer sigue permitido");
    // pedido anónimo (sin JWT de persona): la guarda no decide (RLS lo rechaza en la base).
    const anon = createClient(URL_BASE, "clave-anon-de-prueba", { auth: { persistSession: false }, global: { fetch: byJwt } });
    assert.equal((await anon.from("students").select("*")).error, null);
  });

  await step("9. LÍMITE REAL (documentado, no resuelto por la guarda): un cliente que NO pasa por la web (p. ej. la app móvil con el mismo JWT) escribe aunque la cuenta esté limitada — sólo la base podría impedirlo", async () => {
    const mobileLike = clientFor(N); // sin guarda: habla directo con la API
    const result = await mobileLike.from("students").update({ name: "escrito sin pasar por la web" }).eq("id", SN);
    assert.equal(result.error, null, "la base no distingue: el control vive en el servidor web");
    assert.equal((await admin.query("select name from public.students where id = $1", [SN])).rows[0].name, "escrito sin pasar por la web");
    console.log("        (esto es lo esperado HOY: el control de acceso protege la web; no hay una compuerta en la base)");
  });

  await step("10. con el interruptor APAGADO la guarda no existe: la cuenta nueva escribe como siempre (comportamiento actual)", async () => {
    const off = maybeGuardFetch({ env: { BILLING_ENABLED: "true" }, ownerId: N, accountCreatedAt: null, store, now, supabaseOrigin: URL_BASE });
    assert.equal(off, undefined);
    const plain = clientFor(N, off);
    assert.equal((await plain.from("students").update({ name: "sin control" }).eq("id", SN)).error, null);
  });

  await svcConn.end();
} finally {
  gateway?.close();
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\nCONTROL DE ACCESO (aislado): ${results.length}/${results.length} pasos ok` : `\nCONTROL DE ACCESO CON ${failed.length} FALLA(S) de ${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
