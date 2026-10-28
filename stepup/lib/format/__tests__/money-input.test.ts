import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMoneyForInput, parseMoneyInput } from "../money-input.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const amount = (raw: string) => {
  const result = parseMoneyInput(raw);
  return "amount" in result ? result.amount : `${result.reason}`;
};

test("formatos admitidos: dígitos, miles con punto, decimales con coma, «$» y espacios", () => {
  assert.equal(amount("36000"), 36000);
  assert.equal(amount("36.000"), 36000, "el caso que fallaba: antes se leía como 36");
  assert.equal(amount("1.234.567"), 1234567);
  assert.equal(amount("36000,50"), 36000.5);
  assert.equal(amount("36.000,5"), 36000.5);
  assert.equal(amount("0,50"), 0.5);
  assert.equal(amount("$ 36.000"), 36000);
  assert.equal(amount("  27500  "), 27500);
  assert.equal(amount("1000"), 1000);
  assert.equal(amount("0"), 0);
});

test("vacíos e inválidos se rechazan sin inventar un valor", () => {
  for (const raw of ["", "   ", "$", "abc", "-5", "1e3", "36.000.00", "36 000x", "12,5,5", ",50", ".500", "9999999999999"]) {
    const result = parseMoneyInput(raw);
    assert.ok("error" in result, `«${raw}» debe rechazarse`);
  }
  assert.equal(amount(""), "vacio");
  assert.equal(amount("abc"), "invalido");
  assert.equal(amount(null as unknown as string), "vacio");
});

test("lo ambiguo se rechaza en vez de elegir una lectura (nunca se acepta parcialmente ni se cambia el valor en silencio)", () => {
  for (const raw of ["36.5", "36.50", "36,000", "1,234.56", "12,345,678", "1000.000", "36.0000", "36000,000"]) assert.equal(amount(raw), "ambiguo", raw);
  const result = parseMoneyInput("36.5");
  assert.ok("error" in result && /punto de miles o decimales/.test(result.error));
});

test("un importe guardado vuelve a escribirse en el campo sin cambiar de valor (ida y vuelta)", () => {
  for (const value of [36000, 27500, 1000, 36000.5, 0.5, 1234567.25, 80000]) assert.equal(amount(formatMoneyForInput(value)), value, String(value));
  assert.equal(formatMoneyForInput(36000), "36000");
  assert.equal(formatMoneyForInput(36000.5), "36000,50");
  assert.equal(formatMoneyForInput(null), "");
  assert.equal(formatMoneyForInput(Number.NaN), "");
});

test("cableado: ningún campo de importe es un <input type=number> ni usa Number() sobre el texto; todos pasan por parseMoneyInput", () => {
  const student = read("components/students/first-month-fields.tsx");
  assert.match(student, /id="price" name="price" type="text" inputMode="decimal"/);
  assert.doesNotMatch(student, /id="price"[^>]*type="number"/);
  assert.match(read("lib/actions/students.ts"), /function readMoney\(formData: FormData, key: string\): number \{[\s\S]*parseMoneyInput\(/);
  assert.equal([...read("lib/actions/students.ts").matchAll(/price: readMoney\(formData, "price"\)/g)].length, 1, "sólo el alta del alumno: «Editar alumno» ya no cambia el precio (se cambia desde Cobros, por el plan)");
  const planDialog = read("components/students/profile/billing-plan-card.tsx");
  assert.ok(/parseMoneyInput\(amountText\)/.test(planDialog) && !/Number\(amountText\)/.test(planDialog), "el diálogo del monto mensual parsea con parseMoneyInput");
  assert.match(read("lib/payments/plan-form.ts"), /parseMoneyInput\(values\.amountText\)/);
  const charge = read("components/payments/charge-actions.tsx");
  assert.match(charge, /parseMoneyInput\(amount\)/);
  assert.doesNotMatch(charge, /Number\(amount\)/);
  assert.match(read("components/registro/class-payment-prompt.tsx"), /inputMode="decimal"/);
  assert.match(read("lib/payments/registration-payment-prompt.ts"), /parseMoneyInput\(raw\)/);
  const training = read("components/payments/training-billing-config.tsx");
  assert.equal([...training.matchAll(/parseMoneyInput\(monthlyFee\)/g)].length, 2, "alta y cambio de la cuota de entrenamiento");
  assert.doesNotMatch(training, /Number\(monthlyFee\)/);
});

test("el cobro de una clase dictada es EXACTAMENTE la tarifa del alumno, con sus centavos; un porcentaje se redondea a pesos como en la app original", async () => {
  const { computePerClassBilledAmount } = await import("../../payments/adhoc-billing.ts");
  const held = { outcome: "clase_dictada" as const, isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null };
  for (const price of [36000, 27500.5, 1000, 1234567.25, 0.5, 99.99]) assert.equal(computePerClassBilledAmount({ perClassAmount: price, ...held }), price, String(price));
  assert.equal(computePerClassBilledAmount({ perClassAmount: 99, outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 33 }), 33, "porcentaje: pesos enteros, igual que la original");
  assert.equal(computePerClassBilledAmount({ perClassAmount: 36000, outcome: "alumno_ausente", isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }), 0);
});
