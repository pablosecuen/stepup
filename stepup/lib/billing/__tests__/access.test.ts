import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBillingAccess, type BillingAccess } from "../access.ts";
import { BILLING_FLAGS_OFF, readBillingFlags } from "../flags.ts";
import { BILLING_STATUSES } from "../state-machine.ts";
import { ar, snap } from "./helpers.ts";

const ON = { enabled: true, enforcement: true } as const;
const at = (date: string, hour = 0, minute = 0, second = 0) => new Date(Date.parse(ar(date, hour, minute)) + second * 1000);

// Una cuenta pagó hasta el 1/11 (00:00) y su vencimiento/gracia se cuenta a partir de ahí.
const PAID = { planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") } as const;

test("los interruptores nacen apagados; sólo el texto exacto «true» enciende, y el control de acceso nunca está sin la facturación", () => {
  assert.deepEqual(readBillingFlags({}), { enabled: false, enforcement: false });
  assert.deepEqual(BILLING_FLAGS_OFF, { enabled: false, enforcement: false });
  for (const value of ["", "false", "0", "1", "yes", "on", "TRUE1", "tru", " ", "enabled"]) assert.deepEqual(readBillingFlags({ BILLING_ENABLED: value, BILLING_ENFORCEMENT_ENABLED: value }), { enabled: false, enforcement: false }, JSON.stringify(value));
  assert.deepEqual(readBillingFlags({ BILLING_ENABLED: "true" }), { enabled: true, enforcement: false });
  assert.deepEqual(readBillingFlags({ BILLING_ENABLED: " TRUE " }), { enabled: true, enforcement: false });
  assert.deepEqual(readBillingFlags({ BILLING_ENABLED: "true", BILLING_ENFORCEMENT_ENABLED: "true" }), { enabled: true, enforcement: true });
  assert.deepEqual(readBillingFlags({ BILLING_ENFORCEMENT_ENABLED: "true" }), { enabled: false, enforcement: false }, "enforcement sin billing = apagado");
});

test("FLAGS APAGADOS = comportamiento actual: acceso completo para CUALQUIER estado y fecha, sin avisos", () => {
  const offs = [BILLING_FLAGS_OFF, { enabled: true, enforcement: false }, { enabled: false, enforcement: true }] as const;
  for (const flags of offs) {
    for (const status of BILLING_STATUSES) {
      for (const now of [at("2026-10-15"), at("2027-06-01"), at("2030-01-01")]) {
        const result = resolveBillingAccess({ flags, snapshot: snap({ status, ...PAID }), now });
        assert.equal(result.level, "full", `${status}`);
        assert.equal(result.reason, "enforcement_off");
        assert.equal(result.nextAction, "none");
        assert.equal(result.endsAt, null);
        assert.ok(Object.values(result.capabilities).every(Boolean), "todas las capacidades");
      }
    }
    assert.equal(resolveBillingAccess({ flags, snapshot: null, now: at("2026-10-15") }).level, "full");
  }
});

test("grandfathered: acceso completo, sin aviso y sin importar el tiempo", () => {
  const result = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "grandfathered", grandfathered: true }), now: at("2030-01-01") });
  assert.equal(result.level, "full");
  assert.equal(result.reason, "grandfathered");
  assert.equal(result.nextAction, "none");
});

test("active: acceso completo hasta el fin del período; el fin se informa", () => {
  const result = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "active", ...PAID }), now: at("2026-10-20") });
  assert.equal(result.level, "full");
  assert.equal(result.reason, "subscription_active");
  assert.equal(result.endsAt, ar("2026-11-01"));
  assert.ok(Object.values(result.capabilities).every(Boolean));
});

test("pasó el vencimiento sin resultado confirmado (past_due): acceso completo; el aviso de gracia sólo aparece con un rechazo confirmado", () => {
  const result = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "active", ...PAID }), now: at("2026-11-03") });
  assert.equal(result.status, "past_due");
  assert.equal(result.level, "full");
  assert.equal(result.reason, "renewal_processing");
  assert.equal(result.nextAction, "wait");
  assert.equal(result.endsAt, ar("2026-11-07"));
});

test("cobro rechazado: CINCO días de gracia con acceso completo, aviso y la acción de actualizar el medio de pago", () => {
  const snapshot = snap({ status: "grace_period", ...PAID, renewalRejectedDueAt: ar("2026-11-01", 10) });
  for (const now of [at("2026-11-01", 10), at("2026-11-02"), at("2026-11-06", 23, 59, 59)]) {
    const result = resolveBillingAccess({ flags: ON, snapshot, now });
    assert.equal(result.level, "full_with_notice");
    assert.equal(result.reason, "payment_failed_grace");
    assert.equal(result.nextAction, "update_payment_method");
    assert.equal(result.endsAt, ar("2026-11-07"));
    assert.ok(Object.values(result.capabilities).every(Boolean), "durante la gracia se conserva TODO el acceso");
  }
});

