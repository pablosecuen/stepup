import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesStudentSearch } from "../search.ts";

test("matchesStudentSearch: búsqueda vacía coincide con cualquier nombre", () => {
  assert.equal(matchesStudentSearch("Ana Pérez", ""), true);
  assert.equal(matchesStudentSearch("Ana Pérez", "   "), true);
});

test("matchesStudentSearch: coincidencia exacta ignora mayúsculas y acentos", () => {
  assert.equal(matchesStudentSearch("Ana Pérez", "ana perez"), true);
  assert.equal(matchesStudentSearch("José María Núñez", "jose maria nunez"), true);
});

test("matchesStudentSearch: coincidencia por prefijo", () => {
  assert.equal(matchesStudentSearch("Alumno de ejemplo", "alu"), true);
  assert.equal(matchesStudentSearch("Alumno de ejemplo", "ALUM"), true);
});

test("matchesStudentSearch: multi-palabra sin importar el orden (apellido + nombre)", () => {
  assert.equal(matchesStudentSearch("Juan Pérez", "perez juan"), true);
  assert.equal(matchesStudentSearch("Juan Pérez", "pere jua"), true);
});

test("matchesStudentSearch: rechaza cuando ninguna palabra del nombre coincide", () => {
  assert.equal(matchesStudentSearch("Juan Pérez", "maria"), false);
});

test("matchesStudentSearch: rechaza cuando sólo UNA de dos palabras buscadas coincide (AND, no OR)", () => {
  assert.equal(matchesStudentSearch("Juan Pérez", "juan maria"), false);
});

test("matchesStudentSearch: ñ se normaliza a n", () => {
  assert.equal(matchesStudentSearch("Muñoz", "munoz"), true);
  assert.equal(matchesStudentSearch("Muñoz", "muñoz"), true);
});

test("matchesStudentSearch: nombre vacío nunca coincide con una búsqueda real", () => {
  assert.equal(matchesStudentSearch("", "ana"), false);
});
