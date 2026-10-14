import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestNotice, MAX_BODY_BYTES, type IngestDeps, type IngestRequest } from "../webhook-ingest.ts";
import { FakeProviderAdapter } from "../providers/fake.ts";
import { MobbexAdapter } from "../providers/mobbex.ts";
import { operationFromPayload, parseNoticeBody, parseWebhookBody } from "../providers/mobbex-normalize.ts";
import { CompositeLimiter, FixedWindowLimiter, createNoticeLimiter, type RateLimiter } from "../rate-limit.ts";
import { MemoryStore } from "./memory-store.ts";

const ON = { enabled: true, enforcement: false } as const;
const NOW = new Date("2026-10-13T15:00:00.000Z");
const ALLOW_ALL: RateLimiter = { check: () => ({ allowed: true, retryAfterSeconds: 1 }) };
const REF = "tfs_" + "a".repeat(32);

/** Aviso de ejecución con datos personales, de tarjeta y un ESTADO que NUNCA deben guardarse ni creerse. */
function executionBody(overrides: { status?: string; paymentId?: string; reference?: string | null; uid?: string | null } = {}): string {
  return JSON.stringify({
    type: "subscription:execution",
    data: {
      result: true,
      payment: {
        id: overrides.paymentId ?? "PAY123",
        status: { code: overrides.status ?? "200", text: "Aprobado", message: "Transacción Aprobada" },
        total: 24900,
        currency: { code: "ARS", text: "Peso Argentino", symbol: "$" },
        created: "2026-10-01T13:00:00.000Z",
        updated: "2026-10-01T13:00:05.000Z",
        reference: "ref-1",
        source: { name: "Visa", number: "45079831****2450", cardholder: { identification: "12123123", name: "TITULAR SECRETO" }, expiration: { month: "12", year: "34" } },
      },
      customer: { email: "persona.secreta@example.com", identification: "30111222", name: "Persona Secreta", phone: "1130170412" },
      subscription: { uid: "SUB_TEMPLATE", reference: "tf_monthly_ars_v1", total: 24900, interval: "1m" },
      subscriber: { uid: overrides.uid === undefined ? "SUBR1" : overrides.uid, reference: overrides.reference === undefined ? REF : overrides.reference, customer: { email: "persona.secreta@example.com", name: "Persona Secreta" } },
      execution: { uid: "EXE1", date: "2026-10-01T13:00:00.000Z", total: 24900, currency: "ARS", test: false },
    },
  });
}

