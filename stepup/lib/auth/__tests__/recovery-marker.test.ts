import { test } from "node:test";
import assert from "node:assert/strict";
import { RECOVERY_MARKER_MAX_AGE_SECONDS, createRecoveryMarker, isValidRecoveryMarker } from "../recovery-marker.ts";

const USER = "03e8e8f0-ce45-4730-93ae-31dad3666195";
const OTHER = "11111111-2222-3333-4444-555555555555";
const NOW = 1_790_000_000_000;

test("marcador recién emitido para el mismo usuario es válido", () => {
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(USER, NOW), USER, NOW), true);
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(USER, NOW), USER, NOW + 60_000), true);
});

test("el marcador de OTRO usuario no vale (sesión vieja de otra cuenta en el dispositivo)", () => {
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(OTHER, NOW), USER, NOW), false);
});

test("vence a los 15 minutos exactos y no antes", () => {
  const marker = createRecoveryMarker(USER, NOW);
  const limit = RECOVERY_MARKER_MAX_AGE_SECONDS * 1000;
  assert.equal(isValidRecoveryMarker(marker, USER, NOW + limit), true);
  assert.equal(isValidRecoveryMarker(marker, USER, NOW + limit + 1), false);
});

test("un marcador del futuro (más de 1 minuto de desfase) no vale", () => {
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(USER, NOW + 120_000), USER, NOW), false);
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(USER, NOW + 30_000), USER, NOW), true, "desfase menor de reloj tolerado");
});

test("marcadores ausentes, vacíos, manipulados o con otra forma se rechazan", () => {
  for (const raw of [undefined, null, "", "x", `${USER}`, `${USER}.`, `${USER}.abc`, `.${NOW}`, `${USER}.${NOW}.extra`, `${USER};${NOW}`, `<script>.${NOW}`, `${USER}.-5`]) {
    assert.equal(isValidRecoveryMarker(raw, USER, NOW), false, String(raw));
  }
  assert.equal(isValidRecoveryMarker(createRecoveryMarker(USER, NOW), "", NOW), false, "sin usuario");
});
