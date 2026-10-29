import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Carga uniforme de las pantallas privadas, Preferencias de Configuración y Recordatorios compactos (29/10/2026).
 * Contrato estructural: la medición en el navegador (375 / 390 / 430 / 1366 px) vive en la evidencia de la entrega.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const CSS = read("app/globals.css");
const MOTION = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* Pantalla nueva"));

function pageDirs(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.tsx") out.push(current);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

// ── 1 · Carga: esqueleto → aparición común, una sola vez ──────────────────────────────────────────────────────────────────────────────

test("toda pantalla privada con página tiene su propio esqueleto (loading.tsx) salvo Inicio, que conserva su redirect HTTP de recuperación de sesión", () => {
  const missing = pageDirs("app/(app)")
    .filter((dir) => !existsSync(join(dir, "loading.tsx")))
    .map((dir) => dir.slice(ROOT.length).replaceAll("\\", "/"));
  assert.deepEqual(missing, ["app/(app)/inicio"], "sólo Inicio queda sin loading.tsx");
  assert.equal(existsSync(join(ROOT, "app/(app)/inicio/loading.tsx")), false);
});

test("los esqueletos nuevos usan el ancho de SU pantalla (sin saltos de tamaño al llegar el contenido)", () => {
  const EXPECTED: Record<string, string> = {
    "calendario/informacion": "detail", // PAGE_WIDTH.medium
    "calendario/series/[id]": 'detail" width="wide', // la serie usa PAGE_WIDTH.wide
    "configuracion/consistencia": "detail",
    "configuracion/tutorial": "detail",
    "facturacion/condiciones": "detail",
    "facturacion/planes": "detail",
    "facturacion/resultado": "form", // PAGE_WIDTH.narrow
    "resumen-financiero/comportamiento-de-pago": "finance",
  };
  const PAGE_FOR: Record<string, "wide" | "medium" | "narrow"> = {
    "calendario/informacion": "medium",
    "calendario/series/[id]": "wide",
    "configuracion/consistencia": "medium",
    "configuracion/tutorial": "medium",
    "facturacion/condiciones": "medium",
    "facturacion/planes": "medium",
    "facturacion/resultado": "narrow",
    "resumen-financiero/comportamiento-de-pago": "wide",
  };
  const VARIANT_WIDTH = { detail: "medium", form: "narrow", finance: "wide", list: "wide", settings: "wide", calendar: "wide", profile: "medium" } as const;
  for (const [route, variantAndWidth] of Object.entries(EXPECTED)) {
    const loading = read(`app/(app)/${route}/loading.tsx`);
    assert.ok(loading.includes(`variant="${variantAndWidth}"`), route);
    const variant = loading.match(/variant="([a-z]+)"/)![1] as keyof typeof VARIANT_WIDTH;
    const width = loading.match(/width="([a-z]+)"/)?.[1] ?? VARIANT_WIDTH[variant];
    assert.equal(width, PAGE_FOR[route], `${route}: ancho del esqueleto = ancho de la pantalla`);
    assert.match(code(`app/(app)/${route}/page.tsx`), new RegExp(`PAGE_WIDTH\\.${PAGE_FOR[route]}`), `${route}: la pantalla usa ese ancho`);
  }
});

test("PAGE_WIDTH marca cada pantalla (.tf-screen) y la entrada es la de Inicio: encabezado → principal → paneles a 0 / 40 / 80 ms, sólo con movimiento permitido", () => {
  const widths = read("components/ui/page-header.tsx");
  for (const size of ["wide", "medium", "narrow"]) assert.match(widths, new RegExp(`${size}: "tf-screen mx-auto`));
  const sel = String.raw`\.tf-page-main > \.tf-screen:not\(\[data-tf-skeleton\]\):not\(\[data-tf-groups\]\):not\(\[data-tf-revealed\]\)`;
  assert.match(MOTION, new RegExp(`${sel} > \\* \\{\\s*animation: tf-page-in 220ms cubic-bezier\\(0\\.16, 1, 0\\.3, 1\\) backwards;`));
  assert.match(MOTION, new RegExp(`${sel} > :nth-child\\(2\\) \\{\\s*animation-delay: 40ms;`));
  assert.match(MOTION, new RegExp(`${sel} > :nth-child\\(n \\+ 3\\) \\{\\s*animation-delay: 80ms;`));
  // La entrada de raíz completa ya no se aplica a estas pantallas (evita animar dos veces el mismo bloque) pero sí al resto (errores, avisos)
  assert.match(MOTION, /\.tf-page-main > :not\(\[data-tf-skeleton\]\):not\(\[data-tf-groups\]\):not\(\[data-tf-overlay\]\):not\(\.tf-screen\),/);
  // Todo el movimiento nuevo vive dentro de no-preference: con «reducir movimiento» no hay ninguna animación de entrada
  const animated = [...CSS.matchAll(/animation: tf-[a-z-]+ /g)].length;
  const inside = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* Pantalla nueva"));
  assert.ok([...inside.matchAll(/animation: tf-[a-z-]+ /g)].length >= 3 && animated > 0);
  assert.doesNotMatch(CSS.slice(0, CSS.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* Pantalla nueva")), /tf-screen/, "ninguna regla .tf-screen fuera de no-preference");
});

test("ScreenReveal sella la pantalla al terminar de entrar: nada vuelve a animar al escribir, filtrar o guardar; sin temporizadores y montado en el layout privado", () => {
  const source = code("components/nav/screen-reveal.tsx");
  assert.match(source, /data-tf-revealed/);
  assert.match(source, /getAnimations\(\{ subtree: true \}\)/, "espera a las animaciones reales de los hijos directos");
  assert.match(source, /parentElement === screen/, "ignora animaciones internas (gráficos, indicadores de carga)");
  assert.doesNotMatch(source, /setTimeout|setInterval/, "sin temporizadores");
  assert.match(source, /new MutationObserver/);
  assert.match(source, /disconnect\(\)/, "se limpia al desmontar");
  assert.match(source, /data-tf-skeleton/, "nunca sella el esqueleto");
  assert.match(code("app/(app)/layout.tsx"), /<ScreenReveal \/>/);
  // El esqueleto no se anima (aparece al instante) y las pantallas con grupos propios (Inicio) conservan su mecanismo
  assert.match(MOTION, /:not\(\[data-tf-skeleton\]\)/);
  assert.match(code("components/dashboard/home-view.tsx"), /data-tf-groups/);
});

test("Alumnos: el resultado sólo entra al cambiar de página; escribir, filtrar u ordenar actualizan la lista en su lugar", () => {
  const view = code("components/students/students-list-view.tsx");
  assert.match(view, /<EnterOnChange changeKey=\{`pagina-\$\{page\}`\}>/);
  assert.doesNotMatch(view, /changeKey=\{`\$\{search\}/);
  // Pestañas del perfil y Calendario conservan su patrón (no se tocó)
  assert.match(code("components/students/profile/student-profile-view.tsx"), /<EnterOnChange changeKey=\{tab\}/);
});

// ── 2 · Preferencias ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("«Ubicación de la navegación» es una fila de Configuración como las demás: relleno de la tarjeta, título → explicación → opciones alineadas", () => {
  const source = code("components/account/navigation-preference.tsx");
  assert.match(source, /<SettingsRow title="Ubicación de la navegación" description="Elegí la barra inferior/);
  assert.match(source, /<legend className="sr-only">Ubicación de la navegación<\/legend>/, "el grupo conserva su nombre accesible");
  assert.match(source, /disabled=\{pending\}/);
  assert.match(source, /saveNavigationPreference\(key\)/, "la acción y la preferencia guardada no cambian");
  assert.match(source, /\['barra', 'Barra inferior'\], \['menu', 'Menú del logo'\]/);
  assert.match(source, /name="navigation-location"/);
  // Nada crudo dentro de una tarjeta: todo hijo directo de <SettingsCard> es una fila (con relleno propio: SettingsRow o NavigationPreference, que la usa) o un bloque con px-4/sm:px-5
  const view = code("components/account/configuration-view.tsx");
  for (const match of view.matchAll(/<SettingsCard[^>]*>\s*<([A-Za-z]+)/g)) {
    assert.ok(["SettingsRow", "NavigationPreference", "div"].includes(match[1]), `hijo directo de SettingsCard sin relleno: <${match[1]}>`);
  }
  assert.match(view, /<SettingsCard>\s*<NavigationPreference value=\{navigationLocation\} \/>\s*<\/SettingsCard>/);
  const ui = code("components/account/settings-ui.tsx");
  assert.match(ui, /<div className="px-4 py-4 sm:px-5">/, "el relleno de la fila es el de siempre");
});

// ── 3 · Recordatorios ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Recordatorios: ancho de lectura acotado, dos columnas sólo en escritorio, nombres completos y número rojo siempre escrito", () => {
  const widths = code("components/ui/page-header.tsx");
  assert.match(widths, /export const READING_WIDTH = "w-full max-w-\[720px\]"/);
  const view = code("components/reminders/reminders-view.tsx");
  assert.match(view, /grid grid-cols-1 items-start gap-x-6 gap-y-6 min-\[1040px\]:grid-cols-2/);
  assert.match(view, /className=\{`min-w-0 \$\{READING_WIDTH\}`\}/);
  assert.match(view, /\[overflow-wrap:anywhere\]">\{item\.title\}/, "el nombre largo se muestra completo (se parte, no se corta)");
  assert.doesNotMatch(view, /truncate|line-clamp|text-ellipsis/, "ningún nombre se corta con puntos suspensivos");
  assert.match(view, /<Badge tone="bad">/, "insignia roja conservada");
  assert.match(view, /<span className="sr-only"> \{category\.items\.length === 1 \? "pendiente" : "pendientes"\}<\/span>/);
  assert.match(view, /\{item\.subtitle\}/, "fechas e importes se conservan");
  // La lista de «Clases por registrar» tenía el mismo defecto (filas de ~1.100 px): usa la misma medida
  assert.match(code("components/registro/pending-list-view.tsx"), /\$\{READING_WIDTH\}/);
});
