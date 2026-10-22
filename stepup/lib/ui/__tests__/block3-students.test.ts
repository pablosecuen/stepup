import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** Rediseño visual v1 — Bloque 3: Alumnos y perfil del alumno (docs/design/web-v1/08-bloque-3.md). Sólo presentación. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

const STUDENT_FILES = [...sources("components/students"), ...sources("app/(app)/alumnos"), "components/payments/charge-actions.tsx", "components/payments/void-payment-button.tsx"];

test("las pantallas de Alumnos ya no usan el azul heredado de interfaz ni los colores reservados del semáforo de cobro o del 50/30/20", () => {
  assert.ok(STUDENT_FILES.length > 20);
  for (const file of STUDENT_FILES) {
    assert.doesNotMatch(code(file), /brandBlue|statusVerde|statusRojo|statusAmarillo|statusNaranja|statusPendiente|statusSinDatos|pastelLavender|pastelSage|border-border\b(?!Mid|Strong)[^"]*focus-visible:ring-brandBlue/, file);
    assert.doesNotMatch(code(file), /\b(bg|text|border|ring|accent)-(amber|red|blue|green)-\d{2,3}\b/, `${file}: sin colores crudos de Tailwind`);
  }
});

test("las vistas sólo dibujan: no importan repositorios ni consultas (los datos los resuelve la página, igual que antes)", () => {
  for (const file of ["components/students/students-list-view.tsx", "components/students/profile/student-profile-view.tsx", "components/students/student-form-page.tsx", "components/students/profile/profile-header.tsx"]) {
    const source = code(file);
    assert.doesNotMatch(source, /import (?!type)[^;]*lib\/repositories/, `${file}: sin repositorios`);
    assert.doesNotMatch(source, /supabase|requireAuthenticatedDbContext|fetch\(|\.rpc\(|"use server"/, `${file}: sin acceso a datos`);
  }
  // Las páginas siguen cargando lo mismo que antes.
  const list = code("app/(app)/alumnos/page.tsx");
  assert.match(list, /Promise\.all\(\[listStudents\(ctx\), listCustomLevels\(ctx\), loadExcludedStudentIds\(ctx\)\]\)/);
  const profile = code("app/(app)/alumnos/[id]/page.tsx");
  assert.match(profile, /<StudentProfileView\s+student=\{student\}\s+tab=\{tab\}/);
});

test("Lista: filtros por GET sin lógica en el cliente, hoja de filtros móvil con su propio formulario, cantidad y una sola acción principal", () => {
  const filters = code("components/students/students-filters-form.tsx");
  assert.match(filters, /<form method="GET" action="\/alumnos"/);
  assert.doesNotMatch(filters, /applyStudentFilters|\.filter\(\(s\)|students\b.*\.sort/, "el filtrado real sigue en el servidor");
  assert.match(filters, /<Dialog\s+title="Filtros"/);
  assert.match(filters, /<form id="students-filters-sheet" method="GET" action="\/alumnos"/);
  assert.match(filters, /<input type="hidden" name="q" value=\{sheetSearch\} \/>/, "la hoja reenvía el texto buscado");
  assert.match(filters, /form="students-filters-sheet"/, "el botón del pie envía el formulario de la hoja");
  assert.match(filters, /Aplicar filtros/);
  const view = code("components/students/students-list-view.tsx");
  assert.match(view, /totalItems\} alumno\{totalItems === 1 \? "" : "s"\}/);
  assert.equal([...view.matchAll(/variant="primary"/g)].length, 1, "«Nuevo alumno» es la única acción principal");
  assert.match(view, /<StudentsTable students=\{items\} \/>/);
  assert.match(view, /nav:hidden/, "tarjetas por debajo de 820 px");
  assert.match(code("components/students/students-filters-form.tsx"), /variant="secondary" className="hidden nav:inline-flex"/, "«Aplicar filtros» pesa menos que «Nuevo alumno»");
});

test("Lista: los textos largos se parten (nunca «…»), el estado va con texto y el nivel/modalidad se leen sin color", () => {
  const card = code("components/students/student-card.tsx");
  assert.doesNotMatch(card, /\btruncate\b|text-ellipsis|line-clamp/);
  assert.match(card, /\[overflow-wrap:anywhere\]/);
  assert.match(code("components/students/student-status-badge.tsx"), /<Badge tone=\{STATUS_TONE\[status\]\} dot>\s*\{STUDENT_STATUS_LABEL\[status\]\}/);
  assert.match(card, /Nivel \$\{student\.levels\.join\(", "\)\}/);
  assert.match(card, /<Table caption="Alumnos">/);
});

test("Nuevo alumno: conserva la idempotencia (clave por borrador), el bloqueo mientras envía y la confirmación explícita del duplicado; el duplicado pesa menos que Guardar", () => {
  const form = code("app/(app)/alumnos/nuevo/new-student-form.tsx");
  assert.match(form, /useDraftOperationId\(NEW_STUDENT_OPERATION_STORAGE_KEY\)/);
  assert.match(form, /<input type="hidden" name="operationId" value=\{operationId \?\? ""\} \/>/);
  assert.match(form, /name="confirmDuplicate" value="true" variant="ghost"/, "confirmar «es otra persona» es la de menor peso");
  assert.equal([...form.matchAll(/variant="primary"/g)].length, 1, "una única acción principal: Guardar alumno");
  assert.match(form, /disabled=\{pending \|\| disabled\}/);
  assert.match(form, /href="\/alumnos" variant="ghost"/, "Cancelar es de poco peso");
  assert.match(form, /Encontramos \$\{candidates\.length === 1/);
  assert.match(form, /role="status"/, "el aviso de duplicado se anuncia");
  // Sin validaciones nuevas: el formulario sigue sin errores por campo.
  assert.doesNotMatch(form, /fieldErrors|error=\{/);
});

test("Editar alumno: Guardar es la acción principal y Cancelar vuelve a la ficha; los campos son los mismos y sin validaciones nuevas", () => {
  const form = code("app/(app)/alumnos/[id]/editar/edit-student-form.tsx");
  assert.match(form, /variant="primary" busy=\{pending\}/);
  assert.match(form, /href=\{`\/alumnos\/\$\{student\.id\}`\} variant="ghost"/);
  assert.match(form, /updateStudentAction\.bind\(null, student\.id\)/);
  const fields = code("components/students/student-form-fields.tsx");
  for (const name of ["name", "modality", "category", "billingType", "price", "weeklyFrequency", "usualDurationMinutes", "dateJoined", "phone", "whatsapp", "email", "notes"]) {
    assert.match(fields, new RegExp(`name="${name}"`), name);
  }
  for (const id of ["name", "modality", "category", "billingType", "price", "weeklyFrequency", "usualDurationMinutes", "dateJoined", "phone", "whatsapp", "email", "notes"]) {
    assert.match(fields, new RegExp(`htmlFor="${id}"`), `etiqueta de ${id}`);
  }
  assert.match(fields, /legend className=\{LEGEND\}>Datos básicos/);
  assert.ok(fields.includes("<LevelPicker customLevels={customLevels} defaultSelected={defaultValues?.levels ?? []} />"), "los niveles los da el selector con «+»");
  const picker = code("components/students/level-picker.tsx");
  assert.ok(picker.includes('name="levels"'));
  assert.match(picker, /has-\[:checked\]:bg-ink/, "el nivel elegido se distingue con marca ✓ y no sólo por color");
});

test("Perfil: un solo h1 (el nombre), «Volver» como enlace de texto, «Editar alumno» secundaria y el cambio de estado lejos, en su propia tarjeta", () => {
  const header = code("components/students/profile/profile-header.tsx");
  assert.equal([...header.matchAll(/<h1\b/g)].length, 1);
  assert.match(header, /<BackLink href="\/alumnos">Volver a Alumnos<\/BackLink>/);
  assert.match(header, /variant="secondary" className="self-start"/);
  assert.doesNotMatch(code("components/ui/page-header.tsx"), /buttonClass\(/, "Volver no compite con Guardar o Crear");
  for (const file of sources("components/students/profile").filter((f) => !f.endsWith("profile-header.tsx"))) assert.doesNotMatch(code(file), /<h1\b/, `${file}: sin h1 extra`);
  const view = code("components/students/profile/student-profile-view.tsx");
  assert.match(view, /<ChangeStatusForm studentId=\{student\.id\} currentStatus=\{student\.status\} \/>/);
  assert.ok(view.indexOf("<ResumenTabContent") < view.indexOf("<ChangeStatusForm"), "el cambio de estado va después de todo el resumen");
});

test("Perfil: siete pestañas, la activa con aria-current y centrada en móvil, y la línea de la fila cubre todo el desplazamiento", () => {
  const nav = code("components/students/profile/profile-tabs-nav.tsx");
  for (const label of ["Resumen", "Clases", "Progreso", "Tareas", "Cobros", "Reportes", "Información"]) assert.match(nav, new RegExp(`label: "${label}"`));
  assert.match(nav, /centeredScrollLeft\(/);
  assert.match(nav, /aria-current=\{isActive \? "page" : undefined\}/);
  assert.match(nav, /w-max min-w-full/, "la línea inferior acompaña a las pestañas que se desplazan");
  assert.match(nav, /min-h-11/);
});

test("Cobros del alumno: «Registrar pago» abre un diálogo y «Anular» queda con poco peso, lejos de las acciones normales; la lógica no cambió", () => {
  const actions = code("components/payments/charge-actions.tsx");
  assert.match(actions, /useDraftOperationId\(`teacherflow:cobros:pago:\$\{chargeId\}`\)/);
  assert.match(actions, /registerPaymentAction\(\{\s*operationId,/);
  assert.match(actions, /<Dialog\s+title="Registrar pago"/);
  assert.match(actions, /<Dialog\s+title="Anular cobro"/);
  assert.match(actions, /<Button variant="secondary" onClick=\{\(\) => setMode\("pay"\)\}>/);
  assert.match(actions, /<Button variant="dangerGhost" onClick=\{\(\) => setMode\("void"\)\} className=\{compact \? undefined : "sm:ml-auto"\}>/);
  assert.match(actions, /disabled=\{!voidReason\.trim\(\)\}/, "el motivo sigue siendo obligatorio");
  assert.match(code("components/payments/void-payment-button.tsx"), /<Dialog\s+title="Anular pago"/);
  const tab = code("components/students/profile/cobros-tab.tsx");
  assert.match(tab, /<Badge tone="ok"[\s\S]*?>\s*Pagado/);
  assert.match(tab, /<Badge tone="bad"[\s\S]*?>\s*Vencido/);
  assert.match(tab, /formatMoney\(charge\.originalAmount\)/);
  assert.match(tab, /\[overflow-wrap:anywhere\]/, "importes y nombres largos se parten");
});

test("Reportes: eliminar pide confirmación en un diálogo, el PDF faltante se dice con texto y los meses dicen si están elegidos", () => {
  const tab = code("components/students/profile/reportes-tab.tsx");
  assert.match(tab, /<Dialog\s+title="Eliminar reporte"/);
  assert.match(tab, /handleDelete\(confirmingRecord\.id\)/);
  assert.match(tab, /PDF no disponible/);
  assert.match(tab, /aria-pressed=\{selectedMonths\.has\(month\)\}/);
  assert.match(tab, /variant="accent" onClick=\{onGenerate\}/, "Generar PDF es la acción principal de la vista previa");
  assert.match(tab, /export function ReportPreviewCard/);
});

test("Cambio de estado: la elección de agenda al archivar sigue siendo explícita y el botón pasa a contorno rojo", () => {
  const form = code("components/students/change-status-form.tsx");
  assert.match(form, /const canSubmit = !isArchiving \|\| removeFromFuture !== ""/);
  assert.match(form, /useMemo\(\(\) => crypto\.randomUUID\(\), \[\]\)/, "la clave de operación es estable");
  assert.match(form, /destructive=\{isArchiving\}/);
  assert.match(form, /variant=\{destructive \? "dangerOutline" : "secondary"\}/);
  assert.match(form, /name="removeFromFuture"/);
});

// --- Correcciones finales de UX (Bloque 3) ------------------------------------------------------------------------------

test("Duplicado: «Volver y editar los datos» sólo cierra el aviso y devuelve el foco: no envía, no crea, no rota la clave ni borra lo escrito", () => {
  const form = code("app/(app)/alumnos/nuevo/new-student-form.tsx");
  assert.match(form, /<Button type="button" variant="secondary" onClick=\{onBack\}>\s*Volver y editar los datos/, "botón común (no submit) y secundario");
  const back = form.slice(form.indexOf("function backToEdit()"), form.indexOf("useEffect(() => {"));
  assert.match(back, /setDismissedState\(state\)/);
  assert.match(back, /querySelector<HTMLInputElement>\("#name"\)\?\.focus\(\)/, "el foco vuelve al formulario");
  assert.doesNotMatch(back, /formAction|requestSubmit|submit\(|rotateOperationId|clear\(|reset\(|router\./, "no envía, no rota la clave, no limpia ni navega");
  // «Es otra persona» sigue siendo una confirmación explícita (submit con confirmDuplicate) y de menor peso que «Volver y editar».
  assert.match(form, /<Button type="submit" name="confirmDuplicate" value="true" variant="ghost">\s*Es otra persona, crear igualmente/);
  assert.ok(form.indexOf("Volver y editar los datos") < form.indexOf("Es otra persona, crear igualmente"));
  assert.equal([...form.matchAll(/variant="primary"/g)].length, 1, "sigue habiendo una única acción principal");
  // El formulario es no controlado y no se desmonta: lo escrito y la clave por borrador sobreviven.
  assert.match(form, /<StudentFormFields customLevels=\{customLevels\} \/>/);
  assert.match(form, /useDraftOperationId\(NEW_STUDENT_OPERATION_STORAGE_KEY\)/);
});

test("Duplicado: el aviso se oculta sólo para el estado descartado; un envío nuevo (otro estado) lo vuelve a mostrar", async () => {
  const { isDuplicatePanelVisible } = await import("../../students/duplicate-review.ts");
  const first = { duplicate: { candidates: [], changed: false } };
  const second = { duplicate: { candidates: [], changed: true } };
  assert.equal(isDuplicatePanelVisible(first, null), true);
  assert.equal(isDuplicatePanelVisible(first, first), false, "descartado: oculto");
  assert.equal(isDuplicatePanelVisible(second, first), true, "otro envío: vuelve a mostrarse");
  assert.equal(isDuplicatePanelVisible({}, null), false, "sin duplicado no hay aviso");
});

test("Diálogos de Cobros: identifican qué se modifica con datos que el llamador ya tiene (alumno, concepto, vencimiento, importe, saldo) y omiten lo que falta", () => {
  // Las pruebas no pueden importar .tsx: se verifica el código fuente.
  const source = code("components/payments/dialog-context.tsx");
  assert.match(source, /Vence \$\{formatCivilDate\(context\.dueDate\)\}/);
  assert.match(source, /Importe original: \$\{formatMoney\(context\.originalAmount\)\}/);
  assert.match(source, /Saldo pendiente: \$\{formatMoney\(balance\)\}/);
  assert.match(source, /Pago: \$\{parts\}/);
  assert.match(source, /\.filter\(\(p\): p is string => !!p/, "lo que falta se omite, nunca se inventa");
  const actions = code("components/payments/charge-actions.tsx");
  assert.equal([...actions.matchAll(/<DialogContext title=\{joinContextTitle\(context\?\.studentName, context\?\.concept\)\} lines=\{chargeContextLines\(context, balance\)\} \/>/g)].length, 2, "registrar pago y anular cobro");
  assert.match(code("components/payments/void-payment-button.tsx"), /<DialogContext title=\{context\?\.studentName\} lines=\{paymentContextLines\(context\)\} \/>/);
  // Los dos llamadores reales pasan sólo lo que ya tenían: el perfil (alumno ya cargado) y Cobros global (entrada del centro de cobros).
  const tab = code("components/students/profile/cobros-tab.tsx");
  assert.match(tab, /context=\{\{\s*studentName,\s*concept:/);
  assert.match(tab, /<VoidPaymentButton paymentId=\{payment\.id\} context=\{\{ studentName, amount: payment\.amount/);
  const cobros = code("components/payments/collections-view.tsx");
  assert.match(cobros, /studentName: entry\.studentName,\s*concept,\s*dueDate: entry\.dueDate,\s*originalAmount: entry\.originalAmount/);
  assert.match(cobros, /<ChargeActions\s+chargeId=\{entry\.chargeId\}/, "Cobros global sigue usando los mismos diálogos");
  // Sin consultas nuevas.
  assert.doesNotMatch(source, /supabase|fetch\(|lib\/repositories|"use server"/);
});
