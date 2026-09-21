import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAverageGrade, normalizeSkillGradeValue, normalizeGeneralGrade } from "../grades.ts";

test("calculateAverageGrade: 0 nunca es nota real, se excluye del promedio", () => {
  assert.equal(calculateAverageGrade([0, 8]), 8, "el 0 (slider nunca tocado) se descarta, no promedia con el 8");
});

test("calculateAverageGrade: null/undefined se excluyen, nunca cuentan como 0", () => {
  assert.equal(calculateAverageGrade([null, undefined, 9]), 9);
});

test("calculateAverageGrade: sin ninguna nota válida devuelve null, nunca 0", () => {
  assert.equal(calculateAverageGrade([0, null, undefined]), null);
  assert.equal(calculateAverageGrade([]), null);
});

test("calculateAverageGrade: redondea a 1 decimal", () => {
  assert.equal(calculateAverageGrade([7, 8, 9]), 8);
  assert.equal(calculateAverageGrade([7, 8]), 7.5);
  assert.equal(calculateAverageGrade([7, 7, 8]), 7.3);
});

test("normalizeSkillGradeValue: 0 se normaliza a null, nunca se persiste como nota real", () => {
  assert.equal(normalizeSkillGradeValue(0), null);
});

test("normalizeSkillGradeValue: fuera de rango (1-10) o no entero se normaliza a null", () => {
  assert.equal(normalizeSkillGradeValue(11), null);
  assert.equal(normalizeSkillGradeValue(-1), null);
  assert.equal(normalizeSkillGradeValue(5.5), null);
  assert.equal(normalizeSkillGradeValue(null), null);
  assert.equal(normalizeSkillGradeValue(undefined), null);
});

test("normalizeSkillGradeValue: valor válido se conserva tal cual", () => {
  assert.equal(normalizeSkillGradeValue(7), 7);
  assert.equal(normalizeSkillGradeValue(1), 1);
  assert.equal(normalizeSkillGradeValue(10), 10);
});

test("normalizeGeneralGrade: 0 y fuera de rango se normalizan a null", () => {
  assert.equal(normalizeGeneralGrade(0), null);
  assert.equal(normalizeGeneralGrade(11), null);
  assert.equal(normalizeGeneralGrade(0.5), null);
});

test("normalizeGeneralGrade: valor válido con decimales se redondea a 1 decimal", () => {
  assert.equal(normalizeGeneralGrade(7.86), 7.9);
  assert.equal(normalizeGeneralGrade(10), 10);
});
