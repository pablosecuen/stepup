import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveLooseSessionAgreement, type TrainingAgreementRule } from "../training-coverage.ts";
import { summarizeRegistrationCharge } from "../registration-charge-status.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Un mismo alumno (s) con DOS entrenamientos distintos (X con t, Y con u) y sus clases individuales.
const rule = (id: string, agreementId: string | null, participantIds: string[], overrides: Partial<TrainingAgreementRule> = {}): TrainingAgreementRule => ({ id, activityKind: "training", status: "active", startDate: "2026-09-14", endDate: null, agreementId, participantIds, ...overrides });
const X = rule("serie-x", "acuerdo-x", ["s", "t"]);
const Y = rule("serie-y", "acuerdo-y", ["s", "u"]);

test("sesión SUELTA: la ÚNICA sugerencia posible es el acuerdo con el MISMO grupo de alumnos (sólo preselecciona, nunca asocia); con dos acuerdos posibles o un grupo distinto no se sugiere nada", () => {
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["t", "s"], dateKey: "2026-10-23", rules: [X, Y] }), "acuerdo-x", "el mismo grupo que X (sin importar el orden)");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "u"], dateKey: "2026-10-23", rules: [X, Y] }), "acuerdo-y");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s"], dateKey: "2026-10-23", rules: [X, Y] }), null, "sólo la alumna: no es ninguno de los dos entrenamientos");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t", "u"], dateKey: "2026-10-23", rules: [X, Y] }), null, "otro grupo");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-10-23", rules: [X, rule("serie-x2", "acuerdo-x2", ["s", "t"])] }), null, "dos acuerdos con el mismo grupo: ambiguo");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-10-23", rules: [rule("serie-x", "acuerdo-x", ["s", "t"], { status: "ended" })] }), null, "un acuerdo terminado no se sugiere");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-12-01", rules: [rule("serie-x", "acuerdo-x", ["s", "t"], { endDate: "2026-11-30" })] }), null, "fuera de su vigencia");
});

test("situación real del cobro de UNA clase: pagada, parcial o pendiente con sus pagos; los pagos anulados y los de otra clase no cuentan", () => {
  const payments = new Map([["p1", { paidAt: "2026-10-20", voidedAt: null }], ["p2", { paidAt: "2026-10-21", voidedAt: null }], ["anulado", { paidAt: "2026-10-22", voidedAt: "2026-10-23T00:00:00Z" }]]);
  const pendiente = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [], payments });
  assert.deepEqual([pendiente.state, pendiente.paid, pendiente.balance], ["pendiente", 0, 27500]);
  const parcial = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [{ paymentId: "p1", amount: 10000 }, { paymentId: "anulado", amount: 17500 }], payments });
  assert.deepEqual([parcial.state, parcial.paid, parcial.balance], ["parcial", 10000, 17500], "el pago anulado no cuenta");
  const pagada = summarizeRegistrationCharge({ originalAmount: 27500, allocations: [{ paymentId: "p2", amount: 17500 }, { paymentId: "p1", amount: 10000 }], payments });
  assert.deepEqual([pagada.state, pagada.balance], ["pagada", 0]);
  assert.deepEqual(pagada.payments.map((p) => p.paidAt), ["2026-10-20", "2026-10-21"], "del más viejo al más nuevo");
});

test("cableado: el cobro por clase se resuelve por participante y acuerdo explícito y la pantalla del registro muestra el cobro de ESA clase", () => {
  const action = read("lib/actions/lesson-registrations.ts");
  assert.match(action, /resolveRegistrationBilling\(ctx, \{ registrationId, activityKind: detail\.registration\.activityKind, recurrenceId: calendarLesson\?\.recurrenceId \?\? null,/);
  assert.match(action, /const amount = detail\.registration\.isBillable === false \|\| decision\.kind === "covered" \? 0 : computePerClassBilledAmount\(/);
  assert.match(read("app/(app)/registro/[calendarLessonId]/page.tsx"), /<RegistrationChargeCard lines=\{chargeLines\} \/>/);
  const coverage = read("lib/repositories/training-coverage.ts");
  assert.match(coverage, /eq\("charge_type", "entrenamiento"\)/, "la pertenencia sale de las cuotas de entrenamiento");
  assert.match(coverage, /charge\.billing_period === period \|\| charge\.training_billing_agreement_id === sessionAgreementId/, "de ESE período o del acuerdo de la propia sesión");
  const repo = read("lib/repositories/payments.ts");
  const fn = repo.slice(repo.indexOf("export async function listChargeStatusForRegistration"), repo.indexOf("export async function listAllAllocations"));
  assert.match(fn, /eq\("saved_lesson_id", registrationId\)\.eq\("charge_type", "por_clase"\)\.is\("voided_at", null\)/, "sólo el cobro por clase de ESE registro");
});

test("pago de ESTA clase desde el registro: sólo su cobro (chargeId fijo), sin anular desde allí, y la pantalla se actualiza", () => {
  const card = read("components/registro/registration-charge-card.tsx");
  assert.match(card, /<ChargeActions chargeId=\{line\.chargeId\} studentId=\{line\.studentId\} balance=\{line\.balance\} allowVoid=\{false\}/);
  assert.match(card, /line\.balance > 0 &&/, "sin saldo no hay botón de pago");
  const actions = read("components/payments/charge-actions.tsx");
  assert.match(actions, /allowVoid && mode === "void"/);
  assert.match(actions, /\n        chargeId,\n      \}\)\)/, "el pago va siempre al cargo fijo");
  assert.match(read("app/(app)/registro/[calendarLessonId]/page.tsx"), /chargeId: status\.chargeId, studentId: status\.studentId/);
  assert.match(read("lib/actions/payments.ts"), /revalidatePath\("\/registro\/\[calendarLessonId\]", "page"\)/);
});
