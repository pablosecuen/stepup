import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestWebhook, MAX_BODY_BYTES, type IngestDeps } from "../webhook-ingest.ts";
import { FakeProviderAdapter, FAKE_SIGNATURE_HEADER, signFakeWebhook } from "../providers/fake.ts";
import { MobbexAdapter } from "../providers/mobbex.ts";
import { normalizeWebhook, parseWebhookBody } from "../providers/mobbex-normalize.ts";
import { MemoryStore } from "./memory-store.ts";

const SECRET = "test-only-webhook-secret";
const ON = { enabled: true, enforcement: false } as const;
const NOW = new Date("2026-10-13T15:00:00.000Z");

/** Aviso de ejecución con datos personales y de tarjeta que NUNCA deben guardarse. */
function executionBody(overrides: { status?: string; updated?: string; paymentId?: string } = {}): string {
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
        updated: overrides.updated ?? "2026-10-01T13:00:05.000Z",
        reference: "ref-1",
        source: { name: "Visa", number: "45079831****2450", cardholder: { identification: "12123123", name: "TITULAR SECRETO" }, expiration: { month: "12", year: "34" } },
      },
      customer: { email: "persona.secreta@example.com", identification: "30111222", name: "Persona Secreta", phone: "1130170412" },
      subscription: { uid: "SUB_TEMPLATE", reference: "tf_monthly_ars_v1", total: 24900, interval: "1m" },
      subscriber: { uid: "SUBR1", reference: "tfs_" + "a".repeat(32), customer: { email: "persona.secreta@example.com", name: "Persona Secreta" } },
      execution: { uid: "EXE1", date: "2026-10-01T13:00:00.000Z", total: 24900, currency: "ARS", test: false },
    },
  });
}

function deps(overrides: Partial<IngestDeps> = {}): IngestDeps & { store: MemoryStore; adapter: FakeProviderAdapter } {
  const store = new MemoryStore();
  const adapter = new FakeProviderAdapter(SECRET);
  return { adapter, store, flags: ON, now: () => NOW, ...overrides } as IngestDeps & { store: MemoryStore; adapter: FakeProviderAdapter };
}

const signed = (body: string) => ({ rawBody: body, headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body), "content-type": "application/json" } });

test("un aviso verificado se guarda con UNA sola escritura y la respuesta no lleva datos", async () => {
  const d = deps();
  const response = await ingestWebhook(d, signed(executionBody()));
  assert.deepEqual(response, { status: 200, body: { ok: true } });
  assert.deepEqual(d.store.calls, ["ingestEvents"], "sin lecturas ni escrituras extra: la conciliación se hace después, por lotes");
  assert.equal(d.store.ingested.size, 1);
  assert.equal(d.adapter.calls.getOperation, 0, "recibir el aviso no consulta al proveedor");
});

test("de un aviso sólo se conservan campos normalizados: NUNCA correo, nombre, documento, teléfono ni datos de tarjeta, ni el cuerpo crudo", async () => {
  const d = deps();
  await ingestWebhook(d, signed(executionBody()));
  const stored = JSON.stringify([...d.store.ingested.values()]);
  for (const secret of ["persona.secreta", "Persona Secreta", "TITULAR SECRETO", "30111222", "12123123", "1130170412", "45079831", "2450", "expiration", "cardholder", "customer", "Transacción Aprobada"]) {
    assert.equal(stored.includes(secret), false, `no debe guardarse: ${secret}`);
  }
  const [row] = [...d.store.ingested.values()];
  assert.equal(row.normalized.operation?.amountMinor, 2_490_000);
  assert.equal(row.normalized.operation?.currency, "ARS");
  assert.equal(row.normalized.operation?.planReference, "tf_monthly_ars_v1");
  assert.match(row.payloadHash, /^[0-9a-f]{64}$/);
  assert.match(row.dedupKey, /^[0-9a-f]{64}$/);
});

