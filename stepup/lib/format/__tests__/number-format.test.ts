import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount, formatDecimal, formatGrade, formatHours, formatMinutes, formatMinutesAsHours, formatMoney, formatPercent } from "../number-format.ts";

// Intl usa un espacio fino sin separación entre «$» y la cifra: se normaliza sólo para comparar.
const plain = (text: string) => text.replace(/ /g, " ");

test("importes: sin decimales si son enteros, dos decimales sólo con centavos, separador de miles con punto", () => {
  assert.equal(plain(formatMoney(15000)), "$ 15.000");
  assert.equal(plain(formatMoney(0)), "$ 0");
  assert.equal(plain(formatMoney(1234567)), "$ 1.234.567");
  assert.equal(plain(formatMoney(1234.5)), "$ 1.234,50");
  assert.equal(plain(formatMoney(99.99)), "$ 99,99");
  assert.equal(plain(formatMoney(-2500)), "-$ 2.500");
});

test("importes: ausente o inválido → texto de reemplazo, nunca «$ NaN»", () => {
  for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatMoney(bad), "—");
  assert.equal(formatMoney(null, "Sin importe"), "Sin importe");
  assert.doesNotMatch(plain(formatMoney(Number.NaN)), /NaN|Infinity/);
});

test("porcentajes: entero sin decimales, con decimales con coma, signo opcional", () => {
  assert.equal(formatPercent(80), "80%");
  assert.equal(formatPercent(83.3), "83,3%");
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(5, { signed: true }), "+5%");
  assert.equal(formatPercent(-5, { signed: true }), "-5%");
  assert.equal(formatPercent(0, { signed: true }), "0%");
  assert.equal(formatPercent(null), "—");
  assert.equal(formatPercent(Number.NaN, { fallback: "Sin datos" }), "Sin datos");
});

test("horas: coma decimal, sin ceros de relleno, desde minutos también", () => {
  assert.equal(formatHours(3), "3 h");
  assert.equal(formatHours(2.5), "2,5 h");
  assert.equal(formatHours(0.9), "0,9 h");
  assert.equal(formatHours(0), "0 h");
  assert.equal(formatHours(null), "—");
  assert.equal(formatMinutesAsHours(150), "2,5 h");
  assert.equal(formatMinutesAsHours(60), "1 h");
  assert.equal(formatMinutesAsHours(null), "—");
  assert.equal(formatDecimal(2.5), "2,5");
  assert.equal(formatDecimal(3), "3");
});

test("duraciones, notas y cantidades", () => {
  assert.equal(formatMinutes(60), "60 min");
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatGrade(8), "8,0");
  assert.equal(formatGrade(9.5), "9,5");
  assert.equal(formatGrade(null), "—");
  assert.equal(formatGrade(undefined, "Sin calificar"), "Sin calificar");
  assert.equal(formatCount(1250), "1.250");
  assert.equal(formatCount(Number.NaN), "—");
});

test("determinista: el mismo texto sin depender del locale ni de la zona del proceso", () => {
  const a = formatMoney(1234.5) + formatPercent(12.5) + formatHours(2.5) + formatGrade(7);
  const b = formatMoney(1234.5) + formatPercent(12.5) + formatHours(2.5) + formatGrade(7);
  assert.equal(a, b);
  assert.equal(plain(a), "$ 1.234,5012,5%2,5 h7,0");
});
