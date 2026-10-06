import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * R1 — el «fallar cerrado» y el origen canónico están CONECTADOS donde corresponde. El comportamiento real (503 sin
 * variables, correos que no salen sin origen válido) se comprueba contra un servidor de producción local; acá se vigila que
 * nadie quite el cableado.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("proxy.ts: en Production sin configuración válida una ruta privada recibe el 503 controlado (no el modo local)", () => {
  const source = read("proxy.ts");
  assert.match(source, /if \(shouldFailClosed\(\) && isPrivatePath\(pathname\)\) \{[\s\S]*?return serviceUnavailableResponse\(\);/);
  assert.match(source, /reportConfigUnavailable\(getSupabaseConfigState\(\)\)/);
});

test("el layout privado no abre el área sin configuración válida en Production", () => {
  assert.match(read("app/(app)/layout.tsx"), /if \(!configured && shouldFailClosed\(\)\) return <AuthNotConfigured \/>;/);
});

test("el 503 controlado no nombra variables, proveedores ni valores", async () => {
  const { SERVICE_UNAVAILABLE_HTML, serviceUnavailableResponse } = await import("../service-unavailable.ts");
  assert.doesNotMatch(SERVICE_UNAVAILABLE_HTML, /supabase|NEXT_PUBLIC|vercel|variable|env|config/i);
  const response = serviceUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "60");
});

test("los correos de alta/recuperación salen sólo con origen canónico: getSiteOrigin ya no deriva el origen de X-Forwarded-Host en Production", () => {
  const source = read("lib/auth/site-url.ts");
  assert.doesNotMatch(source, /x-forwarded-host/i);
  assert.match(source, /resolveSiteOrigin\(\)/);
  assert.match(source, /throw new SiteOriginUnavailableError\(resolved\.reason\)/);
  const adapter = read("lib/auth/supabase-auth-adapter.ts");
  assert.equal((adapter.match(/await siteOriginOrNull\(\)/g) ?? []).length, 3, "alta, reenvío y recuperación");
  assert.equal((adapter.match(/if \(origin === null\) return ORIGIN_UNAVAILABLE;/g) ?? []).length, 3, "sin origen válido no se llama a Supabase");
  assert.doesNotMatch(adapter, /\$\{origin\}\/[a-z-]+`[\s\S]{0,40}localhost/);
});

test("ningún código imprime variables de entorno ni sus valores en logs", () => {
  for (const file of ["lib/auth/config.ts", "lib/auth/site-url.ts", "lib/auth/service-unavailable.ts", "proxy.ts"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const m of source.matchAll(/console\.\w+\(([^;]*)\)/g)) {
      assert.doesNotMatch(m[1], /process\.env|NEXT_PUBLIC|\burl\b|publishableKey|raw\b/i, `${file}: ${m[0]}`);
    }
  }
});
