import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_DISTRIBUTION_FIELD,
  BUDGET_PERCENT_FIELDS,
  groupBudgetFields,
  groupedSelection,
  isDistributionSelected,
  toggleDistribution,
} from "../budget-distribution-fields.ts";

const WEB = { needs_percent: 50, wants_percent: 30, savings_percent: 20, savings_goal_enabled: true, savings_goal_target_amount: 9000, savings_goal_target_date: null };
const BACKUP = { needs_percent: 40, wants_percent: 40, savings_percent: 20, savings_goal_enabled: false, savings_goal_target_amount: null, savings_goal_target_date: null };

test("groupBudgetFields: los tres porcentajes se muestran como UNA decisión «50/30/20»", () => {
  const grouped = groupBudgetFields(WEB, BACKUP);
  assert.deepEqual(grouped[BUDGET_DISTRIBUTION_FIELD], { web: "50/30/20", backup: "40/40/20" });
  for (const field of BUDGET_PERCENT_FIELDS) assert.equal(field in grouped, false, `${field} ya no aparece suelto`);
  assert.deepEqual(grouped.savings_goal_enabled, { web: true, backup: false });
});

test("groupBudgetFields: si los porcentajes son iguales no hay decisión de distribución", () => {
  const grouped = groupBudgetFields({ ...WEB }, { ...BACKUP, needs_percent: 50, wants_percent: 30 });
  assert.equal(BUDGET_DISTRIBUTION_FIELD in grouped, false);
  assert.ok("savings_goal_enabled" in grouped);
});

test("toggleDistribution: marca y desmarca los tres porcentajes JUNTOS (nunca uno solo) y no toca el resto", () => {
  const on = toggleDistribution(new Set(["savings_goal_enabled"]));
  assert.deepEqual([...on].sort(), ["needs_percent", "savings_goal_enabled", "savings_percent", "wants_percent"]);
  assert.equal(isDistributionSelected(on), true);
  const off = toggleDistribution(on);
  assert.deepEqual([...off], ["savings_goal_enabled"]);
  assert.equal(isDistributionSelected(off), false);
});

test("toggleDistribution: con sólo uno o dos porcentajes marcados, el siguiente toque completa los tres", () => {
  assert.equal(isDistributionSelected(new Set(["needs_percent"])), false);
  assert.deepEqual([...toggleDistribution(new Set(["needs_percent", "wants_percent"]))].sort(), [...BUDGET_PERCENT_FIELDS].sort());
});

test("toggleDistribution no modifica el conjunto original", () => {
  const original = new Set(["needs_percent"]);
  toggleDistribution(original);
  assert.deepEqual([...original], ["needs_percent"]);
});

test("groupedSelection: lo marcado se ve como la decisión agrupada y los porcentajes sueltos desaparecen", () => {
  assert.deepEqual([...groupedSelection(new Set(BUDGET_PERCENT_FIELDS))], [BUDGET_DISTRIBUTION_FIELD]);
  assert.deepEqual([...groupedSelection(new Set(["needs_percent"]))], []);
  assert.deepEqual([...groupedSelection(new Set([...BUDGET_PERCENT_FIELDS, "savings_goal_enabled"]))].sort(), [BUDGET_DISTRIBUTION_FIELD, "savings_goal_enabled"].sort());
});