function formBody(): string {
  return new URLSearchParams({
    type: "subscription:execution",
    "data[payment][id]": "PAY123",
    "data[payment][status][code]": "200",
    "data[payment][total]": "24900",
    "data[execution][uid]": "EXE1",
    "data[subscriber][uid]": "SUBR1",
    "data[subscriber][reference]": REF,
    "data[customer][email]": "persona.secreta@example.com",
  }).toString();
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps & { store: MemoryStore; adapter: FakeProviderAdapter } {
  const store = new MemoryStore();
  const adapter = new FakeProviderAdapter();
  return { adapter, store, flags: ON, now: () => NOW, limiter: ALLOW_ALL, ...overrides } as IngestDeps & { store: MemoryStore; adapter: FakeProviderAdapter };
}

function request(body: string, overrides: Partial<IngestRequest> = {}): IngestRequest & { reads: number } {
  const state = { reads: 0 };
  const req: IngestRequest & { reads: number } = {
    method: "POST",
    contentType: "application/json",
    declaredLength: Buffer.byteLength(body, "utf8"),
    readBody: async (max: number) => {
      state.reads += 1;
      return Buffer.byteLength(body, "utf8") > max ? "too_large" : body;
    },
    clientKey: "client-1",
    get reads() {
      return state.reads;
    },
    ...overrides,
  };
  return req;
}

test("un aviso bien formado se guarda con UNA sola escritura y la respuesta no lleva datos; no se consulta al proveedor", async () => {
  const d = deps();
  const response = await ingestNotice(d, request(executionBody()));
  assert.deepEqual(response, { status: 200, body: { ok: true } });
  assert.deepEqual(d.store.calls, ["ingestEvents"], "sin lecturas ni escrituras extra: la conciliación se hace después, por lotes");
  assert.equal(d.store.ingested.size, 1);
  assert.equal(d.adapter.calls.getOperation, 0, "recibir el aviso no consulta al proveedor");
});

test("de un aviso sólo se guarda la PISTA mínima: ningún estado, importe, plan, fecha, correo, nombre, documento, teléfono ni tarjeta, ni el cuerpo crudo", async () => {
  const d = deps();
  await ingestNotice(d, request(executionBody({ status: "200" })));
  const row = [...d.store.ingested.values()][0];
  assert.deepEqual(Object.keys(row.hint).sort(), ["executionUid", "providerPaymentId", "subscriberReference", "subscriberUid"]);
  assert.deepEqual(row.hint, { providerPaymentId: "PAY123", executionUid: "EXE1", subscriberUid: "SUBR1", subscriberReference: REF });
  const stored = JSON.stringify(row);
  for (const secret of ["persona.secreta", "Persona Secreta", "TITULAR SECRETO", "30111222", "12123123", "1130170412", "45079831", "2450", "expiration", "cardholder", "customer", "Transacción Aprobada", "24900", "tf_monthly_ars_v1", "Aprobado", '"200"', "status"]) {
    assert.equal(stored.includes(secret), false, `no debe guardarse: ${secret}`);
  }
  assert.match(row.payloadHash, /^[0-9a-f]{64}$/);
  assert.ok(!("rawBody" in row) && !("payload" in row));
});

test("UN AVISO FALSO NO ACTIVA NADA: aunque diga «aprobado» y traiga cualquier importe, lo único que produce es una pista para consultar", async () => {
  const d = deps();
  await ingestNotice(d, request(executionBody({ status: "200" })));
  await ingestNotice(d, request(executionBody({ status: "410" })));
  assert.equal(d.store.subscriptions.size, 0, "no se tocó ninguna suscripción");
  assert.deepEqual(d.store.calls.filter((name) => name !== "ingestEvents"), []);
  // El estado del cuerpo no influye ni en la clave de deduplicación: dos avisos del mismo pago son la MISMA pista.
  assert.equal(d.store.ingested.size, 1);
});

test("RESPUESTA UNIFORME: un aviso bien formado recibe lo mismo exista o no el suscriptor, esté repetido o no (nada se puede inferir)", async () => {
  const known = deps();
  const unknown = deps();
  const first = await ingestNotice(known, request(executionBody()));
  const duplicate = await ingestNotice(known, request(executionBody()));
  const stranger = await ingestNotice(unknown, request(executionBody({ reference: "tfs_" + "f".repeat(32), uid: "NOBODY", paymentId: "PAY_X" })));
  assert.deepEqual(first, { status: 200, body: { ok: true } });
  assert.deepEqual(duplicate, first);
  assert.deepEqual(stranger, first);
  // Y un tipo de aviso que no interesa también se reconoce igual, sin guardar nada.
  const ignored = deps();
  assert.deepEqual(await ingestNotice(ignored, request(JSON.stringify({ type: "subscription:something_new", data: { subscriber: { uid: "S" } } }))), first);
  assert.deepEqual(ignored.store.calls, []);
});

test("los repetidos se descartan en la base, no acá: el almacén informa cuántos eran duplicados", async () => {
  const d = deps();
  await ingestNotice(d, request(executionBody()));
  await ingestNotice(d, request(executionBody()));
  await ingestNotice(d, request(executionBody({ paymentId: "OTHER" })));
  assert.equal(d.store.ingested.size, 2);
});

test("con la facturación apagada responde como si la ruta no existiera: 404 sin leer el cuerpo, sin consultar el límite y sin tocar nada", async () => {
  for (const flags of [{ enabled: false, enforcement: false }, { enabled: false, enforcement: true }] as const) {
    let checked = 0;
    const d = deps({ flags, limiter: { check: () => ((checked += 1), { allowed: true, retryAfterSeconds: 1 }) } });
    const req = request(executionBody());
    assert.deepEqual(await ingestNotice(d, req), { status: 404, body: { ok: false } });
    assert.equal(req.reads, 0);
    assert.equal(checked, 0);
    assert.deepEqual(d.store.calls, []);
    assert.deepEqual(await ingestNotice(d, request("x", { method: "GET" })), { status: 404, body: { ok: false } }, "tampoco filtra qué métodos existen");
  }
});

test("POST solamente: cualquier otro método recibe 405 con Allow, sin leer el cuerpo", async () => {
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const d = deps();
    const req = request(executionBody(), { method });
    const response = await ingestNotice(d, req);
    assert.equal(response.status, 405, method);
    assert.deepEqual(response.headers, { allow: "POST" });
    assert.equal(req.reads, 0);
    assert.deepEqual(d.store.calls, []);
  }
});

