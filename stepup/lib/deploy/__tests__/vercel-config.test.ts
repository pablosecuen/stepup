import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Región de las Vercel Functions: una sola, `gru1` (São Paulo), la misma que la base de Supabase (`sa-east-1`): antes corrían en
 * `iad1` (Washington) y cada consulta cruzaba el continente. Una sola región (el plan Pro admite hasta cinco; sin conmutación por
 * error de Enterprise). Todo lo demás de la configuración previa debe seguir intacto.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("vercel.json fija UNA sola región, gru1, y no agrega nada más (sin otras regiones, funciones, cron ni reescrituras)", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.deepEqual(config.regions, ["gru1"]);
  assert.deepEqual(Object.keys(config).sort(), ["$schema", "regions"], "sólo el esquema oficial y la región");
  assert.equal(config.$schema, "https://openapi.vercel.sh/vercel.json");
  assert.ok(Array.isArray(config.regions) && config.regions.length === 1, "una región: ni varias ni conmutación por error");
  assert.ok(config.regions.every((region: unknown) => typeof region === "string" && /^[a-z]{3}\d$/.test(region as string)));
});

test("la configuración previa sigue presente: cabeceras de seguridad y sin X-Powered-By en next.config, ejemplo de cron inactivo, nada excluye vercel.json", () => {
  const next = read("next.config.mjs");
  assert.match(next, /poweredByHeader: false/);
  assert.match(next, /buildSecurityHeaders\(\{ captchaOrigin: captchaOriginFromEnv\(\) \}\)/);
  assert.match(next, /source: "\/:path\*"/);
  // No hay cron activo (la facturación está apagada): el ejemplo sigue siendo sólo documentación y NO es vercel.json.
  assert.equal(JSON.parse(read("vercel.json")).crons, undefined);
  assert.equal(existsSync(join(ROOT, "docs/billing/vercel-cron.example.json")), true);
  assert.deepEqual(JSON.parse(read("docs/billing/vercel-cron.example.json")).crons.map((cron: { path: string }) => cron.path), ["/api/billing/cron/process", "/api/billing/cron/reconcile"]);
  // El despliegue por CLI no puede dejar afuera la configuración.
  assert.doesNotMatch(read(".vercelignore"), /^\/?vercel\.json$/m);
  // La región del código coincide con la documentada para Supabase (sa-east-1 ⇒ São Paulo).
  assert.match(read("docs/design/web-v1/13-usabilidad-y-navegacion.md"), /sa-east-1/);
});
