import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PRIVATE_ROUTE_PREFIXES, DEFAULT_AUTH_REDIRECT, RECOVERY_PASSWORD_PATH, isPrivatePath, sanitizeNextPath } from "../safe-redirect.ts";
import { resolvePrivateAreaAccess } from "../route-protection.ts";

/**
 * Cierre de la web — a dónde se vuelve tras iniciar sesión. Un único listado de rutas privadas (las carpetas de `app/(app)/`) decide
 * a la vez qué protege `proxy.ts` y a qué rutas puede volver un `next`. Faltaban `/resumen-financiero` y `/recordatorios`: sin sesión,
 * el login volvía a `/inicio`.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function folders(path: string): string[] {
  return readdirSync(join(ROOT, path)).filter((entry) => statSync(join(ROOT, path, entry)).isDirectory());
}

test("la lista de rutas privadas es EXACTAMENTE la de las carpetas de app/(app)/ (si se agrega una pantalla privada, esta prueba obliga a listarla)", () => {
  const real = folders("app/(app)").map((name) => `/${name}`).sort();
  assert.deepEqual([...PRIVATE_ROUTE_PREFIXES].sort(), real);
  assert.ok(real.includes("/resumen-financiero") && real.includes("/recordatorios"));
});

test("ninguna ruta pública (fuera de app/(app)/) figura como privada, y las privadas no cuelgan de una pública", () => {
  const privateFolders = new Set(folders("app/(app)").map((name) => `/${name}`));
  for (const name of folders("app")) {
    if (name === "(app)") continue;
    const route = `/${name}`;
    assert.equal(privateFolders.has(route), false, `${route} existe en las dos zonas`);
    assert.equal(isPrivatePath(route), false, `${route} es pública`);
    assert.equal(isPrivatePath(`${route}/algo`), false);
  }
  for (const route of ["/", "/login", "/crear-cuenta", "/recuperar-contrasena", "/nueva-contrasena", "/iniciando-sesion", "/auth/callback", "/auth/confirm", "/auth/error"]) {
    assert.equal(isPrivatePath(route), false, route);
  }
});

const SAMPLES: Record<string, string[]> = {
  "/inicio": ["/inicio"],
  "/alumnos": ["/alumnos", "/alumnos/nuevo", "/alumnos/8f1b2c3d-1111-2222-3333-444455556666?tab=cobros", "/alumnos?q=ana&status=activo"],
  "/calendario": ["/calendario", "/calendario?week=2026-10-05", "/calendario/series", "/calendario/nueva", "/calendario/disponibilidad"],
  "/cobros": ["/cobros", "/cobros?mes=2026-10"],
  "/configuracion": ["/configuracion", "/configuracion/respaldo"],
  "/recordatorios": ["/recordatorios"],
  "/registro": ["/registro", "/registro/nuevo", "/registro/libre/abc"],
  "/resumen-financiero": ["/resumen-financiero", "/resumen-financiero?periodo=3m"],
};

test("sin sesión, CADA ruta privada vuelve a sí misma tras el login (con su ruta y su consulta), no a /inicio", () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...PRIVATE_ROUTE_PREFIXES].sort(), "hay ejemplos para todas");
  for (const samples of Object.values(SAMPLES)) {
    for (const sample of samples) {
      const [pathname, query] = sample.split("?");
      assert.equal(isPrivatePath(pathname), true, `${pathname} es privada (el proxy la protege)`);
      const decision = resolvePrivateAreaAccess({ configured: true, hasSession: false, pathname, search: query ? `?${query}` : "" });
      assert.equal(decision.kind, "redirect");
      if (decision.kind !== "redirect") continue;
      assert.match(decision.to, /^\/login\?next=/);
      const next = decodeURIComponent(decision.to.slice("/login?next=".length));
      assert.equal(next, sample, `${sample} se conserva`);
      assert.equal(sanitizeNextPath(next), sample, `el login acepta volver a ${sample}`);
    }
  }
});

test("el caso reportado: /resumen-financiero sin sesión → /login?next=/resumen-financiero → vuelve a /resumen-financiero", () => {
  const decision = resolvePrivateAreaAccess({ configured: true, hasSession: false, pathname: "/resumen-financiero" });
  assert.deepEqual(decision, { kind: "redirect", to: "/login?next=%2Fresumen-financiero" });
  assert.equal(sanitizeNextPath("%2Fresumen-financiero"), "/resumen-financiero");
  assert.equal(sanitizeNextPath("/resumen-financiero?periodo=3m"), "/resumen-financiero?periodo=3m");
  assert.equal(sanitizeNextPath("/recordatorios"), "/recordatorios");
});

test("con sesión se autoriza, y sin configuración nunca se bloquea (también las dos rutas que faltaban)", () => {
  for (const pathname of ["/resumen-financiero", "/recordatorios"]) {
    assert.deepEqual(resolvePrivateAreaAccess({ configured: true, hasSession: true, pathname }), { kind: "allow" });
    assert.deepEqual(resolvePrivateAreaAccess({ configured: false, hasSession: false, pathname }), { kind: "local-only" });
  }
});

// ---------------------------------------------------------------------------
// Protección contra redirecciones externas, URLs maliciosas y rutas no permitidas
// ---------------------------------------------------------------------------

const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const NEL = String.fromCharCode(0x85);

const MALICIOUS = [
  "https://evil.example.com",
  "http://evil.example.com/inicio",
  "//evil.example.com",
  "///evil.example.com",
  "/\\evil.example.com",
  "\\\\evil.example.com",
  "/inicio\\@evil.example.com",
  `/${TAB}/evil.example.com`,
  `/${LF}/evil.example.com`,
  `/${CR}/evil.example.com`,
  `/inicio${TAB}`,
  `/inicio${LF}`,
  `/alumnos${NUL}`,
  `/alumnos${NEL}`,
  "/%09/evil.example.com",
  "/%0a/evil.example.com",
  "/%0d/evil.example.com",
  "/inicio%00",
  "/%2F/evil.example.com",
  "%2F%2Fevil.example.com",
  "%252F%252Fevil.example.com",
  "/inicio/../login",
  "/alumnos/%2e%2e/login",
  "/alumnos/%2E%2E/%2E%2E/auth/callback",
  "/calendario/./../../x",
  "/inicio@evil.example.com",
  "/inicio.evil.example.com",
  "/inicioX",
  "/alumnos-secreto",
  "/resumen-financiero-x",
  "/resumen-financierox/evil",
  "javascript:alert(1)",
  "/javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "/data:text/html,x",
  "vbscript:msgbox(1)",
  " /inicio",
  "inicio",
  "./inicio",
  "../inicio",
  "/login",
  "/crear-cuenta",
  "/auth/callback?code=x",
  "/auth/confirm",
  "/iniciando-sesion",
  "/api/algo",
  "/_next/static/x",
  "/admin",
  "/",
  "",
  "%",
  "%E0%A4%A",
  "/inicio?next=https://evil.example.com",
];

test("un next malicioso, externo, con caracteres de control o fuera de las rutas permitidas siempre cae en el destino por defecto", () => {
  for (const raw of MALICIOUS) {
    const result = sanitizeNextPath(raw);
    assert.equal(result, DEFAULT_AUTH_REDIRECT, JSON.stringify(raw));
  }
  assert.equal(sanitizeNextPath(null), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath(undefined), DEFAULT_AUTH_REDIRECT);
});

test("defensa en profundidad: aun dentro de una ruta permitida se rechazan barras invertidas, caracteres de control y segmentos «..»", () => {
  assert.equal(sanitizeNextPath("/inicio?a\\b"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath(`/alumnos?x=${TAB}`), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath(`/alumnos?x=${LF}y`), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("/alumnos?x=%0d%0aSet-Cookie:a=b"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("/calendario/../cobros"), DEFAULT_AUTH_REDIRECT);
  assert.equal(sanitizeNextPath("/calendario?back=../x"), "/calendario?back=../x", "los «..» de la consulta no son segmentos de ruta");
});

test("el fallback explícito también se respeta, y el resultado NUNCA es una URL fuera del sitio (siempre «/» + algo, nunca «//»)", () => {
  assert.equal(sanitizeNextPath("https://evil.example.com", "/cobros"), "/cobros");
  for (const raw of [...MALICIOUS, "/alumnos", "/resumen-financiero?x=1", "%2Frecordatorios", "/registro/nuevo"]) {
    const result = sanitizeNextPath(raw);
    assert.ok(result.startsWith("/") && !result.startsWith("//") && !result.includes("\\") && !/^\/[a-z]+:/i.test(result), JSON.stringify([raw, result]));
    assert.equal(
      PRIVATE_ROUTE_PREFIXES.some((p) => result === p || result.startsWith(`${p}/`) || result.startsWith(`${p}?`)) || result === DEFAULT_AUTH_REDIRECT,
      true,
      `${result} es una ruta privada permitida`,
    );
  }
});

test("lo legítimo se conserva: rutas privadas con subruta y consulta, codificadas o no; y la ruta exacta de recuperación", () => {
  // Una consulta que contiene «//» sigue siendo una ruta DEL SITIO (no cambia de origen): se conserva.
  assert.equal(sanitizeNextPath("/alumnos?redirect=//evil.example.com"), "/alumnos?redirect=//evil.example.com");
  assert.equal(sanitizeNextPath("/alumnos/abc?tab=cobros"), "/alumnos/abc?tab=cobros");
  assert.equal(sanitizeNextPath(encodeURIComponent("/alumnos/abc?tab=cobros")), "/alumnos/abc?tab=cobros");
  assert.equal(sanitizeNextPath("/calendario?week=2026-10-05"), "/calendario?week=2026-10-05");
  assert.equal(sanitizeNextPath("/registro/libre/abc"), "/registro/libre/abc");
  assert.equal(sanitizeNextPath(RECOVERY_PASSWORD_PATH), RECOVERY_PASSWORD_PATH);
  assert.equal(sanitizeNextPath(`${RECOVERY_PASSWORD_PATH}/x`), DEFAULT_AUTH_REDIRECT, "sólo la ruta exacta de recuperación");
  assert.equal(sanitizeNextPath("/inicio.html"), DEFAULT_AUTH_REDIRECT);
});

// ---------------------------------------------------------------------------
// Cableado: el proxy, el layout, el login y la acción usan la misma regla
// ---------------------------------------------------------------------------

test("cableado: el proxy protege lo que lista isPrivatePath y conserva ruta y consulta; el layout y el login saneán siempre", () => {
  const proxy = code("proxy.ts");
  assert.match(proxy, /if \(!isPrivatePath\(pathname\)\) \{\s*return response;\s*\}/);
  assert.match(proxy, /resolvePrivateAreaAccess\(\{[\s\S]*?pathname,\s*search: request\.nextUrl\.search,/);
  const safe = code("lib/auth/safe-redirect.ts");
  assert.match(safe, /const ALLOWED_NEXT_PREFIXES = PRIVATE_ROUTE_PREFIXES;/, "una sola lista");
  assert.equal((safe.match(/"\/resumen-financiero"/g) ?? []).length, 1);
  assert.match(code("lib/auth/actions.ts"), /redirect\(sanitizeNextPath\(nextParam\)\)/);
  assert.match(code("app/login/page.tsx"), /const next = sanitizeNextPath\(rawNext\);/);
  assert.match(code("app/(app)/layout.tsx"), /resolvePrivateAreaAccess\(\{ configured, hasSession, pathname: "\/inicio" \}\)/, "la segunda capa del layout se conserva");
  assert.match(code("lib/auth/recovery-session.ts"), /const next = sanitizeNextPath\(input\.next\);/);
  assert.match(code("app/auth/callback/route.ts"), /\$\{origin\}\$\{outcome\.redirectTo\}/, "el callback sólo redirige a una ruta, nunca a una URL");
});
