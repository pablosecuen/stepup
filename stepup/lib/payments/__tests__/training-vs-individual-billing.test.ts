import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { computePerClassBilledAmount } from "../adhoc-billing.ts";
import { resolveStudentBillingPlan } from "../billing-plan.ts";
import { isCoveredByTrainingPlan } from "../training-coverage.ts";
import { isAdhocClassHeld, type AdhocOutcome } from "../../lessons/adhoc.ts";

/** Ejecuta la acción REAL de cobro por clase (su cuerpo), con la misma alumna y dependencias de prueba: así se prueba la decisión de cobro, no sólo su texto. */
function realSync() {
  const source = readFileSync(new URL("../../actions/lesson-registrations.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "syncPerClassChargesForRegistration");
  assert.ok(fn);
  const body = ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("getLessonRegistrationDetail", "listStudents", "resolveStudentBillingPlan", "computePerClassBilledAmount", "syncPerClassCharge", "getCalendarLesson", "getRecurrenceRule", "isCoveredByTrainingPlan", "listStudentIdsWithTrainingCharge", "billingPeriodOfDateKey", "getLocalDateKey", "TIMEZONE", `${body}; return syncPerClassChargesForRegistration;`);
}

const STUDENT = { id: "alumna", billingPlan: { type: "per_class", amount: 27500 }, billingType: "por_clase", price: 27500 };

async function charge(input: { activityKind: "class" | "training"; agreementId: string | null; outcome?: AdhocOutcome; loose?: boolean; monthlyTrainingCharge?: boolean }): Promise<unknown> {
  const outcome = input.outcome ?? "clase_dictada";
  const charges: unknown[] = [];
  const run = realSync()(
    async () => ({ registration: { status: "completed", outcome, activityKind: input.activityKind, calendarLessonId: "clase-1", scheduledStartAt: "2026-10-23T18:00:00.000Z", actualStartedAt: null, createdAt: "2026-10-23T19:00:00.000Z", countsAsClass: isAdhocClassHeld(outcome, false), lateCancellationPolicy: outcome === "cancelada_tarde" ? "cobrar_100" : null, lateCancellationPercentage: null }, participants: [{ studentId: STUDENT.id }] }),
    async () => [STUDENT],
    resolveStudentBillingPlan,
    computePerClassBilledAmount,
    async (_ctx: unknown, _id: string, participants: unknown) => charges.push(participants),
    async () => ({ recurrenceId: input.loose ? null : "serie-1" }),
    async () => ({ trainingBillingAgreementId: input.agreementId }),
    isCoveredByTrainingPlan,
    async (_ctx: unknown, studentIds: string[], period: string) => { assert.equal(period, "2026-10"); return new Set(input.monthlyTrainingCharge ? studentIds : []); },
    (dateKey: string) => dateKey.slice(0, 7),
    (iso: string) => iso.slice(0, 10),
    "America/Argentina/Buenos_Aires",
  );
  await run({}, "registro-1");
  return charges.at(-1);
}

test("A/B: la MISMA alumna paga por clase sus clases individuales y su entrenamiento mensual no genera cobro suelto", async () => {
  assert.deepEqual(await charge({ activityKind: "class", agreementId: null }), [{ studentId: "alumna", amount: 27500 }], "la clase individual conserva su cobro por clase");
  assert.deepEqual(await charge({ activityKind: "training", agreementId: "acuerdo-mensual" }), [{ studentId: "alumna", amount: null }], "sesión de entrenamiento cubierta por el mes: sin cobro suelto (y retira uno viejo sin pagos)");
});

test("C: dos series con planes distintos — una clase (aun con un acuerdo en su regla) nunca se considera cubierta por el entrenamiento, y un entrenamiento SIN acuerdo conserva su cobro", async () => {
  assert.deepEqual(await charge({ activityKind: "class", agreementId: "acuerdo-de-otra-serie" }), [{ studentId: "alumna", amount: 27500 }]);
  assert.deepEqual(await charge({ activityKind: "training", agreementId: null }), [{ studentId: "alumna", amount: 27500 }], "sin plan mensual no se pierde el cobro");
});

test("F: cancelaciones según las reglas originales — la clase individual conserva su política; el entrenamiento cubierto no suma cobro por cancelar", async () => {
  assert.deepEqual(await charge({ activityKind: "class", agreementId: null, outcome: "cancelada_tarde" }), [{ studentId: "alumna", amount: 27500 }], "cancelada tarde cobrando 100 %: igual que la original");
  assert.deepEqual(await charge({ activityKind: "class", agreementId: null, outcome: "cancelada_con_aviso" }), [{ studentId: "alumna", amount: null }]);
  assert.deepEqual(await charge({ activityKind: "training", agreementId: "acuerdo-mensual", outcome: "cancelada_tarde" }), [{ studentId: "alumna", amount: null }]);
});

test("D/E: una sesión de entrenamiento SUELTA (sin serie) de una alumna que tiene la cuota mensual del mes también está cubierta; sin cuota del mes conserva su cobro; guardar de nuevo da lo mismo", async () => {
  const loose = { activityKind: "training", agreementId: null, loose: true } as const;
  assert.deepEqual(await charge({ ...loose, monthlyTrainingCharge: true }), [{ studentId: "alumna", amount: null }], "el caso real: entrenamiento suelto del 23/10 con la cuota de octubre ya cargada");
  assert.deepEqual(await charge({ ...loose, monthlyTrainingCharge: true }), [{ studentId: "alumna", amount: null }], "finalizar/editar/reabrir: mismo resultado, sin duplicar");
  assert.deepEqual(await charge({ ...loose, monthlyTrainingCharge: false }), [{ studentId: "alumna", amount: 27500 }], "sin cuota mensual del mes no se pierde el cobro");
  assert.deepEqual(await charge({ activityKind: "class", agreementId: null, loose: true, monthlyTrainingCharge: true }), [{ studentId: "alumna", amount: 27500 }], "una clase individual NUNCA queda cubierta por la cuota del entrenamiento");
});
