import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatMoneyForInput, formatMoneyTyping, groupThousands, normalizeMoneyOnBlur, parseMoneyInput } from "../money-input.ts";
import { formatMoney } from "../number-format.ts";

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
  assert.equal(formatMoneyForInput(36000), "36.000");
  assert.equal(formatMoneyForInput(36000.5), "36.000,50");
  assert.equal(formatMoneyForInput(3), "3");
  assert.equal(formatMoneyForInput(null), "");
  assert.equal(formatMoneyForInput(Number.NaN), "");
});

test("cableado: ningún campo de importe es un <input type=number> ni usa Number() sobre el texto; todos pasan por parseMoneyInput", () => {
  const student = read("components/students/first-month-fields.tsx");
  assert.match(student, /<MoneyInput id="price" name="price"/);
  assert.doesNotMatch(student, /id="price"[^>]*type="number"/);
  assert.match(read("lib/actions/students.ts"), /function readMoney\(formData: FormData, key: string\): number \{[\s\S]*parseMoneyInput\(/);
  assert.equal([...read("lib/actions/students.ts").matchAll(/price: readMoney\(formData, "price"\)/g)].length, 1, "sólo el alta del alumno: «Editar alumno» ya no cambia el precio (se cambia desde Cobros, por el plan)");
  const planDialog = read("components/students/profile/billing-plan-card.tsx");
  assert.ok(/parseMoneyInput\(amountText\)/.test(planDialog) && !/Number\(amountText\)/.test(planDialog), "el diálogo del monto mensual parsea con parseMoneyInput");
  assert.match(read("lib/payments/plan-form.ts"), /parseMoneyInput\(values\.amountText\)/);
  const charge = read("components/payments/charge-actions.tsx");
  assert.match(charge, /parseMoneyInput\(amount\)/);
  assert.doesNotMatch(charge, /Number\(amount\)/);
  assert.match(read("components/registro/class-payment-prompt.tsx"), /<MoneyInput id=\{`\$\{uid\}-amount`\}/);
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

/** Tipea `secuencia` tecla por tecla en un campo vacío, como lo haría la profesora, y devuelve lo que muestra al final. */
function typeKeys(sequence: string): string {
  let text = "";
  let caret = 0;
  for (const key of sequence) {
    const result = formatMoneyTyping(text, text.slice(0, caret) + key + text.slice(caret), caret + 1);
    text = result.text;
    caret = result.caret;
  }
  return text;
}

test("los importes se ven con separador de miles al escribir: 3, 36, 360, 3.600, 36.000, 360.000, 3.600.000, 36.000,50", () => {
  const expected: [string, string][] = [["3", "3"], ["36", "36"], ["360", "360"], ["3600", "3.600"], ["36000", "36.000"], ["360000", "360.000"], ["3600000", "3.600.000"], ["36000,50", "36.000,50"]];
  for (const [typed, shown] of expected) {
    assert.equal(typeKeys(typed), shown, typed);
    assert.equal(amount(shown), amount(typed), "el valor numérico no cambia por el formato");
  }
  assert.equal(amount("360.000"), 360000);
  assert.equal(amount("3.600.000"), 3600000);
  assert.equal(amount("36.000,50"), 36000.5);
});

test("los mismos importes se muestran con miles y sin ceros de más en toda lectura (formatMoney)", () => {
  assert.equal(groupThousands("3600000"), "3.600.000");
  const normalize = (text: string) => text.replace(/\s/g, " ");
  assert.equal(normalize(formatMoney(3)), "$ 3");
  assert.equal(normalize(formatMoney(36)), "$ 36");
  assert.equal(normalize(formatMoney(360)), "$ 360");
  assert.equal(normalize(formatMoney(3600)), "$ 3.600");
  assert.equal(normalize(formatMoney(36000)), "$ 36.000");
  assert.equal(normalize(formatMoney(360000)), "$ 360.000");
  assert.equal(normalize(formatMoney(3600000)), "$ 3.600.000");
  assert.equal(normalize(formatMoney(36000.5)), "$ 36.000,50");
});

test("escribir, borrar y corregir en el medio no salta el cursor ni cambia los dígitos", () => {
  // Corregir en el medio: insertar un 0 tras «360» de «360.000» → «3.600.000» con el cursor entre el 360 y el 0 siguiente.
  assert.deepEqual(formatMoneyTyping("360.000", "3600.000", 4), { text: "3.600.000", caret: 5 });
  // Borrar un dígito del medio: «1.234.567» sin el 4 → «123.567» con el cursor tras el 3.
  assert.deepEqual(formatMoneyTyping("1.234.567", "1.23.567", 5), { text: "123.567", caret: 3 });
  // Borrar un dígito del último grupo reagrupa: «360.000» sin un cero → «36.000».
  assert.deepEqual(formatMoneyTyping("360.000", "360.00", 6), { text: "36.000", caret: 6 });
  // Borrar todo deja el campo vacío (puede quedar vacío mientras se edita).
  assert.deepEqual(formatMoneyTyping("3", "", 0), { text: "", caret: 0 });
  // Un cero a la izquierda no se acumula, y «,5» es «0,5».
  assert.equal(typeKeys("05"), "5");
  assert.equal(typeKeys(",5"), "0,5");
  // Cursor al final: sigue al final.
  assert.deepEqual(formatMoneyTyping("36.00", "36.000", 6), { text: "36.000", caret: 6 });
});

test("pegar: acepta un importe bien formado (con $ y espacios) y NO reinterpreta lo ambiguo", () => {
  assert.equal(formatMoneyTyping("", "1234567", 7).text, "1.234.567");
  assert.equal(formatMoneyTyping("", "$ 36.000", 8).text, "36.000");
  assert.equal(formatMoneyTyping("", "36000,50", 8).text, "36.000,50");
  for (const pasted of ["36.5", "1,234.56", "36,000", "1000.000", "12,5,5", "abc"]) {
    const result = formatMoneyTyping("", pasted, pasted.length);
    assert.equal(result.text, pasted, `«${pasted}» queda como se pegó`);
    assert.ok(!("amount" in parseMoneyInput(result.text)), `«${pasted}» lo rechaza la validación estricta`);
  }
});

test("un punto escrito a mano no se convierte en miles ni en decimal por adivinanza", () => {
  assert.equal(typeKeys("36.5"), "36.5");
  assert.equal(amount(typeKeys("36.5")), "ambiguo");
  assert.equal(typeKeys("36.50"), "36.50");
  // Sí se puede escribir con puntos bien puestos: «36.000» y «1.234.567».
  assert.equal(typeKeys("36.000"), "36.000");
  assert.equal(typeKeys("1.234.567"), "1.234.567");
});

test("centavos: se conservan mientras se escriben; una tercera cifra o una letra no entran", () => {
  assert.equal(typeKeys("36000,5"), "36.000,5");
  assert.equal(typeKeys("36000,50"), "36.000,50");
  assert.equal(typeKeys("36000,505"), "36.000,50", "la tercera cifra decimal se ignora");
  assert.equal(typeKeys("36a000"), "36.000", "una letra no entra");
  assert.equal(typeKeys("3,6,0"), "3,60", "una segunda coma no entra");
  assert.equal(amount("36.000,50"), 36000.5);
  assert.equal(normalizeMoneyOnBlur("36.000,"), "36.000");
  assert.equal(normalizeMoneyOnBlur("36.000,5"), "36.000,5");
});

test("guardar y reabrir un importe no lo cambia: texto con formato → número → texto con formato", () => {
  for (const value of [3, 36, 360, 3600, 36000, 360000, 3600000, 36000.5, 80000.25, 1234567.25]) {
    const shown = formatMoneyForInput(value);
    assert.equal(amount(shown), value, String(value));
    assert.equal(formatMoneyForInput(amount(shown) as number), shown, "reabrirlo muestra el mismo texto");
    assert.equal(typeKeys(shown), shown, "volver a escribirlo no lo altera");
  }
});

test("cableado: todos los campos de importe usan el campo compartido (miles al escribir, teclado decimal, 16 px) y ninguno hace su propio formato", () => {
  const field = read("components/ui/money-input.tsx");
  assert.match(field, /inputMode="decimal"/);
  assert.match(field, /formatMoneyTyping\(/);
  assert.match(field, /<TextInput/, "usa el mismo campo base: 46 px de alto y letra de 16 px");
  const users = [
    "components/calendar/activity-dialog.tsx",
    "components/calendar/inline-student.tsx",
    "components/finance/savings-goal-form.tsx",
    "components/payments/charge-actions.tsx",
    "components/payments/training-billing-config.tsx",
    "components/registro/class-payment-prompt.tsx",
    "components/students/first-month-fields.tsx",
    "components/students/profile/billing-plan-card.tsx",
  ];
  for (const path of users) {
    const source = read(path);
    assert.ok(source.includes("<MoneyInput"), `${path} usa <MoneyInput>`);
    assert.doesNotMatch(source, /inputMode=["{']decimal/, `${path} no arma su propio campo decimal`);
  }
  // Documentos, teléfonos, edades y cantidades de clases NO usan el campo de importes.
  for (const path of ["components/students/student-form-fields.tsx", "components/auth/email-code-form.tsx"]) assert.ok(!read(path).includes("MoneyInput"), path);
});
