// M1/M2 — «Ninguna credencial en el bundle»: recorre el resultado de `next build`.
//
//   · NAVEGADOR (.next/static, lo único que se sirve al navegador): no puede aparecer NADA de facturación sensible: ni nombres de
//     credenciales, interruptores, funciones o tablas, ni códigos de plan, ni importes del catálogo en centavos, ni referencias de
//     suscriptor, ni el host de la API del proveedor. Los precios que ve la persona llegan renderizados por el servidor.
//   · SERVIDOR (.next/server, manifiestos y trazas): puede nombrar las variables de entorno (nunca sus VALORES), pero jamás un valor secreto (JWT), una
//     referencia de suscriptor real ni el secreto de los trabajos programados.
//
//   npm run build && node supabase/tests/billing/bundle_scan.mjs [ruta-a-.next]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".next");

const BROWSER_PATTERNS = [
  ["credenciales de Mobbex", /MOBBEX_API_KEY|MOBBEX_ACCESS_TOKEN|MOBBEX_VALIDATED_CAPABILITIES|x-access-token|x-api-key/],
  ["clave de servicio de Supabase (nombre de la variable o un JWT)", /SUPABASE_SERVICE_ROLE_KEY|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./],
  ["interruptores y secretos de facturación", /BILLING_ENABLED|BILLING_ENFORCEMENT_ENABLED|BILLING_PROVIDER|BILLING_STATE_COOKIE_SECRET|BILLING_GRANDFATHER_CUTOFF|CRON_SECRET/],
  ["funciones y tablas de facturación", /billing_(plans|subscriptions|executions|periods|checkout_attempts|plan_changes|webhook_events|reconciliations|sweep_cursors|settings|poll_schedule|fiscal_records|ensure_account|commit_batch|claim_events|claim_polls|mark_polled|prioritize_polls|get_subscriptions|resolve_subscribers|owner_executions|owner_history|due_subscriptions|open_checkout_attempt|complete_checkout_attempt|ingest_webhook_events|purge_retention|queue_stats|record_manual_outcome)/],
  ["códigos de plan", /tf_(monthly|quarterly|semiannual|annual)_ars_v\d/],
  ["importes del catálogo en centavos", /\b(2490000|6990000|13390000|24900000)\b/],
  ["referencias de suscriptor", /\btfs_[0-9a-f]{32}\b/],
  ["host del proveedor", /api\.mobbex\.com/],
  ["rutas internas de facturación del servidor", /api\/billing\/(webhooks|cron)/],
];

const SERVER_PATTERNS = [
  ["un JWT o clave de servicio con su valor", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./],
  ["una referencia de suscriptor real", /\btfs_[0-9a-f]{32}\b/],
  ["un secreto con valor asignado", /(CRON_SECRET|MOBBEX_API_KEY|MOBBEX_ACCESS_TOKEN|SUPABASE_SERVICE_ROLE_KEY|BILLING_STATE_COOKIE_SECRET)\s*[:=]\s*["'`][A-Za-z0-9_\-+/=]{16,}["'`]/],
];

const findings = [];
let files = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "cache" || entry.name === "node_modules" || (dir === root && entry.name === "dev")) continue; // `.next/dev` es la caché del servidor de desarrollo, no el build
      walk(full);
    } else if (/\.(js|mjs|cjs|html|json|css|map|rsc|txt|body)$/.test(entry.name) || !path.extname(entry.name)) {
      files += 1;
      const relative = path.relative(root, full).split(path.sep).join("/");
      // Sólo `static/` llega al NAVEGADOR; todo lo demás (server/, manifiestos, trazas) es del servidor.
      const isServer = !relative.startsWith("static/");
      const text = fs.readFileSync(full, "utf8");
      for (const [label, pattern] of isServer ? SERVER_PATTERNS : BROWSER_PATTERNS) if (pattern.test(text)) findings.push(`${isServer ? "servidor" : "navegador"} — ${label}: ${relative}`);
    }
  }
}

if (!fs.existsSync(root)) {
  console.error(`No existe ${root}: corré «npm run build» primero.`);
  process.exit(2);
}
walk(root);
console.log(`${files} archivos revisados en ${root}`);
if (findings.length === 0) {
  console.log("✔ Navegador sin credenciales, interruptores, funciones, planes, importes ni rutas de facturación; servidor sin valores secretos.");
  process.exit(0);
}
console.log(`✖ ${findings.length} hallazgo(s):`);
for (const finding of findings.slice(0, 40)) console.log("  -", finding);
process.exit(1);
