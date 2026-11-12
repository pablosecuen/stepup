// Indicadores de Inicio (alumnos activos, clases de la semana, horas del mes, promedio de evaluaciones): reglas del original (buildDashboardData) sobre la semana civil de Argentina.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildHomeStats, homeStatsInputsFrom, weekBounds, type HomeStatsRawInputs } from "../home-stats.ts";
import { buildAnnualActivitySummary } from "../../reports/annual-activity.ts";
import { toRegisteredLessonFacts, type RegistrationRowForFacts } from "../../reports/registered-lessons.ts";

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
  assert.match(loader, /loadHomeStatsRaw\(ctx\)\.catch\(\(\) => null\)/);
  assert.match(loader, /homeStatsInputsFrom\(statsRaw, todayDateKey\.slice\(0, 7\), excludedStudentIds\)/);
  assert.doesNotMatch(read("lib/repositories/home-stats-inputs.ts"), /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

// ---- «0 h enseñadas este mes» (11/11/2026): la web guarda el inicio y el fin reales, no `actual_duration_minutes` (sólo lo traen los traslados) ----
// Las pruebas parten de FILAS reales de `lesson_registrations` y comparan Inicio con «Horas dictadas» del Resumen financiero: tienen que dar siempre lo mismo.
let seq = 0;
const row = (overrides: Partial<RegistrationRowForFacts> = {}): RegistrationRowForFacts => ({
  id: `r${++seq}`,
  calendar_lesson_id: null,
  source_event_type: null,
  outcome: "clase_dictada",
  holiday_exception: false,
  is_billable: true,
  scheduled_start_at: null,
  scheduled_end_at: null,
  actual_started_at: null,
  actual_ended_at: null,
  scheduled_duration_minutes: null,
  actual_duration_minutes: null,
  modality: "online",
  billed_amount: null,
  created_at: "2026-11-03T15:00:00.000Z",
  ...overrides,
});
const raw = (registrations: RegistrationRowForFacts[], extra: Partial<HomeStatsRawInputs> = {}): HomeStatsRawInputs => ({ registrations, roster: [], grades: [], ...extra });
const minutesOf = (registrations: RegistrationRowForFacts[], month = "2026-11", excluded: ReadonlySet<string> = new Set(), extra: Partial<HomeStatsRawInputs> = {}) => homeStatsInputsFrom(raw(registrations, extra), month, excluded).monthMinutes;
/** Horas dictadas del Resumen financiero para el mismo mes (el camino que usa su pantalla). */
const financeHours = (registrations: RegistrationRowForFacts[], month = "2026-11") => {
  const facts = registrations.map((r) => toRegisteredLessonFacts(r, { studentIds: [], billedAmountByStudent: null, occurrenceKey: null }));
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
  return buildAnnualActivitySummary(facts, { rangeStart: `${month}-01`, rangeEnd: `${month}-${String(last).padStart(2, "0")}` }).heldHours;
};
const homeHours = (registrations: RegistrationRowForFacts[], month = "2026-11") => buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: minutesOf(registrations, month), grades: [] }).hoursTaughtThisMonth;

test("la duración sale de la real guardada, del inicio y fin reales (lo que escribe la web) o de la programada; sin ninguna es null, nunca 0", () => {
  assert.deepEqual(minutesOf([row({ actual_duration_minutes: 75 })]), [75]);
  assert.deepEqual(minutesOf([row({ actual_started_at: "2026-11-03T21:00:00.000Z", actual_ended_at: "2026-11-03T22:00:00.000Z" })]), [60], "caso real: 34 clases de noviembre sólo tenían inicio y fin reales");
  assert.deepEqual(minutesOf([row({ actual_duration_minutes: 0, actual_started_at: "2026-11-03T21:00:00.000Z", actual_ended_at: "2026-11-03T22:30:00.000Z" })]), [90], "una duración 0 no cuenta como dato");
  assert.deepEqual(minutesOf([row({ scheduled_duration_minutes: 40 })]), [40], "la duración programada guardada también sirve cuando no hay real");
  assert.deepEqual(minutesOf([row({ scheduled_start_at: "2026-11-03T21:00:00.000Z", scheduled_end_at: "2026-11-03T21:45:00.000Z" })]), [45]);
  assert.deepEqual(minutesOf([row({ actual_duration_minutes: 50, actual_started_at: "2026-11-03T21:00:00.000Z", actual_ended_at: "2026-11-03T22:30:00.000Z", scheduled_duration_minutes: 60 })]), [50], "orden: real guardada, inicio/fin reales, programada");
  assert.deepEqual(minutesOf([row({ actual_started_at: "2026-11-03T22:00:00.000Z", actual_ended_at: "2026-11-03T21:00:00.000Z" })]), [null], "un fin anterior al inicio no es una duración");
  assert.deepEqual(minutesOf([row()]), [null]);
});

