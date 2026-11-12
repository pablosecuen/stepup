// 12/11/2026 (QA): un segundo pago sobre el MISMO cobro se perdía en silencio. La clave de operación (`useDraftOperationId`) se borraba del almacenamiento pero el componente —que sigue
// montado después de `router.refresh()`— conservaba la clave vieja en su estado; el servidor tomaba el segundo envío por un reintento del primero, devolvía el pago anterior como «éxito» y no
// escribía nada. Regla: un componente que sigue en pantalla después de una operación confirmada tiene que ROTAR la clave (`rotate`), no sólo borrarla.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveDraftOperationId, rotateDraftOperationId, clearDraftOperationId } from "../../lessons/draft-operation-id-storage.ts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function memoryStorage(): () => Storage {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, length: 0 } as Storage;
  return () => storage;
}

test("tras un pago confirmado, la clave siguiente es otra (el segundo pago del mismo cobro no se toma por reintento)", () => {
  const storage = memoryStorage();
  let n = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const first = resolveDraftOperationId(storage, "teacherflow:cobros:pago:c1", newId);
  assert.equal(resolveDraftOperationId(storage, "teacherflow:cobros:pago:c1", newId), first, "un reintento sin confirmar conserva la clave");
  const second = rotateDraftOperationId(storage, "teacherflow:cobros:pago:c1", newId);
  assert.notEqual(second, first, "después de confirmar, rotar da una clave nueva");
  assert.equal(resolveDraftOperationId(storage, "teacherflow:cobros:pago:c1", newId), second, "y esa clave nueva persiste hasta la próxima confirmación");
  clearDraftOperationId(storage, "teacherflow:cobros:pago:c1");
});

test("los componentes que siguen montados tras confirmar rotan la clave de operación (no sólo la borran)", () => {
  for (const file of ["components/payments/charge-actions.tsx", "components/payments/training-billing-config.tsx"]) {
    const source = read(file);
    assert.match(source, /rotate: rotateOperationId/, `${file}: usa rotate`);
    assert.match(source, /rotateOperationId\(\);/, `${file}: rota la clave al confirmar`);
    assert.doesNotMatch(source, /clear: clearOperationId|clearOperationId\(\)/, `${file}: ya no la deja vieja en el estado`);
  }
});

test("los errores conservan la clave para el reintento (sólo una respuesta exitosa la rota)", () => {
  const source = read("components/payments/charge-actions.tsx");
  const submit = source.slice(source.indexOf("function submitPayment"), source.indexOf("function submitVoid"));
  assert.ok(submit.indexOf("if (result.error)") < submit.indexOf("rotateOperationId()"), "primero se descarta el error, después se rota");
});
