import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isCoveredByTrainingPlan, resolveLooseSessionAgreement, trainingChargeKey, type TrainingAgreementRule } from "../training-coverage.ts";
import { summarizeRegistrationCharge } from "../registration-charge-status.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Un mismo alumno (s) con DOS entrenamientos distintos (X con t, Y con u) y sus clases individuales.
const rule = (id: string, agreementId: string | null, participantIds: string[], overrides: Partial<TrainingAgreementRule> = {}): TrainingAgreementRule => ({ id, activityKind: "training", status: "active", startDate: "2026-09-14", endDate: null, agreementId, participantIds, ...overrides });
const X = rule("serie-x", "acuerdo-x", ["s", "t"]);
const Y = rule("serie-y", "acuerdo-y", ["s", "u"]);

test("una sesión de una serie con acuerdo está cubierta por ESE acuerdo; una clase común, nunca", () => {
  assert.equal(isCoveredByTrainingPlan({ activityKind: "training", seriesAgreementId: "acuerdo-x", studentId: "s" }), true);
  assert.equal(isCoveredByTrainingPlan({ activityKind: "class", seriesAgreementId: "acuerdo-x", studentId: "s" }), false, "una clase individual nunca queda cubierta por un entrenamiento");
  assert.equal(isCoveredByTrainingPlan({ activityKind: "training", seriesAgreementId: null, studentId: "s" }), false, "sin acuerdo identificado no se supone cobertura");
});

test("sesión SUELTA: se asocia sólo al único acuerdo con el MISMO grupo de alumnos; con dos acuerdos posibles o un grupo distinto no se supone nada", () => {
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["t", "s"], dateKey: "2026-10-23", rules: [X, Y] }), "acuerdo-x", "el mismo grupo que X (sin importar el orden)");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "u"], dateKey: "2026-10-23", rules: [X, Y] }), "acuerdo-y");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s"], dateKey: "2026-10-23", rules: [X, Y] }), null, "sólo la alumna: no es ninguno de los dos entrenamientos");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t", "u"], dateKey: "2026-10-23", rules: [X, Y] }), null, "otro grupo");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-10-23", rules: [X, rule("serie-x2", "acuerdo-x2", ["s", "t"])] }), null, "dos acuerdos con el mismo grupo: ambiguo");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-10-23", rules: [rule("serie-x", "acuerdo-x", ["s", "t"], { status: "ended" })] }), null, "un acuerdo terminado no cubre");
  assert.equal(resolveLooseSessionAgreement({ participantIds: ["s", "t"], dateKey: "2026-12-01", rules: [rule("serie-x", "acuerdo-x", ["s", "t"], { endDate: "2026-11-30" })] }), null, "fuera de su vigencia");
});

test("la cuota mensual cubre ESA sesión sólo si es de SU acuerdo y SU período: la cuota de otro entrenamiento del mismo alumno no cubre", () => {
  // La alumna s tiene la cuota del acuerdo X (pagada) este mes, pero NO la del acuerdo Y.
  const keys = new Set([trainingChargeKey("acuerdo-x", "s"), trainingChargeKey("acuerdo-x", "t")]);
  const loose = (agreement: string | null, student: string) => isCoveredByTrainingPlan({ activityKind: "training", seriesAgreementId: null, matchedAgreementId: agreement, studentId: student, trainingChargeKeys: keys });
  assert.equal(loose("acuerdo-x", "s"), true, "sesión suelta de X con la cuota de X");
  assert.equal(loose("acuerdo-y", "s"), false, "sesión suelta de Y: la cuota de X NO la cubre");
  assert.equal(loose("acuerdo-y", "u"), false, "la alumna u no tiene cuota de Y");
  assert.equal(loose(null, "s"), false, "sesión sin acuerdo identificado: conserva su cobro");
  assert.equal(isCoveredByTrainingPlan({ activityKind: "class", seriesAgreementId: null, matchedAgreementId: "acuerdo-x", studentId: "s", trainingChargeKeys: keys }), false, "una clase individual jamás");
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

test("cableado: el cobro por clase usa la cobertura por acuerdo y período y la pantalla del registro muestra el cobro de ESA clase", () => {
  const action = read("lib/actions/lesson-registrations.ts");
  assert.match(action, /listStudentsCoveredByTrainingPlan\(ctx, \{ activityKind: detail\.registration\.activityKind, recurrenceId: calendarLesson\?\.recurrenceId \?\? null,/);
  assert.match(action, /const amount = isCovered\(p\.studentId\) \? 0 : computePerClassBilledAmount\(/);
  assert.match(read("app/(app)/registro/[calendarLessonId]/page.tsx"), /<RegistrationChargeCard lines=\{chargeLines\} coveredByTrainingPlan=\{coveredByTrainingPlan\} \/>/);
  const coverage = read("lib/repositories/training-coverage.ts");
  assert.match(coverage, /eq\("training_billing_agreement_id", matchedAgreementId\)/, "la cuota debe ser de ESE acuerdo");
  assert.match(coverage, /eq\("billing_period", billingPeriodOfDateKey\(dateKey\)\)/, "y de ESE período");
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
