import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Landing pública: estructura, accesibilidad, movimiento y límites de contenido (la medición visual y de rendimiento se hace en el navegador). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = code("app/page.tsx");
const SECTIONS = code("components/landing/sections.tsx");
const HEADER = code("components/landing/site-header.tsx");
const TOUR = code("components/landing/tour.tsx");
const REVEAL = code("components/landing/reveal.tsx");
const CONTROLLER = code("components/landing/reveal-controller.tsx");
const PARALLAX = code("components/landing/parallax.tsx");

test("la portada sigue siendo pública: un solo h1, main enfocable para «Saltar al contenido» y sin metadatos propios", () => {
  assert.match(PAGE, /<main id="contenido" tabIndex=\{-1\}/);
  assert.equal((SECTIONS.match(/<h1/g) ?? []).length, 1);
  assert.doesNotMatch(PAGE, /export const metadata/, "la portada usa el título general del sitio");
  assert.doesNotMatch(PAGE, /supabase|getUser|requireAuth|redirect\(/, "no lee ninguna cuenta: es pública");
});

test("las escenas aparecen en el orden de la narrativa y cada ancla del encabezado y del índice apunta a una sección real", () => {
  const order = ["<Hero />", "<ProductIndex />", "<SceneAgenda />", "<SceneStudents />", "<SceneCollections />", "<TourSection />", "<CalendarDetail />", "<StudentsDetail />", "<FinanceDetail />", "<HowItWorks />", "<Security />", "<Closing />"].map((tag) => PAGE.indexOf(tag));
  assert.ok(order.every((index) => index > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const ids = new Set([...SECTIONS.matchAll(/<section id="([a-z-]+)"/g), ...SECTIONS.matchAll(/<Reveal id="([a-z-]+)"/g)].map((match) => match[1]));
  for (const anchor of [...HEADER.matchAll(/href: "#([a-z-]+)"/g), ...SECTIONS.matchAll(/href="#([a-z-]+)"/g), ...SECTIONS.matchAll(/href: "#([a-z-]+)"/g)]) assert.ok(ids.has(anchor[1]) || anchor[1] === "top", `ancla sin destino: #${anchor[1]}`);
  for (const id of ["producto", "agenda", "recorrido", "calendario", "alumnos", "cobros", "como-funciona", "seguridad", "empezar"]) assert.ok(ids.has(id), id);
});

test("accesos: «Crear cuenta» y «Iniciar sesión» en el encabezado, el héroe y el cierre, hacia las rutas reales", () => {
  for (const source of [HEADER, SECTIONS]) {
    assert.match(source, /href="\/crear-cuenta"/);
    assert.match(source, /href="\/login"/);
  }
  assert.ok((SECTIONS.match(/href="\/crear-cuenta"/g) ?? []).length >= 2, "héroe y cierre");
  assert.match(HEADER, /sticky top-0/);
  assert.match(HEADER, /min-h-11/, "objetivos de 44 px en el encabezado");
});

test("el recorrido es un tablist accesible: roles, aria-selected, tabIndex rotativo, flechas, Inicio/Fin y botones con nombre", () => {
  for (const needle of ['role="tablist"', 'role="tab"', 'role="tabpanel"', "aria-selected={index === active}", "aria-controls", "aria-labelledby", "tabIndex={index === active ? 0 : -1}", '"ArrowRight"', '"ArrowLeft"', '"Home"', '"End"', 'aria-label="Pantalla anterior"', 'aria-label="Pantalla siguiente"', 'aria-live="polite"']) assert.ok(TOUR.includes(needle), needle);
  assert.match(TOUR, /min-h-11/, "pestañas de 44 px");
  assert.match(TOUR, /h-11 w-11/, "botones de 44 px");
  assert.match(TOUR, /hidden=\{index !== active\}/, "sólo se muestra la elegida");
  // Las maquetas se renderizan en el servidor, sin cascadas de carga al elegir pestañas.
  assert.doesNotMatch(TOUR, /next\/dynamic|ssr: false|import\("/);
  assert.match(TOUR, /screens\[index\]/);
  assert.match(TOUR, /inert=\{index !== active\}/);
  assert.equal((TOUR.match(/<Monitor /g) ?? []).length, 1, "un solo marco para las cinco pantallas");
  const natural = read("components/landing/landing-natural.css");
  assert.match(natural, /\.tf-tour-panel\[hidden\][\s\S]*?display: block; visibility: hidden/);
  assert.match(natural, /\.tf-tour-titles > p,\s*\.tf-landing \.tf-tour-texts > p \{ grid-area: 1 \/ 1/, "los textos comparten celda: el pie reserva el alto del más largo");
  assert.doesNotMatch(TOUR, /setInterval|autoplay|requestAnimationFrame/, "no avanza solo");
  for (const key of ["inicio", "calendario", "perfil", "cobros", "resumen"]) assert.ok(SECTIONS.includes(`key: "${key}"`), key);
});

test("recorrido: UN solo marco que cabe bajo el encabezado fijo, limitado por alto y por ancho, con controles que no cambian de lugar", () => {
  const css = read("components/landing/landing-natural.css");
  const tourRules = css.slice(css.indexOf("Recorrido: UN solo marco"), css.indexOf("Nombres largos"));
  // Alto: lo visible bajo el encabezado fijo (100svh − encabezado − relleno de la caja), nunca un alto fijo para todas las vistas.
  assert.match(tourRules, /100svh - var\(--tf-hdr\) - 2 \* var\(--tf-box-pad\)/, "limitado por la altura disponible bajo el encabezado");
  assert.match(tourRules, /@media \(min-width: 1024px\) \{\s*\.tf-landing \.tf-tour \{ height: clamp\([^;]*min\(calc\(100svh[^;]*cqw/, "en escritorio también lo limita el ancho");
  assert.match(tourRules, /\.tf-tour-box \{\s*container-type: inline-size;/, "el ancho de su caja es el contenedor de las unidades cqw");
  assert.doesNotMatch(tourRules, /\.tf-tour-stage \{[^}]*height: clamp\(\d+px, \d+vw/, "la pantalla ya no tiene un alto fijo por vista");
  // El alto lo reparte una columna flexible: pestañas y pie con su alto propio, la pantalla con lo que sobra.
  assert.match(tourRules, /\.tf-tour \{\s*display: flex;\s*flex-direction: column;/);
  assert.match(tourRules, /\.tf-tour-stage \{\s*display: grid;\s*flex: 1 1 0;/);
  assert.match(tourRules, /\.tf-tour-foot \{\s*display: grid;\s*flex: none;/);
  // Lo que no entra se recorre DENTRO de la pantalla; el marco exterior no crece ni oculta los controles.
  assert.match(tourRules, /\.tf-tour-panel \{[^}]*overflow: auto/);
  assert.match(tourRules, /\.tf-tour-stage \{ container: tstage \/ size; \}/, "la pantalla es un contenedor de tamaño: las demostraciones se componen según el alto que les toca");
  // Estructura: las pestañas, el marco y las flechas son hermanos del recorrido (no viven dentro de cada pantalla).
  const panel = TOUR.slice(TOUR.indexOf("tf-tour-panel"), TOUR.indexOf("tf-tour-foot"));
  assert.doesNotMatch(panel, /role="tab"|Pantalla (anterior|siguiente)/, "ningún control exterior dentro de una pantalla");
  assert.equal((TOUR.match(/Pantalla anterior/g) ?? []).length, 1);
  assert.equal((TOUR.match(/Pantalla siguiente/g) ?? []).length, 1);
  assert.doesNotMatch(TOUR, /\bmt-6\b|nav:mt-8/, "sin márgenes decorativos entre las partes");
  // La animación de cambio va en el panel (el contenedor que desplaza), no en la maqueta interna: no crea un desborde pasajero.
  assert.match(TOUR, /"tf-tour-panel tf-tab-in"/);
  const sections = read("components/landing/sections.tsx");
  assert.match(sections, /<Reveal id="recorrido-pantallas" delay=\{80\} className="tf-tour-box mt-8 scroll-mt-\[69px\] rounded-\[24px\] nav:mt-10"/, "la caja del recorrido ya no suma un relleno decorativo propio y es el destino de «Cómo funciona», alineada bajo el encabezado");
  assert.match(HEADER, /href="#recorrido-pantallas"/, "«Cómo funciona» lleva a la caja del recorrido (se ve completa bajo el encabezado)");
});

test("recorrido: las cinco maquetas se adaptan al alto con reglas del contenedor (sin reducir la interfaz) y conservan su contenido", () => {
  const css = read("components/landing/landing-natural.css");
  assert.match(css, /@container tstage \(min-width: 600px\) and \(max-height: 470px\)/);
  assert.doesNotMatch(css, /\.tf-tour[^{]*\{[^}]*(?:transform: scale|zoom:)/, "no se achica toda la interfaz");
  const screens = read("components/landing/screens.tsx");
  for (const marker of ["tf-mk-figs", "tf-mk-dayrows", "tf-mk-charges", "tf-mk-payments", "tf-mk-legend", "tf-mk-extra"]) assert.ok(screens.includes(marker), marker);
  assert.match(screens, /const HPX = "var\(--tf-hpx, 44px\)"/, "la hora del calendario es una variable (44 px fuera del recorrido)");
  assert.match(css, /\.tf-tour-stage \.tf-mk-tabbar \{ position: sticky; bottom: 0;/, "en teléfono la barra inferior queda al pie visible");
});

test("textos aprobados de la portada: «Pensado para profesores» en el héroe y nunca «Para profesoras y profesores independientes» como etiqueta", () => {
  assert.match(SECTIONS, /<Badge tone="accent">Pensado para profesores<\/Badge>/);
  assert.doesNotMatch(SECTIONS, /<Badge[^>]*>Para profesoras y profesores independientes<\/Badge>/);
  assert.doesNotMatch(SECTIONS, /TeacherFlow es la plataforma web para profesoras y profesores independientes\. Organizá/, "el párrafo del héroe aprobado (sin esa frase)");
  assert.match(SECTIONS, /Organizá tus clases y series, acompañá a tus alumnos y llevá tus cobros al día, sin planillas ni cuadernos\./);
});

test("movimiento: aparición de 320 ms con 16 px, una sola observadora, sin animaciones infinitas y con «reducir movimiento» respetado", () => {
  const css = read("app/globals.css");
  const landing = css.slice(css.indexOf("Landing pública"));
  assert.match(landing, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*\.tf-reveal\[data-state="pending"\][\s\S]*translateY\(16px\)/);
  assert.match(landing, /\.tf-reveal \{\s*transition: opacity 320ms[^;]*, transform 320ms/);
  assert.match(landing, /\.tf-tab-in \{\s*animation: tf-tab-in 260ms/);
  assert.doesNotMatch(landing, /infinite/, "ninguna animación infinita");
  assert.match(landing, /scroll-behavior: smooth/);
  assert.match(landing, /html:has\(\.tf-landing\)/, "el scroll suave sólo afecta a la landing");
  // el HTML llega visible; sólo se oculta (desde el cliente) lo que está bajo el primer viewport y nunca con «reducir movimiento»
  assert.doesNotMatch(REVEAL, /"use client"|useEffect/, "Reveal es sólo marcado");
  assert.match(CONTROLLER, /prefers-reduced-motion: reduce/);
  assert.match(CONTROLLER, /window\.innerHeight \* 0\.92/);
  assert.equal((CONTROLLER.match(/new IntersectionObserver/g) ?? []).length, 1);
  assert.match(PARALLAX, /prefers-reduced-motion: reduce/);
  assert.match(PARALLAX, /\{ passive: true \}/);
  assert.doesNotMatch(SECTIONS + TOUR, /animate-(pulse|spin|bounce|ping)/);
});

test("contenido: sin precios, suscripciones ni billing; sin imágenes; datos sintéticos; la 50/30/20 es una proyección", () => {
  const sources = ["components/landing/sections.tsx", "components/landing/screens.tsx", "components/landing/floats.tsx", "components/landing/site-header.tsx", "components/landing/tour.tsx", "lib/landing/demo-data.ts"].map(code).join("\n");
  assert.doesNotMatch(sources, /suscripci|\bprecio|Mobbex|facturaci|\$\s?\d+\s?\/\s?mes/i);
  assert.doesNotMatch(sources, /<img\b|\.jpe?g|\.webp|\.svg|background-image/i, "ninguna imagen: HTML y CSS");
  assert.deepEqual([...sources.matchAll(/\/[a-z-]+\.png/g)].map((match) => match[0]), ["/icon.png"], "la única imagen es el ícono de la marca");
  assert.doesNotMatch(sources, /@[a-z0-9-]+\.(com|ar|net)|\b\d{2}[ -]?\d{4}[ -]?\d{4}\b/i, "ningún correo ni teléfono");
  assert.match(sources, /no procesa pagos/);
  assert.match(sources, /no conoce tus gastos ni tu ahorro real/);
  assert.match(sources, /Proyección orientativa sobre lo cobrado/);
  // las barras de evolución son las del componente real (verdes: bg-ok)
  assert.match(SECTIONS, /<CollectedEvolutionChart series=\{DEMO_COLLECTED\}/);
  assert.match(read("components/finance/collected-evolution-chart.tsx"), /bg-ok/);
  assert.match(code("components/landing/screens.tsx"), /rounded-t-md bg-ok/, "las barras de la maqueta también son verdes");
});

test("seguridad: sólo las cuatro funciones reales, sin certificaciones, cifrado especial ni copias visibles", () => {
  const security = SECTIONS.slice(SECTIONS.indexOf("const SECURITY"), SECTIONS.indexOf("export function Security"));
  for (const text of ["Cada cuenta accede solamente a sus propios datos.", "Recuperación de contraseña", "Eliminación de cuenta y datos", "Sesión protegida"]) assert.ok(security.includes(text), text);
  assert.doesNotMatch(SECTIONS, /ISO ?27001|SOC ?2|GDPR|cifrad|encript|AES|backup|copia de seguridad|respaldo/i);
});

test("las maquetas son una sola imagen accesible con descripción y sin controles falsos enfocables", () => {
  const frame = code("components/landing/frame.tsx");
  assert.match(frame, /role="img" aria-label=\{label\}/);
  assert.equal((SECTIONS.match(/<MockScene label="/g) ?? []).length >= 7, true);
  for (const file of ["components/landing/screens.tsx", "components/landing/floats.tsx", "components/landing/frame.tsx"]) {
    assert.doesNotMatch(code(file), /<button\b|<a\b|<input\b|href=|tabIndex/, `${file}: nada enfocable dentro de una maqueta`);
  }
  assert.match(frame, /select-none/);
});

test("rendimiento: escenas bajo el primer viewport con content-visibility, sin fotografías, sin scripts de terceros", () => {
  assert.ok((SECTIONS.match(/tf-cv /g) ?? []).length >= 10);
  assert.match(read("app/globals.css"), /content-visibility: auto;\s*contain-intrinsic-size: auto 900px/);
  assert.doesNotMatch(SECTIONS + HEADER + PAGE, /<script|googletagmanager|analytics|gtag/i);
  assert.doesNotMatch(SECTIONS + TOUR, /<video|autoPlay|<iframe/);
});
