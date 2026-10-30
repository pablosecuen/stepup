import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Cobros › Por alumno — presentación (30/10/2026): una fila cerrada y uniforme por alumno, conceptos desplegables, tres posiciones reservadas dentro de «Cobro», transición compartida
 * al abrir la ficha y regreso con los desplegables abiertos.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEW = "components/payments/per-student-view.tsx";
const LAYOUT = "components/payments/per-student-layout.ts";

test("al entrar todo está cerrado: ninguna subfila se dibuja por defecto y todas las filas principales comparten estructura y alto", () => {
  const view = code(VIEW);
  assert.match(view, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/, "ningún alumno desplegado de entrada");
  assert.match(view, /\{multiple &&\s*open &&\s*row\.concepts\.map/, "las subfilas sólo existen con el alumno desplegado");
  assert.match(view, /<tr className=\{PER_STUDENT_ROW_CLASS\}>/, "la fila principal usa la clase de alto uniforme");
  assert.match(code(LAYOUT), /PER_STUDENT_ROW_CLASS = "h-\[52px\] nav:h-12"/);
  assert.doesNotMatch(view, /conceptShortLabel\(concept, trainingCount\)\}<\/p>\s*\)\}\s*<\/div>/, "la fila cerrada no lleva etiqueta de concepto debajo del nombre");
});

