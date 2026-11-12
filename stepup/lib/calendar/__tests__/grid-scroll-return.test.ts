import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { saveGridScroll, restoreGridScroll, restoredLeft, isUserScroll } from "../grid-scroll.ts";

test("returning to the same calendar restores both the hour and the weekend scroll once", () => {
  const data = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { setItem: (k: string, v: string) => data.set(k, v), getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => data.delete(k) } });
  try {
    saveGridScroll("/calendario?semana=qa", { scrollTop: 187, scrollLeft: 140 });
    const scroller = { scrollTop: 0, scrollLeft: 0 };
    assert.equal(restoreGridScroll("/calendario?semana=qa", scroller), true);
    assert.deepEqual(scroller, { scrollTop: 187, scrollLeft: 140 });
    assert.equal(restoreGridScroll("/calendario?semana=qa", scroller), false);
    saveGridScroll("/calendario?semana=qa", { scrollTop: 200, scrollLeft: 100 });
    assert.equal(restoreGridScroll("/calendario?semana=otra", scroller), false);
    assert.deepEqual(scroller, { scrollTop: 187, scrollLeft: 140 });
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

// 12/11/2026 (QA): al ensanchar la ventana (375 → 430 px) el desplazamiento horizontal pasaba de 100 a 81 px y se quedaba ahí. El navegador recorta `scrollLeft` al máximo viejo durante el cuadro en que las
// columnas todavía son angostas; ese recorte se tomaba por la posición de la usuaria. Un primer intento (ignorar el primer evento tras `resize`) dependía del orden de los eventos y dejó el desplazamiento en
// 0 en la versión publicada; el criterio actual es por gesto de la usuaria.
test("al reacomodarse las columnas se vuelve a la última posición real, acotada al máximo actual", () => {
  assert.equal(restoredLeft(100, 588, 430), 100, "cabe: se conserva");
  assert.equal(restoredLeft(100, 511, 430), 81, "no cabe todavía: el máximo actual");
  assert.equal(restoredLeft(300, 588, 430), 158, "más allá del final: el final");
  assert.equal(restoredLeft(-5, 588, 430), 0);
  assert.equal(restoredLeft(100, 300, 430), 0, "sin desplazamiento posible");
});

test("sólo un desplazamiento que sigue a un gesto de la usuaria cuenta como su posición; el recorte del navegador al cambiar el ancho, no", () => {
  assert.equal(isUserScroll(1000, 900), true, "dedo en curso");
  assert.equal(isUserScroll(2300, 1000), true, "inercia dentro del margen");
  assert.equal(isUserScroll(10_000, 1000), false, "mucho después del último gesto: es programático o del navegador");
  assert.equal(isUserScroll(500, Number.NEGATIVE_INFINITY), false, "sin gestos todavía");
  const source = readFileSync(fileURLToPath(new URL("../../../components/calendar/real-calendar-grid.tsx", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  for (const handler of ["onTouchStart", "onTouchMove", "onTouchEnd", "onWheel", "onPointerDown", "onKeyDown", "onFocus"]) assert.ok(source.includes(`${handler}={noteGesture}`), handler);
  assert.match(source, /if \(isUserScroll\(performance\.now\(\), gestureAtRef\.current\)\) userLeftRef\.current = element\.scrollLeft;/);
  assert.match(source, /const target = restoredLeft\(userLeftRef\.current, scroller\.scrollWidth, scroller\.clientWidth\);/);
  assert.match(source, /\}, \[expandedTotalPx\]\);/);
  assert.doesNotMatch(source, /resizePendingRef/, "no depende del orden de los eventos del navegador");
  // Un cambio de semana empieza en lunes y «volver de Nueva clase» devuelve la posición guardada: ambas son la posición «real».
  assert.match(source, /scroller\.scrollLeft = 0;\n\s+userLeftRef\.current = 0;/);
  assert.match(source, /userLeftRef\.current = scroller\.scrollLeft; \/\/ la posición devuelta/);
});
