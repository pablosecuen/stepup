// BASE LOCAL AISLADA para ejercitar la WEB REAL (Next) con el control de acceso ENCENDIDO, sin tocar Production.
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/local_stack.mjs
//
// Levanta Postgres 17 real (todas las migraciones), la pasarela local (supabase/tests/postgres/postgrest_gateway.mjs) en http://127.0.0.1:54321, siembra tres cuentas sintéticas
// y queda esperando (Ctrl+C para cerrar). NO es Supabase: no hay Docker ni un proyecto de prueba. Datos 100 % sintéticos; sin red.
//
//   existente@example.test  cuenta ANTERIOR al corte  → grandfathered (acceso completo)
//   nueva@example.test      cuenta nueva sin pago      → limitada
//   paga@example.test       cuenta nueva con cobro aprobado y período vigente → acceso completo
//   clave de las tres: ver LOCAL_PASSWORD
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";
import { createGateway, issueJwt } from "./postgrest_gateway.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
console.info = () => {};
console.warn = () => {};
console.error = () => {};

export const LOCAL_PASSWORD = "Local-Prueba-1!";
const PORT = Number(process.env.LOCAL_STACK_PORT ?? 54321);
const pg = await start({ port: 5871 + Math.floor(Math.random() * 300) });
if (pg.failures.length) throw new Error(`migraciones: ${JSON.stringify(pg.failures)}`);
const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const admin = pg.admin;
const svcConn = await pg.session("", "service_role");
const store = new RpcBillingStore(await makeRpcCaller(svcConn));

const [E, N, P] = [1, 2, 3].map((n) => uuidFor(7000 + n));
const people = [
  { id: E, email: "existente@example.test", createdSql: "now() - interval '30 days'", createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString() },
  { id: N, email: "nueva@example.test", createdSql: "now()", createdAt: new Date().toISOString() },
  { id: P, email: "paga@example.test", createdSql: "now()", createdAt: new Date().toISOString() },
];
const users = new Map();
for (const person of people) {
  await admin.query(`insert into auth.users (id, email, created_at) values ($1, $2, ${person.createdSql})`, [person.id, person.email]);
  await store.ensureAccount(person.id);
  users.set(person.email, { ...person, password: LOCAL_PASSWORD });
  await admin.query("insert into public.teacher_profiles (owner_id, display_name) values ($1, $2) on conflict do nothing", [person.id, person.email.split("@")[0]]).catch(() => {});
  for (const [i, name] of ["Ana Prueba", "Beto Prueba"].entries()) {
    await admin.query("insert into public.students(id,owner_id,name,modality,category,billing_type,date_joined,price) values ($1,$2,$3,'presencial','otro','por_clase','2026-01-01',1000)", [uuidFor(8000 + people.indexOf(person) * 10 + i), person.id, `${name} (${person.email.split("@")[0]})`]);
  }
}
// Cuenta que pagó: un cobro aprobado y su período (la base no admite un período sin cobro) y luego el estado.
const paidAt = new Date().toISOString();
const endsAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
await store.commitBatch({ executions: [{ ownerId: P, provider: "rebill", executionUid: "exe_local_p1", providerPaymentId: "pay_local_p1", outcome: "approved", planCode: "tf_monthly_ars_v2", amountMinor: 2590000, currency: "ARS", dueAt: paidAt, occurredAt: paidAt }], periods: [{ ownerId: P, provider: "rebill", executionUid: "exe_local_p1", planCode: "tf_monthly_ars_v2", priceVersion: 2, amountMinor: 2590000, currency: "ARS", periodStart: paidAt, periodEnd: endsAt }], subscriptions: [], reconciliations: [], events: [] });
await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v2', grandfathered = false, current_period_start = $2, current_period_end = $3, grace_ends_at = $3::timestamptz + interval '5 days', version = version + 1 where owner_id = $1", [P, paidAt, endsAt]);
const cutoff = (await admin.query("select grandfather_cutoff from public.billing_settings")).rows[0].grandfather_cutoff.toISOString();

const hits = [];
const payFor = async (ownerId, tag) => {
  const at = new Date().toISOString();
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await store.commitBatch({ executions: [{ ownerId, provider: "rebill", executionUid: `exe_local_${tag}`, providerPaymentId: `pay_local_${tag}`, outcome: "approved", planCode: "tf_monthly_ars_v2", amountMinor: 2590000, currency: "ARS", dueAt: at, occurredAt: at }], periods: [{ ownerId, provider: "rebill", executionUid: `exe_local_${tag}`, planCode: "tf_monthly_ars_v2", priceVersion: 2, amountMinor: 2590000, currency: "ARS", periodStart: at, periodEnd: until }], subscriptions: [], reconciliations: [], events: [] });
  await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v2', grandfathered = false, current_period_start = $2, current_period_end = $3, grace_ends_at = $3::timestamptz + interval '5 days', version = version + 1 where owner_id = $1", [ownerId, at, until]);
};
// Acciones de apoyo SÓLO locales: /__admin/pay?email= (cobro aprobado + período), /__admin/expire?email= (vence el período y la gracia), /__admin/state?email= (estado y alumnos).
const adminActions = async (url) => {
  // /__admin/gate?on=1|0: enciende o apaga la compuerta de escritura de la BASE (migración 20261125130000; apagada por defecto).
  if (url.pathname === "/__admin/gate") {
    await admin.query("update public.billing_settings set write_gate_enabled = $1", [url.searchParams.get("on") === "1"]);
    return { write_gate_enabled: url.searchParams.get("on") === "1" };
  }
  const user = users.get(url.searchParams.get("email") ?? "");
  if (!user) throw new Error("cuenta desconocida");
  if (url.pathname === "/__admin/pay") await payFor(user.id, `dyn${Date.now()}`);
  if (url.pathname === "/__admin/expire") await admin.query("update public.billing_subscriptions set status = 'expired', current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days', grace_ends_at = now() - interval '5 days', version = version + 1 where owner_id = $1", [user.id]);
  const row = (await admin.query("select status, plan_code, current_period_end from public.billing_subscriptions where owner_id = $1", [user.id])).rows[0];
  const students = (await admin.query("select count(*)::int n from public.students where owner_id = $1", [user.id])).rows[0].n;
  return { ...row, students };
};
const server = createGateway({ pg, users, hits, admin: adminActions });
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const env = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_stack_clave_sintetica",
  SUPABASE_SERVICE_ROLE_KEY: issueJwt({ sub: "00000000-0000-4000-8000-000000000000", role: "service_role", ttlSeconds: 86_400 * 30 }),
  BILLING_ENABLED: "true",
  BILLING_PROVIDER: "fake",
  BILLING_ENFORCEMENT_ENABLED: process.env.LOCAL_ENFORCEMENT === "off" ? "false" : "true",
  BILLING_GRANDFATHER_CUTOFF: cutoff,
  BILLING_STATE_COOKIE_SECRET: "local-stack-secreto-sintetico-de-48-caracteres-xx",
  CRON_SECRET: "c".repeat(40),
};
writeFileSync(process.env.LOCAL_STACK_ENV_FILE ?? "local-stack.env.json", JSON.stringify(env));
console.log(`LISTO ${env.NEXT_PUBLIC_SUPABASE_URL} · cuentas: existente / nueva / paga @example.test · enforcement=${env.BILLING_ENFORCEMENT_ENABLED}`);
process.on("SIGINT", async () => {
  server.close();
  await svcConn.end();
  await pg.stop();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
