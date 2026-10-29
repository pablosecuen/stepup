import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { REVEAL, revealDelayMs, revealTotalMs } from "../reveal.ts";
import { STREAMING_REVEAL_SCRIPT } from "../streaming-reveal-script.ts";
import { resolveScreen } from "../../nav/screens.ts";

/**
 * Sistema único de carga y aparición del área privada (29/10/2026): parámetros uniformes, esqueleto por pantalla que sale de un solo registro,
 * esqueleto optimista del clic, bloques que entran en su lugar, y NADA que dependa de `requestAnimationFrame`, de `animationend` o de que la
 * pestaña esté visible. La medición en el navegador (anchos 375–1440, red lenta, pestaña oculta) vive en la evidencia de la entrega.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const CSS = read("app/globals.css");

test("parámetros de aparición dentro de lo pedido (6–10 px, 220–320 ms, 35–55 ms entre bloques) y secuencia acotada", () => {
  assert.ok(REVEAL.distancePx >= 6 && REVEAL.distancePx <= 10, "desplazamiento sutil");
  assert.ok(REVEAL.durationMs >= 220 && REVEAL.durationMs <= 320, "duración por bloque");
  assert.ok(REVEAL.stepMs >= 35 && REVEAL.stepMs <= 55, "separación entre bloques");
  assert.equal(revealDelayMs(0), 0);
  assert.equal(revealDelayMs(1), REVEAL.stepMs);
  assert.equal(revealDelayMs(5), REVEAL.stepMs * 5);
  assert.equal(revealDelayMs(40), REVEAL.stepMs * (REVEAL.maxStaggerBlocks - 1), "una pantalla larga no retrasa más que el tope");
  assert.ok(revealTotalMs(60) <= 500, "la secuencia completa no pasa de medio segundo");
});

test("el CSS declara los mismos parámetros que el JS (una sola fuente de verdad) y todo el movimiento es opacity + transform", () => {
  const root = /:root \{\s*--tf-reveal-distance: (\d+)px;\s*--tf-reveal-duration: (\d+)ms;\s*--tf-reveal-step: (\d+)ms;\s*\}/.exec(CSS);
  assert.ok(root, "variables --tf-reveal-* en :root");
  assert.equal(Number(root[1]), REVEAL.distancePx);
  assert.equal(Number(root[2]), REVEAL.durationMs);
  assert.equal(Number(root[3]), REVEAL.stepMs);
  const block = /@media \(prefers-reduced-motion: no-preference\) \{\s*\/\* Pantalla nueva[\s\S]*?\.tf-block \{\s*animation: tf-page-in var\(--tf-reveal-duration\)/.exec(CSS);
  assert.ok(block, "`.tf-block` (bloque que llega después) usa la misma animación y vive bajo no-preference: con «reducir movimiento» no hay desplazamiento ni efecto");
  assert.match(code("components/ui/enter-on-change.tsx"), /REVEAL\.distancePx[\s\S]*REVEAL\.durationMs/);
});

test("el esqueleto es un registro: cada pantalla tiene su cuerpo propio (nada de un esqueleto genérico para todas) y Inicio queda cubierto sin loading.tsx", () => {
  const source = code("components/nav/screen-skeleton.tsx");
  for (const key of ["inicio", "alumnos", "alumno", "alumno-form", "clase-form", "registro-form", "cobros", "resumen", "comportamiento", "registro", "recordatorios", "series", "serie", "disponibilidad", "configuracion", "calendario-info", "registro-detalle", "config-sub", "facturacion", "facturacion-sub"]) {
    assert.match(source, new RegExp(`case "${key}":`), `cuerpo propio para ${key}`);
  }
  assert.match(source, /screen\.key === "calendario"\) return <CalendarSkeleton/, "el Calendario tiene su propio esqueleto (contenedor de alto completo)");
  assert.ok(resolveScreen("/inicio"), "Inicio tiene esqueleto optimista aunque no tenga loading.tsx (su redirect de recuperación sigue siendo HTTP)");
  // contenido y esqueleto comparten las primitivas de diseño
  assert.match(source, /PANEL_CLASS|CARD_CLASS/);
  assert.match(code("components/dashboard/home-view.tsx"), /PANEL_CLASS/);
  assert.match(code("components/finance/financial-overview-view.tsx"), /CARD_CLASS/);
  assert.match(code("components/calendar/calendar-view.tsx"), /className=\{CALENDAR_PAGE_CLASS\}/);
  assert.match(code("components/nav/calendar-skeleton.tsx"), /className=\{CALENDAR_PAGE_CLASS\}/);
  assert.match(code("components/ui/skeleton-kit.tsx"), /PAGE_TITLE_CLASS/, "el título del esqueleto es el real (mismo tamaño), no una barra");
  assert.match(code("components/ui/page-header.tsx"), /data-tf-header=""/, "el encabezado real se marca para no animarse (ya estaba dibujado)");
});

test("esqueleto optimista del clic: se dibuja dentro de <main> antes del contenido, oculta la pantalla anterior sin tocar el shell y no cubre cambios dentro de la misma pantalla", () => {
  const layout = code("app/(app)/layout.tsx");
  assert.match(layout, /<main id="contenido"[^>]*><ScreenSlot \/>\{children\}<\/main>/);
  assert.match(CSS, /\.tf-page-main:has\(> \[data-tf-pending-skeleton\]\) > :not\(\[data-tf-pending-skeleton\]\) \{\s*display: none !important;/);
  const slot = code("components/nav/screen-slot.tsx");
  assert.match(slot, /isScreenChange\(pathname, active\.destination\)/);
  assert.match(slot, /<RouteSkeleton path=\{pathnameOf\(active\.destination\)\} optimistic retryHref=\{active\.destination\} \/>/);
  const progress = code("components/nav/navigation-progress.tsx");
  assert.match(progress, /if \(isScreenChange\(pathRef\.current, intent\.destination\)\) \{[\s\S]*?window\.setTimeout\(\(\) => \{\s*if \(pendingRef\.current\?\.destination === destination\) setPendingNavigation\(\{ destination, fromPath \}\);\s*\}, 0\);/, "apenas pasa el clic, sin esperar al servidor");
  // Causa real hallada con interacción: publicarlo DENTRO del escucha de captura re-renderiza la navegación (ícono activo = otro nodo SVG) y el clic sobre el ícono se perdía.
  assert.doesNotMatch(progress.replace(/window\.setTimeout\(\(\) => \{\s*if \(pendingRef[\s\S]*?\}, 0\);/, ""), /setPendingNavigation\(\{ destination: intent\.destination/, "nunca síncrono dentro del escucha de captura");
  assert.match(progress, /HISTORY_SKELETON_AFTER_MS = 120/, "Atrás/Adelante: sólo si la pantalla no se restauró al instante (sin parpadeo)");
  assert.match(code("components/nav/primary-nav.tsx"), /useEffectivePathname\(usePathname\(\)\)/, "la pestaña pulsada figura seleccionada desde el clic");
  // el shell (encabezado, navegación) queda fuera de <main>
  const main = layout.slice(layout.indexOf("<main"), layout.indexOf("</main>"));
  assert.doesNotMatch(main, /PrimaryNav|SignOutButton|NavigationProgress/);
});

test("Inicio conserva sus protecciones: sin loading.tsx (el redirect de recuperación sigue siendo HTTP) y su guarda de sesión intacta", () => {
  assert.throws(() => read("app/(app)/inicio/loading.tsx"));
  assert.match(code("app/(app)/inicio/page.tsx"), /if \(sessionNotRecognizedYet && recuperada !== "1"\) redirect\(SESSION_RECOVERY_PATH\);/);
  assert.match(code("app/(app)/layout.tsx"), /redirect\(decision\.to\)/);
});

test("la disponibilidad del contenido NO depende de requestAnimationFrame, animationend ni de que la pestaña esté visible", () => {
  for (const file of [
    "components/nav/screen-reveal.tsx",
    "components/nav/screen-slot.tsx",
    "components/nav/navigation-progress.tsx",
    "components/nav/use-effective-pathname.ts",
    "components/ui/skeleton-kit.tsx",
    "components/ui/skeleton-watchdog.tsx",
    "components/ui/enter-on-change.tsx",
    "components/nav/screen-skeleton.tsx",
    "components/nav/calendar-skeleton.tsx",
    "lib/nav/pending-destination.ts",
  ]) {
    assert.doesNotMatch(code(file), /requestAnimationFrame|animationend|onAnimationEnd|visibilitychange|document\.hidden|visibilityState/, file);
  }
  // Las animaciones de entrada son CSS con `backwards`: no ocultan nada una vez terminadas (ni antes de empezar, salvo el propio retraso de 0–200 ms).
  assert.doesNotMatch(CSS.slice(CSS.indexOf("Sistema único de transiciones del área privada")), /animation:[^;]*\bforwards\b[^;]*tf-page-in|tf-page-in[^;]*\bforwards\b/);
  assert.doesNotMatch(CSS.slice(CSS.indexOf("Sistema único de transiciones del área privada")), /(?:\.tf-block|\.tf-enter|\.tf-screen)[^{]*\{[^}]*opacity:\s*0/, "ningún estilo oculta el contenido por sí mismo");
});

test("causa del bloqueo con la pestaña en segundo plano: el intercambio del streaming de React usa requestAnimationFrame mientras `$RT` no sea un número; se fija desde el inicio del documento", () => {
  // La causa viene del runtime de React instalado: si cambia, esta prueba obliga a revisar el remedio.
  const runtime = readFileSync(join(ROOT, "node_modules/react-dom/cjs/react-dom-server.edge.production.js"), "utf8");
  assert.ok(runtime.includes('"number"!==typeof $RT?requestAnimationFrame($RV.bind(null,$RB))'), "runtime de React: sin $RT numérico espera un fotograma");
  assert.ok(runtime.includes("setTimeout($RV.bind(null,$RB)"), "runtime de React: con $RT numérico usa un temporizador");
  assert.match(STREAMING_REVEAL_SCRIPT, /^window\.\$RT=-1e9;$/, "una marca de tiempo muy anterior a cualquier instante real");
  // Con ese valor el temporizador de React nunca es positivo fuera de su ventana propia (2,0–2,3 s): no agrega demora.
  const delayAt = (nowMs: number) => (2300 > nowMs && 2000 < nowMs ? 2300 - nowMs : -1e9 + 300 - nowMs);
  for (const nowMs of [50, 300, 900, 1500, 1999, 2300, 5000, 30000]) assert.ok(delayAt(nowMs) < 0, `sin demora a los ${nowMs} ms`);
  const layout = code("app/layout.tsx");
  assert.match(layout, /<head>\s*(?:\{\}\s*)?<script dangerouslySetInnerHTML=\{\{ __html: STREAMING_REVEAL_SCRIPT \}\} \/>\s*<\/head>/, "antes de cualquier instrucción de React, en el <head>");
  assert.ok(layout.indexOf("<head>") < layout.indexOf("<body"));
});

test("accesibilidad del esqueleto: un solo aviso por pantalla, dibujo decorativo fuera del lector, aviso de demora con Reintentar y sin esqueleto infinito", () => {
  const kit = code("components/ui/skeleton-kit.tsx");
  assert.equal((kit.match(/role="status"/g) ?? []).length, 1, "un único role=status (no uno por bloque)");
  assert.match(kit, /<div aria-hidden className=\{innerClassName\}>/, "todos los bloques decorativos fuera del árbol de accesibilidad");
  assert.match(kit, /if \(optimistic\) \{[\s\S]*?data-tf-pending-skeleton=""[\s\S]*?\}\s*return \(/, "el esqueleto del clic no es otra región viva: el aviso lo da NavigationProgress");
  assert.doesNotMatch(kit.slice(kit.indexOf("if (optimistic)"), kit.indexOf("return (\n    <div data-tf-skeleton=\"\" role")), /role="status"|aria-live/);
  const watchdog = code("components/ui/skeleton-watchdog.tsx");
  assert.match(watchdog, /SKELETON_GIVE_UP_MS = 15_000/);
  assert.match(watchdog, /window\.setTimeout\(\(\) => setLate\(true\), SKELETON_GIVE_UP_MS\)/);
  assert.match(watchdog, /role="alert"/);
  assert.match(watchdog, />\s*Reintentar\s*</);
  assert.match(kit, /<SkeletonWatchdog retryHref=\{retryHref\} \/>/, "tanto el esqueleto de loading.tsx como el del clic lo llevan");
  // La barra de progreso sigue siendo finita y avisa de la demora a los 6 s
  assert.match(CSS, /\.tf-nav-progress \{[^}]*animation: tf-nav-progress 8s [^}]*forwards;/);
});

test("la ficha del alumno carga el encabezado y las pestañas primero y el cuerpo de cada pestaña en su propio límite (sin que uno espere al otro ni repetir consultas)", () => {
  const page = code("app/(app)/alumnos/[id]/page.tsx");
  assert.equal((page.match(/getStudent\(ctx, id\)/g) ?? []).length, 1, "el alumno se pide una sola vez");
  assert.match(page, /<Suspense key=\{tab\} fallback=\{<ProfileTabSkeleton \/>\}>\s*<ProfileTabBody ctx=\{ctx\} student=\{student\} tab=\{tab\} \/>/, "ctx y alumno se reutilizan: ni segunda autenticación ni segunda consulta");
  const body = code("components/students/profile/profile-tab-body.tsx");
  assert.doesNotMatch(body, /requireAuthenticatedDbContext|getStudent\(/);
  assert.match(body, /Reintentar/, "un fallo del cuerpo muestra su mensaje y Reintentar en su lugar");
  assert.match(body, /<div className="tf-block">/, "el cuerpo entra como bloque aunque la pantalla ya esté sellada");
});
