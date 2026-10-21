import { test } from "node:test";
import assert from "node:assert/strict";
import { installWriteGuard, nextReadOnlyFlag, parseTransferState, READ_ONLY_FLAG_KEY, READ_ONLY_BANNER_TEXT, type GuardableStorage } from "../../../tools/legacy-readonly/mobile-patch/src/features/transfer/legacyReadOnly/core.ts";

/** Modo consulta de la app anterior: decisión del servidor, bandera pegajosa y guarda de escritura (con un AsyncStorage simulado). */

function fakeStorage() {
  const data = new Map<string, string>();
  const storage: GuardableStorage = {
    async setItem(k, v) { data.set(k, v); },
    async removeItem(k) { data.delete(k); },
    async mergeItem(k, v) { data.set(k, v); },
    async clear() { data.clear(); },
    async multiSet(es) { for (const [k, v] of es) data.set(k, v); },
    async multiRemove(ks) { for (const k of ks) data.delete(k); },
    async multiMerge(es) { for (const [k, v] of es) data.set(k, v); },
  };
  return { storage, data };
}

test("el estado del servidor se interpreta de forma estricta: cualquier cosa rara es «unknown»", () => {
  assert.equal(parseTransferState({ status: "frozen", frozen_at: "x" }), "frozen");
  assert.equal(parseTransferState({ status: "open" }), "open");
  for (const raw of [null, undefined, "frozen", 3, [], {}, { status: "FROZEN" }, { status: 1 }]) assert.equal(parseTransferState(raw), "unknown");
});

test("la bandera es pegajosa: sólo un «open» explícito la baja; un error o respuesta rara no reabre ni congela", () => {
  assert.equal(nextReadOnlyFlag(false, "frozen"), true);
  assert.equal(nextReadOnlyFlag(true, "unknown"), true, "un corte de red no reabre una app congelada");
  assert.equal(nextReadOnlyFlag(true, "open"), false, "reabrir el traslado desde el servidor la libera");
  assert.equal(nextReadOnlyFlag(false, "unknown"), false, "si nunca se supo, no bloquea");
  assert.equal(nextReadOnlyFlag(false, "open"), false);
});

test("en modo consulta ninguna escritura de datos pasa (setItem, merge, remove, multi*, clear); lo leído sigue intacto", async () => {
  const { storage, data } = fakeStorage();
  data.set("@teacherflow/students", "S");
  data.set("@teacherflow/payments", "P");
  let readOnly = true;
  const guard = installWriteGuard(storage, () => readOnly);
  await storage.setItem("@teacherflow/students", "CAMBIADO");
  await storage.mergeItem("@teacherflow/students", "CAMBIADO");
  await storage.removeItem("@teacherflow/payments");
  await storage.multiSet([["@teacherflow/students", "X"], ["@teacherflow/nuevo", "N"]]);
  await storage.multiMerge([["@teacherflow/students", "X"]]);
  await storage.multiRemove(["@teacherflow/students", "@teacherflow/payments"]);
  await storage.clear();
  assert.deepEqual([...data.entries()], [["@teacherflow/students", "S"], ["@teacherflow/payments", "P"]], "nada cambió ni se borró");
  assert.equal(guard.blockedCount(), 7);
  readOnly = false;
  await storage.setItem("@teacherflow/students", "ok");
  assert.equal(data.get("@teacherflow/students"), "ok", "sin modo consulta la app escribe como siempre");
});

test("la sesión y la propia bandera siguen permitidas; una escritura mixta guarda sólo lo permitido", async () => {
  const { storage, data } = fakeStorage();
  const guard = installWriteGuard(storage, () => true);
  await storage.setItem("sb-proyecto-auth-token", "T");
  await storage.setItem(READ_ONLY_FLAG_KEY, "1");
  await storage.multiSet([["sb-proyecto-auth-token", "T2"], ["@teacherflow/clases", "C"]]);
  await storage.multiRemove(["sb-proyecto-auth-token", "@teacherflow/clases"]);
  assert.equal(data.get(READ_ONLY_FLAG_KEY), "1");
  assert.equal(data.has("sb-proyecto-auth-token"), false, "la clave de sesión se pudo quitar: la guarda no altera la autenticación");
  assert.equal(data.has("@teacherflow/clases"), false);
  assert.equal(guard.blockedCount(), 2);
});

test("la guarda se puede quitar y el aviso es texto claro (no sólo color)", async () => {
  const { storage, data } = fakeStorage();
  const guard = installWriteGuard(storage, () => true);
  guard.uninstall();
  await storage.setItem("@teacherflow/x", "1");
  assert.equal(data.get("@teacherflow/x"), "1");
  assert.match(READ_ONLY_BANNER_TEXT, /modo consulta/);
  assert.match(READ_ONLY_BANNER_TEXT, /web/);
});