test("el mes cuenta cada clase UNA vez (grupal o entrenamiento no se multiplican por participante) y respeta el mes civil de Argentina", () => {
  const registrations = [
    row({ id: "individual", actual_started_at: "2026-11-03T21:00:00.000Z", actual_ended_at: "2026-11-03T22:00:00.000Z" }), // individual 60
    row({ id: "grupal", actual_started_at: "2026-11-04T21:00:00.000Z", actual_ended_at: "2026-11-04T22:30:00.000Z" }), // grupal de 5 alumnos: UNA fila de 90
    row({ id: "entrenamiento", actual_started_at: "2026-11-05T12:00:00.000Z", actual_ended_at: "2026-11-05T13:00:00.000Z" }), // entrenamiento 60
    row({ id: "octubre", actual_started_at: "2026-11-01T01:30:00.000Z", actual_ended_at: "2026-11-01T02:30:00.000Z" }), // 31/10 22:30 en Argentina: es de octubre
    row({ id: "fin-de-mes", actual_started_at: "2026-12-01T02:00:00.000Z", actual_ended_at: "2026-12-01T03:00:00.000Z" }), // 30/11 23:00 en Argentina: es de noviembre
    row({ id: "diciembre", actual_started_at: "2026-12-01T12:00:00.000Z", actual_ended_at: "2026-12-01T13:00:00.000Z" }), // diciembre
  ];
  const roster = ["grupal"].flatMap((id) => ["a", "b", "c", "d", "e"].map((student) => ({ lesson_registration_id: id, student_id: student })));
  const minutes = minutesOf(registrations, "2026-11", new Set(), { roster });
  assert.deepEqual(minutes, [60, 90, 60, 60]);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: minutes, grades: [] }).hoursTaughtThisMonth, 4.5);
});

test("sólo cuentan las clases DICTADAS: cancelada, ausencia, reprogramada y feriado sin excepción no suman; feriado con excepción sí", () => {
  const at = { scheduled_start_at: "2026-11-03T21:00:00.000Z", scheduled_end_at: "2026-11-03T22:00:00.000Z" };
  const registrations = [
    row({ ...at, outcome: "clase_dictada" }),
    row({ ...at, outcome: "cancelada_con_aviso" }),
    row({ ...at, outcome: "cancelada_tarde" }),
    row({ ...at, outcome: "profesora_ausente" }),
    row({ ...at, outcome: "alumno_ausente" }),
    row({ ...at, outcome: "reprogramada" }),
    row({ ...at, outcome: "feriado", holiday_exception: false }),
    row({ ...at, outcome: "feriado", holiday_exception: true }),
    row({ ...at, outcome: "clase_dictada", source_event_type: "alumno_ausente" }), // importado: resultado original «alumno ausente»
  ];
  assert.deepEqual(minutesOf(registrations), [60, 60]);
});

test("una clase reprogramada no se duplica: sólo la clase nueva, ya dictada, suma", () => {
  const original = row({ id: "original", outcome: "reprogramada", scheduled_start_at: "2026-11-03T21:00:00.000Z", scheduled_end_at: "2026-11-03T22:00:00.000Z" });
  const nueva = row({ id: "nueva", scheduled_start_at: "2026-11-05T21:00:00.000Z", scheduled_end_at: "2026-11-05T22:00:00.000Z" });
  assert.deepEqual(minutesOf([original, nueva]), [60]);
});

