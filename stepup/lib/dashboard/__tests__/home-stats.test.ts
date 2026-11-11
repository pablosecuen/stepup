// Indicadores de Inicio (alumnos activos, clases de la semana, horas del mes, promedio de evaluaciones): reglas del original (buildDashboardData) sobre la semana civil de Argentina.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildHomeStats, monthMinutesOf, resolveClassMinutes, weekBounds, type RegisteredClassTimes } from "../home-stats.ts";

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

// ---- «0 h enseñadas este mes» (11/11/2026): el registro de la web guarda el inicio y el fin reales, no `actual_duration_minutes` (sólo lo traen los traslados) ----
const times = (overrides: Partial<RegisteredClassTimes> = {}): RegisteredClassTimes & { createdAt: string } => ({ actualDurationMinutes: null, actualStartedAt: null, actualEndedAt: null, scheduledStartAt: null, scheduledEndAt: null, createdAt: "2026-11-03T15:00:00.000Z", ...overrides });

test("la duración sale de la real guardada, del inicio y fin reales (lo que escribe la web) o de la programada; sin ninguna es null, nunca 0", () => {
  assert.equal(resolveClassMinutes(times({ actualDurationMinutes: 75 })), 75);
  assert.equal(resolveClassMinutes(times({ actualStartedAt: "2026-11-03T21:00:00.000Z", actualEndedAt: "2026-11-03T22:00:00.000Z" })), 60, "caso real: 34 clases de noviembre sólo tenían inicio y fin reales");
  assert.equal(resolveClassMinutes(times({ actualDurationMinutes: 0, actualStartedAt: "2026-11-03T21:00:00.000Z", actualEndedAt: "2026-11-03T22:30:00.000Z" })), 90, "una duración 0 no cuenta como dato");
  assert.equal(resolveClassMinutes(times({ scheduledStartAt: "2026-11-03T21:00:00.000Z", scheduledEndAt: "2026-11-03T21:45:00.000Z" })), 45);
  assert.equal(resolveClassMinutes(times({ actualStartedAt: "2026-11-03T22:00:00.000Z", actualEndedAt: "2026-11-03T21:00:00.000Z" })), null, "un fin anterior al inicio no es una duración");
  assert.equal(resolveClassMinutes(times()), null);
});

test("el mes cuenta cada clase UNA vez (grupal o entrenamiento no se multiplican por participante) y respeta el mes civil de Argentina", () => {
  const rows = [
    times({ actualStartedAt: "2026-11-03T21:00:00.000Z", actualEndedAt: "2026-11-03T22:00:00.000Z" }), // individual 60
    times({ actualStartedAt: "2026-11-04T21:00:00.000Z", actualEndedAt: "2026-11-04T22:30:00.000Z" }), // grupal de 5 alumnos: UNA fila de 90
    times({ actualStartedAt: "2026-11-05T12:00:00.000Z", actualEndedAt: "2026-11-05T13:00:00.000Z" }), // entrenamiento 60
    times({ actualStartedAt: "2026-11-01T01:30:00.000Z", actualEndedAt: "2026-11-01T02:30:00.000Z" }), // 31/10 22:30 en Argentina: es de octubre
    times({ actualStartedAt: "2026-12-01T02:00:00.000Z", actualEndedAt: "2026-12-01T03:00:00.000Z" }), // 30/11 23:00 en Argentina: es de noviembre
    times({ actualStartedAt: "2026-12-01T12:00:00.000Z", actualEndedAt: "2026-12-01T13:00:00.000Z" }), // diciembre
  ];
  const minutes = monthMinutesOf(rows, "2026-11");
  assert.deepEqual(minutes, [60, 90, 60, 60]);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: minutes, grades: [] }).hoursTaughtThisMonth, 4.5);
});

test("clases dictadas sin ninguna duración conocida muestran «Sin datos» (null); si hay algunas con duración, se suman las conocidas; sin clases son 0 h reales", () => {
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [null, null], grades: [] }).hoursTaughtThisMonth, null);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [null, 60], grades: [] }).hoursTaughtThisMonth, 1);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [] }).hoursTaughtThisMonth, 0);
});

test("cableado: la lectura trae el fin real y el programado y usa la resolución común (no actual_duration_minutes solo)", () => {
  const source = read("lib/repositories/home-stats-inputs.ts");
  assert.match(source, /columns: "id, scheduled_start_at, scheduled_end_at, actual_started_at, actual_ended_at, created_at, actual_duration_minutes"/);
  assert.match(source, /monthMinutesOf\(/);
  assert.doesNotMatch(source, /\.map\(\(row\) => \(row\.actual_duration_minutes === null \? null : Number\(row\.actual_duration_minutes\)\)\)/, "ya no usa sólo la duración guardada");
});
