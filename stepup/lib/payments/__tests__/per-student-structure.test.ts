import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveScreen } from "../../nav/screens.ts";

/**
 * Cobros › Por alumno (29/10/2026, presentación compacta 30/10/2026): pestaña de CONSULTA dentro de Cobros. Estas pruebas fijan que sólo lee, que no crea un segundo mecanismo para editar
 * tarifas, que es UNA tabla de tres columnas, que usa el esqueleto y la carga compartidos y que conserva la pestaña, el filtro y la posición al volver.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PAGE = "app/(app)/cobros/por-alumno/page.tsx";
const VIEW = "components/payments/per-student-view.tsx";

test("la página sólo LEE: ni Server Actions, ni el generador de cobros, ni escrituras; todo con el contexto autenticado de la cuenta", () => {
  const page = code(PAGE);
  assert.doesNotMatch(page, /ChargeGenerationTrigger|@\/lib\/actions\/|\.(insert|update|upsert|delete|rpc)\(|ensure[A-Z]|syncPerClass|registerPayment|voidPayment|voidCharge/);
  assert.match(page, /requireAuthenticatedDbContext\(\)/);
  for (const reader of ["listStudents(ctx)", "listAllCharges(ctx)", "listAllPayments(ctx)", "listAllAllocations(ctx)", "listTrainingBillingAgreements(ctx)", "loadExcludedStudentIds(ctx)"]) assert.ok(page.includes(reader), reader);
  assert.match(page, /withoutExcludedStudents\(allStudents, excludedStudentIds\)/, "mismo criterio que la lista de Alumnos con los alumnos de prueba excluidos");
  assert.match(page, /export const dynamic = "force-dynamic"/);
  const builder = code("lib/payments/per-student-overview.ts");
  assert.doesNotMatch(builder, /supabase|fetch\(|await |async |from "@\/lib\/(actions|db)/, "el cálculo es puro");
});

test("no hay un segundo mecanismo de edición de tarifas: el menú «⋯» lleva al circuito existente y la vista no importa acciones", () => {
  const view = code(VIEW);
  assert.doesNotMatch(view, /@\/lib\/actions\/|changeBillingPlanAction|changeMonthlyAmountAction|editTrainingBillingFee|BillingPlanCard|TrainingBillingConfigButton|<Dialog|useTransition/);
  assert.ok(view.includes("/cobros/alumnos/${studentId}?tab=cobros"), "Ver detalle: la ficha de cobros del alumno");
  assert.ok(view.includes("#plan-${studentId}"), "Editar plan: la tarjeta «Plan de cobro» de esa ficha");
  assert.ok(view.includes('href: "/calendario/series"'), "Editar cuota de entrenamiento: donde ya vive (Series)");
  assert.ok(code("components/students/profile/billing-plan-card.tsx").includes("id={`plan-${studentId}`}"), "el ancla existe en la ficha");
  const menu = code("components/payments/per-student-menu.tsx");
  assert.ok(menu.includes("aria-label={`Acciones de ${label}`}"));
  assert.doesNotMatch(menu, /@\/lib\/actions\//);
});

test("la pestaña está en la navegación de Cobros, es una pantalla del registro de carga y tiene su esqueleto de tabla y su loading", () => {
  assert.match(code("components/payments/payments-section-nav.tsx"), /key: "students", href: "\/cobros\/por-alumno", label: "Por alumno"/);
  const screen = resolveScreen("/cobros/por-alumno");
  assert.equal(screen?.key, "por-alumno");
  assert.equal(screen?.title, "Cobros");
  assert.equal(resolveScreen("/cobros")?.key, "cobros", "el Centro de cobros sigue siendo su propia pantalla");
  assert.ok(existsSync(join(ROOT, "app/(app)/cobros/por-alumno/loading.tsx")));
  assert.match(code("app/(app)/cobros/por-alumno/loading.tsx"), /<DestinationSkeleton fallbackPath="\/cobros\/por-alumno" \/>/);
  const skeleton = code("components/nav/screen-skeleton.tsx");
  assert.match(skeleton, /case "por-alumno":\s*return <PorAlumnoBody/);
  assert.match(skeleton, /PER_STUDENT_COLGROUP[\s\S]*PER_STUDENT_GROUP_CLASS[\s\S]*PER_STUDENT_TD_CLASS/, "el esqueleto usa las mismas columnas y celdas que la tabla real");
});

test("tres columnas exactas en este orden — NOMBRE · FECHA DE PAGO · COBRO — en UNA tabla real con columnas compartidas (más el menú, sin encabezado)", () => {
  const view = code(VIEW);
  const head = view.slice(view.indexOf("<thead>"), view.indexOf("</thead>"));
  const labels = [...head.matchAll(/>\s*(Nombre|Fecha de pago|Cobro)\s*</g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Nombre", "Fecha de pago", "Cobro"]);
  assert.match(view, /<table className=\{PER_STUDENT_TABLE_CLASS\}/);
  assert.match(view, /<colgroup>/);
  assert.match(head, /text-right`\}>\s*Cobro/, "el importe se alinea a la derecha bajo su encabezado");
  assert.match(code("components/payments/per-student-layout.ts"), /table-fixed/);
  for (const forbidden of ["Saldo pendiente", "Sin saldo pendiente", "cobros abiertos", "cobro abierto", "conceptos de cobro", "Cada uno con su tarifa", "Pago sin concepto", "Situación inicial declarada"]) {
    assert.ok(!view.includes(forbidden), forbidden + " ya no se muestra");
  }
  assert.doesNotMatch(view, /subtitle=/, "sin párrafo explicativo bajo el título");
  assert.doesNotMatch(view, /pendingBalance|openCharges|unassignedPayments|upcomingRate/, "la tabla no muestra saldos, conceptos sueltos ni cambios programados");
  assert.doesNotMatch(view, /lastPayment\.amount|paymentAmount/, "la fecha de pago no repite su importe");
});

test("búsqueda al escribir (sin Enter ni navegación), lista completa sin paginar y accesibilidad básica", () => {
  const view = code(VIEW);
  assert.doesNotMatch(view, /PaginationControls|page=|Cargar más|Ver más|router\.(push|replace)|useRouter/);
  assert.match(view, /onChange=\{\(event\) => setText\(event\.target\.value\.slice\(0, 80\)\)\}/);
  assert.match(view, /onSubmit=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(view, /role="status" aria-live="polite"/);
  assert.match(view, /window\.history\.replaceState\(/);
  assert.match(view, /<caption className="sr-only">/);
  assert.match(view, /min-h-11/, "el enlace del nombre mide al menos 44 px");
  assert.match(code("components/payments/per-student-menu.tsx"), /h-11 w-8/);
});
