import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarDemandSummary, demandRangeFor, type OccurrenceForDemand } from "../demand.ts";

// 2026-10-16 es viernes. 13:00Z = 10:00 en Argentina.
const NOW = "2026-10-21T01:53:00.000Z";
const RANGE = { rangeStart: "2026-07-23", rangeEnd: "2026-10-20" };

function lesson(startIso: string, minutes = 60, status = "completed", participantCount = 1): OccurrenceForDemand {
  return { start: startIso, end: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(), status, participantCount };
}
const summarize = (occurrences: OccurrenceForDemand[], over: Partial<{ rangeStart: string; rangeEnd: string }> = {}) => buildCalendarDemandSummary({ occurrences, ...RANGE, ...over, evaluationInstant: NOW });

test("el rango son los últimos 90 días con hoy incluido (23/07 a 20/10)", () => {
  assert.deepEqual(demandRangeFor("2026-10-20"), RANGE);
});

test("sólo cuentan clases dictadas y confirmadas a futuro: canceladas, reprogramadas y otros estados quedan afuera", () => {
  const result = summarize([lesson("2026-10-16T13:00:00.000Z"), lesson("2026-10-16T14:00:00.000Z", 60, "scheduled"), lesson("2026-10-16T15:00:00.000Z", 60, "cancelled"), lesson("2026-10-16T16:00:00.000Z", 60, "rescheduled")]);
  assert.equal(result.byWeekday[4].lessonCount, 2);
  assert.equal(result.byWeekday[4].occupiedHours, 2);
});

test("mide HORAS ocupadas: una clase de 90 minutos pesa más que una de 60, y el día se cuenta con lunes = 0", () => {
  const result = summarize([lesson("2026-10-16T13:00:00.000Z", 90), lesson("2026-10-15T13:00:00.000Z", 60), lesson("2026-10-14T13:00:00.000Z", 60)]);
  assert.deepEqual(result.topWeekdays.map((entry) => [entry.weekday, entry.occupiedHours, entry.lessonCount]), [[4, 1.5, 1]]);
  assert.equal(Math.round(result.byWeekday[4].percentOfWeeklyDemand), 43);
});

test("una clase reparte su duración entre los intervalos de 30 minutos que toca (18:15 a 19:15 → 18:00, 18:30 y 19:00)", () => {
  // 18:15 en Argentina = 21:15Z.
  const result = summarize([lesson("2026-10-16T21:15:00.000Z", 60)]);
  assert.deepEqual(
    result.bySlot.map((slot) => [slot.hour, slot.minute, slot.occupiedHours, slot.lessonCount]),
    [
      [18, 0, 0.25, 1],
      [18, 30, 0.5, 1],
      [19, 0, 0.25, 1],
    ]
  );
});

test("el día se cuenta por la fecha civil de Argentina: una clase del viernes 22:30 no pasa al sábado", () => {
  // viernes 16/10 22:30 ART = sábado 17/10 01:30Z.
  const result = summarize([lesson("2026-10-17T01:30:00.000Z", 60)]);
  assert.equal(result.byWeekday[4].lessonCount, 1);
  assert.equal(result.byWeekday[5].lessonCount, 0);
});

test("el rango incluye TODO el último día (aunque la clase sea más tarde que «ahora») y excluye lo anterior al primer día", () => {
  const result = summarize([lesson("2026-10-21T02:30:00.000Z"), lesson("2026-07-23T13:00:00.000Z"), lesson("2026-07-22T13:00:00.000Z")]);
  assert.equal(result.byWeekday.reduce((sum, entry) => sum + entry.lessonCount, 0), 2);
});

test("una clase «sin alumnos» que ya pasó no cuenta; una futura sí (sigue ocupando el horario)", () => {
  const past = lesson("2026-10-15T13:00:00.000Z", 60, "scheduled", 0);
  const future = lesson("2026-10-23T13:00:00.000Z", 60, "scheduled", 0);
  const result = summarize([past, future], { rangeEnd: "2026-10-31" });
  assert.equal(result.byWeekday.reduce((sum, entry) => sum + entry.lessonCount, 0), 1);
});

test("horarios más demandados: los tres primeros y todos los que empatan con el tercero; sin datos -> vacío", () => {
  const same = ["2026-10-12", "2026-10-13", "2026-10-14"];
  const result = summarize([...same.map((day) => lesson(`${day}T21:00:00.000Z`, 30)), ...same.map((day) => lesson(`${day}T22:00:00.000Z`, 30)), ...same.map((day) => lesson(`${day}T23:00:00.000Z`, 30)), ...same.map((day) => lesson(`${day}T13:00:00.000Z`, 30))]);
  assert.equal(result.topSlots.length, 4);
  assert.equal(summarize([]).topWeekdays.length, 0);
  assert.equal(summarize([]).topSlots.length, 0);
});
