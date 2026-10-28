import { evaluateSessionAuthorization, needsTransferConfirmation, type ActiveSessionRow } from "./sessionAuthorization.ts";

/**
 * «Un solo dispositivo activo a la vez» en la web. Un «dispositivo» es un navegador: lleva una cookie propia (`tf_device`) con un identificador al azar y la generación que recibió la última
 * vez que se autorizó. Es la contraparte de lo que la app original guarda en su almacenamiento seguro; el servidor (`active_sessions`, una fila por cuenta) decide quién está autorizado.
 */
export const DEVICE_COOKIE = "tf_device";
/** Un año: el dispositivo se reconoce hasta que otro lo reemplace o se cierre la sesión; la validez real la decide el vencimiento del servidor (24 h sin actividad). */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** `DEVICE_SESSION_ENFORCEMENT=off` desactiva el control (interruptor de emergencia de despliegue, no una opción de la profesora). Por defecto está activo. */
export function isDeviceSessionEnforced(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEVICE_SESSION_ENFORCEMENT !== "off";
}

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{8,200}$/;

export interface LocalDevice {
  deviceId: string;
  generation: number;
}

/** Valor de la cookie: `<deviceId>.<generación>`. Cualquier otra cosa se descarta (nunca se confía en una cookie mal formada). */
export function serializeDeviceCookie(device: LocalDevice): string {
  return `${device.deviceId}.${device.generation}`;
}

export function parseDeviceCookie(value: string | undefined | null): LocalDevice | null {
  if (!value) return null;
  const cut = value.lastIndexOf(".");
  if (cut <= 0) return null;
  const deviceId = value.slice(0, cut);
  const generation = Number(value.slice(cut + 1));
  if (!DEVICE_ID_PATTERN.test(deviceId) || !Number.isInteger(generation) || generation < 1) return null;
  return { deviceId, generation };
}

export function generateDeviceId(random: () => string = () => crypto.randomUUID()): string {
  return `web-${random()}`;
}

export type DeviceAccessState =
  /** Este navegador es el dispositivo activo: se puede usar la cuenta. */
  | { kind: "authorized" }
  /** Nadie tiene la cuenta autorizada (o la de este navegador venció o no existe): se autoriza este navegador sin preguntar. */
  | { kind: "claim" }
  /** Otro dispositivo tiene la cuenta y este navegador nunca la autorizó: hay que pedir confirmación explícita antes de cerrar la otra sesión. */
  | { kind: "confirm-transfer" }
  /** Este navegador estaba autorizado y otro dispositivo tomó la cuenta: se cerró la sesión de este («Tu cuenta se abrió en otro dispositivo»). */
  | { kind: "taken-elsewhere" };

export function resolveDeviceAccess(input: { cookieValue: string | undefined | null; serverRow: ActiveSessionRow | null; now: Date }): DeviceAccessState {
  const local = parseDeviceCookie(input.cookieValue);
  if (!local) {
    // Sin identificador propio este navegador no puede ser el activo: si hay otro dispositivo, confirmar; si no, autorizar.
    return needsTransferConfirmation({ localDeviceId: "", serverRow: input.serverRow }) ? { kind: "confirm-transfer" } : { kind: "claim" };
  }
  const result = evaluateSessionAuthorization({ localDeviceId: local.deviceId, localGeneration: local.generation, serverRow: input.serverRow, now: input.now });
  switch (result.status) {
    case "authorized":
      return { kind: "authorized" };
    case "locked_elsewhere":
      return { kind: "taken-elsewhere" };
    case "no_active_session":
    case "expired":
      return { kind: "claim" };
  }
}
