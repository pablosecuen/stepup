// M2 — Escala: 1.000 suscripciones activas con renovaciones concentradas en la MISMA hora y el MISMO día, 5.000 avisos NO CONFIABLES
// (duplicados, desordenados y de pagos desconocidos), reintentos concurrentes, conciliación paginada, SONDEO POR SUSCRIPTOR de 1.000
// suscriptores con avisos perdidos (3 trabajadores concurrentes), registro fiscal, recuperación tras una interrupción parcial
// y planes de consulta sin recorridos completos. Postgres REAL (embedded-postgres 17), varias conexiones simultáneas.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node --expose-gc supabase/tests/postgres/m2_billing_scale.mjs [--subs 1000] [--out docs/billing/m2-scale-metrics.json]
//
// Mide: tiempo, cantidad de consultas (por trabajador y por lote), memoria (pico del heap y RSS) y latencia de la recepción de avisos.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { importLib, makeRpcCaller, percentile, REPO, sleep, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
console.info = () => {};

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};
const SUBS = Number(arg("--subs", "1000"));
const OUT = arg("--out", null);
const EXTRA_EVENT_ROWS = Number(arg("--plan-rows", "60000"));

const plansLib = await importLib("billing/plans.ts");
const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { FakeProviderAdapter } = await importLib("billing/providers/fake.ts");
const { ingestNotice } = await importLib("billing/webhook-ingest.ts");
const { drainEvents, runClockSweep, runProviderSweep, runSubscriberPoll } = await importLib("billing/processor.ts");
const { localDateTimeToInstantIso } = await importLib("calendar/timezone.ts");

const ar = (date, hour = 0, minute = 0) => localDateTimeToInstantIso({ date, hour, minute, timeZone: "America/Argentina/Buenos_Aires" });
const MONTHLY = plansLib.getPlan("tf_monthly_ars_v1");
const ALLOW_ALL = { check: () => ({ allowed: true, retryAfterSeconds: 1 }) }; // el límite de frecuencia se prueba aparte (notice-ingest.test.ts)
const failures = [];
const metrics = { subs: SUBS };
const ok = (cond, message) => {
  if (!cond) failures.push(message);
  return cond;
};

function memorySampler() {
  let peakHeap = 0;
  let peakRss = 0;
  const sample = () => {
    const m = process.memoryUsage();
    peakHeap = Math.max(peakHeap, m.heapUsed);
    peakRss = Math.max(peakRss, m.rss);
  };
  const timer = setInterval(sample, 25);
  sample();
  return {
    stop: () => {
      clearInterval(timer);
      sample();
      return { peakHeapMB: Math.round(peakHeap / 1048576), peakRssMB: Math.round(peakRss / 1048576) };
    },
  };
}

const port = 7100 + Math.floor(Math.random() * 400);
const pg = await start({ port });
const admin = pg.admin;
if (pg.failures.length) throw new Error(`migraciones con error: ${JSON.stringify(pg.failures)}`);

// ----------------------------------------------------------------------------------------------------------- datos
console.log(`Creando ${SUBS} cuentas activas (todas con el período anterior vencido el 1/11 a las 00:00)…`);
const setupStarted = performance.now();
const ownerExpr = "('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid";
await admin.query(`insert into auth.users (id, email, created_at) select ${ownerExpr}, 'scale' || g || '@example.test', now() - interval '1 day' from generate_series(1, $1) g`, [SUBS]);
await admin.query(`insert into public.billing_subscriptions (owner_id, status, grandfathered, provider_reference, provider_subscriber_uid, provider_plan_code) select ${ownerExpr}, 'pending', false, 'tfs_' || md5(g::text), 'sub_' || g, 'tf_monthly_ars_v1' from generate_series(1, $1) g`, [SUBS]);
await admin.query(`insert into public.billing_executions (owner_id, provider, execution_uid, provider_payment_id, outcome, plan_code, amount_minor, currency, due_at, occurred_at) select ${ownerExpr}, 'fake', 'prev_' || g, 'prevpay_' || g, 'approved', 'tf_monthly_ars_v1', 2490000, 'ARS', $2::timestamptz, $2::timestamptz + interval '5 minutes' from generate_series(1, $1) g`, [SUBS, ar("2026-10-01", 10)]);
await admin.query(`insert into public.billing_periods (owner_id, provider, execution_uid, plan_code, price_version, amount_minor, currency, period_start, period_end) select ${ownerExpr}, 'fake', 'prev_' || g, 'tf_monthly_ars_v1', 1, 2490000, 'ARS', $2::timestamptz, $3::timestamptz from generate_series(1, $1) g`, [SUBS, ar("2026-10-01"), ar("2026-11-01")]);
await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v1', current_period_start = $1, current_period_end = $2, next_check_at = $2, version = version + 1", [ar("2026-10-01"), ar("2026-11-01")]);
metrics.setupMs = Math.round(performance.now() - setupStarted);

