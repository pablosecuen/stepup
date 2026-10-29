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

test("control de calificación: compacto, zona táctil de 48 px, botones «−» y «+» de 48×48, valor junto al nombre y misma escala", () => {
  const parts = read("components/registro/registration-form-parts.tsx");
  const field = parts.slice(parts.indexOf("function SkillGradeField"), parts.indexOf("/** Cambio de un formulario de participante"));
  assert.match(field, /w-full max-w-\[320px\]/, "opción C: barra corta también en escritorio");
  assert.match(field, /onClick=\{\(\) => onChange\(null\)\}/, "se puede volver a sin calificar directamente");
  assert.match(field, /aria-label=\{`Dejar \$\{label\} sin calificar`\}/, "el botón identifica el criterio que limpia");
  assert.match(field, /min=\{GRADE_MIN\}[\s\S]*max=\{GRADE_MAX\}[\s\S]*step="1"/);
  assert.match(parts, /const GRADE_MIN = 0;\nconst GRADE_MAX = 10;/);
  assert.match(parts, /const STEP_BUTTON =\s*"inline-flex h-12 w-12 /, "botones de 48×48");
  assert.match(field, /Bajar la nota de/);
  assert.match(field, /Subir la nota de/);
  assert.match(field, /disabled=\{current <= GRADE_MIN\}/);
  assert.match(field, /disabled=\{current >= GRADE_MAX\}/);
  assert.match(field, /"Sin calificar"/, "«sin calificar» sigue visible y distinto de una nota");
  assert.match(field, /className="tf-grade min-w-0 flex-1"/);
  assert.match(field, /onChange=\{\(e\) => onChange\(normalizeSkillGradeValue\(Number\(e\.target\.value\)\)\)\}/, "clic en la pista y arrastre actualizan el valor");
  assert.match(parts, /<fieldset className="flex min-w-0 flex-col gap-4">\n\s+<legend[^>]*>Notas por área/, "separación entre criterios");
  const css = read("app/globals.css");
  const grade = css.slice(css.indexOf(".tf-grade {"), css.indexOf("/* Tabla apilable"));
  assert.match(grade, /height: 48px;/);
  assert.match(grade, /touch-action: pan-y pinch-zoom;/, "el scroll vertical y el zoom de la página siguen funcionando (sin bloqueos globales)");
  assert.equal([...grade.matchAll(/width: 44px;\n\s+height: 30px;/g)].length, 2, "tirador rectangular en WebKit y Firefox");
  assert.equal([...grade.matchAll(/border-radius: 8px;/g)].length, 2, "bordes suaves en ambos navegadores");
  assert.doesNotMatch(grade, /overflow: hidden|user-scalable|maximum-scale/);
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
