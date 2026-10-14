import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { OWN_FAILURE_TOLERANCE_MS, resolveBillingAccess } from "../access.ts";
import { BILLING_FLAGS_OFF } from "../flags.ts";
import { decodeLastKnown, encodeLastKnown } from "../last-known.ts";
import { checkBillingReadiness } from "../readiness.ts";
import { ar, snap } from "./helpers.ts";

const ON = { enabled: true, enforcement: true } as const;
const PAID = { planCode: "tf_monthly_ars_v1", currentPeriodStart: ar("2026-10-01"), currentPeriodEnd: ar("2026-11-01"), graceEndsAt: ar("2026-11-07") } as const;
const CUTOFF = "2026-09-01T00:00:00.000Z";
const OLD_ACCOUNT = { createdAt: "2026-03-01T12:00:00.000Z" };
const NEW_ACCOUNT = { createdAt: "2026-10-05T12:00:00.000Z" };
const NOW = new Date(Date.parse(ar("2026-10-15", 12)));
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

test("estado desconocido — cuenta EXISTENTE: acceso completo, aviso interno y conciliación prioritaria (nada visible para la persona)", () => {
  for (const read of ["failed", "ok"] as const) {
    const result = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read, account: OLD_ACCOUNT, grandfatherCutoff: CUTOFF });
    assert.equal(result.level, "full");
    assert.equal(result.reason, "state_unavailable_existing_account");
    assert.equal(result.internalNotice, true);
    assert.equal(result.reconcilePriority, true);
    assert.equal(result.status, null);
    assert.ok(Object.values(result.capabilities).every(Boolean));
  }
  // Sin corte configurado no se puede probar que la cuenta sea nueva: nunca se castiga a una cuenta real por una configuración faltante.
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", account: NEW_ACCOUNT, grandfatherCutoff: null }).level, "full");
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", account: NEW_ACCOUNT, grandfatherCutoff: "no-es-fecha" }).level, "full");
});

test("estado desconocido — GRANDFATHERED (por la última verificación o por una fila ilegible): acceso completo con aviso interno", () => {
  const known = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", lastKnown: { status: "grandfathered", grandfathered: true, verifiedAt: hoursAgo(2000) }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(known.level, "full");
  assert.equal(known.reason, "state_unavailable_grandfathered");
  assert.equal(known.internalNotice, true);
  const illegible = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "inventado" as never, grandfathered: true }), now: NOW, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(illegible.reason, "state_unavailable_grandfathered");
  assert.equal(illegible.level, "full");
});

test("estado desconocido — ANTERIORMENTE ACTIVA ante una falla propia: tolerancia acotada de 72 h desde la última verificación; después, modo limitado", () => {
  for (const status of ["active", "past_due", "grace_period", "cancel_at_period_end"] as const) {
    const within = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", lastKnown: { status, grandfathered: false, verifiedAt: hoursAgo(71) }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
    assert.equal(within.level, "full_with_notice", status);
    assert.equal(within.reason, "state_unavailable_tolerance");
    assert.equal(within.reconcilePriority, true);
    assert.equal(within.internalNotice, true);
    assert.equal(within.nextAction, "wait");
    assert.equal(within.endsAt, new Date(NOW.getTime() + 3_600_000).toISOString(), "termina 72 h después de la verificación");
    assert.ok(Object.values(within.capabilities).every(Boolean));
  }
  const edge = (hours: number) => resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", lastKnown: { status: "active", grandfathered: false, verifiedAt: hoursAgo(hours) }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(edge(72).level, "limited", "a las 72 h exactas la tolerancia ya terminó");
  assert.equal(edge(72).reason, "state_unavailable_tolerance_expired");
  assert.equal(edge(200).capabilities.createOperationalData, false);
  assert.equal(edge(200).capabilities.exportData, true);
  assert.equal(OWN_FAILURE_TOLERANCE_MS, 72 * 3_600_000);
});

test("estado desconocido — la tolerancia sólo la da haber estado ACTIVA: pendiente, cancelada, vencida o limitada no la reciben", () => {
  for (const status of ["pending", "limited", "canceled", "expired"] as const) {
    const result = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", lastKnown: { status, grandfathered: false, verifiedAt: hoursAgo(1) }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
    assert.equal(result.level, "limited", status);
    assert.equal(result.reason, "state_unavailable_unverified");
  }
});

