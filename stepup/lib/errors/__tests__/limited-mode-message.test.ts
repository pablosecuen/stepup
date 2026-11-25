import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BILLING_LIMITED_CODE, LIMITED_MODE_USER_MESSAGE, isLimitedModeMessage } from "../limited-mode-message.ts";
import { LIMITED_MODE_MESSAGE } from "../../billing/write-guard.ts";
import { GENERIC_ERROR_MESSAGE, domainErrorMessage } from "../domain-error-message.ts";

test("el bloqueo del modo limitado se traduce a un mensaje breve y propio (no al genérico)", () => {
  const fromGuard = { code: BILLING_LIMITED_CODE, message: LIMITED_MODE_MESSAGE, details: null, hint: null };
  assert.equal(domainErrorMessage(fromGuard), LIMITED_MODE_USER_MESSAGE);
  // La compuerta de la base (migración 20261125130000) levanta el mismo significado con su propio SQLSTATE: la persona ve el mismo mensaje.
  assert.equal(domainErrorMessage({ code: "TF006", message: "texto de la base", details: null, hint: null }), LIMITED_MODE_USER_MESSAGE);
  assert.notEqual(domainErrorMessage(fromGuard), GENERIC_ERROR_MESSAGE);
  assert.ok(LIMITED_MODE_USER_MESSAGE.length < 140, "breve");
  assert.match(LIMITED_MODE_USER_MESSAGE, /suscripción está pendiente/);
  assert.doesNotMatch(LIMITED_MODE_USER_MESSAGE, /403|TF_|Supabase|RLS|JWT|rpc/i);
});

test("la guarda y la interfaz comparten el mismo texto (una sola fuente)", () => {
  assert.equal(LIMITED_MODE_MESSAGE, LIMITED_MODE_USER_MESSAGE);
  assert.equal(isLimitedModeMessage(LIMITED_MODE_USER_MESSAGE), true);
  assert.equal(isLimitedModeMessage(`  ${LIMITED_MODE_USER_MESSAGE}  `), true);
});

test("los errores técnicos REALES siguen siendo técnicos: nunca se disfrazan de modo limitado", () => {
  assert.equal(domainErrorMessage({ code: "42501", message: "permission denied for table students" }), "No tenés permiso para realizar esta acción.");
  assert.equal(domainErrorMessage({ code: "XX000", message: "internal error" }), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage(new TypeError("Cannot read properties of undefined")), GENERIC_ERROR_MESSAGE);
  assert.equal(domainErrorMessage({ code: "PGRST301", message: "JWT expired" }), GENERIC_ERROR_MESSAGE);
  assert.equal(isLimitedModeMessage(GENERIC_ERROR_MESSAGE), false);
  assert.equal(isLimitedModeMessage("Tu suscripción está pendiente"), false, "sólo el texto exacto activa el acceso al pago");
  assert.equal(isLimitedModeMessage(undefined), false);
});

test("estructura: el aviso de error ofrece Facturación sólo para el mensaje del modo limitado; el aviso del encabezado vigila la recuperación sólo si la cuenta está limitada", () => {
  const notice = readFileSync(new URL("../../../components/ui/notice.tsx", import.meta.url), "utf8");
  assert.match(notice, /const limited = tone === "bad" && isLimitedModeMessage\(children\)/);
  assert.match(notice, /\{limited && <LimitedModeAction \/>\}/);
  const banner = readFileSync(new URL("../../../components/billing/access-banner.tsx", import.meta.url), "utf8");
  assert.match(banner, /\{limited && <AccessRecoveryWatcher \/>\}/);
  const action = readFileSync(new URL("../../../components/billing/limited-mode-action.tsx", import.meta.url), "utf8");
  assert.match(action, /router\.refresh\(\)/);
  assert.doesNotMatch(action, /location\.reload|window\.location/, "actualización suave: nunca recargar la página");
  assert.match(action, /href="\/suscripcion-pendiente"/);
});
