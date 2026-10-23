import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSoftKeyboardOpen, nextBaseline, type KeyboardBaseline } from "../soft-keyboard.ts";

const IPHONE = { width: 390, height: 844 };

test("teclado abierto: hay un campo enfocado Y el área visible perdió una parte grande del alto estable", () => {
  const baseline: KeyboardBaseline = { width: IPHONE.width, height: IPHONE.height };
  // iOS anclado: el viewport de layout se achica con el teclado (844 → ~430).
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 390, visibleHeight: 430 } }), true);
  // Safari/Chrome de Android: sólo el viewport visual se achica; mismo resultado.
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 390, visibleHeight: 520 } }), true);
});

test("sin campo enfocado nunca es teclado, aunque el alto sea menor (barra de direcciones, ventana más baja)", () => {
  const baseline: KeyboardBaseline = { width: 390, height: 844 };
  assert.equal(isSoftKeyboardOpen({ editableFocused: false, baseline, measure: { width: 390, visibleHeight: 430 } }), false);
});

test("con teclado físico o selector sin altura el foco existe pero el área visible casi no cambia: no se oculta la barra", () => {
  const baseline: KeyboardBaseline = { width: 390, height: 844 };
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 390, visibleHeight: 844 } }), false);
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 390, visibleHeight: 790 } }), false, "la barra de atajos del teclado físico (~55 px)");
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 390, visibleHeight: 760 } }), false, "la barra de direcciones de Safari (~80 px)");
});

test("el alto estable sólo crece (un teclado abierto no se confunde con una pantalla más baja) y se reinicia al rotar", () => {
  let baseline = nextBaseline(null, { width: 390, visibleHeight: 664 });
  baseline = nextBaseline(baseline, { width: 390, visibleHeight: 750 });
  assert.equal(baseline.height, 750, "crece cuando se pliega la barra de Safari");
  baseline = nextBaseline(baseline, { width: 390, visibleHeight: 400 });
  assert.equal(baseline.height, 750, "con el teclado abierto no baja");
  // Rotación a horizontal: ancho distinto → se vuelve a medir.
  baseline = nextBaseline(baseline, { width: 844, visibleHeight: 390 });
  assert.deepEqual(baseline, { width: 844, height: 390 });
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 844, visibleHeight: 390 } }), false, "horizontal sin teclado");
  assert.equal(isSoftKeyboardOpen({ editableFocused: true, baseline, measure: { width: 844, visibleHeight: 190 } }), true, "horizontal con teclado (queda muy poco alto)");
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("cableado: una sola pieza compartida en el layout privado, la barra se oculta por CSS y nada del shell usa la zona segura inferior cruda", () => {
  assert.match(read("app/(app)/layout.tsx"), /<SoftKeyboardSync \/>/);
  assert.match(read("components/nav/primary-nav.tsx"), /<nav\s+aria-label="Navegación principal"\s+data-tf-bottom-nav/);
  const css = read("app/globals.css");
  assert.match(css, /html\[data-tf-keyboard="open"\] \[data-tf-bottom-nav\] \{\s+display: none;/);
  assert.match(css, /html\[data-tf-keyboard="open"\] \{\s+--tf-safe-bottom: 0px;\s+--tf-m-nav: 0px;/);
  assert.match(css, /@media \(max-width: 819\.98px\) \{\s+html\[data-tf-keyboard="open"\]/, "sólo móvil: el escritorio no cambia");
  // Todo lo anclado abajo usa la variable (que el teclado anula), nunca `env(safe-area-inset-bottom)` suelto.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.(tsx|ts)$/.test(name) && /env\(safe-area-inset-bottom/.test(read(path))) offenders.push(path);
    }
  };
  for (const dir of ["app", "components"]) walk(dir);
  assert.deepEqual(offenders, [], "usar var(--tf-safe-bottom)");
  assert.match(read("components/ui/dialog.tsx"), /max-h-\[min\(92vh,92dvh\)\]/, "el diálogo respeta el alto visible (dvh) cuando el viewport se achica");
});

test("cableado: el efecto escucha el viewport visual, la ventana, la rotación y el foco; no bloquea el scroll ni el zoom", () => {
  const sync = read("components/nav/soft-keyboard-sync.tsx");
  for (const event of ["visualViewport", '"resize"', '"orientationchange"', '"focusin"', '"focusout"']) assert.ok(sync.includes(event), event);
  assert.doesNotMatch(sync, /preventDefault|overflow|touchmove|user-scalable|maximum-scale/);
  assert.doesNotMatch(read("app/layout.tsx") + read("app/(app)/layout.tsx"), /maximumScale|userScalable/);
});
