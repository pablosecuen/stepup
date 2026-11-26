import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { resolveSupportContact } from "../support.ts";
import { isLegalReviewed, LEGAL_DRAFT_NOTICE, LEGAL_PENDING, LEGAL_SECTIONS } from "../legal.ts";
import { checkBillingReadiness } from "../readiness.ts";
import { PUBLIC_BUSINESS } from "../../business/public-profile.ts";
import { SUBSCRIPTION_TERMS, ownerIdentificationLine } from "../../business/subscription-terms.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("el contacto de soporte es UNO solo: el del titular público; la variable sólo lo reemplaza si es válida", () => {
  const owner = resolveSupportContact({});
  assert.equal(owner?.address, PUBLIC_BUSINESS.email, "sin variable: el correo del titular (única fuente)");
  for (const blank of ["", "   "]) assert.equal(resolveSupportContact({ BILLING_SUPPORT_EMAIL: blank })?.address, PUBLIC_BUSINESS.email);
  const ok = resolveSupportContact({ BILLING_SUPPORT_EMAIL: " ayuda@ejemplo.test " });
  assert.equal(ok?.address, "ayuda@ejemplo.test");
  assert.match(ok!.href, /^mailto:ayuda@ejemplo\.test\?subject=[A-Za-z0-9%._~-]+$/);
  assert.match(owner!.href, /^mailto:[^?]+\?subject=[A-Za-z0-9%._~-]+$/);
});

test("un valor con forma de correo inválida o con intento de inyección se descarta (vale el del titular): nunca un enlace con parámetros ajenos", () => {
  for (const bad of ["sin-arroba", "a@b", "a@@b.com", "a b@ejemplo.com", "a@ejemplo.c0m", "a@-ejemplo.com", "a..b@ejemplo.com", ".a@ejemplo.com",
    "a@ejemplo.com?bcc=x@y.com", "a@ejemplo.com&cc=x@y.com", "a@ejemplo.com,b@ejemplo.com", "a@ejemplo.com\nBcc: x@y.com", "javascript:alert(1)", "<a@ejemplo.com>", `${"a".repeat(65)}@ejemplo.com`]) {
    const contact = resolveSupportContact({ BILLING_SUPPORT_EMAIL: bad });
    assert.equal(contact?.address, PUBLIC_BUSINESS.email, bad);
    assert.doesNotMatch(contact!.href, /bcc|cc=/i, bad);
  }
});

test("el correo está escrito en UN solo archivo (public-profile.ts): ni la facturación ni sus textos traen uno propio", () => {
  for (const file of ["lib/billing/support.ts", "lib/billing/legal.ts", "lib/business/subscription-terms.ts", "components/billing/support-card.tsx", "app/(app)/facturacion/condiciones/page.tsx", "lib/billing/view.ts"]) {
    assert.doesNotMatch(read(file), /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, `${file}: sin correos escritos en el código`);
  }
  assert.match(read("lib/billing/support.ts"), /PUBLIC_BUSINESS/);
  assert.match(read("lib/billing/support.ts"), /BILLING_SUPPORT_EMAIL/);
});

test("los datos del titular de las condiciones de Facturación son los mismos de las páginas públicas (sin marcadores «A DEFINIR» ni contradicciones)", () => {
  const text = LEGAL_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");
  for (const value of [PUBLIC_BUSINESS.name, PUBLIC_BUSINESS.cuit, PUBLIC_BUSINESS.address, PUBLIC_BUSINESS.email]) assert.ok(text.includes(value), `falta «${value}»`);
  assert.equal(ownerIdentificationLine().includes(PUBLIC_BUSINESS.cuit), true);
  assert.doesNotMatch(text, /A DEFINIR/);
  assert.doesNotMatch(LEGAL_DRAFT_NOTICE, /A DEFINIR/);
  // Lo que se repite en los Términos públicos sale de la MISMA fuente.
  const terms = read("app/(public-info)/terminos-y-condiciones/page.tsx");
  assert.match(terms, /SUBSCRIPTION_TERMS\.requests/);
  assert.match(terms, /SUBSCRIPTION_TERMS\.priceChange/);
  assert.ok(text.includes(SUBSCRIPTION_TERMS.requests) && text.includes(SUBSCRIPTION_TERMS.priceChange));
  assert.doesNotMatch(terms, /Podés solicitar la baja, el arrepentimiento/, "los Términos ya no repiten el texto escrito a mano");
});