test("aviso FALSO: firma inválida o ausente → 401 y NO se guarda nada", async () => {
  const d = deps();
  const body = executionBody();
  const forged = await ingestWebhook(d, { rawBody: body, headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook("otro-secreto", body) } });
  const missing = await ingestWebhook(d, { rawBody: body, headers: {} });
  const tampered = await ingestWebhook(d, { rawBody: body.replace("24900", "1"), headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body) } });
  const wrongLength = await ingestWebhook(d, { rawBody: body, headers: { [FAKE_SIGNATURE_HEADER]: "abc" } });
  for (const response of [forged, missing, tampered, wrongLength]) assert.deepEqual(response, { status: 401, body: { ok: false } });
  assert.deepEqual(d.store.calls, [], "ni siquiera se toca la base");
});

test("aviso con firma válida pero cuerpo mal formado o con forma desconocida → 400, sin guardar", async () => {
  const d = deps();
  for (const body of ["not json", "{}", JSON.stringify({ type: "subscription:execution", data: {} }), JSON.stringify({ type: "subscription:execution", data: { payment: { id: "x" } } }), "[]", ""]) {
    const response = await ingestWebhook(d, signed(body));
    assert.equal(response.status, 400, body);
  }
  assert.equal(d.store.ingested.size, 0);
});

test("cuerpo demasiado grande → 413 sin verificar ni guardar", async () => {
  const d = deps();
  const huge = "x".repeat(MAX_BODY_BYTES + 1);
  assert.deepEqual(await ingestWebhook(d, signed(huge)), { status: 413, body: { ok: false } });
  assert.deepEqual(d.store.calls, []);
  // El límite lo aplica la recepción ANTES de pedirle nada al adaptador (el cuerpo gigante ni siquiera se verifica).
  let verifyCalls = 0;
  const spy = new FakeProviderAdapter(SECRET);
  const original = spy.verifyWebhook.bind(spy);
  spy.verifyWebhook = (input) => {
    verifyCalls += 1;
    return original(input);
  };
  assert.equal((await ingestWebhook({ ...d, adapter: spy }, signed(huge))).status, 413);
  assert.equal(verifyCalls, 0);
});

test("aviso DUPLICADO: se responde 200 y no se guarda dos veces (identidad semántica)", async () => {
  const d = deps();
  const first = await ingestWebhook(d, signed(executionBody()));
  const second = await ingestWebhook(d, signed(executionBody()));
  const third = await ingestWebhook(d, signed(executionBody() + " ")); // mismo contenido, distinto texto: igual identidad
  assert.deepEqual([first.status, second.status, third.status], [200, 200, 200]);
  assert.equal(d.store.ingested.size, 1);
  // Un estado distinto (o una actualización posterior) del MISMO pago es un aviso distinto.
  await ingestWebhook(d, signed(executionBody({ status: "410", updated: "2026-10-01T13:05:00.000Z" })));
  assert.equal(d.store.ingested.size, 2);
});

test("la identidad del aviso depende de pago + estado + actualización + ejecución + suscriptor, no del orden de las claves", () => {
  const a = normalizeWebhook({ rawBody: "a", body: JSON.parse(executionBody()), receivedAt: NOW });
  const b = normalizeWebhook({ rawBody: "b", body: JSON.parse(executionBody()), receivedAt: new Date("2030-01-01") });
  assert.equal(a?.dedupKey, b?.dedupKey, "la fecha de recepción NO forma parte de la identidad");
  assert.notEqual(a?.payloadHash, b?.payloadHash);
  const other = normalizeWebhook({ rawBody: "c", body: JSON.parse(executionBody({ paymentId: "PAY999" })), receivedAt: NOW });
  assert.notEqual(a?.dedupKey, other?.dedupKey);
});

test("facturación APAGADA: la ruta responde como si no existiera (404) y no verifica ni guarda nada", async () => {
  for (const flags of [{ enabled: false, enforcement: false }, { enabled: false, enforcement: true }] as const) {
    const d = deps({ flags });
    assert.deepEqual(await ingestWebhook(d, signed(executionBody())), { status: 404, body: { ok: false } });
    assert.deepEqual(d.store.calls, []);
  }
});

