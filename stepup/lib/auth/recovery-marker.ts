import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Marcador de "recuperación en curso". `/nueva-contrasena` no puede depender
 * sólo de "hay una sesión": en un dispositivo con una sesión vieja (otra
 * cuenta, o la misma abierta hace días) cualquiera que visite la URL vería el
 * formulario y cambiaría la contraseña de ESA cuenta. Después de verificar un
 * enlace/código de recuperación el servidor deja esta cookie (httpOnly, corta,
 * atada al id de usuario de la sesión recién creada); `/nueva-contrasena` y la
 * acción que guarda la contraseña la exigen.
 *
 * R4 (hallazgo L-06): el marcador va FIRMADO (HMAC-SHA256 con un secreto que sólo
 * existe en el servidor). Antes era `<id>.<hora>`, y quien tuviera una sesión robada
 * (el id de usuario se lee del propio token) podía fabricarlo a mano y cambiar la
 * contraseña sin pasar por el correo. Ahora fabricarlo exige el secreto del servidor,
 * o sea haber verificado de verdad un enlace/código de recuperación en este navegador.
 *
 * Formato: `v1.<id de usuario>.<hora de emisión en ms>.<firma base64url>`. La firma
 * cubre versión, usuario y hora. Se acepta el secreto vigente y, mientras dura una
 * rotación, el anterior. Sin secreto configurado (Production) nada se firma ni se
 * valida: falla cerrado (ver recovery-secret.ts). Puro (sólo `node:crypto`), sin Next
 * ni Supabase, para probarlo sin red.
 */
export const RECOVERY_MARKER_COOKIE = "tf_pwd_recovery";
export const RECOVERY_MARKER_MAX_AGE_SECONDS = 15 * 60;

const MARKER_SHAPE = /^v1\.([0-9a-fA-F-]{8,64})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/;

/** Secreto vigente y, durante una rotación, el anterior (sólo para VALIDAR; siempre se firma con el vigente). */
export interface RecoverySecrets {
  current: string;
  previous?: string;
}

/** No hay un secreto de firma utilizable: no se puede emitir ni validar un marcador. */
export class RecoveryMarkerUnavailableError extends Error {
  constructor() {
    super("recovery_marker_unavailable");
    this.name = "RecoveryMarkerUnavailableError";
  }
}

function sign(secret: string, userId: string, issuedAt: number): string {
  return createHmac("sha256", secret).update(`tf-recovery-marker|v1|${userId}|${issuedAt}`).digest("base64url");
}

export function createRecoveryMarker(userId: string, nowMs: number, secrets: RecoverySecrets | null): string {
  if (!secrets) throw new RecoveryMarkerUnavailableError();
  const issuedAt = Math.trunc(nowMs);
  return `v1.${userId}.${issuedAt}.${sign(secrets.current, userId, issuedAt)}`;
}

function sameSignature(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** true sólo si el marcador está firmado con nuestro secreto, es de ESTE usuario, no está vencido y no viene del futuro. */
export function isValidRecoveryMarker(raw: string | null | undefined, userId: string, nowMs: number, secrets: RecoverySecrets | null): boolean {
  if (!raw || !userId || !secrets) return false;
  const match = MARKER_SHAPE.exec(raw);
  if (!match) return false;

  const [, markerUserId, issuedAtText, signature] = match;
  if (markerUserId !== userId) return false;

  const issuedAt = Number(issuedAtText);
  if (!Number.isSafeInteger(issuedAt)) return false;

  // Primero la firma (se comparan todos los secretos, sin cortocircuito), después la vigencia.
  const candidates = secrets.previous ? [secrets.current, secrets.previous] : [secrets.current];
  let signed = false;
  for (const secret of candidates) {
    if (sameSignature(sign(secret, markerUserId, issuedAt), signature)) signed = true;
  }
  if (!signed) return false;

  const ageMs = nowMs - issuedAt;
  if (ageMs < -60_000) return false; // desfase de reloj tolerado: 1 minuto
  return ageMs <= RECOVERY_MARKER_MAX_AGE_SECONDS * 1000;
}
