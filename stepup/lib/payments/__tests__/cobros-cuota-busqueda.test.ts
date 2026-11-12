import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildPerStudentRows, trainingAgreementIdOf, trainingFeeContext, type PerStudentInput } from "../per-student-overview.ts";
import { matchesStudentSearch } from "../../students/search.ts";
import type { PaymentChargeRecord } from "../../repositories/payments-mapping.ts";

/** 11/11/2026: «Editar cuota» abre la cuota del entrenamiento correcto, el Centro de cobros busca mientras se escribe y la migración del plan JSON null está preparada. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

let seq = 0;
const charge = (studentId: string, overrides: Partial<PaymentChargeRecord>): PaymentChargeRecord => ({
  id: `c-${++seq}`, studentId, chargeType: "mensual", originalAmount: 100000, dueDate: "2026-11-10", billingPeriod: "2026-11", savedLessonId: null, packageId: null, trainingBillingAgreementId: null, trainingSeriesName: null, calendarLessonId: null, createdAt: "2026-11-01T00:00:00Z", voidedAt: null, voidReason: null, ...overrides,
});
const agreement = (id: string, monthlyFee: number, pending: { fee: number; from: string } | null = null) => ({ id, monthlyFee, pendingMonthlyFee: pending?.fee ?? null, pendingMonthlyFeeEffectiveFrom: pending?.from ?? null, startPeriod: "2026-09" });

test("Emma: clases individuales y DOS entrenamientos distintos — cada concepto tiene SU acuerdo y SU cuota; el plan y las clases sueltas no tienen cuota que editar", () => {
  const input = {
    students: [{ id: "emma", name: "Emma", status: "activo", billingPlan: { type: "per_class", amount: 20000 }, billingType: "por_clase", price: 20000 }],
    charges: [
      charge("emma", { chargeType: "entrenamiento", originalAmount: 60000, trainingBillingAgreementId: "agr-lunes", trainingSeriesName: "Lunes" }),
      charge("emma", { chargeType: "entrenamiento", originalAmount: 80000, trainingBillingAgreementId: "agr-jueves", trainingSeriesName: "Jueves", billingPeriod: "2026-11" }),
      charge("emma", { chargeType: "por_clase", originalAmount: 20000 }),
      charge("emma", { chargeType: "entrenamiento", originalAmount: 5000, trainingBillingAgreementId: null }),
    ],
    payments: [], allocations: [],
    agreements: [agreement("agr-lunes", 60000), agreement("agr-jueves", 80000, { fee: 90000, from: "2026-12" })],
    currentPeriod: "2026-11", todayDateKey: "2026-11-11",
  } as unknown as PerStudentInput;
  const [row] = buildPerStudentRows(input);
  const fees = row.concepts.map((concept) => [concept.kind, trainingAgreementIdOf(concept), trainingFeeContext(concept)?.currentFee ?? null]);
  assert.deepEqual(fees.filter((entry) => entry[0] === "training").map((entry) => entry.slice(1)), [["agr-lunes", 60000], ["agr-jueves", 80000], [null, null]], "cada entrenamiento: su acuerdo; sin acuerdo vinculado no hay cuota que editar");
  assert.equal(fees.find((entry) => entry[0] === "plan")?.[1], null, "el plan de clases individuales no es una cuota de entrenamiento");
  const jueves = row.concepts.find((concept) => trainingAgreementIdOf(concept) === "agr-jueves");
  assert.deepEqual(trainingFeeContext(jueves!), { agreementId: "agr-jueves", currentFee: 80000, upcoming: { amount: 90000, effectiveFrom: "2026-12" } }, "muestra la cuota vigente y la ya programada del MISMO acuerdo");
});

test("«Editar cuota» ya no termina en la lista de Series: abre el diálogo del acuerdo en Cobros, conservando búsqueda, filtros y posición (no hay navegación)", () => {
  const view = read("components/payments/per-student-view.tsx");
  assert.doesNotMatch(view, /\/calendario\/series/);
  assert.match(view, /onSelect: \(\) => onEditTraining\(\{ \.\.\.fee, studentName: row\.name, conceptLabel: conceptShortLabel\(concept, trainingCount\) \}\)/);
  assert.match(view, /agreementId=\{trainingEdit\.agreementId\}/);
  assert.match(view, /setTrainingEdit\(null\)/, "cancelar o guardar cierra el diálogo y deja la pantalla como estaba");
  const menu = read("components/payments/per-student-menu.tsx");
  assert.match(menu, /item\.href \? \(/, "una opción con destino sigue siendo un enlace");
  assert.match(menu, /item\.onSelect\?\.\(\)/);
  const config = read("components/payments/training-billing-config.tsx");
  assert.match(config, /open: controlledOpen, onOpenChange/);
  assert.match(config, /editTrainingBillingFeeAction\(\{ agreementId, pendingMonthlyFee: fee, pendingMonthlyFeeEffectiveFrom: effectiveFrom \}\)/, "la edición sigue siendo la del acuerdo (próximo período)");
});

test("Centro de cobros: buscador con lupa, mientras se escribe, con el motor compartido de Alumnos (parciales, mayúsculas, tildes) sobre TODAS las obligaciones, y al limpiar vuelve la lista completa", () => {
  const view = read("components/payments/collections-view.tsx");
  assert.match(view, /MagnifyingGlassIcon/);
  assert.match(view, /type="search"/);
  assert.match(view, /import \{ matchesStudentSearch \} from "@\/lib\/students\/search"/, "mismo motor que Alumnos");
  assert.match(view, /query === "" \? entries : entries\.filter\(\(entry\) => matchesStudentSearch\(entry\.studentName, query\)\)/, "sobre todas las obligaciones ya autorizadas (no hay paginación) y vacío = lista completa");
  assert.doesNotMatch(view.replace(/\/\/[^\n]*/g, ""), /Aplicar|fetch\(/, "sin Enter ni «Aplicar»");
  assert.match(view, /event\.key === "Escape" && text !== ""/);
  assert.match(view, /aria-label="Borrar búsqueda"/);
  // el motor: parciales, tildes y mayúsculas
  assert.ok(matchesStudentSearch("María José Fernández", "MARIA JOSE"));
  assert.ok(matchesStudentSearch("Sofía Riviere", "sofi"));
  assert.ok(matchesStudentSearch("Camila Ríos", "rios"));
  assert.ok(!matchesStudentSearch("Camila Ríos", "zzzz"));
  // «Por alumno» ya busca igual (verificado): mismo motor y sin envío
  const perStudent = read("lib/payments/per-student-overview.ts");
  assert.match(perStudent, /matchesStudentSearch\(row\.name, text\)/);
});