test("Mobbex NO documenta autenticación de avisos: el adaptador real rechaza SIEMPRE, aunque el cuerpo y los encabezados parezcan válidos", async () => {
  const store = new MemoryStore();
  const adapter = new MobbexAdapter(null);
  const body = executionBody();
  const headers = { "content-type": "application/json", "x-signature": signFakeWebhook(SECRET, body), "x-mobbex-signature": "abc", authorization: "Bearer token", [FAKE_SIGNATURE_HEADER]: signFakeWebhook(SECRET, body) };
  assert.deepEqual(adapter.verifyWebhook(), { verified: false, reason: "mechanism_not_documented" });
  const response = await ingestWebhook({ adapter, store, flags: ON, now: () => NOW }, { rawBody: body, headers });
  assert.deepEqual(response, { status: 401, body: { ok: false } });
  assert.deepEqual(store.calls, []);
});

test("caída de Supabase al guardar: 503 sin mensajes internos, para que el proveedor reintente (nada se perdió porque nada se confirmó)", async () => {
  const d = deps();
  d.store.failWith = new Error("connection to server at db.example.supabase.co failed: password authentication failed for user postgres");
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
  try {
    const response = await ingestWebhook(d, signed(executionBody()));
    assert.deepEqual(response, { status: 503, body: { ok: false } });
  } finally {
    console.error = originalError;
  }
  const logged = lines.join("\n");
  assert.match(logged, /\[billing\]/);
  for (const leak of ["supabase.co", "password", "postgres", "connection"]) assert.equal(logged.includes(leak), false, leak);
});

test("el cuerpo puede venir como JSON o como formulario con notación de corchetes (la documentación muestra ambos)", () => {
  const json = parseWebhookBody(executionBody(), "application/json") as { data: { payment: { id: string } } };
  assert.equal(json.data.payment.id, "PAY123");
  const form = new URLSearchParams({
    type: "subscription:execution",
    "data[payment][id]": "PAY123",
    "data[payment][status][code]": "200",
    "data[payment][total]": "24900",
    "data[payment][currency][code]": "ARS",
    "data[payment][updated]": "2026-10-01T13:00:05.000Z",
    "data[execution][uid]": "EXE1",
    "data[execution][date]": "2026-10-01T13:00:00.000Z",
    "data[subscriber][reference]": "tfs_" + "a".repeat(32),
    "data[subscription][reference]": "tf_monthly_ars_v1",
  }).toString();
  const event = normalizeWebhook({ rawBody: form, body: parseWebhookBody(form, "application/x-www-form-urlencoded"), receivedAt: NOW });
  assert.equal(event?.operation?.providerPaymentId, "PAY123");
  assert.equal(event?.operation?.amountMinor, 2_490_000);
  assert.equal(event?.operation?.outcome, "approved");
});

test("el análisis de formularios ignora claves peligrosas (sin contaminación de prototipos)", () => {
  const parsed = parseWebhookBody("__proto__[polluted]=1&constructor[prototype][polluted]=1&data[ok]=1", "application/x-www-form-urlencoded");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(parsed, { data: { ok: "1" } });
});

test("importes ambiguos (dos importes distintos en el mismo aviso) quedan en null para que la conciliación los rechace", () => {
  const body = JSON.parse(executionBody());
  body.data.execution.total = 100;
  const event = normalizeWebhook({ rawBody: "x", body, receivedAt: NOW });
  assert.equal(event?.operation?.amountMinor, null);
  const bodyCurrency = JSON.parse(executionBody());
  bodyCurrency.data.execution.currency = "USD";
  assert.equal(normalizeWebhook({ rawBody: "x", body: bodyCurrency, receivedAt: NOW })?.operation?.currency, null);
});
