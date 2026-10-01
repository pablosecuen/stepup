import { test } from "node:test";
import assert from "node:assert/strict";
import { planArchiveStudentPrune, type RuleForPrune, type RuleParticipantForPrune, type LooseLessonForPrune } from "../archive-prune-plan.ts";
import type { RecurrenceWeek } from "../../calendar/types.ts";

const BA_MIDNIGHT_2026_09_28 = "2026-09-28T03:00:00.000Z"; // civil Argentina 00:00 (UTC-3)
const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

function rule(overrides: Partial<RuleForPrune> = {}): RuleForPrune {
  return {
    recurrenceId: "rule-1",
    studentId: "student-archived",
    primaryStudentId: "student-archived",
    participantIds: ["student-archived"],
    cycleLengthWeeks: 1,
    weeks: MONDAY_18,
    modality: "presencial",
    timezone: "America/Argentina/Buenos_Aires",
    startDate: "2026-08-31",
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

const now = new Date("2026-09-01T00:00:00.000Z");

test("planArchiveStudentPrune: sin series ni clases sueltas -> plan vacío en las 6 categorías", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [],
    ruleParticipants: [],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.deepEqual(plan, {
    seriesEnd: [],
    seriesPromote: [],
    seriesParticipantRemoval: [],
    looseCancel: [],
    looseReassign: [],
    looseRemoveParticipant: [],
  });
});

test("planArchiveStudentPrune: alumno primario SIN otros participantes -> termina la serie (seriesEnd), nunca la borra ni la promueve", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [rule()],
    ruleParticipants: [{ ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "X", studentLevel: "B1" }],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.deepEqual(plan.seriesEnd, [{ ruleId: "rule-1" }]);
  assert.equal(plan.seriesPromote.length, 0);
  assert.equal(plan.seriesParticipantRemoval.length, 0);
});

test("planArchiveStudentPrune: alumno primario CON otros participantes -> promueve de forma determinística (createdAt más antiguo), nunca cancela la serie", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [rule({ participantIds: ["student-archived", "b", "c"] })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "c", createdAt: "2026-08-03T00:00:00Z", studentName: "C", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "b", createdAt: "2026-08-02T00:00:00Z", studentName: "B", studentLevel: "A2" },
    ],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.equal(plan.seriesEnd.length, 0);
  assert.equal(plan.seriesPromote.length, 1);
  assert.equal(plan.seriesPromote[0].ruleId, "rule-1");
  assert.equal(plan.seriesPromote[0].newPrimaryStudentId, "b", "b entró antes que c (createdAt más antiguo) -> se promueve a b, nunca a c ni al azar");
  assert.equal(plan.seriesPromote[0].newPrimaryStudentName, "B");
});

test("planArchiveStudentPrune: empate exacto de createdAt en la promoción se desempata por studentId ascendente, nunca azar", () => {
  const sameInstant = "2026-08-02T00:00:00Z";
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [rule({ participantIds: ["student-archived", "zzz", "aaa"] })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "zzz", createdAt: sameInstant, studentName: "Z", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "aaa", createdAt: sameInstant, studentName: "A", studentLevel: "B1" },
    ],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.equal(plan.seriesPromote[0].newPrimaryStudentId, "aaa", "empate exacto -> gana el studentId menor (\"aaa\" < \"zzz\"), determinístico");
});

test("planArchiveStudentPrune: alumno secundario en una serie -> seriesParticipantRemoval, la serie sigue (nunca seriesEnd ni seriesPromote)", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [rule({ primaryStudentId: "primary-other", studentId: "primary-other", participantIds: ["primary-other", "student-archived"] })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "primary-other", createdAt: "2026-07-01T00:00:00Z", studentName: "Primario", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
    ],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.equal(plan.seriesEnd.length, 0);
  assert.equal(plan.seriesPromote.length, 0);
  assert.equal(plan.seriesParticipantRemoval.length, 1);
  assert.equal(plan.seriesParticipantRemoval[0].ruleId, "rule-1");
});

test("planArchiveStudentPrune: serie desde la fecha efectiva -> las ocurrencias virtuales previas se congelan (freezeOccurrences no vacío)", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now: new Date("2026-09-01T00:00:00.000Z"),
    effectiveDateIso: "2026-09-30T03:00:00.000Z", // ~30/09 civil Argentina
    rules: [rule({ primaryStudentId: "primary-other", studentId: "primary-other", participantIds: ["primary-other", "student-archived"] })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "primary-other", createdAt: "2026-07-01T00:00:00Z", studentName: "Primario", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
    ],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.ok(plan.seriesParticipantRemoval[0].freezeOccurrences.length > 0, "hay lunes reales entre el 1 y el 30 de septiembre para congelar");
});

