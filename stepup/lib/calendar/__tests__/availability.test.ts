import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAvailability, type TeacherAvailability } from "../availability.ts";

const BA = "America/Argentina/Buenos_Aires";

function baseAvailability(overrides: Partial<TeacherAvailability> = {}): TeacherAvailability {
  return { schemaVersion: 1, timezone: BA, weeklyBlocks: [], exceptions: [], ...overrides };
}

test("evaluateAvailability: sin bloqueos ni excepciones, todo está disponible", () => {
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", baseAvailability());
  assert.equal(result.isAvailable, true);
  assert.equal(result.conflict, null);
});

test("evaluateAvailability: un bloqueo semanal que se superpone bloquea la clase", () => {
  // Lunes 14/09/2026, 18:00-19:00 Bs. As. (weekday 0 = lunes).
  const availability = baseAvailability({
    weeklyBlocks: [{ id: "b1", weekday: 0, startTime: "17:00", endTime: "20:00", reason: "work" }],
  });
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", availability);
  assert.equal(result.isAvailable, false);
  assert.equal(result.conflict?.kind, "weekly_block");
});

test("evaluateAvailability: un bloqueo semanal de OTRO día nunca bloquea", () => {
  const availability = baseAvailability({
    weeklyBlocks: [{ id: "b1", weekday: 2, startTime: "17:00", endTime: "20:00", reason: "work" }], // miércoles
  });
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", availability); // lunes
  assert.equal(result.isAvailable, true);
});

test("evaluateAvailability: una excepción de vacaciones (rango de fechas) bloquea todos los días que cubre", () => {
  const availability = baseAvailability({
    exceptions: [{ id: "e1", date: "2026-09-10", endDate: "2026-09-20", type: "unavailable_full_day", reason: "vacation" }],
  });
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", availability);
  assert.equal(result.isAvailable, false);
  assert.equal(result.conflict?.kind, "exception");
  assert.equal(result.label, "Vacaciones");
});

test("evaluateAvailability: excepción tiene prioridad sobre un bloqueo semanal que también aplicaría", () => {
  const availability = baseAvailability({
    weeklyBlocks: [{ id: "b1", weekday: 0, startTime: "17:00", endTime: "20:00", reason: "work" }],
    exceptions: [{ id: "e1", date: "2026-09-14", type: "unavailable_full_day", reason: "holiday" }],
  });
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", availability);
  assert.equal(result.conflict?.kind, "exception");
});

test("evaluateAvailability: 'available_extra' que cubre TODO el pedido gana sobre un bloqueo semanal", () => {
  const availability = baseAvailability({
    weeklyBlocks: [{ id: "b1", weekday: 0, startTime: "00:00", endTime: "23:59", reason: "work" }],
    exceptions: [{ id: "e1", date: "2026-09-14", type: "available_extra", startTime: "17:00", endTime: "20:00", reason: "other" }],
  });
  const result = evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T22:00:00.000Z", availability); // 18:00-19:00 Bs. As.
  assert.equal(result.isAvailable, true);
  assert.equal(result.label, "Disponibilidad extra");
});

test("evaluateAvailability: 'available_extra' que cubre sólo PARCIALMENTE el pedido no cuenta", () => {
  const availability = baseAvailability({
    weeklyBlocks: [{ id: "b1", weekday: 0, startTime: "17:00", endTime: "20:00", reason: "work" }],
    exceptions: [{ id: "e1", date: "2026-09-14", type: "available_extra", startTime: "17:30", endTime: "18:15", reason: "other" }],
  });
  const result = evaluateAvailability("2026-09-14T20:00:00.000Z", "2026-09-14T21:00:00.000Z", availability); // 17:00-18:00 Bs. As.
  assert.equal(result.isAvailable, false, "la extra sólo cubre 17:30-18:15, no el pedido completo 17:00-18:00");
});

test("evaluateAvailability: rango inválido (fin <= inicio) lanza", () => {
  assert.throws(() => evaluateAvailability("2026-09-14T21:00:00.000Z", "2026-09-14T21:00:00.000Z", baseAvailability()));
});
