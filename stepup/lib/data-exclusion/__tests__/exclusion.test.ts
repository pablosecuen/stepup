import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCalendarViewForRange } from "../../calendar/occurrences.ts";
import { buildFinancialStatistics } from "../../reports/financial-statistics.ts";
import { isFullyExcluded, NO_EXCLUDED_STUDENTS, withoutExcludedLessons, withoutExcludedRegistrations, withoutExcludedRules, withoutExcludedStudents } from "../exclusion.ts";

const QA = new Set(["qa1", "qa2"]);
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

test("sólo se oculta lo que tiene participantes y TODOS son de prueba: nunca algo compartido con un alumno real ni algo sin participantes", () => {
  assert.equal(isFullyExcluded(["qa1"], QA), true);
  assert.equal(isFullyExcluded(["qa1", "qa2"], QA), true);
  assert.equal(isFullyExcluded(["qa1", "real"], QA), false);
  assert.equal(isFullyExcluded([], QA), false);
  assert.equal(isFullyExcluded(["qa1"], NO_EXCLUDED_STUDENTS), false);
});

test("sin alumnos excluidos todo queda exactamente igual (la herramienta es inofensiva hasta que se cargue la lista)", () => {
  const rules = [{ id: "r", primaryStudentId: "qa1", participantIds: ["qa1"] }];
  const lessons = [{ id: "l", primaryStudentId: "qa1", participantIds: ["qa1"] }];
  assert.deepEqual(withoutExcludedRules(rules, NO_EXCLUDED_STUDENTS), rules);
  assert.deepEqual(withoutExcludedLessons(lessons, NO_EXCLUDED_STUDENTS), lessons);
  assert.deepEqual(withoutExcludedStudents([{ id: "qa1" }], NO_EXCLUDED_STUDENTS), [{ id: "qa1" }]);
});

test("series, clases, registros y alumnos de prueba se filtran; lo real y lo mixto se conserva", () => {
  const rules = [
    { id: "r-qa", primaryStudentId: "qa1", participantIds: ["qa1", "qa2"] },
    { id: "r-real", primaryStudentId: "real", participantIds: ["real"] },
    { id: "r-mixta", primaryStudentId: "qa1", participantIds: ["qa1", "real"] },
  ];
  assert.deepEqual(withoutExcludedRules(rules, QA).map((r) => r.id), ["r-real", "r-mixta"]);
  const lessons = [
    { id: "l-qa", primaryStudentId: "qa2", participantIds: [] as string[] },
    { id: "l-real", primaryStudentId: "real", participantIds: ["real"] },
  ];
  assert.deepEqual(withoutExcludedLessons(lessons, QA).map((l) => l.id), ["l-real"], "el alumno principal cuenta aunque falte en la lista de participantes");
  const registrations = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const roster = new Map([["a", ["qa1"]], ["b", ["qa1", "real"]], ["c", ["real"]]]);
  assert.deepEqual(withoutExcludedRegistrations(registrations, roster, QA).map((r) => r.id), ["b", "c", "d"], "un registro sin alumnos cargados (d) nunca se considera de prueba");
  assert.deepEqual(withoutExcludedStudents([{ id: "qa1" }, { id: "real" }], QA).map((s) => s.id), ["real"]);
});

// ── Ensayo con los motores reales: el efecto sobre agenda y estadísticas ─────────────────────────────────────────────────────────────────────────
const RULE_QA = "11111111-1111-1111-1111-111111111111";
const RULE_REAL = "22222222-2222-2222-2222-222222222222";
const week = (hour: number) => [{ weekIndex: 0, sessions: [{ weekday: 1, hour, minute: 0, durationMinutes: 60 }] }];
const engineRule = (recurrenceId: string, studentId: string, hour: number) => ({ recurrenceId, studentId, participantIds: [studentId], cycleLengthWeeks: 1, weeks: week(hour), modality: "online" as const, timezone: "America/Argentina/Buenos_Aires", startDate: "2026-10-05", endDate: null, status: "active" as const, classTitle: null, activityKind: "class" as const });

test("ensayo: con la lista cargada, la clase de la serie de prueba desaparece de la agenda y lo real queda idéntico (martes 20/10 a las 18:00 y 19:00)", () => {
  const ruleRows = [
    { ...engineRule(RULE_QA, "qa1", 18), primaryStudentId: "qa1" },
    { ...engineRule(RULE_REAL, "real", 19), primaryStudentId: "real" },
  ];
  const view = (excluded: ReadonlySet<string>) =>
    buildCalendarViewForRange({
      rangeStart: new Date("2026-10-20T03:00:00.000Z"),
      rangeEnd: new Date("2026-10-21T02:59:00.000Z"),
      rules: withoutExcludedRules(ruleRows, excluded).map(({ primaryStudentId: _ignored, ...rule }) => rule),
      exceptions: [],
      lessons: [],
    }).map((item) => item.recurrenceId);
  assert.deepEqual(view(NO_EXCLUDED_STUDENTS).sort(), [RULE_QA, RULE_REAL].sort());
  assert.deepEqual(view(new Set(["qa1"])), [RULE_REAL]);
});