test("planArchiveStudentPrune: ocurrencia ya materializada/completada nunca se recongela (respeta el tramo histórico)", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now: new Date("2026-09-01T00:00:00.000Z"),
    effectiveDateIso: "2026-09-30T03:00:00.000Z",
    rules: [rule({ primaryStudentId: "primary-other", studentId: "primary-other", participantIds: ["primary-other", "student-archived"] })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "primary-other", createdAt: "2026-07-01T00:00:00Z", studentName: "Primario", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
    ],
    lessonsByRule: {
      "rule-1": [{ id: "real-1", recurrenceId: "rule-1", recurrenceOccurrenceKey: "rule-1:w1:c0:d0:t1800:s0", status: "completed" }],
    },
    looseLessons: [],
  });
  const keys = plan.seriesParticipantRemoval[0].freezeOccurrences.map((o) => o.occurrenceKey);
  assert.ok(!keys.includes("rule-1:w1:c0:d0:t1800:s0"), "la ocurrencia ya materializada/completada nunca se toca de nuevo");
});

test("planArchiveStudentPrune: clase suelta futura, alumno primario y único participante -> looseCancel", () => {
  const looseLesson: LooseLessonForPrune = { id: "lesson-1", primaryStudentId: "student-archived", otherParticipants: [] };
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [],
    ruleParticipants: [],
    lessonsByRule: {},
    looseLessons: [looseLesson],
  });
  assert.deepEqual(plan.looseCancel, ["lesson-1"]);
  assert.equal(plan.looseReassign.length, 0);
});

test("planArchiveStudentPrune: clase suelta futura, alumno primario con otros -> looseReassign determinístico, nunca cancela", () => {
  const looseLesson: LooseLessonForPrune = {
    id: "lesson-1",
    primaryStudentId: "student-archived",
    otherParticipants: [
      { studentId: "z", studentName: "Z", level: "B1", createdAt: "2026-08-02T00:00:00Z" },
      { studentId: "a", studentName: "A", level: "A2", createdAt: "2026-08-01T00:00:00Z" },
    ],
  };
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [],
    ruleParticipants: [],
    lessonsByRule: {},
    looseLessons: [looseLesson],
  });
  assert.equal(plan.looseCancel.length, 0);
  assert.equal(plan.looseReassign.length, 1);
  assert.equal(plan.looseReassign[0].newPrimaryStudentId, "a", "a entró antes (createdAt más antiguo) -> se promueve a a");
  assert.equal(plan.looseReassign[0].newPrimaryLevel, "A2");
});

test("planArchiveStudentPrune: clase suelta futura, alumno secundario -> looseRemoveParticipant, nunca cancela ni reasigna", () => {
  const looseLesson: LooseLessonForPrune = {
    id: "lesson-1",
    primaryStudentId: "otro-alumno",
    otherParticipants: [],
  };
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [],
    ruleParticipants: [],
    lessonsByRule: {},
    looseLessons: [looseLesson],
  });
  assert.deepEqual(plan.looseRemoveParticipant, ["lesson-1"]);
  assert.equal(plan.looseCancel.length, 0);
  assert.equal(plan.looseReassign.length, 0);
});

test("planArchiveStudentPrune: series pausada/ended nunca aportan ocurrencias a congelar (misma regla que generateOccurrences)", () => {
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now: new Date("2026-09-01T00:00:00.000Z"),
    effectiveDateIso: "2026-09-30T03:00:00.000Z",
    rules: [rule({ primaryStudentId: "primary-other", studentId: "primary-other", participantIds: ["primary-other", "student-archived"], status: "paused" })],
    ruleParticipants: [
      { ruleId: "rule-1", studentId: "primary-other", createdAt: "2026-07-01T00:00:00Z", studentName: "Primario", studentLevel: "B1" },
      { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
    ],
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.deepEqual(plan.seriesParticipantRemoval[0].freezeOccurrences, []);
});

const RANDOM_PARTICIPANT_ORDER_INVARIANCE_INPUT: RuleParticipantForPrune[] = [
  { ruleId: "rule-1", studentId: "student-archived", createdAt: "2026-08-01T00:00:00Z", studentName: "Archivado", studentLevel: "B1" },
  { ruleId: "rule-1", studentId: "c", createdAt: "2026-08-03T00:00:00Z", studentName: "C", studentLevel: "B1" },
  { ruleId: "rule-1", studentId: "b", createdAt: "2026-08-02T00:00:00Z", studentName: "B", studentLevel: "A2" },
];

test("planArchiveStudentPrune: la promoción nunca depende del orden en que llegan los participantes en el array", () => {
  const reversed = [...RANDOM_PARTICIPANT_ORDER_INVARIANCE_INPUT].reverse();
  const plan = planArchiveStudentPrune({
    studentId: "student-archived",
    now,
    effectiveDateIso: BA_MIDNIGHT_2026_09_28,
    rules: [rule({ participantIds: ["student-archived", "b", "c"] })],
    ruleParticipants: reversed,
    lessonsByRule: {},
    looseLessons: [],
  });
  assert.equal(plan.seriesPromote[0].newPrimaryStudentId, "b");
});
