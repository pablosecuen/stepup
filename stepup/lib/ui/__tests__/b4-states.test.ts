import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * B4 — estados de la aplicación: carga (`loading.tsx`), error (`error.tsx`), no encontrado (`not-found.tsx`) y vacíos con
 * acción. Sin DOM en este runner: se fijan los invariantes del código real y se valida que cada destino exista.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP = join(ROOT, "app");
const PRIVATE = join(APP, "(app)");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Rutas reales de la aplicación (cada page.tsx; los grupos "(x)" no cuentan; [param] queda como comodín). */
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") {
        const segments = relative(APP, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
        out.push("/" + segments.join("/"));
      }
    }
  };
  walk(APP);
  return out;
}
const ROUTES = routes();
const routeExists = (href: string) =>
  ROUTES.some((route) => {
    const a = route.split("/");
    const b = href.split("?")[0].split("/");
    return a.length === b.length && a.every((seg, i) => /^\[.*\]$/.test(seg) || seg === b[i]);
  });

const SECTIONS = readdirSync(PRIVATE).filter((entry) => statSync(join(PRIVATE, entry)).isDirectory());

test("cada sección privada (salvo Inicio) tiene su loading.tsx con el esqueleto accesible dentro del shell", () => {
  assert.deepEqual(
    [...SECTIONS].sort(),
    ["alumnos", "calendario", "cobros", "configuracion", "inicio", "recordatorios", "registro", "resumen-financiero"],
    "sección nueva sin decisión de carga: agregar su loading.tsx (o justificar la excepción como Inicio)",
  );
  for (const section of SECTIONS.filter((s) => s !== "inicio")) {
    const file = `app/(app)/${section}/loading.tsx`;
    assert.ok(existsSync(join(ROOT, file)), `${file} existe`);
    const source = code(file);
    assert.match(source, /export default function Loading\(\)/);
    assert.match(source, /<PageSkeleton label="Cargando [^"]+…" \/>/, "con texto para lectores de pantalla");
    assert.doesNotMatch(source, /"use client"/);
  }
});

test("Inicio NO tiene loading.tsx: su redirect de recuperación de sesión (B0) debe seguir siendo un redirect HTTP real", () => {
  assert.equal(existsSync(join(PRIVATE, "inicio", "loading.tsx")), false);
  assert.equal(existsSync(join(PRIVATE, "loading.tsx")), false, "tampoco uno global del grupo (alcanzaría a Inicio)");
  assert.match(code("app/(app)/inicio/page.tsx"), /redirect\(SESSION_RECOVERY_PATH\)/);
});

test("el esqueleto es accesible: role=status, aria-busy, texto sólo para lectores y sin animación si se reduce el movimiento", () => {
  const skeleton = code("components/ui/page-skeleton.tsx");
  assert.match(skeleton, /role="status" aria-busy="true" aria-live="polite"/);
  assert.match(skeleton, /<span className="sr-only">\{label\}<\/span>/);
  assert.match(skeleton, /motion-safe:animate-pulse/);
  assert.match(skeleton, /aria-hidden/, "los bloques decorativos no se leen");
  assert.match(code("components/ui/states.tsx"), /animate-spin[^"]*motion-reduce:animate-none/, "el spinner también respeta reducir movimiento");
});

test("error: boundary en la raíz, otro DENTRO del shell privado y uno global; sin exponer el mensaje del error", () => {
  for (const file of ["app/error.tsx", "app/(app)/error.tsx", "app/global-error.tsx"]) {
    assert.ok(existsSync(join(ROOT, file)), `${file} existe`);
    assert.match(read(file), /^"use client";/, `${file} es un componente cliente (requisito de Next)`);
    assert.match(code(file), /export default function/);
  }
  const priv = code("app/(app)/error.tsx");
  assert.match(priv, /homeHref="\/inicio" homeLabel="Ir a Inicio" inShell/, "dentro del shell: vuelve a Inicio y no trae otro <main>");
  assert.match(code("app/error.tsx"), /homeHref="\/" homeLabel="Ir al inicio" inShell=\{false\}/);

  const view = code("components/ui/route-error.tsx");
  assert.match(view, /onClick=\{\(\) => reset\(\)\}/, "Reintentar");
  assert.match(view, />\s*Reintentar\s*</);
  assert.match(view, /href=\{homeHref\}/, "salida clara");
  assert.match(view, /console\.error\("\[route-error\]", error\.digest \?\? "sin-digest"\)/, "sólo el digest en el log");
  assert.doesNotMatch(view, /error\.message|error\.stack|\{error\}/, "nunca el mensaje ni la traza (pueden traer datos)");
  assert.match(view, /min-h-11/, "objetivos de 44 px");
  assert.doesNotMatch(code("app/global-error.tsx"), /error\.message/);
});

test("no encontrado: página raíz y not-found dentro del shell, con camino de vuelta y en español", () => {
  const files: Array<[string, RegExp, string]> = [
    ["app/not-found.tsx", /actionHref="\/inicio"/, "No encontramos esta página"],
    ["app/(app)/not-found.tsx", /actionHref="\/inicio"/, "No encontramos lo que buscás"],
    ["app/(app)/alumnos/not-found.tsx", /actionHref="\/alumnos"/, "No encontramos a este alumno"],
    ["app/(app)/registro/not-found.tsx", /actionHref="\/registro"/, "No encontramos este registro"],
  ];
  for (const [file, href, title] of files) {
    assert.ok(existsSync(join(ROOT, file)), `${file} existe`);
    const source = code(file);
    assert.match(source, /export default function/);
    assert.match(source, href);
    assert.ok(source.includes(`title="${title}"`), `${file}: título en español`);
    // Sólo el not-found RAÍZ aplica su título (el de un not-found anidado no se aplica en Next, así que no se declara).
    if (file === "app/not-found.tsx") assert.match(source, /export const metadata = \{ title: "Página no encontrada · TeacherFlow" \}/);
    else assert.doesNotMatch(source, /export const metadata/);
    const target = source.match(/actionHref="([^"]+)"/)![1];
    assert.ok(routeExists(target), `${file}: el destino ${target} existe`);
  }
  const view = code("components/ui/not-found-view.tsx");
  assert.match(view, /min-h-11/);
  assert.match(view, /inShell \? <div className=\{className\}>/, "dentro del shell no duplica el <main>");
});

test("cada notFound() de una pantalla privada cae en un not-found DENTRO del shell (el más específico disponible)", () => {
  const callers = [
    ["app/(app)/alumnos/[id]/page.tsx", "app/(app)/alumnos/not-found.tsx"],
    ["app/(app)/alumnos/[id]/editar/page.tsx", "app/(app)/alumnos/not-found.tsx"],
    ["app/(app)/registro/[calendarLessonId]/page.tsx", "app/(app)/registro/not-found.tsx"],
    ["app/(app)/registro/libre/[registrationId]/page.tsx", "app/(app)/registro/not-found.tsx"],
  ];
  for (const [page, boundary] of callers) {
    assert.match(code(page), /notFound\(\)/, `${page} sigue llamando notFound()`);
    assert.ok(existsSync(join(ROOT, boundary)), `${boundary} cubre a ${page}`);
  }
  // Y ningún notFound() nuevo queda sin cubrir: toda página privada que lo llame está bajo alguna sección con su boundary.
  const withBoundary = new Set(["alumnos", "registro"]);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx" && /notFound\(\)/.test(readFileSync(full, "utf8"))) {
        const section = relative(PRIVATE, full).split(sep)[0];
        assert.ok(withBoundary.has(section) || existsSync(join(PRIVATE, "not-found.tsx")), `${section}: notFound() cubierto`);
      }
    }
  };
  walk(PRIVATE);
});

