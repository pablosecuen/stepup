import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFutureConflicts, findFutureRecurrenceConflicts } from "../future-conflicts.ts";
import { buildExcludedOccurrenceKeys } from "../split.ts";
import { generateOccurrences } from "../recurrence-engine.ts";
import type { ConflictCandidateLesson } from "../../calendar-conflicts.ts";
import type { TeacherAvailability } from "../availability.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

const BA = "America/Argentina/Buenos_Aires";
const NO_AVAILABILITY_LIMITS: TeacherAvailability = { schemaVersion: 1, timezone: BA, weeklyBlocks: [], exceptions: [] };
const FRIDAY_19: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 4, hour: 19, minute: 0, durationMinutes: 60 }] }];

function successorRule(weeks: RecurrenceWeek[], startDate = "2026-10-19"): RecurrenceRuleForEngine {
  return { recurrenceId: "nuevo", studentId: "a", participantIds: ["a"], cycleLengthWeeks: 1, weeks, modality: "online", timezone: BA, startDate, endDate: null, status: "active", classTitle: null, activityKind: "class" };
}

/** Las clases de otra serie que caen todos los viernes a las 19:00 de Buenos Aires (22:00 UTC). */
function otherSeriesFridays19(fromFriday: string, count: number, label: string): ConflictCandidateLesson[] {
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(`${fromFriday}T22:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() + index * 7);
    return { id: `otra-${index}`, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), status: "scheduled" as const, isRecurring: true, lessonType: "individual" as const, overlapAllowed: false, label };
  });
}

test("mover una serie a una hora ya ocupada por otra: se informan los choques (sin guardar nada) con el nombre de la otra clase", () => {
  // Caso real: una alumna pasa a las 19:00 del viernes y otra serie ya está los viernes a las 19:00.
  const conflicts = findFutureRecurrenceConflicts({
    successor: successorRule(FRIDAY_19),
    effectiveDate: "2026-10-23",
    todayDate: "2026-10-22",
    candidates: otherSeriesFridays19("2026-10-23", 12, "Alumna B"),
    availability: NO_AVAILABILITY_LIMITS,
  });
  assert.ok(conflicts.length >= 8, "el horizonte son 60 días desde la fecha efectiva: ocho viernes como mínimo");
  assert.ok(conflicts.every((conflict) => conflict.kind === "occupied" && conflict.with === "Alumna B"));
  assert.equal(conflicts[0].start, "2026-10-23T22:00:00.000Z");
  const text = describeFutureConflicts(conflicts, BA);
  assert.match(text, /viernes, 23 de octubre 19:00: se superpone con Alumna B/);
  assert.match(text, /Todavía no se guardó nada/);
  assert.match(text, /y \d+ más/, "muestra sólo las primeras 5");
});

test("misma hora pero pegada (una termina cuando la otra empieza) y series canceladas no son conflicto", () => {
  const backToBack = otherSeriesFridays19("2026-10-23", 3, "Otra").map((lesson) => ({ ...lesson, start: new Date(new Date(lesson.start).getTime() - 3_600_000).toISOString(), end: lesson.start }));
  const cancelled = otherSeriesFridays19("2026-10-23", 3, "Cancelada").map((lesson) => ({ ...lesson, status: "cancelled" as const }));
  const conflicts = findFutureRecurrenceConflicts({ successor: successorRule(FRIDAY_19), effectiveDate: "2026-10-23", todayDate: "2026-10-22", candidates: [...backToBack, ...cancelled], availability: NO_AVAILABILITY_LIMITS });
  assert.deepEqual(conflicts, []);
});

test("sólo cuentan las clases desde la fecha efectiva: antes de ella la serie nueva no existe", () => {
  // Las otras clases son de los viernes del 9 al 16 de octubre; el cambio rige desde el 23.
  const conflicts = findFutureRecurrenceConflicts({ successor: successorRule(FRIDAY_19), effectiveDate: "2026-10-23", todayDate: "2026-10-22", candidates: otherSeriesFridays19("2026-10-09", 2, "Pasada"), availability: NO_AVAILABILITY_LIMITS });
  assert.deepEqual(conflicts, []);
});

test("una fecha efectiva lejana (noviembre) igual se valida 60 días hacia adelante, no 60 desde hoy", () => {
  const conflicts = findFutureRecurrenceConflicts({ successor: successorRule(FRIDAY_19, "2026-11-23"), effectiveDate: "2026-11-23", todayDate: "2026-10-22", candidates: otherSeriesFridays19("2026-11-27", 3, "Alumna B"), availability: NO_AVAILABILITY_LIMITS });
  assert.equal(conflicts.length, 3);
  assert.equal(conflicts[0].start, "2026-11-27T22:00:00.000Z");
});

test("un horario bloqueado en la disponibilidad se informa con su motivo", () => {
  const availability: TeacherAvailability = { ...NO_AVAILABILITY_LIMITS, weeklyBlocks: [{ id: "b", weekday: 4, startTime: "18:30", endTime: "20:00", reason: "work" }] };
  const conflicts = findFutureRecurrenceConflicts({ successor: successorRule(FRIDAY_19), effectiveDate: "2026-10-23", todayDate: "2026-10-22", candidates: [], availability });
  assert.ok(conflicts.length > 0 && conflicts.every((conflict) => conflict.kind === "unavailable"));
  assert.match(describeFutureConflicts(conflicts, BA), /bloqueado en tu disponibilidad/);
});

test("sin choques ni bloqueos: lista vacía (se puede guardar)", () => {
  const free = findFutureRecurrenceConflicts({ successor: successorRule(FRIDAY_19), effectiveDate: "2026-10-23", todayDate: "2026-10-22", candidates: [], availability: NO_AVAILABILITY_LIMITS });
  assert.deepEqual(free, []);
});

test("buildExcludedOccurrenceKeys: la clase de las 21:00–23:59 del día ANTERIOR a la fecha efectiva se excluye (medianoche local, no UTC)", () => {
  // Cambio desde el sábado 2026-10-24 con clases los viernes a las 21:30 (00:30 UTC del sábado): esa del viernes 23 es anterior a la fecha efectiva.
  const weeks: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 4, hour: 21, minute: 30, durationMinutes: 60 }, { weekday: 5, hour: 10, minute: 0, durationMinutes: 60 }] }];
  const keys = buildExcludedOccurrenceKeys({
    successorRecurrenceId: "suc",
    successorStartDate: "2026-10-19",
    effectiveDate: "2026-10-24",
    cycleLengthWeeks: 1,
    weeks,
    modality: "online",
    timezone: BA,
    classTitle: null,
    activityKind: "class",
  });
  assert.deepEqual(keys, ["suc:w0:c0:d4:t2130:s0"], "el viernes 21:30 queda excluido; el sábado 10:00 (el día efectivo) rige");
  const kept = generateOccurrences(successorRule(weeks, "2026-10-19"), new Date("2026-10-24T03:00:00.000Z"), new Date("2026-10-25T02:59:00.000Z"));
  assert.equal(kept.length, 1);
});
