import { test } from "node:test";
import assert from "node:assert/strict";
import { INTENT_MIN_PAGE_AGE_MS, INTENT_PREFETCH_ROUTES, INTENT_REPEAT_AFTER_MS, intentPathname, shouldPrefetchOnIntent } from "../intent-prefetch.ts";

const base = { href: "/alumnos" as unknown, pageAgeMs: 10_000, nowMs: 1_000_000, lastPrefetchAtMs: null as number | null };

test("rutas: secciones y fichas elegidas por intención; nunca Inicio, edición ni destinos externos", () => {
  assert.equal(shouldPrefetchOnIntent(base), true);
  for (const href of ["/calendario", "/cobros", "/registro", "/recordatorios", "/resumen-financiero", "/configuracion", "/calendario/series", "/calendario/disponibilidad"]) assert.equal(shouldPrefetchOnIntent({ ...base, href }), true, href);
  for (const href of ["/inicio", "/alumnos/abc-123", "/alumnos/abc-123/editar", "/registro/9f8e", "/login", "/facturacion", "https://otro.com/alumnos", "//otro.com/alumnos", "alumnos", "", undefined, null, 42]) assert.equal(shouldPrefetchOnIntent({ ...base, href }), false, String(href));
  assert.ok(!INTENT_PREFETCH_ROUTES.has("/inicio"), "Inicio no tiene esqueleto: precargarlo ejecutaría la pantalla entera");
  const href="/alumnos/15c792ac-d3e6-497f-85ca-9a3ca5a4f42a";
  assert.equal(shouldPrefetchOnIntent({...base,href}),true);
  assert.equal(shouldPrefetchOnIntent({...base,href:`/cobros${href}?tab=cobros`}),true);
  assert.equal(shouldPrefetchOnIntent({...base,href,pageAgeMs:1}),false);
  assert.equal(shouldPrefetchOnIntent({...base,href,saveData:true}),false);
});

test("la consulta y el ancla no cambian la decisión, y la barra final se ignora", () => {
  assert.equal(intentPathname("/alumnos?pagina=2#x"), "/alumnos");
  assert.equal(intentPathname("/cobros/"), "/cobros");
  assert.equal(shouldPrefetchOnIntent({ ...base, href: "/calendario?vista=dia&fecha=2026-10-15" }), true);
});

test("nunca en los primeros 3 s de la página (sin ráfaga tras iniciar sesión)", () => {
  assert.equal(INTENT_MIN_PAGE_AGE_MS, 3000);
  assert.equal(shouldPrefetchOnIntent({ ...base, pageAgeMs: 0 }), false);
  assert.equal(shouldPrefetchOnIntent({ ...base, pageAgeMs: 2999 }), false);
  assert.equal(shouldPrefetchOnIntent({ ...base, pageAgeMs: 3000 }), true);
});

test("una vez por destino cada 60 s y nunca con ahorro de datos", () => {
  assert.equal(INTENT_REPEAT_AFTER_MS, 60_000);
  assert.equal(shouldPrefetchOnIntent({ ...base, lastPrefetchAtMs: base.nowMs - 1000 }), false);
  assert.equal(shouldPrefetchOnIntent({ ...base, lastPrefetchAtMs: base.nowMs - 59_999 }), false);
  assert.equal(shouldPrefetchOnIntent({ ...base, lastPrefetchAtMs: base.nowMs - 60_000 }), true);
  assert.equal(shouldPrefetchOnIntent({ ...base, saveData: true }), false);
});
