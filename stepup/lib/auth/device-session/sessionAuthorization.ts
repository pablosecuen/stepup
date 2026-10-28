// Copia IDÉNTICA de `src/features/account/utils/sessionAuthorization.ts` de la aplicación original (motor puro de «un solo dispositivo activo»). No se edita: las pruebas originales corren contra esta copia.
/**
 * Motor puro de decisión de sesión única (Fase 5B.1) — nunca toca la red,
 * SecureStore ni ningún reloj real salvo el que se le pasa explícitamente.
 * Es el corazón de "sólo un dispositivo activo a la vez": decide, a partir
 * de lo que este dispositivo recuerda y lo que dice el servidor ahora
 * mismo, si sigue autorizado o si otro dispositivo tomó la sesión.
 */

export interface ActiveSessionRow {
  userId: string;
  deviceId: string;
  generation: number;
  authorizedAt: string; // ISO
  expiresAt: string; // ISO
  lastSeenAt: string; // ISO
}

export type SessionAuthorizationStatus =
  | 'authorized'
  | 'locked_elsewhere'
  | 'no_active_session'
  | 'expired';

export interface SessionAuthorizationResult {
  status: SessionAuthorizationStatus;
  serverRow: ActiveSessionRow | null;
}

/**
 * Compara lo que ESTE dispositivo recuerda (su propio id + la generación
 * que recibió la última vez que se autorizó) contra la fila actual del
 * servidor. Usada tanto por la detección en tiempo real como por la
 * revalidación al volver del segundo plano — siempre el mismo criterio.
 *
 *  - Sin fila en el servidor: nadie está autorizado todavía (`no_active_session`).
 *  - Fila de OTRO dispositivo: este quedó afuera (`locked_elsewhere`).
 *  - Fila de este dispositivo pero con una generación distinta a la que
 *    recordamos (incluida "nunca la guardamos"): se trata igual como
 *    `locked_elsewhere` — no se puede confirmar que ESTA instancia de la
 *    app fue la que autorizó la generación vigente.
 *  - Fila de este dispositivo, generación coincide, pero ya venció:
 *    `expired`.
 *  - Todo coincide y no venció: `authorized`.
 */
export function evaluateSessionAuthorization(input: {
  localDeviceId: string;
  localGeneration: number | null;
  serverRow: ActiveSessionRow | null;
  now: Date;
}): SessionAuthorizationResult {
  const { localDeviceId, localGeneration, serverRow, now } = input;

  if (!serverRow) {
    return { status: 'no_active_session', serverRow: null };
  }
  if (serverRow.deviceId !== localDeviceId) {
    return { status: 'locked_elsewhere', serverRow };
  }
  if (localGeneration === null || serverRow.generation !== localGeneration) {
    return { status: 'locked_elsewhere', serverRow };
  }
  if (new Date(serverRow.expiresAt).getTime() <= now.getTime()) {
    return { status: 'expired', serverRow };
  }
  return { status: 'authorized', serverRow };
}

/**
 * true si iniciar sesión en este dispositivo va a desconectar a OTRO
 * dispositivo ya activo — en ese caso hay que pedir confirmación explícita
 * ("Usar TeacherFlow en este dispositivo") antes de transferir, nunca
 * transferir en silencio.
 */
export function needsTransferConfirmation(input: {
  localDeviceId: string;
  serverRow: ActiveSessionRow | null;
}): boolean {
  return input.serverRow !== null && input.serverRow.deviceId !== input.localDeviceId;
}

/**
 * Corrección obligatoria — funcionamiento offline: nunca se permite usar la
 * app sin conexión "para siempre" sólo porque una vez se autorizó. Cada vez
 * que el dispositivo confirma su autorización CONTRA EL SERVIDOR, se guarda
 * localmente una copia mínima (dispositivo + generación + vencimiento),
 * recortada a un máximo de 24 horas desde ese momento — nunca los 90 días
 * (ahora 24 horas) que puede tener `expires_at` en el servidor. Pasado ese
 * límite offline, hace falta volver a conectarse para seguir usando la app:
 * ningún sistema puede detectar de otra forma que otro dispositivo tomó la
 * sesión mientras este permanece totalmente desconectado.
 */
export const OFFLINE_AUTHORIZATION_MAX_MS = 24 * 60 * 60 * 1000;

export interface CachedAuthorization {
  deviceId: string;
  generation: number;
  /** Recortado a `now + 24h` como máximo en el momento en que se guardó — ver `computeCachedAuthorizationExpiry`. */
  expiresAt: string; // ISO
}

/** Nunca guarda un vencimiento offline más allá de 24 horas desde `now`, aunque el servidor permita más. */
export function computeCachedAuthorizationExpiry(now: Date, serverExpiresAt: string): string {
  const maxOfflineExpiry = new Date(now.getTime() + OFFLINE_AUTHORIZATION_MAX_MS);
  const serverExpiry = new Date(serverExpiresAt);
  return (serverExpiry.getTime() < maxOfflineExpiry.getTime() ? serverExpiry : maxOfflineExpiry).toISOString();
}

/**
 * Evalúa autorización SIN red, usando sólo lo que este dispositivo guardó
 * la última vez que se confirmó contra el servidor. Nunca devuelve
 * `locked_elsewhere` como "detección" real de otro dispositivo — offline no
 * hay forma de saber eso; sólo se usa cuando el propio caché local ya no
 * corresponde a este dispositivo (corrupción/reset), un caso defensivo.
 */
export function evaluateOfflineAuthorization(input: {
  localDeviceId: string;
  cached: CachedAuthorization | null;
  now: Date;
}): SessionAuthorizationResult {
  const { localDeviceId, cached, now } = input;
  if (!cached) {
    return { status: 'no_active_session', serverRow: null };
  }
  if (cached.deviceId !== localDeviceId) {
    return { status: 'locked_elsewhere', serverRow: null };
  }
  if (new Date(cached.expiresAt).getTime() <= now.getTime()) {
    return { status: 'expired', serverRow: null };
  }
  return { status: 'authorized', serverRow: null };
}
