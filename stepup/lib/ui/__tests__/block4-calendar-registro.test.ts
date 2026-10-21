import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** Rediseño visual v1 — Bloque 4: Calendario y Registro (docs/design/web-v1/09-bloque-4.md). Sólo presentación. */
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

const FILES = [...sources("app/(app)/calendario"), ...sources("app/(app)/registro"), ...sources("components/calendar"), ...sources("components/registro"), "components/payments/training-billing-config.tsx"];

test("Calendario y Registro ya no usan el azul heredado de interfaz ni los colores reservados del semáforo de cobro o del 50/30/20", () => {
  assert.ok(FILES.length > 20);
  for (const file of FILES) {
    const source = code(file);
    assert.doesNotMatch(source, /brandBlue|statusVerde|statusRojo|statusAmarillo|statusNaranja|statusPendiente|statusSinDatos|pastelLavender|pastelSage/, file);
    assert.doesNotMatch(source, /\b(bg|text|border|ring|accent)-(amber|red|blue|green)-\d{2,3}\b/, `${file}: sin colores crudos de Tailwind`);
  }
});

test("la escala de color del calendario sigue CONGELADA y las tarjetas sólo la leen de lib/calendar-theme.ts (ningún hexadecimal propio)", () => {
  const theme = code("lib/calendar-theme.ts");
  for (const hex of ["#DDEEFF", "#2D6F91", "#FCE4D2", "#A85A2A", "#E9DDFC", "#67458F", "#D1D5DB", "#4B5563", "#FFF1B8", "#D99100", "#7A4B00", "#FCE8E6", "#D96C68"]) assert.ok(theme.includes(hex), hex);
  assert.match(theme, /if \(input\.status === "cancelled"\) return CANCELLED_COLORS;\s*if \(input\.isElapsed\) return ELAPSED_COLORS;\s*if \(input\.isActiveReplacement\) return REPLACEMENT_COLORS;\s*return MODALITY_COLORS\[input\.modality\];/);
  const card = code("components/calendar/real-lesson-card.tsx");
  assert.doesNotMatch(card, /#[0-9A-Fa-f]{6}\b/, "las tarjetas no definen colores propios");
  assert.equal([...card.matchAll(/resolveLessonColors\(/g)].length, 2, "grilla y agenda usan la misma resolución");
  assert.doesNotMatch(code("components/calendar/real-calendar-grid.tsx"), /resolveLessonColors|MODALITY_COLORS/, "la grilla no decide colores");
});

test("Semana y Día conservan la grilla también en móvil y comparten datos y acciones de detalle", () => {
  const grid = code("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /data-calendar-region className=\{`relative min-h-0 flex-1/, "la grilla no se elimina de los teléfonos");
  assert.match(grid, /overflow-x-hidden rounded-lg/, "la grilla nunca se desplaza en horizontal: los carriles dividen el ancho de la columna");
  assert.match(grid, /hidden flex-col gap-6 \$\{gridFits \? "nav:hidden" : /, "la lista queda como alternativa de escritorio angosto");
  assert.equal([...grid.matchAll(/setSelected\(/g)].length >= 3, true, "cualquiera de las dos abre el mismo detalle");
  assert.match(grid, /<RealLessonDetailModal/);
  assert.match(grid, /\(positionedByDay\.get\(dayKey\) \?\? \[\]\)\.map\(\(p\) => p\.item\)/, "la agenda ordena igual que la grilla");
  // Geometría: alto del bloque proporcional a la duración real, zona interactiva de al menos 44 px y carriles para las que se tocan
  // (detalle y pruebas de comportamiento en lib/calendar/__tests__/layout-lanes.test.ts).
  const layout = code("lib/calendar/layout.ts");
  assert.match(layout, /export const MIN_TARGET_PX = 44;/);
  assert.match(layout, /box\.hitHeight = Math\.min\(Math\.max\(box\.height, MIN_TARGET_PX\), limit - box\.displayTop\);/, "la zona llega a 44 px cuando hay lugar y nunca pisa a la clase de al lado");
  assert.match(layout, /Math\.min\(durationPx - gapPx, gridBottomPx - top\)/, "la altura del bloque es la duración menos la separación (2 px en Compacta, 6 px en las escalas altas)");
});

test("Tarjetas: hora, título, modalidad y estado se dicen con texto (nunca sólo con color) y la fila de agenda mide ≥ 56 px sin cortar textos", () => {
  const card = code("components/calendar/real-lesson-card.tsx");
  for (const text of ['parts.push("Reemplazo")', 'parts.push("En curso")', 'parts.push("Pasada")', "STATUS_LABELS[item.status]", '"Entren."']) assert.ok(card.includes(text), text);
  assert.match(card, /", cancelada"/);
  assert.match(card, /", en curso"/);
  assert.match(card, /", ya transcurrida"/);
  assert.match(card, /MODALITY_LABELS\[item\.modality\]/, "la agenda dice la modalidad");
  assert.match(card, /\$\{timeLabel\}–\$\{instantTimeLabel\(item\.end\)\}/, "la agenda dice hora de inicio y de fin");
  assert.match(card, /flex min-h-14 w-full/);
  const row = card.slice(card.indexOf("export function RealLessonAgendaRow"));
  assert.doesNotMatch(row, /\btruncate\b|text-ellipsis|line-clamp/, "la agenda nunca corta los textos con «…»");
  assert.match(row, /\[overflow-wrap:anywhere\]/);
  assert.match(card, /const cardWidth = cardWidthPx\(columnWidthPx, laneCount\);\s+const presentation = cardPresentation\(\{ heightPx: height, widthPx: cardWidth \}\)/, "el texto se adapta al bloque real (completo, dos líneas, una línea o sin texto), nunca se estira ni baja fuera de él");
});

test("Detalle de la clase: es el Dialog del sistema, nombra la clase y el día en cada paso, separa «Cancelar esta clase» y conserva las acciones y el foco entre pasos", () => {
  const modal = code("components/calendar/real-lesson-detail-modal.tsx");
  assert.match(modal, /<Dialog title=\{dialogTitle\}/);
  for (const step of ["Reprogramar", "Confirmar horario", "Cancelar clase"]) assert.ok(modal.includes(`${step} · \${lessonTitle}`), step);
  assert.match(modal, /<MetaChip>\{dateLabel\}<\/MetaChip>\s*<MetaChip>\{timeLabel\}<\/MetaChip>/, "día y hora siempre visibles");
  assert.match(modal, /cancelOccurrenceAction\(\{\s*lessonId: item\.materializedLessonId,/);
  assert.match(modal, /rescheduleOccurrenceAction\(\{\s*recurrenceId: item\.recurrenceId,/);
  assert.match(modal, /durationMinutes,\s*\}\)\);/, "la reprogramación conserva la duración");
  assert.match(modal, /<section className="border-t-\[1\.5px\] border-border pt-3">\s*<Button variant="dangerOutline" block onClick=\{\(\) => setConfirmingCancel\(true\)\}>/, "cancelar queda separado, al final");
  assert.match(modal, /<Button variant="danger" onClick=\{handleCancel\} busy=\{pending\}>/);
  assert.equal([...modal.matchAll(/data-autofocus/g)].length >= 3, true);
  assert.match(modal, /\[reschedulingOpen, reschedulePreview !== null, confirmingCancel\]/);
});

test("Nueva clase / serie: conserva la clave de idempotencia por borrador, el eco de valores y la rotación; una única acción principal y Cancelar de poco peso", () => {
  const form = code("app/(app)/calendario/nueva/new-lesson-form.tsx");
  assert.match(form, /useDraftOperationId\("teacherflow:calendario:nueva:operacion"\)/);
  assert.match(form, /shouldRotateOperationId\(state\.createdOperationId, operationId\)/);
  assert.match(form, /<input type="hidden" name="operationId" value=\{operationId \?\? ""\} \/>/);
  assert.match(form, /<input type="hidden" name="weeksJson" value=\{weeksJson\} \/>/);
  assert.match(form, /createSingleLessonAction\(prevState, formData\) : createRecurrenceSeriesAction\(prevState, formData\)/);
  assert.equal([...form.matchAll(/variant="primary"/g)].length, 1);
  assert.match(form, /href="\/calendario" variant="ghost"/);
});

test("Series: Finalizar sigue siendo directo (sin confirmación nueva), «Editar futuras» divide sin vista previa «así queda» y Finalizar queda separada de las acciones normales", () => {
  const actions = code("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(actions, /<Button variant="dangerGhost" disabled=\{pending\} onClick=\{\(\) => applyStatus\("ended"\)\} className="sm:ml-auto">/);
  assert.match(actions, /editFutureRecurrenceAction\(\{\}, formData\)/);
  assert.match(actions, /changeParticipantsAction\(\{/);
  assert.match(actions, /Dividir: «esta y las siguientes»/);
  assert.doesNotMatch(actions, /Así queda|Tramo nuevo|Tramo actual/, "la propuesta «así queda» no se implementa");
  assert.doesNotMatch(actions, /<Dialog/, "Finalizar no abre un diálogo nuevo");
  const view = code("components/calendar/series-list-view.tsx");
  assert.match(view, /Sin alumnos asignados/);
  assert.match(view, /Tramo anterior:/);
});

test("Registro: ningún diálogo de confirmación antes de finalizar, «Finalizar registro» sólo aparece con todos completos y el borrador de edición conserva su clave", () => {
  const ws = code("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.doesNotMatch(ws, /<Dialog|confirmingFinalize|¿Finalizar/, "no hay confirmación previa");
  // Un grupo incompleto sólo ofrece «Guardar progreso»; «Finalizar registro» aparece únicamente con todos completos (en una clase individual, «Guardar registro»).
  assert.match(ws, /countsAsClass && isGroup && !allComplete \? \(\s*<>\s*<Button variant="primary" size="lg" onClick=\{handleSaveProgress\}/);
  assert.match(ws, /<Button variant="primary" size="lg" onClick=\{handleFinalize\}/);
  assert.match(ws, /useDraftOperationId\(`teacherflow:registro-edit:\$\{registration\.id\}`\)/);
  assert.match(ws, /editCompletedRegistrationAction\(\{/);
  assert.match(ws, /finalizeRegistrationAction\(\{ lessonRegistrationId: registration\.id, \.\.\.headerFields \}\)/);
  assert.match(ws, /aria-expanded=\{isOpen\}/);
  const form = code("app/(app)/registro/nuevo/nuevo-registro-form.tsx");
  assert.match(form, /useDraftOperationId\(ADHOC_OPERATION_ID_STORAGE_KEY\)/);
  assert.equal([...form.matchAll(/variant="primary"/g)].length, 1);
});

test("Las vistas nuevas sólo dibujan: sin repositorios ni consultas (las páginas resuelven los datos como antes)", () => {
  for (const file of ["components/calendar/calendar-view.tsx", "components/calendar/series-list-view.tsx", "components/registro/pending-list-view.tsx", "components/registro/registro-page-frame.tsx"]) {
    const source = code(file);
    assert.doesNotMatch(source, /import (?!type)[^;]*lib\/repositories/, `${file}: sin repositorios`);
    assert.doesNotMatch(source, /supabase|requireAuthenticatedDbContext|fetch\(|\.rpc\(|"use server"/, `${file}: sin acceso a datos`);
  }
  assert.match(code("app/(app)/calendario/page.tsx"), /loadCalendarViewForRange\(ctx, new Date\(rangeStartIso\), new Date\(rangeEndIso\)\)/);
  assert.match(code("app/(app)/registro/page.tsx"), /buildPendingLessons\(\{ calendarItems: items, now, registrations, legacyRegisteredOccurrences \}\)/);
  assert.match(code("app/(app)/calendario/series/page.tsx"), /Promise\.all\(\[listRecurrenceRules\(ctx\), listStudents\(ctx\), loadExcludedStudentIds\(ctx\)\]\)/);
});