const ref = (g) => `tfs_${crypto.createHash("md5").update(String(g)).digest("hex")}`;
const owner = (g) => uuidFor(g);
const provider = new FakeProviderAdapter();

async function newStore() {
  const client = await pg.session("", "service_role");
  const caller = await makeRpcCaller(client);
  return { store: new RpcBillingStore(caller), counter: caller.counter, client };
}

const op = (g, wave, over = {}) => {
  const due = wave.due;
  return {
    providerPaymentId: `${wave.key}_pay_${g}`,
    executionUid: `${wave.key}_exe_${g}`,
    subscriberUid: `sub_${g}`,
    subscriberReference: ref(g),
    planReference: "tf_monthly_ars_v1",
    outcome: "approved",
    statusCode: "300",
    amountMinor: MONTHLY.amountMinor,
    currency: "ARS",
    dueAt: ar(due, 10),
    occurredAt: ar(due, 12),
    livemode: true,
    ...over,
  };
};

const body = (o) =>
  JSON.stringify({
    type: "subscription:execution",
    data: {
      payment: { id: o.providerPaymentId, status: { code: o.statusCode }, total: Number(o.amountMinor ?? 0) / 100, currency: { code: o.currency ?? "ARS" }, created: o.dueAt, updated: o.occurredAt },
      subscription: { uid: "T1", reference: o.planReference },
      subscriber: { uid: o.subscriberUid, reference: o.subscriberReference },
      execution: { uid: o.executionUid, date: o.dueAt, total: Number(o.amountMinor ?? 0) / 100, currency: o.currency ?? "ARS", test: false },
    },
  });

