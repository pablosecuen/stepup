import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOMATIC_TRIGGERS, BILLING_STATUSES, COMMAND_TRIGGERS, DERIVATION_TRIGGERS, TRANSITIONS, applyTrigger, canApplyTrigger, edgesFrom, isReachable, type BillingStatus, type BillingTrigger } from "../state-machine.ts";

const ALL_TRIGGERS: readonly BillingTrigger[] = [...AUTOMATIC_TRIGGERS, ...COMMAND_TRIGGERS];

/** Todas las transiciones permitidas, escritas a mano: la prueba compara la tabla del código contra ESTA lista. */
const EXPECTED: ReadonlyArray<[BillingStatus, BillingTrigger, BillingStatus]> = [
  ["grandfathered", "payment_confirmed", "active"],
  ["grandfathered", "checkout_started", "grandfathered"],
  ["grandfathered", "grandfather_ended", "pending"],
  ["pending", "payment_confirmed", "active"],
  ["pending", "payment_rejected", "pending"],
  ["pending", "checkout_started", "pending"],
  ["pending", "cancel_requested", "canceled"],
  ["pending", "provider_ended", "expired"],
  ["active", "renewal_due", "past_due"],
  ["active", "payment_confirmed", "active"],
  ["active", "payment_rejected", "grace_period"],
  ["active", "cancel_requested", "cancel_at_period_end"],
  ["active", "plan_change_requested", "active"],
  ["active", "provider_ended", "active"],
  ["active", "chargeback_confirmed", "limited"],
  ["active", "payment_voided", "pending"],
  ["past_due", "payment_confirmed", "active"],
  ["past_due", "payment_rejected", "grace_period"],
  ["past_due", "grace_elapsed", "limited"],
  ["past_due", "cancel_requested", "cancel_at_period_end"],
  ["past_due", "provider_ended", "expired"],
  ["past_due", "chargeback_confirmed", "limited"],
  ["past_due", "payment_voided", "pending"],
  ["grace_period", "payment_confirmed", "active"],
  ["grace_period", "payment_rejected", "grace_period"],
  ["grace_period", "grace_elapsed", "limited"],
  ["grace_period", "cancel_requested", "cancel_at_period_end"],
  ["grace_period", "provider_ended", "expired"],
  ["grace_period", "chargeback_confirmed", "limited"],
  ["grace_period", "payment_voided", "pending"],
  ["limited", "payment_confirmed", "active"],
  ["limited", "payment_rejected", "limited"],
  ["limited", "cancel_requested", "canceled"],
  ["limited", "provider_ended", "expired"],
  ["limited", "chargeback_confirmed", "limited"],
  ["limited", "payment_voided", "pending"],
  ["cancel_at_period_end", "period_elapsed", "canceled"],
  ["cancel_at_period_end", "reactivate_requested", "active"],
  ["cancel_at_period_end", "reactivate_requested", "past_due"],
  ["cancel_at_period_end", "reactivate_requested", "grace_period"],
  ["cancel_at_period_end", "cancel_requested", "cancel_at_period_end"],
  ["cancel_at_period_end", "payment_confirmed", "cancel_at_period_end"],
  ["cancel_at_period_end", "payment_rejected", "cancel_at_period_end"],
  ["cancel_at_period_end", "provider_ended", "cancel_at_period_end"],
  ["cancel_at_period_end", "chargeback_confirmed", "limited"],
  ["canceled", "checkout_started", "pending"],
  ["canceled", "cancel_requested", "canceled"],
  ["canceled", "payment_rejected", "canceled"],
  ["canceled", "provider_ended", "canceled"],
  ["expired", "payment_confirmed", "active"],
  ["expired", "checkout_started", "pending"],
  ["expired", "cancel_requested", "canceled"],
  ["expired", "payment_rejected", "expired"],
  ["expired", "provider_ended", "expired"],
];

test("hay exactamente nueve estados", () => {
  assert.deepEqual([...BILLING_STATUSES], ["grandfathered", "pending", "active", "past_due", "grace_period", "limited", "cancel_at_period_end", "canceled", "expired"]);
});

test("la tabla de transiciones es EXACTAMENTE la lista de transiciones válidas (ni una más, ni una menos)", () => {
  const actual: Array<[string, string, string]> = [];
  for (const from of BILLING_STATUSES) for (const trigger of ALL_TRIGGERS) for (const to of TRANSITIONS[from][trigger] ?? []) actual.push([from, trigger, to]);
  const key = (t: readonly string[]) => t.join(" | ");
  assert.deepEqual(actual.map(key).sort(), EXPECTED.map(key).sort());
});

