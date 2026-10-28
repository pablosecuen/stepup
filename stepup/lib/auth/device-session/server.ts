import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActiveSessionRow as ActiveSessionDbRow } from "@/lib/db/database.types";
import type { ActiveSessionRow } from "./sessionAuthorization";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_SECONDS, generateDeviceId, isDeviceSessionEnforced, parseDeviceCookie, resolveDeviceAccess, serializeDeviceCookie, type DeviceAccessState } from "./decision";

function mapRow(row: ActiveSessionDbRow): ActiveSessionRow {
  return { userId: row.user_id, deviceId: row.device_id, generation: Number(row.generation), authorizedAt: row.authorized_at, expiresAt: row.expires_at, lastSeenAt: row.last_seen_at };
}

/**
 * Estado de acceso de ESTE navegador, una sola vez por solicitud (como `getRenderUser`): compara la cookie del dispositivo con la fila de `active_sessions` de la cuenta.
 * Sólo lee. Un fallo de lectura (red, base) NUNCA se interpreta como «autorizado» ni como «cerrado»: se propaga para que quien llama decida.
 */
export const readDeviceAccess = cache(async (userId: string): Promise<DeviceAccessState> => {
  if (!isDeviceSessionEnforced()) return { kind: "authorized" };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "authorized" };
  const cookieValue = (await cookies()).get(DEVICE_COOKIE)?.value;
  const { data, error } = await supabase.from("active_sessions").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return resolveDeviceAccess({ cookieValue, serverRow: data ? mapRow(data as ActiveSessionDbRow) : null, now: new Date() });
});

export class DeviceNotAuthorizedError extends Error {
  constructor(readonly access: DeviceAccessState) {
    super("Esta cuenta está autorizada en otro dispositivo.");
    this.name = "DeviceNotAuthorizedError";
  }
}

/** Autoriza ESTE navegador (cierra la sesión del que estaba activo). Es el único lugar que escribe la cookie del dispositivo; sólo se llama desde una Server Action (POST). */
export async function claimThisDevice(): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false };
  const store = await cookies();
  const deviceId = parseDeviceCookie(store.get(DEVICE_COOKIE)?.value)?.deviceId ?? generateDeviceId();
  const { data, error } = await supabase.rpc("transfer_active_session", { p_device_id: deviceId });
  if (error) return { ok: false };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false };
  store.set(DEVICE_COOKIE, serializeDeviceCookie({ deviceId, generation: Number(row.generation) }), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

/** Renueva el vencimiento de ESTE dispositivo si sigue siendo el activo y devuelve su estado actual (para el aviso en pantalla mientras está abierta). */
export async function touchThisDevice(userId: string): Promise<DeviceAccessState> {
  if (!isDeviceSessionEnforced()) return { kind: "authorized" };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { kind: "authorized" };
  const local = parseDeviceCookie((await cookies()).get(DEVICE_COOKIE)?.value);
  if (local) {
    const { error } = await supabase.rpc("touch_active_session", { p_device_id: local.deviceId });
    if (error) throw error;
  }
  const { data, error } = await supabase.from("active_sessions").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return resolveDeviceAccess({ cookieValue: (await cookies()).get(DEVICE_COOKIE)?.value, serverRow: data ? mapRow(data as ActiveSessionDbRow) : null, now: new Date() });
}

/** Al cerrar sesión libera el lugar del dispositivo (sólo si sigue siendo el vigente: `end_active_session` exige dispositivo y generación) y borra la cookie. Nunca impide cerrar sesión. */
export async function releaseThisDevice(): Promise<void> {
  try {
    const store = await cookies();
    const local = parseDeviceCookie(store.get(DEVICE_COOKIE)?.value);
    if (local) {
      const supabase = await createSupabaseServerClient();
      if (supabase) await supabase.rpc("end_active_session", { p_device_id: local.deviceId, p_generation: local.generation });
    }
    store.delete(DEVICE_COOKIE);
  } catch {
    // Cerrar sesión nunca depende de esto.
  }
}
