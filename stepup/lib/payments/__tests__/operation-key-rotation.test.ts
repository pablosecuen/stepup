// 12/11/2026 (QA): un segundo pago sobre el MISMO cobro se perdía en silencio. La clave de operación (`useDraftOperationId`) se borraba del almacenamiento pero el componente —que sigue
// montado después de `router.refresh()`— conservaba la clave vieja en su estado; el servidor tomaba el segundo envío por un reintento del primero, devolvía el pago anterior como «éxito» y no
// escribía nada. Regla: un componente que sigue en pantalla después de una operación confirmada tiene que ROTAR la clave (`rotate`), no sólo borrarla.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { resolveDraftOperationId, rotateDraftOperationId, clearDraftOperationId } from "../../lessons/draft-operation-id-storage.ts";
import { OPERATION_CONFLICT_PREFIX, isOperationConflict } from "../operation-conflict.ts";
import { domainErrorMessage } from "../../errors/domain-error-message.ts";
import { NETWORK_ERROR_MESSAGE } from "../../actions/network-guard.ts";

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

// 12/11/2026 (tarea 4): protección del servidor. Misma clave + mismo contenido = reintento; misma clave + otros datos = error claro (migración 20261112100000, probada en Postgres real con
// supabase/tests/postgres/register_payment_operation_guard.cjs: 20/20 con la migración, 14/20 sin ella).
test("el rechazo del servidor por clave con otros datos llega a la persona con su texto y la pantalla lo reconoce", () => {
  const sql = read("supabase/migrations/20261112100000_register_payment_operation_guard.sql");
  assert.ok(sql.includes(`'${OPERATION_CONFLICT_PREFIX}`), "la migración usa el texto que reconoce la pantalla");
  assert.match(sql, /using errcode = '22023'/);
  assert.match(sql, /set search_path = ''/, "conserva el search_path fijo");
  assert.match(sql, /on conflict \(owner_id, operation_id\) where operation_id is not null do nothing/, "la idempotencia sigue siendo atómica por clave");
  for (const field of ["student_id", "amount", "method", "paid_at", "notes", "replaces_payment_id"]) assert.match(sql, new RegExp(`v_payment\\.${field} is distinct from`), field);
  assert.match(sql, /pa\.charge_id = v_charge_id/, "en modo cobro único también compara el cobro");
  assert.match(sql, /grant execute on function public\.register_payment\(jsonb\) to authenticated;/);
  assert.doesNotMatch(read("supabase/migrations/20260925100000_payments_engine.sql"), /ya se registró con otros datos/, "la migración histórica no se editó");
  const message = `${OPERATION_CONFLICT_PREFIX} (otro importe, cobro o fecha). Revisá los pagos del alumno antes de intentarlo de nuevo.`;
  assert.equal(domainErrorMessage({ code: "22023", message }), message, "el texto no se oculta detrás del genérico");
  assert.equal(isOperationConflict(message), true);
  assert.equal(isOperationConflict(NETWORK_ERROR_MESSAGE), false, "un fallo de red NO es un conflicto: conserva la clave");
  assert.equal(isOperationConflict("El importe supera el saldo pendiente de este cobro."), false, "una validación tampoco");
});

test("sólo el conflicto rota la clave tras un error; red y validaciones la conservan para reintentar la misma operación", () => {
  for (const file of ["components/payments/charge-actions.tsx", "components/registro/class-payment-prompt.tsx"]) {
    const source = read(file);
    assert.match(source, /isOperationConflict\(result\.error\)/, file);
  }
  const charge = read("components/payments/charge-actions.tsx");
  const submit = charge.slice(charge.indexOf("function submitPayment"), charge.indexOf("function submitVoid"));
  const errorBranch = submit.slice(submit.indexOf("if (result.error)"), submit.indexOf("rotateOperationId();", submit.indexOf("isOperationConflict")) + 120);
  assert.match(errorBranch, /isOperationConflict\(result\.error\)\) \{\n\s+rotateOperationId\(\);\n\s+router\.refresh\(\);/);
  assert.equal((submit.match(/rotateOperationId\(\)/g) ?? []).length, 2, "una vez ante el conflicto y una tras el éxito");
});