test("cada transición válida se acepta, y un disparador con varios destinos exige uno de ellos", () => {
  for (const [from, trigger, to] of EXPECTED) {
    const result = applyTrigger(from, trigger, to);
    assert.deepEqual(result, { ok: true, status: to, changed: from !== to }, `${from} -${trigger}-> ${to}`);
  }
  assert.deepEqual(applyTrigger("cancel_at_period_end", "reactivate_requested"), { ok: false, code: "invalid_target" }, "falta elegir el destino");
  assert.deepEqual(applyTrigger("cancel_at_period_end", "reactivate_requested", "limited"), { ok: false, code: "invalid_target" }, "destino no listado");
});

test("TODA combinación estado × disparador que no figura es una transición IMPOSIBLE y se rechaza", () => {
  const valid = new Set(EXPECTED.map(([from, trigger]) => `${from}|${trigger}`));
  let checked = 0;
  for (const from of BILLING_STATUSES) {
    for (const trigger of ALL_TRIGGERS) {
      if (valid.has(`${from}|${trigger}`)) continue;
      checked += 1;
      assert.deepEqual(applyTrigger(from, trigger), { ok: false, code: "impossible_transition" }, `${from} -${trigger}->`);
      assert.equal(canApplyTrigger(from, trigger), false);
    }
  }
  assert.equal(checked, BILLING_STATUSES.length * ALL_TRIGGERS.length - valid.size);
});

test("transiciones imposibles que protegen reglas de negocio", () => {
  // Una cancelación no se revierte con un cobro suelto, y un pago no revive una cuenta cancelada.
  assert.equal(canApplyTrigger("canceled", "payment_confirmed"), false);
  assert.equal(isReachable("canceled", "active", DERIVATION_TRIGGERS), false);
  assert.equal(isReachable("canceled", "cancel_at_period_end", DERIVATION_TRIGGERS), false);
  // Cambiar de plan no duplica la suscripción: sólo con la suscripción activa, y nunca abre un checkout nuevo.
  for (const status of BILLING_STATUSES) assert.equal(canApplyTrigger(status, "plan_change_requested"), status === "active", status);
  for (const status of ["active", "past_due", "grace_period", "limited", "cancel_at_period_end"] as const) assert.equal(canApplyTrigger(status, "checkout_started"), false, `checkout desde ${status}`);
  // Se puede empezar una suscripción sólo desde estados sin suscripción vigente.
  for (const status of BILLING_STATUSES) assert.equal(canApplyTrigger(status, "checkout_started"), ["grandfathered", "pending", "canceled", "expired"].includes(status), status);
  // grandfathered no se bloquea por reloj ni por cobros rechazados.
  for (const trigger of ["renewal_due", "payment_rejected", "grace_elapsed", "period_elapsed", "cancel_requested"] as const) assert.equal(canApplyTrigger("grandfathered", trigger), false, trigger);
  // No hay un paso directo del modo limitado a la gracia, ni de la gracia a past_due (sólo pasando antes por un cobro aprobado).
  assert.equal(edgesFrom("limited").some((edge) => edge.to === "grace_period"), false);
  assert.equal(edgesFrom("grace_period").some((edge) => edge.to === "past_due"), false);
  assert.equal(edgesFrom("canceled").some((edge) => edge.to === "active"), false);
});

test("alcanzabilidad: una cuenta cuyos avisos se demoraron puede recorrer varios estados de una vez", () => {
  assert.equal(isReachable("active", "limited", DERIVATION_TRIGGERS), true); // active → past_due → limited
  assert.equal(isReachable("active", "expired", DERIVATION_TRIGGERS), true);
  assert.equal(isReachable("active", "canceled", DERIVATION_TRIGGERS), true); // active → cancel_at_period_end → canceled
  assert.equal(isReachable("pending", "active", DERIVATION_TRIGGERS), true);
  assert.equal(isReachable("grace_period", "limited", DERIVATION_TRIGGERS), true);
  assert.equal(isReachable("limited", "active", DERIVATION_TRIGGERS), true);
  assert.equal(isReachable("pending", "limited", [ "payment_rejected" ]), false); // sin un cobro aprobado no se llega a limited
  assert.equal(isReachable("grandfathered", "limited", [ "renewal_due", "grace_elapsed" ]), false);
});

test("la tabla está cerrada: todo destino es un estado válido y cada estado tiene al menos una salida", () => {
  for (const from of BILLING_STATUSES) {
    assert.ok(edgesFrom(from).length > 0, from);
    for (const edge of edgesFrom(from)) assert.ok((BILLING_STATUSES as readonly string[]).includes(edge.to), `${from} → ${edge.to}`);
  }
  // Todo estado es alcanzable desde alguno de los iniciales (grandfathered o pending).
  for (const status of BILLING_STATUSES) {
    assert.ok(isReachable("pending", status, ALL_TRIGGERS) || isReachable("grandfathered", status, ALL_TRIGGERS), status);
  }
});

test("la tabla está congelada (no se puede alterar en tiempo de ejecución)", () => {
  assert.throws(() => {
    (TRANSITIONS as unknown as Record<string, unknown>).active = {};
  }, TypeError);
});