test("Content-Type esperado: sólo formulario o JSON; cualquier otro recibe 415 sin leer el cuerpo", async () => {
  for (const contentType of ["text/plain", "multipart/form-data; boundary=x", "application/xml", "text/html", "", undefined]) {
    const d = deps();
    const req = request(executionBody(), { contentType });
    assert.deepEqual(await ingestNotice(d, req), { status: 415, body: { ok: false } }, String(contentType));
    assert.equal(req.reads, 0);
    assert.deepEqual(d.store.calls, []);
  }
  for (const contentType of ["application/x-www-form-urlencoded", "application/x-www-form-urlencoded; charset=UTF-8", "APPLICATION/JSON", "application/json; charset=utf-8"]) {
    const d = deps();
    const response = await ingestNotice(d, request(contentType.toLowerCase().includes("json") ? executionBody() : formBody(), { contentType }));
    assert.equal(response.status, 200, contentType);
  }
});

test("cuerpo demasiado grande: 413 ANTES de interpretarlo (por tamaño declarado y por tamaño real) y sin guardar nada", async () => {
  assert.equal(MAX_BODY_BYTES, 16 * 1024);
  const huge = "x".repeat(MAX_BODY_BYTES + 1);
  const declared = deps();
  const declaredReq = request(huge);
  assert.deepEqual(await ingestNotice(declared, declaredReq), { status: 413, body: { ok: false } });
  assert.equal(declaredReq.reads, 0, "el tamaño declarado alcanza para rechazar sin leer");
  assert.deepEqual(declared.store.calls, []);
  // Mentir con el Content-Length no sirve: el lector corta apenas supera el tope.
  const lying = deps();
  const lyingReq = request(huge, { declaredLength: 10 });
  assert.deepEqual(await ingestNotice(lying, lyingReq), { status: 413, body: { ok: false } });
  assert.equal(lyingReq.reads, 1);
  assert.deepEqual(lying.store.calls, []);
  // Y sin Content-Length (transferencia por partes).
  const chunked = deps();
  assert.equal((await ingestNotice(chunked, request(huge, { declaredLength: null }))).status, 413);
  // El borde exacto pasa.
  const base = JSON.stringify({ type: "subscription:execution", data: { payment: { id: "P" }, subscriber: { uid: "S" }, pad: "" } });
  const edge = base.replace('"pad":""', `"pad":"${"x".repeat(MAX_BODY_BYTES - Buffer.byteLength(base))}"`);
  assert.equal(Buffer.byteLength(edge), MAX_BODY_BYTES);
  assert.equal((await ingestNotice(deps(), request(edge))).status, 200);
});