test("ensayo: con la lista cargada, los registros y alumnos de prueba no cuentan en las estadísticas; los reales no cambian", () => {
  const registration = (id: string, lessonId: string) => ({
    id, calendar_lesson_id: lessonId, source_event_type: null, outcome: "clase_dictada", holiday_exception: false, is_billable: null,
    scheduled_start_at: "2026-10-06T13:00:00.000Z", scheduled_end_at: "2026-10-06T14:00:00.000Z", actual_started_at: null, actual_ended_at: null,
    scheduled_duration_minutes: null, actual_duration_minutes: null, modality: "online", billed_amount: null, created_at: "2026-10-06T15:00:00.000Z", source_extras: null,
  });
  const students = [
    { id: "real", levels: ["B1"], status: "activo", billingType: "por_clase" as const, billingPlan: null, price: 10000, dateJoined: "2026-01-10" },
    { id: "qa1", levels: ["B1"], status: "activo", billingType: "por_clase" as const, billingPlan: null, price: 10000, dateJoined: "2026-09-21" },
  ];
  const roster = [{ lesson_registration_id: "r-real", student_id: "real" }, { lesson_registration_id: "r-qa", student_id: "qa1" }];
  const registrations = [registration("r-real", "L-real"), registration("r-qa", "L-qa")];
  const run = (excluded: ReadonlySet<string>) => {
    const byRegistration = new Map<string, string[]>();
    roster.forEach((entry) => byRegistration.set(entry.lesson_registration_id, [...(byRegistration.get(entry.lesson_registration_id) ?? []), entry.student_id]));
    return buildFinancialStatistics({
      evaluationDate: "2026-10-20", evaluationInstant: "2026-10-21T01:53:00.000Z", range: { rangeStart: "2026-10-01", rangeEnd: "2026-10-31" }, year: 2026,
      periodItems: [], demandItems: [], registrations: withoutExcludedRegistrations(registrations, byRegistration, excluded), roster, evaluationAmounts: [], rules: [],
      students: withoutExcludedStudents(students, excluded), charges: [], packageConsumptions: [], availabilityExceptions: [],
    });
  };
  const all = run(NO_EXCLUDED_STUDENTS);
  const real = run(new Set(["qa1"]));
  assert.equal(all.annualActivity.heldLessonCount, 2);
  assert.equal(real.annualActivity.heldLessonCount, 1);
  assert.equal(all.studentYear.newStudentsThisYear, 2);
  assert.equal(real.studentYear.newStudentsThisYear, 1);
  assert.equal(real.studentYear.activeStudentsNow, 1);
  assert.equal(real.studentYear.uniqueStudentsAttended, 1);
});

// ── Cableado y reversibilidad ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("cableado: la agenda, Inicio y las estadísticas leen la lista; las acciones que escriben y la ficha del alumno ven todo; sin la tabla no se rompe nada", () => {
  const view = read("lib/calendar/view.ts");
  assert.match(view, /const rules = withoutExcludedRules\(allRules, excludedStudentIds\);/);
  assert.match(view, /const lessons = withoutExcludedLessons\(allLessons, excludedStudentIds\);/);
  assert.match(view, /options\.includeTestData \? Promise\.resolve\(NO_EXCLUDED_STUDENTS\) : loadExcludedStudentIds\(ctx\)/);
  for (const file of ["lib/actions/calendar.ts", "lib/actions/lesson-registrations.ts", "lib/students/load-profile-overview.ts"]) {
    assert.match(read(file), /loadCalendarViewForRange\(ctx, rangeStart, rangeEnd, undefined, \{ includeTestData: true \}\)/, file);
  }
  assert.match(read("lib/dashboard/load-home-data.ts"), /withoutExcludedRules\(allRules, excludedStudentIds\)/);
  assert.match(read("lib/dashboard/load-financial-overview.ts"), /withoutExcludedRegistrations\(registrations, studentsByRegistration, excludedStudentIds\)/);
  const repo = read("lib/repositories/excluded-students.ts");
  assert.match(repo, /is\("revoked_at", null\)/, "una exclusión revocada deja de aplicarse");
  assert.match(repo, /if \(isMissingTableError\(error\)\) return NO_EXCLUDED_STUDENTS;/, "sin la tabla la aplicación se comporta como siempre");
});

test("reversibilidad: la migración sólo crea una tabla; los scripts sólo escriben en ella, y la reversión revoca (nunca borra)", () => {
  const migration = read("supabase/migrations/20261021200000_r16_test_data_exclusions.sql").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(migration, /\b(delete\s+from|drop\s+table|truncate|update\s+public\.(?!test_data)|insert\s+into\s+public\.(?!test_data))/i);
  const mark = read("supabase/repairs/r16_mark_qa_exclusions.sql").replace(/--[^\n]*/g, "");
  assert.doesNotMatch(mark, /\b(delete\s+from|truncate|drop\s+)/i);
  assert.equal((mark.match(/insert\s+into\s+public\.\w+/gi) ?? []).join(","), "insert into public.test_data_exclusions", "sólo escribe en la tabla de exclusiones");
  assert.doesNotMatch(mark, /\bupdate\s+public\./i);
  const unmark = read("supabase/repairs/r16_unmark_qa_exclusions.sql").replace(/--[^\n]*/g, "");
  assert.match(unmark, /update public\.test_data_exclusions\s+set revoked_at = now\(\)/);
  assert.doesNotMatch(unmark, /\bdelete\b|\btruncate\b|\bdrop\b/i);
  assert.equal((mark.match(/'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'/g) ?? []).length, 6, "exactamente los 6 alumnos de la lista, por id");
});
