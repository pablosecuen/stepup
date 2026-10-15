import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * Guardas estructurales: UN solo `<main id="contenido">` por pantalla (también sin Supabase configurado), esqueletos de carga
 * identificados, Inicio sin loading.tsx y el redirect de recuperación B0 intacto. El HTML real se comprobó además contra un
 * servidor local sin variables de Supabase y con ellas (ver docs/design/web-v1/12-bloque-7.md, «Limitaciones»).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

const ALL = [...sources("app"), ...sources("components")];
const PRIVATE_PAGES = sources("app/(app)").filter((file) => /\/(page|loading|error|not-found)\.tsx$/.test(file));

// Los ÚNICOS archivos que dibujan un <main>: el shell privado (que envuelve a todas las pantallas privadas, su carga, su error y su
// «no encontrado») y las páginas/estados que NO están dentro de él (públicas, de autenticación, errores y 404 de la raíz).
const MAIN_OWNERS = [
  "app/(app)/layout.tsx",
  "app/global-error.tsx",
  "app/iniciando-sesion/page.tsx",
  "app/page.tsx",
  "components/auth/auth-shell.tsx",
  "components/ui/not-found-view.tsx",
  "components/ui/route-error.tsx",
];

test("sólo los archivos aprobados dibujan un <main>; y todo <main> es el destino de «Saltar al contenido»", () => {
  const owners = ALL.filter((file) => /<main\b/.test(code(file))).sort();
  assert.deepEqual(owners, [...MAIN_OWNERS].sort());
  for (const file of owners) {
    const source = code(file);
    const tags = source.match(/<main\b[^>]*>/g) ?? [];
    for (const tag of tags) assert.ok(/id="contenido"/.test(tag) && /tabIndex=\{-1\}/.test(tag), `${file}: <main> sin id="contenido" y tabIndex={-1}`);
  }
});

test("el id «contenido» sólo existe en un <main> (identificador único, nunca en otro elemento)", () => {
  for (const file of ALL) {
    const source = code(file);
    for (const match of source.matchAll(/<(\w+)\b[^>]*\bid="contenido"/g)) assert.equal(match[1], "main", `${file}: id="contenido" en <${match[1]}>`);
  }
  assert.match(read("components/ui/skip-link.tsx"), /MAIN_CONTENT_ID = "contenido"/);
  assert.match(read("components/ui/skip-link.tsx"), /Saltar al contenido/);
  assert.match(code("app/layout.tsx"), /<SkipLink \/>\s*\{children\}/, "«Saltar al contenido» sigue siendo lo primero de la página");
});

test("ninguna pantalla, carga, error ni «no encontrado» DENTRO del shell privado dibuja su propio <main> ni un id repetido", () => {
  for (const file of PRIVATE_PAGES) {
    assert.doesNotMatch(code(file), /<main\b|id="contenido"/, file);
  }
  const layout = code("app/(app)/layout.tsx");
  assert.equal((layout.match(/<main\b/g) ?? []).length, 1, "el shell privado tiene exactamente un <main>");
  // Error y «no encontrado» del shell usan la variante «inShell» (un <div>, no otro <main>).
  assert.match(code("app/(app)/error.tsx"), /\binShell\b/);
  assert.match(code("app/(app)/not-found.tsx"), /\binShell\b/);
  assert.match(code("app/(app)/alumnos/not-found.tsx"), /\binShell\b/);
  assert.match(code("app/(app)/registro/not-found.tsx"), /\binShell\b/);
  assert.match(code("app/error.tsx"), /inShell=\{false\}/);
  assert.match(code("app/not-found.tsx"), /inShell=\{false\}/);
});

