import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { GIVE_UP_AFTER_MS, SLOW_AFTER_MS, decideClick, pendingPhase, resolveNavigationIntent, type ClickLike } from "../navigation-intent.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
function sources(dir: string, ext: RegExp = /\.tsx?$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel, ext));
    else if (ext.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

const BASE: ClickLike = {
  href: "https://teacherflowapp.com/alumnos",
  currentUrl: "https://teacherflowapp.com/inicio",
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  target: null,
  download: false,
};

test("un clic normal en un enlace interno inicia una navegación (con ruta y consulta como destino)", () => {
  assert.deepEqual(resolveNavigationIntent(BASE), { kind: "navigate", destination: "/alumnos" });
  assert.deepEqual(resolveNavigationIntent({ ...BASE, href: "https://teacherflowapp.com/resumen-financiero?preset=last_3_months" }), { kind: "navigate", destination: "/resumen-financiero?preset=last_3_months" });
  assert.deepEqual(resolveNavigationIntent({ ...BASE, target: "_self" }), { kind: "navigate", destination: "/alumnos" });
});

test("abrir en otra pestaña o ventana se respeta: Ctrl/Cmd/Shift/Alt + clic, botón central o derecho, target y descarga no hacen nada", () => {
  for (const override of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { target: "_blank" }, { target: "otra" }, { download: true }]) {
    assert.equal(resolveNavigationIntent({ ...BASE, ...override }).kind, "ignore", JSON.stringify(override));
  }
});

test("no interviene en enlaces externos, anclas, el mismo destino, esquemas que no son http, un clic ya cancelado ni un href ilegible", () => {
  assert.equal(resolveNavigationIntent({ ...BASE, href: "https://otro.example/alumnos" }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, href: "https://teacherflowapp.com/inicio#contenido" }).kind, "ignore", "ancla en la misma página");
  assert.equal(resolveNavigationIntent({ ...BASE, href: "https://teacherflowapp.com/inicio" }).kind, "ignore", "ya estás ahí");
  assert.equal(resolveNavigationIntent({ ...BASE, href: "mailto:alguien@example.test" }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, href: "javascript:void(0)" }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, href: null }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, href: "no es una url" }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, currentUrl: "???" }).kind, "ignore");
  assert.equal(resolveNavigationIntent({ ...BASE, defaultPrevented: true }).kind, "ignore");
  // Misma ruta con otra consulta SÍ navega (p. ej. cambiar de período).
  assert.equal(resolveNavigationIntent({ ...BASE, currentUrl: "https://teacherflowapp.com/calendario?week=2026-10-12", href: "https://teacherflowapp.com/calendario?week=2026-10-19" }).kind, "navigate");
});

test("doble clic: con una navegación pendiente, el mismo destino se ignora; otro destino la reemplaza; sin pendiente, empieza", () => {
  assert.equal(decideClick(null, "/alumnos"), "start");
  assert.equal(decideClick("/alumnos", "/alumnos"), "block_repeat");
  assert.equal(decideClick("/alumnos", "/calendario"), "replace");
  assert.equal(decideClick("/calendario?week=2026-10-12", "/calendario?week=2026-10-19"), "replace", "otra consulta = otro destino");
});

test("el indicador reconoce el clic al instante, avisa si tarda y se apaga solo: nunca queda «ocupado» para siempre", () => {
  assert.equal(pendingPhase(null, 1_000), "idle");
  assert.equal(pendingPhase(1_000, 1_000), "pending", "en el mismo instante del clic");
  assert.equal(pendingPhase(1_000, 1_000 + SLOW_AFTER_MS - 1), "pending");
  assert.equal(pendingPhase(1_000, 1_000 + SLOW_AFTER_MS), "slow", "pasados 6 s lo dice en texto");
  assert.equal(pendingPhase(1_000, 1_000 + GIVE_UP_AFTER_MS - 1), "slow");
  assert.equal(pendingPhase(1_000, 1_000 + GIVE_UP_AFTER_MS), "idle", "una navegación fallida o colgada se restablece sola");
  assert.ok(SLOW_AFTER_MS < GIVE_UP_AFTER_MS);
});

