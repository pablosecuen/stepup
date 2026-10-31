import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { rememberSharedName, readSharedName, readSharedNameMatching } from "../../nav/pending-destination.ts";

/**
 * Cobros › Por alumno — presentación (30/10/2026): una fila cerrada y uniforme por alumno, importe real (deuda total o tarifa) sin «Varios conceptos», cinco posiciones fijas dentro de
 * «Cobro» (indicador · $ · cifra · unidad · desplegable), transición compartida del nombre hasta la ficha (también con datos lentos) y regreso con todo restaurado.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEW = "components/payments/per-student-view.tsx";
const LAYOUT = "components/payments/per-student-layout.ts";

test("al entrar todo está cerrado: ninguna subfila por defecto y todas las filas principales comparten estructura y alto; «Varios conceptos» ya no existe", () => {
  const view = code(VIEW);
  assert.match(view, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/, "ningún alumno desplegado de entrada");
  assert.match(view, /\{open &&\s*row\.concepts\.map/, "las subfilas sólo existen con el alumno desplegado");
  assert.match(view, /<tr className=\{PER_STUDENT_ROW_CLASS\}>/);
  assert.match(code(LAYOUT), /PER_STUDENT_ROW_CLASS = "h-\[52px\] nav:h-12"/);
  for (const file of [VIEW, "components/nav/screen-skeleton.tsx", "lib/payments/per-student-overview.ts"]) assert.doesNotMatch(read(file), /Varios conceptos/, file);
});

test("el desplegable es un botón propio de cada alumno, fuera del enlace del nombre, con aria-expanded, aria-controls y teclado nativo; la fecha principal es la del último pago real", () => {
  const view = code(VIEW);
  assert.match(view, /<button\s+type="button"\s+aria-expanded=\{open\}\s+aria-controls=\{open \? groupId : undefined\}/);
  assert.match(view, /aria-label=\{`\$\{open \? "Ocultar" : "Ver"\} los conceptos de \$\{row\.name\}`\}/);
  assert.match(view, /<DateCell paidAt=\{row\.latestPaidAt\} \/>/, "fecha principal: el último pago real del alumno");
  assert.match(view, /<DateCell paidAt=\{concept\.lastPayment\?\.paidAt \?\? null\} \/>/, "el detalle conserva la fecha de cada concepto");
  const link = view.slice(view.indexOf("<PrivateLink\n              href={detailHref(row.studentId)}"), view.indexOf("</PrivateLink>"));
  assert.doesNotMatch(link, /<button|onToggle/, "el botón no está dentro del enlace del nombre");
  assert.match(view, /motion-reduce:transition-none/);
  assert.match(view, /h-11 w-7/, "44 px de alto");
});

test("«Cobro»: la misma regla para el alumno y para cada concepto (deuda real total en rojo; sin deuda, la tarifa con tilde sólo si está saldada)", () => {
  const view = code(VIEW);
  assert.match(view, /display=\{cobroDisplayForRow\(row\)\}/);
  assert.match(view, /<AmountCell display=\{cobroDisplayForConcept\(concept\)\} \/>/);
  assert.match(view, /display\.kind === "debt" \? display\.amount : display\.rate\.amount/);
  assert.match(view, /display\.kind === "debt" \? "deuda" : ratePeriodShort\(display\.rate\)/);
  assert.match(view, /settled && <CheckCircleIcon className="h-4 w-4 text-statusVerde" aria-hidden \/>/);
  assert.match(view, /debt && <ExclamationCircleIcon className="h-4 w-4 text-statusRojo" aria-hidden \/>/);
  assert.match(view, /Obligaciones exigibles al día/);
  assert.match(view, /Con deuda: total pendiente/);
  assert.doesNotMatch(view, /concept\.(pendingBalance|dueBalance)|row\.pendingBalance/, "los totales salen de la regla compartida, no se recalculan en la vista");
});

test("cinco posiciones propias dentro de «Cobro» —indicador · signo $ · cifra · unidad · desplegable—, las mismas en todas las filas y detalles; ningún importe se alinea con espacios o márgenes", () => {
  const layout = code(LAYOUT);
  assert.match(layout, /grid-cols-\[14px_9px_62px_28px\]/);
  assert.match(layout, /nav:grid-cols-\[16px_10px_76px_68px_36px\]/);
  assert.match(layout, /PER_STUDENT_INDICATOR_CLASS = "col-start-1 \[grid-row:1\/span_2\][^"]*nav:\[grid-row:1\/span_1\]"/);
  assert.match(layout, /PER_STUDENT_DOLLAR_CLASS = "col-start-2 row-start-1 text-right"/);
  assert.match(layout, /PER_STUDENT_FIGURE_CLASS = "tf-num col-start-3 row-start-1 whitespace-nowrap text-right"/);
  assert.match(layout, /PER_STUDENT_UNIT_CLASS = "col-start-3 row-start-2[^"]*nav:col-start-4 nav:row-start-1/);
  assert.match(layout, /PER_STUDENT_TOGGLE_SLOT_CLASS = "col-start-4 \[grid-row:1\/span_2\][^"]*nav:col-start-5 nav:\[grid-row:1\/span_1\]"/);
  const view = code(VIEW);
  assert.match(view, /<span className=\{`\$\{PER_STUDENT_DOLLAR_CLASS\} font-semibold \$\{tone\}`\}>\$<\/span>/, "el signo $ en su propia posición");
  assert.match(view, /function moneyDigits\(/);
  assert.equal((view.match(/<AmountCell[\s>]/g) ?? []).length, 2, "la misma celda para la fila principal y las subfilas");
  const amountCell = view.slice(view.indexOf("function AmountCell"), view.indexOf("function DateCell"));
  assert.doesNotMatch(amountCell, /&nbsp;|\\u00a0|padStart|\bm[lrx]-|\bp[lr]-/, "sin espacios escritos ni márgenes por importe");
  const skeleton = code("components/nav/screen-skeleton.tsx");
  assert.match(skeleton, /PER_STUDENT_DOLLAR_CLASS[\s\S]*PER_STUDENT_FIGURE_CLASS[\s\S]*PER_STUDENT_TOGGLE_SLOT_CLASS/, "el esqueleto reserva las mismas cinco posiciones");
});

test("transición del nombre: el nombre de la fila lleva el contrato compartido (data-tf-shared-name + id), SIN nombre de transición fijo en todas las filas; sólo el clic lo asigna", () => {
  const view = code(VIEW);
  assert.match(view, /<span data-tf-shared-name data-tf-shared-id=\{row\.studentId\} title=\{row\.name\} className="line-clamp-2">/);
  assert.doesNotMatch(view, /viewTransitionName/, "un nombre de transición fijo en cada fila crearía un grupo por fila en cada navegación");
  assert.match(code("components/nav/shared-name-transition.tsx"), /element\.style\.viewTransitionName = snapshot\.transitionName/);
  assert.match(code("components/nav/shared-name-transition.tsx"), /prefers-reduced-motion: reduce/);
  assert.ok(code("components/students/profile/profile-header.tsx").includes("viewTransitionName: `tf-student-${student.id}`"), "el encabezado de la ficha (destino) usa el mismo nombre");
  assert.doesNotMatch(view, /startViewTransition|@keyframes|animate-|animation/, "ninguna animación propia");
});

test("con datos lentos el nombre sigue viajando: el clic guarda el nombre (sin avisar) y los esqueletos de la ficha lo dibujan con el mismo nombre de transición", () => {
  const nav = code("components/nav/navigation-progress.tsx");
  assert.match(nav, /rememberSharedName\(pathnameOf\(destination\), sharedName\)/);
  assert.ok(nav.indexOf("rememberSharedName(") < nav.indexOf("window.setTimeout(() => {\n          if (pendingRef.current?.destination === destination)"), "se guarda en el propio clic, antes de publicar el destino pendiente");
  for (const file of ["app/(app)/alumnos/[id]/loading.tsx", "app/(app)/cobros/alumnos/[id]/loading.tsx"]) assert.match(code(file), /<ProfileLoadingSkeleton path=/, file);
  assert.match(code("components/nav/profile-loading-skeleton.tsx"), /readSharedNameMatching\(PROFILE_PATH\)/);
  assert.match(code("components/nav/screen-slot.tsx"), /sharedName=\{readSharedName\(pathnameOf\(active\.destination\)\)\}/);
  assert.match(code("components/nav/destination-skeleton.tsx"), /sharedName=\{readSharedName\(candidate\)\}/);
  const skeleton = code("components/nav/screen-skeleton.tsx");
  assert.match(skeleton, /data-tf-shared-name data-tf-shared-id=\{sharedName\.id\} style=\{\{ viewTransitionName: `tf-student-\$\{sharedName\.id\}` \}\}/);
  assert.match(skeleton, /<SkBack label=\{back \?\? "Volver a Alumnos"\} \/>/, "el esqueleto de la ficha de Cobros dice «Volver a Cobros»");
});

test("el nombre recordado vale sólo para su destino y unos segundos; sin clic previo no hay nombre", () => {
  rememberSharedName("/cobros/alumnos/s-1", { id: "s-1", text: "Ana" }, 1000);
  assert.deepEqual(readSharedName("/cobros/alumnos/s-1", 5000), { id: "s-1", text: "Ana" });
  assert.equal(readSharedName("/cobros/alumnos/s-2", 5000), null, "otro destino");
  assert.equal(readSharedName("/cobros/alumnos/s-1", 20_000), null, "vencido");
  const profile = /^\/(?:cobros\/)?alumnos\/[^/]+$/;
  assert.deepEqual(readSharedNameMatching(profile, 5000), { id: "s-1", text: "Ana" });
  rememberSharedName("/cobros", null, 6000);
  assert.equal(readSharedNameMatching(profile, 6500), null, "un clic sin nombre compartido borra el anterior");
});

test("al volver se restauran la lista, la búsqueda, los filtros, el orden, la posición y los desplegables abiertos, y la posición se reafirma ante el router", () => {
  const view = code(VIEW);
  assert.match(view, /writePerStudentMemory\(\{ href: buildPerStudentHref\(query\), y: window\.scrollY, studentId: link\.getAttribute\("data-per-student-link"\), expanded: \[\.\.\.expanded\] \}\)/);
  assert.match(view, /setExpanded\(new Set\(memory\.expanded\)\)/);
  assert.match(view, /pendingScrollY\.current = memory\.y/);
  assert.match(view, /\[0, 60, 160, 320, 600\]\.map\(\(delay\) =>/);
  assert.match(view, /clearPerStudentMemory\(\)/);
  assert.match(view, /onClickCapture=\{rememberPosition\}/);
  assert.match(code("components/payments/per-student-memory.ts"), /expanded: string\[\]/);
  assert.match(code("components/payments/payments-back-link.tsx"), /memory\.studentId === studentId \? memory\.href : "\/cobros"/);
  assert.match(code("components/students/profile/profile-header.tsx"), /fromPayments \? <PaymentsBackLink studentId=\{student\.id\} \/>/);
});

test("el menú «⋯» y el desplegable están fuera del enlace: pulsarlos nunca abre la ficha", () => {
  const view = code(VIEW);
  assert.match(view, /closest<HTMLElement>\("a\[data-per-student-link\]"\)/);
  const menu = code("components/payments/per-student-menu.tsx");
  assert.match(menu, /<button\s+ref=\{buttonRef\}/);
  assert.doesNotMatch(menu, /<PrivateLink[^>]*>\s*<button/);
  assert.match(menu, /h-11 w-8/);
});