test("vacíos con acción: el estado vacío admite UNA acción y todas las acciones usadas llevan a rutas existentes", () => {
  const states = code("components/ui/states.tsx");
  assert.match(states, /export function EmptyState\(\{ message, action \}/);
  assert.match(states, /\{action && \(\s*<PrivateLink\s+href=\{action\.href\}/, "la acción es un enlace sin prefetch");
  assert.match(states, /min-h-11/);

  const used: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
        walk(full);
      } else if (/\.tsx$/.test(entry)) {
        const source = readFileSync(full, "utf8").replace(/\r\n/g, "\n");
        for (const m of source.matchAll(/href: "(\/[^"]*)"/g)) {
          if (/action=/.test(source.slice(Math.max(0, m.index! - 160), m.index!))) used.push([relative(ROOT, full).split(sep).join("/"), m[1]]);
        }
      }
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "components"));
  assert.deepEqual(
    used.map(([file, href]) => `${file} → ${href}`).sort(),
    [
      "app/(app)/alumnos/page.tsx → /alumnos",
      "app/(app)/alumnos/page.tsx → /alumnos/nuevo",
      "app/(app)/calendario/series/page.tsx → /calendario/nueva",
      "components/students/profile/clases-tab.tsx → /registro",
      "components/students/profile/progreso-tab.tsx → /registro",
    ],
  );
  for (const [file, href] of used) assert.ok(routeExists(href), `${file}: ${href} existe`);

  const alumnos = code("app/(app)/alumnos/page.tsx");
  assert.match(alumnos, /hasAnyStudentEver \? \{ label: "Limpiar filtros", href: "\/alumnos" \} : \{ label: "Agregar alumno", href: "\/alumnos\/nuevo" \}/, "con filtros: limpiar; sin alumnos: agregar");
});

test("los vacíos que son un buen estado (nada pendiente) no inventan acciones", () => {
  for (const [file, message] of [
    ["app/(app)/cobros/page.tsx", "No hay cobros pendientes."],
    ["app/(app)/recordatorios/page.tsx", "No hay recordatorios pendientes."],
    ["components/students/profile/tareas-tab.tsx", "No hay tareas pendientes."],
  ]) {
    const source = code(file);
    const i = source.indexOf(message);
    assert.ok(i > 0, `${file} conserva su mensaje`);
    assert.doesNotMatch(source.slice(i, i + 80), /action=/, `${file}: sin acción`);
  }
});

test("alcance: B4 no cambia datos ni autenticación (sólo pantallas de estado)", () => {
  for (const file of ["components/ui/page-skeleton.tsx", "components/ui/not-found-view.tsx", "components/ui/route-error.tsx", "components/ui/states.tsx"]) {
    assert.doesNotMatch(code(file), /supabase|\.rpc\(|\.from\(|fetch\(|signOut|redirect\(/i, `${file} no toca datos ni auth`);
  }
});
