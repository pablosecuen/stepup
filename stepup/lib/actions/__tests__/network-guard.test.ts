import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK_ERROR_MESSAGE,
  guardFormAction,
  guardNetwork,
  isNetworkFailure,
  networkFailureState,
  restoreFormValues,
  type RestorableField,
} from "../network-guard.ts";

// --- isNetworkFailure -------------------------------------------------------

test("isNetworkFailure: reconoce las firmas reales de fetch sin respuesta (Chromium, WebKit, Firefox, undici)", () => {
  for (const message of ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource.", "fetch failed", "Network request failed"]) {
    assert.equal(isNetworkFailure(new TypeError(message)), true, message);
  }
});

test("isNetworkFailure: nunca confunde un error del servidor o de programación con una falla de red", () => {
  assert.equal(isNetworkFailure(new Error("Failed to fetch")), false, "sólo TypeError");
  assert.equal(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'id')")), false);
  assert.equal(isNetworkFailure(new Error("An unexpected response was received from the server.")), false);
  assert.equal(isNetworkFailure("Failed to fetch"), false);
  assert.equal(isNetworkFailure(null), false);
  assert.equal(isNetworkFailure(undefined), false);
});

test("el mensaje es humano: dice que no se pudo conectar, que se puede reintentar y que lo escrito se conserva", () => {
  assert.match(NETWORK_ERROR_MESSAGE, /No se pudo conectar/);
  assert.match(NETWORK_ERROR_MESSAGE, /volvé a intentar/);
  assert.match(NETWORK_ERROR_MESSAGE, /lo que escribiste sigue acá/);
  assert.doesNotMatch(NETWORK_ERROR_MESSAGE, /TypeError|fetch|undefined|digest/i);
});

// --- guardNetwork -----------------------------------------------------------

test("guardNetwork: una respuesta normal (éxito o error del servidor) pasa sin tocarse", async () => {
  type Result = { error?: string; data?: { id: string } };
  const ok: Result = { data: { id: "x" } };
  assert.equal(await guardNetwork(async () => ok), ok);
  const serverError: Result = { error: "El importe tiene que ser mayor a 0." };
  assert.equal(await guardNetwork(async () => serverError), serverError);
});

