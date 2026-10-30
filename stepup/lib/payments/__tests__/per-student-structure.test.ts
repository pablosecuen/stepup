import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveScreen } from "../../nav/screens.ts";

/**
 * Cobros › Por alumno (29/10/2026): pestaña de CONSULTA dentro de Cobros. Estas pruebas fijan que sólo lee, que no crea un segundo mecanismo para editar tarifas,
 * que usa el esqueleto y la carga compartidos y que conserva la pestaña, el filtro y la posición al volver.
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
  for (const reader of ["listStudents(ctx)", "listAllCharges(ctx)", "listAllPayments(ctx)", "listAllAllocations(ctx)", "listTrainingBillingAgreements(ctx)"]) assert.ok(page.includes(reader), reader);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  const builder = code("lib/payments/per-student-overview.ts");
  assert.doesNotMatch(builder, /supabase|fetch\(|await |async |from "@\/lib\/(actions|db)/, "el cálculo es puro");
});

test("no hay un segundo mecanismo de edición de tarifas: «Editar plan» y «Editar cuota» llevan al circuito existente y la vista no importa acciones", () => {
  const view = code(VIEW);
  assert.doesNotMatch(view, /@\/lib\/actions\/|changeBillingPlanAction|changeMonthlyAmountAction|editTrainingBillingFee|BillingPlanCard|TrainingBillingConfigButton|<Dialog|useTransition/);
  assert.match(view, /\/cobros\/alumnos\/\$\{studentId\}\?tab=cobros/, "Ver detalle: la ficha de cobros del alumno");
  assert.match(view, /#plan-\$\{studentId\}/, "Editar plan: la tarjeta «Plan de cobro» de esa ficha");
  assert.match(view, /href="\/calendario\/series"/, "Editar cuota de entrenamiento: donde ya vive (Series)");
  assert.match(code("components/students/profile/billing-plan-card.tsx"), /id=\{`plan-\$\{studentId\}`\}/, "el ancla existe en la ficha");
  assert.match(code("components/students/profile/billing-plan-card.tsx"), /Editar plan de cobro/);
});

test("la pestaña está en la navegación de Cobros, es una pantalla del registro de carga y tiene su esqueleto y su loading", () => {
  assert.match(code("components/payments/payments-section-nav.tsx"), /key: "students", href: "\/cobros\/por-alumno", label: "Por alumno"/);
  const screen = resolveScreen("/cobros/por-alumno");
  assert.equal(screen?.key, "por-alumno");
  assert.equal(screen?.title, "Cobros");
  assert.equal(screen?.width, "wide");
  assert.equal(resolveScreen("/cobros")?.key, "cobros", "el Centro de cobros sigue siendo su propia pantalla");
  assert.equal(resolveScreen("/cobros/alumnos/6f1c0a3e-1111-2222-3333-444455556666")?.key, "alumno");
  assert.ok(existsSync(join(ROOT, "app/(app)/cobros/por-alumno/loading.tsx")));
  assert.match(code("app/(app)/cobros/por-alumno/loading.tsx"), /<DestinationSkeleton fallbackPath="\/cobros\/por-alumno" \/>/);
  const skeleton = code("components/nav/screen-skeleton.tsx");
  assert.match(skeleton, /case "por-alumno":\s*return <PorAlumnoBody/);
  assert.match(skeleton, /PER_STUDENT_GRID_CLASS[\s\S]*PER_STUDENT_ROW_CLASS/, "el esqueleto usa las mismas clases de fila que la vista real");
  assert.match(code("lib/nav/primary-nav-items.ts"), /related: \["\/resumen-financiero"\]/);
});

test("un solo encabezado, sin paginación: la lista completa en una vista desplazable y la búsqueda se aplica al escribir (sin Enter)", () => {
  const view = code(VIEW);
  assert.doesNotMatch(view, /PaginationControls|page=|slice\(\s*\(?page|Cargar más|Ver más/);
  assert.match(view, /onChange=\{\(event\) => setText\(event\.target\.value\.slice\(0, 80\)\)\}/);
  assert.match(view, /onSubmit=\{\(event\) => event\.preventDefault\(\)\}/, "Enter no recarga ni navega");
  assert.match(view, /role="search"/);
  assert.match(view, /role="status" aria-live="polite"/, "el recuento se anuncia");
  assert.doesNotMatch(view, /router\.(push|replace)|useRouter/, "buscar, filtrar y ordenar no navegan: no hay recarga ni esqueleto");
  assert.match(view, /window\.history\.replaceState\(/, "la búsqueda, el plan y el orden quedan en la dirección");
});

test("al abrir un detalle se recuerda la lista (búsqueda, plan, orden) y la posición; la ficha vuelve a ella y la lista la restaura una sola vez", () => {
  const view = code(VIEW);
  assert.match(view, /writePerStudentMemory\(\{ href: buildPerStudentHref\(query\), y: window\.scrollY/);
  assert.match(view, /window\.scrollTo\(0, memory\.y\);\s*clearPerStudentMemory\(\);/);
  assert.match(view, /data-per-student-link/);
  const back = code("components/payments/payments-back-link.tsx");
  assert.match(back, /memory\.studentId === studentId \? memory\.href : "\/cobros"/, "sólo vuelve a la lista si se salió de ella hacia ESTE alumno");
  assert.match(back, /\(\) => "\/cobros"/, "el servidor y el primer dibujo son siempre /cobros (sin diferencias de hidratación)");
  assert.match(code("components/students/profile/profile-header.tsx"), /fromPayments \? <PaymentsBackLink studentId=\{student\.id\} \/>/);
  const memory = code("components/payments/per-student-memory.ts");
  assert.match(memory, /\^\\\/cobros\\\/por-alumno/, "sólo se acepta una dirección de la propia lista, nunca un destino arbitrario");
  assert.match(memory, /MEMORY_MAX_AGE_MS = 30 \* 60 \* 1000/);
});

test("accesibilidad: cada dato se rotula con texto (nunca sólo color), los controles táctiles miden 44 px y no hay estado comunicado por color", () => {
  const view = code(VIEW);
  assert.match(view, /min-h-11/);
  for (const text of ["Saldo pendiente", "Sin pagos registrados", "Sin saldo pendiente", "Ver detalle", "Editar plan", "Editar cuota"]) assert.ok(view.includes(text), text);
  assert.match(view, /Pago sin cobro asignado: no se puede saber a qué concepto corresponde\./);
  assert.match(view, /Situación inicial declarada, no un cobro registrado en una fecha\./);
  assert.match(view, /<span className="sr-only"> de \{row\.name\}<\/span>/, "los enlaces repetidos dicen de quién son");
  assert.match(view, /aria-label=\{`Conceptos de \$\{row\.name\}`\}/);
  assert.doesNotMatch(view, /statusVerde|text-red|bg-red|text-green|bg-green/, "ni semáforos ni rojo/verde: es una consulta");
});
