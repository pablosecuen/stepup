// M1 — «Ninguna credencial en el bundle»: recorre el resultado de `next build` (.next/static = lo que llega al NAVEGADOR y .next/server) y falla
// si aparece cualquier nombre de credencial, de interruptor o de función de facturación, o un importe/plan del catálogo.
//
//   npm run build && node supabase/tests/billing/bundle_scan.mjs [ruta-a-.next]
//
// Mientras la facturación NO esté conectada (M1) no debe aparecer NADA de esto ni en el servidor; cuando se conecte (M2), sólo
// el servidor podrá contener los nombres de las variables (nunca sus valores) y el navegador seguirá sin nada de esto.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".next");
const PATTERNS = [
  ["credenciales de Mobbex", /MOBBEX_API_KEY|MOBBEX_ACCESS_TOKEN|x-access-token|x-api-key/],
  ["clave de servicio de Supabase (nombre de la variable o un JWT)", /SUPABASE_SERVICE_ROLE_KEY|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\./],
  ["interruptores de facturación", /BILLING_ENABLED|BILLING_ENFORCEMENT_ENABLED/],
  ["funciones y tablas de facturación", /billing_(plans|subscriptions|executions|periods|checkout_attempts|plan_changes|webhook_events|reconciliations|sweep_cursors|settings|ensure_account|commit_batch|claim_events|get_subscriptions|resolve_subscribers|owner_executions|due_subscriptions|open_checkout_attempt|ingest_webhook_events|purge_retention)/],
  ["códigos de plan", /tf_(monthly|quarterly|semiannual|annual)_ars_v\d/],
  ["importes del catálogo en centavos", /\b(2490000|6990000|13390000|24900000)\b/],
  ["referencias de suscriptor", /\btfs_[0-9a-f]{32}\b/],
  ["host del proveedor", /api\.mobbex\.com/],
];

const findings = [];
let files = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "cache" || entry.name === "node_modules") continue;
      walk(full);
    } else if (/\.(js|mjs|cjs|html|json|css|map|rsc|txt|body)$/.test(entry.name) || !path.extname(entry.name)) {
      files += 1;
      const text = fs.readFileSync(full, "utf8");
      for (const [label, pattern] of PATTERNS) if (pattern.test(text)) findings.push(`${label}: ${path.relative(root, full)}`);
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
  console.log("✔ Sin credenciales, interruptores, funciones, planes ni importes de facturación en el build (navegador ni servidor).");
  process.exit(0);
}
console.log(`✖ ${findings.length} hallazgo(s):`);
for (const finding of findings.slice(0, 40)) console.log("  -", finding);
process.exit(1);
