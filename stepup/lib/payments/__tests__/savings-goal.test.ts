import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSavingsGoalProgress, monthsBetweenDateKeys, parseSavingsGoalInput } from "../savings-goal.ts";

test("meses restantes: por mes calendario y nunca menos de 1", () => {
  assert.equal(monthsBetweenDateKeys("2026-10-27", "2027-04-01"), 6);
  assert.equal(monthsBetweenDateKeys("2026-10-27", "2026-10-31"), 1, "mismo mes: 1");
  assert.equal(monthsBetweenDateKeys("2026-10-27", "2026-11-01"), 1);
  assert.equal(monthsBetweenDateKeys("2026-12-15", "2027-01-02"), 1, "cruza el año");
});

test("progreso, reserva mensual y porcentaje sugerido (mismas cuentas que el original)", () => {
  const goal = { enabled: true, targetAmount: 600000, targetDate: "2027-04-15" };
  const progress = computeSavingsGoalProgress({ goal, cumulativeRealTheoreticalSavings: 150000, monthlyCollected: 300000, evaluationDate: "2026-10-27" });
  assert.equal(progress.complete, true);
  assert.equal(progress.progressPercent, 25);
  assert.equal(progress.monthlyReserveNeeded, 75000, "450.000 que faltan en 6 meses");
  assert.equal(progress.suggestedSavingsPercent, 25);
});

test("sin cobros este mes no se sugiere un porcentaje; objetivo ya superado queda en 100 % y sin reserva", () => {
  const goal = { enabled: true, targetAmount: 100000, targetDate: "2027-01-10" };
  assert.equal(computeSavingsGoalProgress({ goal, cumulativeRealTheoreticalSavings: 20000, monthlyCollected: 0, evaluationDate: "2026-10-27" }).suggestedSavingsPercent, 0);
  const done = computeSavingsGoalProgress({ goal, cumulativeRealTheoreticalSavings: 250000, monthlyCollected: 300000, evaluationDate: "2026-10-27" });
  assert.equal(done.progressPercent, 100);
  assert.equal(done.monthlyReserveNeeded, 0);
});

test("el porcentaje sugerido nunca pasa de 100", () => {
  const goal = { enabled: true, targetAmount: 1000000, targetDate: "2026-11-30" };
  assert.equal(computeSavingsGoalProgress({ goal, cumulativeRealTheoreticalSavings: 0, monthlyCollected: 100000, evaluationDate: "2026-10-27" }).suggestedSavingsPercent, 100);
});

test("un objetivo incompleto (sin monto, monto 0 o sin fecha) no muestra progreso", () => {
  for (const goal of [
    { enabled: true, targetAmount: null, targetDate: "2027-01-01" },
    { enabled: true, targetAmount: 0, targetDate: "2027-01-01" },
    { enabled: true, targetAmount: 1000, targetDate: null },
  ]) assert.equal(computeSavingsGoalProgress({ goal, cumulativeRealTheoreticalSavings: 10, monthlyCollected: 100, evaluationDate: "2026-10-27" }).complete, false);
});

test("validación del formulario: interpretación estricta del monto, fecha real y no anterior a hoy; se puede guardar incompleto", () => {
  const today = "2026-10-27";
  assert.deepEqual(parseSavingsGoalInput({ enabled: "on", targetAmount: "36.000,50", targetDate: "2027-03-01" }, today), { ok: true, goal: { enabled: true, targetAmount: 36000.5, targetDate: "2027-03-01" } });
  assert.deepEqual(parseSavingsGoalInput({ enabled: null, targetAmount: "", targetDate: "" }, today), { ok: true, goal: { enabled: false, targetAmount: null, targetDate: null } });
  assert.deepEqual(parseSavingsGoalInput({ enabled: "on", targetAmount: "", targetDate: "" }, today), { ok: true, goal: { enabled: true, targetAmount: null, targetDate: null } }, "activado sin completar es válido");
  for (const bad of ["36.5", "36,000", "abc", "0", "-5"]) assert.equal(parseSavingsGoalInput({ enabled: "on", targetAmount: bad, targetDate: "" }, today).ok, false, bad);
  assert.equal(parseSavingsGoalInput({ enabled: "on", targetAmount: "1000", targetDate: "2026-10-26" }, today).ok, false, "fecha pasada");
  assert.equal(parseSavingsGoalInput({ enabled: "on", targetAmount: "1000", targetDate: "2026-02-31" }, today).ok, false, "fecha inexistente");
  assert.equal(parseSavingsGoalInput({ enabled: "on", targetAmount: "1000", targetDate: "2026-10-27" }, today).ok, true, "hoy es válido");
});

test("regresión de pérdida de datos: guardar los porcentajes 50/30/20 CONSERVA el objetivo de ahorro guardado (antes lo dejaba desactivado y sin monto ni fecha)", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const actions = read("lib/actions/account.ts");
  const start = actions.indexOf("export async function saveBudgetDistributionAction");
  const body = actions.slice(start, actions.indexOf("export async function saveSavingsGoalAction"));
  assert.ok(body.includes("getBudgetDistributionSettings(ctx)"), "lee el objetivo vigente");
  assert.ok(body.includes("savingsGoal: current.savingsGoal"), "lo vuelve a guardar tal cual");
  assert.ok(!body.includes("enabled: false"), "ya no lo pisa con un objetivo vacío");
  // El objetivo, a su vez, conserva los porcentajes; «Aplicar sugerencia» y «Restablecer» conservan el objetivo.
  const goalAction = actions.slice(actions.indexOf("export async function saveSavingsGoalAction"), actions.indexOf("export async function applyBudgetPresetAction"));
  assert.ok(goalAction.includes("distribution: current.distribution"));
  const preset = actions.slice(actions.indexOf("export async function applyBudgetPresetAction"), actions.indexOf("// Sesión activa"));
  assert.ok(preset.includes("savingsGoal: current.savingsGoal"));
  // Cableado de la pantalla.
  assert.ok(read("components/finance/financial-overview-view.tsx").includes("<AnnualProjection annual={data.annual}"));
  assert.ok(read("components/finance/budget-adjust-dialog.tsx").includes("Restablecer 50/30/20"));
});
