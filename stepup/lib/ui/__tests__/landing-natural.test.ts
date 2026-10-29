import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Estética natural de la landing: paleta, contraste, franja de anuncio, alcance de los estilos y conservación del contenido.
 * La medición visual (capturas, movimiento real, anchos 375/390/430/1366/1440) se hace en el navegador; acá se fija lo verificable en código.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const css = read("components/landing/landing-natural.css");
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");

const PAGE = code("app/page.tsx");
const BAR = code("components/landing/announcement-bar.tsx");
const SECTIONS = code("components/landing/sections.tsx");
const HEADER = code("components/landing/site-header.tsx");
const TOUR = code("components/landing/tour.tsx");
const FRAME = code("components/landing/frame.tsx");
const FLOATS = code("components/landing/floats.tsx");
const SCREENS = code("components/landing/screens.tsx");
const LANDING = [PAGE, BAR, SECTIONS, HEADER, TOUR, FRAME, FLOATS, SCREENS, code("lib/landing/demo-data.ts")].join("\n");

// ── Contraste WCAG ────────────────────────────────────────────────────────────────────────────────────────────────────
const channel = (hex: string, i: number) => {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const P = { cream: "#EAE6E1", surface: "#FCFAF6", beige: "#E5E0DA", lav: "#C2BFCB", lavSoft: "#E8E4EF", olive: "#7E7B46", oliveInk: "#5F5C2E", brown: "#583B1F" };

test("la paleta aprobada está declarada en la hoja de la landing", () => {
  for (const hex of [P.cream, P.surface, P.beige, P.lav, P.lavSoft, P.olive, P.brown]) assert.ok(cssCode.toLowerCase().includes(hex.toLowerCase()), hex);
  assert.match(cssCode, /DM Serif Display/);
  assert.match(cssCode, /DM Sans/);
});

test("contraste AA: texto ≥ 4,5:1 y gráficos ≥ 3:1 en cada combinación que usa la landing", () => {
  const text: [string, string, string][] = [
    ["marrón sobre crema", P.brown, P.cream],
    ["marrón sobre superficie", P.brown, P.surface],
    ["marrón sobre lavanda suave", P.brown, P.lavSoft],
    ["marrón sobre lavanda", P.brown, P.lav],
    ["marrón sobre beige", P.brown, P.beige],
    ["texto secundario sobre crema", "#675039", P.cream],
    ["texto secundario sobre lavanda suave", "#675039", P.lavSoft],
    ["texto secundario sobre superficie", "#675039", P.surface],
    ["texto secundario sobre beige", "#675039", P.beige],
    ["texto apagado sobre superficie", "#6F604F", P.surface],
    ["texto apagado sobre crema", "#6F604F", P.cream],
    ["texto apagado sobre lavanda suave", "#6F604F", P.lavSoft],
    ["texto apagado sobre beige", "#6F604F", P.beige],
    ["oliva oscuro (texto) sobre crema", P.oliveInk, P.cream],
    ["oliva oscuro (texto) sobre superficie", P.oliveInk, P.surface],
    ["oliva oscuro (texto) sobre lavanda suave", P.oliveInk, P.lavSoft],
    ["blanco sobre marrón", "#FFFFFF", P.brown],
    ["texto de escena marrón", "#F6F1E8", P.brown],
    ["texto apagado de escena marrón", "#DFD4C4", P.brown],
    ["lavanda sobre marrón", "#DFDBE8", P.brown],
    ["franja: marrón oscuro sobre amarillo", "#39250E", "#EFB83F"],
    ["insignia roja: blanco sobre rojo", "#FFFFFF", "#962A20"],
    ["pestaña elegida: marrón sobre lavanda suave", P.brown, P.lavSoft],
  ];
  for (const [name, fg, bg] of text) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}:1`);
  for (const [name, bg] of [["crema", P.cream], ["superficie", P.surface], ["lavanda suave", P.lavSoft]] as const) assert.ok(contrast(P.olive, bg) >= 3, `oliva gráfico sobre ${name}: ${contrast(P.olive, bg).toFixed(2)}:1`);
});

test("el texto secundario y el apagado no se usan sobre la lavanda #C2BFCB (no llegan a 4,5:1)", () => {
  assert.ok(contrast("#675039", P.lav) < 4.5 && contrast("#6F604F", P.lav) < 4.5, "premisa del criterio");
  // La lavanda #C2BFCB sólo aparece como borde, relleno de avatar o línea; nunca como fondo de sección ni de panel de texto.
  assert.doesNotMatch(cssCode, /\.tf-s-[a-z-]+\s*\{[^}]*background-color:\s*var\(--n-lav\)/);
  assert.match(cssCode, /\.tf-s-lav\s*\{\s*background-color:\s*var\(--n-lav-soft\)/);
});

test("todos los selectores de la hoja viven dentro de .tf-landing (nada toca la aplicación privada)", () => {
  const rules = [...cssCode.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim()).filter(Boolean);
  const bad: string[] = [];
  for (const selector of rules) {
    if (selector.startsWith("@")) continue;
    if (/^(from|to|\d+%)$/.test(selector)) continue;
    for (const part of selector.split(",")) if (!part.trim().startsWith(".tf-landing")) bad.push(part.trim());
  }
  assert.deepEqual(bad, [], "selectores fuera de .tf-landing");
  assert.doesNotMatch(cssCode, /:root|\bbody\b|\bhtml\b/, "sin selectores globales");
  assert.match(PAGE, /import "@\/components\/landing\/landing-natural\.css"/, "se importa desde app/page.tsx");
});

test("tipografía: DM Serif Display (títulos, una sola cifra de peso) y DM Sans, declaradas sólo para la portada", () => {
  assert.match(PAGE, /DM_Sans/);
  assert.match(PAGE, /DM_Serif_Display\(\{[^}]*weight: "400"[^}]*style: \["normal", "italic"\]/);
  assert.match(PAGE, /\$\{landingSans\.variable\} \$\{landingDisplay\.variable\}/);
  assert.match(cssCode, /\.tf-landing h1,[\s\S]*font-weight: 400;[\s\S]*font-synthesis: none/);
});

test("franja de anuncio: una sola, borde a borde, 34/30 px, amarillo y marrón, mensaje exacto", () => {
  assert.equal((PAGE.match(/<AnnouncementBar \/>/g) ?? []).length, 1);
  assert.ok(PAGE.indexOf("<AnnouncementBar />") < PAGE.indexOf("<SiteHeader />"), "arriba del encabezado");
  assert.ok(PAGE.indexOf("<AnnouncementBar />") < PAGE.indexOf("<main"), "fuera del contenido principal");
  assert.match(BAR, /<strong>15 % OFF<\/strong>/);
  assert.match(BAR, /<span>al pagar el año completo<\/span>/);
  assert.equal((LANDING.match(/15 % OFF/g) ?? []).length, 1, "no se duplica el anuncio en otras secciones");
  assert.doesNotMatch(BAR, /max-w|WRAP|rounded|px-4|mx-auto/, "sin ancho máximo, márgenes ni esquinas redondeadas");
  const announce = cssCode.match(/\.tf-landing \.tf-announce \{[^}]*\}/)?.[0] ?? "";
  for (const needle of ["width: 100%", "max-width: none", "height: 34px", "margin: 0", "border-radius: 0", "background-color: #efb83f", "color: #39250e"]) assert.ok(announce.includes(needle), needle);
  assert.match(cssCode, /@media \(max-width: 819px\) \{\s*\.tf-landing \.tf-announce \{\s*height: 30px/);
});

test("franja de anuncio: se desplaza a la izquierda sin salto, se pausa y respeta «reducir movimiento»", () => {
  assert.match(cssCode, /@keyframes tf-announce-left \{\s*from \{\s*transform: translate3d\(0, 0, 0\);\s*\}\s*to \{\s*transform: translate3d\(-50%, 0, 0\);/);
  assert.match(cssCode, /animation: tf-announce-left \d+s linear infinite/);
  assert.equal((cssCode.match(/infinite/g) ?? []).length, 1, "es la única animación infinita de la landing");
  assert.doesNotMatch(read("app/globals.css").slice(read("app/globals.css").indexOf("Landing pública")), /infinite/);
  // dos grupos idénticos: −50 % del recorrido equivale a una vuelta exacta (sin salto)
  assert.equal((BAR.match(/className="tf-announce-group"/g) ?? []).length, 2);
  assert.match(cssCode, /\.tf-announce:hover \.tf-announce-track,\s*\.tf-landing \.tf-announce:focus-within \.tf-announce-track \{\s*animation-play-state: paused/);
  const reduced = cssCode.slice(cssCode.indexOf("@media (prefers-reduced-motion: reduce)", cssCode.indexOf("tf-announce")));
  assert.match(reduced, /animation: none/);
  assert.match(reduced, /\.tf-announce-group \+ \.tf-announce-group,[\s\S]*display: none/);
  assert.doesNotMatch(cssCode, /will-change: (left|margin)|setInterval/, "sin JavaScript ni layout animado");
  assert.doesNotMatch(BAR, /"use client"|useEffect|setInterval|requestAnimationFrame/, "CSS puro");
});

test("franja de anuncio: copias ocultas a lectores y sin tabulaciones duplicadas; enlace al flujo real", () => {
  assert.match(BAR, /ghost \? \{ tabIndex: -1, "aria-hidden": true \}/);
  assert.match(BAR, /<Message key=\{index\} ghost=\{index > 0\} \/>/, "sólo la primera copia es enlace enfocable");
  assert.match(BAR, /<div className="tf-announce-group" aria-hidden="true">/);
  assert.match(BAR, /aria-label="Anuncio: 15 % de descuento al pagar el año completo"/);
  assert.match(BAR, /href="\/crear-cuenta"/, "el destino es la creación de cuenta real");
  assert.match(BAR, /import \{ TextLink \} from "@\/components\/auth\/public-links"/, "enlace público estándar, no next/link directo");
  assert.doesNotMatch(BAR, /from "next\/link"/);
  assert.doesNotMatch(BAR, /checkout|pagar ahora|comprar|mercadopago|mobbex|\$/i, "ningún checkout ficticio");
});

test("controles: 16 px en móvil y 44 px de alto en los controles reales de la landing", () => {
  assert.match(cssCode, /@media \(max-width: 819px\) \{\s*\.tf-landing \.tf-ctl \{\s*font-size: 16px;/);
  assert.match(cssCode, /\.tf-landing \.tf-ctl \{\s*min-height: 44px;/);
  assert.equal((HEADER.match(/tf-ctl/g) ?? []).length, 2, "Iniciar sesión y Crear cuenta del encabezado");
  assert.match(HEADER, /min-h-11 min-w-11/, "el logotipo también mide 44 px");
  assert.ok((SECTIONS.match(/tf-ctl/g) ?? []).length >= 5, "héroe (2), cierre (2) y enlaces de escena");
  assert.match(TOUR, /tf-tour-tab tf-ctl min-h-11/);
});

test("botones proporcionados al texto: no se estiran al ancho del contenedor", () => {
  assert.match(SECTIONS, /flex-col items-start gap-3[^"]*min-\[480px\]:flex-row min-\[480px\]:items-center/);
  assert.doesNotMatch(SECTIONS, /<ButtonLink[^>]*\bblock\b/);
});

test("secciones: fondos claros, lavanda y marrón alternados; cada una conserva su id y sus textos", () => {
  const classes = ["tf-s-hero", "tf-s-surface", "tf-s-cream", "tf-s-brown", "tf-s-lav", "tf-s-beige"];
  for (const name of classes) assert.ok(SECTIONS.includes(name), name);
  assert.ok((SECTIONS.match(/tf-s-lav /g) ?? []).length >= 3, "cobros-resumen, calendario y cómo funciona");
  assert.ok((SECTIONS.match(/tf-s-brown /g) ?? []).length === 2, "alumnos-resumen y cierre");
  for (const id of ["top", "producto", "agenda", "alumnos-resumen", "cobros-resumen", "recorrido", "calendario", "alumnos", "cobros", "como-funciona", "seguridad", "empezar"]) assert.ok(SECTIONS.includes(`id="${id}"`), id);
  // Textos conservados (títulos, índice, recorrido, preguntas, avisos legales de las maquetas)
  for (const text of [
    "Tu agenda, tus alumnos y tus cobros,", "en un solo lugar.", "Todo tu trabajo docente,", "Tu semana completa,", "Cada alumno,", "Sabés quién pagó,", "Elegí una pantalla y", "Del panorama de la semana", "Un perfil,", "Lo que cobrás,", "Cuatro pasos,", "Tus datos,", "Ordená tu trabajo docente",
    "Preguntas frecuentes", "¿TeacherFlow cobra o procesa los pagos de mis alumnos?", "TeacherFlow organiza y registra tus cobros: no procesa pagos.", "Pantallas con información ilustrativa.",
    "Inicio: el día de un vistazo", "Resumen financiero: lo cobrado, mes a mes", "Es una proyección sobre lo que cobraste", "Tus datos son tuyos", "Eliminación de cuenta y datos",
  ]) assert.ok(SECTIONS.includes(text), text);
  assert.ok(code("app/page.tsx").includes("TeacherFlow — para profesoras y profesores independientes."));
});

test("no reaparecen funciones retiradas: Comenzar clase, Ajustar horario, Visto/Planificado ni prefijos Ocultar", () => {
  assert.doesNotMatch(LANDING, /Comenzar clase|Ajustar horario|\bVisto\b|\bPlanificado\b|Ocultar/);
});

test("insignias de notificación rojas, con el dato en texto", () => {
  assert.match(FRAME, /export function NotificationBadge[\s\S]*bg-bad[\s\S]*text-white/);
  assert.match(SCREENS, /<NotificationBadge count=\{2\} \/>/);
  assert.match(FLOATS, /Recordatorio[\s\S]*bg-bad[\s\S]*2 pagos próximos a vencer/);
  assert.match(FLOATS, /<span aria-hidden className="absolute -right-2 -top-2/, "la insignia es decorativa: el dato va en texto");
});

test("nombres largos compactos y dona con el importe fuera del centro en móvil", () => {
  assert.ok((LANDING.match(/tf-name/g) ?? []).length >= 12);
  assert.match(cssCode, /\.tf-name \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
  assert.match(SCREENS, /tf-donut-center absolute inset-0/);
  assert.match(SCREENS, /tf-donut-caption/);
  assert.match(cssCode, /\.tf-donut-caption \{\s*display: none;/);
  assert.match(cssCode, /@media \(max-width: 819px\) \{\s*\.tf-landing \.tf-donut-center \{\s*display: none;\s*\}\s*\.tf-landing \.tf-donut-caption \{\s*display: block;/);
});

test("la escala de color del calendario y los semáforos no se reasignan", () => {
  for (const forbidden of [/#DDEEFF/i, /#FCE4D2/i, /#E9DDFC/i, /#FFF1B8/i, /#FCE8E6/i, /\.tf-landing \.(bg|text|border)-(ok|warn|bad|info|statusVerde|statusRojo|statusAmarillo|statusNaranja)/]) assert.doesNotMatch(cssCode, forbidden);
  assert.match(SECTIONS, /bg-\[#DDEEFF\]/, "las maquetas conservan su escala");
});