test("«Varios conceptos»: botón propio, independiente del enlace del nombre, con aria-expanded, aria-controls y teclado nativo; no elige un concepto ni muestra una fecha o una tilde de todos", () => {
  const view = code(VIEW);
  assert.match(view, /<button\s+type="button"\s+aria-expanded=\{open\}\s+aria-controls=\{open \? groupId : undefined\}/);
  assert.match(view, /<span>Varios conceptos<\/span>/);
  assert.match(view, /Varios conceptos: cada uno tiene su fecha de pago/);
  assert.match(view, /\{multiple \? \(\s*<>\s*<td className=\{PER_STUDENT_TD_CLASS\}>\s*<span className="sr-only">Varios conceptos/, "con varios conceptos la fecha de la fila principal queda vacía: ni fecha, ni tilde, ni importe de «todos»");
  assert.match(view, /<DateCell concept=\{single\} \/>\s*<AmountCell concept=\{single\} \/>/, "sólo con UN concepto la fila principal muestra su fecha y su cobro");
  const link = view.slice(view.indexOf("<PrivateLink\n              href={detailHref(row.studentId)}"), view.indexOf("</PrivateLink>"));
  assert.doesNotMatch(link, /<button|onToggle/, "el botón no está dentro del enlace del nombre");
  assert.match(view, /motion-reduce:transition-none/);
  assert.match(view, /min-h-11/);
});

test("«Cobro» reserva tres posiciones —indicador · importe · unidad— compartidas por todas las filas, también las subfilas; los importes terminan en el mismo eje con cifras tabulares", () => {
  const layout = code(LAYOUT);
  assert.match(layout, /PER_STUDENT_AMOUNT_GRID_CLASS = "grid grid-cols-\[16px_minmax\(0,1fr\)\][^"]*nav:grid-cols-\[16px_92px_76px\] nav:justify-end/);
  assert.match(layout, /PER_STUDENT_INDICATOR_CLASS = "row-span-2 inline-flex h-4 w-4 items-center justify-center nav:row-span-1"/);
  assert.match(layout, /PER_STUDENT_UNIT_CLASS = "col-start-2 row-start-2 text-right[^"]*nav:col-start-3 nav:row-start-1 nav:text-left"/);
  const view = code(VIEW);
  assert.equal((view.match(/<AmountCell concept=/g) ?? []).length, 2, "la misma celda para la fila principal y para las subfilas");
  assert.match(view, /<span className=\{PER_STUDENT_INDICATOR_CLASS\}>\s*\{settled &&/, "el indicador ocupa su posición aunque esté vacío");
  assert.match(view, /tf-num whitespace-nowrap text-right font-semibold/);
  assert.match(view, /settled && <CheckCircleIcon className="h-4 w-4 text-statusVerde" aria-hidden \/>/);
  assert.match(view, /due && <ExclamationCircleIcon className="h-4 w-4 text-statusRojo" aria-hidden \/>/);
  assert.match(view, /Obligaciones exigibles al día/);
  assert.match(view, /Con deuda exigible/);
  assert.match(view, /due \? "text-statusRojo" : "text-textPrimary"/);
  assert.doesNotMatch(view, /concept\.(pendingBalance|dueBalance)/);
  const skeleton = code("components/nav/screen-skeleton.tsx");
  assert.match(skeleton, /PER_STUDENT_AMOUNT_GRID_CLASS[\s\S]*PER_STUDENT_INDICATOR_CLASS[\s\S]*PER_STUDENT_UNIT_CLASS/, "el esqueleto reserva las mismas tres posiciones");
});

test("abrir la ficha desde el nombre usa la transición compartida que ya existe (mismo contrato que Alumnos): el nombre lleva data-tf-shared-name, el id y el viewTransitionName del alumno", () => {
  const view = code(VIEW);
  assert.match(view, /<span data-tf-shared-name data-tf-shared-id=\{row\.studentId\} style=\{\{ viewTransitionName: `tf-student-\$\{row\.studentId\}` \}\}/);
  const card = code("components/students/student-card.tsx");
  assert.ok(card.includes("viewTransitionName: `tf-student-${student.id}`"), "mismo nombre de transición que la lista de Alumnos");
  assert.ok(code("components/students/profile/profile-header.tsx").includes("viewTransitionName: `tf-student-${student.id}`"), "y que el encabezado de la ficha (de destino)");
  assert.doesNotMatch(view, /startViewTransition|@keyframes|animate-|animation/, "ninguna animación propia: sólo el mecanismo compartido");
  assert.match(code("components/nav/shared-name-transition.tsx"), /prefers-reduced-motion: reduce/, "el mecanismo compartido respeta el movimiento reducido");
});

test("el botón «Varios conceptos» y el menú «⋯» están fuera del enlace: pulsarlos nunca abre la ficha; sólo los enlaces recuerdan la lista", () => {
  const view = code(VIEW);
  assert.match(view, /closest<HTMLElement>\("a\[data-per-student-link\]"\)/);
  const menu = code("components/payments/per-student-menu.tsx");
  assert.match(menu, /<button\s+ref=\{buttonRef\}/);
  assert.doesNotMatch(menu, /<PrivateLink[^>]*>\s*<button/);
});

test("al volver se restauran la lista, la búsqueda, los filtros, el orden, la posición y los desplegables abiertos, una sola vez", () => {
  const view = code(VIEW);
  assert.match(view, /writePerStudentMemory\(\{ href: buildPerStudentHref\(query\), y: window\.scrollY, studentId: link\.getAttribute\("data-per-student-link"\), expanded: \[\.\.\.expanded\] \}\)/);
  assert.match(view, /setExpanded\(new Set\(memory\.expanded\)\)/);
  assert.match(view, /pendingScrollY\.current = memory\.y/);
  assert.match(view, /window\.scrollTo\(0, pendingScrollY\.current\);\s*pendingScrollY\.current = null;/, "la posición se aplica ya dibujados los desplegables");
  assert.match(view, /clearPerStudentMemory\(\)/);
  const memory = code("components/payments/per-student-memory.ts");
  assert.match(memory, /expanded: string\[\]/);
  assert.match(memory, /MEMORY_MAX_AGE_MS = 30 \* 60 \* 1000/);
  const back = code("components/payments/payments-back-link.tsx");
  assert.match(back, /memory\.studentId === studentId \? memory\.href : "\/cobros"/);
  assert.match(code("components/students/profile/profile-header.tsx"), /fromPayments \? <PaymentsBackLink studentId=\{student\.id\} \/>/);
});
