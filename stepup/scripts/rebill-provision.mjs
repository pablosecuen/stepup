#!/usr/bin/env node
/**
 * Rebill — comprobación y aprovisionamiento de la suscripción de la profesora a TeacherFlow (docs/billing/REBILL.md).
 *
 *   node scripts/rebill-provision.mjs check                      sólo lectura: qué hay en la organización de Rebill y si la integración lo entiende
 *   node scripts/rebill-provision.mjs provision                  simulacro: muestra qué crearía (no escribe nada)
 *   node scripts/rebill-provision.mjs provision --apply          crea lo que falte: cuatro planes, un payment link por plan y el webhook
 *
 * Credenciales: NUNCA por argumentos ni por el chat. La clave secreta `sk_…` se lee de la variable de entorno REBILL_API_KEY o de un archivo local
 * `.env.rebill.local` (ignorado por git) con una línea `REBILL_API_KEY=sk_…`. Una clave por organización: la de sandbox y la de producción son distintas
 * y se corre el script una vez con cada una. El script nunca imprime la clave ni el secreto del webhook: el secreto de firma (que Rebill muestra una sola
 * vez) se guarda en `.env.rebill.secrets.local` (ignorado por git, permisos 600) y de ahí se carga en Vercel.
 *
 * Seguridad de la escritura: no duplica (busca antes por `metadata.tfCode`, y si no puede listar NO crea), no edita ni pisa un precio existente (ante una
 * diferencia se detiene) y no usa pruebas gratuitas, cupones ni descuentos. Con `--apply` sobre producción hace falta además `--yes-production`.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURRENT_PLAN_CODES, getPlan } from "../lib/billing/plans.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SITE = "https://teacherflowapp.com";
const WEBHOOK_PATH = "/api/billing/webhooks/rebill";
const WEBHOOK_EVENTS = ["payment.created", "payment.updated", "subscription.created", "subscription.updated"];
const TIMEOUT_MS = 15_000;

export class ProvisionError extends Error {}

/** Lee `KEY=valor` de un archivo local (sin interpretar comillas complejas). Devuelve sólo lo pedido. */
export function readEnvFile(path, keys) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && keys.includes(match[1])) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Cliente mínimo: la clave sólo viaja en el encabezado `x-api-key` y nunca aparece en un mensaje de error. */
export function createClient({ apiKey, baseUrl = "https://api.rebill.com", fetchImpl = fetch }) {
  if (!apiKey || !apiKey.startsWith("sk_")) throw new ProvisionError("Falta una clave secreta `sk_…` (REBILL_API_KEY). Una clave pública `pk_…` no sirve para esto.");
  const host = new URL(baseUrl).hostname;
  if (baseUrl !== "https://api.rebill.com" && host !== "127.0.0.1" && host !== "localhost") throw new ProvisionError("La dirección de la API sólo puede ser https://api.rebill.com (o localhost en pruebas).");
  return async function request(method, path, json) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, { method, headers: { "x-api-key": apiKey, ...(json === undefined ? {} : { "content-type": "application/json" }) }, body: json === undefined ? undefined : JSON.stringify(json), signal: controller.signal });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return { status: response.status, ok: response.ok, body };
    } catch {
      return { status: 0, ok: false, body: null };
    } finally {
      clearTimeout(timer);
    }
  };
}

const recordsOf = (body) => (Array.isArray(body?.records) ? body.records : Array.isArray(body) ? body : null);
const short = (result) => `HTTP ${result.status}${typeof result.body?.message === "string" ? ` · ${result.body.message.slice(0, 160)}` : ""}`;

/** Prueba, en orden, rutas candidatas de lectura (algunas rutas no están impresas en la documentación pública) y devuelve la primera que responde bien. */
async function firstOk(request, attempts) {
  const tried = [];
  for (const [method, path, json] of attempts) {
    const result = await request(method, path, json);
    tried.push(`${method} ${path} → ${short(result)}`);
    if (result.ok) return { result, method, path, json, tried };
  }
  return { result: null, tried };
}

