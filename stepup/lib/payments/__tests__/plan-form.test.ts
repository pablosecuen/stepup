import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildPlanFromForm, describePlan, initialPlanFormValues, type BillingPlanFormValues } from "../plan-form.ts";
import type { StudentBillingPlan } from "../billing-plan.ts";

const TODAY = "2026-10-28";
const monthly: StudentBillingPlan = { type: "monthly", amount: 50000, dueDay: 10 };
const perClass: StudentBillingPlan = { type: "per_class", amount: 8000 };

function form(over: Partial<BillingPlanFormValues>): BillingPlanFormValues {
  return { type: "per_class", amountText: "8.000", dueWeekday: 1, anchorDate: TODAY, includedClassesText: "8", validFrom: TODAY, validUntil: "", ...over };
}

test("importe exacto: acepta 36.000,50 con centavos, rechaza ambiguo, vacío, cero y negativo", () => {
  assert.deepEqual(buildPlanFromForm(form({ amountText: "36.000,50" }), perClass), { plan: { type: "per_class", amount: 36000.5 } });
  for (const amountText of ["", "0", "-5", "12,5,5", "abc"]) assert.ok("error" in buildPlanFromForm(form({ amountText }), perClass), amountText);
});

test("semanal conserva el día elegido; quincenal exige fecha de referencia válida", () => {
  assert.deepEqual(buildPlanFromForm(form({ type: "weekly", amountText: "12000", dueWeekday: 0 }), perClass), { plan: { type: "weekly", amount: 12000, dueWeekday: 0 } });
  assert.ok("error" in buildPlanFromForm(form({ type: "biweekly", amountText: "20000", anchorDate: "2026-02-31" }), perClass));
  assert.deepEqual(buildPlanFromForm(form({ type: "biweekly", amountText: "20000", anchorDate: "2026-10-12" }), perClass), { plan: { type: "biweekly", amount: 20000, anchorDate: "2026-10-12" } });
});

test("mensual: vence siempre el día 10; el monto de un plan YA mensual no se cambia por acá, pero repetirlo sí es válido", () => {
  assert.deepEqual(buildPlanFromForm(form({ type: "monthly", amountText: "15000" }), perClass), { plan: { type: "monthly", amount: 15000, dueDay: 10 } });
  const rejected = buildPlanFromForm(form({ type: "monthly", amountText: "60000" }), monthly);
  assert.ok("error" in rejected && /Modificar monto mensual/.test(rejected.error));
  assert.deepEqual(buildPlanFromForm(form({ type: "monthly", amountText: "50.000" }), monthly), { plan: { type: "monthly", amount: 50000, dueDay: 10 } });
});

test("paquete: clases enteras > 0, fechas válidas, fin no anterior al inicio; sin fin no agrega validUntil", () => {
  assert.ok("error" in buildPlanFromForm(form({ type: "class_package", amountText: "90000", includedClassesText: "0" }), perClass));
  assert.ok("error" in buildPlanFromForm(form({ type: "class_package", amountText: "90000", includedClassesText: "2,5" }), perClass));
  assert.ok("error" in buildPlanFromForm(form({ type: "class_package", amountText: "90000", validFrom: "2026-10-10", validUntil: "2026-10-01" }), perClass));
  assert.deepEqual(buildPlanFromForm(form({ type: "class_package", amountText: "90000", includedClassesText: "10" }), perClass), { plan: { type: "class_package", amount: 90000, includedClasses: 10, validFrom: TODAY } });
  assert.deepEqual(buildPlanFromForm(form({ type: "class_package", amountText: "90000", includedClassesText: "10", validUntil: "2026-12-31" }), perClass), { plan: { type: "class_package", amount: 90000, includedClasses: 10, validFrom: TODAY, validUntil: "2026-12-31" } });
});

test("sin cargo no pide importe", () => {
  assert.deepEqual(buildPlanFromForm(form({ type: "complimentary", amountText: "" }), monthly), { plan: { type: "complimentary" } });
});

test("al reabrir, el formulario conserva lo que el plan ya tenía", () => {
  const pack: StudentBillingPlan = { type: "class_package", amount: 90000, includedClasses: 12, validFrom: "2026-09-01", validUntil: "2026-12-01" };
  const values = initialPlanFormValues("class_package", pack, TODAY, "90.000");
  assert.equal(values.includedClassesText, "12");
  assert.equal(values.validFrom, "2026-09-01");
  assert.equal(values.validUntil, "2026-12-01");
  assert.equal(initialPlanFormValues("weekly", { type: "weekly", amount: 1, dueWeekday: 4 }, TODAY, "1").dueWeekday, 4);
  assert.equal(initialPlanFormValues("weekly", perClass, TODAY, "1").dueWeekday, 1);
});

test("el resumen del plan nunca queda vacío y muestra el aumento programado de un plan mensual", () => {
  assert.equal(describePlan({ type: "complimentary" }).title, "Sin cargo");
  const lines = describePlan({ type: "monthly", amount: 50000, dueDay: 10, pendingAmount: 60000, pendingAmountEffectiveFrom: "2026-11" }).lines;
  assert.ok(lines.some((line) => line.includes("11/2026")));
});

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("cableado: las acciones de plan y monto se llaman con guardNetwork; «Editar alumno» no lee ni el tipo de facturación ni el precio", () => {
  const card = read("components/students/profile/billing-plan-card.tsx");
  assert.match(card, /guardNetwork\(\(\) => changeBillingPlanAction\(/);
  assert.match(card, /guardNetwork\(\(\) => changeMonthlyAmountAction\(/);
  assert.match(card, /plan\.type === "monthly" && \(\s*<Button[\s\S]*?Modificar monto mensual/);
  const students = read("lib/actions/students.ts");
  const update = students.slice(students.indexOf("export async function updateStudentAction"), students.indexOf("// Cambiar estado"));
  assert.doesNotMatch(update, /billingType|"price"|readMoney/);
  const fields = read("components/students/student-form-fields.tsx");
  assert.match(fields, /defaultValues \? \(/, "al editar, el plan se cambia desde Cobros");
});

test("cableado: la generación de cobros incluye los períodos semanal y quincenal, y el cambio de plan/monto pasa por RPC atómicas", () => {
  const actions = read("lib/actions/payments.ts");
  assert.match(actions, /ensureCurrentPeriodicCharges\(ctx, todayKey\)/);
  const repo = read("lib/repositories/payments.ts");
  assert.match(repo, /rpc\("ensure_periodic_charges"/);
  assert.match(repo, /rpc\("set_student_billing_plan"/);
  assert.match(repo, /rpc\("change_student_monthly_amount"/);
});

test("recorrido del monto «próximo mes»: el plan que deja la base se consume en el período siguiente y no antes (y los cargos semanales/mensuales usan el mismo plan)", async () => {
  const { resolveEffectiveMonthlyAmount } = await import("../billing-plan.ts");
  // Forma EXACTA que escribe change_student_monthly_amount('next_month') (ver supabase/tests/postgres/billing_plans_amounts.cjs).
  const afterRpc = { type: "monthly", amount: 20000, dueDay: 10, pendingAmount: 30000, pendingAmountEffectiveFrom: "2026-11" } as const;
  assert.equal(resolveEffectiveMonthlyAmount(afterRpc, "2026-10"), 20000);
  assert.equal(resolveEffectiveMonthlyAmount(afterRpc, "2026-11"), 30000);
  assert.equal(resolveEffectiveMonthlyAmount(afterRpc, "2027-03"), 30000);
});
