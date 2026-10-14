import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * Guardas estructurales de M1 (leen el código fuente; no ejecutan la aplicación). Fijan las reglas que no deben romperse sin una
 * decisión explícita: la facturación NO está conectada, los secretos son sólo de servidor, el esquema es aditivo y cerrado a
 * `service_role`, y nada sensible se guarda ni se registra.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) walk(relative(ROOT, path), accept, out);
    else if (accept(path)) out.push(relative(ROOT, path).split(sep).join("/"));
  }
  return out;
}

const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const BILLING_SOURCES = walk("lib/billing", (f) => f.endsWith(".ts") && !f.includes(`${sep}__tests__${sep}`));
const APP_SOURCES = [...walk("app", (f) => /\.(ts|tsx)$/.test(f)), ...walk("components", (f) => /\.(ts|tsx)$/.test(f)), "proxy.ts"];

/**
 * M2 conecta la facturación ÚNICAMENTE por estos puntos (nada más importa lib/billing). Con los interruptores apagados ninguno de
 * ellos cambia el comportamiento actual: ver `m2-structure.test.ts`.
 */
const BILLING_IMPORT = /from\s+["']((?:@\/)?lib\/billing\/[^"']*|@\/lib\/actions\/billing|(?:\.\.?\/)+billing\/[^"']*)["']/g;
const importsOf = (file: string): string[] => [...read(file).matchAll(BILLING_IMPORT)].map((match) => match[1]);
const moduleOf = (specifier: string): string => specifier.replace(/^.*lib\/billing\//, "").replace(/\.ts$/, "");

const ALLOWED_CONNECTIONS: ReadonlyArray<{ readonly match: RegExp; readonly modules: ReadonlySet<string> }> = [
  { match: /^app\/\(app\)\/layout\.tsx$/, modules: new Set(["flags"]) },
  { match: /^app\/\(app\)\/configuracion\/page\.tsx$/, modules: new Set(["flags"]) },
  { match: /^app\/\(app\)\/facturacion\/(planes\/|resultado\/)?page\.tsx$/, modules: new Set(["page-data"]) },
  { match: /^app\/\(app\)\/facturacion\/condiciones\/page\.tsx$/, modules: new Set(["page-data", "legal"]) },
  { match: /^app\/api\/billing\/.+\/route\.ts$/, modules: new Set(["runtime", "http", "webhook-ingest", "jobs", "log"]) },
  { match: /^components\/billing\/[a-z-]+\.tsx$/, modules: new Set(["view", "redirect", "@/lib/actions/billing"]) },
];

test("M2 conecta la facturación SÓLO por los puntos aprobados (rutas de API, pantallas de facturación, acciones y los interruptores del layout); nada más importa lib/billing", () => {
  assert.ok(APP_SOURCES.length > 100);
  const connected = new Set<string>();
  for (const file of APP_SOURCES) {
    const imports = importsOf(file);
    if (imports.length === 0) continue;
    const rule = ALLOWED_CONNECTIONS.find((entry) => entry.match.test(file));
    assert.ok(rule, `${file} importa facturación y no figura entre los puntos aprobados: ${imports.join(", ")}`);
    for (const specifier of imports) {
      const name = specifier.startsWith("@/lib/actions/") ? specifier : moduleOf(specifier);
      assert.ok(rule.modules.has(name), `${file} importa «${name}», que no está permitido`);
    }
    connected.add(file);
  }
  assert.ok(connected.size >= 8, `puntos conectados: ${[...connected].join(", ")}`);
  // proxy.ts y la navegación NO importan facturación: reciben un booleano por propiedad.
  for (const file of ["proxy.ts", "components/nav/primary-nav.tsx", "components/nav/account-menu.tsx", "components/account/configuration-view.tsx", "components/account/delete-account-button.tsx"]) assert.deepEqual(importsOf(file), [], file);
  // El resto de lib/: sólo las acciones de facturación y de cuenta (eliminación) usan lib/billing.
  const allowedLib = new Set(["lib/actions/billing.ts", "lib/actions/account.ts"]);
  for (const file of walk("lib", (f) => f.endsWith(".ts") && !f.includes(`${sep}billing${sep}`) && !f.includes("__tests__"))) {
    if (allowedLib.has(file)) continue;
    assert.doesNotMatch(read(file), /from "(\.\.?\/)+billing\/|@\/lib\/billing/, file);
  }
  assert.deepEqual([...new Set(importsOf("lib/actions/account.ts").map(moduleOf))].sort(), ["account-deletion", "runtime", "safe-errors"]);
});

test("ningún componente cliente puede importar el servidor de facturación: sólo funciones puras (vista, redirección) y las acciones; los precios y estados llegan del servidor", () => {
  for (const file of APP_SOURCES) {
    const source = read(file);
    if (!/^["']use client["']/m.test(source)) continue;
    for (const specifier of importsOf(file)) {
      const name = specifier.startsWith("@/lib/actions/") ? specifier : moduleOf(specifier);
      assert.ok(["view", "redirect", "@/lib/actions/billing"].includes(name), `${file} (cliente) importa «${name}»`);
    }
  }
  // Y los módulos puros que sí pueden viajar al navegador no arrastran nada del servidor.
  for (const file of ["lib/billing/view.ts", "lib/billing/redirect.ts"]) assert.doesNotMatch(code(file), /server-only|node:|process\.env|@supabase|supabase-store|runtime/, file);
});

test("los secretos de facturación son SÓLO de servidor: ningún NEXT_PUBLIC_ con claves, tokens ni facturación, en ningún archivo", () => {
  const files = [...BILLING_SOURCES, ...walk("app", (f) => /\.(ts|tsx|mjs)$/.test(f)), ...walk("components", (f) => /\.(ts|tsx)$/.test(f)), ...walk("lib", (f) => /\.(ts|mjs)$/.test(f) && !f.includes(`${sep}__tests__${sep}`) && !f.includes("/__tests__/")), "next.config.mjs", "proxy.ts", ".env.example"];
  for (const file of new Set(files)) {
    const source = read(file);
    assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*(MOBBEX|BILLING|SERVICE_ROLE|ACCESS_TOKEN|API_KEY|WEBHOOK|SECRET)/, file);
  }
  assert.doesNotMatch(read("next.config.mjs"), /MOBBEX|SERVICE_ROLE|BILLING|\benv\s*:/, "next.config.mjs no expone variables al navegador");
});

/** Módulos de composición del servidor (leen el entorno y arman almacén y adaptador): server-only por diseño. */
const SERVER_COMPOSITION: ReadonlySet<string> = new Set(["lib/billing/runtime.ts", "lib/billing/page-data.ts"]);

test("la clave de servicio de Supabase y las credenciales de Mobbex se leen en UN solo lugar cada una", () => {
  const withService = [...BILLING_SOURCES, ...walk("lib", (f) => f.endsWith(".ts") && !f.includes(`${sep}billing${sep}`)), ...APP_SOURCES].filter((f) => /SERVICE_ROLE_KEY/.test(read(f)));
  // `readiness.ts` sólo NOMBRA las variables para informar qué falta: recibe el entorno inyectado, jamás lee `process.env`.
  assert.deepEqual(withService.filter((f) => !/__tests__/.test(f) && f !== "lib/billing/readiness.ts"), ["lib/billing/supabase-store.ts"]);
  assert.doesNotMatch(code("lib/billing/readiness.ts"), /process.env/);
  const withMobbexSecrets = BILLING_SOURCES.filter((f) => /MOBBEX_API_KEY|MOBBEX_ACCESS_TOKEN/.test(code(f)));
  assert.deepEqual(withMobbexSecrets.filter((f) => f !== "lib/billing/readiness.ts"), ["lib/billing/providers/mobbex.ts"]);
  const store = read("lib/billing/supabase-store.ts");
  assert.match(store, /^import "server-only";/);
  assert.equal([...store.matchAll(/createClient\(/g)].length, 1);
  // Sólo el almacén con clave de servicio importa supabase-js dentro de lib/billing; el resto es puro y se prueba sin servidor.
  for (const file of BILLING_SOURCES) {
    if (file === "lib/billing/supabase-store.ts") continue;
    if (SERVER_COMPOSITION.has(file)) continue; // raíz de composición y datos de pantallas: son del servidor (server-only) por diseño
    assert.doesNotMatch(code(file), /@supabase|server-only|next\/|from "react/, file);
  }
});

test("el registro es seguro: sólo log.ts imprime, y ningún módulo registra cuerpos, encabezados, errores ni mensajes de error", () => {
  for (const file of BILLING_SOURCES) {
    const source = code(file);
    if (file === "lib/billing/log.ts") continue;
    assert.doesNotMatch(source, /console\.(log|info|warn|error|debug)/, `${file} no debe imprimir directo`);
    assert.doesNotMatch(source, /\.message\b|\.stack\b|JSON\.stringify\((error|err|e)\b/, `${file} no debe leer mensajes de error`);
  }
  const logs = BILLING_SOURCES.flatMap((file) => [...code(file).matchAll(/logBilling\([^;]*\);/g)].map((m) => `${file}: ${m[0]}`));
  assert.ok(logs.length >= 5);
  for (const line of logs) assert.doesNotMatch(line, /rawBody|headers|payload|body|email|customer|identification|token|apiKey|secret/i, line);
});

test("ningún precio está duplicado fuera del catálogo del servidor (ni en componentes, ni en páginas, ni en el resto de lib/)", () => {
  const prices = /\b(24[.,]?900|69[.,]?900|133[.,]?900|249[.,]?000|2490000|6990000|13390000|24900000)\b/;
  for (const file of [...APP_SOURCES, ...walk("lib", (f) => f.endsWith(".ts") && !f.includes(`${sep}billing${sep}`) && !f.includes("__tests__"))]) {
    assert.doesNotMatch(code(file), prices, `${file}: un precio de suscripción no puede aparecer fuera de lib/billing/plans.ts`);
  }
  const outsideCatalog = BILLING_SOURCES.filter((f) => f !== "lib/billing/plans.ts" && f !== "lib/billing/commission.ts").filter((f) => prices.test(code(f)));
  assert.deepEqual(outsideCatalog, []);
});

test("las fechas usan la zona de Argentina: nunca toISOString().slice(0, 10) ni getFullYear/getMonth/getDate del proceso", () => {
  for (const file of BILLING_SOURCES) {
    assert.doesNotMatch(code(file), /toISOString\(\)\.(slice|substring|substr)\(|\.getFullYear\(|\.getMonth\(|\.getDate\(|\.getHours\(|\.getDay\(|toLocale(Date|Time)?String/, file);
  }
});

const MIGRATIONS = ["supabase/migrations/20261014100000_m1_billing_core.sql", "supabase/migrations/20261014110000_m1_billing_functions.sql"];
const SQL = MIGRATIONS.map((path) => read(path)).join("\n");
const SQL_CODE = SQL.replace(/--[^\n]*/g, "");
const TABLES = [...SQL_CODE.matchAll(/create table if not exists public\.(billing_[a-z_]+)/g)].map((m) => m[1]);

test("migraciones M1: ADITIVAS e idempotentes, sin tocar ninguna tabla, función ni política existente", () => {
  assert.equal(TABLES.length, 10);
  assert.doesNotMatch(SQL_CODE, /\balter table (?!public\.billing_)/i, "ningún alter table de tablas ajenas");
  assert.doesNotMatch(SQL_CODE, /\bdrop (table|function|column|schema|extension)\b/i, "ningún drop destructivo en la migración");
  assert.doesNotMatch(SQL_CODE, /\btruncate\b|\bdelete from (?!public\.billing_)/i);
  for (const drop of SQL_CODE.matchAll(/\bdrop (trigger|policy) if exists \w+ on ([\w.]+)/gi)) assert.match(drop[2], /^public\.billing_/, drop[0]);
  for (const create of SQL_CODE.matchAll(/\bcreate (table|index|unique index|trigger)\b[^;(]*/gi)) {
    if (/create trigger/i.test(create[0])) continue; // los triggers van precedidos de `drop trigger if exists`
    assert.match(create[0], /if not exists/i, create[0]);
  }
  for (const fn of SQL_CODE.matchAll(/\bcreate (or replace )?function ([\w.]+)/gi)) assert.ok(fn[1], `${fn[2]} usa create or replace`);
  for (const insert of SQL_CODE.matchAll(/insert into public\.(billing_\w+)[\s\S]*?;/gi)) {
    if (insert[1] === "billing_subscriptions" || insert[1] === "billing_plans" || insert[1] === "billing_settings") assert.match(insert[0], /on conflict/i, insert[1]);
  }
  // Los nombres de objetos nuevos son todos billing_* o triggers de las tablas billing_*.
  for (const object of SQL_CODE.matchAll(/create (?:or replace )?function public\.(\w+)/gi)) assert.match(object[1], /^billing_/, object[1]);
});

test("migraciones M1: RLS en TODAS las tablas, sin acceso de anon ni de PUBLIC, y la lectura propia sólo de estado y períodos", () => {
  for (const table of TABLES) assert.match(SQL_CODE, new RegExp(`alter table public\\.${table} enable row level security`), table);
  assert.doesNotMatch(SQL_CODE, /\bto (anon|public)\b/i, "ningún permiso ni política para anon/public");
  assert.doesNotMatch(SQL_CODE, /grant [^;]*\bto [^;]*\banon\b/i);
  const revoke = SQL_CODE.match(/revoke all on table ([\s\S]*?) from public, anon, authenticated;/);
  assert.ok(revoke);
  for (const table of TABLES) assert.match(revoke[1], new RegExp(`public\\.${table}\\b`), `revoke de ${table}`);
  // authenticated sólo recibe SELECT de columnas de dos tablas, y ninguna política de escritura existe.
  const authGrants = [...SQL_CODE.matchAll(/grant ([^;]*?) to authenticated;/gi)].map((m) => m[0].replace(/\s+/g, " "));
  assert.equal(authGrants.length, 2, authGrants.join("\n"));
  for (const grant of authGrants) assert.match(grant, /^grant select \([^)]+\) on public\.(billing_subscriptions|billing_periods) to authenticated;$/);
  assert.doesNotMatch(SQL_CODE, /create policy \w+ on public\.billing_\w+ for (insert|update|delete|all)/i, "ninguna política de escritura para usuarios");
  const policies = [...SQL_CODE.matchAll(/create policy (\w+) on public\.(billing_\w+) for select to authenticated using \(owner_id = auth\.uid\(\)\)/g)];
  assert.deepEqual(policies.map((m) => m[2]), ["billing_subscriptions", "billing_periods"]);
  // La lectura propia no incluye identificadores del proveedor.
  const subscriptionColumns = authGrants.find((g) => g.includes("billing_subscriptions")) ?? "";
  assert.doesNotMatch(subscriptionColumns, /provider_reference|provider_subscriber_uid|next_check_at|version|renewal_rejected/);
});

test("migraciones M1: toda función es de servidor (search_path vacío, SECURITY DEFINER sólo en billing_ensure_account) y SÓLO ejecutable por service_role", () => {
  const functions = [...SQL_CODE.matchAll(/create or replace function public\.(billing_\w+)\(([^)]*)\)([\s\S]*?)\n\$\$;/g)];
  assert.ok(functions.length >= 18, String(functions.length));
  for (const [, name, , body] of functions) {
    assert.match(body, /set search_path = ''/, `${name}: search_path vacío`);
    if (name === "billing_ensure_account") assert.match(body, /security definer/i, "lee auth.users.created_at");
    else assert.doesNotMatch(body, /security definer/i, `${name}: no usa SECURITY DEFINER`);
  }
  const callable = functions.map((f) => f[1]).filter((name) => !/^billing_(check_amount_vs_catalog|check_subscription_backed_by_payment|enforce_version_bump|forbid_owner_change)$/.test(name));
  for (const name of callable) {
    assert.match(SQL_CODE, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`), `${name}: revoke`);
    assert.match(SQL_CODE, new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`), `${name}: grant a service_role`);
  }
  assert.doesNotMatch(SQL_CODE, /grant execute on function[^;]*to (authenticated|anon|public)/i);
});

test("migraciones M1: NUNCA se guardan tarjetas, CVC, datos bancarios, tokens, secretos ni payloads crudos (ni columnas para ellos)", () => {
  const columns = [...SQL_CODE.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|int|bigint|boolean|timestamptz|jsonb|bytea|numeric)\b/gm)].map((m) => m[1]);
  assert.ok(columns.length > 80);
  for (const column of columns) assert.doesNotMatch(column, /card|cvc|cvv|^pan$|iban|cbu|token|secret|password|payload(?!_hash)|raw|email|dni|identification|phone|holder|address|full_name|customer/i, `columna sensible: ${column}`);
  // Hash e identificadores sí; el cuerpo, no.
  assert.match(SQL_CODE, /payload_hash text not null/);
  assert.match(SQL_CODE, /normalized jsonb not null check \(octet_length\(normalized::text\) <= 4096\)/);
  assert.match(SQL_CODE, /purge_after timestamptz not null default \(now\(\) \+ interval '90 days'\)/, "retención definida");
  assert.match(SQL_CODE, /billing_purge_retention/);
});

test("migraciones M1: integridad en la base (catálogo, cobro que respalda el estado, versión, propietaria inmutable, un solo intento y un solo cambio programado)", () => {
  assert.match(SQL_CODE, /billing_executions_catalog[\s\S]*billing_check_amount_vs_catalog/);
  assert.match(SQL_CODE, /billing_periods_catalog[\s\S]*billing_check_amount_vs_catalog/);
  assert.match(SQL_CODE, /billing_checkout_attempts_catalog[\s\S]*billing_check_amount_vs_catalog/);
  assert.match(SQL_CODE, /billing_check_subscription_backed_by_payment/);
  assert.match(SQL_CODE, /billing_enforce_version_bump/);
  assert.match(SQL_CODE, /billing_forbid_owner_change/);
  assert.match(SQL_CODE, /unique index if not exists billing_checkout_attempts_one_open_idx[^;]*where status = 'open'/);
  assert.match(SQL_CODE, /unique index if not exists billing_plan_changes_one_scheduled_idx[^;]*where kind = 'plan_change' and status = 'scheduled'/);
  assert.match(SQL_CODE, /constraint billing_executions_provider_uid_unique unique \(provider, execution_uid\)/);
  assert.match(SQL_CODE, /constraint billing_periods_provider_uid_unique unique \(provider, execution_uid\)/);
  assert.match(SQL_CODE, /dedup_key text not null unique/);
  assert.match(SQL_CODE, /provider_reference text not null unique/);
  assert.match(SQL_CODE, /provider_subscriber_uid text unique/);
  // Índices para las consultas calientes (reclamo de avisos, barrido del reloj, cobros por cuenta).
  for (const index of ["billing_webhook_events_claim_idx", "billing_webhook_events_lease_idx", "billing_subscriptions_next_check_idx", "billing_executions_owner_due_idx", "billing_periods_owner_end_idx", "billing_webhook_events_purge_idx"]) assert.match(SQL_CODE, new RegExp(index), index);
  assert.match(SQL_CODE, /for update skip locked/i, "reclamo con bloqueo acotado");
});

test("hay un script de rollback que elimina SÓLO objetos billing_* y no toca nada más", () => {
  const rollback = read("supabase/repairs/m1_billing_rollback.sql").replace(/--[^\n]*/g, "");
  for (const table of TABLES) assert.match(rollback, new RegExp(`drop table if exists public\\.${table}\\b`), table);
  for (const statement of rollback.matchAll(/\bdrop (table|function|trigger|policy)[^;]*;/gi)) assert.match(statement[0], /billing_/, statement[0]);
  assert.doesNotMatch(rollback, /auth\.users|drop schema|truncate|delete from/i);
});

test("las migraciones de facturación son posteriores a las existentes, van en orden y no hay marcas de tiempo repetidas", () => {
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  const billing = files.filter((f) => /_m[12]_billing/.test(f));
  assert.deepEqual(billing.map((f) => f.replace(/^[0-9]+_/, "")), ["m1_billing_core.sql", "m1_billing_functions.sql", "m2_billing_ops.sql"]);
  const previous = files.filter((f) => !/_m[12]_billing/.test(f));
  assert.ok(previous[previous.length - 1] < billing[0], "la facturación va después de todo lo existente");
  const stamps = files.map((f) => f.split("_")[0]);
  assert.equal(new Set(stamps).size, stamps.length);
});

test(".env.example documenta los interruptores APAGADOS y las credenciales sólo comentadas (sin ningún valor)", () => {
  const example = read(".env.example");
  assert.match(example, /^BILLING_ENABLED=false$/m);
  assert.match(example, /^BILLING_ENFORCEMENT_ENABLED=false$/m);
  for (const name of ["MOBBEX_API_KEY", "MOBBEX_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]) {
    assert.match(example, new RegExp(`^# ${name}=$`, "m"), `${name} sólo comentada y vacía`);
    assert.doesNotMatch(example, new RegExp(`^${name}=`, "m"), name);
  }
});

test("la documentación de M1 existe y contiene lo prometido: estados, amenazas, escala, comisión y netos", () => {
  const doc = read("docs/billing/M1_ARQUITECTURA.md");
  for (const heading of ["Auditoría previa", "Máquina de estados", "Tabla de amenazas", "Escala", "Comisión", "Decisiones abiertas"]) assert.match(doc, new RegExp(heading, "i"), heading);
  for (const net of ["23.724,97", "66.601,42", "127.581,26", "237.249,69"]) assert.match(doc, new RegExp(net.replace(/\./g, "\\.")), net);
  for (const status of ["grandfathered", "pending", "active", "past_due", "grace_period", "limited", "cancel_at_period_end", "canceled", "expired"]) assert.match(doc, new RegExp(status), status);
  assert.match(doc, /4,719/);
  assert.match(doc, /retenciones y percepciones/i);
});
