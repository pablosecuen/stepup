import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { computePerClassBilledAmount } from "../adhoc-billing.ts";
import { resolveStudentBillingPlan } from "../billing-plan.ts";
import { isAdhocClassHeld, type AdhocOutcome } from "../../lessons/adhoc.ts";
import type { ParticipantBillingDecision } from "../training-coverage.ts";

/** Ejecuta la acción REAL de cobro por clase (su cuerpo), con dependencias de prueba: así se prueba la decisión de cobro, no sólo su texto. */
function realSync() {
  const source = readFileSync(new URL("../../actions/lesson-registrations.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "syncPerClassChargesForRegistration");
  assert.ok(fn);
  const body = ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function("getLessonRegistrationDetail", "listStudents", "resolveStudentBillingPlan", "computePerClassBilledAmount", "syncPerClassCharge", "getCalendarLesson", "resolveRegistrationBilling", `${body}; return syncPerClassChargesForRegistration;`);
}

const OWN: ParticipantBillingDecision = { kind: "own_regime", source: "class" };
const COVERED_X: ParticipantBillingDecision = { kind: "covered", agreementId: "acuerdo-x", source: "series" };
const PENDING: ParticipantBillingDecision = { kind: "needs_association", candidateAgreementIds: ["acuerdo-x", "acuerdo-y"], suggestedAgreementId: null };

const perClass = (id: string, amount: number) => ({ id, billingPlan: { type: "per_class", amount }, billingType: "por_clase", price: amount });
const STUDENT = perClass("alumna", 27500);

interface ChargeInput {
  activityKind: "class" | "training";
  outcome?: AdhocOutcome;
  isBillable?: boolean;
  students?: Array<ReturnType<typeof perClass> | { id: string; billingPlan: unknown; billingType: string; price: number }>;
  decisions?: Record<string, ParticipantBillingDecision>;
}

async function charge(input: ChargeInput): Promise<{ result: unknown; calls: unknown[]; billingQueries: unknown[] }> {
  const outcome = input.outcome ?? "clase_dictada";
  const students = input.students ?? [STUDENT];
  const calls: unknown[] = [];
  const billingQueries: unknown[] = [];
  const run = realSync()(
    async () => ({ registration: { status: "completed", outcome, activityKind: input.activityKind, isBillable: input.isBillable, calendarLessonId: "clase-1", scheduledStartAt: "2026-10-23T18:00:00.000Z", actualStartedAt: null, createdAt: "2026-10-23T19:00:00.000Z", countsAsClass: isAdhocClassHeld(outcome, false), lateCancellationPolicy: outcome === "cancelada_tarde" ? "cobrar_100" : null, lateCancellationPercentage: null }, participants: students.map((s) => ({ studentId: s.id })) }),
    async () => students,
    resolveStudentBillingPlan,
    computePerClassBilledAmount,
    async (_ctx: unknown, _id: string, participants: unknown) => calls.push(participants),
    async () => ({ recurrenceId: "serie-1" }),
    async (_ctx: unknown, query: { participantIds: string[] }) => {
      billingQueries.push(query);
      return { decisions: new Map(query.participantIds.map((id) => [id, input.decisions?.[id] ?? OWN])) };
    },
  );
  await run({}, "registro-1");
  return { result: calls.at(-1), calls, billingQueries };
}

test("clase marcada no cobrable (excepción histórica) no genera un cargo suelto, aun con cancelación que normalmente cobra", async () => {
  for (const outcome of ["clase_dictada", "cancelada_tarde"] as const) {
    assert.deepEqual((await charge({ activityKind: "class", outcome, isBillable: false })).result, [{ studentId: "alumna", amount: null }]);
    assert.deepEqual((await charge({ activityKind: "class", outcome, isBillable: true })).result, [{ studentId: "alumna", amount: 27500 }]);
  }
  // Sin el control en pantalla, un registro nuevo no trae la bandera: el valor guardado manda y el valor por defecto (cobrable) no cambia nada.
  assert.deepEqual((await charge({ activityKind: "class" })).result, [{ studentId: "alumna", amount: 27500 }]);
});

test("A/B: la MISMA alumna paga por clase sus clases individuales y su entrenamiento cubierto por la cuota mensual de SU acuerdo no genera cobro suelto", async () => {
  assert.deepEqual((await charge({ activityKind: "class" })).result, [{ studentId: "alumna", amount: 27500 }], "la clase individual conserva su cobro por clase");
  const training = await charge({ activityKind: "training", decisions: { alumna: COVERED_X } });
  assert.deepEqual(training.result, [{ studentId: "alumna", amount: null }], "sesión cubierta: sin cobro suelto (y retira uno viejo sin pagos)");
  assert.deepEqual(training.billingQueries, [{ registrationId: "registro-1", activityKind: "training", recurrenceId: "serie-1", calendarLessonId: "clase-1", participantIds: ["alumna"], sessionAnchorIso: "2026-10-23T18:00:00.000Z" }], "la cobertura se consulta por registro, actividad, serie, clase, participantes y fecha de la sesión");
});

test("C/D: sin cobertura de SU acuerdo (sin acuerdo que lo incluya, o decisión explícita de cobrarla como clase suelta) la sesión conserva su cobro; guardar de nuevo da lo mismo", async () => {
  const own: ParticipantBillingDecision = { kind: "own_regime", source: "explicit" };
  assert.deepEqual((await charge({ activityKind: "training", decisions: { alumna: own } })).result, [{ studentId: "alumna", amount: 27500 }]);
  const first = await charge({ activityKind: "training", decisions: { alumna: COVERED_X } });
  const second = await charge({ activityKind: "training", decisions: { alumna: COVERED_X } });
  assert.deepEqual(first.result, [{ studentId: "alumna", amount: null }]);
  assert.deepEqual(second.result, first.result, "finalizar/editar/reabrir: mismo resultado, sin duplicar");
});

test("falta una asociación: ni se genera ni se retira ningún cobro (no se inventa cobertura ni se cobra por otra actividad)", async () => {
  const pending = await charge({ activityKind: "training", decisions: { alumna: PENDING } });
  assert.equal(pending.calls.length, 0, "la sincronización ni siquiera se invoca: nada que escribir");
  const again = await charge({ activityKind: "training", decisions: { alumna: PENDING } });
  assert.equal(again.calls.length, 0, "repetir el guardado tampoco escribe");
});

test("grupo: cada participante se resuelve por SU acuerdo — cubierto, clase suelta, pendiente de asociar y otro plan conviven sin aplicarse unos a otros", async () => {
  const students = [perClass("cubierta", 20000), perClass("suelta", 30000), perClass("pendiente", 25000), { id: "mensual", billingPlan: { type: "monthly", amount: 80000, dueDay: 10 }, billingType: "mensual", price: 80000 }];
  const group = await charge({ activityKind: "training", students, decisions: { cubierta: COVERED_X, suelta: { kind: "own_regime", source: "explicit" }, pendiente: PENDING, mensual: COVERED_X } });
  assert.deepEqual(group.result, [{ studentId: "cubierta", amount: null }, { studentId: "suelta", amount: 30000 }], "sólo los participantes por clase RESUELTOS; el pendiente y el plan mensual no se tocan");
  const sameGroup = await charge({ activityKind: "training", students, decisions: { cubierta: COVERED_X, suelta: { kind: "own_regime", source: "explicit" }, pendiente: PENDING, mensual: COVERED_X } });
  assert.deepEqual(sameGroup.result, group.result, "idempotente");
  // Cada alumna usa SU tarifa: el plan de una nunca se aplica a otra.
  const rates = await charge({ activityKind: "training", students: [perClass("a", 11000), perClass("b", 22000)], decisions: { a: OWN, b: OWN } });
  assert.deepEqual(rates.result, [{ studentId: "a", amount: 11000 }, { studentId: "b", amount: 22000 }]);
});

test("F: cancelaciones según las reglas originales — la clase individual conserva su política; el entrenamiento cubierto no suma cobro por cancelar", async () => {
  assert.deepEqual((await charge({ activityKind: "class", outcome: "cancelada_tarde" })).result, [{ studentId: "alumna", amount: 27500 }], "cancelada tarde cobrando 100 %: igual que la original");
  assert.deepEqual((await charge({ activityKind: "class", outcome: "cancelada_con_aviso" })).result, [{ studentId: "alumna", amount: null }]);
  assert.deepEqual((await charge({ activityKind: "training", outcome: "cancelada_tarde", decisions: { alumna: COVERED_X } })).result, [{ studentId: "alumna", amount: null }]);
  assert.deepEqual((await charge({ activityKind: "training", outcome: "cancelada_tarde", decisions: { alumna: { kind: "own_regime", source: "explicit" } } })).result, [{ studentId: "alumna", amount: 27500 }], "una sesión cobrada como clase suelta conserva la política de cancelación");
});