export async function check(request, log = console.log) {
  const report = { ok: true, environment: null };
  const org = await firstOk(request, [["GET", "/v3/organizations"], ["GET", "/v3/organizations/me"], ["GET", "/v3/organization"], ["GET", "/v3/my-organization"]]);
  if (!org.result) { log(`✖ Organización: ninguna ruta candidata respondió (${org.tried.join(" | ")})`); report.ok = false; }
  else {
    const data = org.result.body?.organization ?? org.result.body;
    report.environment = data?.environment ?? null;
    log(`✔ Organización (${org.method} ${org.path}): ambiente «${data?.environment ?? "?"}», estado «${data?.status ?? "?"}», alias «${data?.alias ?? "?"}»`);
    if (data?.environment === "sandbox") log("  → es la organización de PRUEBA (sandbox).");
    if (data?.environment === "productive") log("  → es la organización de PRODUCCIÓN: cualquier cobro es real.");
  }
  const plans = await firstOk(request, [["POST", "/v3/plans/search", { limit: 100, offset: 0 }], ["POST", "/v3/plans/search", {}]]);
  if (!plans.result) { log(`✖ Planes: no se pudo listar (${plans.tried.join(" | ")}). No se creará nada hasta poder listar.`); report.ok = false; }
  else {
    const records = recordsOf(plans.result.body) ?? [];
    log(`✔ Planes existentes: ${records.length}`);
    for (const record of records) log(`    ${record.id} · ${record.status ?? "?"} · tfCode=${record.metadata?.tfCode ?? "—"}`);
  }
  const links = await firstOk(request, [["POST", "/v3/payment-links/search", { limit: 100, offset: 0 }]]);
  if (!links.result) { log(`✖ Payment links: no se pudo listar (${links.tried.join(" | ")})`); report.ok = false; }
  else log(`✔ Payment links existentes: ${(recordsOf(links.result.body) ?? []).length}`);
  const hooks = await firstOk(request, [["POST", "/v3/webhooks/search", { limit: 100, offset: 0 }], ["GET", "/v3/webhooks"]]);
  if (!hooks.result) { log(`✖ Webhooks: no se pudo listar (${hooks.tried.join(" | ")})`); report.ok = false; }
  else log(`✔ Webhooks existentes: ${(recordsOf(hooks.result.body) ?? []).length}`);

  // La integración consulta los pagos con un cuerpo concreto (lib/billing/providers/rebill.ts). Rebill rechaza (400) las propiedades desconocidas: hay que verlo contra la API real.
  const variants = [
    ["los nombres que usa hoy la integración (limit/offset/sortBy/sortOrder)", { limit: 1, offset: 0, sortBy: "updated_at", sortOrder: "DESC" }],
    ["variante sort/order", { limit: 1, offset: 0, sort: "updated_at", order: "DESC" }],
    ["sólo paginación", { limit: 1, offset: 0 }],
  ];
  for (const [label, body] of variants) {
    const result = await request("POST", "/v3/payments/search", body);
    log(`${result.ok ? "✔" : "✖"} Búsqueda de pagos con ${label}: ${short(result)}`);
    if (label.startsWith("los nombres") && !result.ok) report.ok = false;
  }
  const subs = await request("POST", "/v3/subscriptions/search", { limit: 1, offset: 0 });
  log(`${subs.ok ? "✔" : "✖"} Búsqueda de suscripciones (limit/offset): ${short(subs)}`);
  return report;
}

const spanishName = (text) => [{ language: "es", text }];

function planBody(plan) {
  return {
    name: spanishName(`TeacherFlow ${plan.name}`),
    description: spanishName(`Suscripción ${plan.name.toLowerCase()} a TeacherFlow`),
    frequency: { period: "month", count: plan.interval.count },
    prices: [{ amount: plan.amountMinor / 100, currency: plan.currency, isDefault: true }],
    status: "active",
    metadata: { tfCode: plan.code },
  };
}

function priceMatches(record, plan) {
  const prices = Array.isArray(record.prices) ? record.prices : [];
  const price = prices.find((item) => item.isDefault) ?? prices[0];
  const freq = record.frequency ?? {};
  const monthsOk = freq.period === "month" ? freq.count === plan.interval.count : freq.period === "year" ? freq.count * 12 === plan.interval.count : false;
  return !!price && Number(price.amount) === plan.amountMinor / 100 && String(price.currency).toUpperCase() === plan.currency && monthsOk && !record.trialPeriodDays && !(record.repetitions > 0);
}

