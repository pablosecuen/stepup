import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPendingToList, editIndexKey, editTextKey, hasPendingDrafts, pendingText } from "../pending-drafts.ts";

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
  // Los tres editores comparten la misma pieza.
  assert.match(read("components/registro/registration-form-parts.tsx"), /<AddItemRow /);
  const content = read("components/registro/pedagogical-content-editor.tsx");
  assert.equal([...content.matchAll(/<AddItemRow /g)].length, 2, "temas y la lista de objetivos/actividades");
  assert.doesNotMatch(content + read("components/registro/registration-form-parts.tsx"), /const \[(topicDraft|draft), set(TopicDraft|Draft)\]/, "ya no hay borradores locales que el guardado no vea");
});

test("cableado: Enter sigue siendo salto de línea en tareas, observaciones y notas (ningún manejador global ni en las áreas de texto)", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  const content = read("components/registro/pedagogical-content-editor.tsx");
  for (const source of [parts, content]) {
    for (const match of source.matchAll(/<TextArea[^>]*>/g)) assert.doesNotMatch(match[0], /onKeyDown|onKeyPress|onKeyUp/, `un TextArea no intercepta teclas: ${match[0].slice(0, 80)}`);
  }
  assert.doesNotMatch(read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx"), /addEventListener\("keydown"|onKeyDown/);
});

test("cableado: los tres guardados incorporan lo pendiente ANTES de enviar y los temas conservan su estado al editar su texto", () => {
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.equal([...ws.matchAll(/const \{ content: liveContent, forms: liveForms \} = takePendingDrafts\(\);/g)].length, 3, "completar alumno, guardar progreso y finalizar/guardar cambios");
  const editor = read("components/registro/pedagogical-content-editor.tsx");
  assert.match(editor, /topics: current\.topics\.map\(\(t, i\) => i === index \? \{ \.\.\.t, text \} : t\)/, "editar el texto no toca `status`");
  assert.match(editor, /\{ \.\.\.t, status: seen \? "visto" : "planificado" \}/);
});

test("cableado: las etiquetas tienen Editar y Quitar separados, se adaptan al texto (sin recorte ni alto fijo) y los campos usan 16 px (sin zoom en iOS)", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  assert.match(parts, /aria-label=\{`Editar \$\{item\}`\}/);
  assert.match(parts, /aria-label=\{`Quitar \$\{item\}`\}/);
  assert.match(parts, /Guardar cambio/);
  assert.match(parts, /Cancelar/);
  const chip = parts.slice(parts.indexOf("<li key={`${index}-${item}`}"), parts.indexOf("</li>", parts.indexOf("<li key={`${index}-${item}`}")));
  assert.doesNotMatch(chip, /truncate|line-clamp|text-ellipsis|overflow-hidden|\bh-\[\d+px\]\s+rounded-pill border|max-h-/, "ni trunca ni fija la altura");
  assert.match(chip, /<span className="min-w-0 flex-1 py-2 \[overflow-wrap:anywhere\]">/, "el texto tiene su propio espacio, independiente de los botones");
  assert.match(chip, /h-10 w-10/, "área táctil de 40 px por botón");
  assert.match(read("components/ui/field.tsx"), /px-3\.5 text-\[16px\]/);
});

test("cableado: los saltos de línea de observaciones y tareas se ven donde se leen (perfil del alumno)", () => {
  assert.match(read("components/students/profile/progreso-tab.tsx"), /whitespace-pre-wrap[^"]*"[^>]*>\{entry\.evaluation\.individualObservation\}/);
  assert.match(read("components/students/profile/tareas-tab.tsx"), /whitespace-pre-wrap[^"]*"[^>]*>\{task\.description\}/);
  assert.match(read("components/students/profile/resumen-tab.tsx"), /whitespace-pre-wrap \[overflow-wrap:anywhere\]">\s*\{task\.description\}/);
});

test("cableado: cancelar una edición la descarta (el campo de edición no confirma al perder el foco) y sólo «Guardar cambio»/Enter la aplican", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  const editBlock = parts.slice(parts.indexOf("editingIndex === index ? ("), parts.indexOf(") : (", parts.indexOf("editingIndex === index ? (")));
  assert.doesNotMatch(editBlock, /onBlur/, "perder el foco no confirma una edición");
  assert.match(editBlock, /finishEdit\(false\)/);
  assert.match(parts, /edit\.take\(\)\.trim\(\);\n\s+editIndex\.take\(\);\n\s+if \(!confirm/, "cancelar vacía el borrador de edición y su posición antes de salir");
});

test("cableado: los tres guardados del registro guardan antes la descripción de foto escrita sin soltar el campo (en iOS tocar un botón no la suelta)", () => {
  const files = read("components/registro/lesson-files-editor.tsx");
  assert.match(files, /export async function flushPendingCaptions\(\)/);
  assert.match(files, /captionFlushers\.add\(flush\)/);
  assert.match(files, /if \(inflight\.current\) return inflight\.current;/, "un solo guardado a la vez");
  const ws = read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx");
  assert.equal([...ws.matchAll(/startTransition\(async \(\) => \{\n\s+await flushPendingCaptions\(\);/g)].length, 3);
});
