import { test } from "node:test";
import assert from "node:assert/strict";
import { selectManageableRecurrenceSeries, type RuleForLineage } from "../lineage.ts";

const BA = "America/Argentina/Buenos_Aires";
const NOW = "2026-09-20T12:00:00.000Z";

function rule(overrides: Partial<RuleForLineage> & { recurrenceId: string }): RuleForLineage {
  return {
    status: "active",
    endDate: null,
    timezone: BA,
    supersedesRecurrenceId: null,
    effectiveFromDate: null,
    ...overrides,
  };
}

test("selectManageableRecurrenceSeries: dos series SIN identidad de linaje (ambas supersedesRecurrenceId null) nunca se agrupan sólo por compartir null", () => {
  const a = rule({ recurrenceId: "r-a" });
  const b = rule({ recurrenceId: "r-b" });
  const result = selectManageableRecurrenceSeries([a, b], NOW);
  assert.equal(result.length, 2, "dos series reales e independientes, nunca fusionadas");
});

test("selectManageableRecurrenceSeries: un split 'esta y las siguientes' (original truncada + sucesora) cuenta como UNA sola serie vigente", () => {
  const original = rule({ recurrenceId: "r-original", status: "ended", endDate: "2026-09-13" });
  const successor = rule({ recurrenceId: "r-successor", supersedesRecurrenceId: "r-original", effectiveFromDate: "2026-09-14" });
  const result = selectManageableRecurrenceSeries([original, successor], NOW);
  assert.equal(result.length, 1, "un solo linaje: original+sucesora es la MISMA serie");
  assert.equal(result[0].recurrenceId, "r-successor", "se muestra el tramo vigente (la sucesora), no el histórico");
});

test("selectManageableRecurrenceSeries: cadena de DOS splits sucesivos sigue siendo un único linaje", () => {
  const first = rule({ recurrenceId: "r1", status: "ended", endDate: "2026-08-01" });
  const second = rule({ recurrenceId: "r2", status: "ended", endDate: "2026-09-01", supersedesRecurrenceId: "r1", effectiveFromDate: "2026-08-02" });
  const third = rule({ recurrenceId: "r3", supersedesRecurrenceId: "r2", effectiveFromDate: "2026-09-02" });
  const result = selectManageableRecurrenceSeries([first, second, third], NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].recurrenceId, "r3", "el tramo más reciente de la cadena");
});

test("selectManageableRecurrenceSeries: varias series del mismo alumno (mismo studentId, sin relación de linaje) cuentan como series DISTINTAS", () => {
  // studentId ni siquiera es un campo de RuleForLineage — nunca puede influir en el agrupado.
  const seriesA = rule({ recurrenceId: "r-alumno-a" });
  const seriesB = rule({ recurrenceId: "r-alumno-b" });
  const result = selectManageableRecurrenceSeries([seriesA, seriesB], NOW);
  assert.equal(result.length, 2, "dos entrenamientos/series del mismo alumno nunca se fusionan en una tarjeta");
});

test("selectManageableRecurrenceSeries: una serie 'ended' sin sucesora nunca aparece como vigente", () => {
  const ended = rule({ recurrenceId: "r-ended", status: "ended", endDate: "2026-01-01" });
  const result = selectManageableRecurrenceSeries([ended], NOW);
  assert.equal(result.length, 0);
});

test("selectManageableRecurrenceSeries: una serie 'paused' sigue apareciendo como vigente (pausada, no finalizada)", () => {
  const paused = rule({ recurrenceId: "r-paused", status: "paused" });
  const result = selectManageableRecurrenceSeries([paused], NOW);
  assert.equal(result.length, 1);
});

test("selectManageableRecurrenceSeries: endDate futura todavía cuenta como vigente; endDate ya pasada no", () => {
  const stillRunning = rule({ recurrenceId: "r-future-end", endDate: "2099-01-01" });
  const alreadyOver = rule({ recurrenceId: "r-past-end", endDate: "2020-01-01" });
  const result = selectManageableRecurrenceSeries([stillRunning, alreadyOver], NOW);
  assert.deepEqual(result.map((r) => r.recurrenceId), ["r-future-end"]);
});
