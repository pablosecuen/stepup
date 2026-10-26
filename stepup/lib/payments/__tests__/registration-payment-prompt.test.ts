import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectPaymentPrompts, validatePromptAmount } from "../registration-payment-prompt.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const status = (chargeId: string, balance: number, state: "pendiente" | "parcial" | "pagada" = "pendiente") => ({ chargeId, balance, state });

test("al completar el registro se pide el pago de cada cobro de la clase con saldo; una clase ya pagada o sin saldo no pide nada", () => {
  const statuses = [status("a", 1000), status("b", 400, "parcial"), status("c", 0, "pagada"), status("d", 0)];
  assert.deepEqual(selectPaymentPrompts(statuses, { firstCompletion: true, knownChargeIds: new Set() }).map((s) => s.chargeId), ["a", "b"]);
  assert.deepEqual(selectPaymentPrompts([], { firstCompletion: true, knownChargeIds: new Set() }), [], "sin cobro (entrenamiento cubierto, sin importe exigible) no hay aviso");
});

test("al editar un registro finalizado sólo se pregunta por los cobros NUEVOS: reabrir o recargar nunca repite el aviso", () => {
  const statuses = [status("viejo", 1000), status("nuevo", 1000)];
  assert.deepEqual(selectPaymentPrompts(statuses, { firstCompletion: false, knownChargeIds: new Set(["viejo"]) }).map((s) => s.chargeId), ["nuevo"]);
  assert.deepEqual(selectPaymentPrompts(statuses, { firstCompletion: false, knownChargeIds: new Set(["viejo", "nuevo"]) }), []);
});

test("el importe a pagar debe ser positivo y no superar el saldo (con pago parcial, sólo el saldo restante)", () => {
  assert.deepEqual(validatePromptAmount("1000", 1000), { amount: 1000 });
  assert.deepEqual(validatePromptAmount("250", 600), { amount: 250 });
  for (const bad of ["", "0", "-5", "abc"]) assert.ok("error" in validatePromptAmount(bad, 1000), bad);
  assert.ok("error" in validatePromptAmount("601", 600), "más que el saldo restante");
});

test("cableado: el aviso se abre solo al guardar (primer finalizado, edición y cierre por resultado), paga SÓLO el cobro de esa clase con clave estable y se navega recién al cerrarlo", () => {
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.match(ws, /await continueAfterSave\(true, returnHref \?\? "\/registro"\);/, "primer finalizado");
  assert.match(ws, /await continueAfterSave\(false, returnHref \?\? "\/registro"\);/, "edición de un registro finalizado: sólo cobros nuevos");
  assert.match(ws, /onClosed=\{\(\) => continueAfterSave\(true, "\/registro"\)\}/, "cierre por resultado (p. ej. cancelada tarde que cobra)");
  assert.match(ws, /\{paymentPrompts && <ClassPaymentPrompt items=\{paymentPrompts\} classLabel=\{classLabel\} onFinished=\{\(\) => router\.push\(afterPromptHref\)\} \/>\}/);
  assert.doesNotMatch(ws.slice(ws.indexOf("async function continueAfterSave"), ws.indexOf("const supportsHomework")), /useEffect/, "no se abre por cargar o recargar la pantalla");
  const prompt = read("components/registro/class-payment-prompt.tsx");
  assert.match(prompt, /chargeId: item\.chargeId \}\)\)/, "el pago va siempre al cobro fijo de esa clase");
  assert.match(prompt, /useDraftOperationId\(`teacherflow:registro:cobro:\$\{item\.chargeId\}`\)/, "misma clave de operación al reintentar: sin duplicar pago ni asignación");
  assert.match(prompt, /clear\(\);\n\s+onNext\(\);/, "la clave se descarta sólo tras un pago confirmado");
  assert.match(prompt, /Más tarde/);
  const action = read("lib/actions/payments.ts");
  assert.match(action, /export async function listRegistrationPaymentPromptsAction/);
  assert.match(read("components/registro/registration-outcome-field.tsx"), /if \(onClosed\) await onClosed\(\);/);
});
