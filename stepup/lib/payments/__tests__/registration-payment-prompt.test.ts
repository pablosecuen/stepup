import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isValidCivilDate, resolvePromptPayment, selectPaymentPrompts, settleAfterRefresh, validatePromptAmount } from "../registration-payment-prompt.ts";

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
  assert.match(ws, /\{paymentPrompts && <ClassPaymentPrompt items=\{paymentPrompts\} classLabel=\{classLabel\} registrationId=\{registration\.id\} onFinished=\{\(\) => router\.push\(afterPromptHref\)\} \/>\}/);
  assert.doesNotMatch(ws.slice(ws.indexOf("async function continueAfterSave"), ws.indexOf("const supportsHomework")), /useEffect/, "no se abre por cargar o recargar la pantalla");
  const prompt = read("components/registro/class-payment-prompt.tsx");
  assert.match(prompt, /chargeId: item\.chargeId \}\)\)/, "el pago va siempre al cobro fijo de esa clase");
  assert.match(prompt, /useDraftOperationId\(`teacherflow:registro:cobro:\$\{item\.chargeId\}`\)/, "misma clave de operación al reintentar: sin duplicar pago ni asignación");
  assert.match(prompt, /clear\(\);\n\s+onNext\(\);/, "la clave se descarta sólo tras un pago confirmado");
  assert.match(prompt, /label="Registrar después"/);
  const action = read("lib/actions/payments.ts");
  assert.match(action, /export async function listRegistrationPaymentPromptsAction/);
  assert.match(read("components/registro/registration-outcome-field.tsx"), /if \(onClosed\) await onClosed\(\);/);
});

test("«Pagó el total» registra el saldo exigible completo con la fecha de hoy, sin importe editable", () => {
  assert.deepEqual(resolvePromptPayment({ mode: "total", amountRaw: "1", paidAt: "2026-01-01", today: "2026-10-27", balance: 36000 }), { amount: 36000, paidAt: "2026-10-27" });
  assert.deepEqual(resolvePromptPayment({ mode: "total", amountRaw: "", paidAt: "", today: "2026-10-27", balance: 36000.5 }), { amount: 36000.5, paidAt: "2026-10-27" }, "centavos exactos");
  assert.ok("error" in resolvePromptPayment({ mode: "total", amountRaw: "", paidAt: "", today: "2026-10-27", balance: 0 }), "sin saldo no se cobra");
});

test("«Pagó una parte» valida contra el saldo real, con interpretación monetaria estricta y la fecha de hoy", () => {
  assert.deepEqual(resolvePromptPayment({ mode: "partial", amountRaw: "12.000,50", paidAt: "2020-01-01", today: "2026-10-27", balance: 36000 }), { amount: 12000.5, paidAt: "2026-10-27" }, "la fecha de un pago parcial siempre es hoy");
  for (const bad of ["", "0", "36.5", "36,000", "abc", "36001"]) assert.ok("error" in resolvePromptPayment({ mode: "partial", amountRaw: bad, paidAt: "", today: "2026-10-27", balance: 36000 }), bad);
});

test("«Ya había pagado» pide una fecha real hasta hoy y un importe hasta el saldo (con pago previo, sólo el saldo restante)", () => {
  const base = { mode: "retroactive" as const, today: "2026-10-27" };
  assert.deepEqual(resolvePromptPayment({ ...base, amountRaw: "20000", paidAt: "2026-10-20", balance: 20000 }), { amount: 20000, paidAt: "2026-10-20" });
  assert.deepEqual(resolvePromptPayment({ ...base, amountRaw: "20000", paidAt: "2026-10-27", balance: 20000 }), { amount: 20000, paidAt: "2026-10-27" }, "hoy es válido");
  assert.ok("error" in resolvePromptPayment({ ...base, amountRaw: "20000", paidAt: "2026-10-28", balance: 20000 }), "una fecha futura se rechaza");
  assert.ok("error" in resolvePromptPayment({ ...base, amountRaw: "20000", paidAt: "", balance: 20000 }));
  assert.ok("error" in resolvePromptPayment({ ...base, amountRaw: "20000", paidAt: "2026-02-31", balance: 20000 }));
  assert.ok("error" in resolvePromptPayment({ ...base, amountRaw: "36000", paidAt: "2026-10-20", balance: 20000 }), "no supera el saldo restante tras un pago previo");
});

test("fechas civiles reales", () => {
  assert.equal(isValidCivilDate("2026-10-27"), true);
  assert.equal(isValidCivilDate("2028-02-29"), true);
  for (const bad of ["", "2026-02-29", "2026-13-01", "27/10/2026", "2026-1-1"]) assert.equal(isValidCivilDate(bad), false, bad);
});

test("si al volver a leer el cobro ya no tiene saldo (pagado desde otro lugar) se considera saldado; si tiene, se muestra lo ya pagado y el saldo restante", () => {
  assert.deepEqual(settleAfterRefresh({ total: 36000 }, undefined), { paid: 36000, balance: 0 });
  assert.deepEqual(settleAfterRefresh({ total: 36000 }, { paid: 10000, balance: 26000 }), { paid: 10000, balance: 26000 });
});

test("estructura del aviso: cinco respuestas separadas, formulario sólo tras elegir, Volver, cierre con advertencia y sin cierres durante un envío", () => {
  const prompt = read("components/registro/class-payment-prompt.tsx");
  for (const label of ["Pagó el total", "Pagó una parte", "Ya había pagado", "Quedó pendiente", "Registrar después"]) assert.match(prompt, new RegExp('label="' + label + '"'), label);
  assert.match(prompt, /Efectivo[\s\S]{0,80}Transferencia[\s\S]{0,80}Otro/, "métodos como botones seleccionables");
  assert.match(prompt, /type="radio"/);
  assert.match(prompt, /Volver/);
  assert.match(prompt, /Confirmar/);
  assert.match(prompt, /Los alumnos que todavía no respondiste quedan con el cobro pendiente/, "advertencia al salir");
  assert.match(prompt, /Seguir registrando/);
  assert.match(prompt, /placement="center"/, "diálogo compacto y centrado");
  assert.match(prompt, /if \(pending \|\| inFlight\.current\) return false;/, "durante un envío no se cierra");
  assert.match(prompt, /if \(inFlight\.current \|\| pending \|\| refreshing/, "sin doble envío");
  assert.match(prompt, /Alumno \$\{position\} de \$\{total\}/);
  const dialog = read("components/ui/dialog.tsx");
  assert.match(dialog, /onBeforeClose\(\) === false/);
  assert.match(read("components/ui/field.tsx"), /type === "date" \? dateInputClass/, "el selector de fecha se limita al ancho del contenedor");
});