test("los textos legales cubren lo pedido, están marcados como borrador y no inventan condiciones comerciales ni prometen devoluciones", () => {
  const text = LEGAL_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join("\n");
  for (const topic of ["renueva", "Cancelación", "rechazado", "Devoluciones", "datos personales y de pago", "procesa el pago"]) assert.match(text, new RegExp(topic), topic);
  assert.ok(text.includes("15 días gratis") && text.includes("00:00 (hora de Argentina)") && text.includes("puede demorar unos minutos") && text.includes("tarjeta es obligatoria"), "la prueba gratuita coincide con la condición aprobada");
  assert.doesNotMatch(text, /5 días corridos|sexto día|gracia|modo limitado/i, "ya no hay días de gracia ni modo de sólo lectura");
  assert.match(text, /no se pueden ver ni modificar/, "sin un pago aprobado el acceso queda en pausa (no es de sólo lectura)");
  assert.doesNotMatch(text, /360 horas/, "no se promete una cantidad de horas");
  assert.ok(text.includes("10 años") && text.includes("seudonimizado"), "la retención fiscal coincide con la decisión 5");
  assert.match(LEGAL_DRAFT_NOTICE, /Borrador pendiente de revisión legal/);
  assert.match(text, /No hay devoluciones automáticas/);
  assert.doesNotMatch(text, /garantiz|reembols|te devolvemos|devolveremos|dentro de los? \d+ días|\b\d+ días (hábiles|corridos) para (solicitar|pedir) (una )?devoluci/i, "ningún plazo ni promesa de devolución inventados");
  assert.doesNotMatch(text, /S\.A\.|S\.R\.L\./);
  assert.ok(LEGAL_PENDING.length >= 4 && LEGAL_PENDING.some((item) => /devoluciones/.test(item)) && LEGAL_PENDING.some((item) => /legal/.test(item)));
  assert.ok(new Set(LEGAL_SECTIONS.map((s) => s.id)).size === LEGAL_SECTIONS.length);
});

test("el aviso de borrador sólo se oculta con BILLING_LEGAL_REVIEWED=true exacto (y el repositorio no lo trae encendido)", () => {
  assert.equal(isLegalReviewed({}), false);
  for (const v of ["", "1", "TRUE", "si", "yes", "false"]) assert.equal(isLegalReviewed({ BILLING_LEGAL_REVIEWED: v }), false, v);
  assert.equal(isLegalReviewed({ BILLING_LEGAL_REVIEWED: " true " }), true);
  for (const file of [".env.example", "vercel.json", "lib/billing/legal.ts", "lib/billing/page-data.ts"]) assert.doesNotMatch(read(file), /BILLING_LEGAL_REVIEWED\s*=\s*true/i, file);
});

test("la lista de requisitos para encender incluye la revisión legal y ya no pide un correo aparte, sin mostrar valores", () => {
  const flags = { enabled: true, enforcement: false };
  const base = { SUPABASE_SERVICE_ROLE_KEY: "x", CRON_SECRET: "c".repeat(32) };
  const missing = checkBillingReadiness(base, flags, { realProvider: false }).missing.join("|");
  assert.doesNotMatch(missing, /BILLING_SUPPORT_EMAIL|soporte/i, "el correo de soporte ya sale del titular público");
  assert.match(missing, /BILLING_LEGAL_REVIEWED/);
  const ready = checkBillingReadiness({ ...base, BILLING_LEGAL_REVIEWED: "true" }, flags, { realProvider: false });
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
