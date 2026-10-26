import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPendingToList, applyPendingToTopics, editIndexKey, editTextKey, hasPendingDrafts, pendingText } from "../pending-drafts.ts";

test("lo escrito sin confirmar se incorpora al final de la lista una sola vez, sin espacios sobrantes", () => {
  assert.deepEqual(applyPendingToList(["Tiempos verbales"], { fortalezas: "  Organización  " }, "fortalezas"), ["Tiempos verbales", "Organización"]);
  assert.deepEqual(applyPendingToList(["a"], { otra: "x" }, "fortalezas"), ["a"], "otro campo no se mezcla");
  assert.deepEqual(applyPendingToList(["a"], { fortalezas: "   " }, "fortalezas"), ["a"], "un borrador vacío no agrega nada");
  assert.deepEqual(applyPendingToList([], {}, "fortalezas"), []);
});

test("una edición abierta se aplica EN SU LUGAR (mismo orden e identidad) y un texto vacío conserva el original", () => {
  const items = ["Tiempos verbales", "Dejar de cometer errores que ya le marqué muchas veces", "Vocabulario"];
  const key = "participante:x:areasToImprove";
  const edited = applyPendingToList(items, { [editIndexKey(key)]: "1", [editTextKey(key)]: "Dejar de repetir errores ya marcados" }, key);
  assert.deepEqual(edited, ["Tiempos verbales", "Dejar de repetir errores ya marcados", "Vocabulario"]);
  assert.deepEqual(applyPendingToList(items, { [editIndexKey(key)]: "1", [editTextKey(key)]: "  " }, key), items, "cancelar/vaciar conserva el original");
  assert.deepEqual(applyPendingToList(items, { [editIndexKey(key)]: "9", [editTextKey(key)]: "x" }, key), items, "una posición que ya no existe no toca nada");
  assert.deepEqual(applyPendingToList(items, { [editTextKey(key)]: "x" }, key), items, "sin posición no se edita nada (la posición 0 no se asume)");
  // edición + borrador de «agregar» a la vez
  assert.deepEqual(applyPendingToList(["a", "b"], { [editIndexKey("k")]: "0", [editTextKey("k")]: "A", k: "c" }, "k"), ["A", "b", "c"]);
});

test("temas: la edición abierta cambia SÓLO el texto (conserva id y estado «visto») y el borrador de «agregar» suma un tema planificado al final", () => {
  const topics = [{ id: "t1", text: "Writing an article", status: "visto" as const }, { id: "t2", text: "modals for speculation", status: "planificado" as const }];
  const key = "contenido:temas";
  const edited = applyPendingToTopics(topics, { [editIndexKey(key)]: "0", [editTextKey(key)]: "Writing an opinion article" }, key, () => "nuevo");
  assert.deepEqual(edited, [{ id: "t1", text: "Writing an opinion article", status: "visto" }, topics[1]], "mismo orden, id y estado");
  assert.deepEqual(applyPendingToTopics(topics, { [editIndexKey(key)]: "1", [editTextKey(key)]: "  " }, key, () => "nuevo"), topics, "vaciar/cancelar conserva el original");
  assert.deepEqual(applyPendingToTopics(topics, { [editTextKey(key)]: "x" }, key, () => "nuevo"), topics, "sin posición no se edita nada");
  assert.deepEqual(applyPendingToTopics(topics, { [key]: "  Reported speech " }, key, () => "nuevo"), [...topics, { id: "nuevo", text: "Reported speech", status: "planificado" }]);
  assert.deepEqual(applyPendingToTopics(topics, { [editIndexKey(key)]: "1", [editTextKey(key)]: "B", [key]: "C" }, key, () => "n").map((t) => [t.id, t.text, t.status]), [["t1", "Writing an article", "visto"], ["t2", "B", "planificado"], ["n", "C", "planificado"]]);
});

