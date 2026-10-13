import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BILLING_CURRENCY, PLAN_CODES, getPlan, isPlanCode, listActivePlans, listPublicPlans, validateAgainstCatalog } from "../plans.ts";
import { minorToProviderDecimal, providerAmountToMinor } from "../money.ts";
import { EFFECTIVE_FEE_PER_100_000, PROVIDER_FEE_PERCENT_PUBLISHED, PROVIDER_FEE_VAT_PERCENT, estimateNet } from "../commission.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("el catálogo tiene exactamente los cuatro planes acordados, con código, precio, intervalo y período de acceso", () => {
  assert.deepEqual([...PLAN_CODES], ["tf_monthly_ars_v1", "tf_quarterly_ars_v1", "tf_semiannual_ars_v1", "tf_annual_ars_v1"]);
  const expected = [
    ["tf_monthly_ars_v1", "Mensual", 2_490_000, 1, "1m"],
    ["tf_quarterly_ars_v1", "Trimestral", 6_990_000, 3, "3m"],
    ["tf_semiannual_ars_v1", "Semestral", 13_390_000, 6, "6m"],
    ["tf_annual_ars_v1", "Anual", 24_900_000, 12, "1y"],
  ] as const;
  for (const [code, name, amountMinor, months, providerInterval] of expected) {
    const plan = getPlan(code);
    assert.ok(plan, code);
    assert.equal(plan.name, name);
    assert.equal(plan.currency, "ARS");
    assert.equal(BILLING_CURRENCY, "ARS");
    assert.equal(plan.amountMinor, amountMinor);
    assert.deepEqual(plan.interval, { unit: "month", count: months });
    assert.equal(plan.monthsOfAccess, months);
    assert.equal(plan.providerInterval, providerInterval);
    assert.equal(plan.active, true);
    assert.equal(plan.priceVersion, 1);
  }
  assert.equal(listActivePlans().length, 4);
});

test("los precios en pesos son $24.900, $69.900, $133.900 y $249.000 (importes enteros en centavos, sin decimales flotantes)", () => {
  assert.deepEqual(listPublicPlans().map((plan) => plan.amountPesos), [24_900, 69_900, 133_900, 249_000]);
  for (const plan of listActivePlans()) assert.ok(Number.isSafeInteger(plan.amountMinor));
});

test("el catálogo es inmutable y rechaza cualquier código que no sea suyo", () => {
  const plan = getPlan("tf_monthly_ars_v1")!;
  assert.throws(() => {
    (plan as { amountMinor: number }).amountMinor = 1;
  }, TypeError);
  for (const bad of ["", "tf_monthly_ars_v2", "TF_MONTHLY_ARS_V1", "__proto__", "constructor", null, undefined, 1, {}, ["tf_monthly_ars_v1"]]) {
    assert.equal(getPlan(bad), null, String(bad));
    assert.equal(isPlanCode(bad), false);
  }
});

test("validateAgainstCatalog rechaza importe, moneda o plan manipulados (aunque la diferencia sea de un centavo)", () => {
  const ok = validateAgainstCatalog({ planCode: "tf_annual_ars_v1", amountMinor: 24_900_000, currency: "ARS" });
  assert.equal(ok.ok, true);
  const cases: Array<[unknown, unknown, unknown, string]> = [
    ["tf_annual_ars_v1", 24_899_999, "ARS", "amount_mismatch"],
    ["tf_annual_ars_v1", 24_900_001, "ARS", "amount_mismatch"],
    ["tf_annual_ars_v1", 2_490_000, "ARS", "amount_mismatch"], // el importe de OTRO plan
    ["tf_annual_ars_v1", "24900000", "ARS", "amount_mismatch"],
    ["tf_annual_ars_v1", 24_900_000.5, "ARS", "amount_mismatch"],
    ["tf_annual_ars_v1", Number.NaN, "ARS", "amount_mismatch"],
    ["tf_annual_ars_v1", 24_900_000, "USD", "currency_mismatch"],
    ["tf_annual_ars_v1", 24_900_000, "TEST", "currency_mismatch"],
    ["tf_annual_ars_v1", 24_900_000, "ars", "currency_mismatch"],
    ["tf_free_ars_v1", 0, "ARS", "unknown_plan"],
    [undefined, 24_900_000, "ARS", "unknown_plan"],
  ];
  for (const [planCode, amountMinor, currency, reason] of cases) {
    const result = validateAgainstCatalog({ planCode, amountMinor, currency });
    assert.deepEqual(result.ok ? null : result.reason, reason, `${String(planCode)} ${String(amountMinor)} ${String(currency)}`);
  }
});

