import { test } from "node:test";
import assert from "node:assert/strict";
import { hasResolvedAttendanceStatus, planBulkAttendance } from "../attendance.ts";

test("hasResolvedAttendanceStatus: los 4 estados reales cuentan como resueltos", () => {
  assert.equal(hasResolvedAttendanceStatus("presente"), true);
  assert.equal(hasResolvedAttendanceStatus("ausente"), true);
  assert.equal(hasResolvedAttendanceStatus("tarde"), true);
  assert.equal(hasResolvedAttendanceStatus("ausente_aviso"), true);
});

test("hasResolvedAttendanceStatus: 'sin_registrar' (legado) y ausencia nunca cuentan como resueltos", () => {
  assert.equal(hasResolvedAttendanceStatus("sin_registrar"), false);
  assert.equal(hasResolvedAttendanceStatus(null), false);
  assert.equal(hasResolvedAttendanceStatus(undefined), false);
});

test("«Marcar todos presentes» / «Limpiar asistencia» sólo afectan a los alumnos que no se completaron ni omitieron", () => {
  const participants = [{ studentId: "a" }, { studentId: "b" }, { studentId: "c" }, { studentId: "d" }];
  const status = { a: "pending", b: "pending", c: "completed", d: "omitted" };
  const present = planBulkAttendance(participants, { a: null, b: null, c: "ausente" }, status, "present");
  assert.deepEqual(present.studentIds, ["a", "b"]);
  assert.deepEqual(present.patch, { attendanceStatus: "presente", lateMinutes: "" });
  assert.equal(present.needsConfirmation, false, "no había asistencia cargada en los alumnos editables");
  assert.equal(present.skippedCompleted, 2);
  const replace = planBulkAttendance(participants, { a: "ausente", b: null }, status, "present");
  assert.equal(replace.needsConfirmation, true, "reemplaza una asistencia ya cargada");
  const same = planBulkAttendance(participants, { a: "presente", b: "presente" }, status, "present");
  assert.equal(same.needsConfirmation, false, "ya estaban presentes: nada que reemplazar");
  const clear = planBulkAttendance(participants, { a: "presente", b: "tarde" }, status, "clear");
  assert.deepEqual(clear.patch, { attendanceStatus: null, lateMinutes: "" });
  assert.equal(clear.needsConfirmation, true, "borra asistencia ya cargada");
  assert.equal(planBulkAttendance(participants, { a: null, b: null }, status, "clear").needsConfirmation, false);
});

test("cableado: el registro grupal ofrece los dos botones y pide confirmar antes de reemplazar o borrar asistencia", async () => {
  const { readFileSync } = await import("node:fs");
  const ws = readFileSync(new URL("../../../app/(app)/registro/[calendarLessonId]/registration-workspace.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(ws, /Marcar todos presentes/);
  assert.match(ws, /Limpiar asistencia/);
  assert.match(ws, /planBulkAttendance\(/);
  assert.match(ws, /¿Reemplazar la asistencia ya cargada\?/);
  assert.match(ws, /¿Borrar la asistencia ya cargada\?/);
});
