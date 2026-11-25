#!/usr/bin/env node
/**
 * Rebill — verificación de SÓLO LECTURA del circuito de suscripción (docs/billing/PRUEBA_REAL_Y_APERTURA.md).
 *
 *   node scripts/rebill-verify.mjs --env-file <archivo con REBILL_API_KEY=sk_…> [--expect monthly|quarterly|semiannual|annual] [--json]
 *
 * Sólo hace búsquedas (POST …/search) y lecturas: NO cobra, cancela, reanuda ni devuelve nada. Imprime lo que Rebill tiene (organización, pagos y
 * suscripciones: ids acortados, estado, importe, moneda, fechas, si el pago trae `tf_ref`) y lo contrasta con lo esperado del recorrido de UNA compra.
 * Nunca imprime la clave, el correo, el nombre ni la tarjeta, ni la referencia `tf_ref` completa (sólo una huella para cruzarla con la base).
 * Para el lado de TeacherFlow imprime la consulta SQL de comprobación (de sólo lectura) que usa esa huella.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CURRENT_PLAN_CODES, getPlan } from "../lib/billing/plans.ts";

const REF = /^tfs_[0-9a-f]{32}$/;
const short = (id) => (typeof id === "string" ? `${id.slice(0, 8)}…${id.slice(-4)}` : null);
const fingerprintOf = (ref) => createHash("sha256").update(ref).digest("hex").slice(0, 12);

export function readKey(file) {
  if (!file || !existsSync(file)) throw new Error("Pasá --env-file con la clave de la organización (archivo local ignorado por git).");
  const match = /^\s*REBILL_API_KEY\s*=\s*(.*?)\s*$/m.exec(readFileSync(file, "utf8"));
  const key = match?.[1]?.replace(/^["']|["']$/g, "");
  if (!key || !key.startsWith("sk_")) throw new Error("El archivo no trae una clave secreta sk_….");
  return key;
}

export function createClient(key, fetchImpl = fetch) {
  return async (method, path, json) => {
    const response = await fetchImpl(`https://api.rebill.com${path}`, { method, headers: { "x-api-key": key, ...(json ? { "content-type": "application/json" } : {}) }, body: json ? JSON.stringify(json) : undefined });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  };
}

const records = (body) => (Array.isArray(body?.records) ? body.records : []);

/** Reúne lo que Rebill tiene, sin datos personales. */
export async function collect(call) {
  const org = await call("GET", "/v3/organizations/me");
  const planSearch = await call("POST", "/v3/plans/search", { pagination: { limit: 100, offset: 0, order: "DESC" } });
  const planCodeById = new Map(records(planSearch.body).map((plan) => [plan.id, plan.metadata?.tfCode ?? null]));
  const payments = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await call("POST", "/v3/payments/search", { pagination: { limit: 100, offset, sort: "updated_at", order: "DESC" } });
    payments.push(...records(page.body));
    if (page.body?.pagination?.hasNextPage !== true) break;
  }
  const subscriptions = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await call("POST", "/v3/subscriptions/search", { pagination: { limit: 100, offset, order: "DESC" } });
    subscriptions.push(...records(page.body));
    if (page.body?.pagination?.hasNextPage !== true) break;
  }
  const hooks = await call("POST", "/v3/webhooks/search", { limit: 100, offset: 0 });
  return {
    environment: org.body?.environment ?? org.body?.organization?.environment ?? null,
    organizationStatus: org.body?.status ?? org.body?.organization?.status ?? null,
    payments: payments.map((payment) => {
      const ref = typeof payment.metadata?.tf_ref === "string" ? payment.metadata.tf_ref : null;
      return {
        id: short(payment.id), status: payment.status, amount: payment.amount ?? null, currency: payment.currency ?? null, type: payment.type ?? null,
        createdAt: payment.createdAt ?? null, updatedAt: payment.updatedAt ?? null, subscriptionId: short(payment.subscriptionId), hasSubscription: !!payment.subscriptionId,
        tfRefValid: ref ? REF.test(ref) : false, tfRefFingerprint: ref && REF.test(ref) ? fingerprintOf(ref) : null, metadataKeys: Object.keys(payment.metadata ?? {}),
      };
    }),
    subscriptions: subscriptions.map((sub) => ({
      id: short(sub.id), status: sub.status, statusDetail: sub.statusDetail ?? null, planCode: planCodeById.get(sub.plan?.id ?? sub.planId) ?? null,
      nextChargeDate: sub.nextChargeDate ?? null, createdAt: sub.createdAt ?? null, metadataKeys: Object.keys(sub.metadata ?? {}), metadataHasTfRef: typeof sub.metadata?.tf_ref === "string",
    })),
    webhooks: records(hooks.body).map((hook) => ({ url: hook.url, active: hook.active, events: hook.events })),
  };
}

