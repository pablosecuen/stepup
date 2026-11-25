#!/usr/bin/env node
/**
 * Rebill — ensayo en el SANDBOX (docs/billing/PRUEBA_REAL_Y_APERTURA.md §A). Nunca toca la organización productiva: rechaza cualquier clave cuya
 * organización no sea `sandbox`. Las acciones que escriben exigen `--yes`. No imprime claves ni datos personales.
 *
 *   node scripts/rebill-sandbox-rehearsal.mjs link    --env-file <sandbox> [--plan monthly]     dirección de pago del sandbox con una referencia nueva (tf_ref)
 *   node scripts/rebill-sandbox-rehearsal.mjs status  --env-file <sandbox>                       pagos y suscripciones del sandbox (ya lo hace rebill-verify.mjs; acá, resumen corto)
 *   node scripts/rebill-sandbox-rehearsal.mjs advance <sub_…> --env-file <sandbox> --yes         ejecuta YA la próxima renovación (POST /v3/subscriptions/:id/sandbox/advance; sólo sandbox)
 *   node scripts/rebill-sandbox-rehearsal.mjs pause   <sub_…> --env-file <sandbox> --yes         pausa (PATCH status: paused), como «Cancelar renovación»
 *   node scripts/rebill-sandbox-rehearsal.mjs resume  <sub_…> <AAAA-MM-DD> --env-file <sandbox> --yes   reanuda con nextChargeDate = esa fecha a las 12:00 de Argentina
 *   node scripts/rebill-sandbox-rehearsal.mjs refund  <pay_…> --env-file <sandbox> --yes         devuelve el pago completo (POST /v3/refunds/:id)
 *
 * El primer cobro del sandbox lo hace una PERSONA en el sitio de pago con una tarjeta de prueba oficial (Rebill no permite crear pagos por API
 * sin datos de tarjeta en sandbox): ver el procedimiento. Todo lo demás (renovación, reintentos, pausa, reanudación, devolución) se ejecuta desde acá.
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, readKey } from "./rebill-verify.mjs";

export function resumeInstant(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error("La fecha debe ser AAAA-MM-DD.");
  const time = Date.parse(`${dateKey}T12:00:00-03:00`);
  if (!Number.isFinite(time)) throw new Error("Fecha inválida.");
  return new Date(time).toISOString();
}

export function newReference() {
  return `tfs_${randomBytes(16).toString("hex")}`;
}

async function requireSandbox(call) {
  const org = await call("GET", "/v3/organizations/me");
  const environment = org.body?.environment ?? org.body?.organization?.environment;
  if (environment !== "sandbox") throw new Error(`Esta clave NO es del sandbox (organización: ${environment ?? "desconocida"}). No se hace nada.`);
}

const idOf = (value, prefix) => {
  if (typeof value !== "string" || !new RegExp(`^(test_)?${prefix}_[A-Za-z0-9_-]{4,100}$`).test(value)) throw new Error(`Falta un identificador ${prefix}_… válido.`);
  return value;
};

async function main() {
  const argv = process.argv.slice(2);
  const [command, ...rest] = argv;
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const positional = rest.filter((item, index) => !item.startsWith("--") && !(rest[index - 1] ?? "").startsWith("--env-file") && rest[index - 1] !== "--plan");
  const call = createClient(readKey(flag("--env-file")));
  await requireSandbox(call);
  const needYes = () => {
    if (!argv.includes("--yes")) throw new Error("Esta acción escribe en el sandbox: repetí el comando con --yes.");
  };

  if (command === "link") {
    const code = `tf_${flag("--plan") ?? "monthly"}_ars_v2`;
    const links = await call("POST", "/v3/payment-links/search", { pagination: { limit: 100, offset: 0, order: "DESC" } });
    const link = (links.body?.records ?? []).find((item) => item.metadata?.tfCode === code && item.status !== "archived");
    if (!link?.url) throw new Error(`No hay un payment link del sandbox para ${code}.`);
    const url = new URL(link.url);
    const reference = newReference();
    url.searchParams.set("tf_ref", reference);
    url.searchParams.set("language", "es");
    console.log(`Plan: ${code}\nReferencia de la prueba (sólo para el ensayo): ${reference}\nDirección de pago del SANDBOX (no cobra dinero real):\n${url.toString()}`);
    console.log("\nTarjeta de prueba de Argentina que APRUEBA el primer cobro y RECHAZA las renovaciones: ver docs/billing/PRUEBA_REAL_Y_APERTURA.md §A (vencimiento 01/2099, CVV 123).");
    return;
  }
  if (command === "status") {
    const payments = await call("POST", "/v3/payments/search", { pagination: { limit: 100, offset: 0, sort: "updated_at", order: "DESC" } });
    for (const payment of payments.body?.records ?? []) console.log(`pago ${payment.id} · ${payment.status} · ${payment.amount} ${payment.currency} · sub ${payment.subscriptionId ?? "—"} · creado ${payment.createdAt} · actualizado ${payment.updatedAt} · metadata ${Object.keys(payment.metadata ?? {}).join(",") || "—"}`);
    const subs = await call("POST", "/v3/subscriptions/search", { pagination: { limit: 100, offset: 0, order: "DESC" } });
    for (const sub of subs.body?.records ?? []) console.log(`suscripción ${sub.id} · ${sub.status}${sub.statusDetail ? `/${sub.statusDetail}` : ""} · próximo cobro ${sub.nextChargeDate ?? "—"}`);
    return;
  }
  if (command === "advance") {
    needYes();
    const id = idOf(positional[0], "sub");
    const result = await call("POST", `/v3/subscriptions/${encodeURIComponent(id)}/sandbox/advance`, {});
    console.log(`advance → HTTP ${result.status}`, result.status < 300 ? "" : String(result.body?.message ?? "").slice(0, 200));
    return;
  }
  if (command === "pause") {
    needYes();
    const id = idOf(positional[0], "sub");
    const result = await call("PATCH", `/v3/subscriptions/${encodeURIComponent(id)}`, { status: "paused" });
    console.log(`pause → HTTP ${result.status}`, result.status < 300 ? "" : String(result.body?.message ?? "").slice(0, 200));
    return;
  }
  if (command === "resume") {
    needYes();
    const id = idOf(positional[0], "sub");
    const result = await call("PATCH", `/v3/subscriptions/${encodeURIComponent(id)}`, { status: "active", nextChargeDate: resumeInstant(positional[1] ?? "") });
    console.log(`resume → HTTP ${result.status}`, result.status < 300 ? "" : String(result.body?.message ?? "").slice(0, 200));
    return;
  }
  if (command === "refund") {
    needYes();
    const id = idOf(positional[0], "pay");
    const result = await call("POST", `/v3/refunds/${encodeURIComponent(id)}`, {});
    console.log(`refund → HTTP ${result.status}`, result.status < 300 ? `estado: ${result.body?.status ?? "?"}` : String(result.body?.message ?? "").slice(0, 200));
    return;
  }
  console.log("Uso: link | status | advance <sub> | pause <sub> | resume <sub> <AAAA-MM-DD> | refund <pay>   (--env-file <sandbox>, y --yes para lo que escribe)");
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`✖ ${error instanceof Error ? error.message : "Error inesperado"}`);
    process.exitCode = 1;
  });
}