test("terminada la gracia: modo LIMITADO. Puede ingresar, ver sus datos y la facturación, cancelar, actualizar el medio de pago, exportar y eliminar; no crea ni modifica datos operativos", () => {
  const snapshot = snap({ status: "grace_period", ...PAID, renewalRejectedDueAt: ar("2026-11-01", 10) });
  const result = resolveBillingAccess({ flags: ON, snapshot, now: at("2026-11-07") });
  assert.equal(result.status, "limited");
  assert.equal(result.level, "limited");
  assert.equal(result.reason, "subscription_unpaid");
  assert.equal(result.nextAction, "update_payment_method");
  assert.deepEqual(result.capabilities, {
    viewOperationalData: true,
    createOperationalData: false,
    modifyOperationalData: false,
    viewBilling: true,
    cancelSubscription: true,
    updatePaymentMethod: true,
    exportData: true,
    deleteAccount: true,
    contactSupport: true,
  });
});

test("la exportación de datos y la baja de cuenta están disponibles en CADA estado limitado", () => {
  const limited: BillingAccess[] = [
    resolveBillingAccess({ flags: ON, snapshot: snap({ status: "pending" }), now: at("2026-10-15") }),
    resolveBillingAccess({ flags: ON, snapshot: snap({ status: "limited", ...PAID }), now: at("2026-12-01") }),
    resolveBillingAccess({ flags: ON, snapshot: snap({ status: "canceled", cancelRequestedAt: ar("2026-10-10") }), now: at("2026-10-15") }),
    resolveBillingAccess({ flags: ON, snapshot: snap({ status: "expired", providerEndedAt: ar("2026-10-10") }), now: at("2026-10-15") }),
  ];
  assert.deepEqual(limited.map((item) => item.status), ["pending", "limited", "canceled", "expired"]);
  for (const item of limited) {
    assert.equal(item.level, "limited");
    assert.equal(item.capabilities.exportData, true);
    assert.equal(item.capabilities.deleteAccount, true);
    assert.equal(item.capabilities.viewBilling, true);
    assert.equal(item.capabilities.viewOperationalData, true);
    assert.equal(item.capabilities.createOperationalData, false);
    assert.equal(item.capabilities.modifyOperationalData, false);
  }
  assert.deepEqual(limited.map((item) => item.nextAction), ["subscribe", "update_payment_method", "resubscribe", "resubscribe"]);
});

test("cancelada con acceso hasta el fin del período: acceso completo con aviso y la acción de reactivar", () => {
  const snapshot = snap({ status: "cancel_at_period_end", ...PAID, cancelRequestedAt: ar("2026-10-10") });
  const during = resolveBillingAccess({ flags: ON, snapshot, now: at("2026-10-31", 23, 59, 59) });
  assert.equal(during.level, "full_with_notice");
  assert.equal(during.reason, "subscription_ending");
  assert.equal(during.nextAction, "reactivate");
  assert.equal(during.endsAt, ar("2026-11-01"));
  const after = resolveBillingAccess({ flags: ON, snapshot, now: at("2026-11-01") });
  assert.equal(after.status, "canceled");
  assert.equal(after.level, "limited");
});

test("la resolución usa el reloj: no confía en el estado guardado (una cuenta «active» vencida hace meses está limitada)", () => {
  const stale = snap({ status: "active", ...PAID });
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: stale, now: at("2027-03-01") }).level, "limited");
  // Y al revés: los datos del período mandan sobre la etiqueta guardada (dentro de lo pagado hay acceso completo aunque diga limited).
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: snap({ status: "limited", ...PAID }), now: at("2026-10-15") }).level, "full");
});

test("el motivo es un código seguro: nunca contiene datos de la cuenta, identificadores ni texto libre", () => {
  const reasons = new Set<string>();
  for (const status of BILLING_STATUSES) {
    for (const now of [at("2026-10-15"), at("2026-11-03"), at("2027-01-01")]) {
      reasons.add(resolveBillingAccess({ flags: ON, snapshot: snap({ status, ...PAID, providerReference: "tfs_" + "b".repeat(32), providerSubscriberUid: "sub_secret_123" }), now }).reason);
    }
  }
  for (const reason of reasons) assert.match(reason, /^[a-z_]+$/, reason);
});

test("la resolución es pura: no modifica el snapshot ni depende de la zona horaria del proceso", () => {
  const snapshot = Object.freeze(snap({ status: "active", ...PAID }));
  const first = resolveBillingAccess({ flags: ON, snapshot, now: at("2026-11-03") });
  const second = resolveBillingAccess({ flags: ON, snapshot, now: at("2026-11-03") });
  assert.deepEqual(first, second);
});