test("hasPendingDrafts y pendingText", () => {
  assert.equal(hasPendingDrafts({ a: "", b: "  " }), false);
  assert.equal(hasPendingDrafts({ a: "", b: "x" }), true);
  assert.equal(pendingText({ a: " hola " }, "a"), "hola");
  assert.equal(pendingText({}, "a"), "");
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("cableado: el campo «agregar» incorpora por Enter, «+» y al soltar el campo (✅ de iOS), una sola vez, y no envía ningún formulario", () => {
  const src = read("components/registro/draft-items.tsx");
  assert.match(src, /onBlur=\{commit\}/, "el ✅ de iOS no envía Enter: cierra el teclado y suelta el campo");
  assert.match(src, /event\.key !== "Enter" \|\| event\.nativeEvent\.isComposing/, "Enter sólo fuera de una composición (IME)");
  assert.match(src, /event\.preventDefault\(\);\n\s+commit\(\);/, "Enter nunca envía un formulario");
  assert.match(src, /const value = take\(\)\.trim\(\);/, "se toma y se vacía en el mismo instante: blur + click no duplican");
  assert.match(src, /onClick=\{commit\}/);
  assert.match(src, /enterKeyHint="done"/);
  // Las cinco listas (temas, objetivos, actividades, fortalezas, aspectos a mejorar) comparten UNA pieza: lista editable + campo «agregar».
  const list = read("components/registro/editable-text-list.tsx");
  assert.equal([...list.matchAll(/<AddItemRow /g)].length, 1);
  assert.match(read("components/registro/registration-form-parts.tsx"), /<EditableTextList\b/);
  const content = read("components/registro/pedagogical-content-editor.tsx");
  assert.equal([...content.matchAll(/<EditableTextList\b/g)].length, 2, "temas y la lista de objetivos/actividades");
  assert.doesNotMatch(content + read("components/registro/registration-form-parts.tsx") + list, /const \[(topicDraft|draft), set(TopicDraft|Draft)\]/, "ya no hay borradores locales que el guardado no vea");
});

test("cableado: Enter sigue siendo salto de línea en tareas, observaciones, notas y en la edición de un elemento (ningún manejador global ni en las áreas de texto)", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  const content = read("components/registro/pedagogical-content-editor.tsx");
  for (const source of [parts, content]) {
    for (const match of source.matchAll(/<TextArea[^>]*>/g)) assert.doesNotMatch(match[0], /onKeyDown|onKeyPress|onKeyUp/, `un TextArea no intercepta teclas: ${match[0].slice(0, 80)}`);
  }
  // La edición de un elemento: Enter NO se intercepta; sólo Escape (cancelar) y Ctrl/⌘+Enter (guardar).
  const list = read("components/registro/editable-text-list.tsx");
  const handler = list.slice(list.indexOf("onKeyDown={"), list.indexOf("/>", list.indexOf("onKeyDown={")));
  assert.match(handler, /event\.key === "Escape"/);
  assert.match(handler, /event\.key === "Enter" && \(event\.ctrlKey \|\| event\.metaKey\)/, "Enter solo no se intercepta: es un salto de línea");
  assert.doesNotMatch(read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx"), /addEventListener\("keydown"|onKeyDown/);
});

test("cableado: los tres guardados incorporan lo pendiente ANTES de enviar y los temas conservan su estado al editar su texto", () => {
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.equal([...ws.matchAll(/const \{ content: liveContent, forms: liveForms \} = takePendingDrafts\(\);/g)].length, 3, "completar alumno, guardar progreso y finalizar/guardar cambios");
  assert.match(ws, /topics: applyPendingToTopics\(content\.topics, pending, CONTENT_DRAFT_KEYS\.topics,/, "temas: edición abierta + agregado, igual que el resto de las listas");
  const editor = read("components/registro/pedagogical-content-editor.tsx");
  assert.match(editor, /topics: current\.topics\.map\(\(t, i\) => i === index \? \{ \.\.\.t, text \} : t\)/, "editar el texto no toca `status`");
  assert.match(editor, /\{ \.\.\.t, status: seen \? "visto" : "planificado" \}/);
});

test("cableado: cada elemento tiene Editar y Eliminar separados, muestra todo su texto (sin recorte ni alto fijo) y los campos usan 16 px (sin zoom en iOS)", () => {
  const list = read("components/registro/editable-text-list.tsx");
  assert.match(list, /aria-label=\{`Editar \$\{noun\} \$\{index \+ 1\}`\}/);
  assert.match(list, /aria-label=\{`Eliminar \$\{noun\} \$\{index \+ 1\}`\}/);
  assert.match(list, /Guardar cambio/);
  assert.match(list, /Cancelar/);
  const start = list.indexOf('<li key={index} className="flex min-w-0 items-start gap-1');
  const row = list.slice(start, list.indexOf("</li>", start));
  assert.doesNotMatch(row, /truncate|line-clamp|text-ellipsis|overflow-hidden|max-h-/, "ni trunca ni fija la altura");
  assert.match(row, /<div className="min-w-0 flex-1 py-\[11px\] pl-1">\n\s+<span className="block whitespace-pre-wrap text-\[16px\] leading-snug text-textPrimary \[overflow-wrap:anywhere\]">/, "el texto tiene su propio espacio, independiente de los botones, a 16 px");
  assert.match(row, /h-11 w-11/, "área táctil de 44 px por botón");
  assert.match(read("components/ui/auto-grow-textarea.tsx"), /element\.style\.height = `\$\{element\.scrollHeight \+ borders\}px`/, "la edición crece con su contenido");
  assert.match(read("components/ui/field.tsx"), /px-3\.5 text-\[16px\]/);
});

test("cableado: los saltos de línea de observaciones y tareas se ven donde se leen (perfil del alumno)", () => {
  assert.match(read("components/students/profile/progreso-tab.tsx"), /whitespace-pre-wrap[^"]*"[^>]*>\{entry\.evaluation\.individualObservation\}/);
  assert.match(read("components/students/profile/tareas-tab.tsx"), /whitespace-pre-wrap[^"]*"[^>]*>\{task\.description\}/);
  assert.match(read("components/students/profile/resumen-tab.tsx"), /whitespace-pre-wrap \[overflow-wrap:anywhere\]">\s*\{task\.description\}/);
});

test("cableado: cancelar una edición la descarta (el campo de edición no confirma al perder el foco) y sólo «Guardar cambio»/Ctrl+Enter la aplican", () => {
  const list = read("components/registro/editable-text-list.tsx");
  const editBlock = list.slice(list.indexOf("editingIndex === index ? ("), list.indexOf(") : (", list.indexOf("editingIndex === index ? (")));
  assert.doesNotMatch(editBlock, /onBlur/, "perder el foco no confirma una edición");
  assert.match(editBlock, /finishEdit\(false\)/);
  assert.match(list, /edit\.take\(\)\.trim\(\);\n\s+editIndex\.take\(\);\n\s+if \(!confirm/, "cancelar vacía el borrador de edición y su posición antes de salir");
  assert.match(list, /if \(editingIndex !== null && editingIndex !== index\) finishEdit\(true\);/, "abrir otra edición aplica antes la que estaba abierta (nunca se pierde)");
  assert.match(list, /onEditText\(index, text\);/, "editar sólo cambia el texto en su posición");
});

test("cableado: los tres guardados del registro guardan antes la descripción de foto escrita sin soltar el campo (en iOS tocar un botón no la suelta)", () => {
  const files = read("components/registro/lesson-files-editor.tsx");
  assert.match(files, /export async function flushPendingCaptions\(\)/);
  assert.match(files, /captionFlushers\.add\(flush\)/);
  assert.match(files, /if \(inflight\.current\) return inflight\.current;/, "un solo guardado a la vez");
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.equal([...ws.matchAll(/startTransition\(async \(\) => \{\n\s+await flushPendingCaptions\(\);/g)].length, 3);
});
