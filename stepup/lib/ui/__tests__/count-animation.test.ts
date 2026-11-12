import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { COUNT_ANIMATION_MS, countValueAt, createBrowserCountEnv, runCountAnimation, type CountEnv } from "../count-animation.ts";
import * as numberFormat from "../../format/number-format.ts";
import * as countAnimation from "../count-animation.ts";

/** Reloj de cuadros simulado: `advance(ms)` ejecuta los cuadros pendientes. */
function clock() {
  let now = 0, nextId = 1;
  const pending = new Map<number, (t: number) => void>();
  return {
    requestAnimationFrame: (cb: (t: number) => void) => { const id = nextId++; pending.set(id, cb); return id; },
    cancelAnimationFrame: (id: number) => { pending.delete(id); },
    advance(ms: number, step = 16) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + step);
        const due = [...pending.entries()];
        pending.clear();
        for (const [, cb] of due) cb(now);
      }
    },
    get pendingFrames() { return pending.size; },
  };
}

function fakeEnv(options: { visibleNow?: boolean; observer?: boolean; reduced?: boolean } = {}) {
  const c = clock();
  const motionListeners = new Set<() => void>();
  const visibilityListeners = new Set<(v: boolean) => void>();
  let reduced = options.reduced ?? false;
  let watched = 0, unwatched = 0;
  const env: CountEnv = {
    prefersReducedMotion: () => reduced,
    onReducedMotionChange: l => { motionListeners.add(l); return () => motionListeners.delete(l); },
    isVisibleNow: () => options.visibleNow ?? false,
    watchVisibility: options.observer === false ? null : l => { watched++; visibilityListeners.add(l); return () => { unwatched++; visibilityListeners.delete(l); }; },
    requestFrame: c.requestAnimationFrame, cancelFrame: c.cancelAnimationFrame,
  };
  return {
    env, clock: c,
    setReduced(v: boolean) { reduced = v; motionListeners.forEach(l => l()); },
    becomeVisible() { visibilityListeners.forEach(l => l(true)); },
    get watched() { return watched; }, get unwatched() { return unwatched; }, get activeObservers() { return visibilityListeners.size; },
  };
}

function record() {
  const events: { value: number; final: boolean }[] = [];
  return { events, emit: (value: number, final: boolean) => { events.push({ value, final }); }, get last() { return events[events.length - 1]; } };
}

test("countValueAt: monótono, el último valor es exactamente el recibido y los importes se redondean a centavos", () => {
  assert.equal(countValueAt(0, 1234.56, 1, "money"), 1234.56);
  assert.equal(countValueAt(0, 1234.56, 2, "money"), 1234.56);
  assert.equal(countValueAt(0, 10, 0, "count"), 0);
  let previous = -1;
  for (let step = 0; step <= 20; step++) {
    const value = countValueAt(0, 987654.32, step / 20, "money");
    assert.ok(value >= previous);
    assert.equal(Math.round(value * 100) / 100, value, "nunca fracciones de centavo");
    previous = value;
  }
  assert.equal(Number.isInteger(countValueAt(0, 7, 0.4, "count")), true);
  // Desde un valor anterior hacia uno menor también termina exacto.
  assert.equal(countValueAt(500, 120.5, 1, "money"), 120.5);
});

test("un contador parcialmente visible cerca del borde inferior arranca y termina en el valor final", () => {
  const sim = fakeEnv({ visibleNow: false });
  const out = record();
  runCountAnimation({ from: 0, to: 1234.5, kind: "money", env: sim.env, emit: out.emit });
  assert.equal(out.events.length, 0, "fuera de pantalla no se emite ningún 0: el consumidor muestra el valor final");
  assert.equal(sim.activeObservers, 1);
  sim.becomeVisible(); // entra sólo un borde
  assert.equal(sim.activeObservers, 0, "el observador se corta al arrancar");
  assert.deepEqual(out.events[0], { value: 0, final: false });
  sim.clock.advance(COUNT_ANIMATION_MS + 100);
  assert.deepEqual(out.last, { value: 1234.5, final: true });
  assert.equal(sim.clock.pendingFrames, 0);
});