/** Comprobaciones de UNA compra mensual (o del plan pedido). */
export function judge(snapshot, expect = "monthly") {
  const plan = getPlan(`tf_${expect}_ars_v2`);
  if (!plan || !CURRENT_PLAN_CODES.includes(plan.code)) throw new Error("--expect debe ser monthly, quarterly, semiannual o annual.");
  const approved = snapshot.payments.filter((payment) => payment.status === "approved");
  const checks = [];
  const check = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
  check("La organización es la esperada (productiva para la prueba real; sandbox para el ensayo)", snapshot.environment === "productive" || snapshot.environment === "sandbox", snapshot.environment);
  check("Hay exactamente UN pago en total (sin duplicados ni reintentos)", snapshot.payments.length === 1, `${snapshot.payments.length} pago(s)`);
  check("El pago está aprobado", approved.length === 1, approved.map((p) => p.status).join(",") || snapshot.payments.map((p) => p.status).join(","));
  const payment = approved[0];
  check(`El importe es el total del plan (${plan.amountMinor / 100} ${plan.currency}), no el comparativo mensual`, payment && Number(payment.amount) === plan.amountMinor / 100 && payment.currency === plan.currency, payment ? `${payment.amount} ${payment.currency}` : "");
  check("El pago trae la referencia de la cuenta (tf_ref) con el formato esperado", payment?.tfRefValid, payment?.metadataKeys?.join(",") ?? "");
  check("El pago pertenece a una suscripción", payment?.hasSubscription);
  check("Hay exactamente UNA suscripción", snapshot.subscriptions.length === 1, `${snapshot.subscriptions.length}`);
  const sub = snapshot.subscriptions[0];
  check("La suscripción está activa", sub?.status === "active", sub ? `${sub.status}${sub.statusDetail ? `/${sub.statusDetail}` : ""}` : "");
  check(`La suscripción es del plan ${plan.code}`, sub?.planCode === plan.code, sub?.planCode ?? "");
  if (payment && sub?.nextChargeDate) {
    const days = (Date.parse(sub.nextChargeDate) - Date.parse(payment.createdAt)) / 86_400_000;
    check(`El próximo cobro es dentro de ${plan.monthsOfAccess} mes(es) (±3 días)`, Math.abs(days - plan.monthsOfAccess * 30.4) <= 3 + plan.monthsOfAccess * 0.5, `${days.toFixed(1)} días`);
  } else {
    check("La suscripción tiene fecha del próximo cobro", false);
  }
  check("El webhook de producción sigue activo con los 4 eventos", snapshot.webhooks.some((hook) => hook.active && ["payment.created", "payment.updated", "subscription.created", "subscription.updated"].every((event) => hook.events?.includes(event))), `${snapshot.webhooks.length} webhook(s)`);
  return { plan: plan.code, checks, ok: checks.every((item) => item.ok), tfRefFingerprint: payment?.tfRefFingerprint ?? null, subscriptionMetadataHasTfRef: sub?.metadataHasTfRef ?? null };
}

/** Consulta SQL de SÓLO LECTURA del lado de TeacherFlow (se corre con `supabase db query --linked`). */
export function sqlFor(fingerprint) {
  return `select s.status, s.plan_code, s.provider, (s.provider_subscriber_uid is not null) as bound,
  (select count(*) from public.billing_executions e where e.owner_id = s.owner_id and e.outcome = 'approved') as approved_executions,
  (select count(*) from public.billing_periods p where p.owner_id = s.owner_id and p.voided_at is null) as active_periods,
  (select count(*) from public.billing_checkout_attempts a where a.owner_id = s.owner_id) as attempts,
  (select count(*) from public.billing_webhook_events w where w.owner_id = s.owner_id) as notices,
  (select count(*) from public.billing_reconciliations r where r.owner_id = s.owner_id and r.status = 'open') as open_reviews,
  s.current_period_start, s.current_period_end
from public.billing_subscriptions s
where left(encode(sha256(convert_to(s.provider_reference, 'UTF8')), 'hex'), 12) = '${fingerprint ?? "SIN_HUELLA"}';`;
}

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return { envFile: value("--env-file"), expect: value("--expect") ?? "monthly", json: argv.includes("--json") };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = await collect(createClient(readKey(args.envFile)));
  const verdict = judge(snapshot, args.expect);
  if (args.json) {
    console.log(JSON.stringify({ snapshot, verdict }, null, 2));
    return;
  }
  console.log(`Organización: ${snapshot.environment} (${snapshot.organizationStatus})`);
  for (const payment of snapshot.payments) console.log(`  pago ${payment.id} · ${payment.status} · ${payment.amount} ${payment.currency} · ${payment.type} · suscripción ${payment.subscriptionId ?? "—"} · tf_ref ${payment.tfRefValid ? `sí (huella ${payment.tfRefFingerprint})` : "no"}`);
  for (const sub of snapshot.subscriptions) console.log(`  suscripción ${sub.id} · ${sub.status}${sub.statusDetail ? `/${sub.statusDetail}` : ""} · ${sub.planCode} · próximo cobro ${sub.nextChargeDate} · metadata: ${sub.metadataKeys.join(",") || "—"}`);
  console.log("");
  for (const item of verdict.checks) console.log(`${item.ok ? "✔" : "✖"} ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  console.log(`\n¿Se copió tf_ref a la suscripción? ${verdict.subscriptionMetadataHasTfRef === null ? "sin dato" : verdict.subscriptionMetadataHasTfRef ? "sí" : "no (se vincula por el pago; es lo esperado)"}`);
  console.log(`\nLado de TeacherFlow (sólo lectura):\n${sqlFor(verdict.tfRefFingerprint)}`);
  process.exit(verdict.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : "Error inesperado"}`);
    process.exitCode = 2;
  });
}