test("contenido mal formado: 400 sin guardar nada (JSON roto, sin tipo, sin identidad de suscriptor, sin pago, ids con caracteres peligrosos)", async () => {
  const bad = [
    "{not json",
    "[]",
    "null",
    JSON.stringify({ data: { payment: { id: "P" }, subscriber: { uid: "S" } } }), // sin type
    JSON.stringify({ type: "subscription:execution" }), // sin data
    JSON.stringify({ type: "subscription:execution", data: { payment: { id: "P" } } }), // sin identidad de suscriptor
    JSON.stringify({ type: "subscription:execution", data: { subscriber: { uid: "S" } } }), // sin pago
    JSON.stringify({ type: "subscription:execution", data: { payment: { id: "P" }, subscriber: { uid: "S; DROP TABLE x" } } }), // id con caracteres peligrosos
    JSON.stringify({ type: "subscription:execution", data: { payment: { id: "P" }, subscriber: { uid: "a".repeat(129) } } }),
    JSON.stringify({ type: "subscription:execution", data: { payment: { id: { $ne: 1 } }, subscriber: { uid: ["S"] } } }),
    JSON.stringify({ type: "subscription:registration", data: {} }),
  ];
  for (const body of bad) {
    const d = deps();
    assert.deepEqual(await ingestNotice(d, request(body)), { status: 400, body: { ok: false } }, body.slice(0, 60));
    assert.deepEqual(d.store.calls, []);
  }
  // Formulario degenerado: demasiados campos.
  const many = new URLSearchParams(Array.from({ length: 400 }, (_, i) => [`data[x${i}]`, "1"])).toString();
  const d = deps();
  assert.equal((await ingestNotice(d, request(many, { contentType: "application/x-www-form-urlencoded" }))).status, 400);
  assert.deepEqual(d.store.calls, []);
});

test("LÍMITE DE FRECUENCIA: el cliente abusivo recibe 429 con Retry-After, antes de leer o interpretar el cuerpo; otro cliente sigue pasando", async () => {
  let now = 1_000_000;
  const limiter = createNoticeLimiter(() => now);
  const d = deps({ limiter });
  let first429 = -1;
  for (let i = 0; i < 130; i += 1) {
    const req = request(executionBody(), { clientKey: "abusive" });
    const response = await ingestNotice(d, req);
    if (response.status === 429 && first429 < 0) {
      first429 = i;
      assert.equal(req.reads, 0, "rechazado sin leer el cuerpo");
      assert.ok(Number(response.headers?.["retry-after"]) >= 1);
      assert.deepEqual(response.body, { ok: false });
    }
  }
  assert.equal(first429, 120, "120 por minuto por cliente");
  assert.equal((await ingestNotice(d, request(executionBody(), { clientKey: "polite" }))).status, 200);
  now += 60_001;
  assert.equal((await ingestNotice(d, request(executionBody(), { clientKey: "abusive" }))).status, 200, "la ventana siguiente vuelve a permitir");
});

test("el límite global frena a un enjambre de clientes distintos, y la memoria del limitador nunca crece sin tope", () => {
  const now = 0;
  const global = new FixedWindowLimiter({ limit: 5, windowMs: 60_000, maxKeys: 2, now: () => now });
  const limiter = new CompositeLimiter(new FixedWindowLimiter({ limit: 100, windowMs: 60_000, maxKeys: 50, now: () => now }), global);
  const allowed = Array.from({ length: 8 }, (_, i) => limiter.check(`c${i}`).allowed);
  assert.deepEqual(allowed, [true, true, true, true, true, false, false, false]);
  const small = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 10, now: () => now });
  for (let i = 0; i < 1_000; i += 1) small.check(`ip-${i}`);
  assert.ok(small.size <= 10, `el tamaño quedó en ${small.size}`);
});

test("caída de Supabase al guardar: 503 sin mensajes internos, para que el proveedor reintente (nada se perdió porque nada se confirmó)", async () => {
  const d = deps();
  d.store.failWith = new Error("connection to server at db.example.supabase.co failed: password authentication failed for user postgres");
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const response = await ingestNotice(d, request(executionBody()));
    assert.deepEqual(response, { status: 503, body: { ok: false } });
  } finally {
    console.error = originalError;
  }
  const logged = lines.join("\n");
  assert.match(logged, /\[billing\]/);
  for (const leak of ["supabase.co", "password", "postgres", "connection"]) assert.equal(logged.includes(leak), false, leak);
});

