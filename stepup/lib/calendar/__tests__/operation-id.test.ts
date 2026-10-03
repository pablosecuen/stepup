import { test } from "node:test";
import assert from "node:assert/strict";
import { MISSING_OPERATION_ID_MESSAGE, parseOperationId, shouldRotateOperationId } from "../operation-id.ts";

const A = "4f7c2f0e-9a3b-4c1d-8e55-0a1b2c3d4e5f";
const B = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

test("parseOperationId: acepta un UUID (con espacios y mayúsculas) y lo normaliza a minúsculas", () => {
  assert.equal(parseOperationId(A), A);
  assert.equal(parseOperationId(`  ${A.toUpperCase()}  `), A);
});

test("parseOperationId: falta, vacío o mal formado -> null (nunca se genera uno nuevo en el servidor)", () => {
  for (const raw of [undefined, null, "", "   ", "abc", "4f7c2f0e-9a3b-4c1d-8e55-0a1b2c3d4e5", `${A}0`, "' or 1=1 --"]) {
    assert.equal(parseOperationId(raw as string | null | undefined), null, String(raw));
  }
});

test("el mensaje de clave faltante es humano y accionable", () => {
  assert.match(MISSING_OPERATION_ID_MESSAGE, /Recargá la página/);
});

test("shouldRotateOperationId: rota sólo cuando la confirmación del servidor corresponde a la clave ACTUAL", () => {
  assert.equal(shouldRotateOperationId(A, A), true);
});

test("shouldRotateOperationId: sin confirmación, sin clave cargada, o confirmación de una clave vieja -> no rota", () => {
  assert.equal(shouldRotateOperationId(undefined, A), false, "respuesta de error: la clave se conserva para el reintento");
  assert.equal(shouldRotateOperationId(A, null), false, "todavía no hay clave en el cliente");
  assert.equal(shouldRotateOperationId(A, B), false, "estado viejo tras haber rotado: nunca rota dos veces");
});

test("ciclo completo: respuesta perdida conserva la clave, confirmación la rota, el estado viejo no vuelve a rotarla", () => {
  let current: string | null = A;
  const lostResponse = { createdOperationId: undefined };
  if (shouldRotateOperationId(lostResponse.createdOperationId, current)) current = B;
  assert.equal(current, A, "tras una falla de red el reintento usa la MISMA clave");
  const confirmed = { createdOperationId: A };
  if (shouldRotateOperationId(confirmed.createdOperationId, current)) current = B;
  assert.equal(current, B, "tras la confirmación canónica el siguiente borrador usa una clave nueva");
  if (shouldRotateOperationId(confirmed.createdOperationId, current)) current = "otra";
  assert.equal(current, B, "el mismo estado confirmado no rota de nuevo");
});
