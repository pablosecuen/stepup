import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { blend, contrastRatio } from "../contrast.ts";
import { FOCUSABLE_SELECTOR, trapTabTarget } from "../dialog-focus.ts";
import { centeredScrollLeft } from "../../nav/tab-scroll.ts";
import config from "../../../tailwind.config.ts";

/** B8 — accesibilidad y navegación móvil: contraste, objetivos táctiles, teclado, foco, semántica y estados. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

/** Etiquetas JSX de apertura (`<Link …>`, `<input …>`) con su posición; respeta llaves y comillas dentro de los atributos. */
function openingTags(source: string, names: string[]): Array<{ name: string; text: string; index: number }> {
  const result: Array<{ name: string; text: string; index: number }> = [];
  const re = new RegExp(`<(${names.join("|")})\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let quote: string | null = null;
    let end = -1;
    for (let i = m.index; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && source[i - 1] !== "=") {
        end = i;
        break;
      }
    }
    if (end > 0) result.push({ name: m[1], text: source.slice(m.index, end + 1), index: m.index });
  }
  return result;
}
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

// --- Contraste ---------------------------------------------------------------------------------------------------------

const colors = (config.theme!.extend as { colors: Record<string, string> }).colors;
const SURFACES = { white: "#FFFFFF", page: "#FAFAF8" };

test("contraste de texto: el texto y los colores de estado llegan a 4.5:1 sobre blanco, sobre el fondo y sobre su tinte del 10%", () => {
  const textColors = ["textPrimary", "textSecondary", "textMuted", "brandBlue", "brandBlueDark", "statusVerde", "statusAmarillo", "statusNaranja", "statusRojo", "statusPendiente", "pastelLavenderText", "pastelSageText"];
  for (const name of textColors) {
    const hex = colors[name];
    for (const [surfaceName, surface] of Object.entries(SURFACES)) {
      assert.ok(contrastRatio(hex, surface) >= 4.5, `${name} ${hex} sobre ${surfaceName}: ${contrastRatio(hex, surface).toFixed(2)}`);
    }
    if (name.startsWith("status") || name.startsWith("brand")) {
      const tint = blend(hex, SURFACES.white, 0.1);
      assert.ok(contrastRatio(hex, tint) >= 4.5, `${name} sobre su tinte 10%: ${contrastRatio(hex, tint).toFixed(2)}`);
    }
  }
});

test("contraste de controles: texto blanco sobre el azul de marca y el rojo (botones/insignias), borde de campos 3:1, anillo de foco 3:1", () => {
  assert.ok(contrastRatio("#FFFFFF", colors.brandBlue) >= 4.5, "blanco sobre azul de marca");
  assert.ok(contrastRatio("#FFFFFF", colors.brandBlueDark) >= 4.5, "blanco sobre azul oscuro (hover)");
  assert.ok(contrastRatio("#FFFFFF", colors.statusRojo) >= 4.5, "blanco sobre el rojo de la insignia");
  assert.ok(contrastRatio(colors.borderStrong, SURFACES.white) >= 3, "borde de campos sobre blanco");
  assert.ok(contrastRatio(colors.borderStrong, SURFACES.page) >= 3, "borde de campos sobre el fondo");
  assert.ok(contrastRatio(colors.brandBlue, SURFACES.page) >= 3, "anillo de foco sobre el fondo");
  assert.ok(contrastRatio(colors.brandBlue, SURFACES.white) >= 3, "anillo de foco sobre blanco");
  // El borde claro queda sólo para tarjetas y separadores: ningún campo lo usa.
  for (const file of sources(["app", "components"])) {
    for (const tag of openingTags(code(file), ["input", "select", "textarea"])) {
      if (/type="(checkbox|radio|hidden)"/.test(tag.text) || /\bsr-only\b/.test(tag.text)) continue;
      assert.doesNotMatch(tag.text, /\bborder-border\b(?!Strong)/, `${file}: campo con borde claro`);
    }
  }
});

test("el anillo de foco global usa el mismo azul de marca (3:1) y el texto de las tarjetas del calendario llega a 4.5:1 sobre todos sus fondos", () => {
  const css = read("app/globals.css");
  assert.match(css, /:focus-visible\s*\{\s*outline: 2px solid #0a64d2;\s*outline-offset: 2px;\s*\}/i);
  assert.equal(colors.brandBlue.toLowerCase(), "#0a64d2");
  const theme = read("lib/calendar-theme.ts");
  const text = { primary: /primary: "(#[0-9A-Fa-f]{6})"/.exec(theme)![1], secondary: /secondary: "(#[0-9A-Fa-f]{6})"/.exec(theme)![1] };
  for (const bg of ["#DDEEFF", "#FCE4D2", "#E9DDFC", "#FCE8E6"]) {
    assert.ok(contrastRatio(text.primary, bg) >= 4.5 && contrastRatio(text.secondary, bg) >= 4.5, `texto sobre ${bg}`);
  }
  // La escala congelada de fondo y borde no se tocó.
  assert.match(theme, /online: \{ bg: "#DDEEFF", border: "#2D6F91" \}/);
  assert.match(theme, /presencial: \{ bg: "#FCE4D2", border: "#A85A2A" \}/);
  assert.match(theme, /REPLACEMENT_COLORS = \{ bg: "#FCE8E6", border: "#D96C68" \}/);
});

// --- Objetivos táctiles ---------------------------------------------------------------------------------------------

test("objetivos táctiles de 44 px: regla global para campos, botones, resúmenes y casillas, con la grilla del calendario como única excepción", () => {
  const css = read("app/globals.css");
  assert.match(css, /button:not\(\[data-grid-event\]\),\s*summary\s*\{\s*min-height: 2\.75rem;/);
  assert.match(css, /button:not\(\[data-grid-event\]\)\s*\{\s*min-width: 2\.75rem;/);
  assert.match(css, /label:has\(> input\[type="checkbox"\]\),\s*label:has\(> input\[type="radio"\]\)\s*\{\s*min-height: 2\.75rem;/);
  // La única excepción es el bloque de la grilla horaria (su alto es la duración de la clase).
  const exempt = sources(["app", "components"]).filter((f) => /data-grid-event/.test(read(f)));
  assert.deepEqual(exempt, ["components/calendar/real-lesson-card.tsx"]);
});

test("todo enlace de texto o botón del área privada y pública declara 44 px de alto (salvo los de la lista)", () => {
  const EXEMPT = [/iniciando-sesion\/page\.tsx/, /nav\/account-menu\.tsx/, /nav\/private-link\.tsx/, /ui\/skip-link\.tsx/, /students\/student-card\.tsx/];
  const offenders: string[] = [];
  for (const file of sources(["app", "components"])) {
    if (EXEMPT.some((r) => r.test(file))) continue;
    const source = read(file);
    for (const tag of openingTags(source, ["Link", "PrivateLink", "a"])) {
      if (/sr-only|min-h-1[1-9]|min-h-\[|\bh-1[12]\b|min-h-16|min-h-14/.test(tag.text)) continue;
      offenders.push(`${file}:${lineOf(source, tag.index)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("los botones de iconos tienen el tamaño y la medida mínimos de 44 px", () => {
  const toolbar = code("components/calendar/real-calendar-toolbar.tsx");
  assert.equal((toolbar.match(/flex h-11 w-11 items-center justify-center rounded-full/g) ?? []).length, 2, "anterior y siguiente");
  assert.match(toolbar, /aria-label=\{isWeek \? "Semana anterior" : "Día anterior"\}/);
  assert.match(code("components/calendar/real-lesson-detail-modal.tsx"), /aria-label="Cerrar detalle de la clase"[\s\S]{0,200}?flex h-11 w-11/);
  assert.match(code("components/dashboard/home-view.tsx"), /relative flex h-11 w-11 items-center justify-center rounded-full/);
});

// --- Pestañas del perfil -----------------------------------------------------------------------------------------------

test("la pestaña activa del perfil se desplaza a la vista: posición centrada, acotada y sin valores inválidos", () => {
  // 7 pestañas de ~90 px en un contenedor de 320: la última queda centrada pero nunca más allá del final.
  assert.equal(centeredScrollLeft({ containerWidth: 320, contentWidth: 640, tabLeft: 540, tabWidth: 100 }), 320);
  assert.equal(centeredScrollLeft({ containerWidth: 320, contentWidth: 640, tabLeft: 0, tabWidth: 80 }), 0);
  assert.equal(centeredScrollLeft({ containerWidth: 320, contentWidth: 640, tabLeft: 300, tabWidth: 100 }), 190);
  assert.equal(centeredScrollLeft({ containerWidth: 800, contentWidth: 640, tabLeft: 300, tabWidth: 100 }), 0, "si todo entra no hay desplazamiento");
  assert.equal(centeredScrollLeft({ containerWidth: Number.NaN, contentWidth: 640, tabLeft: 300, tabWidth: 100 }), 0);
});

test("ProfileTabsNav: cliente, desplaza la pestaña activa al montar y al cambiar, aria-current y 44 px", () => {
  const nav = code("components/students/profile/profile-tabs-nav.tsx");
  assert.match(nav, /^"use client";/m);
  assert.match(nav, /centeredScrollLeft\(/);
  assert.match(nav, /scroller\.scrollLeft = /);
  assert.match(nav, /\}, \[active\]\);/);
  assert.match(nav, /ref=\{isActive \? activeRef : undefined\}/);
  assert.match(nav, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(nav, /inline-flex min-h-11 items-center/);
  assert.doesNotMatch(nav, /scrollIntoView/, "scrollIntoView movería también la página en vertical");
  assert.match(nav, /aria-label="Secciones del perfil"/);
});

// --- Saltar al contenido y estructura -----------------------------------------------------------------------------------

test("«Saltar al contenido»: primer elemento enfocable de toda página y cada <main> es su destino", () => {
  const layout = code("app/layout.tsx");
  assert.match(layout, /<SkipLink \/>\s*\{children\}/, "va antes de todo el contenido");
  const skip = code("components/ui/skip-link.tsx");
  assert.match(skip, /MAIN_CONTENT_ID = "contenido"/);
  assert.match(skip, /href=\{`#\$\{MAIN_CONTENT_ID\}`\}/);
  assert.match(skip, />\s*Saltar al contenido\s*</);
  assert.match(skip, /-translate-y-24[^"]*focus:translate-y-0/, "oculto hasta recibir el foco");
  const offenders: string[] = [];
  for (const file of sources(["app", "components"])) {
    const source = code(file);
    for (const tag of openingTags(source, ["main"])) {
      if (!/id="contenido"/.test(tag.text) || !/tabIndex=\{-1\}/.test(tag.text)) offenders.push(`${file}:${lineOf(source, tag.index)}`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.match(code("app/(app)/layout.tsx"), /<main id="contenido" tabIndex=\{-1\}/);
});

test("estructura: el shell privado tiene encabezado, dos navegaciones con nombre, un solo <main> y las pantallas un solo h1", () => {
  const nav = code("components/nav/primary-nav.tsx");
  assert.equal((nav.match(/aria-label="Navegación principal"/g) ?? []).length, 2, "barra inferior (móvil) y lateral (escritorio)");
  assert.match(nav, /aria-current=\{isActive \? "page" : undefined\}/);
  for (const file of sources(["app"]).filter((f) => f.endsWith("page.tsx"))) {
    const source = code(file);
    const h1Count = (source.match(/<h1\b/g) ?? []).length;
    assert.ok(h1Count <= 2, `${file}: ${h1Count} h1`); // una por rama (carga, error, contenido)
  }
});

// --- Teclado y foco ---------------------------------------------------------------------------------------------------

test("foco atrapado en un diálogo: Tab y Shift+Tab dan la vuelta, un foco fuera entra por el extremo correcto, sin elementos queda en el diálogo", () => {
  assert.equal(trapTabTarget({ count: 3, currentIndex: 2, shift: false }), 0);
  assert.equal(trapTabTarget({ count: 3, currentIndex: 0, shift: true }), 2);
  assert.equal(trapTabTarget({ count: 3, currentIndex: 1, shift: false }), null);
  assert.equal(trapTabTarget({ count: 3, currentIndex: 1, shift: true }), null);
  assert.equal(trapTabTarget({ count: 3, currentIndex: -1, shift: false }), 0);
  assert.equal(trapTabTarget({ count: 3, currentIndex: -1, shift: true }), 2);
  assert.equal(trapTabTarget({ count: 0, currentIndex: -1, shift: false }), -1);
  assert.equal(trapTabTarget({ count: 1, currentIndex: 0, shift: false }), 0);
  assert.match(FOCUSABLE_SELECTOR, /button:not\(\[disabled\]\)/);
});

test("el diálogo de la clase: Escape, foco atrapado, foco inicial, devolución del foco, nombre accesible y anuncios", () => {
  const hook = code("lib/ui/use-dialog-a11y.ts");
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /trapTabTarget\(/);
  assert.match(hook, /dialog\.focus\(\)/);
  assert.match(hook, /opener\.focus\(\)/, "devuelve el foco al control que abrió el diálogo");
  assert.match(hook, /document\.body\.style\.overflow = "hidden"/);
  assert.match(hook, /document\.body\.style\.overflow = previousOverflow/);
  const modal = code("components/calendar/real-lesson-detail-modal.tsx");
  assert.match(modal, /useDialogA11y\(onClose\)/);
  assert.match(modal, /role="dialog"[\s\S]{0,80}aria-modal="true"[\s\S]{0,80}aria-labelledby="lesson-detail-title"/);
  assert.match(modal, /tabIndex=\{-1\}/);
  assert.match(modal, /aria-busy=\{pending\}/);
  assert.match(modal, /role="status" aria-live="polite"/);
  assert.match(modal, /aria-label="Nueva fecha"/);
  assert.match(modal, /aria-label="Nueva hora"/);
  assert.match(modal, /\[reschedulingOpen, reschedulePreview !== null, confirmingCancel\]/, "el foco acompaña cada paso");
});

test("el menú de cuenta conserva Escape, devolución del foco y la semántica de menú", () => {
  const menu = code("components/nav/account-menu.tsx");
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /aria-expanded=\{open\}/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /triggerRef\.current\?\.focus\(\)/);
  assert.match(code("lib/nav/menu-keyboard.ts"), /Escape/);
});

test("foco visible: ningún control oculta su contorno sin poner su propio anillo (salvo los destinos de salto, sin tabulación)", () => {
  const offenders: string[] = [];
  for (const file of sources(["app", "components"])) {
    const source = code(file);
    for (const tag of openingTags(source, ["a", "Link", "PrivateLink", "button", "input", "select", "textarea", "summary", "div", "main", "label"])) {
      if (!/focus:outline-none/.test(tag.text)) continue;
      if (/focus-visible:ring|focus-visible:border|has-\[:focus-visible\]/.test(tag.text)) continue;
      if (/tabIndex=\{-1\}/.test(tag.text)) continue; // main y diálogo: se enfocan por programa, no por teclado
      offenders.push(`${file}:${lineOf(source, tag.index)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

// --- Nombres, etiquetas y estados -----------------------------------------------------------------------------------------

test("cada campo tiene nombre accesible: etiqueta asociada o envolvente, o aria-label (las excepciones están nombradas)", () => {
  // <label> sin htmlFor que no envuelve a su campo: sólo se admite si el campo siguiente lleva aria-label.
  const ALLOWED_SIBLING_LABELS: Record<string, number> = {
    "app/(app)/calendario/disponibilidad/availability-editor.tsx": 3,
    "app/(app)/registro/nuevo/nuevo-registro-form.tsx": 3,
  };
  for (const file of sources(["app", "components"])) {
    const source = code(file);
    const orphans = [...source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)].filter((m) => !/htmlFor=/.test(m[1]) && !/<(input|select|textarea)\b/.test(m[2]));
    assert.equal(orphans.length, ALLOWED_SIBLING_LABELS[file] ?? 0, `${file}: etiquetas sin asociar`);
  }
  const availability = code("app/(app)/calendario/disponibilidad/availability-editor.tsx");
  for (const label of ["Día de la semana", "Motivo del bloqueo", "Motivo de la excepción"]) assert.match(availability, new RegExp(`aria-label="${label}"`));
  const registro = code("app/(app)/registro/nuevo/nuevo-registro-form.tsx");
  for (const label of ["Modalidad", "Resultado", "Buscar alumno activo"]) assert.match(registro, new RegExp(`aria-label="${label}"`));
  // Campos del registro de clase: etiqueta envolvente.
  const workspace = code("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.match(workspace, /<label className="flex flex-col gap-1\.5">\s*<span className="text-xs font-medium text-textSecondary">Nota general/);
  assert.match(workspace, /<span className="text-xs font-medium text-textSecondary">Observaciones<\/span>/);
});

test("los botones de selección dicen su estado (aria-pressed) y no dependen sólo del color", () => {
  const checks: Array<[string, RegExp]> = [
    ["app/(app)/calendario/nueva/new-lesson-form.tsx", /aria-pressed=\{mode === "single"\}[\s\S]*aria-pressed=\{mode === "series"\}/],
    ["app/(app)/registro/[calendarLessonId]/registration-workspace.tsx", /aria-pressed=\{form\.attendanceStatus === option\}/],
    ["app/(app)/registro/[calendarLessonId]/registration-workspace.tsx", /aria-pressed=\{form\.homeworkReviews\[/],
    ["components/calendar/weekday-schedule-editor.tsx", /aria-pressed=\{cycleLengthWeeks === option\.value\}/],
    ["components/students/profile/reportes-tab.tsx", /aria-pressed=\{selectedMonths\.has\(month\)\}[\s\S]*<CheckIcon/],
    ["app/(app)/registro/nuevo/nuevo-registro-form.tsx", /aria-pressed=\{isSelected\}[\s\S]*\{isSelected \? "✓" : ""\}/],
    ["components/calendar/real-calendar-toolbar.tsx", /aria-current=\{isWeek \? "true" : undefined\}[\s\S]*aria-current=\{!isWeek \? "true" : undefined\}/],
    ["app/(app)/resumen-financiero/page.tsx", /aria-current=\{p === preset \? "true" : undefined\}[\s\S]*\{p === preset && <CheckIcon/],
    ["components/students/student-form-fields.tsx", /peer sr-only[\s\S]*peer-checked:inline[\s\S]*✓/],
    ["components/calendar/real-calendar-grid.tsx", /\(hoy\)/],
  ];
  for (const [file, pattern] of checks) assert.match(code(file), pattern, file);
  const card = code("components/calendar/real-lesson-card.tsx");
  assert.match(card, /metaParts\.push\("Reemplazo"\)/);
  assert.match(card, /metaParts\.push\("Pasada"\)/);
  assert.match(card, /, reemplazo/);
  assert.match(card, /, ya transcurrida/);
  assert.match(card, /CARD_TEXT_COLORS\.primary/);
});

test("mensajes anunciables: errores con role=alert, carga y avisos con role=status, el esqueleto con aria-busy", () => {
  const boxes = code("components/auth/form-boxes.tsx");
  assert.match(boxes, /<div role="alert"/);
  assert.match(boxes, /<div role="status"/);
  assert.match(code("components/ui/states.tsx"), /role="alert"/);
  assert.match(code("components/ui/states.tsx"), /role="status" aria-live="polite"/);
  assert.match(code("components/ui/page-skeleton.tsx"), /role="status" aria-busy="true" aria-live="polite"/);
  // Ningún icono decorativo queda sin ocultar en los controles nuevos o tocados.
  assert.match(code("components/calendar/real-calendar-toolbar.tsx"), /<ChevronLeftIcon className="h-5 w-5" aria-hidden \/>/);
});

test("alcance: B8 no toca autenticación, B0, Inicio ni la lógica de datos", () => {
  assert.match(code("app/(app)/inicio/page.tsx"), /redirect\(SESSION_RECOVERY_PATH\)/);
  for (const file of ["lib/ui/use-dialog-a11y.ts", "lib/ui/dialog-focus.ts", "lib/ui/contrast.ts", "lib/nav/tab-scroll.ts", "components/ui/skip-link.tsx"]) {
    assert.doesNotMatch(code(file), /supabase|fetch\(|\.rpc\(|signOut|redirect\(/i, file);
  }
});

test("los enlaces cortos de la cabecera del Calendario también miden 44 px de ancho (Series, medido en Production: 37 px)", () => {
  const page = code("app/(app)/calendario/page.tsx");
  assert.equal((page.match(/inline-flex min-h-11 min-w-11 items-center justify-center px-2/g) ?? []).length, 3);
  assert.match(page, /<nav aria-label="Secciones del calendario"/);
});
