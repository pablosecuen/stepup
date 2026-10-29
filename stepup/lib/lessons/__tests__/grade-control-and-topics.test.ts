import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSkillGradeValue } from "../grades.ts";
import { applyPendingToTopics, editIndexKey, editTextKey } from "../pending-drafts.ts";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("la escala NO cambió: 1 a 10 en pasos de 1; 0, vacío o fuera de rango = «sin calificar» (nunca se guarda un 0)", () => {
  for (let grade = 1; grade <= 10; grade++) assert.equal(normalizeSkillGradeValue(grade), grade);
  for (const none of [0, null, undefined, 11, -1, 2.5, Number.NaN]) assert.equal(normalizeSkillGradeValue(none as number | null | undefined), null);
});

test("control de calificación: elección directa 1–10, área táctil de 48 px, sin barra y con limpieza independiente", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  const field = parts.slice(parts.indexOf("function SkillGradeField"), parts.indexOf("/** Cambio de un formulario de participante"));
  assert.match(field, /w-full max-w-\[320px\]/, "no ocupa todo el escritorio");
  assert.match(field, /onClick=\{\(\) => onChange\(null\)\}/, "se puede volver a sin calificar directamente");
  assert.match(field, /aria-label=\{`Dejar \$\{label\} sin calificar`\}/, "el botón identifica el criterio que limpia");
  assert.match(parts, /const GRADE_OPTIONS = \[1, 2, 3, 4, 5, 6, 7, 8, 9, 10\] as const/);
  assert.doesNotMatch(field, /type="range"|tf-grade|Bajar la nota|Subir la nota/);
  assert.match(field, /min-h-12 min-w-12/, "áreas táctiles de al menos 48×48");
  assert.match(field, /type="radio"[\s\S]*name=\{id\}/, "flechas nativas y grupo independiente por criterio");
  assert.match(field, /checked=\{value === grade\}/);
  assert.match(field, /onChange=\{\(\) => onChange\(normalizeSkillGradeValue\(grade\)\)\}/);
  assert.match(field, /"Sin calificar"/, "«sin calificar» sigue visible y distinto de una nota");
  assert.match(parts, /<fieldset className="flex min-w-0 flex-col gap-4">\n\s+<legend[^>]*>Notas por área/, "separación entre criterios");
  assert.match(field, /peer-focus-visible:outline/, "foco visible al recorrer las notas con teclado");
});

test("temas sin casilla «Visto» ni rótulo «Planificado»; agregar, editar y eliminar siguen igual y editar sólo cambia el texto (el estado guardado no se toca)", () => {
  for (const file of ["components/registro/pedagogical-content-editor.tsx", "components/registro/editable-text-list.tsx", "components/registro/lesson-content-card.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /type="checkbox"|Tema \$\{index \+ 1\} visto|>Visto<|Visto<\/|Planificado|planificado a visto|Marcar como visto/, file);
  }
  const editor = read("components/registro/pedagogical-content-editor.tsx");
  assert.match(editor, /topics: current\.topics\.map\(\(t, i\) => i === index \? \{ \.\.\.t, text \} : t\)/, "editar el texto no toca `status`");
  assert.match(editor, /onAdd=\{\(text\) => onChange\(\(current\) => \(\{ \.\.\.current, topics: \[\.\.\.current\.topics, \{ id: crypto\.randomUUID\(\), text, status: "planificado" \}\] \}\)\)\}/, "un tema nuevo conserva el estado interno por defecto");
  assert.doesNotMatch(editor, /status: seen/, "ningún camino cambia el estado de un tema");
  const saved = [{ id: "a", text: "Past perfect", status: "visto" as const }, { id: "b", text: "Modals", status: "planificado" as const }];
  const key = "contenido:temas";
  // Guardar con una edición abierta: sólo el texto cambia; el estado de cada tema anterior queda exactamente como estaba.
  const result = applyPendingToTopics(saved, { [editIndexKey(key)]: "0", [editTextKey(key)]: "Past perfect (revisado)" }, key, () => "n");
  assert.deepEqual(result.map((t) => [t.id, t.status]), [["a", "visto"], ["b", "planificado"]]);
  assert.deepEqual(applyPendingToTopics(saved, {}, key, () => "n"), saved, "guardar sin cambios devuelve los mismos temas con sus estados");
});
