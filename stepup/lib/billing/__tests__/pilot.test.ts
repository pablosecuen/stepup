import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PILOT_VARIABLE, isBillingOpenFor, isBillingPublic, readPilotOwnerIds } from "../pilot.ts";

const QA = "efd0cd49-eca0-41c1-971d-b9b20e343891";
const OTHER = "8f71605e-3302-4d81-9bd3-87ebf3b22925";

test("sin piloto: se comporta como siempre (BILLING_ENABLED decide, para todas las cuentas)", () => {
  assert.equal(readPilotOwnerIds({}), null);
  assert.equal(isBillingOpenFor(QA, { BILLING_ENABLED: "true" }), true);
  assert.equal(isBillingOpenFor(OTHER, { BILLING_ENABLED: "true" }), true);
  assert.equal(isBillingOpenFor(null, { BILLING_ENABLED: "true" }), true, "sin piloto no hace falta identificar la cuenta");
  assert.equal(isBillingPublic({ BILLING_ENABLED: "true" }), true);
  assert.equal(isBillingOpenFor(QA, {}), false, "facturación apagada: nadie");
  assert.equal(isBillingPublic({}), false);
});

test("con piloto: sólo las cuentas listadas; el resto como con la facturación apagada y la página pública NO ofrece contratar", () => {
  const env = { BILLING_ENABLED: "true", [PILOT_VARIABLE]: QA };
  assert.equal(isBillingOpenFor(QA, env), true);
  assert.equal(isBillingOpenFor(QA.toUpperCase(), env), true, "no distingue mayúsculas");
  assert.equal(isBillingOpenFor(OTHER, env), false);
  assert.equal(isBillingOpenFor(null, env), false);
  assert.equal(isBillingOpenFor(undefined, env), false);
  assert.equal(isBillingPublic(env), false);
  assert.equal(isBillingOpenFor(QA, { [PILOT_VARIABLE]: QA }), false, "el piloto no enciende la facturación por sí solo");
});

test("varias cuentas separadas por coma, con espacios", () => {
  const env = { BILLING_ENABLED: "true", [PILOT_VARIABLE]: ` ${QA} , ${OTHER} ` };
  assert.equal(isBillingOpenFor(QA, env), true);
  assert.equal(isBillingOpenFor(OTHER, env), true);
  assert.equal(isBillingOpenFor("11111111-1111-1111-1111-111111111111", env), false);
});

test("falla cerrado: variable definida pero vacía o mal escrita no habilita a nadie ni abre al público", () => {
  for (const raw of ["", "   ", "todos", "*", "true", "efd0cd49", `${QA}x`, ","]) {
    const env = { BILLING_ENABLED: "true", [PILOT_VARIABLE]: raw };
    assert.equal(isBillingOpenFor(QA, env), false, `«${raw}» no debe habilitar`);
    assert.equal(isBillingOpenFor(OTHER, env), false);
    assert.equal(isBillingPublic(env), false, `«${raw}» no debe abrir al público`);
  }
});

test("cableado: el piloto manda en la barra, Configuración, Facturación y las acciones; la página pública de planes no ofrece contratar; webhook y crons NO lo consultan", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(read("app/(app)/layout.tsx"), /billingEnabled=\{billingAccess\?\.level === "blocked" \|\| isBillingOpenFor\(user\?\.id \?\? null, process\.env\)\}/, "una cuenta bloqueada siempre ve su facturación; el resto sigue el piloto");
  assert.match(read("app/(app)/configuracion/page.tsx"), /billingEnabled=\{isBillingOpenFor\(ctx\.ownerId, process\.env\)\}/);
  assert.match(read("app/(public-info)/planes/page.tsx"), /contractingOpen=\{isBillingPublic\(process\.env\)\}/);
  const data = read("lib/billing/page-data.ts");
  assert.match(data, /if \(readPilotOwnerIds\(process\.env\) !== null\) \{[\s\S]*?if \(!isBillingOpenFor\(ownerId, process\.env\)\) return null;[\s\S]*?\} catch \{\s*return null;/, "sin sesión o fuera de la lista: pantalla inexistente");
  assert.match(read("lib/actions/billing.ts"), /if \(!isBillingOpenFor\(ctx\.ownerId, process\.env\)\) return UNAVAILABLE;\n  if \(!actionLimiter/, "antes de cualquier acción de facturación");
  for (const file of ["app/api/billing/webhooks/rebill/route.ts", "app/api/billing/cron/process/route.ts", "app/api/billing/cron/reconcile/route.ts", "lib/billing/webhook-ingest.ts"]) {
    assert.doesNotMatch(read(file), /pilot/i, `${file}: los cobros ya hechos siempre se procesan`);
  }
});