/** Crea lo que falta. `apply=false` es un simulacro. Devuelve los ids/direcciones (no secretos) y, si se creó el webhook, su secreto (para guardarlo sin imprimirlo). */
export async function provision(request, { site = DEFAULT_SITE, apply = false, log = console.log } = {}) {
  const result = { env: {}, webhookSecret: null };
  const existingPlans = await firstOk(request, [["POST", "/v3/plans/search", { limit: 100, offset: 0 }]]);
  if (!existingPlans.result) throw new ProvisionError(`No se pudo listar los planes de Rebill (${existingPlans.tried.join(" | ")}): no se crea nada para no duplicar.`);
  const plans = recordsOf(existingPlans.result.body) ?? [];
  const existingLinks = await firstOk(request, [["POST", "/v3/payment-links/search", { limit: 100, offset: 0 }]]);
  if (!existingLinks.result) throw new ProvisionError(`No se pudo listar los payment links (${existingLinks.tried.join(" | ")}): no se crea nada para no duplicar.`);
  const links = recordsOf(existingLinks.result.body) ?? [];

  for (const code of CURRENT_PLAN_CODES) {
    const plan = getPlan(code);
    const matches = plans.filter((record) => record.metadata?.tfCode === code && record.status !== "archived");
    if (matches.length > 1) throw new ProvisionError(`Hay ${matches.length} planes de Rebill con tfCode=${code}: se resuelve a mano (no se elige uno al azar).`);
    let planRecord = matches[0];
    if (planRecord) {
      if (!priceMatches(planRecord, plan)) throw new ProvisionError(`El plan ${planRecord.id} (${code}) NO coincide con el catálogo (${plan.amountMinor / 100} ${plan.currency} cada ${plan.interval.count} mes/es, sin prueba gratuita ni repeticiones). No se edita un precio: archivalo y volvé a correr, o corregilo en el panel.`);
      log(`= Plan ${code}: ya existe (${planRecord.id}) y coincide con el catálogo.`);
    } else if (!apply) {
      log(`+ Plan ${code}: se crearía (${plan.amountMinor / 100} ${plan.currency} cada ${plan.interval.count} mes/es).`);
      continue;
    } else {
      const created = await request("POST", "/v3/plans", planBody(plan));
      if (!created.ok || !created.body?.id) throw new ProvisionError(`No se pudo crear el plan ${code}: ${short(created)}`);
      planRecord = created.body;
      log(`+ Plan ${code}: creado (${planRecord.id}).`);
    }
    result.env[`REBILL_PLAN_ID_${code.toUpperCase()}`] = planRecord.id;

    const linkMatches = links.filter((record) => record.metadata?.tfCode === code && record.status !== "archived");
    if (linkMatches.length > 1) throw new ProvisionError(`Hay ${linkMatches.length} payment links con tfCode=${code}: se resuelve a mano.`);
    let linkRecord = linkMatches[0];
    if (linkRecord) {
      const planOfLink = linkRecord.plan?.id ?? linkRecord.planId;
      if (planOfLink && planOfLink !== planRecord.id) throw new ProvisionError(`El payment link ${linkRecord.id} (${code}) apunta a otro plan (${planOfLink}).`);
      if (linkRecord.redirectUrls?.approved !== `${site}/facturacion/resultado`) throw new ProvisionError(`El payment link ${linkRecord.id} (${code}) no vuelve a ${site}/facturacion/resultado al aprobar. Corregilo en el panel.`);
      log(`= Link ${code}: ya existe (${linkRecord.id}).`);
    } else if (!apply) {
      log(`+ Link ${code}: se crearía para ${planRecord.id}, con retorno ${site}/facturacion/resultado.`);
      continue;
    } else {
      const created = await request("POST", "/v3/payment-links", {
        title: spanishName(`TeacherFlow ${plan.name}`),
        plan: { id: planRecord.id },
        paymentMethods: [{ methods: ["card"], currency: plan.currency }],
        redirectUrls: { approved: `${site}/facturacion/resultado`, rejected: `${site}/facturacion/resultado` },
        status: "active",
        metadata: { tfCode: code },
      });
      if (!created.ok || !created.body?.id) throw new ProvisionError(`No se pudo crear el payment link de ${code}: ${short(created)}`);
      linkRecord = created.body;
      log(`+ Link ${code}: creado (${linkRecord.id}).`);
    }
    if (typeof linkRecord.url !== "string" || !linkRecord.url.startsWith("https://pay.rebill.com/")) throw new ProvisionError(`El payment link ${linkRecord.id} no devolvió una dirección https://pay.rebill.com/….`);
    result.env[`REBILL_CHECKOUT_URL_${code.toUpperCase()}`] = linkRecord.url;
  }

  const hooks = await firstOk(request, [["POST", "/v3/webhooks/search", { limit: 100, offset: 0 }], ["GET", "/v3/webhooks"]]);
  if (!hooks.result) throw new ProvisionError(`No se pudo listar los webhooks (${hooks.tried.join(" | ")}): no se crea ninguno.`);
  const webhookUrl = `${site}${WEBHOOK_PATH}`;
  const existingHook = (recordsOf(hooks.result.body) ?? []).find((record) => record.url === webhookUrl);
  if (existingHook) {
    const missing = WEBHOOK_EVENTS.filter((event) => !(existingHook.events ?? []).includes(event));
    log(`= Webhook: ya existe (${existingHook.id})${missing.length ? ` pero FALTAN los eventos ${missing.join(", ")}` : ""}. Rebill muestra el secreto una sola vez: si no lo guardaste, rotalo en el panel (Developer Center > Webhooks) y cargá el nuevo en Vercel.`);
  } else if (!apply) {
    log(`+ Webhook: se crearía hacia ${webhookUrl} con ${WEBHOOK_EVENTS.join(", ")}.`);
  } else {
    const created = await request("POST", "/v3/webhooks", { url: webhookUrl, events: WEBHOOK_EVENTS });
    if (!created.ok || !created.body?.id) throw new ProvisionError(`No se pudo crear el webhook: ${short(created)}`);
    result.webhookSecret = typeof created.body.signingSecret === "string" ? created.body.signingSecret : null;
    log(`+ Webhook: creado (${created.body.id}). ${result.webhookSecret ? "Su secreto de firma se guarda en un archivo local, no se imprime." : "Rebill no devolvió el secreto: rotalo en el panel."}`);
  }
  return result;
}