test("createBrowserCountEnv: umbral 0, sin margen recortado, y un píxel visible alcanza", () => {
  const sim = clock();
  const created: { options: IntersectionObserverInit | undefined; observed: Element[]; disconnected: boolean; callback: IntersectionObserverCallback }[] = [];
  class FakeObserver {
    record: (typeof created)[number];
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.record = { options, observed: [], disconnected: false, callback }; created.push(this.record); }
    observe(el: Element) { this.record.observed.push(el); }
    disconnect() { this.record.disconnected = true; }
  }
  const innerHeight = 800;
  const makeElement = (top: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + 30, left: 10, right: 120 }) }) as unknown as Element;
  const win = (extra: object = {}) => ({ matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), requestAnimationFrame: sim.requestAnimationFrame, cancelAnimationFrame: sim.cancelAnimationFrame, innerWidth: 400, innerHeight, ...extra }) as never;

  // A 1 px del borde inferior: ya se ve → arranca de inmediato, sin esperar al observador.
  const nearEdge = createBrowserCountEnv(makeElement(innerHeight - 1), win({ IntersectionObserver: FakeObserver }));
  assert.equal(nearEdge.isVisibleNow(), true);
  const out = record();
  runCountAnimation({ from: 0, to: 25, kind: "count", env: nearEdge, emit: out.emit });
  assert.deepEqual(out.events[0], { value: 0, final: false });
  sim.advance(COUNT_ANIMATION_MS + 50);
  assert.deepEqual(out.last, { value: 25, final: true });

  // Debajo del borde: espera, y al entrar cualquier intersección arranca.
  const below = createBrowserCountEnv(makeElement(innerHeight + 40), win({ IntersectionObserver: FakeObserver }));
  assert.equal(below.isVisibleNow(), false);
  const out2 = record();
  runCountAnimation({ from: 0, to: 9, kind: "count", env: below, emit: out2.emit });
  const observer = created[created.length - 1];
  assert.deepEqual(observer.options, { threshold: 0 }, "sin rootMargin recortado ni umbral de 50 %");
  assert.equal(out2.events.length, 0);
  observer.callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
  assert.equal(out2.events.length, 0);
  observer.callback([{ isIntersecting: true, intersectionRatio: 0.02 } as IntersectionObserverEntry], {} as IntersectionObserver);
  assert.deepEqual(out2.events[0], { value: 0, final: false });
  assert.equal(observer.disconnected, true);
  sim.advance(COUNT_ANIMATION_MS + 50);
  assert.deepEqual(out2.last, { value: 9, final: true });
});

test("sin IntersectionObserver, con movimiento reducido o sin cambio de valor: valor final inmediato y sin cuadros", () => {
  for (const variant of [{ observer: false }, { reduced: true }, { visibleNow: true, reduced: true }]) {
    const sim = fakeEnv(variant);
    const out = record();
    runCountAnimation({ from: 0, to: 4321, kind: "money", env: sim.env, emit: out.emit });
    assert.deepEqual(out.events, [{ value: 4321, final: true }], JSON.stringify(variant));
    assert.equal(sim.clock.pendingFrames, 0);
    assert.equal(sim.activeObservers, 0);
  }
  const same = fakeEnv({ visibleNow: true });
  const out = record();
  runCountAnimation({ from: 7, to: 7, kind: "count", env: same.env, emit: out.emit });
  assert.deepEqual(out.events, [{ value: 7, final: true }]);
});

test("el valor ausente o inválido nunca anima ni muestra NaN", () => {
  const sim = fakeEnv({ visibleNow: true });
  const out = record();
  runCountAnimation({ from: 0, to: Number.NaN, kind: "money", env: sim.env, emit: out.emit });
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].final, true);
  assert.equal(sim.clock.pendingFrames, 0);
});

test("movimiento reducido activado a mitad de camino deja el valor final y corta los cuadros", () => {
  const sim = fakeEnv({ visibleNow: true });
  const out = record();
  runCountAnimation({ from: 0, to: 600, kind: "count", env: sim.env, emit: out.emit });
  sim.clock.advance(300);
  assert.equal(out.last.final, false);
  sim.setReduced(true);
  assert.deepEqual(out.last, { value: 600, final: true });
  assert.equal(sim.clock.pendingFrames, 0);
  const emitted = out.events.length;
  sim.clock.advance(1000);
  assert.equal(out.events.length, emitted, "ni un cuadro más después de terminar");
});

