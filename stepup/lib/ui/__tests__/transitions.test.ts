import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { allScreenLabels } from "../../nav/screens.ts";

/** Sistema único de transiciones del área privada: cableado, límites de movimiento y accesibilidad (la medición se hace en el navegador). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const CSS = read("app/globals.css");
const SYSTEM = CSS.slice(CSS.indexOf("Sistema único de transiciones del área privada"));

function loadings(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "loading.tsx") out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

test("el contenido de <main> entra con la misma animación; la barra lateral y la navegación quedan fuera y no se vuelven a animar", () => {
  const layout = code("app/(app)/layout.tsx");
  assert.match(layout, /<main id="contenido" tabIndex=\{-1\} className="tf-page-main /);
  // todo lo persistente (barra lateral, navegación móvil, fila de sesión, progreso) es hermano de <main>, no hijo
  const main = layout.slice(layout.indexOf("<main"));
  assert.doesNotMatch(main.slice(0, main.indexOf("</main>")), /PrimaryNav|SignOutButton|NavigationProgress/);
  assert.match(SYSTEM, /\.tf-page-main > :not\(\[data-tf-skeleton\]\):not\(\[data-tf-pending-skeleton\]\):not\(\[data-tf-groups\]\):not\(\[data-tf-overlay\]\)/);
  assert.match(SYSTEM, /animation: tf-page-in var\(--tf-reveal-duration\) cubic-bezier\(0\.16, 1, 0\.3, 1\) backwards/, "duración común, sin rebote (curva de salida suave)");
  assert.doesNotMatch(code("components/nav/primary-nav.tsx"), /tf-enter|tf-page-in|animate-/, "la navegación no se anima");
});

test("límites de movimiento: sólo opacity y transform, 8 px, 260 ms por bloque, 40 ms entre bloques (secuencia acotada), diálogos 110–220 ms, sin infinitos", () => {
  const keyframes = (name: string) => SYSTEM.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}\\n`))?.[1] ?? "";
  assert.match(keyframes("tf-page-in"), /translate3d\(0, var\(--tf-reveal-distance\), 0\)/);
  for (const name of ["tf-page-in", "tf-fade-in", "tf-fade-out", "tf-dialog-in", "tf-dialog-out", "tf-sheet-in", "tf-sheet-out"]) {
    const body = keyframes(name);
    assert.ok(body.length > 0, name);
    const properties = [...body.matchAll(/^\s{4}([a-z-]+):/gm)].map((match) => match[1]);
    assert.deepEqual([...new Set(properties)].filter((property) => !["opacity", "transform"].includes(property)), [], `${name}: sólo opacity y transform`);
  }
  assert.match(keyframes("tf-dialog-in"), /scale\(0\.98\)/);
  assert.match(keyframes("tf-dialog-out"), /scale\(0\.98\)/);
  const durations = [...SYSTEM.matchAll(/animation: [a-z-]+ (\d+)ms/g)].map((match) => Number(match[1]));
  assert.ok(durations.length >= 8 && durations.every((ms) => ms >= 110 && ms <= 220), String(durations));
  assert.match(SYSTEM, /\.tf-enter\[data-enter="2"\] \{\s*animation-delay: var\(--tf-reveal-step\);/);
  assert.match(SYSTEM, /\.tf-enter\[data-enter="3"\] \{\s*animation-delay: calc\(var\(--tf-reveal-step\) \* 2\);/);
  assert.doesNotMatch(SYSTEM.slice(SYSTEM.indexOf("@media (prefers-reduced-motion: no-preference)")), /infinite|animation-iteration-count|(?<![-a-z])(height|width|top|left):/, "ni efectos permanentes ni propiedades que recalculan el diseño");
});

test("todo el movimiento vive bajo prefers-reduced-motion: no-preference (con «reducir movimiento» el contenido aparece ya en su lugar)", () => {
  const animated = [...SYSTEM.matchAll(/animation: tf-[a-z-]+ /g)].length;
  const inside = SYSTEM.slice(SYSTEM.indexOf("@media (prefers-reduced-motion: no-preference)"));
  assert.ok(animated > 0 && [...inside.matchAll(/animation: tf-[a-z-]+ /g)].length === animated, "ninguna animación fuera del bloque no-preference");
  assert.match(read("components/ui/enter-on-change.tsx"), /prefers-reduced-motion: reduce/);
  assert.match(read("components/ui/dialog.tsx"), /prefers-reduced-motion: reduce/, "el diálogo cierra en el acto con «reducir movimiento»");
});

test("diálogos: opacidad + escala 0,98 → 1 al abrir (180 ms), hoja desde abajo en móvil (220 ms), cierre más rápido, Escape/foco/teclado intactos y fondo sin oscurecer de más", () => {
  assert.match(SYSTEM, /\.tf-dialog \{\s*animation: tf-sheet-in 220ms/);
  assert.match(SYSTEM, /min-width: 820px\) \{\s*\.tf-dialog \{\s*animation: tf-dialog-in 180ms/);
  assert.match(SYSTEM, /\[data-closing\] \.tf-dialog \{\s*animation: tf-sheet-out 130ms/);
  assert.match(SYSTEM, /\[data-closing\] \.tf-dialog \{\s*animation: tf-dialog-out 110ms/);
  assert.match(SYSTEM, /\.tf-backdrop \{\s*animation: tf-fade-in 160ms/);
  const dialog = code("components/ui/dialog.tsx");
  assert.match(dialog, /bg-ink\/40/, "fondo menos oscuro (antes 50 %)");
  assert.match(dialog, /useDialogA11y\(requestClose\)/, "Escape también sale animado");
  assert.match(dialog, /onAnimationEnd=\{onPanelAnimationEnd\}/);
  assert.match(dialog, /data-tf-overlay/, "el diálogo no se anima como página");
  assert.match(dialog, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*tabIndex=\{-1\}/);
  const hook = code("lib/ui/use-dialog-a11y.ts");
  assert.match(hook, /paddingRight/, "el contenido de atrás no se mueve al desaparecer la barra de desplazamiento");
  assert.match(hook, /trapTabTarget/, "foco atrapado");
  assert.match(CSS, /\.tf-menu \{\s*transform-origin: top;\s*animation: tf-dialog-in 160ms/);
  assert.match(code("components/calendar/calendar-density-picker.tsx"), /className="tf-menu /);
});

test("el esqueleto aparece al instante (sin animación propia ni brillo), con la geometría de cada pantalla y un loading.tsx por ruta con página", () => {
  const kit = code("components/ui/skeleton-kit.tsx");
  assert.match(kit, /data-tf-skeleton/);
  assert.doesNotMatch(kit + code("components/nav/screen-skeleton.tsx") + code("components/nav/calendar-skeleton.tsx"), /animate-|infinite|transition/);
  assert.match(kit, /className \?\? PAGE_WIDTH\[width\]/, "mismo contenedor que la pantalla final");
  const found = loadings("app/(app)");
  for (const route of ["alumnos", "alumnos/[id]", "alumnos/nuevo", "alumnos/[id]/editar", "calendario", "calendario/nueva", "calendario/series", "calendario/disponibilidad", "cobros", "resumen-financiero", "recordatorios", "registro", "registro/nuevo", "registro/[calendarLessonId]", "configuracion"]) assert.ok(found.includes(`app/(app)/${route}/loading.tsx`), route);
  // Inicio sigue sin loading.tsx: su redirect de recuperación de sesión (B0) debe ser HTTP real
  assert.equal(existsSync(join(ROOT, "app/(app)/inicio/loading.tsx")), false);
  for (const file of found) assert.match(code(file), /<(?:RouteSkeleton path|DestinationSkeleton fallbackPath)="\/[^"]*" \/>/, `${file}: sale del registro único de pantallas`);
  const labels = allScreenLabels();
  assert.equal(new Set(labels).size, labels.length, "etiqueta accesible única por pantalla");
});

test("contenido que cambia sin cambiar de pantalla usa el mismo patrón (EnterOnChange): pestañas del perfil, Calendario y resultados de Alumnos", () => {
  const enter = code("components/ui/enter-on-change.tsx");
  assert.match(enter, /useLayoutEffect/, "antes de pintar: sin parpadeo");
  assert.match(enter, /element\.animate\(\[\{ opacity: 0, transform: `translate3d\(0, \$\{REVEAL\.distancePx\}px, 0\)` \}, \{ opacity: 1, transform: "none" \}\], \{ duration: REVEAL\.durationMs/);
  assert.doesNotMatch(enter, /key=|setState|useState/, "no remonta ni guarda estado: se conservan el foco y el scroll");
  // Las pestañas del perfil ya no repintan toda la ficha: su cuerpo vive en un límite de carga con `key` por pestaña y entra como bloque.
  assert.match(code("app/(app)/alumnos/[id]/page.tsx"), /<Suspense key=\{tab\} fallback=\{<ProfileTabSkeleton tab=\{tab\} \/>\}>/);
  assert.match(code("components/students/profile/profile-tab-body.tsx"), /<div className="tf-block">/);
  assert.match(code("components/calendar/calendar-workspace.tsx"), /<EnterOnChange changeKey=\{`\$\{view\}\|\$\{dayKeys\[0\]\}`\}/);
  assert.match(code("components/students/students-list-view.tsx"), /<EnterOnChange changeKey=/);
});

test("la navegación sigue siendo del cliente: nada de recargas completas ni router.refresh en la navegación y el diálogo", () => {
  const nav = ["components/nav/primary-nav.tsx", "components/nav/private-link.tsx", "components/nav/navigation-progress.tsx", "components/ui/dialog.tsx", "components/ui/enter-on-change.tsx"].map(code).join("\n");
  assert.doesNotMatch(nav, /window\.location\.(href|assign|replace)\s*=|location\.reload|router\.refresh/);
  assert.match(code("components/nav/navigation-progress.tsx"), /decideClick/, "el doble clic al mismo destino se bloquea");
  assert.match(code("components/nav/private-link.tsx"), /prefetch=\{profilePrefetchHref !== null && profilePrefetchHref === props\.href\}/, "la precarga automática sigue apagada (B0)");
});