test("guardNetwork: una falla de red se convierte en { error } — nunca en una excepción ni en un éxito", async () => {
  const result = await guardNetwork<{ error?: string; data?: { id: string } }>(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert.equal(result.error, NETWORK_ERROR_MESSAGE);
  assert.equal(result.data, undefined, "sin ningún dato de éxito");
  assert.deepEqual(Object.keys(result), ["error"]);
});

test("guardNetwork: cualquier otro error se relanza idéntico (lo cubre la última defensa)", async () => {
  const boom = new Error("falla inesperada del render");
  await assert.rejects(
    guardNetwork(async () => {
      throw boom;
    }),
    (error) => error === boom
  );
});

test("guardNetwork: recuperación — tras la falla, el mismo reintento con la misma clave de idempotencia funciona", async () => {
  const seenOperationIds: string[] = [];
  let calls = 0;
  const attempt = (operationId: string) =>
    guardNetwork<{ error?: string; data?: { paymentId: string } }>(async () => {
      seenOperationIds.push(operationId);
      calls++;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { data: { paymentId: "p1" } };
    });

  const first = await attempt("op-1");
  assert.equal(first.error, NETWORK_ERROR_MESSAGE);
  const retry = await attempt("op-1");
  assert.deepEqual(retry, { data: { paymentId: "p1" } });
  assert.deepEqual(seenOperationIds, ["op-1", "op-1"], "mismo operationId en el reintento");
});

// --- useActionState (guardFormAction / networkFailureState) ------------------

test("networkFailureState: conserva el resto del estado (p. ej. duplicate) y descarta el eco `values` viejo", () => {
  const prev = { error: "viejo", duplicate: { candidates: [], changed: false }, values: { name: "stale" } };
  const next = networkFailureState(prev);
  assert.equal(next.error, NETWORK_ERROR_MESSAGE);
  assert.deepEqual(next.duplicate, prev.duplicate);
  assert.equal(next.values, undefined);
});

test("guardFormAction: éxito/error del servidor pasan; falla de red devuelve el estado con el mensaje; otro error se relanza", async () => {
  const prev: { error?: string; values?: unknown } = {};
  const fd = new FormData();

  const served: { error?: string; values?: unknown } = { error: "Completá fecha, hora y duración." };
  assert.equal(await guardFormAction(async () => served, prev, fd), served);

  const failed = await guardFormAction(
    async () => {
      throw new TypeError("Load failed");
    },
    prev,
    fd
  );
  assert.equal(failed.error, NETWORK_ERROR_MESSAGE);

  const boom = new Error("render");
  await assert.rejects(
    guardFormAction(
      async () => {
        throw boom;
      },
      prev,
      fd
    ),
    (error) => error === boom
  );
});

// --- restoreFormValues --------------------------------------------------------

function field(partial: Partial<RestorableField> & { tagName: string; name: string }): RestorableField {
  return { type: "text", disabled: false, value: "", ...partial };
}

function snapshotOf(entries: Array<[string, string]>): Pick<FormData, "get" | "getAll"> {
  return {
    get: (name: string) => entries.find(([key]) => key === name)?.[1] ?? null,
    getAll: (name: string) => entries.filter(([key]) => key === name).map(([, value]) => value),
  };
}

test("restoreFormValues: repone texto, textarea y select tras el reset nativo de React", () => {
  const name = field({ tagName: "INPUT", name: "name" });
  const notes = field({ tagName: "TEXTAREA", name: "notes", type: "textarea" });
  const modality = field({ tagName: "SELECT", name: "modality", type: "select-one", value: "presencial" });
  restoreFormValues({ elements: [name, notes, modality] }, snapshotOf([["name", "Ana"], ["notes", "trae el libro"], ["modality", "online"]]));
  assert.equal(name.value, "Ana");
  assert.equal(notes.value, "trae el libro");
  assert.equal(modality.value, "online");
});

test("restoreFormValues: checkboxes y radios se marcan según el valor enviado (grupo con varios valores)", () => {
  const a = field({ tagName: "INPUT", name: "levels", type: "checkbox", value: "A1", checked: false });
  const b = field({ tagName: "INPUT", name: "levels", type: "checkbox", value: "B2", checked: true });
  const c = field({ tagName: "INPUT", name: "levels", type: "checkbox", value: "C1", checked: false });
  const r1 = field({ tagName: "INPUT", name: "billing", type: "radio", value: "mensual", checked: true });
  const r2 = field({ tagName: "INPUT", name: "billing", type: "radio", value: "por_clase", checked: false });
  restoreFormValues({ elements: [a, b, c, r1, r2] }, snapshotOf([["levels", "A1"], ["levels", "C1"], ["billing", "por_clase"]]));
  assert.deepEqual([a.checked, b.checked, c.checked], [true, false, true]);
  assert.deepEqual([r1.checked, r2.checked], [false, true]);
});

test("restoreFormValues: select múltiple repone exactamente las opciones elegidas", () => {
  const options = [
    { value: "lun", selected: false },
    { value: "mar", selected: true },
    { value: "mie", selected: false },
  ];
  const select = field({ tagName: "SELECT", name: "days", type: "select-multiple", multiple: true, options });
  restoreFormValues({ elements: [select] }, snapshotOf([["days", "lun"], ["days", "mie"]]));
  assert.deepEqual(options.map((o) => o.selected), [true, false, true]);
});

test("restoreFormValues: nunca toca hidden, botones, archivos, campos deshabilitados ni sin nombre", () => {
  const hidden = field({ tagName: "INPUT", name: "claimId", type: "hidden", value: "server-claim" });
  const submit = field({ tagName: "BUTTON", name: "confirmDuplicate", type: "submit", value: "true" });
  const submitInput = field({ tagName: "INPUT", name: "go", type: "submit", value: "Guardar" });
  const file = field({ tagName: "INPUT", name: "avatar", type: "file", value: "" });
  const disabled = field({ tagName: "INPUT", name: "phone", disabled: true, value: "orig" });
  const unnamed = field({ tagName: "INPUT", name: "", value: "orig" });
  restoreFormValues(
    { elements: [hidden, submit, submitInput, file, disabled, unnamed] },
    snapshotOf([["claimId", "OTRO"], ["confirmDuplicate", "x"], ["go", "x"], ["avatar", "x"], ["phone", "x"]])
  );
  assert.deepEqual(
    [hidden.value, submit.value, submitInput.value, file.value, disabled.value, unnamed.value],
    ["server-claim", "true", "Guardar", "", "orig", "orig"]
  );
});

test("restoreFormValues: es idempotente y un campo ausente del snapshot no se pisa", () => {
  const name = field({ tagName: "INPUT", name: "name" });
  const email = field({ tagName: "INPUT", name: "email", type: "email", value: "ya@escrito.com" });
  const snapshot = snapshotOf([["name", "Ana"]]);
  restoreFormValues({ elements: [name, email] }, snapshot);
  restoreFormValues({ elements: [name, email] }, snapshot);
  assert.equal(name.value, "Ana");
  assert.equal(email.value, "ya@escrito.com");
});
