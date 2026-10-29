import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationIdentity } from "../registration-identity.ts";

test("a moved materialized class is registered by its existing id, even without an occurrence key", () => {
  assert.deepEqual(registrationIdentity({ materializedLessonId: "moved", recurrenceId: "series", occurrenceKey: null, recurrenceIndex: 4 }),
    { calendarLessonId: "moved", recurrenceId: null, occurrenceKey: null, recurrenceIndex: null });
});
test("a virtual occurrence retains its canonical identity and a broken one cannot create an ad-hoc class", () => {
  assert.deepEqual(registrationIdentity({ materializedLessonId: null, recurrenceId: "series", occurrenceKey: "series:2026-10-31", recurrenceIndex: 4 }),
    { calendarLessonId: null, recurrenceId: "series", occurrenceKey: "series:2026-10-31", recurrenceIndex: 4 });
  assert.throws(() => registrationIdentity({ materializedLessonId: null, recurrenceId: "series", occurrenceKey: null, recurrenceIndex: 4 }));
});
