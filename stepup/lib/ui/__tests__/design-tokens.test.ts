import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { contrastRatio } from "../contrast.ts";
import config from "../../../tailwind.config.ts";
import { avatarToneFor, AVATAR_TONE_COUNT } from "../avatar-tone.ts";

/** Rediseño visual v1 — Bloque 1: tokens, tipografías y componentes base (docs/design/web-v1/). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const colors = (config.theme!.extend as { colors: Record<string, string> }).colors;
const css = read("app/globals.css");

// Cada token de color con su variable CSS: tailwind.config.ts y globals.css no pueden divergir.
const TOKEN_VARIABLES: Record<string, string> = {
  background: "--tf-paper",
  paperDeep: "--tf-paper-deep",
  surface: "--tf-surface",
  surface2: "--tf-surface-2",
  border: "--tf-line",
  borderMid: "--tf-line-mid",
  borderStrong: "--tf-line-strong",
  ink: "--tf-ink",
  textSecondary: "--tf-text-2",
  textMuted: "--tf-muted",
  side: "--tf-side",
  side2: "--tf-side-2",
  sideActive: "--tf-side-active",
  sideLine: "--tf-side-line",
  sideText: "--tf-side-text",
  sideMuted: "--tf-side-muted",
  sideAccent: "--tf-side-accent",
  accent: "--tf-accent",
  accentDark: "--tf-accent-dark",
  accentSoft: "--tf-accent-soft",
  accentText: "--tf-accent-text",
  accentLine: "--tf-accent-line",
  ok: "--tf-ok",
  okSoft: "--tf-ok-soft",
  okLine: "--tf-ok-line",
  warn: "--tf-warn",
  warnSoft: "--tf-warn-soft",
  warnLine: "--tf-warn-line",
  bad: "--tf-bad",
  badSoft: "--tf-bad-soft",
  badLine: "--tf-bad-line",
  info: "--tf-info",
  infoSoft: "--tf-info-soft",
  infoLine: "--tf-info-line",
  dataNeeds: "--tf-data-needs",
};

test("cada token de color de Tailwind coincide con su variable CSS --tf-* (una sola fuente de valores)", () => {
  for (const [token, variable] of Object.entries(TOKEN_VARIABLES)) {
    const declared = new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6});`).exec(css);
    assert.ok(declared, `${variable} está declarada en :root`);
    assert.equal(declared![1].toLowerCase(), colors[token].toLowerCase(), `${token} ↔ ${variable}`);
  }
  // textPrimary es un alias de ink.
  assert.equal(colors.textPrimary, colors.ink);
});

test("la paleta cálida cumple contraste AA: texto 4.5:1 y fondos de tono 4.5:1; controles 3:1", () => {
  const surfaces = [colors.background, colors.surface, colors.surface2];
  for (const name of ["textPrimary", "textSecondary", "textMuted", "accentDark", "accentText"]) {
    for (const surface of surfaces) assert.ok(contrastRatio(colors[name], surface) >= 4.5, `${name} sobre ${surface}`);
  }
  assert.ok(contrastRatio(colors.accent, colors.background) >= 4.5, "acento sobre el papel");
  assert.ok(contrastRatio("#FFFFFF", colors.accent) >= 4.5, "blanco sobre el botón de acento");
  assert.ok(contrastRatio("#FFFFFF", colors.bad) >= 4.5, "blanco sobre el botón destructivo");
  assert.ok(contrastRatio(colors.background, colors.ink) >= 4.5, "marfil sobre el botón de tinta");
  // Cada tono de estado: su texto sobre su fondo suave.
  for (const tone of ["ok", "warn", "bad", "info"]) assert.ok(contrastRatio(colors[tone], colors[`${tone}Soft`]) >= 4.5, `${tone} sobre ${tone}Soft`);
  assert.ok(contrastRatio(colors.accentText, colors.accentSoft) >= 4.5);
  // Barra lateral: texto principal, secundario y marca del destino activo.
  for (const name of ["sideText", "sideMuted", "sideAccent"]) {
    assert.ok(contrastRatio(colors[name], colors.side) >= 4.5, `${name} sobre la barra`);
    assert.ok(contrastRatio(colors[name], colors.sideActive) >= 4.5, `${name} sobre el destino activo`);
  }
  assert.ok(contrastRatio("#FFFFFF", colors.sideActive) >= 4.5);
  // Controles de formulario.
  for (const surface of surfaces) assert.ok(contrastRatio(colors.borderStrong, surface) >= 3, `borde de campo sobre ${surface}`);
  assert.ok(contrastRatio("#7D7260", colors.surface) >= 4.5, "placeholder sobre la superficie");
  // Avatares: texto sobre su tono.
  const tones = [...css.matchAll(/\.tf-av-(\d) \{ background-color: (#[0-9A-F]{6}); color: (#[0-9A-F]{6}); \}/g)];
  assert.equal(tones.length, AVATAR_TONE_COUNT, "seis tonos de avatar");
  for (const [, n, bg, fg] of tones) assert.ok(contrastRatio(fg, bg) >= 4.5, `avatar ${n}`);
});

test("los tokens reservados siguen siendo suyos: el semáforo de cobro y el plan 50/30/20 no cambian de significado ni se reutilizan", () => {
  // Valores heredados que el rediseño NO toca (statusSinDatos sólo se oscurece para llegar a 4.5:1 sobre el papel cálido).
  assert.equal(colors.statusVerde, "#1B7634");
  assert.equal(colors.statusAmarillo, "#7F5F00");
  assert.equal(colors.statusNaranja, "#AA5208");
  assert.equal(colors.statusRojo, "#BF2A20");
  assert.equal(colors.statusPendiente, "#4361B8");
  assert.equal(colors.pastelLavender, "#E9E2FF");
  assert.equal(colors.pastelSageText, "#35613B");
  assert.equal(colors.brandBlue, "#0A64D2");
  // Azul con significado de dato (Necesidades del 50/30/20): token propio, no arrastrado por el retiro del azul de interfaz.
  assert.equal(colors.dataNeeds, "#0A64D2");
  const budget = code("components/account/budget-distribution-form.tsx");
  assert.match(budget, /text-dataNeeds/);
  assert.match(budget, /accent-dataNeeds/);
  assert.doesNotMatch(budget, /brandBlue/, "el plan 50/30/20 no depende del azul heredado");
  // Los componentes nuevos no usan los tokens exclusivos del plan 50/30/20 ni el semáforo.
  for (const file of ["button.tsx", "field.tsx", "notice.tsx", "badge.tsx", "card.tsx", "avatar.tsx", "table.tsx", "dialog.tsx", "menu-styles.ts", "states.tsx", "status-circle.tsx"]) {
    assert.doesNotMatch(code(`components/ui/${file}`), /pastelLavender|pastelSage|statusVerde|statusRojo|statusAmarillo|statusNaranja|brandBlue/, file);
  }
});

test("la escala congelada del calendario no se toca", () => {
  const theme = read("lib/calendar-theme.ts");
  assert.match(theme, /online: \{ bg: "#DDEEFF", border: "#2D6F91" \}/);
  assert.match(theme, /presencial: \{ bg: "#FCE4D2", border: "#A85A2A" \}/);
  assert.match(theme, /REPLACEMENT_COLORS = \{ bg: "#FCE8E6", border: "#D96C68" \}/);
});

test("tipografías: Hanken Grotesk (interfaz) y Fraunces (títulos) con next/font, expuestas como variables y usadas por Tailwind", () => {
  const layout = code("app/layout.tsx");
  assert.match(layout, /import \{ Fraunces, Hanken_Grotesk \} from "next\/font\/google"/);
  assert.match(layout, /Hanken_Grotesk\(\{ subsets: \["latin"\], variable: "--font-sans"/);
  assert.match(layout, /Fraunces\(\{ subsets: \["latin"\], variable: "--font-display"/);
  assert.match(layout, /className=\{`\$\{sans\.variable\} \$\{display\.variable\}`\}/, "las variables cuelgan de <html>");
  assert.match(layout, /<body className="[^"]*\bfont-sans\b/, "la interfaz entera usa la sans");
  const families = (config.theme!.extend as { fontFamily: Record<string, string[]> }).fontFamily;
  assert.equal(families.sans[0], "var(--font-sans)");
  assert.equal(families.display[0], "var(--font-display)");
  // Sin fuentes externas en tiempo de ejecución: la política de contenido sigue siendo `font-src 'self'`.
  assert.match(read("lib/security/security-headers.mjs"), /"font-src 'self'"/);
});

test("breakpoint de navegación: `nav` (820 px) entre md y lg, para que lg: siempre gane a nav:", () => {
  const screens = config.theme!.screens as Record<string, string>;
  assert.deepEqual(Object.keys(screens), ["sm", "md", "nav", "lg", "xl", "2xl"]);
  assert.equal(screens.nav, "820px");
});

test("globals.css: foco visible, objetivos táctiles de 44 px y movimiento reducido siguen vigentes", () => {
  assert.match(css, /:focus-visible \{\s*outline: 2\.5px solid #1C1812;/);
  assert.match(css, /button:not\(\[data-grid-event\]\),\s*summary \{\s*min-height: 2\.75rem;/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("buttonClass y linkClass: TODA variante y tamaño trae min-h-11 (objetivo táctil de 44 px, B8)", () => {
  const button = code("components/ui/button.tsx");
  // La base común lleva min-h-11 y ninguna variante ni tamaño la reemplaza por algo menor.
  assert.match(button, /const BASE =\s*"[^"]*\bmin-h-11\b/);
  assert.match(button, /return \[BASE, VARIANTS\[variant\], SIZES\[size\], block \? "w-full" : ""\]/);
  const variants = button.slice(button.indexOf("const VARIANTS"), button.indexOf("const SIZES"));
  assert.doesNotMatch(variants, /\bmin-h-|\bh-\d/, "las variantes sólo cambian color");
  assert.match(button, /lg: "min-h-\[52px\] px-6 text-base"/);
  assert.match(button, /md: ""/, "no existe un tamaño por debajo de 44 px");
  assert.match(button, /export function linkClass[\s\S]*inline-flex min-h-11/);
  assert.match(button, /disabled:pointer-events-none/, "deshabilitado no recibe eventos");
  for (const variant of ["primary", "accent", "secondary", "ghost", "danger", "dangerOutline"]) assert.match(button, new RegExp(variant + ': "'));
});

test("avatarToneFor: estable, dentro de 0–5 y con reparto razonable", () => {
  assert.equal(avatarToneFor("abc"), avatarToneFor("abc"));
  const seen = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const tone = avatarToneFor(`alumno-${i}`);
    assert.ok(Number.isInteger(tone) && tone >= 0 && tone < AVATAR_TONE_COUNT);
    seen.add(tone);
  }
  assert.ok(seen.size >= 4, "usa varios tonos");
});

test("componentes base: roles y semántica accesible", () => {
  const notice = code("components/ui/notice.tsx");
  assert.match(notice, /aria-hidden/, "el ícono del aviso es decorativo");
  assert.match(notice, /role=\{role \?\? \(tone === "bad" \? "alert" : "status"\)\}/);
  const field = code("components/ui/field.tsx");
  assert.match(field, /<label htmlFor=\{htmlFor\}/, "la etiqueta se asocia por htmlFor");
  assert.match(field, /role="alert"/, "el error de un campo se anuncia");
  assert.match(field, /aria-\[invalid=true\]:border-bad/, "el estado inválido se ve (borde) y se dice (aria-invalid)");
  assert.match(field, /min-h-\[46px\]/);
  const dialog = code("components/ui/dialog.tsx");
  assert.match(dialog, /role="dialog"[\s\S]{0,80}aria-modal="true"[\s\S]{0,80}aria-labelledby=\{titleId\}/);
  assert.match(dialog, /useDialogA11y\(onClose\)/, "Escape, foco atrapado y devolución del foco");
  assert.match(dialog, /aria-label="Cerrar"/);
  assert.match(dialog, /flex-col-reverse/, "en la hoja móvil la acción principal queda arriba");
  assert.match(dialog, /nav:items-center/, "centrado desde 820 px; hoja inferior por debajo");
  const table = code("components/ui/table.tsx");
  assert.match(table, /scope="col"/);
  assert.match(table, /<caption className="sr-only">/);
});

test("alcance: el Bloque 1 no toca lógica de negocio, Supabase, migraciones, autenticación ni datos", () => {
  for (const file of ["button.tsx", "field.tsx", "notice.tsx", "badge.tsx", "card.tsx", "avatar.tsx", "table.tsx", "dialog.tsx", "brand.tsx", "status-circle.tsx"]) {
    assert.doesNotMatch(code(`components/ui/${file}`), /supabase|\.rpc\(|\.from\(|fetch\(|signOut|redirect\(|process\.env/i, file);
  }
});
