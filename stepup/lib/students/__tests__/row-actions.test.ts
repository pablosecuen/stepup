// Acciones de cada fila de la lista de alumnos: qué se ofrece según el estado y que cada destino lleve el id de ESA fila.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStudentRowActions } from "../row-actions.ts";

const keys = (status: "activo" | "pausado" | "inactivo" | "archivado", nextClassStart: string | null) => buildStudentRowActions({ id: "abc", status, nextClassStart }).map((a) => a.key);

test("un alumno activo con próxima clase ofrece todos los accesos", () => {
  assert.deepEqual(keys("activo", "2026-11-02T13:00:00.000Z"), ["perfil", "registrar_clase", "registrar_pago", "reprogramar", "reporte", "editar", "cambiar_estado"]);
});

test("sin próxima clase no hay «reprogramar»; un alumno que no está activo no registra ni reprograma clases", () => {
  assert.ok(!keys("activo", null).includes("reprogramar"));
  for (const status of ["pausado", "inactivo", "archivado"] as const) {
    const available = keys(status, "2026-11-02T13:00:00.000Z");
    assert.ok(!available.includes("registrar_clase") && !available.includes("reprogramar"), status);
    assert.ok(available.includes("registrar_pago") && available.includes("cambiar_estado"));
  }
});

test("cada destino lleva el id de la fila (nunca otro alumno) y el cambio de estado lleva a la ficha", () => {
  const actions = buildStudentRowActions({ id: "a b/ñ", status: "archivado", nextClassStart: null });
  for (const action of actions) assert.ok(action.href.includes(encodeURIComponent("a b/ñ")), action.key);
  const state = actions.find((a) => a.key === "cambiar_estado");
  assert.equal(state?.label, "Restaurar alumno");
  assert.ok(state?.href.endsWith("#cambiar-estado"));
  assert.equal(buildStudentRowActions({ id: "x", status: "activo", nextClassStart: null }).find((a) => a.key === "cambiar_estado")?.label, "Archivar o cambiar estado");
});

test("no se ofrece la eliminación definitiva", () => {
  assert.ok(!buildStudentRowActions({ id: "x", status: "activo", nextClassStart: null }).some((a) => /elimin/i.test(a.label)));
});
