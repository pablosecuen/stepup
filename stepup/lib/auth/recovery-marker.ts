/**
 * Marcador de "recuperación en curso". `/nueva-contrasena` no puede depender
 * sólo de "hay una sesión": en un dispositivo con una sesión vieja (otra
 * cuenta, o la misma abierta hace días) cualquiera que visite la URL vería el
 * formulario y cambiaría la contraseña de ESA cuenta por accidente. Después de
 * verificar un enlace/código de recuperación el servidor deja esta cookie
 * (httpOnly, corta, atada al id de usuario de la sesión recién creada);
 * `/nueva-contrasena` y la acción que guarda la contraseña la exigen.
 *
 * No es un límite de seguridad (la autenticación real es la sesión de
 * Supabase): evita el cambio accidental y el "caigo en Inicio con una sesión
 * que ya existía". Puro, sin Next ni Supabase, para probarlo sin red.
 */
export const RECOVERY_MARKER_COOKIE = "tf_pwd_recovery";
export const RECOVERY_MARKER_MAX_AGE_SECONDS = 15 * 60;

const MARKER_SHAPE = /^([0-9a-fA-F-]{8,64})\.(\d{10,16})$/;

export function createRecoveryMarker(userId: string, nowMs: number): string {
  return `${userId}.${Math.trunc(nowMs)}`;
}

/** true sólo si el marcador es de ESTE usuario, no está vencido y no viene del futuro. */
export function isValidRecoveryMarker(raw: string | null | undefined, userId: string, nowMs: number): boolean {
  if (!raw || !userId) return false;
  const match = MARKER_SHAPE.exec(raw);
  if (!match) return false;

  const [, markerUserId, issuedAtText] = match;
  if (markerUserId !== userId) return false;

  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt)) return false;
  const ageMs = nowMs - issuedAt;
  if (ageMs < -60_000) return false; // desfase de reloj tolerado: 1 minuto
  return ageMs <= RECOVERY_MARKER_MAX_AGE_SECONDS * 1000;
}