test("estado desconocido — cuenta NUEVA sin pago verificado: modo limitado (nunca acceso completo); sin fila se ofrece suscribirse, con falla propia se espera", () => {
  const failed = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(failed.level, "limited");
  assert.equal(failed.reason, "state_unavailable_unverified");
  assert.equal(failed.nextAction, "wait");
  assert.equal(failed.reconcilePriority, true);
  const noRow = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(noRow.level, "limited");
  assert.equal(noRow.nextAction, "subscribe");
  // Con corte configurado y sin fecha de alta fiable, no se asume antigüedad.
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", account: { createdAt: null }, grandfatherCutoff: CUTOFF }).level, "limited");
  assert.equal(resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", account: null, grandfatherCutoff: CUTOFF }).level, "limited");
});

test("estado desconocido — ningún dato del cliente puede activar: entradas ajenas al contrato no cambian el resultado", () => {
  const base = { flags: ON, snapshot: snap({ status: "pending" }), now: NOW } as const;
  const tampered = { ...base, paid: true, returnedFromCheckout: true, status: "active", redirectParams: { status: "approved" }, webhook: { outcome: "approved" } } as never;
  const clean = resolveBillingAccess(base);
  assert.deepEqual(resolveBillingAccess(tampered), clean);
  assert.equal(clean.level, "limited");
  assert.equal(clean.reason, "subscription_pending");
});

test("un reloj ilegible o una verificación ilegible son fallas propias: se otorga la tolerancia a quien estaba activa", () => {
  const badClock = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "active", ...PAID }), now: new Date("invalid"), lastKnown: { status: "active", grandfathered: false, verifiedAt: hoursAgo(1) }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(badClock.reason, "state_unavailable_tolerance");
  const badStamp = resolveBillingAccess({ flags: ON, snapshot: null, now: NOW, read: "failed", lastKnown: { status: "active", grandfathered: false, verifiedAt: "no" }, account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
  assert.equal(badStamp.reason, "state_unavailable_tolerance");
  assert.equal(badStamp.endsAt, null);
});

test("el estado conocido manda sobre la tolerancia: con la base respondiendo no se usa la última verificación", () => {
  const now = new Date(Date.parse(ar("2026-12-01")));
  const result = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "limited", ...PAID }), now, lastKnown: { status: "active", grandfathered: false, verifiedAt: now.toISOString() } });
  assert.equal(result.level, "limited");
  assert.equal(result.reason, "subscription_unpaid");
  assert.equal(result.internalNotice, false);
  assert.equal(result.reconcilePriority, false);
});

test("con los interruptores apagados el estado desconocido tampoco restringe nada", () => {
  for (const flags of [BILLING_FLAGS_OFF, { enabled: true, enforcement: false }] as const) {
    const result = resolveBillingAccess({ flags, snapshot: null, now: NOW, read: "failed", account: NEW_ACCOUNT, grandfatherCutoff: CUTOFF });
    assert.equal(result.level, "full");
    assert.equal(result.reason, "enforcement_off");
    assert.equal(result.internalNotice, false);
  }
});

test("el modo limitado incluye contactar a soporte y sigue sin permitir crear, editar ni importar", () => {
  const limited = resolveBillingAccess({ flags: ON, snapshot: snap({ status: "pending" }), now: NOW });
  assert.equal(limited.capabilities.contactSupport, true);
  assert.equal(limited.capabilities.createOperationalData, false);
  assert.equal(limited.capabilities.modifyOperationalData, false);
});

// --- Comprobante firmado de la última verificación --------------------------------------------------------------------------

const SECRET = "s".repeat(40);
const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const VALUE = { status: "active", grandfathered: false, verifiedAt: hoursAgo(2) } as const;

