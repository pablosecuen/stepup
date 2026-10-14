import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBillingView, buildHistory, buildPlanOptions, cadenceLabel, perMonthLabel, pesos, type BillingView } from "../view.ts";
import { DEMO_NOW, DEMO_SCENARIOS } from "../demo-scenarios.ts";
import { listActivePlans } from "../plans.ts";
import { parseCheckoutCustomer, normalizeIdentification } from "../customer.ts";
import { pollDelayMs, withJitter } from "../poll-policy.ts";
import { ar, snap } from "./helpers.ts";
import type { ProviderCapabilities } from "../provider.ts";

/** Intl separa «$» del número con un espacio duro: en los textos de prueba se compara con espacio común. */
const plain = (text: string | null | undefined): string => (text ?? "").replace(/\u00a0/g, " ");
const plainDeep = <T,>(value: T): T => JSON.parse(plain(JSON.stringify(value)));

const CAPS: ProviderCapabilities = { changePlan: true, paymentMethodUpdate: true };
const NO_CAPS: ProviderCapabilities = { changePlan: false, paymentMethodUpdate: false };
const NOW = new Date(Date.parse(ar("2026-10-20", 12)));
const PAID = { planCode: "tf_monthly_ars_v1", providerPlanCode: "tf_monthly_ars_v1", providerSubscriberUid: "SUB1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") } as const;

const view = (overrides: Parameters<typeof snap>[0] = {}, caps = CAPS, now = NOW): BillingView => buildBillingView({ snapshot: snap(overrides), history: null, now, capabilities: caps, available: true });

test("los cuatro planes: $24.900 mensual, $69.900 cada 3 meses, $133.900 cada 6 meses y $249.000 anual, con el ahorro EXACTO frente al mensual", () => {
  const options = buildPlanOptions();
  assert.deepEqual(plainDeep(options.map((o) => [o.name, o.price, o.cadence])), [
    ["Mensual", "$ 24.900", "por mes"],
    ["Trimestral", "$ 69.900", "cada 3 meses"],
    ["Semestral", "$ 133.900", "cada 6 meses"],
    ["Anual", "$ 249.000", "por año"],
  ]);
  assert.deepEqual(plainDeep(options.map((o) => o.saving)), [null, "Ahorrás $ 4.800 frente al plan mensual", "Ahorrás $ 15.500 frente al plan mensual", "Ahorrás $ 49.800 frente al plan mensual"]);
  assert.deepEqual(plainDeep(options.map((o) => o.perMonth)), [null, "$ 23.300 por mes", "unos $ 22.317 por mes", "$ 20.750 por mes"]);
  // El ahorro sale del catálogo en centavos enteros: 3×24.900 − 69.900 = 4.800, etc.
  const monthly = listActivePlans()[0];
  for (const plan of listActivePlans().slice(1)) assert.equal(monthly.amountMinor * plan.monthsOfAccess - plan.amountMinor > 0, true);
  assert.equal(plain(pesos(2_490_000)), "$ 24.900");
  assert.equal(cadenceLabel({ monthsOfAccess: 6 }), "cada 6 meses");
  assert.equal(plain(perMonthLabel({ amountMinor: 6_990_000, monthsOfAccess: 3 })), "$ 23.300 por mes");
});

test("NINGUNA pantalla muestra el neto de Mobbex, la comisión ni los importes netos", () => {
  const texts: string[] = [JSON.stringify(buildPlanOptions())];
  for (const scenario of Object.values(DEMO_SCENARIOS)) texts.push(JSON.stringify(buildBillingView({ snapshot: scenario.snapshot, history: scenario.history, now: DEMO_NOW, capabilities: CAPS, available: scenario.available })));
  const all = texts.join("\n");
  for (const forbidden of ["23.724", "66.601", "127.581", "237.249", "4,719", "4.719", "3,9", "comisión", "Mobbex"]) assert.equal(plain(all).includes(forbidden), false, forbidden);
});