function parseArgs(argv) {
  const args = { command: argv[0], apply: argv.includes("--apply"), yesProduction: argv.includes("--yes-production"), site: DEFAULT_SITE, envFile: join(ROOT, ".env.rebill.local") };
  const siteIndex = argv.indexOf("--site");
  if (siteIndex >= 0) args.site = argv[siteIndex + 1];
  const fileIndex = argv.indexOf("--env-file");
  if (fileIndex >= 0) args.envFile = argv[fileIndex + 1];
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command !== "check" && args.command !== "provision") {
    console.log("Uso: node scripts/rebill-provision.mjs check | provision [--apply] [--yes-production] [--site https://…]");
    process.exit(2);
  }
  const fromFile = readEnvFile(args.envFile, ["REBILL_API_KEY"]);
  const request = createClient({ apiKey: process.env.REBILL_API_KEY || fromFile.REBILL_API_KEY });
  const report = await check(request, args.command === "check" ? console.log : () => {});
  if (args.command === "check") process.exit(report.ok ? 0 : 1);
  if (report.environment === "productive" && args.apply && !args.yesProduction) throw new ProvisionError("Es la organización de PRODUCCIÓN: para crear planes, links y webhook agregá --yes-production.");
  if (!report.environment) throw new ProvisionError("No se pudo confirmar en qué organización (sandbox o producción) está esa clave: no se escribe nada.");
  const result = await provision(request, { site: args.site, apply: args.apply });
  const environment = report.environment === "productive" ? "production" : "sandbox";
  console.log(`\nVariables NO secretas para Vercel (ambiente ${environment}):`);
  console.log(`REBILL_ENVIRONMENT=${environment}`);
  for (const [name, value] of Object.entries(result.env)) console.log(`${name}=${value}`);
  if (result.webhookSecret) {
    const secretsFile = join(ROOT, ".env.rebill.secrets.local");
    writeFileSync(secretsFile, `REBILL_WEBHOOK_SECRET=${result.webhookSecret}\n`, { mode: 0o600 });
    try { chmodSync(secretsFile, 0o600); } catch { /* en Windows no aplica */ }
    console.log(`\nEl secreto del webhook quedó en ${secretsFile} (ignorado por git). Cargalo en Vercel como REBILL_WEBHOOK_SECRET (sensible) y borrá el archivo.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof ProvisionError ? `✖ ${error.message}` : "✖ Error inesperado (sin detalles para no filtrar datos).");
    process.exit(1);
  });
}
