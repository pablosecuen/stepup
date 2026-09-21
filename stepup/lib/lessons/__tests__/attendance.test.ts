import { test } from "node:test";
import assert from "node:assert/strict";
import { hasResolvedAttendanceStatus } from "../attendance.ts";

test("hasResolvedAttendanceStatus: los 4 estados reales cuentan como resueltos", () => {
  assert.equal(hasResolvedAttendanceStatus("presente"), true);
  assert.equal(hasResolvedAttendanceStatus("ausente"), true);
  assert.equal(hasResolvedAttendanceStatus("tarde"), true);
  assert.equal(hasResolvedAttendanceStatus("ausente_aviso"), true);
});

test("hasResolvedAttendanceStatus: 'sin_registrar' (legado) y ausencia nunca cuentan como resueltos", () => {
  assert.equal(hasResolvedAttendanceStatus("sin_registrar"), false);
  assert.equal(hasResolvedAttendanceStatus(null), false);
  assert.equal(hasResolvedAttendanceStatus(undefined), false);
});