test("«cuenta no disponible» (Supabase sin configurar): dentro del shell privado usa `inShell` (sin <main> anidado); fuera de él, la tarjeta es el <main>", () => {
  const shell = code("components/auth/auth-shell.tsx");
  assert.match(shell, /const Wrapper = inShell \? "div" : "main";/);
  assert.match(shell, /const wrapperProps = inShell \? \{\} : \{ id: "contenido", tabIndex: -1 \};/);
  assert.match(code("components/auth/auth-not-configured.tsx"), /inShell=\{inShell\}/);
  for (const file of sources("app/(app)").filter((f) => f.endsWith("page.tsx"))) {
    const source = code(file);
    for (const match of source.matchAll(/<AuthNotConfigured([^>]*)\/>/g)) assert.match(match[1], /\binShell\b/, `${file}: dentro del shell debe ser <AuthNotConfigured inShell />`);
  }
  for (const file of sources("app").filter((f) => !f.startsWith("app/(app)/"))) {
    for (const match of code(file).matchAll(/<AuthNotConfigured([^>]*)\/>/g)) assert.doesNotMatch(match[1], /\binShell\b/, `${file}: fuera del shell la tarjeta es el <main>`);
  }
  // El layout privado cierra en falso (Production sin configuración) devolviendo la tarjeta SIN shell: una sola <main>.
  assert.match(code("app/(app)/layout.tsx"), /if \(!configured && shouldFailClosed\(\)\) return <AuthNotConfigured \/>;/);
});

test("cada loading.tsx identifica su sección (nombre accesible único, sin encabezado nuevo) y el esqueleto no agrega ningún título", () => {
  const sections = readdirSync(join(ROOT, "app/(app)")).filter((entry) => statSync(join(ROOT, "app/(app)", entry)).isDirectory() && existsSync(join(ROOT, "app/(app)", entry, "loading.tsx")));
  assert.ok(sections.length >= 8, sections.join(", "));
  const labels = new Set<string>();
  for (const section of sections) {
    const match = code(`app/(app)/${section}/loading.tsx`).match(/<PageSkeleton label="(Cargando [^"]+…)" variant="[a-z]+" \/>/);
    assert.ok(match, `${section}: loading sin etiqueta «Cargando …»`);
    assert.ok(!labels.has(match![1]), `${section}: etiqueta repetida`);
    labels.add(match![1]);
  }
  const skeleton = code("components/ui/page-skeleton.tsx");
  assert.match(skeleton, /aria-labelledby="carga-titulo"/);
  assert.match(skeleton, /<span id="carga-titulo" className="sr-only">\s*\{label\}\s*<\/span>/);
  assert.equal((skeleton.match(/id="carga-titulo"/g) ?? []).length, 1);
  assert.doesNotMatch(skeleton, /<h[1-6]\b/, "no agrega un encabezado: el título real llega con el contenido (sin duplicados)");
  assert.match(skeleton, /role="status" aria-busy="true" aria-live="polite"/);
  assert.doesNotMatch(skeleton, /animate-|infinite/, "sin animación permanente");
});

test("Inicio sigue sin loading.tsx y su redirect de recuperación (B0) sigue siendo un redirect HTTP del servidor", () => {
  assert.equal(existsSync(join(ROOT, "app/(app)/inicio/loading.tsx")), false);
  assert.equal(existsSync(join(ROOT, "app/(app)/loading.tsx")), false, "ni un loading global del grupo");
  const page = code("app/(app)/inicio/page.tsx");
  assert.doesNotMatch(page, /^["']use client["']/m);
  assert.match(page, /import \{ redirect \} from "next\/navigation";/);
  assert.match(page, /if \(sessionNotRecognizedYet && recuperada !== "1"\) redirect\(SESSION_RECOVERY_PATH\);/);
  const layout = code("app/(app)/layout.tsx");
  assert.match(layout, /redirect\(decision\.to\)/);
  assert.doesNotMatch(layout, /^["']use client["']/m);
  // Ningún redirect del servidor se convirtió en uno del cliente en las piezas tocadas.
  for (const file of ["components/auth/auth-shell.tsx", "components/auth/auth-not-configured.tsx", "components/ui/page-skeleton.tsx"]) {
    assert.doesNotMatch(code(file), /router\.(push|replace)|window\.location|meta http-equiv|useRouter/, file);
  }
});

test("la respuesta 503 de configuración faltante en Production (proxy.ts) también trae un único <main id=\"contenido\"> y conserva estado y cabeceras", async () => {
  const { SERVICE_UNAVAILABLE_HTML, serviceUnavailableResponse } = await import("../../auth/service-unavailable.ts");
  assert.equal((SERVICE_UNAVAILABLE_HTML.match(/<main\b/g) ?? []).length, 1);
  assert.equal((SERVICE_UNAVAILABLE_HTML.match(/id="contenido"/g) ?? []).length, 1);
  assert.match(SERVICE_UNAVAILABLE_HTML, /<main id="contenido">/);
  const response = serviceUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "60");
});