test("cableado: un solo escucha en el documento (captura), se restablece al cambiar la ruta, al volver atrás y por tiempo, y está en el layout privado", () => {
  const component = code("components/nav/navigation-progress.tsx");
  assert.match(component, /document\.addEventListener\("click", onClick, \{ capture: true \}\)/);
  assert.match(component, /window\.addEventListener\("popstate", onHistory\)/);
  assert.match(component, /pending\.startKey !== routeKey/, "la ruta cambió: completó");
  assert.match(component, /pathname !== pathnameOf\(pending\.destination\) && burstRef\.current\.has\(pathname\)\) return;/, "una pantalla intermedia de una ráfaga de clics no retira el esqueleto del último destino");
  assert.match(component, /window\.setTimeout\(\(\) => clearPending\(true\), GIVE_UP_AFTER_MS\)/, "falla o cuelgue: la barra se apaga sola (el esqueleto sigue, con su aviso y Reintentar)");
  assert.match(component, /removeAttribute\("data-nav-pending"\)/);
  assert.match(component, /decision === "block_repeat"[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/);
  assert.match(component, /role="status" aria-live="polite" className="sr-only"/);
  assert.doesNotMatch(component, /router\.(push|replace|prefetch)|window\.location\.(assign|href\s*=)/, "no navega por su cuenta: sólo muestra lo que hace Next");
  assert.match(code("app/(app)/layout.tsx"), /<NavigationProgress \/>/);
  const css = read("app/globals.css");
  assert.match(css, /\.tf-nav-progress \{[^}]*animation: tf-nav-progress 8s [^}]*forwards;/, "avanza hasta el 90 % y se queda: no es infinita");
  assert.doesNotMatch(css, /tf-nav-progress[^}]*infinite/);
});

test("la precarga sigue apagada y ninguna ruta de solo lectura comprobada es necesaria para eso: PrivateLink no admite `prefetch` y nada lo reactiva", () => {
  const link = code("components/nav/private-link.tsx");
  assert.match(link, /Omit<ComponentProps<typeof NextLink>, "prefetch">/);
  assert.match(link, /prefetch=\{false\}/);
  const offenders: string[] = [];
  for (const file of [...sources("app"), ...sources("components")]) {
    if (file === "components/nav/private-link.tsx") continue;
    // La precarga de las páginas públicas (login, crear cuenta…) vive en public-links; en el área privada no existe.
    if (/\bprefetch=\{(?!false)/.test(code(file)) || /\bprefetch\b(?!=)/.test(code(file).replace(/prefetch=\{false\}/g, ""))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("guarda de precarga: toda página privada sólo LEE (repositorios de lectura, sin Server Actions ni escrituras) y no hay route handlers dentro del área privada", () => {
  const READ_ONLY = /^(list|get|has|load|find|count|search|read|resolve|build)[A-Z]/;
  const pages = sources("app/(app)").filter((file) => /\/page\.tsx$/.test(file));
  assert.ok(pages.length >= 15, `se descubrieron las páginas privadas (${pages.length})`);
  for (const file of pages) {
    const source = code(file);
    assert.doesNotMatch(source, /^["']use server["']/m, `${file}: una página no es una acción`);
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete|rpc)\(/, `${file}: sin escrituras directas`);
    assert.doesNotMatch(source, /from "@\/lib\/actions\/(?!network-guard)/, `${file}: una página privada no ejecuta Server Actions al renderizar`);
    for (const match of source.matchAll(/import \{([^}]*)\} from "@\/lib\/(?:repositories|dashboard)\/[^"]*"/g)) {
      for (const name of match[1].split(",").map((part) => part.trim().replace(/^type\s+/, "")).filter(Boolean)) {
        if (/^[A-Z]/.test(name)) continue; // tipos
        assert.match(name, READ_ONLY, `${file}: «${name}» no es una lectura`);
      }
    }
  }
  const handlers = sources("app/(app)", /^route\.tsx?$/);
  assert.deepEqual(handlers, [], "las rutas con escritura por GET (callback de autenticación, avisos, cron) están fuera del área privada y nunca se precargan");
});