test("conversión de importes con aritmética entera: nunca x * 100 en coma flotante", () => {
  assert.equal(minorToProviderDecimal(2_490_000), "24900.00");
  assert.equal(minorToProviderDecimal(24_900_000), "249000.00");
  assert.equal(minorToProviderDecimal(1999), "19.99");
  assert.equal(minorToProviderDecimal(5), "0.05");
  assert.equal(providerAmountToMinor(24900), 2_490_000);
  assert.equal(providerAmountToMinor("24900.00"), 2_490_000);
  assert.equal(providerAmountToMinor(19.99), 1999); // 19.99 * 100 = 1998.9999999999998 en coma flotante
  assert.equal(providerAmountToMinor("19.9"), 1990);
  for (const bad of [-1, "1.234", "abc", "", Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, "1e5", "0x10", "12345678901234"]) assert.equal(providerAmountToMinor(bad), null, String(bad));
  assert.throws(() => minorToProviderDecimal(-1), RangeError);
  assert.throws(() => minorToProviderDecimal(1.5), RangeError);
});

test("el costo estimado del proveedor es 3,9 % + 21 % de IVA = 4,719 %, y los cuatro netos coinciden con el documento", () => {
  assert.equal(PROVIDER_FEE_PERCENT_PUBLISHED, 3.9);
  assert.equal(PROVIDER_FEE_VAT_PERCENT, 21);
  assert.equal(EFFECTIVE_FEE_PER_100_000, 4_719);
  assert.equal(Math.round(PROVIDER_FEE_PERCENT_PUBLISHED * (1 + PROVIDER_FEE_VAT_PERCENT / 100) * 1000), 4_719);
  const expected: Array<[number, number]> = [
    [2_490_000, 2_372_497], // $ 24.900 → $ 23.724,97
    [6_990_000, 6_660_142], // $ 69.900 → $ 66.601,42
    [13_390_000, 12_758_126], // $ 133.900 → $ 127.581,26
    [24_900_000, 23_724_969], // $ 249.000 → $ 237.249,69
  ];
  for (const [gross, net] of expected) {
    const estimate = estimateNet(gross);
    assert.equal(estimate.netMinor, net, String(gross));
    assert.equal(estimate.feeMinor + estimate.netMinor, gross);
  }
  for (const plan of listActivePlans()) assert.ok(expected.some(([gross]) => gross === plan.amountMinor));
  assert.throws(() => estimateNet(-1), RangeError);
});

test("el espejo SQL del catálogo (billing_plans) coincide EXACTAMENTE con lib/billing/plans.ts (código, importe, intervalo, versión)", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/20261014100000_m1_billing_core.sql"), "utf8");
  const rows = [...sql.matchAll(/\('(tf_[a-z]+_ars_v\d+)',\s*'([^']+)',\s*'ARS',\s*(\d+),\s*(\d+),\s*(\d+),\s*'([^']+)',\s*(true|false),\s*(\d+)\)/g)];
  assert.equal(rows.length, PLAN_CODES.length);
  for (const [, code, name, amount, interval, access, providerInterval, active, version] of rows) {
    const plan = getPlan(code);
    assert.ok(plan, code);
    assert.equal(plan.name, name);
    assert.equal(plan.amountMinor, Number(amount));
    assert.equal(plan.interval.count, Number(interval));
    assert.equal(plan.monthsOfAccess, Number(access));
    assert.equal(plan.providerInterval, providerInterval);
    assert.equal(plan.active, active === "true");
    assert.equal(plan.priceVersion, Number(version));
  }
});
