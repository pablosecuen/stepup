import { test } from "node:test";
import assert from "node:assert/strict";
import { isClaimStaleForRequest } from "../draft-claim.ts";

test("sin claim previo (nunca hubo generación) -> nunca es obsoleto, se usa tal cual", () => {
  assert.equal(isClaimStaleForRequest(null, ["2026-05"]), false);
});

test("claim EN CURSO (todavía sin PDF) con meses distintos -> nunca se rota un claim en curso", () => {
  const existing = { selectedMonths: ["2026-04"], pdfPath: null };
  assert.equal(isClaimStaleForRequest(existing, ["2026-05"]), false);
});

test("claim COMPLETO con los MISMOS meses (reintento tras respuesta perdida) -> nunca es obsoleto", () => {
  const existing = { selectedMonths: ["2026-05", "2026-06"], pdfPath: "owner/student/report.pdf" };
  assert.equal(isClaimStaleForRequest(existing, ["2026-06", "2026-05"]), false);
});

test("claim COMPLETO con meses DISTINTOS -> obsoleto, debe rotarse", () => {
  const existing = { selectedMonths: ["2026-04"], pdfPath: "owner/student/report.pdf" };
  assert.equal(isClaimStaleForRequest(existing, ["2026-05"]), true);
});

test("claim COMPLETO con un subconjunto real de meses distinto -> obsoleto", () => {
  const existing = { selectedMonths: ["2026-04", "2026-05"], pdfPath: "owner/student/report.pdf" };
  assert.equal(isClaimStaleForRequest(existing, ["2026-04"]), true);
});