function shuffle(items, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function ingestAll(deliveries, concurrency) {
  const pool = await Promise.all(Array.from({ length: concurrency }, () => newStore()));
  const latencies = [];
  const statuses = {};
  let cursor = 0;
  const started = performance.now();
  await Promise.all(
    pool.map(async ({ store }) => {
      while (cursor < deliveries.length) {
        const mine = deliveries[cursor];
        cursor += 1;
        const t0 = performance.now();
        const response = await ingestNotice({ adapter: provider, store, flags: { enabled: true, enforcement: false }, now: () => new Date(ar("2026-11-01", 12, 30)), limiter: ALLOW_ALL }, { method: "POST", contentType: "application/json", declaredLength: Buffer.byteLength(mine), readBody: async () => mine, clientKey: "scale" });
        latencies.push(performance.now() - t0);
        statuses[response.status] = (statuses[response.status] ?? 0) + 1;
      }
    }),
  );
  const elapsed = performance.now() - started;
  await Promise.all(pool.map(({ client }) => client.end()));
  return { elapsedMs: Math.round(elapsed), deliveries: deliveries.length, statuses, p50: +percentile(latencies, 50).toFixed(2), p95: +percentile(latencies, 95).toFixed(2), max: +Math.max(...latencies).toFixed(2), perSecond: Math.round((deliveries.length / elapsed) * 1000) };
}

const stateCounts = async (table, column) => Object.fromEntries((await admin.query(`select ${column} k, count(*)::int n from public.${table} group by 1 order by 1`)).rows.map((r) => [r.k, r.n]));

async function runWorkers(count, deps, label) {
  const workers = await Promise.all(Array.from({ length: count }, () => newStore()));
  const mem = memorySampler();
  if (global.gc) global.gc();
  const started = performance.now();
  const stats = await Promise.all(workers.map((w, index) => drainEvents({ ...deps, store: w.store, worker: `${label}-${index}`, batchSize: 500 }, 40)));
  const elapsed = performance.now() - started;
  const memory = mem.stop();
  const queries = workers.reduce((n, w) => n + w.counter.queries, 0);
  const byName = {};
  for (const w of workers) for (const [name, n] of Object.entries(w.counter.byName)) byName[name] = (byName[name] ?? 0) + n;
  await Promise.all(workers.map((w) => w.client.end()));
  const total = stats.reduce((acc, s) => ({ claimed: acc.claimed + s.claimed, facts: acc.facts + s.facts, anomalies: acc.anomalies + s.anomalies, ignored: acc.ignored + s.ignored, retried: acc.retried + s.retried, dead: acc.dead + s.dead, conflicts: acc.conflicts + s.conflicts, providerCalls: acc.providerCalls + s.providerCalls, subscriptionsWritten: acc.subscriptionsWritten + s.subscriptionsWritten }), { claimed: 0, facts: 0, anomalies: 0, ignored: 0, retried: 0, dead: 0, conflicts: 0, providerCalls: 0, subscriptionsWritten: 0 });
  return { elapsedMs: Math.round(elapsed), queries, queriesByFunction: byName, workers: count, ...total, ...memory };
}

const baseDeps = { provider, now: () => new Date(ar("2026-11-01", 12, 30)), expectLive: true };

// ------------------------------------------------------------------------------- Fase A: recepción de 5.000 avisos
const wave1 = { key: "w1", due: "2026-11-01" };
const nRenewals = SUBS;
const deliveries = [];
for (let g = 1; g <= nRenewals; g += 1) {
  const latest = op(g, wave1);
  provider.seedOperation(latest); // el proveedor sabe el estado FINAL (liquidado, 300)
  const approvedEarly = body({ ...latest, statusCode: "200", occurredAt: ar("2026-11-01", 10, 5) });
  deliveries.push(approvedEarly, approvedEarly, approvedEarly); // 3 entregas idénticas → 1 aviso
  deliveries.push(body(latest)); // la liquidación posterior (otro aviso del mismo cobro)
  if (g <= Math.floor(nRenewals / 2)) deliveries.push(body({ ...latest, outcome: "rejected", statusCode: "410", occurredAt: ar("2026-11-01", 9) })); // un rechazo VIEJO que llega tarde
}
const unknownCount = SUBS * 5 - deliveries.length; // 5 avisos por cuenta en total (5.000 con 1.000 cuentas)
for (let u = 0; u < unknownCount; u += 1) {
  const g = (u % SUBS) + 1;
  deliveries.push(body(op(g, { key: `ghost${u}`, due: "2026-11-01" }))); // pagos que el proveedor NO conoce (aviso auténtico, pago inexistente)
}
const shuffled = shuffle(deliveries, 20261014);
metrics.deliveries = shuffled.length;
console.log(`Recibiendo ${shuffled.length} avisos (${SUBS * 2} duplicados exactos, desordenados) con 20 conexiones simultáneas…`);
metrics.ingest = await ingestAll(shuffled, 20);
const events = await admin.query("select count(*)::int n from public.billing_webhook_events");
metrics.storedEvents = events.rows[0].n;
console.log("  recepción:", JSON.stringify(metrics.ingest), "avisos guardados:", metrics.storedEvents);
ok(metrics.ingest.statuses[200] === shuffled.length, "todas las recepciones respondieron 200");
ok(metrics.ingest.p95 < 250, `p95 de recepción ${metrics.ingest.p95} ms < 250 ms`);
// La clave de un aviso es la pista (tipo + pago + ejecución + suscriptor), NO el estado ni la fecha: todos los avisos del mismo cobro son UN aviso.
const expectedUnique = nRenewals + unknownCount;
ok(metrics.storedEvents === expectedUnique, `avisos únicos esperados ${expectedUnique}, guardados ${metrics.storedEvents}`);

// ------------------------------------------------------------------------------- Fase B: procesamiento concurrente
console.log("Procesando con 4 trabajadores concurrentes (lotes de 500)…");
metrics.process = await runWorkers(4, baseDeps, "pw");
console.log("  procesamiento:", JSON.stringify(metrics.process));
const evStates = await stateCounts("billing_webhook_events", "status");
metrics.eventStates = evStates;
ok(!evStates.received && !evStates.processing && !evStates.failed && !evStates.dead, `ningún aviso colgado: ${JSON.stringify(evStates)}`);
ok((evStates.processed ?? 0) + (evStates.ignored ?? 0) === metrics.storedEvents, "cada aviso está en un estado terminal (ninguno perdido)");
const subStates = await stateCounts("billing_subscriptions", "status");
ok(subStates.active === SUBS && Object.keys(subStates).length === 1, `las ${SUBS} cuentas siguen activas: ${JSON.stringify(subStates)}`);
const periodsPerOwner = (await admin.query("select count(*)::int c, count(*) filter (where owner_id is null)::int z from (select owner_id, count(*) c from public.billing_periods group by owner_id) t")).rows[0];
const dupPeriods = (await admin.query("select count(*)::int n from (select owner_id, period_start from public.billing_periods group by 1, 2 having count(*) > 1) t")).rows[0].n;
const perOwnerCounts = (await admin.query("select c, count(*)::int owners from (select owner_id, count(*) c from public.billing_periods group by owner_id) t group by c")).rows;
ok(perOwnerCounts.length === 1 && Number(perOwnerCounts[0].c) === 2 && Number(perOwnerCounts[0].owners) === SUBS, `cada cuenta tiene exactamente 2 períodos (anterior + renovación): ${JSON.stringify(perOwnerCounts)}`);
ok(dupPeriods === 0, "ningún período duplicado");
const endOk = (await admin.query("select count(*)::int n from public.billing_subscriptions where current_period_end = $1 and plan_code = 'tf_monthly_ars_v1'", [ar("2026-12-01")])).rows[0].n;
ok(endOk === SUBS, `las ${SUBS} cuentas renovaron hasta el 1/12 (activadas UNA vez): ${endOk}`);
ok((await admin.query("select count(*)::int n from public.billing_executions where execution_uid like 'w1_exe_%'")).rows[0].n === SUBS, "una ejecución por renovación");
const anomalies = (await admin.query("select kind, count(*)::int n from public.billing_reconciliations where status = 'open' group by 1")).rows;
metrics.anomalies = anomalies;
ok(anomalies.length === 1 && anomalies[0].kind === "unknown_reference" && anomalies[0].n === unknownCount, `las ${unknownCount} operaciones desconocidas quedaron como anomalías (una por pago): ${JSON.stringify(anomalies)}`);
const batches = Math.ceil(metrics.storedEvents / 500);
metrics.process.batchesApprox = batches;
const commits = metrics.process.queriesByFunction.billing_commit_batch ?? 0;
ok(metrics.process.queries <= commits * 5 + metrics.process.workers * 2 + 2, `CINCO consultas por lote (reclamar, resolver propietarias, leer cuentas, leer cobros, escribir), ninguna por suscripción: ${metrics.process.queries} consultas para ${commits} lotes y ${metrics.storedEvents} avisos`);
if (SUBS >= 1000) ok(metrics.process.queries < metrics.storedEvents * 0.05, `menos de una consulta cada 20 avisos (${metrics.process.queries} / ${metrics.storedEvents})`);
ok(metrics.process.peakHeapMB < 400, `memoria acotada (pico del heap ${metrics.process.peakHeapMB} MB)`);
ok(metrics.process.providerCalls <= metrics.storedEvents * 1.5, `el proveedor se consulta como máximo una vez por pago distinto y LOTE (${metrics.process.providerCalls} consultas para ${metrics.storedEvents} avisos de ${SUBS + unknownCount} pagos distintos)`);

// ------------------------------------------------------------------------------- Fase C: interrupción parcial
console.log("Segunda ola (1/12) con un trabajador que MUERE a mitad de camino…");
const wave2 = { key: "w2", due: "2026-12-01" };
const wave2Deliveries = [];
for (let g = 1; g <= SUBS; g += 1) {
  const latest = op(g, wave2);
  provider.seedOperation(latest);
  wave2Deliveries.push(body(latest));
}
await ingestAll(shuffle(wave2Deliveries, 99), 20);
const dying = await newStore();
const claimedByDying = await dying.store.claimEvents({ limit: Math.floor(SUBS / 2), leaseSeconds: 60, worker: "dying", maxAttempts: 8 });
const survivors = await runWorkers(2, { ...baseDeps, now: () => new Date(ar("2026-12-01", 12, 30)) }, "sv");
const stuck = (await admin.query("select count(*)::int n from public.billing_webhook_events where status = 'processing'")).rows[0].n;
ok(stuck === claimedByDying.length, `los avisos del trabajador muerto siguen en proceso (${stuck}) mientras su arrendamiento vive`);
await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 second' where locked_by = 'dying'");
const recovered = await runWorkers(2, { ...baseDeps, now: () => new Date(ar("2026-12-01", 12, 30)) }, "rc");
metrics.interruption = { claimedByDyingWorker: claimedByDying.length, survivors: { facts: survivors.facts, elapsedMs: survivors.elapsedMs }, recovered: { claimed: recovered.claimed, facts: recovered.facts, elapsedMs: recovered.elapsedMs } };
console.log("  interrupción:", JSON.stringify(metrics.interruption));
const wave2States = (await admin.query("select status, count(*)::int n from public.billing_webhook_events where normalized->>'providerPaymentId' like 'w2_pay_%' group by 1")).rows;
ok(wave2States.length === 1 && wave2States[0].status === "processed" && wave2States[0].n === SUBS, `todos los avisos de la segunda ola procesados: ${JSON.stringify(wave2States)}`);
const perOwner3 = (await admin.query("select c, count(*)::int owners from (select owner_id, count(*) c from public.billing_periods group by owner_id) t group by c")).rows;
ok(perOwner3.length === 1 && Number(perOwner3[0].c) === 3, `cada cuenta tiene exactamente 3 períodos (sin doble activación tras la interrupción): ${JSON.stringify(perOwner3)}`);
ok((await admin.query("select count(*)::int n from public.billing_subscriptions where current_period_end = $1 and status = 'active'", [ar("2027-01-01")])).rows[0].n === SUBS, "todas renovadas hasta el 1/1");
await dying.client.end();

// ------------------------------------------------------------------------------- Fase D: conciliación periódica paginada
console.log("Conciliación periódica: 1.000 cobros cuyos avisos NUNCA llegaron, por barrido paginado (50 por página)…");
const wave3 = { key: "w3", due: "2027-01-01" };
for (let g = 1; g <= SUBS; g += 1) provider.seedOperation(op(g, wave3, { occurredAt: ar("2027-01-01", 11, 0) }));
const sweepWorker = await newStore();
const sweepMem = memorySampler();
const sweepStarted = performance.now();
const sweepStats = await runProviderSweep({ ...baseDeps, store: sweepWorker.store, now: () => new Date(ar("2027-01-01", 12, 30)), worker: "sweep" });
metrics.providerSweep = { ...sweepStats, elapsedMs: Math.round(performance.now() - sweepStarted), queries: sweepWorker.counter.queries, ...sweepMem.stop() };
console.log("  barrido:", JSON.stringify(metrics.providerSweep));
ok(sweepStats.pages === Math.ceil(SUBS / 50), `${Math.ceil(SUBS / 50)} páginas de 50 (${sweepStats.pages})`);
ok(sweepStats.facts === SUBS, `los ${SUBS} cobros se recuperaron sin avisos (${sweepStats.facts})`);
ok(sweepWorker.counter.queries <= 4 * Math.ceil(SUBS / 500) + 4, `el barrido usa consultas por LOTE de 500 cuentas, no por cuenta (${sweepWorker.counter.queries})`);
ok((await admin.query("select count(*)::int n from public.billing_subscriptions where current_period_end = $1 and status = 'active'", [ar("2027-02-01")])).rows[0].n === SUBS, "todas renovadas hasta el 1/2 por el barrido");
const again = await runProviderSweep({ ...baseDeps, store: sweepWorker.store, now: () => new Date(ar("2027-01-01", 13, 0)), worker: "sweep" });
ok((await admin.query("select count(*)::int n from (select owner_id from public.billing_periods group by owner_id having count(*) <> 4) t")).rows[0].n === 0, `repetir el barrido no duplica períodos (4 por cuenta; segundo barrido: ${JSON.stringify(again)})`);
await sweepWorker.client.end();

// ------------------------------------------------------------------------------- Fase E: reloj (vencimiento y gracia)
console.log("Barrido del reloj: todas vencen el mismo día (1/2) y la gracia termina el 7/2…");
const clock = await newStore();
const clockMem = memorySampler();
let t0 = performance.now();
const s1 = await runClockSweep({ ...baseDeps, store: clock.store, now: () => new Date(ar("2027-02-02", 9, 0)) }, { pageSize: 500 });
const clockQ1 = clock.counter.queries;
const s2 = await runClockSweep({ ...baseDeps, store: clock.store, now: () => new Date(ar("2027-02-08", 9, 0)) }, { pageSize: 500 });
const s3 = await runClockSweep({ ...baseDeps, store: clock.store, now: () => new Date(ar("2027-02-08", 9, 5)) }, { pageSize: 500 });
metrics.clockSweep = { pastDue: s1, limited: s2, repeat: s3, elapsedMs: Math.round(performance.now() - t0), queries: clock.counter.queries, ...clockMem.stop() };
console.log("  reloj:", JSON.stringify(metrics.clockSweep));
const after = await stateCounts("billing_subscriptions", "status");
ok(after.limited === SUBS && Object.keys(after).length === 1, `tras la gracia las ${SUBS} cuentas están limitadas: ${JSON.stringify(after)}`);
ok(s1.evaluated === SUBS && s1.pages === Math.ceil(SUBS / 500), `primera pasada: ${s1.evaluated} evaluadas en ${s1.pages} páginas`);
ok(s3.evaluated === 0, "tras limitarse ninguna cuenta vuelve a evaluarse (next_check_at = null)");
ok(clockQ1 <= 4 * Math.ceil(SUBS / 500) + 2, `consultas del barrido por PÁGINA, no por cuenta (${clockQ1})`);
await clock.client.end();
ok((await admin.query("select count(*)::int n from public.billing_subscriptions where next_check_at is not null")).rows[0].n === 0, "ninguna cuenta limitada queda con revisión pendiente");

// ------------------------------------------------------------------------------- Fase G: SONDEO POR SUSCRIPTOR (avisos perdidos)
console.log("Sondeo por suscriptor: 1.000 cobros cuyos avisos NUNCA llegaron (las cuentas estaban limitadas), con 3 trabajadores concurrentes…");
const wave4 = { key: "w4", due: "2027-02-09" };
for (let g = 1; g <= SUBS; g += 1) {
  provider.seedSubscriber(`sub_${g}`, { status: "active" });
  provider.seedOperation(op(g, wave4, { occurredAt: ar("2027-02-09", 10, 5), dueAt: ar("2027-02-09", 10) }));
}
await admin.query("delete from public.billing_poll_schedule");
await admin.query(`insert into public.billing_poll_schedule (owner_id, due_at) select ${ownerExpr}, now() - interval '1 minute' from generate_series(1, $1) g`, [SUBS]);
const pollers = await Promise.all(Array.from({ length: 3 }, () => newStore()));
const pollNow = () => new Date(ar("2027-02-10", 12, 30));
const pollMem = memorySampler();
if (global.gc) global.gc();
const callsBefore = provider.calls.getSubscriber;
const pollStarted = performance.now();
const pollStats = await Promise.all(pollers.map((w, index) => runSubscriberPoll({ ...baseDeps, store: w.store, now: pollNow, worker: `poll-${index}` }, { limit: 200, maxBatches: 20 })));
const pollElapsed = performance.now() - pollStarted;
const pollQueries = pollers.reduce((n, w) => n + w.counter.queries, 0);
const pollByName = {};
for (const w of pollers) for (const [name, n] of Object.entries(w.counter.byName)) pollByName[name] = (pollByName[name] ?? 0) + n;
const polledTotal = pollStats.reduce((n, st) => n + st.polled, 0);
const factsTotal = pollStats.reduce((n, st) => n + st.facts, 0);
const claimedTotal = pollStats.reduce((n, st) => n + st.claimed, 0);
const batchesTotal = pollStats.reduce((n, st) => n + st.batches, 0);
metrics.poll = { workers: 3, claimed: claimedTotal, polled: polledTotal, providerCalls: provider.calls.getSubscriber - callsBefore, batches: batchesTotal, queries: pollQueries, queriesByFunction: pollByName, elapsedMs: Math.round(pollElapsed), subscriptionsWritten: pollStats.reduce((n, st) => n + st.subscriptionsWritten, 0), conflicts: pollStats.reduce((n, st) => n + st.conflicts, 0), ...pollMem.stop() };
console.log("  sondeo:", JSON.stringify(metrics.poll));
ok(polledTotal === SUBS && claimedTotal === SUBS, `cada suscriptor se sondea EXACTAMENTE una vez (reclamados ${claimedTotal}, sondeados ${polledTotal})`);
ok(metrics.poll.providerCalls === SUBS, `una consulta al proveedor por suscriptor (${metrics.poll.providerCalls}) — es la llamada EXTERNA, no una consulta a la base`);
ok(factsTotal >= SUBS, `el sondeo concilió los cobros de cada suscriptor (${factsTotal} hechos: los repetidos son idempotentes)`);
ok((await admin.query("select count(*)::int n from public.billing_executions where execution_uid like 'w4_exe_%'")).rows[0].n === SUBS, `los ${SUBS} cobros PERDIDOS (sin aviso) se recuperaron: exactamente uno por cuenta`);
const afterPoll = await stateCounts("billing_subscriptions", "status");
ok(afterPoll.active === SUBS && Object.keys(afterPoll).length === 1, `tras el sondeo las ${SUBS} cuentas vuelven a estar activas: ${JSON.stringify(afterPoll)}`);
ok((await admin.query("select count(*)::int n from (select owner_id from public.billing_periods group by owner_id having count(*) <> 5) t")).rows[0].n === 0, "5 períodos por cuenta, ninguno duplicado");
ok(pollQueries <= (5 * batchesTotal) + 10, `CERO consultas por suscriptor: ${pollQueries} consultas a la base para ${SUBS} suscriptores en ${batchesTotal} lotes (reclamar, cuentas, cobros, escribir, reprogramar)`);
ok(pollQueries < SUBS / 10, `menos de una consulta a la base cada 10 suscriptores (${pollQueries})`);
ok((await admin.query("select count(*)::int n from public.billing_poll_schedule where due_at <= now()")).rows[0].n === 0, "todos quedan reprogramados hacia adelante");
const ownerOne = (await admin.query("select due_at from public.billing_poll_schedule limit 1")).rows[0];
ok(new Date(ownerOne.due_at) > new Date(ar("2027-02-10")), "la próxima consulta es futura");
ok(metrics.poll.peakHeapMB < 400, `memoria acotada en el sondeo (${metrics.poll.peakHeapMB} MB)`);
// Repetirlo no hace nada.
const repeat = await runSubscriberPoll({ ...baseDeps, store: pollers[0].store, now: pollNow, worker: "poll-again" }, { limit: 200, maxBatches: 20 });
ok(repeat.claimed === 0, "una segunda corrida inmediata no encuentra nada vencido");
await Promise.all(pollers.map((w) => w.client.end()));

// ------------------------------------------------------------------------------- Fase H: registro fiscal
const fiscal = (await admin.query("select count(*)::int n, count(distinct (provider, operation_ref))::int u from public.billing_fiscal_records")).rows[0];
metrics.fiscal = fiscal;
ok(fiscal.n === fiscal.u && fiscal.n === SUBS * 5, `un registro fiscal por cobro aprobado (5 por cuenta = ${SUBS * 5}), sin duplicados: ${JSON.stringify(fiscal)}`);
ok((await admin.query("select count(*)::int n from public.billing_fiscal_records where owner_hash !~ '^[0-9a-f]{64}$'")).rows[0].n === 0, "todas con huella seudonimizada");

// ------------------------------------------------------------------------------- Fase F: planes de consulta
console.log(`Planes de consulta con ${EXTRA_EVENT_ROWS.toLocaleString("es-AR")} avisos en la tabla…`);
await admin.query(
  `insert into public.billing_webhook_events (dedup_key, provider, event_type, payload_hash, normalized, status, attempts, next_attempt_at, processed_at, purge_after)
   select md5('plan-a-' || g) || md5('plan-b-' || g), 'fake', 'other', md5('h' || g) || md5('h2' || g), '{}'::jsonb,
          case when g % 40 = 0 then 'received' when g % 97 = 0 then 'failed' else 'processed' end,
          0, now() - (g % 1000 || ' seconds')::interval, now(), now() + interval '60 days'
     from generate_series(1, $1) g`,
  [EXTRA_EVENT_ROWS],
);
await admin.query("analyze public.billing_webhook_events");
await admin.query("analyze public.billing_subscriptions");
await admin.query("analyze public.billing_executions");
const svc = await newStore();
await sleep(1600);
const statsBefore = (await admin.query("select relname, seq_scan, idx_scan from pg_stat_user_tables where relname in ('billing_webhook_events','billing_subscriptions','billing_executions')")).rows;
await svc.store.claimEvents({ limit: 500, leaseSeconds: 60, worker: "plan", maxAttempts: 8 });
await svc.store.dueSubscriptions({ nowIso: ar("2030-01-01"), after: null, limit: 500 });
await svc.store.loadExecutions(Array.from({ length: 500 }, (_, i) => owner(i + 1)), 24);
await svc.store.resolveSubscribers({ references: Array.from({ length: 500 }, (_, i) => ref(i + 1)), uids: Array.from({ length: 500 }, (_, i) => `sub_${i + 1}`) });
await svc.store.loadSubscriptions(Array.from({ length: 500 }, (_, i) => owner(i + 1)));
await admin.query("update public.billing_webhook_events set locked_until = now() - interval '1 minute' where locked_by = 'plan'");
await svc.store.claimEvents({ limit: 500, leaseSeconds: 60, worker: "plan2", maxAttempts: 8 });
await svc.store.purgeRetention({ limit: 1000 });
await sleep(1600);
const statsAfter = (await admin.query("select relname, seq_scan, idx_scan from pg_stat_user_tables where relname in ('billing_webhook_events','billing_subscriptions','billing_executions')")).rows;
const delta = {};
for (const row of statsAfter) {
  const prev = statsBefore.find((r) => r.relname === row.relname);
  delta[row.relname] = { seqScans: Number(row.seq_scan) - Number(prev.seq_scan), indexScans: Number(row.idx_scan) - Number(prev.idx_scan) };
}
metrics.queryPlans = { tableRowsEvents: EXTRA_EVENT_ROWS + metrics.storedEvents, scanDelta: delta };
console.log("  recorridos por tabla (reclamo, vencimientos, cobros por cuenta, resolución de suscriptores, retención):", JSON.stringify(delta));
if (EXTRA_EVENT_ROWS >= 50000) ok(delta.billing_webhook_events.seqScans === 0, `reclamo, recuperación de arrendamientos y retención NO recorren la tabla de avisos completa (${delta.billing_webhook_events.seqScans} recorridos completos)`);
const plan = async (sql) => JSON.stringify((await admin.query(`explain (format json) ${sql}`)).rows[0]["QUERY PLAN"]);
const claimPlan = await plan("select id from public.billing_webhook_events where status in ('received','failed') and next_attempt_at <= now() order by next_attempt_at, id limit 500");
const leasePlan = await plan("update public.billing_webhook_events set attempts = attempts where status = 'processing' and locked_until < now()");
const duePlan = await plan("select * from public.billing_subscriptions where next_check_at is not null and next_check_at <= now() and (next_check_at, owner_id) > (now() - interval '1 day', '00000000-0000-4000-8000-000000000001') order by next_check_at, owner_id limit 500");
const execPlan = await plan("select * from public.billing_executions where owner_id = '00000000-0000-4000-8000-000000000001' order by due_at desc, execution_uid limit 24");
metrics.queryPlans.indexes = {
  claim: /billing_webhook_events_claim_idx/.test(claimPlan),
  lease: /billing_webhook_events_lease_idx/.test(leasePlan),
  due: /billing_subscriptions_next_check_idx/.test(duePlan),
  executions: /billing_executions_owner_due_idx/.test(execPlan),
};
ok(metrics.queryPlans.indexes.claim, "plan del reclamo: usa billing_webhook_events_claim_idx");
ok(metrics.queryPlans.indexes.lease, "plan de la recuperación de arrendamientos: usa billing_webhook_events_lease_idx");
ok(metrics.queryPlans.indexes.due, "plan del barrido del reloj: usa billing_subscriptions_next_check_idx");
ok(metrics.queryPlans.indexes.executions, "plan de cobros por cuenta: usa billing_executions_owner_due_idx");
const pollPlan = await plan("select ps.owner_id from public.billing_poll_schedule ps where ps.due_at <= now() order by ps.due_at, ps.owner_id limit 200");
const dedupPlan = await plan("select 1 from public.billing_webhook_events e where e.dedup_key = repeat('a', 64) and (e.status in ('received','processing','failed') or e.received_at > now() - interval '60 seconds')");
const fiscalPlan = await plan("select f.id from public.billing_fiscal_records f where f.retain_until < current_date order by f.retain_until limit 100");
metrics.queryPlans.indexes.poll = /billing_poll_schedule_due_idx/.test(pollPlan);
metrics.queryPlans.indexes.dedup = /billing_webhook_events_(open_dedup|dedup_recent)_idx/.test(dedupPlan);
metrics.queryPlans.indexes.fiscal = /billing_fiscal_records_retain_idx/.test(fiscalPlan);
ok(metrics.queryPlans.indexes.poll, "plan del reclamo de sondeos: usa billing_poll_schedule_due_idx");
ok(metrics.queryPlans.indexes.dedup, "plan de la deduplicación de avisos: usa un índice de dedup_key (no recorre la tabla)");
ok(metrics.queryPlans.indexes.fiscal, "plan de la purga fiscal: usa billing_fiscal_records_retain_idx");
await svc.client.end();

// ------------------------------------------------------------------------------- Resumen
metrics.failures = failures;
metrics.passed = failures.length === 0;
await pg.stop();
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(REPO, OUT)), { recursive: true });
  fs.writeFileSync(path.resolve(REPO, OUT), JSON.stringify(metrics, null, 2));
}
console.log("\n" + (failures.length === 0 ? "✔ ESCALA: todas las comprobaciones pasan" : `✖ ESCALA: ${failures.length} fallida(s)`));
for (const failure of failures) console.log("  ✖", failure);
console.log(JSON.stringify(metrics, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
