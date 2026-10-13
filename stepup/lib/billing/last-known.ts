import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { LastKnownAccess } from "./access.ts";
import { BILLING_STATUSES, type BillingStatus } from "./state-machine.ts";

/**
 * «Última verificación conocida» — comprobante FIRMADO por el servidor. Existe para una sola situación: la base de datos propia
 * no responde y hay que decidir si una cuenta que estaba activa conserva el acceso durante la tolerancia acotada
 * (`OWN_FAILURE_TOLERANCE_MS`). El navegador sólo lo transporta (cookie `HttpOnly`): no puede fabricarlo ni alargarlo, porque
 * está firmado con un secreto del servidor, atado a la cuenta y con la fecha de verificación DENTRO de la firma.
 *
 * Formato: `v1.<json base64url>.<hmac sha256 base64url>`. El contenido sólo tiene el estado, si era `grandfathered`, el instante
 * y una huella corta de la cuenta: ningún dato personal. Sin secreto configurado (o más corto que 32 caracteres) no se emite ni se
 * acepta nada: la tolerancia simplemente no existe.
 */
const VERSION = "v1";
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;
const FUTURE_SKEW_MS = 5 * 60_000;

function usableSecret(secret: string | undefined | null): secret is string {
  return typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH;
}

function ownerTag(ownerId: string): string {
  return createHash("sha256").update(`tf-billing-owner:${ownerId}`).digest("base64url").slice(0, 16);
}

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`${VERSION}.${body}`).digest("base64url");
}

export function encodeLastKnown(secret: string | undefined | null, ownerId: string, value: LastKnownAccess): string | null {
  if (!usableSecret(secret)) return null;
  const verified = Date.parse(value.verifiedAt);
  if (!Number.isFinite(verified)) return null;
  const body = Buffer.from(JSON.stringify({ s: value.status, g: value.grandfathered ? 1 : 0, t: verified, o: ownerTag(ownerId) }), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(secret, body)}`;
}

export function decodeLastKnown(secret: string | undefined | null, ownerId: string, token: string | undefined | null, now: Date): LastKnownAccess | null {
  if (!usableSecret(secret) || typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, signature] = parts;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { s, g, t, o } = parsed as Record<string, unknown>;
    if (typeof s !== "string" || !(BILLING_STATUSES as readonly string[]).includes(s)) return null;
    if (g !== 0 && g !== 1) return null;
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    if (o !== ownerTag(ownerId)) return null; // atado a la cuenta: el comprobante de otra persona no sirve
    if (Number.isFinite(now.getTime()) && t > now.getTime() + FUTURE_SKEW_MS) return null; // un comprobante «del futuro» es inválido
    return { status: s as BillingStatus, grandfathered: g === 1, verifiedAt: new Date(t).toISOString() };
  } catch {
    return null;
  }
}
