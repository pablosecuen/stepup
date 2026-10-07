import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** R6.1 — el asistente muestra los niveles repetidos y trata los tres porcentajes del 50/30/20 como UNA decisión. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const WIZARD = "components/backup/import-wizard.tsx";

test("niveles repetidos: se informan con una frase por nivel y sin pedir ninguna decisión", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /preview\.customLevels\.duplicates\.length > 0/);
  assert.match(wizard, /describeCustomLevelDuplicate\(d\)/);
  assert.match(wizard, /No hace falta que decidas nada/);
  // Es información, no una decisión: no hay casillas ni opciones para los niveles repetidos.
  const block = wizard.slice(wizard.indexOf("Niveles que no se agregan"), wizard.indexOf("Niveles que no se agregan") + 700);
  assert.doesNotMatch(block, /type="(checkbox|radio)"/);
});

test("niveles repetidos: no cuentan como «cosas para decidir» de la pantalla", () => {
  const wizard = code(WIZARD);
  const toDecide = wizard.slice(wizard.indexOf("const toDecide"), wizard.indexOf("const sourceLabel"));
  assert.doesNotMatch(toDecide, /customLevels\.duplicates/);
  assert.match(toDecide, /customLevels\.conflicts\.length/);
});

test("presupuesto: los tres porcentajes se muestran y se marcan como UNA decisión (nunca por separado)", () => {
  const wizard = code(WIZARD);
  assert.match(wizard, /from "@\/lib\/backup\/budget-distribution-fields"/);
  assert.match(wizard, /groupBudgetFields\(state\.web, state\.backup\)/);
  assert.match(wizard, /groupedSelection\(selected\)/);
  assert.match(wizard, /tableName === BUDGET_TABLE && field === BUDGET_DISTRIBUTION_FIELD/);
  assert.match(wizard, /toggleDistribution\(/);
});

test("presupuesto: la decisión agrupada se traduce a los tres campos reales antes de enviarse (la base valida la suma 100)", () => {
  const helper = code("lib/backup/budget-distribution-fields.ts");
  assert.match(helper, /BUDGET_PERCENT_FIELDS = \["needs_percent", "wants_percent", "savings_percent"\]/);
  // «distribution» sólo existe en pantalla: nunca viaja como campo hacia el servidor.
  const wizard = code(WIZARD);
  assert.doesNotMatch(wizard, /fields:\s*\[[^\]]*BUDGET_DISTRIBUTION_FIELD/);
});