test("migración 20261111100000: el plan JSON null se resuelve de forma explícita, sin tocar filas, y está preparada (la aplica Joaquín con su aprobación)", () => {
  const dir = join(ROOT, "supabase/migrations");
  const file = readdirSync(dir).find((name) => name.startsWith("20261111100000_"));
  assert.ok(file, "existe la migración nueva");
  const sql = read(`supabase/migrations/${file}`);
  assert.match(sql, /create or replace function public\.effective_student_billing_plan\(p_plan jsonb, p_billing_type text, p_price numeric\)/);
  assert.match(sql, /jsonb_typeof\(p_plan\) = 'null'/, "el JSON null se trata como «sin plan»");
  assert.match(sql, /formato no reconocido/, "un valor escalar no reconocido se rechaza con un mensaje claro");
  for (const fn of ["change_student_monthly_amount", "set_student_billing_plan", "_apply_first_month_situation", "reactivate_student_with_billing"]) assert.match(sql, new RegExp(`function public\\.${fn}`), fn);
  assert.doesNotMatch(sql, /update public\.students\s+set billing_plan\s*=\s*(null|nullif)|alter table|drop /i, "no normaliza datos masivamente ni cambia el esquema");
  const old = read("supabase/migrations/20261028100000_billing_plans_and_amounts.sql");
  assert.match(old, /v_plan := coalesce\(/, "la migración histórica no se editó");
});

test("Inicio: «0 h enseñadas» salía de leer sólo actual_duration_minutes; la web guarda inicio y fin reales", () => {
  assert.match(read("lib/reports/registered-lessons.ts"), /export function lessonMinutesOrNull\(/);
  assert.match(read("lib/repositories/home-stats-inputs.ts"), /actual_started_at, actual_ended_at/);
});
