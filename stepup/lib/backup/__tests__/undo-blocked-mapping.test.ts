import { test } from "node:test";
import assert from "node:assert/strict";
import { toHumanBlockedRow, humanTableLabel, UNDO_BLOCKED_EXPLANATION, type ResolvedBlockerRow } from "../undo-blocked-mapping.ts";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KNOWN_TABLE_NAMES = [
  "students",
  "payment_charges",
  "payments",
  "payment_allocations",
  "lesson_registrations",
  "lesson_registration_students",
  "calendar_lessons",
  "recurrence_rules",
];

test("toHumanBlockedRow: alumno con nombre real -> mensaje humano, sin id ni nombre de tabla", () => {
  const resolved: ResolvedBlockerRow = {
    parentTableName: "students",
    parentStudentName: "PRUEBA WEB F9 UX Alumno",
    children: [{ tableName: "payment_charges", resolved: true, dateIso: "2026-09-10", concept: "$500 (2026-09)" }],
  };
  const row = toHumanBlockedRow(resolved);
  assert.equal(row.entityLabel, "el alumno PRUEBA WEB F9 UX Alumno");
  assert.equal(row.dependencies.length, 1);
  assert.match(row.dependencies[0], /un cargo/);
  assert.match(row.dependencies[0], /\$500/);
  const serialized = JSON.stringify(row);
  assert.equal(UUID_RE.test(serialized), false, "ningún UUID debe aparecer en el mensaje final");
  for (const t of KNOWN_TABLE_NAMES) {
    assert.equal(serialized.includes(t), false, `el nombre de tabla real "${t}" nunca debe aparecer en el mensaje final`);
  }
});

test("toHumanBlockedRow: fallback legible cuando no hay nombre de alumno resuelto", () => {
  const resolved: ResolvedBlockerRow = { parentTableName: "students", parentStudentName: undefined, children: [] };
  const row = toHumanBlockedRow(resolved);
  assert.equal(row.entityLabel, "un alumno sin nombre disponible");
  assert.equal(row.dependencies.length, 1);
  assert.match(row.dependencies[0], /no se pudieron identificar/);
});

test("toHumanBlockedRow: dependencia que no se pudo resolver -> fallback legible, nunca un id crudo", () => {
  const resolved: ResolvedBlockerRow = {
    parentTableName: "students",
    parentStudentName: "Alguien",
    children: [{ tableName: "payments", resolved: false }],
  };
  const row = toHumanBlockedRow(resolved);
  assert.equal(row.dependencies.length, 1);
  assert.match(row.dependencies[0], /no se pudo identificar el detalle/);
  assert.equal(UUID_RE.test(JSON.stringify(row)), false);
});

test("toHumanBlockedRow: tabla padre desconocida -> rótulo genérico, nunca el nombre técnico", () => {
  const resolved: ResolvedBlockerRow = { parentTableName: "una_tabla_que_no_existe_todavia", children: [] };
  const row = toHumanBlockedRow(resolved);
  assert.equal(row.entityLabel.includes("una_tabla_que_no_existe_todavia"), false);
  assert.ok(row.entityLabel.length > 0);
});

test("humanTableLabel: cubre las tablas reales usadas por el undo de Fase 9, nunca devuelve el nombre crudo", () => {
  for (const t of KNOWN_TABLE_NAMES) {
    const label = humanTableLabel(t);
    assert.notEqual(label, t);
    assert.ok(label.length > 0);
  }
});

test("UNDO_BLOCKED_EXPLANATION: explica que no se toca nada, para proteger información posterior", () => {
  assert.match(UNDO_BLOCKED_EXPLANATION, /no se va a modificar ni borrar nada/i);
  assert.match(UNDO_BLOCKED_EXPLANATION, /proteger/i);
});

test("toHumanBlockedRow: parent no-students usa el rótulo humano de esa tabla, no un nombre propio", () => {
  const resolved: ResolvedBlockerRow = { parentTableName: "payment_charges", children: [{ tableName: "payment_allocations", resolved: true, concept: "$100" }] };
  const row = toHumanBlockedRow(resolved);
  assert.equal(row.entityLabel, "un cargo");
  assert.match(row.dependencies[0], /asignación/);
});
