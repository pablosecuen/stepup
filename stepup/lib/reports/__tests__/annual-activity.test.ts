import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnualActivitySummary, buildModalitySummary, type RegistrationForAnnualActivity } from "../annual-activity.ts";

const RANGE = { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" };

function reg(overrides: Partial<RegistrationForAnnualActivity> = {}): RegistrationForAnnualActivity {
  return {
    countsAsClass: true,
    scheduledStartAt: "2026-09-10T13:00:00.000Z",
    scheduledEndAt: "2026-09-10T14:00:00.000Z",
    actualStartedAt: "2026-09-10T13:00:00.000Z",
    actualEndedAt: "2026-09-10T14:00:00.000Z",
    outcome: "clase_dictada",
    modality: "online",
    calendarLessonId: "cl1",
    id: "r1",
    ...overrides,
  };
}

test("buildAnnualActivitySummary: una clase GRUPAL cuenta una sola vez (el input ya es un registro por clase, no por alumno)", () => {
  // Dos registros DISTINTOS de la MISMA clase grupal nunca deberían pasarse acá — el repositorio arma
  // un registro por clase dictada, no uno por participante — así que un solo registro ya representa
  // correctamente el total, aunque haya tenido 5 alumnos.
  const summary = buildAnnualActivitySummary([reg()], RANGE);
  assert.equal(summary.heldClassesCount, 1);
  assert.equal(summary.heldMinutes, 60);
});

test("buildAnnualActivitySummary: clase CANCELADA nunca cuenta como dictada", () => {
  const summary = buildAnnualActivitySummary([reg({ countsAsClass: false, outcome: "cancelada_con_aviso" })], RANGE);
  assert.equal(summary.heldClassesCount, 0);
  assert.equal(summary.cancelledCountByReason.conAviso, 1);
});

test("buildAnnualActivitySummary: clase REPROGRAMADA nunca cuenta ni como dictada ni como cancelada — categoría propia", () => {
  const summary = buildAnnualActivitySummary([reg({ countsAsClass: false, outcome: "reprogramada" })], RANGE);
  assert.equal(summary.heldClassesCount, 0);
  assert.equal(summary.cancelledCountByReason.conAviso, 0);
  assert.equal(summary.cancelledCountByReason.tardia, 0);
  assert.equal(summary.cancelledCountByReason.profesoraAusente, 0);
  assert.equal(summary.cancelledCountByReason.feriado, 0);
  assert.equal(summary.rescheduledReservationsCount, 1);
});

test("buildAnnualActivitySummary: horas reprogramadas se cuentan UNA vez por reserva (calendarLessonId), aunque haya varios eventos de reprogramación", () => {
  const summary = buildAnnualActivitySummary(
    [
      reg({ id: "r1", countsAsClass: false, outcome: "reprogramada", calendarLessonId: "cl1" }),
      reg({ id: "r2", countsAsClass: false, outcome: "reprogramada", calendarLessonId: "cl1" }), // misma reserva, reprogramada otra vez
    ],
    RANGE
  );
  assert.equal(summary.rescheduledReservationsCount, 1, "misma reserva, nunca se duplica en minutos/reservas");
  assert.equal(summary.rescheduledChangeCount, 2, "pero cada EVENTO de reprogramación sí se cuenta por separado");
});

test("buildAnnualActivitySummary: categoriza correctamente las 4 razones de cancelación reales", () => {
  const summary = buildAnnualActivitySummary(
    [
      reg({ id: "r1", countsAsClass: false, outcome: "cancelada_con_aviso" }),
      reg({ id: "r2", countsAsClass: false, outcome: "cancelada_tarde" }),
      reg({ id: "r3", countsAsClass: false, outcome: "profesora_ausente" }),
      reg({ id: "r4", countsAsClass: false, outcome: "feriado" }),
    ],
    RANGE
  );
  assert.equal(summary.cancelledCountByReason.conAviso, 1);
  assert.equal(summary.cancelledCountByReason.tardia, 1);
  assert.equal(summary.cancelledCountByReason.profesoraAusente, 1);
  assert.equal(summary.cancelledCountByReason.feriado, 1);
});

test("buildAnnualActivitySummary: fuera del rango nunca cuenta", () => {
  const summary = buildAnnualActivitySummary([reg({ scheduledStartAt: "2026-08-10T13:00:00.000Z", actualStartedAt: "2026-08-10T13:00:00.000Z" })], RANGE);
  assert.equal(summary.heldClassesCount, 0);
});

test("buildModalitySummary: distribuye por horas realmente dictadas, sólo countsAsClass", () => {
  const summary = buildModalitySummary(
    [reg({ modality: "presencial" }), reg({ id: "r2", modality: "online" }), reg({ id: "r3", modality: "presencial", countsAsClass: false })],
    RANGE
  );
  assert.equal(summary.presencial, 60); // sólo la primera (la r3 no cuenta, countsAsClass=false)
  assert.equal(summary.online, 60);
});
