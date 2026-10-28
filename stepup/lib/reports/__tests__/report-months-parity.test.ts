// Comparación directa de los meses de un reporte: la web contra el original (ejecutado en el núcleo de referencia) con los mismos datos.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMonthsSummaryLabel as originalLabel, computeSelectedMonthsRange as originalRange, getStudentMonthsWithClasses as originalMonths } from "../../original-core/features/reportes/utils/reportMonths.ts";
import { buildMonthsSummaryLabel, computeSelectedMonthsRange, getStudentMonthsWithClasses } from "../months.ts";

const TODAY = "2026-10-28";
const STUDENT = "alumno-1";
// Misma clase en las dos formas: el original usa SavedLesson (form.date, form.studentIds); la web, el registro (dateKey).
const days: Array<[string, boolean, string]> = [
  ["2026-03-04", true, STUDENT], ["2026-03-20", true, STUDENT], ["2026-04-02", true, STUDENT], ["2026-06-10", true, STUDENT], ["2026-06-11", false, STUDENT], // cancelada
  ["2026-07-01", true, "otro"], // de otro alumno
  ["2026-09-15", true, STUDENT], ["2026-10-28", true, STUDENT], ["2026-10-29", true, STUDENT], // mañana: futura
  ["2025-12-30", true, STUDENT], ["2026-01-05", true, STUDENT],
];
const lessons = days.map(([date, countsAsClass, studentId], index) => ({ id: `l${index}`, countsAsClass, form: { date, studentIds: [studentId] } })) as never[];
const registrations = days.filter(([, , studentId]) => studentId === STUDENT).map(([dateKey, countsAsClass]) => ({ dateKey, countsAsClass }));

test("los meses con clases: mismos meses (el original los ordena del más reciente al más antiguo)", () => {
  const original = originalMonths(lessons, STUDENT, TODAY).map((option) => option.monthKey);
  const web = getStudentMonthsWithClasses(registrations, TODAY);
  assert.deepEqual([...web].sort().reverse(), original);
  assert.ok(!web.includes("2026-07"), "una clase de otro alumno no cuenta");
});

test("el período real del reporte (primera y última clase de los meses elegidos) y la cantidad de clases coinciden", () => {
  for (const selection of [["2026-03"], ["2026-03", "2026-04"], ["2026-06"], ["2026-10"], ["2025-12", "2026-01"], ["2026-03", "2026-10"], ["2026-02"], []]) {
    assert.deepEqual(computeSelectedMonthsRange(registrations, selection, TODAY), originalRange(lessons, STUDENT, selection, TODAY), selection.join(","));
  }
});

test("el título automático coincide: un mes, consecutivos, no consecutivos y de años distintos", () => {
  const selections = [[], ["2026-07"], ["2026-05", "2026-06", "2026-07"], ["2026-03", "2026-06"], ["2026-03", "2026-04", "2026-06"], ["2025-12", "2026-01"], ["2025-11", "2026-02", "2026-03"], ["2026-07", "2026-07"], ["2026-12", "2025-12"]];
  for (const selection of selections) assert.equal(buildMonthsSummaryLabel(selection), originalLabel(selection), selection.join(",") || "(vacío)");
});
