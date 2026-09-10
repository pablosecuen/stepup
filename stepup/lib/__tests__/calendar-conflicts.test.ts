import { test } from "node:test";
import assert from "node:assert/strict";
import { rangesOverlap, findSchedulingConflict } from "../calendar-conflicts.ts";

function at(hour: number, minute: number): Date {
  return new Date(2026, 8, 10, hour, minute, 0, 0);
}

test("rangesOverlap: se solapan cuando comparten minutos reales", () => {
  const a = { start: at(10, 0), end: at(11, 0) };
  const b = { start: at(10, 30), end: at(11, 30) };
  assert.equal(rangesOverlap(a, b), true);
});

test("rangesOverlap: back-to-back exacto NO es solapamiento", () => {
  const a = { start: at(10, 0), end: at(11, 0) };
  const b = { start: at(11, 0), end: at(11, 45) };
  assert.equal(rangesOverlap(a, b), false);
  assert.equal(rangesOverlap(b, a), false);
});

test("rangesOverlap: rangos separados por un hueco no se solapan", () => {
  const a = { start: at(9, 0), end: at(10, 0) };
  const b = { start: at(12, 0), end: at(13, 0) };
  assert.equal(rangesOverlap(a, b), false);
});

test("rangesOverlap: una clase totalmente contenida en otra sí solapa", () => {
  const a = { start: at(9, 0), end: at(12, 0) };
  const b = { start: at(10, 0), end: at(10, 30) };
  assert.equal(rangesOverlap(a, b), true);
});

test("findSchedulingConflict: devuelve el id de la clase existente que se cruza", () => {
  const existing = [
    { id: "l1", start: at(9, 0), end: at(10, 0) },
    { id: "l2", start: at(10, 0), end: at(11, 0) },
  ];
  const candidate = { start: at(10, 30), end: at(11, 30) };
  assert.equal(findSchedulingConflict(candidate, existing), "l2");
});

test("findSchedulingConflict: null cuando el candidato encaja en un hueco libre", () => {
  const existing = [
    { id: "l1", start: at(9, 0), end: at(10, 0) },
    { id: "l2", start: at(11, 0), end: at(12, 0) },
  ];
  const candidate = { start: at(10, 0), end: at(11, 0) };
  assert.equal(findSchedulingConflict(candidate, existing), null);
});

test("findSchedulingConflict: lista vacía nunca da conflicto", () => {
  const candidate = { start: at(10, 0), end: at(11, 0) };
  assert.equal(findSchedulingConflict(candidate, []), null);
});