test("interrumpir (cambio de navegación o de período) corta todo y no deja una animación vieja pisando a la nueva", () => {
  const sim = fakeEnv({ visibleNow: true });
  const first = record();
  const a = runCountAnimation({ from: 0, to: 1000, kind: "money", env: sim.env, emit: first.emit });
  sim.clock.advance(300);
  const emittedBefore = first.events.length;
  a.dispose();
  assert.equal(sim.clock.pendingFrames, 0, "ningún cuadro pendiente de la animación cortada");
  // Período nuevo: parte desde lo que se veía y llega exacto al valor nuevo.
  const shown = first.last.value;
  const second = record();
  runCountAnimation({ from: shown, to: 250.75, kind: "money", env: sim.env, emit: second.emit });
  sim.clock.advance(COUNT_ANIMATION_MS + 100);
  assert.equal(first.events.length, emittedBefore, "la primera no emite después de cortada");
  assert.deepEqual(second.last, { value: 250.75, final: true });
  assert.equal(sim.clock.pendingFrames, 0);
  // Cortar antes de que sea visible libera el observador.
  const hidden = fakeEnv({ visibleNow: false });
  const out = record();
  const run = runCountAnimation({ from: 0, to: 3, kind: "count", env: hidden.env, emit: out.emit });
  assert.equal(hidden.activeObservers, 1);
  run.dispose(); run.dispose();
  assert.equal(hidden.activeObservers, 0);
  hidden.becomeVisible();
  assert.equal(out.events.length, 0);
});

test("la animación completa dura lo previsto y termina en el cuadro en que se cumple el tiempo", () => {
  const sim = fakeEnv({ visibleNow: true });
  const out = record();
  runCountAnimation({ from: 0, to: 1500, kind: "money", env: sim.env, emit: out.emit });
  sim.clock.advance(COUNT_ANIMATION_MS / 2);
  assert.equal(out.last.final, false);
  assert.ok(out.last.value > 0 && out.last.value < 1500);
  sim.clock.advance(COUNT_ANIMATION_MS);
  assert.equal(out.last.final, true);
  assert.equal(out.events.filter(e => e.final).length, 1, "un solo cierre");
});

// ── Componente real: HTML de servidor (lo que ve quien aún no hidrató y lo que lee un lector de pantalla) ──
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../../components/ui/animated-number.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsOfComponent: Record<string, never> = {};
new Function("require", "exports", compiled)((id: string) => ({ "@/lib/format/number-format": numberFormat, "@/lib/ui/count-animation": countAnimation })[id] ?? require(id), exportsOfComponent);
const AnimatedNumber = exportsOfComponent.AnimatedNumber as unknown as (props: { value: number; kind?: string }) => import("react").ReactNode;

function texts(html: string) {
  const sr = /<span class="sr-only">([^<]*)<\/span>/.exec(html)?.[1];
  const visible = /<span aria-hidden="true" class="col-start-1 row-start-1" data-count-visible="true">([^<]*)<\/span>/.exec(html)?.[1];
  return { sr, visible };
}

test("AnimatedNumber real: el texto visible y el accesible coinciden con el valor final, con centavos exactos", () => {
  const cases: [number, string, string][] = [[0, "money", "$"], [1234.5, "money", "1.234,50"], [15000, "money", "15.000"], [7, "count", "7"], [2.5, "hours", "2,5 h"], [80, "percent", "80%"]];
  for (const [value, kind, fragment] of cases) {
    const html = renderToStaticMarkup(createElement(AnimatedNumber, { value, kind }));
    const { sr, visible } = texts(html);
    assert.ok(sr && visible, html);
    assert.equal(visible, sr, `visible = accesible para ${kind} ${value}`);
    assert.ok(sr.includes(fragment), `${sr} contiene ${fragment}`);
    assert.doesNotMatch(html, /NaN/);
  }
  // Nunca se prepara un 0 en el HTML inicial de un valor distinto de cero.
  const { visible } = texts(renderToStaticMarkup(createElement(AnimatedNumber, { value: 4200, kind: "count" })));
  assert.equal(visible, "4.200");
});

test("el componente compartido no contiene los mecanismos que dejaban el contador en cero", () => {
  assert.doesNotMatch(source, /rootMargin|intersectionRatio\s*>=|threshold:\s*\.5|new IntersectionObserver/, "la visibilidad vive en count-animation.ts");
  assert.doesNotMatch(source, /textContent\s*=/, "React es el único dueño del texto: nada de mutar nodos a mano");
  const lib = readFileSync(new URL("../count-animation.ts", import.meta.url), "utf8");
  assert.doesNotMatch(lib, /rootMargin|setTimeout/, "ni márgenes recortados ni esperas artificiales");
});

test("los gráficos de Finanzas usan la misma regla: un píxel visible alcanza y sin observador quedan completos", () => {
  const motion = readFileSync(new URL("../../../components/finance/finance-motion.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(motion, /rootMargin|intersectionRatio/, "sin margen recortado ni porcentaje mínimo");
  assert.match(motion, /threshold:\s*0/);
  assert.match(motion, /typeof IntersectionObserver === "undefined"[^\n]*animation\.cancel\(\)/, "sin observador se cancelan las animaciones pausadas y quedan las barras completas");
});
