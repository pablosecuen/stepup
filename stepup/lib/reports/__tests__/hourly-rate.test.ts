import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProgrammedHourlyRateSummary, type OccurrenceForHourlyRate } from "../hourly-rate.ts";

const RANGE = { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" };

function occ(overrides: Partial<OccurrenceForHourlyRate> = {}): OccurrenceForHourlyRate {
  return {
    scheduledStartAt: "2026-09-10T13:00:00.000Z",
    scheduledEndAt: "2026-09-10T14:00:00.000Z",
    isCancelled: false,
    isRegisteredHeld: true,
    billedAmount: 30000,
    ...overrides,
  };
}

test("buildProgrammedHourlyRateSummary: usa TODA la agenda del período (horas), no sólo lo registrado", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isRegisteredHeld: true }), occ({ isRegisteredHeld: false, billedAmount: null })], RANGE, "2026-10-01");
  assert.equal(summary.totalProgrammedMinutes, 120); // ambas ocurrencias, aunque una no esté registrada
});

test("buildProgrammedHourlyRateSummary: sólo suma ingreso de clases YA REGISTRADAS (nunca inventa un monto estimado)", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isRegisteredHeld: true, billedAmount: 30000 }), occ({ isRegisteredHeld: false, billedAmount: null })], RANGE, "2026-10-01");
  assert.equal(summary.totalRevenueAttributed, 30000);
});

test("buildProgrammedHourlyRateSummary: clase cancelada nunca entra ni al numerador ni al denominador", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isCancelled: true })], RANGE, "2026-10-01");
  assert.equal(summary.totalProgrammedMinutes, 0);
  assert.equal(summary.generalRatePerHour, null);
});

test("buildProgrammedHourlyRateSummary: sin ocurrencias -> generalRatePerHour null, nunca división por cero", () => {
  const summary = buildProgrammedHourlyRateSummary([], RANGE, "2026-10-01");
  assert.equal(summary.generalRatePerHour, null);
});

test("buildProgrammedHourlyRateSummary: hay ocurrencias sin registrar todavía -> isEstimate true", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isRegisteredHeld: false, billedAmount: null })], RANGE, "2026-10-01");
  assert.equal(summary.isEstimate, true);
});

test("buildProgrammedHourlyRateSummary: rango ya cerrado y todo registrado -> isEstimate false", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isRegisteredHeld: true })], RANGE, "2026-10-15");
  assert.equal(summary.isEstimate, false);
});

test("buildProgrammedHourlyRateSummary: calcula correctamente el valor por hora ($/60min)", () => {
  const summary = buildProgrammedHourlyRateSummary([occ({ isRegisteredHeld: true, billedAmount: 30000 })], RANGE, "2026-10-15");
  assert.equal(summary.generalRatePerHour, 30000);
});