test("los alumnos de prueba confirmados quedan fuera (como en el Resumen), pero una clase compartida con un alumno real se conserva", () => {
  const registrations = [
    row({ id: "prueba", scheduled_duration_minutes: 60, scheduled_start_at: "2026-11-03T21:00:00.000Z" }),
    row({ id: "compartida", scheduled_duration_minutes: 30, scheduled_start_at: "2026-11-04T21:00:00.000Z" }),
    row({ id: "real", scheduled_duration_minutes: 45, scheduled_start_at: "2026-11-05T21:00:00.000Z" }),
  ];
  const roster = [
    { lesson_registration_id: "prueba", student_id: "t1" },
    { lesson_registration_id: "compartida", student_id: "t1" },
    { lesson_registration_id: "compartida", student_id: "real1" },
    { lesson_registration_id: "real", student_id: "real1" },
  ];
  assert.deepEqual(minutesOf(registrations, "2026-11", new Set(["t1"]), { roster }), [30, 45]);
  assert.deepEqual(minutesOf(registrations, "2026-11", new Set(), { roster }), [60, 30, 45]);
});

test("las notas son las de las clases dictadas (todas las evaluaciones, también las de cada alumno de una grupal); las de clases no dictadas o de prueba no cuentan", () => {
  const registrations = [row({ id: "g", scheduled_duration_minutes: 60 }), row({ id: "c", outcome: "cancelada_tarde" }), row({ id: "t", scheduled_duration_minutes: 60 })];
  const roster = [{ lesson_registration_id: "t", student_id: "t1" }];
  const grades = [{ registrationId: "g", grade: 8 }, { registrationId: "g", grade: 10 }, { registrationId: "c", grade: 1 }, { registrationId: "t", grade: 3 }];
  assert.deepEqual(homeStatsInputsFrom(raw(registrations, { roster, grades }), "2026-11", new Set(["t1"])).grades, [8, 10]);
});

test("clases dictadas sin ninguna duración conocida muestran «Sin datos» (null); si hay algunas con duración, se suman las conocidas; sin clases son 0 h reales", () => {
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [null, null], grades: [] }).hoursTaughtThisMonth, null);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [null, 60], grades: [] }).hoursTaughtThisMonth, 1);
  assert.equal(buildHomeStats({ activeStudents: 0, weekItems: [], monthMinutes: [], grades: [] }).hoursTaughtThisMonth, 0);
});

test("Inicio y «Horas dictadas» del Resumen financiero dan lo mismo con cualquier mezcla de fuentes de duración (distinto de cero)", () => {
  const registrations = [
    row({ actual_duration_minutes: 75, scheduled_start_at: "2026-11-02T15:00:00.000Z" }), // real guardada
    row({ actual_started_at: "2026-11-03T21:00:00.000Z", actual_ended_at: "2026-11-03T22:30:00.000Z", scheduled_start_at: "2026-11-03T21:00:00.000Z" }), // inicio/fin reales
    row({ scheduled_start_at: "2026-11-04T21:00:00.000Z", scheduled_duration_minutes: 45 }), // sólo programada
    row({ scheduled_start_at: "2026-11-05T21:00:00.000Z", scheduled_end_at: "2026-11-05T21:30:00.000Z" }), // programada por inicio/fin
    row({ outcome: "cancelada_tarde", scheduled_start_at: "2026-11-06T21:00:00.000Z", scheduled_duration_minutes: 60 }), // no suma
    row({ scheduled_start_at: "2026-10-30T21:00:00.000Z", scheduled_duration_minutes: 60 }), // octubre: no suma
  ];
  assert.equal(homeHours(registrations), 4);
  assert.equal(financeHours(registrations), 4);
  assert.equal(homeHours(registrations), Math.round(financeHours(registrations) * 10) / 10);
});

test("cableado: la lectura trae las mismas columnas que el Resumen y aplica la regla compartida (no una regla propia)", () => {
  const source = read("lib/repositories/home-stats-inputs.ts");
  assert.match(source, /scheduled_duration_minutes, actual_duration_minutes/);
  assert.match(source, /"lesson_registration_students"/);
  assert.match(read("lib/dashboard/home-stats.ts"), /heldMinutesInRange\(/);
  assert.match(read("lib/reports/annual-activity.ts"), /isClassHeld\(lesson\)/);
  assert.doesNotMatch(source, /counts_as_class/, "la regla de clase dictada es la del resultado, igual que el Resumen");
});
