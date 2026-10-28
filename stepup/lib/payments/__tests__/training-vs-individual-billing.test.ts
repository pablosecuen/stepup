import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { computePerClassBilledAmount } from "../adhoc-billing.ts";
import { resolveStudentBillingPlan } from "../billing-plan.ts";
import { isAdhocClassHeld, type AdhocOutcome } from "../../lessons/adhoc.ts";

/** Ejecuta la acción REAL de cobro por clase (su cuerpo), con la misma alumna y dependencias de prueba: así se prueba la decisión de cobro, no sólo su texto. */
function realSync() {
  const source = readFileSync(new URL("../../actions/lesson-registrations.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "syncPerClassChargesForRegistration");
  assert.ok(fn);
  const body = ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("getLessonRegistrationDetail", "listStudents", "resolveStudentBillingPlan", "computePerClassBilledAmount", "syncPerClassCharge", "getCalendarLesson", "listStudentsCoveredByTrainingPlan", `${body}; return syncPerClassChargesForRegistration;`);
}

const STUDENT = { id: "alumna", billingPlan: { type: "per_class", amount: 27500 }, billingType: "por_clase", price: 27500 };

test("clase marcada no cobrable no genera un cargo suelto, aun con cancelación que normalmente cobra", async () => {
  for (const outcome of ["clase_dictada", "cancelada_tarde"] as const) {
    assert.deepEqual((await charge({activityKind:"class",outcome,isBillable:false})).result,[{studentId:"alumna",amount:null}]);
    assert.deepEqual((await charge({activityKind:"class",outcome,isBillable:true})).result,[{studentId:"alumna",amount:27500}]);
  }
});

async function charge(input: { activityKind: "class" | "training"; outcome?: AdhocOutcome; covered?: boolean; isBillable?: boolean }): Promise<{ result: unknown; coverageQueries: unknown[] }> {
  const outcome = input.outcome ?? "clase_dictada";
  const charges: unknown[] = [];
  const coverageQueries: unknown[] = [];
  const run = realSync()(
    async () => ({ registration: { status: "completed", outcome, activityKind: input.activityKind, isBillable: input.isBillable, calendarLessonId: "clase-1", scheduledStartAt: "2026-10-23T18:00:00.000Z", actualStartedAt: null, createdAt: "2026-10-23T19:00:00.000Z", countsAsClass: isAdhocClassHeld(outcome, false), lateCancellationPolicy: outcome === "cancelada_tarde" ? "cobrar_100" : null, lateCancellationPercentage: null }, participants: [{ studentId: STUDENT.id }] }),
    async () => [STUDENT],
    resolveStudentBillingPlan,
    computePerClassBilledAmount,
    async (_ctx: unknown, _id: string, participants: unknown) => charges.push(participants),
    async () => ({ recurrenceId: "serie-1" }),
    async (_ctx: unknown, query: unknown) => {
      coverageQueries.push(query);
      // Como el repositorio real: una clase común nunca está cubierta.
      return new Set(input.covered && (query as { activityKind: string }).activityKind === "training" ? [STUDENT.id] : []);
    },
  );
  await run({}, "registro-1");
  return { result: charges.at(-1), coverageQueries };
}

test("A/B: la MISMA alumna paga por clase sus clases individuales y su entrenamiento cubierto por la cuota mensual no genera cobro suelto", async () => {
  assert.deepEqual((await charge({ activityKind: "class" })).result, [{ studentId: "alumna", amount: 27500 }], "la clase individual conserva su cobro por clase");
  const training = await charge({ activityKind: "training", covered: true });
  assert.deepEqual(training.result, [{ studentId: "alumna", amount: null }], "sesión cubierta: sin cobro suelto (y retira uno viejo sin pagos)");
  assert.deepEqual(training.coverageQueries, [{ activityKind: "training", recurrenceId: "serie-1", participantIds: ["alumna"], sessionAnchorIso: "2026-10-23T18:00:00.000Z" }], "la cobertura se consulta por actividad, serie, alumnos y fecha de la sesión");
});

test("C/D: sin cobertura de SU acuerdo y período (otro entrenamiento del mismo alumno, grupo distinto o sin cuota del mes) la sesión conserva su cobro; guardar de nuevo da lo mismo", async () => {
  assert.deepEqual((await charge({ activityKind: "training", covered: false })).result, [{ studentId: "alumna", amount: 27500 }]);
  assert.deepEqual((await charge({ activityKind: "training", covered: true })).result, [{ studentId: "alumna", amount: null }]);
  assert.deepEqual((await charge({ activityKind: "training", covered: true })).result, [{ studentId: "alumna", amount: null }], "finalizar/editar/reabrir: mismo resultado, sin duplicar");
  assert.deepEqual((await charge({ activityKind: "class", covered: true })).result, [{ studentId: "alumna", amount: 27500 }], "una clase individual conserva su cobro aunque el alumno tenga cuota de entrenamiento");
});

test("F: cancelaciones según las reglas originales — la clase individual conserva su política; el entrenamiento cubierto no suma cobro por cancelar", async () => {
  assert.deepEqual((await charge({ activityKind: "class", outcome: "cancelada_tarde" })).result, [{ studentId: "alumna", amount: 27500 }], "cancelada tarde cobrando 100 %: igual que la original");
  assert.deepEqual((await charge({ activityKind: "class", outcome: "cancelada_con_aviso" })).result, [{ studentId: "alumna", amount: null }]);
  assert.deepEqual((await charge({ activityKind: "training", outcome: "cancelada_tarde", covered: true })).result, [{ studentId: "alumna", amount: null }]);
});