test("comprobante: ida y vuelta; sólo contiene estado, condición, instante y una huella de la cuenta (ningún dato personal)", () => {
  const token = encodeLastKnown(SECRET, OWNER, VALUE);
  assert.ok(token);
  assert.deepEqual(decodeLastKnown(SECRET, OWNER, token, NOW), VALUE);
  const body = JSON.parse(Buffer.from(token!.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["g", "o", "s", "t"]);
  assert.ok(!token!.includes(OWNER), "el identificador de la cuenta no viaja en claro");
  assert.ok(token!.length < 200);
});

test("comprobante: se rechaza si está alterado, firmado con otro secreto, de otra cuenta, del futuro o mal formado", () => {
  const token = encodeLastKnown(SECRET, OWNER, VALUE)!;
  const [v, body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ s: "active", g: 0, t: Date.parse(hoursAgo(0.1)), o: "x" }), "utf8").toString("base64url");
  const cases: Array<[string, string | null | undefined, string]> = [
    ["cuerpo alterado", `${v}.${forged}.${sig}`, SECRET],
    ["firma alterada", `${v}.${body}.${sig.slice(0, -2)}AA`, SECRET],
    ["otro secreto", token, "t".repeat(40)],
    ["secreto corto", token, "corto"],
    ["versión desconocida", `v2.${body}.${sig}`, SECRET],
    ["vacío", "", SECRET],
    ["null", null, SECRET],
    ["sin partes", "abc", SECRET],
    ["enorme", "a".repeat(600), SECRET],
  ];
  for (const [name, value, secret] of cases) assert.equal(decodeLastKnown(secret, OWNER, value, NOW), null, name);
  assert.equal(decodeLastKnown(SECRET, OTHER, token, NOW), null, "el comprobante de otra cuenta no sirve");
  const future = encodeLastKnown(SECRET, OWNER, { ...VALUE, verifiedAt: new Date(NOW.getTime() + 3_600_000).toISOString() })!;
  assert.equal(decodeLastKnown(SECRET, OWNER, future, NOW), null, "un comprobante del futuro es inválido");
  assert.equal(encodeLastKnown("corto", OWNER, VALUE), null, "sin secreto usable no se emite nada");
  assert.equal(encodeLastKnown(undefined, OWNER, VALUE), null);
  assert.equal(encodeLastKnown(SECRET, OWNER, { ...VALUE, verifiedAt: "no" }), null);
});

test("comprobante: un estado fuera del catálogo firmado correctamente igual se rechaza", () => {
  const body = Buffer.from(JSON.stringify({ s: "premium", g: 0, t: Date.parse(hoursAgo(1)), o: "x" }), "utf8").toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`v1.${body}`).digest("base64url");
  assert.equal(decodeLastKnown(SECRET, OWNER, `v1.${body}.${sig}`, NOW), null);
});

// --- Requisitos de activación ------------------------------------------------------------------------------------------------

test("requisitos de activación: lista sólo NOMBRES de variables faltantes, nunca valores", () => {
  const empty = checkBillingReadiness({}, { enabled: true, enforcement: true }, { realProvider: true });
  assert.equal(empty.ready, false);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "MOBBEX_API_KEY", "MOBBEX_ACCESS_TOKEN", "BILLING_GRANDFATHER_CUTOFF", "BILLING_STATE_COOKIE_SECRET"]) assert.ok(empty.missing.some((item) => item.startsWith(name)), name);
  const secret = "valor-secreto-que-no-debe-aparecer-" + "x".repeat(40);
  const partial = checkBillingReadiness({ SUPABASE_SERVICE_ROLE_KEY: secret, CRON_SECRET: "corto" }, { enabled: true, enforcement: false }, { realProvider: false });
  assert.ok(!JSON.stringify(partial).includes(secret));
  assert.ok(partial.missing.some((item) => item.startsWith("CRON_SECRET")), "un CRON_SECRET corto no alcanza");
  assert.ok(!partial.missing.some((item) => item.startsWith("MOBBEX")), "con el adaptador falso no se exigen credenciales de Mobbex");
  const full = checkBillingReadiness({ SUPABASE_SERVICE_ROLE_KEY: "k", CRON_SECRET: "c".repeat(32), BILLING_GRANDFATHER_CUTOFF: CUTOFF, BILLING_STATE_COOKIE_SECRET: "d".repeat(32), BILLING_SUPPORT_EMAIL: "ayuda@ejemplo.test", BILLING_LEGAL_REVIEWED: "true" }, { enabled: true, enforcement: true }, { realProvider: false });
  assert.deepEqual(full, { ready: true, missing: [] });
});
