import { test } from "node:test";
import assert from "node:assert/strict";
import { toConflictCandidates } from "../conflict-candidates.ts";
import { findCalendarConflicts, hasBlockingConflict } from "../../calendar-conflicts.ts";

type Item = Parameters<typeof toConflictCandidates>[0][number];

function item(overrides: Partial<Item> & Pick<Item, "id">): Item {
  return {
    start: "2026-12-03T12:00:00.000Z",
    end: "2026-12-03T12:45:00.000Z",
    status: "scheduled",
    isRecurring: true,
    lessonType: "group",
    recurrenceId: null,
    ...overrides,
  };
}

const NEW_SERIES = "rule-new";
const ownOccurrence = item({ id: "virtual:rule-new:2026-12-03", recurrenceId: NEW_SERIES });
const [start, end] = [ownOccurrence.start, ownOccurrence.end];

test("falso conflicto: sin excluir, la serie recién creada choca consigo misma (el bug real)", () => {
  const candidates = toConflictCandidates([ownOccurrence]);
  assert.equal(hasBlockingConflict(findCalendarConflicts(start, end, candidates)), true);
});

test("con excludeRecurrenceId la propia serie ya no choca consigo misma", () => {
  const candidates = toConflictCandidates([ownOccurrence], { excludeRecurrenceId: NEW_SERIES });
  assert.equal(candidates.length, 0);
  assert.equal(hasBlockingConflict(findCalendarConflicts(start, end, candidates)), false);
});

test("un conflicto REAL con OTRA serie en el mismo horario se sigue detectando", () => {
  const other = item({ id: "virtual:rule-other:2026-12-03", recurrenceId: "rule-other" });
  const candidates = toConflictCandidates([ownOccurrence, other], { excludeRecurrenceId: NEW_SERIES });
  assert.deepEqual(candidates.map((c) => c.id), [other.id]);
  assert.equal(hasBlockingConflict(findCalendarConflicts(start, end, candidates)), true);
});

test("un conflicto REAL con una clase suelta (sin serie) en ese horario se sigue detectando", () => {
  const single = item({ id: "lesson-1", recurrenceId: null, isRecurring: false, lessonType: "individual" });
  const candidates = toConflictCandidates([ownOccurrence, single], { excludeRecurrenceId: NEW_SERIES });
  assert.equal(hasBlockingConflict(findCalendarConflicts(start, end, candidates)), true);
});

test("una ocurrencia ya materializada de la PROPIA serie también se excluye (mismo recurrenceId)", () => {
  const materialized = item({ id: "lesson-materialized", recurrenceId: NEW_SERIES });
  assert.equal(toConflictCandidates([materialized], { excludeRecurrenceId: NEW_SERIES }).length, 0);
});

test("una clase cancelada de otra serie nunca bloquea (regla existente intacta)", () => {
  const cancelled = item({ id: "virtual:rule-other:2026-12-03", recurrenceId: "rule-other", status: "cancelled" });
  const candidates = toConflictCandidates([cancelled], { excludeRecurrenceId: NEW_SERIES });
  assert.equal(hasBlockingConflict(findCalendarConflicts(start, end, candidates)), false);
});

test("la clase única (sin excludeRecurrenceId) conserva el comportamiento: todo es candidato", () => {
  const other = item({ id: "virtual:rule-other:2026-12-03", recurrenceId: "rule-other" });
  assert.equal(toConflictCandidates([ownOccurrence, other]).length, 2);
});

test("el mapeo conserva los campos que usa el detector y nunca permite solapamiento", () => {
  const [candidate] = toConflictCandidates([item({ id: "x", recurrenceId: "r", lessonType: "individual", isRecurring: false })]);
  assert.deepEqual(candidate, {
    id: "x",
    start: "2026-12-03T12:00:00.000Z",
    end: "2026-12-03T12:45:00.000Z",
    status: "scheduled",
    isRecurring: false,
    lessonType: "individual",
    overlapAllowed: false,
  });
});