test("el registro de la recepción no contiene identificadores, correos ni estados del aviso", async () => {
  const captured: string[] = [];
  const originals = { info: console.info, warn: console.warn, error: console.error };
  console.info = console.warn = console.error = (...args: unknown[]) => void captured.push(args.map(String).join(" "));
  try {
    const d = deps();
    await ingestNotice(d, request(executionBody()));
    await ingestNotice(d, request("{broken"));
    await ingestNotice(d, request(executionBody(), { contentType: "text/plain" }));
  } finally {
    Object.assign(console, originals);
  }
  const text = captured.join("\n");
  assert.ok(text.includes("[billing]"));
  for (const leak of ["PAY123", "SUBR1", REF, "persona.secreta", "30111222", "Aprobado", "24900", "EXE1"]) assert.equal(text.includes(leak), false, leak);
});

test("el adaptador de Mobbex y el falso reducen los avisos IGUAL (un aviso nunca lleva autoridad en ninguno)", () => {
  const input = { rawBody: formBody(), contentType: "application/x-www-form-urlencoded", now: NOW };
  const fromMobbex = new MobbexAdapter(null).parseNotice(input);
  const fromFake = new FakeProviderAdapter().parseNotice(input);
  assert.deepEqual(fromMobbex, fromFake);
  assert.equal(fromMobbex.ok, true);
});

test("el cuerpo puede venir como JSON o como formulario con notación de corchetes (la documentación muestra ambos)", () => {
  const json = parseWebhookBody(executionBody(), "application/json") as { data: { payment: { id: string } } };
  assert.equal(json.data.payment.id, "PAY123");
  const parsed = parseNoticeBody({ rawBody: formBody(), contentType: "application/x-www-form-urlencoded", now: NOW });
  assert.equal(parsed.ok && parsed.notices[0].hint.providerPaymentId, "PAY123");
  assert.equal(parsed.ok && parsed.notices[0].hint.subscriberUid, "SUBR1");
});

test("el análisis de formularios ignora claves peligrosas (sin contaminación de prototipos)", () => {
  const parsed = parseWebhookBody("__proto__[polluted]=1&constructor[prototype][polluted]=1&data[ok]=1", "application/x-www-form-urlencoded");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(parsed, { data: { ok: "1" } });
});

test("importes ambiguos en una CONSULTA autenticada (dos importes distintos) quedan en null para que la conciliación los rechace", () => {
  const body = JSON.parse(executionBody());
  body.data.execution.total = 100;
  assert.equal(operationFromPayload(body.data, NOW.toISOString())?.amountMinor, null);
  const bodyCurrency = JSON.parse(executionBody());
  bodyCurrency.data.execution.currency = "USD";
  assert.equal(operationFromPayload(bodyCurrency.data, NOW.toISOString())?.currency, null);
});

test("la pista de un aviso tiene una clave de deduplicación que NO depende del estado ni de la fecha (sólo de qué se pide mirar)", () => {
  const a = parseNoticeBody({ rawBody: executionBody({ status: "200" }), contentType: "application/json", now: NOW });
  const b = parseNoticeBody({ rawBody: executionBody({ status: "410" }), contentType: "application/json", now: new Date(NOW.getTime() + 3_600_000) });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.equal(a.notices[0].dedupKey, b.notices[0].dedupKey);
  assert.notEqual(a.notices[0].payloadHash, b.notices[0].payloadHash);
  const c = parseNoticeBody({ rawBody: executionBody({ paymentId: "PAY999" }), contentType: "application/json", now: NOW });
  assert.ok(c.ok && c.notices[0].dedupKey !== a.notices[0].dedupKey);
});

test("un formulario con una cantidad desmedida de campos se rechaza AUNQUE empiece con un aviso válido (no se procesan miles de campos)", async () => {
  const valid = new URLSearchParams({ type: "subscription:execution", "data[payment][id]": "PAY1", "data[subscriber][uid]": "SUBR1" });
  const small = deps();
  assert.equal((await ingestNotice(small, request(valid.toString(), { contentType: "application/x-www-form-urlencoded" }))).status, 200);
  for (let i = 0; i < 400; i += 1) valid.append(`data[relleno][c${i}]`, "x");
  const big = deps();
  assert.equal((await ingestNotice(big, request(valid.toString(), { contentType: "application/x-www-form-urlencoded" }))).status, 400);
  assert.deepEqual(big.store.calls, []);
});
