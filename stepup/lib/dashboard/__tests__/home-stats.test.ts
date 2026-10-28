// Indicadores de Inicio (alumnos activos, clases de la semana, horas del mes, promedio de evaluaciones): reglas del original (buildDashboardData) sobre la semana civil de Argentina.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildHomeStats, weekBounds } from "../home-stats.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("la semana va de lunes a domingo (domingo incluido en la semana que termina) y cruza el cambio de año", () => {
  assert.deepEqual(weekBounds("2026-10-28"), { startKey: "2026-10-26", endExclusiveKey: "2026-11-02" }); // miércoles
  assert.deepEqual(weekBounds("2026-11-01"), { startKey: "2026-10-26", endExclusiveKey: "2026-11-02" }); // domingo: todavía la misma semana
  assert.deepEqual(weekBounds("2026-11-02"), { startKey: "2026-11-02", endExclusiveKey: "2026-11-09" }); // lunes: semana nueva
  assert.deepEqual(weekBounds("2026-12-31"), { startKey: "2026-12-28", endExclusiveKey: "2027-01-04" });
});

test("clases de la semana: las canceladas no cuentan; el resto (programadas, reprogramadas, dictadas) sí", () => {
  const stats = buildHomeStats({ activeStudents: 3, weekItems: [{ status: "scheduled" }, { status: "cancelled" }, { status: "rescheduled" }, { status: "completed" }], monthMinutes: [], grades: [] });
  assert.equal(stats.lessonsThisWeek, 3);
  assert.equal(stats.activeStudents, 3);
});

test("horas del mes: suma la duración real, redondea a 1 decimal y una clase sin duración suma 0", () => {
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [60, 90, null, 45], grades: [] }).hoursTaughtThisMonth, 3.3);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [] }).hoursTaughtThisMonth, 0);
});

test("promedio de evaluaciones: todas las notas reales; un 0 o la ausencia de nota nunca cuenta; sin notas, null", () => {
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [8, 6, 10, 0, null] }).averageGrade, 8);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [7, 8] }).averageGrade, 7.5);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [] }).averageGrade, null);
});

test("cableado: Inicio muestra los cuatro indicadores, 'Sin datos' si no se pudieron leer, y la lectura es de sólo lectura", () => {
  const view = read("components/dashboard/home-view.tsx");
  for (const label of ["alumnos activos", "esta semana", "enseñadas este mes", "promedio de evaluaciones"]) assert.match(view, new RegExp(label));
  assert.match(view, /Sin datos/);
  const loader = read("lib/dashboard/load-home-data.ts");
  assert.match(loader, /loadHomeStatsInputs\(ctx, todayDateKey\.slice\(0, 7\)\)\.catch\(\(\) => null\)/);
  assert.doesNotMatch(read("lib/repositories/home-stats-inputs.ts"), /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
