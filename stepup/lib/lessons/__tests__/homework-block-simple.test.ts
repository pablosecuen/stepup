import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * «Tarea para la próxima clase» (29/10/2026): sólo dos campos — «Tarea para realizar» y «Fecha de entrega (opcional)». Ya no existe el apartado
 * «Próximas clases reales» ni su selector «Elegir una clase…», y guardar una tarea nunca exige elegir una clase futura. La tarea sigue guardándose
 * por alumno y apareciendo como pendiente en la próxima clase (eso vive en el modelo, no en este control).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const PARTS = "components/registro/registration-form-parts.tsx";
const WORKSPACE = "app/(app)/registro/[calendarLessonId]/registration-workspace.tsx";

test("el selector de próximas clases reales no existe en ninguna parte: ni componente, ni contexto, ni acción de servidor, ni textos", () => {
  assert.equal(existsSync(join(ROOT, "components/registro/homework-schedule.tsx")), false);
  for (const file of [PARTS, WORKSPACE, "lib/actions/calendar-parity.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /Próximas clases reales|Elegir una clase|Elegir próxima clase|Sin próximas clases|HomeworkDateChoices|HomeworkScheduleContext|nextHomeworkDatesAction|homework-schedule/, file);
  }
});

test("HomeworkFields muestra exactamente «Tarea para realizar» y «Fecha de entrega (opcional)», sin ningún <select>", () => {
  const parts = code(PARTS);
  const fields = parts.slice(parts.indexOf("export function HomeworkFields"), parts.indexOf("export function PersonalizedHomework"));
  assert.match(fields, /label="Tarea para realizar"/);
  assert.match(fields, /label="Fecha de entrega \(opcional\)"/);
  assert.match(fields, /type="date"/);
  assert.doesNotMatch(fields, /<select|<option|studentId/);
  assert.equal((fields.match(/<Field /g) ?? []).length, 2, "dos campos y nada más");
  assert.match(fields, /onDescriptionChange\(e\.target\.value\)/);
  assert.match(fields, /onDueDateChange\(e\.target\.value\)/);
});

test("la tarea común y la personalizada por alumno usan el mismo par de campos, y la personalizada sigue pudiendo guardar su descripción y su fecha", () => {
  const parts = code(PARTS);
  assert.match(parts, /<HomeworkFields idPrefix=\{id\} ariaSuffix=\{` de \$\{studentName\}`\} description=\{form\.homeworkDescription\} dueDate=\{form\.homeworkDueDate\}/);
  assert.match(parts, /onChange\(\{ homeworkDescription: "", homeworkDueDate: "" \}\)/, "desactivar la personalización limpia ambas, como antes");
  const workspace = code(WORKSPACE);
  assert.match(workspace, /<Block title="Tarea para la próxima clase">\s*<HomeworkFields\s+idPrefix=\{homeworkId\}\s+description=\{commonHomeworkDescription\}\s+dueDate=\{commonHomeworkDueDate\}/);
});

test("guardar la tarea no depende de ninguna clase futura elegida", () => {
  const workspace = code(WORKSPACE);
  assert.doesNotMatch(workspace, /nextClass|upcomingLesson|selectedLesson|homeworkLesson/i);
  assert.match(workspace, /homeworkDueDate/);
});
