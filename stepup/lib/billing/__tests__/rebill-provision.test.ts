import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, provision, check, ProvisionError } from "../../../scripts/rebill-provision.mjs";
import { CURRENT_PLAN_CODES, getPlan } from "../plans.ts";

/**
 * El script de aprovisionamiento contra un Rebill SIMULADO en memoria. Prueba SU lógica (no duplicar, no pisar precios, no filtrar secretos); NO prueba la integración con Rebill:
 * eso exige la clave real (docs/billing/REBILL.md).
 */
const KEY = "sk_test_clave_de_prueba_que_nunca_debe_imprimirse";
const SECRET = "whsec_" + "ab".repeat(32);

function fakeRebill(options: { failList?: boolean; seedPlans?: Record<string, unknown>[] } = {}) {
  const state = { plans: [...(options.seedPlans ?? [])] as Record<string, unknown>[], links: [] as Record<string, unknown>[], hooks: [] as Record<string, unknown>[], writes: 0, keys: new Set<string>() };
  const fetchImpl = (async (input: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    state.keys.add(init.headers["x-api-key"]);
    const path = new URL(input).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const reply = (status: number, json: unknown) => ({ ok: status < 400, status, json: async () => json });
    if (init.method === "GET" && path === "/v3/organizations") return reply(200, { id: "org_1", environment: "sandbox", status: "active", alias: "teachflow" });
    if (options.failList && path.endsWith("/search")) return reply(404, { message: "not found" });
    if (path === "/v3/plans/search") return reply(201, { records: state.plans, pagination: {} });
    if (path === "/v3/payment-links/search") return reply(201, { records: state.links, pagination: {} });
    if (path === "/v3/webhooks/search") return reply(201, { records: state.hooks, pagination: {} });
    if (init.method === "POST" && path === "/v3/plans") {
      state.writes += 1;
      const record = { id: `test_pln_${state.plans.length + 1}000`, ...body };
      state.plans.push(record);
      return reply(201, record);
    }
    if (init.method === "POST" && path === "/v3/payment-links") {
      state.writes += 1;
      const id = `pl_${state.links.length + 1}`;
      const record = { id, url: `https://pay.rebill.com/teachflow/${id}`, ...body };
      state.links.push(record);
      return reply(201, record);
    }
    if (init.method === "POST" && path === "/v3/webhooks") {
      state.writes += 1;
      const record = { id: `we_${state.hooks.length + 1}`, ...body };
      state.hooks.push(record);
      return reply(201, { ...record, signingSecret: SECRET });
    }
    return reply(400, { message: "propiedad desconocida" });
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

const clientFor = (fake: ReturnType<typeof fakeRebill>) => createClient({ apiKey: KEY, fetchImpl: fake.fetchImpl });

test("simulacro: sin --apply no escribe nada", async () => {
  const fake = fakeRebill();
  const lines: string[] = [];
  await provision(clientFor(fake), { apply: false, log: (line: string) => lines.push(line) });
  assert.equal(fake.state.writes, 0);
  assert.ok(lines.some((line) => line.includes("se crearía")));
});

test("crea los cuatro planes con el importe y la periodicidad del catálogo, sin prueba gratuita; un link por plan con retorno a /facturacion/resultado y el webhook", async () => {
  const fake = fakeRebill();
  const result = await provision(clientFor(fake), { apply: true, log: () => {} });
  assert.equal(fake.state.plans.length, 4);
  assert.equal(fake.state.links.length, 4);
  assert.equal(fake.state.hooks.length, 1);
  const expected = { tf_monthly_ars_v2: [25900, 1], tf_quarterly_ars_v2: [69900, 3], tf_semiannual_ars_v2: [131400, 6], tf_annual_ars_v2: [238800, 12] } as const;
  for (const code of CURRENT_PLAN_CODES) {
    const plan = fake.state.plans.find((record) => (record.metadata as { tfCode: string }).tfCode === code) as { prices: { amount: number; currency: string }[]; frequency: { period: string; count: number }; trialPeriodDays?: number; repetitions?: number };
    assert.deepEqual([plan.prices[0].amount, plan.frequency.count], expected[code as keyof typeof expected], `${code}: total del período completo, nunca el equivalente mensual`);
    assert.equal(plan.prices[0].currency, "ARS");
    assert.equal(plan.frequency.period, "month");
    assert.equal(plan.trialPeriodDays, undefined, "sin prueba gratuita");
    assert.equal(plan.repetitions, undefined, "sin repeticiones: cobra hasta que la profesora cancele");
    assert.equal((getPlan(code)?.amountMinor ?? 0) / 100, expected[code as keyof typeof expected][0]);
  }
  for (const link of fake.state.links as { redirectUrls: { approved: string }; paymentMethods: { methods: string[] }[]; plan: { id: string } }[]) {
    assert.equal(link.redirectUrls.approved, "https://teacherflowapp.com/facturacion/resultado");
    assert.deepEqual(link.paymentMethods[0].methods, ["card"]);
  }
  assert.deepEqual((fake.state.hooks[0] as { events: string[] }).events, ["payment.created", "payment.updated", "subscription.created", "subscription.updated"]);
  assert.equal((fake.state.hooks[0] as { url: string }).url, "https://teacherflowapp.com/api/billing/webhooks/rebill");
  assert.equal(Object.keys(result.env).length, 8);
  assert.equal(result.webhookSecret, SECRET);
});

test("es idempotente: volver a correr no crea nada y devuelve los mismos ids", async () => {
  const fake = fakeRebill();
  const first = await provision(clientFor(fake), { apply: true, log: () => {} });
  const writesAfterFirst = fake.state.writes;
  const second = await provision(clientFor(fake), { apply: true, log: () => {} });
  assert.equal(fake.state.writes, writesAfterFirst, "la segunda corrida no escribe");
  assert.deepEqual(second.env, first.env);
  assert.equal(second.webhookSecret, null, "el secreto sólo se obtiene al crear el webhook");
});

test("si no puede listar lo existente NO crea nada (evita duplicar)", async () => {
  const fake = fakeRebill({ failList: true });
  await assert.rejects(() => provision(clientFor(fake), { apply: true, log: () => {} }), ProvisionError);
  assert.equal(fake.state.writes, 0);
});

test("un plan existente con otro precio detiene todo: nunca se edita un precio", async () => {
  const fake = fakeRebill({ seedPlans: [{ id: "test_pln_9999", status: "active", metadata: { tfCode: "tf_monthly_ars_v2" }, frequency: { period: "month", count: 1 }, prices: [{ amount: 24900, currency: "ARS", isDefault: true }] }] });
  await assert.rejects(() => provision(clientFor(fake), { apply: true, log: () => {} }), /NO coincide con el catálogo/);
  assert.equal(fake.state.writes, 0);
});

test("una prueba gratuita en un plan existente también lo hace incompatible", async () => {
  const fake = fakeRebill({ seedPlans: [{ id: "test_pln_9998", status: "active", trialPeriodDays: 7, metadata: { tfCode: "tf_monthly_ars_v2" }, frequency: { period: "month", count: 1 }, prices: [{ amount: 25900, currency: "ARS", isDefault: true }] }] });
  await assert.rejects(() => provision(clientFor(fake), { apply: true, log: () => {} }), /NO coincide con el catálogo/);
});

test("la clave y el secreto del webhook nunca se imprimen; sólo viaja la clave secreta y sólo en x-api-key", async () => {
  const fake = fakeRebill();
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  await check(clientFor(fake), log);
  const result = await provision(clientFor(fake), { apply: true, log });
  const printed = lines.join("\n");
  assert.ok(!printed.includes(KEY) && !printed.includes(SECRET), "ni la clave ni el secreto aparecen en la salida");
  assert.ok(result.webhookSecret);
  assert.deepEqual([...fake.state.keys], [KEY]);
});

test("rechaza una clave pública y una dirección de API distinta de Rebill", () => {
  assert.throws(() => createClient({ apiKey: "pk_publica" }), ProvisionError);
  assert.throws(() => createClient({ apiKey: KEY, baseUrl: "https://ejemplo.com" }), ProvisionError);
  assert.doesNotThrow(() => createClient({ apiKey: KEY, baseUrl: "http://127.0.0.1:9999" }));
});

test("el script se detiene si el payment link existente no vuelve a /facturacion/resultado", async () => {
  const fake = fakeRebill();
  await provision(clientFor(fake), { apply: true, log: () => {} });
  (fake.state.links[0] as { redirectUrls: { approved: string } }).redirectUrls.approved = "https://otro.example/gracias";
  await assert.rejects(() => provision(clientFor(fake), { apply: true, log: () => {} }), /no vuelve a/);
});
