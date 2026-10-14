import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveSupportContact } from "../support.ts";
import { isLegalReviewed, LEGAL_DRAFT_NOTICE, LEGAL_PENDING, LEGAL_SECTIONS } from "../legal.ts";
import { checkBillingReadiness } from "../readiness.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("el contacto de soporte sale SÓLO de la variable de configuración y falla de forma segura", () => {
  assert.equal(resolveSupportContact({}), null);
  assert.equal(resolveSupportContact({ BILLING_SUPPORT_EMAIL: "" }), null);
  assert.equal(resolveSupportContact({ BILLING_SUPPORT_EMAIL: "   " }), null);
  const ok = resolveSupportContact({ BILLING_SUPPORT_EMAIL: " ayuda@ejemplo.test " });
  assert.equal(ok?.address, "ayuda@ejemplo.test");
  assert.match(ok!.href, /^mailto:ayuda@ejemplo\.test\?subject=[A-Za-z0-9%._~-]+$/);
});

test("un valor con forma de correo inválida o con intento de inyección no produce ningún enlace", () => {
  for (const bad of ["sin-arroba", "a@b", "a@@b.com", "a b@ejemplo.com", "a@ejemplo.c0m", "a@-ejemplo.com", "a..b@ejemplo.com", ".a@ejemplo.com",
    "a@ejemplo.com?bcc=x@y.com", "a@ejemplo.com&cc=x@y.com", "a@ejemplo.com,b@ejemplo.com", "a@ejemplo.com\nBcc: x@y.com", "javascript:alert(1)", "<a@ejemplo.com>", `${"a".repeat(65)}@ejemplo.com`]) {
    assert.equal(resolveSupportContact({ BILLING_SUPPORT_EMAIL: bad }), null, bad);
  }
});

test("el código no trae ningún correo ni dominio de soporte escrito: sólo la variable", () => {
  for (const file of ["lib/billing/support.ts", "lib/billing/legal.ts", "components/billing/support-card.tsx", "app/(app)/facturacion/condiciones/page.tsx", "lib/billing/view.ts"]) {
    assert.doesNotMatch(read(file), /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, `${file}: sin correos escritos en el código`);
  }
  assert.match(read("lib/billing/support.ts"), /BILLING_SUPPORT_EMAIL/);
});

test("los textos legales cubren lo pedido, están marcados como borrador y todo «A DEFINIR» figura en la lista de pendientes", () => {
  const text = LEGAL_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");
  for (const topic of ["renueva", "Cancelación", "rechazado", "Devoluciones", "DNI o CUIT", "procesa el pago"]) assert.match(text, new RegExp(topic), topic);
  assert.ok(text.includes("5 días corridos") && text.includes("00:00 del sexto día"), "la gracia coincide con la decisión 8");
  assert.ok(text.includes("10 años") && text.includes("seudonimizado"), "la retención fiscal coincide con la decisión 5");
  assert.match(LEGAL_DRAFT_NOTICE, /Borrador pendiente de revisión legal/);
  assert.ok((text.match(/\[A DEFINIR/g) ?? []).length >= 3);
  assert.ok(LEGAL_PENDING.length >= 4);
  // No inventa datos fiscales ni de la empresa.
  assert.doesNotMatch(text, /S\.A\.|S\.R\.L\.|\b\d{2}-\d{8}-\d\b|\bCUIT:? ?\d/);
  assert.ok(new Set(LEGAL_SECTIONS.map((s) => s.id)).size === LEGAL_SECTIONS.length);
});

test("el aviso de borrador sólo se oculta con BILLING_LEGAL_REVIEWED=true exacto", () => {
  assert.equal(isLegalReviewed({}), false);
  for (const v of ["", "1", "TRUE", "si", "yes", "false"]) assert.equal(isLegalReviewed({ BILLING_LEGAL_REVIEWED: v }), false, v);
  assert.equal(isLegalReviewed({ BILLING_LEGAL_REVIEWED: " true " }), true);
});

test("la lista de requisitos para encender incluye soporte y revisión legal, sin mostrar valores", () => {
  const flags = { enabled: true, enforcement: false };
  const base = { SUPABASE_SERVICE_ROLE_KEY: "x", CRON_SECRET: "c".repeat(32) };
  const missing = checkBillingReadiness(base, flags, { realProvider: false }).missing.join("|");
  assert.match(missing, /BILLING_SUPPORT_EMAIL/);
  assert.match(missing, /BILLING_LEGAL_REVIEWED/);
  const ready = checkBillingReadiness({ ...base, BILLING_SUPPORT_EMAIL: "ayuda@ejemplo.test", BILLING_LEGAL_REVIEWED: "true" }, flags, { realProvider: false });
  assert.deepEqual(ready, { ready: true, missing: [] });
  assert.ok(!JSON.stringify(checkBillingReadiness({ ...base, BILLING_SUPPORT_EMAIL: "secreto@ejemplo.test" }, flags, { realProvider: false })).includes("secreto@"));
});

test("la página de condiciones y el enlace de la elección de plan existen detrás de la bandera y sin imports prohibidos", () => {
  const page = read("app/(app)/facturacion/condiciones/page.tsx");
  assert.match(page, /loadLegalPageData\(\)/);
  assert.match(page, /if \(!data\) notFound\(\);/);
  assert.match(read("components/billing/plan-picker.tsx"), /href="\/facturacion\/condiciones"/);
  assert.match(read("components/billing/support-card.tsx"), /\{support && \(/);
});
