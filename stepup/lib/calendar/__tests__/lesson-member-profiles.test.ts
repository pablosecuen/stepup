import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveParticipantNames, resolveParticipantProfiles } from "../occurrences.ts";

test("las fichas conservan la identidad aunque haya alumnos desconocidos entre los participantes", () => {
  const students = new Map([["sofia", { name: "Sofia Riviere" }], ["victoria", { name: "Victoria Riviere" }], ["milagros", { name: "Milagros Mosciaro" }]]);
  const ids = ["desconocido", "milagros", "sofia", "victoria", "milagros"];
  assert.deepEqual(resolveParticipantProfiles("sofia", ids, students), [
    { id: "sofia", name: "Sofia Riviere" },
    { id: "milagros", name: "Milagros Mosciaro" },
    { id: "victoria", name: "Victoria Riviere" },
  ]);
  assert.deepEqual(resolveParticipantNames("sofia", ids, students), ["Sofia Riviere", "Milagros Mosciaro", "Victoria Riviere"]);
});

test("dos alumnos homónimos tienen accesos distintos; no se eliminan por compartir nombre", () => {
  const students = new Map([["uno", { name: "Ana Pérez" }], ["dos", { name: "Ana Pérez" }]]);
  assert.deepEqual(resolveParticipantProfiles("dos", ["uno", "dos"], students), [{ id: "dos", name: "Ana Pérez" }, { id: "uno", name: "Ana Pérez" }]);
  assert.deepEqual(resolveParticipantProfiles(null, ["ausente"], students), []);
});
