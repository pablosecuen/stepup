import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildStudentPickerView, hasExactNameMatch, selectedStudentsInOrder, type PickableStudent } from "../picker.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");

const STUDENTS: PickableStudent[] = [
  { id: "1", name: "Juan Pablo Fernández Ruiz", status: "activo", level: "A2" },
  { id: "2", name: "María de los Ángeles Gómez", status: "activo", level: "B1" },
  { id: "3", name: "José García", status: "activo", level: "C1" },
  { id: "4", name: "Josefina Muñoz", status: "activo", level: "A1" },
  { id: "5", name: "Ana Clara Medina", status: "activo", level: "B2" },
  { id: "6", name: "Martina Gómez", status: "pausado", level: "B1" },
];

test("sin búsqueda: todos los alumnos, por nombre, y el encabezado dice cuántos hay", () => {
  const view = buildStudentPickerView(STUDENTS, "");
  assert.deepEqual(view.items.map((s) => s.name), ["Ana Clara Medina", "José García", "Josefina Muñoz", "Juan Pablo Fernández Ruiz", "María de los Ángeles Gómez", "Martina Gómez"]);
  assert.equal(view.header, "6 alumnos disponibles");
  assert.equal(buildStudentPickerView(STUDENTS.slice(0, 1), "   ").header, "1 alumno disponible");
  assert.deepEqual(buildStudentPickerView(STUDENTS, "   ").items.length, 6, "una búsqueda de puros espacios es una búsqueda vacía");
  assert.equal(buildStudentPickerView([], "ana").header, "No hay alumnos cargados");
});

test("con búsqueda: sólo las coincidencias (tildes, mayúsculas, orden de palabras, iniciales y errores chicos de tipeo), por relevancia y con su recuento", () => {
  assert.deepEqual(buildStudentPickerView(STUDENTS, "JOSE").items.map((s) => s.name), ["José García", "Josefina Muñoz"]);
  assert.equal(buildStudentPickerView(STUDENTS, "jose").header, "2 coincidencias");
  assert.equal(buildStudentPickerView(STUDENTS, "ana clara").header, "1 coincidencia");
  assert.deepEqual(buildStudentPickerView(STUDENTS, "gomez maria").items.map((s) => s.id), ["2", "6"], "apellido + nombre, sin importar el orden");
  assert.ok(buildStudentPickerView(STUDENTS, "jp").items.some((s) => s.id === "1"), "iniciales");
  assert.ok(buildStudentPickerView(STUDENTS, "mariana gomes").items.some((s) => s.id === "6"), "un error de tipeo no impide encontrarlo");
  const none = buildStudentPickerView(STUDENTS, "zzzz");
  assert.deepEqual([none.items.length, none.header, none.query], [0, "Ninguna coincidencia", "zzzz"]);
  assert.equal(buildStudentPickerView(STUDENTS, "  ana  ").query, "ana", "la consulta sale sin espacios de los extremos");
});

test("la búsqueda sólo filtra lo que se ve: los elegidos se conservan aunque queden fuera del resultado, al cambiar la búsqueda y al borrarla", () => {
  const selected = new Set(["3", "5"]); // José García y Ana Clara Medina
  // Se busca otra cosa: ninguno de los dos aparece en el resultado, pero siguen elegidos y a la vista.
  const view = buildStudentPickerView(STUDENTS, "gomez");
  assert.ok(view.items.every((s) => !selected.has(s.id)));
  assert.deepEqual(selectedStudentsInOrder(STUDENTS, selected).map((s) => s.name), ["José García", "Ana Clara Medina"], "en el orden de la lista completa");
  // Una búsqueda que no encuentra nada tampoco los suelta.
  assert.equal(buildStudentPickerView(STUDENTS, "zzzz").items.length, 0);
  assert.equal(selectedStudentsInOrder(STUDENTS, selected).length, 2);
  // Al borrar la búsqueda vuelve la lista completa y los dos siguen elegidos.
  const cleared = buildStudentPickerView(STUDENTS, "");
  assert.equal(cleared.items.length, STUDENTS.length);
  assert.deepEqual(cleared.items.filter((s) => selected.has(s.id)).map((s) => s.id).sort(), ["3", "5"]);
  // Acepta también un arreglo de ids, y descarta un id que ya no existe.
  assert.deepEqual(selectedStudentsInOrder(STUDENTS, ["5", "no-existe"]).map((s) => s.id), ["5"]);
});

test("nombre escrito igual a un alumno (sin tildes ni mayúsculas): se detecta; uno parcial, no", () => {
  assert.equal(hasExactNameMatch(STUDENTS, "jose garcia"), true);
  assert.equal(hasExactNameMatch(STUDENTS, "  JOSÉ   GARCÍA "), true);
  assert.equal(hasExactNameMatch(STUDENTS, "jose"), false);
  assert.equal(hasExactNameMatch(STUDENTS, ""), false);
});

test("cableado: todos los selectores de alumnos usan el mismo componente con buscador; Nueva clase manda los elegidos como campos ocultos", () => {
  const picker = read("components/students/student-picker.tsx");
  assert.match(picker, /MagnifyingGlassIcon/, "la lupa");
  assert.match(picker, /aria-label="Borrar búsqueda de alumno"/, "el botón de borrar");
  assert.match(picker, /Buscar por nombre o apellido/);
  assert.match(picker, /<input key=\{student\.id\} type="hidden" name=\{hiddenInputName\} value=\{student\.id\} \/>/, "los elegidos viajan aunque su fila esté oculta");
  assert.match(picker, /event\.key === "Enter"\) event\.preventDefault\(\)/, "Enter en el buscador no envía el formulario");
  const lesson = read("app/(app)/calendario/nueva/new-lesson-form.tsx");
  assert.match(lesson, /<StudentPicker students=\{pickableStudents\} selectedIds=\{selected\} onToggle=\{toggleStudent\} hiddenInputName="participantIds" \/>/);
  assert.doesNotMatch(lesson, /type="checkbox" name="participantIds"/, "ya no depende de casillas visibles");
  const adhoc = read("app/(app)/registro/nuevo/nuevo-registro-form.tsx");
  assert.match(adhoc, /<StudentPicker students=\{students\}/);
  assert.doesNotMatch(adhoc, /toLowerCase\(\)\.includes\(q\)/, "sin el filtro de texto simple de antes");
  const series = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(series, /<StudentPicker students=\{pickableStudents\}/);
  // El motor es uno solo: ninguna pantalla vuelve a filtrar con includes().
  const engine = read("lib/students/search.ts");
  assert.match(engine, /export function searchStudentsByName/);
  assert.match(engine, /damerauLevenshteinDistance/);
});
