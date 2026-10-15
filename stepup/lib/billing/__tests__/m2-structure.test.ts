import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PRIVATE_ROUTE_PREFIXES } from "../../auth/safe-redirect.ts";
import { PRIMARY_NAV_ITEMS } from "../../nav/primary-nav-items.ts";

/**
 * Guardas estructurales de M2 (leen el código fuente). Fijan lo que NO debe cambiar sin una decisión explícita:
 *  - con los interruptores APAGADOS la aplicación actual no cambia (rutas inexistentes, menú idéntico, eliminación de cuenta igual);
 *  - las rutas de avisos y de trabajos programados son cerradas (método, tipo, tamaño, secreto, 404 apagadas);
 *  - ninguna pantalla ni acción activa una suscripción por una redirección, un parámetro o un dato del navegador;
 *  - el documento y el nombre del pago no se guardan, registran ni se rellenan solos.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute)) {
    const path = join(absolute, entry);
    if (statSync(path).isDirectory()) walk(`${dir}/${entry}`, accept, out);
    else if (accept(entry)) out.push(`${dir}/${entry}`);
  }
  return out;
}

const PAGES = ["app/(app)/facturacion/page.tsx", "app/(app)/facturacion/planes/page.tsx", "app/(app)/facturacion/resultado/page.tsx"];
const ROUTES = ["app/api/billing/webhooks/mobbex/route.ts", "app/api/billing/cron/process/route.ts", "app/api/billing/cron/reconcile/route.ts"];

test("CON LOS INTERRUPTORES APAGADOS las pantallas de facturación no existen: cada una pide los datos y responde 404 si vienen vacíos", () => {
  for (const file of PAGES) {
    const source = code(file);
    assert.match(source, /const data = await loadBillingPageData\(/, file);
    assert.match(source, /if \(!data\) notFound\(\);/, file);
    assert.ok(source.indexOf("notFound()") < source.indexOf("data."), `${file}: el 404 va antes de usar los datos`);
  }
  const loader = code("lib/billing/page-data.ts");
  assert.match(loader, /if \(!runtime\.flags\.enabled\) return null;/);
  assert.ok(loader.indexOf("flags.enabled) return null") < loader.indexOf("requireAuthenticatedDbContext()", loader.indexOf("loadBillingPageData")), "los interruptores se miran antes de tocar la sesión o la base");
});

test("CON LOS INTERRUPTORES APAGADOS las rutas de API responden 404 ANTES de leer el cuerpo, el secreto o la base", () => {
  for (const file of ROUTES) {
    const full = code(file);
    const source = full.slice(full.indexOf("async function handle"));
    const flag = source.indexOf("getBillingFlags().enabled");
    assert.ok(flag > 0, file);
    for (const later of ["getBillingRuntime()", "readBodyLimited", "bearerMatches", "processorDeps", "request.headers"]) {
      const at = source.indexOf(later);
      if (at >= 0) assert.ok(flag < at, `${file}: «${later}» no puede ir antes del interruptor`);
    }
    assert.match(source, /404/, file);
    assert.match(full, /export const dynamic = "force-dynamic";/, file);
    assert.match(full, /export const maxDuration = \d+;/, file);
  }
});

test("la barra lateral sólo ofrece «Facturación» con el interruptor encendido: la propiedad nace en falso y el elemento está detrás de ella; la barra principal no cambia", () => {
  assert.match(code("components/nav/primary-nav.tsx"), /billingEnabled = false/);
  assert.match(code("components/nav/primary-nav.tsx"), /\{billingEnabled && \(/);
  assert.doesNotMatch(code("components/nav/sign-out-button.tsx"), /billing|facturaci/i, "«Cerrar sesión» no sabe nada de facturación");
  assert.deepEqual(PRIMARY_NAV_ITEMS.map((item) => item.href), ["/inicio", "/alumnos", "/calendario", "/cobros", "/registro"], "los cinco destinos principales de siempre");
  assert.match(code("components/account/delete-account-button.tsx"), /billingEnabled = false/);
  assert.match(code("components/account/delete-account-button.tsx"), /\{billingEnabled && \(/);
  assert.match(code("components/account/configuration-view.tsx"), /billingEnabled = false/);
  assert.match(code("app/(app)/layout.tsx"), /readBillingFlags\(process\.env\)\.enabled/);
});

test("la eliminación de cuenta agrega el paso de facturación SÓLO con el interruptor encendido (apagado, el flujo es exactamente el de siempre)", () => {
  const action = code("lib/actions/account.ts");
  assert.match(action, /cancelBilling: getBillingFlags\(\)\.enabled\s*\?/);
  assert.match(action, /:\s*undefined,/);
  const flow = code("lib/account/delete-account-flow.ts");
  assert.ok(flow.indexOf("deps.cancelBilling") < flow.indexOf("deps.removePdfs()"), "la cancelación se confirma ANTES de borrar PDF y cuenta");
  assert.ok(flow.indexOf("deps.cancelBilling") > flow.indexOf("deps.verifyPassword"), "y después de reautenticar");
  assert.ok(flow.indexOf("deps.removePdfs()") < flow.indexOf("deps.deleteAccount()"));
});

test("la ruta de pantallas privadas incluye /facturacion (el proxy exige sesión) y la lista coincide con las carpetas reales de app/(app)", () => {
  const folders = readdirSync(join(ROOT, "app/(app)")).filter((entry) => statSync(join(ROOT, "app/(app)", entry)).isDirectory());
  assert.deepEqual([...PRIVATE_ROUTE_PREFIXES].map((p) => p.slice(1)).sort(), folders.sort());
  assert.ok((PRIVATE_ROUTE_PREFIXES as readonly string[]).includes("/facturacion"));
  assert.doesNotMatch(read("proxy.ts"), /billing|facturacion/i, "el proxy no sabe nada de facturación");
});

test("receptor de avisos: POST/GET/… delegan en una sola función; sin autenticación inventada (no hay firma ni secreto de Mobbex); límites antes de interpretar", () => {
  const route = code("app/api/billing/webhooks/mobbex/route.ts");
  for (const method of ["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) assert.match(route, new RegExp(`export const ${method} = handle;`), method);
  assert.doesNotMatch(route, /signature|hmac|secret|x-mobbex|authorization/i, "ningún mecanismo de firma inventado");
  const whole = code("lib/billing/webhook-ingest.ts");
  const ingest = whole.slice(whole.indexOf("export async function ingestNotice"));
  const order = ["deps.flags.enabled", 'request.method !== "POST"', "deps.limiter.check", "415", "MAX_BODY_BYTES", "request.readBody", "parseNotice"].map((needle) => ingest.indexOf(needle));
  assert.ok(order.every((index) => index >= 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "orden: interruptor → método → frecuencia → tipo → tamaño → lectura → análisis");
  assert.doesNotMatch(ingest, /verifyWebhook|signature/i);
});

test("trabajos programados: exigen el secreto con comparación en tiempo constante, aceptan GET (cron de la plataforma) y POST, y NO están declarados en la configuración de Vercel (los cron se declaran al activar)", () => {
  for (const file of ROUTES.slice(1)) {
    const source = code(file);
    assert.match(source, /bearerMatches\(request\.headers\.get\("authorization"\), process\.env\.CRON_SECRET\)/, file);
    assert.match(source, /export const GET = handle;/);
    assert.match(source, /export const POST = handle;/);
    assert.ok(source.indexOf("401") > source.indexOf("404"), `${file}: apagado → 404 antes que 401`);
  }
  // `vercel.json` PUEDE existir (hoy fija las Vercel Functions en São Paulo), pero no habilita rutas, cron ni capacidades de facturación.
  assert.ok(existsSync(join(ROOT, "vercel.json")), "vercel.json existe legítimamente para fijar la región de las funciones");
  const vercelRaw = read("vercel.json");
  const vercel = JSON.parse(vercelRaw) as Record<string, unknown>;
  assert.deepEqual(vercel.regions, ["gru1"], "la región sigue siendo sólo gru1");
  assert.deepEqual(Object.keys(vercel).sort(), ["$schema", "regions"], "sólo el esquema y la región: nada más se configura desde este archivo");
  for (const key of ["crons", "rewrites", "redirects", "headers", "routes", "functions", "env", "build", "builds", "cleanUrls"]) {
    assert.equal(vercel[key], undefined, `vercel.json no declara «${key}»: no habilita rutas, cron ni capacidades de facturación`);
  }
  assert.doesNotMatch(vercelRaw, /billing|facturaci|webhook|mobbex|\/api\//i, "vercel.json no menciona rutas ni capacidades de facturación");
  // Ningún secreto ni credencial en la configuración versionada.
  // (El ejemplo de cron es documentación inactiva: nombra la variable CRON_SECRET en un comentario pero no contiene ningún valor.)
  for (const file of ["vercel.json", "next.config.mjs", "package.json", ".vercelignore"]) {
    const config = read(file);
    assert.doesNotMatch(config, /MOBBEX_|SERVICE_ROLE|service[_-]role|CRON_SECRET|API[_-]?KEY|ACCESS[_-]?TOKEN|sk_(?:live|test)_|eyJ[A-Za-z0-9_-]{10,}/i, `${file}: sin credenciales Mobbex, service role ni CRON_SECRET`);
  }
  // La facturación depende de sus interruptores y variables de entorno del servidor, no de la configuración de la plataforma.
  const flags = read("lib/billing/flags.ts");
  assert.match(flags, /const enabled = isOn\(env\.BILLING_ENABLED\);/);
  assert.match(flags, /const enforcement = enabled && isOn\(env\.BILLING_ENFORCEMENT_ENABLED\);/);
  for (const file of ROUTES.slice(1)) assert.match(code(file), /if \(!getBillingFlags\(\)\.enabled\) return NextResponse\.json\(\{ ok: false \}, \{ status: 404/, `${file}: apagada → 404`);
  assert.match(code(ROUTES[0]), /if \(!getBillingFlags\(\)\.enabled\) return respond\(\{ status: 404, body: \{ ok: false \} \}\);/, "el webhook apagado → 404");
  assert.ok(existsSync(join(ROOT, "docs/billing/vercel-cron.example.json")));
  const example = JSON.parse(read("docs/billing/vercel-cron.example.json"));
  assert.deepEqual(example.crons.map((c: { path: string }) => c.path), ["/api/billing/cron/process", "/api/billing/cron/reconcile"]);
});

test("VOLVER del proveedor no activa nada: la pantalla de resultado ignora la URL de retorno y sólo muestra el estado guardado", () => {
  const page = code("app/(app)/facturacion/resultado/page.tsx");
  assert.doesNotMatch(page, /searchParams\.(status|payment|result|id|reference|total|state)|params\.get\(/);
  assert.doesNotMatch(page, /commitBatch|startCheckout|ensureAccount|status\s*[:=]\s*["']active["']|cookies\(\)/);
  assert.match(page, /await searchParams/);
  const loader = code("lib/billing/page-data.ts");
  assert.match(loader, /escenario/);
  assert.match(loader, /demoScenariosAllowed\(process\.env\)/, "el parámetro de demostración sólo se honra donde corresponde");
  for (const file of ["lib/actions/billing.ts"]) {
    const source = code(file);
    assert.doesNotMatch(source, /status:\s*["']active["']|currentPeriodEnd\s*[:=]/);
    for (const match of source.matchAll(/export async function (\w+)\(([^)]*)\)/g)) assert.doesNotMatch(match[2], /ownerId|owner_id|userId|price|amount|currency|period|status/i, `${match[1]} no recibe datos de cuenta, precio ni estado del navegador`);
  }
});

test("el DOCUMENTO y el NOMBRE del pago: sin autocompletar, sin atributos de nombre, sin almacenamiento del navegador, sin registro, sin eco en errores y borrados al crear el pago", () => {
  const picker = code("components/billing/plan-picker.tsx");
  assert.match(picker, /id="pago-documento"[\s\S]{0,400}autoComplete="off"/);
  assert.match(picker, /id="pago-nombre"[\s\S]{0,300}autoComplete="off"/);
  assert.doesNotMatch(picker, /localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  assert.doesNotMatch(picker, /name="(documento|dni|identification|cuit|nombre|name)"/i, "sin atributo name: el navegador no lo recuerda ni lo envía en un formulario nativo");
  assert.ok(picker.indexOf("clearPersonalData();") < picker.indexOf("window.location.assign"), "se borra ANTES de salir hacia el sitio de pago");
  assert.match(picker, /setName\(""\);\s*setIdentification\(""\);/);
  const actions = code("lib/actions/billing.ts");
  assert.doesNotMatch(actions, /logBilling\([^)]*(identification|customer)/);
  assert.doesNotMatch(actions, /console\./);
  const customer = code("lib/billing/customer.ts");
  assert.doesNotMatch(customer, /\$\{[^}]*(identification|name)[^}]*\}/, "ningún mensaje interpola lo escrito");
  // Ninguna tabla ni función de la base conoce un campo de documento.
  for (const file of walk("supabase/migrations", (name) => /billing/.test(name))) assert.doesNotMatch(read(file), /identification|dni|cuit/i, file);
});

test("los mensajes visibles de las pantallas no filtran códigos internos ni el costo del servicio de cobro", () => {
  for (const file of [...PAGES, ...walk("components/billing", (name) => name.endsWith(".tsx")), "lib/billing/view.ts", "lib/billing/safe-errors.ts"]) {
    const source = code(file);
    assert.doesNotMatch(source, /4[,.]719|3[,.]9\s?%|23\.724|comisi[oó]n/i, `${file}: no se muestra el neto ni la comisión`);
  }
});

test("las variables nuevas son sólo del servidor y están documentadas APAGADAS/vacías en .env.example", () => {
  const example = read(".env.example");
  assert.match(example, /^BILLING_ENABLED=false$/m);
  assert.match(example, /^BILLING_ENFORCEMENT_ENABLED=false$/m);
  assert.match(example, /^BILLING_PROVIDER=mobbex$/m);
  for (const name of ["CRON_SECRET", "BILLING_STATE_COOKIE_SECRET", "BILLING_GRANDFATHER_CUTOFF", "MOBBEX_VALIDATED_CAPABILITIES"]) {
    assert.match(example, new RegExp(`^# ${name}=$`, "m"), `${name} sólo comentada y vacía`);
    assert.doesNotMatch(example, new RegExp(`^${name}=`, "m"), name);
  }
});

test("los trabajos programados y la recepción no importan nada de pantallas ni acciones; el procesamiento no escribe registros con datos de personas", () => {
  for (const file of [...ROUTES, "lib/billing/jobs.ts", "lib/billing/processor.ts", "lib/billing/webhook-ingest.ts"]) assert.doesNotMatch(read(file), /@\/components|\/actions\/|next\/headers|cookies\(/, file);
  for (const file of ["lib/billing/processor.ts", "lib/billing/jobs.ts", "lib/billing/account-deletion.ts", "lib/billing/customer.ts", "lib/billing/http.ts", "lib/billing/rate-limit.ts"]) assert.doesNotMatch(code(file), /console\./, file);
});

test("la documentación de M2 existe con lo prometido", () => {
  const doc = read("docs/billing/M2_ARQUITECTURA.md");
  for (const heading of ["Rutas", "Receptor de avisos", "Trabajadores y cron", "Pantallas", "Sandbox", "Ensayo SQL", "Escala", "Requisitos externos pendientes", "Decisiones"]) assert.match(doc, new RegExp(heading, "i"), heading);
  assert.ok(existsSync(join(ROOT, "docs/billing/M1_DECISIONES.md")));
});
