import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnnualActivitySummary, buildModalitySummary } from "../annual-activity.ts";
import type { RegisteredLessonFacts } from "../registered-lessons.ts";

const YEAR = { rangeStart: "2026-01-01", rangeEnd: "2026-12-31" };

function fact(overrides: Partial<RegisteredLessonFacts> & { id: string }): RegisteredLessonFacts {
  return {
    calendarLessonId: null,
    occurrenceKey: null,
    eventType: "clase_dictada",
    holidayException: false,
    isBillable: true,
    dateKey: "2026-05-05",
    scheduledDurationMinutes: 60,
    actualDurationMinutes: null,
    modality: "online",
    studentIds: [],
    billedAmount: null,
    billedAmountByStudent: null,
    ...overrides,
  };
}

test("horas dictadas: duración real si existe, si no la programada; sólo cuenta el RESULTADO «clase dictada» (o feriado con excepción)", () => {
  const result = buildAnnualActivitySummary(
    [fact({ id: "a" }), fact({ id: "b", scheduledDurationMinutes: 60, actualDurationMinutes: 90 }), fact({ id: "c", eventType: "feriado", holidayException: true }), fact({ id: "d", eventType: "feriado" })],
    YEAR
  );
  assert.equal(result.heldLessonCount, 3);
  assert.equal(result.heldHours, 3.5);
});

test("«alumno ausente» NO es una clase dictada: va a canceladas (con su categoría) aunque la web lo guarde como dictada con asistencia «ausente»", () => {
  const result = buildAnnualActivitySummary([fact({ id: "a" }), fact({ id: "b", eventType: "alumno_ausente" })], YEAR);
  assert.equal(result.heldLessonCount, 1);
  assert.equal(result.cancelledByCategory.alumno_ausente.count, 1);
  assert.equal(result.cancelledHours, 1);
});

test("canceladas: cada motivo con su cantidad y sus horas programadas; el feriado con excepción NO es cancelado", () => {
  const result = buildAnnualActivitySummary(
    [
      fact({ id: "1", eventType: "cancelada_con_aviso", scheduledDurationMinutes: 45 }),
      fact({ id: "2", eventType: "cancelada_tarde" }),
      fact({ id: "3", eventType: "profesora_ausente" }),
      fact({ id: "4", eventType: "feriado" }),
      fact({ id: "5", eventType: "feriado", holidayException: true }),
    ],
    YEAR
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.cancelledByCategory).map(([key, value]) => [key, value.count])),
    { con_aviso: 1, cancelacion_tardia: 1, profesora_ausente: 1, alumno_ausente: 0, feriado: 1 }
  );
  assert.equal(result.cancelledHours, 3.75);
  assert.equal(result.heldLessonCount, 1);
});

test("reprogramadas: las horas cuentan una vez por reserva aunque se haya movido varias veces; la cantidad de cambios cuenta cada evento", () => {
  const result = buildAnnualActivitySummary(
    [fact({ id: "1", eventType: "reprogramada", calendarLessonId: "L1" }), fact({ id: "2", eventType: "reprogramada", calendarLessonId: "L1" }), fact({ id: "3", eventType: "reprogramada", calendarLessonId: "L2", scheduledDurationMinutes: 30 })],
    YEAR
  );
  assert.equal(result.rescheduledHours, 1.5);
  assert.equal(result.rescheduledChangeCount, 3);
  assert.equal(result.heldLessonCount, 0);
});

test("el rango se aplica a la fecha civil de la clase", () => {
  const result = buildAnnualActivitySummary([fact({ id: "a", dateKey: "2025-12-31" }), fact({ id: "b", dateKey: "2026-12-31" }), fact({ id: "c", dateKey: "2026-01-01" })], YEAR);
  assert.equal(result.heldLessonCount, 2);
  assert.equal(buildAnnualActivitySummary([fact({ id: "d", dateKey: "2026-10-05" }), fact({ id: "e", dateKey: "2026-09-30" })], { rangeStart: "2026-10-01", rangeEnd: "2026-10-31" }).heldLessonCount, 1);
});

test("modalidad: horas, cantidad de clases y porcentaje por modalidad (sólo clases dictadas); empate -> todas las más usadas", () => {
  const result = buildModalitySummary(
    [fact({ id: "1", modality: "online" }), fact({ id: "2", modality: "online", actualDurationMinutes: 120 }), fact({ id: "3", modality: "presencial" }), fact({ id: "4", modality: "mixta", eventType: "cancelada_tarde" })],
    YEAR
  );
  const byModality = Object.fromEntries(result.breakdown.map((entry) => [entry.modality, [entry.hours, entry.lessonCount, Math.round(entry.percent)]]));
  assert.deepEqual(byModality, { online: [3, 2, 75], presencial: [1, 1, 25], mixta: [0, 0, 0] });
  assert.deepEqual(result.mostUsed, ["online"]);
  const tie = buildModalitySummary([fact({ id: "1", modality: "online" }), fact({ id: "2", modality: "presencial" })], YEAR);
  assert.deepEqual(tie.mostUsed, ["online", "presencial"]);
  assert.deepEqual(buildModalitySummary([], YEAR).mostUsed, []);
});