test("cada estado tiene etiqueta con TEXTO (nunca sólo color), titular y explicación en español, sin códigos internos ni identificadores", () => {
  const seen = new Set<string>();
  for (const [name, scenario] of Object.entries(DEMO_SCENARIOS)) {
    const v = buildBillingView({ snapshot: scenario.snapshot, history: scenario.history, now: DEMO_NOW, capabilities: CAPS, available: scenario.available });
    seen.add(v.state);
    assert.ok(v.badge.label.length >= 4, name);
    assert.match(v.headline, /^[A-ZÁÉÍÓÚ]/, name);
    assert.ok(v.body.length > 30, name);
    // Sólo lo que la persona LEE (no las claves ni los valores nulos del objeto).
    const visible = [v.badge.label, v.headline, v.body, v.plan?.name, v.plan?.price, v.plan?.cadence, ...v.facts.flatMap((f) => [f.label, f.value]), ...v.notices.flatMap((n) => [n.title, n.text]), ...v.history.flatMap((r) => [r.title, r.detail, r.amount, r.tag?.label])].filter((x): x is string => typeof x === "string").join("\n");
    for (const forbidden of [/tf_[a-z]+_ars/i, /tfs_[0-9a-f]{8}/, /billing_/i, /demo_subscriber/, /\b(null|undefined|NaN)\b/, /[0-9a-f]{8}-[0-9a-f]{4}-/i]) assert.doesNotMatch(visible, forbidden, `${name}: ${visible.slice(0, 120)}`);
  }
  for (const state of ["unavailable", "grandfathered", "none", "processing", "active", "renewing", "grace", "limited", "ending", "canceled", "expired"]) assert.ok(seen.has(state), `escenario faltante: ${state}`);
});

test("activa: período, próxima renovación, renovación automática y acciones (cancelar, y cambiar plan/medio de pago sólo si el proveedor las tiene validadas)", () => {
  const v = view({ status: "active", ...PAID });
  assert.equal(v.state, "active");
  assert.match(v.body, /se renueva automáticamente/i);
  assert.deepEqual(v.facts, [{ label: "Período actual", value: "01/10/2026 al 31/10/2026" }, { label: "Próxima renovación", value: "01/11/2026" }]);
  assert.deepEqual(v.actions, { subscribe: false, cancel: true, reactivate: false, changePlan: true, updatePaymentMethod: true });
  assert.equal(v.cancelAccessUntil, "31/10/2026");
  const closed = view({ status: "active", ...PAID }, NO_CAPS);
  assert.deepEqual(closed.actions, { subscribe: false, cancel: true, reactivate: false, changePlan: false, updatePaymentMethod: false }, "nunca un botón cuyo respaldo no está validado");
  const noSubscriber = view({ status: "active", ...PAID, providerSubscriberUid: null });
  assert.equal(noSubscriber.actions.updatePaymentMethod, false);
});

test("pago rechazado: CINCO días corridos de gracia, hasta el D+5 inclusive, con acceso completo y la acción de actualizar el medio de pago", () => {
  const v = view({ status: "grace_period", ...PAID, currentPeriodEnd: ar("2026-10-18"), currentPeriodStart: ar("2026-09-18"), renewalRejectedDueAt: ar("2026-10-18", 10), graceEndsAt: ar("2026-10-24") }, CAPS, NOW);
  assert.equal(v.state, "grace");
  assert.match(v.body, /5 días/);
  assert.match(v.body, /hasta el 23\/10\/2026 inclusive/);
  assert.equal(v.facts.find((f) => f.label === "Acceso completo hasta")?.value, "23/10/2026");
  assert.equal(v.actions.updatePaymentMethod, true);
  assert.equal(v.actions.cancel, true);
  assert.equal(v.badge.tone, "warn");
  assert.equal(v.cancelAccessUntil, "23/10/2026");
  const noPayment = view({ status: "grace_period", ...PAID, currentPeriodEnd: ar("2026-10-18"), renewalRejectedDueAt: ar("2026-10-18", 10), graceEndsAt: ar("2026-10-24") }, NO_CAPS);
  assert.equal(noPayment.actions.updatePaymentMethod, false);
  assert.equal(noPayment.notices.length, 1, "se avisa por texto que el cambio de medio de pago todavía no está");
});

