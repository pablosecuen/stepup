import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearDraftOperationId,
  resolveDraftOperationId,
  rotateDraftOperationId,
  type DraftStorage,
} from "../draft-operation-id-storage.ts";

const KEY = "teacherflow:alumnos:nuevo:operacion";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `sessionStorage` de mentira: una por PESTAÑA (la duplicación copia su contenido; una pestaña nueva arranca vacía). */
class FakeSessionStorage implements DraftStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  /** Lo que hace el navegador al "Duplicar pestaña": la copia hereda el sessionStorage del momento. */
  duplicate(): FakeSessionStorage {
    const copy = new FakeSessionStorage();
    for (const [k, v] of this.data) copy.data.set(k, v);
    return copy;
  }
}

/** Generador determinista de UUID v4 válidos, para poder afirmar igualdad/diferencia. */
function sequence() {
  let n = 0;
  return () => {
    n += 1;
    const hex = n.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  };
}

test("la primera carga genera una clave UUID y la guarda en sessionStorage", () => {
  const storage = new FakeSessionStorage();
  const id = resolveDraftOperationId(() => storage, KEY, sequence());
  assert.match(id, UUID);
  assert.equal(storage.getItem(KEY), id);
});

test("RECARGA: la misma pestaña recupera la MISMA clave (misma operación canónica)", () => {
  const storage = new FakeSessionStorage();
  const gen = sequence();
  const first = resolveDraftOperationId(() => storage, KEY, gen);
  const afterReload = resolveDraftOperationId(() => storage, KEY, gen);
  assert.equal(afterReload, first);
});

test("RESPUESTA PERDIDA / error / doble envío: mientras no haya un éxito confirmado la clave NO cambia", () => {
  const storage = new FakeSessionStorage();
  const gen = sequence();
  const first = resolveDraftOperationId(() => storage, KEY, gen);
  // Reintentos sucesivos (falla de red, error de validación, el segundo clic): nadie llama a clear/rotate.
  for (let i = 0; i < 5; i++) assert.equal(resolveDraftOperationId(() => storage, KEY, gen), first);
});

test("PESTAÑA DUPLICADA: hereda el sessionStorage → conserva la misma clave", () => {
  const original = new FakeSessionStorage();
  const gen = sequence();
  const id = resolveDraftOperationId(() => original, KEY, gen);
  const duplicated = original.duplicate();
  assert.equal(resolveDraftOperationId(() => duplicated, KEY, gen), id);
});

test("PESTAÑAS INDEPENDIENTES: cada una (sessionStorage propio y vacío) recibe una clave DISTINTA", () => {
  const gen = sequence();
  const tabA = new FakeSessionStorage();
  const tabB = new FakeSessionStorage();
  const a = resolveDraftOperationId(() => tabA, KEY, gen);
  const b = resolveDraftOperationId(() => tabB, KEY, gen);
  assert.notEqual(a, b);
  // Y cada una conserva la suya al recargar.
  assert.equal(resolveDraftOperationId(() => tabA, KEY, gen), a);
  assert.equal(resolveDraftOperationId(() => tabB, KEY, gen), b);
});

test("TRAS ÉXITO: rotate guarda una clave NUEVA (el próximo alta no reencuentra al alumno anterior)", () => {
  const storage = new FakeSessionStorage();
  const gen = sequence();
  const first = resolveDraftOperationId(() => storage, KEY, gen);
  const rotated = rotateDraftOperationId(() => storage, KEY, gen);
  assert.notEqual(rotated, first);
  assert.equal(storage.getItem(KEY), rotated, "la clave nueva queda en sessionStorage");
  assert.equal(resolveDraftOperationId(() => storage, KEY, gen), rotated, "una recarga posterior conserva la nueva");
});

test("TRAS ÉXITO: clear quita la clave y la próxima carga genera otra distinta", () => {
  const storage = new FakeSessionStorage();
  const gen = sequence();
  const first = resolveDraftOperationId(() => storage, KEY, gen);
  clearDraftOperationId(() => storage, KEY);
  assert.equal(storage.getItem(KEY), null);
  assert.notEqual(resolveDraftOperationId(() => storage, KEY, gen), first);
});

test("un valor guardado que NO es un UUID (corrupto/manipulado) se descarta: nunca se reenvía", () => {
  for (const garbage of ["", "abc", "null", "<script>", "11111111-1111-1111-1111-11111111111", "x".repeat(200)]) {
    const storage = new FakeSessionStorage();
    storage.setItem(KEY, garbage);
    const id = resolveDraftOperationId(() => storage, KEY, sequence());
    assert.match(id, UUID, `reemplaza ${JSON.stringify(garbage.slice(0, 12))}`);
    assert.equal(storage.getItem(KEY), id);
  }
});

test("sessionStorage inaccesible (navegación privada/bloqueado): clave en memoria, nunca lanza, el formulario no se bloquea", () => {
  const gen = sequence();
  const blocked = (): DraftStorage => {
    throw new Error("SecurityError");
  };
  assert.match(resolveDraftOperationId(blocked, KEY, gen), UUID);
  assert.match(rotateDraftOperationId(blocked, KEY, gen), UUID);
  assert.doesNotThrow(() => clearDraftOperationId(blocked, KEY));

  // setItem que falla (cuota): devuelve la clave generada, no otra distinta.
  const readOnly: DraftStorage = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  let calls = 0;
  const counting = () => {
    calls += 1;
    return `00000000-0000-4000-8000-${String(calls).padStart(12, "0")}`;
  };
  assert.equal(resolveDraftOperationId(() => readOnly, KEY, counting), "00000000-0000-4000-8000-000000000001");
  assert.equal(calls, 1, "no genera una segunda clave al fallar el guardado");
});
