import { test } from "node:test";
import assert from "node:assert/strict";
import { MOBILE_MAX_DAY_COLUMN_PX, MOBILE_TIME_COLUMN_WIDTH_PX, dayColumnWidthPx, mobileWeekColumns } from "../layout.ts";

const area = 390;
const tc = MOBILE_TIME_COLUMN_WIDTH_PX;

test("semana en el teléfono sin clases simultáneas: todos los días conservan el ancho común y nada se desplaza", () => {
  const result = mobileWeekColumns({ areaWidthPx: area, timeColumnPx: tc, needPx: [0, 40, 40, 0, 48, 0, 0] });
  const common = dayColumnWidthPx(area, 7, tc, 0) + 1;
  assert.ok(result.trackPx.every((px) => Math.abs(px - common) < 1e-9));
  assert.equal(result.expanded, false);
  assert.ok(Math.abs(result.totalPx - area) < 1e-6, "la grilla ocupa justo el ancho de la pantalla");
});

test("un día con varios carriles ensancha sólo su columna y la grilla se desplaza hacia los costados", () => {
  const result = mobileWeekColumns({ areaWidthPx: area, timeColumnPx: tc, needPx: [0, 0, 189, 0, 0, 0, 0] });
  const common = dayColumnWidthPx(area, 7, tc, 0) + 1;
  assert.equal(result.expanded, true);
  assert.equal(result.trackPx[2], 190, "ancho del día = lo que piden sus carriles + el borde");
  assert.ok(result.trackPx.filter((_, index) => index !== 2).every((px) => Math.abs(px - common) < 1e-9), "los demás días no cambian");
  assert.ok(result.totalPx > area);
});

test("el ancho de un día tiene techo: más carriles no ensanchan sin límite (el texto se acorta con «…»)", () => {
  const result = mobileWeekColumns({ areaWidthPx: area, timeColumnPx: tc, needPx: [900, 0, 0, 0, 0, 0, 0] });
  assert.equal(result.trackPx[0], MOBILE_MAX_DAY_COLUMN_PX);
});

test("nunca queda una columna más angosta que la común (un día sin pedido no se encoge)", () => {
  for (const width of [320, 375, 390, 430, 600]) {
    const result = mobileWeekColumns({ areaWidthPx: width, timeColumnPx: tc, needPx: [10, 10, 10, 10, 10, 10, 10] });
    assert.ok(result.trackPx.every((px) => px >= dayColumnWidthPx(width, 7, tc, 0) + 1 - 1e-9));
  }
});