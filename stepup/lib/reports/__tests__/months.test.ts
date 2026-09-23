import { test } from "node:test";
import assert from "node:assert/strict";
import { getStudentMonthsWithClasses, computeSelectedMonthsRange, buildMonthsSummaryLabel } from "../months.ts";

const TODAY = "2026-09-22";

test("getStudentMonthsWithClasses: un mes CON clases reales aparece, un mes SIN clases nunca aparece", () => {
  const months = getStudentMonthsWithClasses(
    [
      { countsAsClass: true, dateKey: "2026-05-10" },
      { countsAsClass: true, dateKey: "2026-05-17" },
      { countsAsClass: false, dateKey: "2026-06-10" }, // cancelada, no cuenta como clase
    ],
    TODAY
  );
  assert.deepEqual(months, ["2026-05"]);
});

test("getStudentMonthsWithClasses: nunca incluye una clase futura", () => {
  const months = getStudentMonthsWithClasses([{ countsAsClass: true, dateKey: "2026-12-01" }], TODAY);
  assert.deepEqual(months, []);
});

test("computeSelectedMonthsRange: período real = primera/última clase de los meses elegidos, nunca 1 al 31 del mes", () => {
  const range = computeSelectedMonthsRange(
    [
      { countsAsClass: true, dateKey: "2026-05-12" },
      { countsAsClass: true, dateKey: "2026-05-28" },
    ],
    ["2026-05"],
    TODAY
  );
  assert.deepEqual(range, { periodStart: "2026-05-12", periodEnd: "2026-05-28", classCount: 2 });
});

test("computeSelectedMonthsRange: selección de meses NO consecutivos combina correctamente ambos rangos", () => {
  const range = computeSelectedMonthsRange(
    [
      { countsAsClass: true, dateKey: "2026-03-05" },
      { countsAsClass: true, dateKey: "2026-06-20" },
    ],
    ["2026-03", "2026-06"],
    TODAY
  );
  assert.deepEqual(range, { periodStart: "2026-03-05", periodEnd: "2026-06-20", classCount: 2 });
});

test("computeSelectedMonthsRange: mes sin clases seleccionado -> null si no hay ninguna clase real en la selección", () => {
  const range = computeSelectedMonthsRange([{ countsAsClass: true, dateKey: "2026-05-12" }], ["2026-06"], TODAY);
  assert.equal(range, null);
});

test("buildMonthsSummaryLabel: un solo mes", () => {
  assert.equal(buildMonthsSummaryLabel(["2026-05"]), "mayo 2026");
});

test("buildMonthsSummaryLabel: meses consecutivos, mismo año", () => {
  assert.equal(buildMonthsSummaryLabel(["2026-05", "2026-06", "2026-07"]), "mayo a julio 2026");
});

test("buildMonthsSummaryLabel: meses NO consecutivos", () => {
  assert.equal(buildMonthsSummaryLabel(["2026-03", "2026-06"]), "marzo 2026 y junio 2026");
});
