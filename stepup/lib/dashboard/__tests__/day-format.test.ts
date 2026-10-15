import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatStartsIn } from "../day-format.ts";

test("formatDuration: minutos, horas exactas y horas con minutos, sin ceros sobrantes", () => {
  assert.equal(formatDuration(1), "1 min");
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(59), "59 min");
  assert.equal(formatDuration(60), "1 h");
  assert.equal(formatDuration(61), "1 h 1 min");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(150), "2 h 30 min");
});

test("formatDuration: lo que no es una cantidad positiva dice «menos de 1 min», nunca NaN ni negativos", () => {
  for (const value of [0, 0.4, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatDuration(value), "menos de 1 min", String(value));
});

test("formatStartsIn: arma «Empieza en …» con la diferencia entre el inicio y el reloj de la carga", () => {
  const now = Date.UTC(2026, 9, 15, 12, 0, 0);
  assert.equal(formatStartsIn(now + 45 * 60_000, now), "Empieza en 45 min");
  assert.equal(formatStartsIn(now + 150 * 60_000, now), "Empieza en 2 h 30 min");
  assert.equal(formatStartsIn(now, now), "Empieza en menos de 1 min");
  assert.equal(formatStartsIn(now - 60_000, now), "Empieza en menos de 1 min");
});