test("modo limitado: dice qué SÍ se puede (ingresar, ver, exportar, facturación, medio de pago) y qué no, y que nada se borra", () => {
  const v = view({ status: "limited", ...PAID, currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07") });
  assert.equal(v.state, "limited");
  for (const phrase of [/ver y exportar/, /no crear ni modificar/, /No borramos nada/]) assert.match(v.body, phrase);
  assert.equal(v.badge.tone, "bad");
  assert.equal(v.actions.updatePaymentMethod, true);
});

test("cancelada al final del período: conserva el acceso hasta esa fecha, no se vuelve a cobrar y se puede REACTIVAR", () => {
  const v = view({ status: "cancel_at_period_end", ...PAID, cancelRequestedAt: ar("2026-10-10") });
  assert.equal(v.state, "ending");
  assert.match(v.headline, /termina el 31\/10\/2026/);
  assert.equal(v.actions.reactivate, true);
  assert.equal(v.actions.cancel, false);
  assert.match(v.body, /no se te vuelve a cobrar/);
});

test("pendiente, cancelada, finalizada y sin suscripción: ofrecen elegir un plan (nunca una acción inexistente)", () => {
  assert.equal(view({ status: "pending" }).state, "none");
  assert.equal(view({ status: "pending", providerSubscriberUid: "S" }).state, "processing");
  assert.equal(view({ status: "pending", providerSubscriberUid: "S" }).actions.cancel, true);
  for (const overrides of [{ status: "canceled" as const, cancelRequestedAt: ar("2026-10-01") }, { status: "expired" as const, providerEndedAt: ar("2026-10-01") }, { status: "pending" as const }]) assert.equal(view(overrides).actions.subscribe, true);
  assert.equal(view({ status: "grandfathered", grandfathered: true }).actions.subscribe, true);
});

test("contracargo: aviso claro y acceso limitado; un contracargo FUTURO todavía no se muestra", () => {
  const v = view({ status: "limited", ...PAID, chargebackAt: ar("2026-10-15", 12) });
  assert.equal(v.notices.length, 1);
  assert.match(v.notices[0].title, /disputa de pago/);
  assert.equal(view({ status: "active", ...PAID, chargebackAt: ar("2026-12-15", 12) }).state, "active");
});

test("pantalla «no disponible»: sin fila o con la base caída no se muestra nada inventado y no hay acciones", () => {
  const down = buildBillingView({ snapshot: snap({ status: "active", ...PAID }), history: null, now: NOW, capabilities: CAPS, available: false });
  assert.equal(down.state, "unavailable");
  assert.deepEqual(down.actions, { subscribe: false, cancel: false, reactivate: false, changePlan: false, updatePaymentMethod: false });
  assert.equal(buildBillingView({ snapshot: null, history: null, now: NOW, capabilities: CAPS, available: true }).state, "unavailable");
});

test("cambio de plan programado: se informa el plan, el precio y la fecha de la próxima renovación (sin prorrateo)", () => {
  const v = view({ status: "active", ...PAID, planCode: "tf_annual_ars_v1", pendingPlanCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-03-01"), currentPeriodEnd: ar("2027-03-01") });
  assert.deepEqual(plainDeep(v.pendingChange), { planName: "Mensual", price: "$ 24.900", effective: "01/03/2027" });
});

test("historial: períodos y cobros ordenados del más nuevo al más viejo, con su resultado en texto; los anulados y devueltos se marcan; nunca un identificador", () => {
  const rows = buildHistory({
    periods: [
      { planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, periodStart: ar("2026-08-01"), periodEnd: ar("2026-09-01"), voidedAt: ar("2026-08-12") },
      { planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, periodStart: ar("2026-10-01"), periodEnd: ar("2026-11-01"), voidedAt: null },
    ],
    charges: [
      { outcome: "refunded", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar("2026-08-01", 9), occurredAt: ar("2026-08-12") },
      { outcome: "approved", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar("2026-10-01", 10), occurredAt: ar("2026-10-01", 10) },
      { outcome: "chargeback", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar("2026-09-01", 10), occurredAt: ar("2026-09-10") },
      { outcome: "rejected", planCode: "tf_monthly_ars_v1", amountMinor: 2_490_000, dueAt: ar("2026-07-01", 10), occurredAt: ar("2026-07-01") },
    ],
  });
  assert.deepEqual(rows.map((r) => r.tag?.label ?? "—"), ["—", "Pago aprobado", "Contracargo", "Anulado", "Devuelto", "Pago rechazado"]);
  assert.equal(rows[0].detail, "Del 01/10/2026 al 31/10/2026");
  assert.equal(JSON.stringify(rows).includes("exe_"), false);
  assert.deepEqual(buildHistory(null), []);
});

// --- datos del pago (DNI/CUIT) ----------------------------------------------------------------------------------------------

test("DNI/CUIT: sólo 7–8 dígitos (DNI) u 11 (CUIT/CUIL), con o sin puntos, guiones y espacios; el mensaje de error NUNCA repite lo escrito", () => {
  for (const [input, expected] of [["12.345.678", "12345678"], ["1234567", "1234567"], ["20-12345678-9", "20123456789"], [" 20 12345678 9 ", "20123456789"], ["20123456789", "20123456789"]] as const) assert.equal(normalizeIdentification(input), expected, input);
  for (const bad of ["", "123456", "123456789", "1234567890", "2012345678901", "abc12345", "12345678;drop", "1".repeat(21), null, undefined, 12345678, {}]) assert.equal(normalizeIdentification(bad), null, String(bad));
  const secret = "29876543x";
  const rejected = parseCheckoutCustomer({ name: "Ana Pérez", identification: secret }, "ana@example.test");
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(rejected).includes("29876543"), false, "el error no repite el documento");
  const ok = parseCheckoutCustomer({ name: "  Ana   María  Pérez-Gómez ", identification: "29.876.543" }, " ana@example.test ");
  assert.deepEqual(ok, { ok: true, customer: { email: "ana@example.test", name: "Ana María Pérez-Gómez", identification: "29876543" } });
});

test("nombre: entre 3 y 80 letras, sin símbolos raros; el correo lo pone la sesión, nunca el formulario", () => {
  for (const bad of ["", "A", "Ab", "<script>", "Ana; DROP", "1234", "x".repeat(81), null, undefined, {}]) assert.equal(parseCheckoutCustomer({ name: bad, identification: "29876543" }, "a@b.test").ok, false, String(bad));
  assert.equal(parseCheckoutCustomer({ name: "Ana Pérez", identification: "29876543" }, null).ok, false, "sin correo de sesión no se crea el pago");
  assert.equal(parseCheckoutCustomer({ name: "Ana Pérez", identification: "29876543" }, "sin-arroba").ok, false);
  const withEmailField = parseCheckoutCustomer({ name: "Ana Pérez", identification: "29876543", email: "otro@evil.test" } as never, "ana@example.test");
  assert.equal(withEmailField.ok && withEmailField.customer.email, "ana@example.test", "un correo enviado por el navegador se ignora");
});

// --- política de sondeo ---------------------------------------------------------------------------------------------------------

test("política de sondeo: más seguido cuanto más cerca está de cambiar el estado; una cuenta estable, una vez por semana; las terminadas dejan de sondearse sólo si el proveedor lo confirma", () => {
  const H = 3_600_000;
  const base = { currentPeriodEnd: ar("2026-11-01"), now: new Date(Date.parse(ar("2026-10-20"))) };
  assert.equal(pollDelayMs({ ...base, status: "pending", providerStatus: "active" }), 2 * H);
  assert.equal(pollDelayMs({ ...base, status: "past_due", providerStatus: "active" }), H);
  assert.equal(pollDelayMs({ ...base, status: "grace_period", providerStatus: "active" }), 6 * H);
  assert.equal(pollDelayMs({ ...base, status: "limited", providerStatus: "active" }), 24 * H);
  assert.equal(pollDelayMs({ ...base, status: "active", providerStatus: "active" }), 7 * 24 * H, "estable: una vez por semana");
  assert.equal(pollDelayMs({ ...base, status: "active", providerStatus: "active", now: new Date(Date.parse(ar("2026-10-31"))) }), 6 * H, "ventana de renovación");
  assert.equal(pollDelayMs({ ...base, status: "active", providerStatus: "active", currentPeriodEnd: null }), 7 * 24 * H);
  for (const status of ["canceled", "expired"] as const) {
    assert.equal(pollDelayMs({ ...base, status, providerStatus: "suspended" }), null);
    assert.equal(pollDelayMs({ ...base, status, providerStatus: "finished" }), null);
    assert.equal(pollDelayMs({ ...base, status, providerStatus: "active" }), 7 * 24 * H, "el proveedor sigue activo: se sigue mirando");
    assert.equal(pollDelayMs({ ...base, status, providerStatus: "unknown" }), 7 * 24 * H);
  }
  assert.equal(pollDelayMs({ ...base, status: "cancel_at_period_end", providerStatus: "active" }), 24 * H);
});

test("la dispersión es determinista por cuenta, de ±10 %, y reparte las renovaciones concentradas", () => {
  const owners = Array.from({ length: 1000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const delays = owners.map((owner) => withJitter(3_600_000, owner));
  assert.deepEqual(delays, owners.map((owner) => withJitter(3_600_000, owner)));
  assert.ok(delays.every((d) => d >= 3_600_000 * 0.9 - 1 && d <= 3_600_000 * 1.1 + 1));
  assert.ok(new Set(delays).size > 300, "no caen todas en el mismo instante");
});

test("un contracargo que todavía no ocurrió no muestra el aviso, aunque la cuenta esté limitada por otro motivo", () => {
  const lapsed = { status: "limited" as const, ...PAID, currentPeriodEnd: ar("2026-10-01"), graceEndsAt: ar("2026-10-07") };
  assert.equal(view({ ...lapsed, chargebackAt: ar("2026-12-15", 12) }).notices.length, 0);
  assert.equal(view({ ...lapsed, chargebackAt: ar("2026-10-15", 12) }).notices.length, 1);
  assert.equal(view({ ...lapsed, chargebackAt: null }).notices.length, 0);
});
