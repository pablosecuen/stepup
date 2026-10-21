import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTestDataSummary } from "../summary.ts";

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const row = (id: string, studentId: string, revokedAt: string | null = null, createdAt = "2026-10-21T10:00:00.000Z") => ({ id, student_id: studentId, reason: "r16-qa: x", evidence: {}, created_at: createdAt, revoked_at: revokedAt });
const student = (id: string, name: string, createdAt: string, status = "activo") => ({ id, name, status, created_at: createdAt });

test("el resumen cuenta alumnos ocultos y visibles, y lo que cuelga de cada uno sin repetir (una serie o clase con dos participantes de prueba cuenta una vez por alumno)", () => {
  const summary = buildTestDataSummary({
    exclusions: [row("e1", "a"), row("e2", "b", "2026-10-22T00:00:00.000Z"), row("e3", "b", null, "2026-10-23T00:00:00.000Z")],
    students: [student("a", "QA Uno", "2026-09-21T00:31:00.000Z"), student("b", "PRUEBA Dos", "2026-09-22T00:31:00.000Z", "archivado"), student("real", "Alumna Real", "2026-01-01T00:00:00.000Z")],
    ruleLinks: [{ student_id: "a", recurrence_rule_id: "r1" }, { student_id: "a", recurrence_rule_id: "r1" }, { student_id: "b", recurrence_rule_id: "r1" }, { student_id: "real", recurrence_rule_id: "r9" }],
    lessonLinks: [{ student_id: "a", calendar_lesson_id: "l1" }, { student_id: "a", calendar_lesson_id: "l2" }],
    registrationLinks: [{ student_id: "b", lesson_registration_id: "g1" }],
    charges: [{ student_id: "b", voided_at: "2026-09-22T00:00:00.000Z" }],
  });
  assert.equal(summary.students.length, 2, "una alumna real nunca figura");
  assert.equal(summary.hiddenCount, 2);
  assert.equal(summary.visibleCount, 0);
  assert.deepEqual(summary.students.map((s) => [s.name, s.hidden, s.seriesCount, s.lessonCount, s.registrationCount, s.chargeCount]), [["QA Uno", true, 1, 2, 0, 0], ["PRUEBA Dos", true, 1, 0, 1, 1]]);
});

test("un alumno con todas sus exclusiones revocadas figura como visible", () => {
  const summary = buildTestDataSummary({ exclusions: [row("e1", "a", "2026-10-22T00:00:00.000Z")], students: [student("a", "QA Uno", "2026-09-21T00:31:00.000Z")], ruleLinks: [], lessonLinks: [], registrationLinks: [], charges: [] });
  assert.equal(summary.hiddenCount, 0);
  assert.equal(summary.visibleCount, 1);
  assert.equal(summary.students[0].hidden, false);
});

test("sin nada marcado el resumen está vacío (la pantalla lo dice y no ofrece botones)", () => {
  const summary = buildTestDataSummary({ exclusions: [], students: [student("a", "Real", "2026-01-01T00:00:00.000Z")], ruleLinks: [], lessonLinks: [], registrationLinks: [], charges: [] });
  assert.deepEqual(summary, { hiddenCount: 0, visibleCount: 0, students: [] });
});

test("cableado de las listas: Alumnos, Series y los selectores de clase usan la lista de excluidos; la ficha del alumno no", () => {
  assert.match(read("app/(app)/alumnos/page.tsx"), /students = withoutExcludedStudents\(allStudents, excludedStudentIds\);/);
  const series = read("app/(app)/calendario/series/page.tsx");
  assert.match(series, /rules = withoutExcludedRules\(allRules, excludedStudentIds\);/);
  assert.match(series, /students = withoutExcludedStudents\(allStudents, excludedStudentIds\);/);
  assert.match(read("app/(app)/calendario/nueva/page.tsx"), /withoutExcludedStudents\(allStudents, excludedStudentIds\)/);
  assert.match(read("app/(app)/registro/nuevo/page.tsx"), /withoutExcludedStudents\(allStudents, excludedStudentIds\)/);
  assert.doesNotMatch(read("app/(app)/alumnos/[id]/page.tsx"), /excluded|Excluded/, "la ficha de un alumno (la forma de consultar sus datos) ve todo");
});

test("consulta y reversión: la pantalla lista a los alumnos marcados con enlace a su ficha, y los botones sólo cambian la exclusión (nunca borran)", () => {
  const page = read("app/(app)/configuracion/datos-de-prueba/page.tsx");
  assert.match(page, /href=\{`\/alumnos\/\$\{student\.studentId\}`\}/, "enlace a la ficha completa");
  assert.match(page, /Nunca se borran/);
  assert.ok(existsLoading());
  const toggle = read("components/account/test-data-toggle.tsx");
  assert.match(toggle, /Volver a mostrar los datos de prueba/);
  assert.match(toggle, /Ocultar los datos de prueba/);
  const repo = read("lib/repositories/excluded-students.ts");
  assert.doesNotMatch(repo, /\.delete\(/, "nada se borra");
  assert.match(repo, /update\(\{ revoked_at: new Date\(\)\.toISOString\(\) \}\)/);
  const action = read("lib/actions/data-visibility.ts");
  assert.match(action, /requireAuthenticatedDbContext\(\)/);
  assert.doesNotMatch(action, /ownerId/, "nunca recibe el dueño del navegador");
  assert.match(read("components/account/configuration-view.tsx"), /href="\/configuracion\/datos-de-prueba"/);
});

function existsLoading(): boolean {
  try {
    readFileSync("app/(app)/configuracion/datos-de-prueba/loading.tsx", "utf8");
    return true;
  } catch {
    return false;
  }
}
