import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE_SECONDS, generateDeviceId, isDeviceSessionEnforced, parseDeviceCookie, resolveWebDeviceAccess, serializeDeviceCookie, type DeviceAccessState, type WebDeviceRow } from "./decision";

/** Read only; never claims a slot or alters the native app's backup lease. */
export const listWebDevices = cache(async (userId: string): Promise<WebDeviceRow[]> => {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("No pudimos comprobar los dispositivos.");
  const { data, error } = await supabase.from("web_device_sessions").select("device_id,generation,label,last_seen_at,expires_at,revoked_at").eq("user_id",userId);
  if (error) throw error;
  return (data ?? []) as WebDeviceRow[];
});

export const readDeviceAccess = cache(async (userId: string): Promise<DeviceAccessState> => {
  if (!isDeviceSessionEnforced()) return { kind: "authorized" };
  return resolveWebDeviceAccess((await cookies()).get(DEVICE_COOKIE)?.value, await listWebDevices(userId), new Date());
});

export async function listActiveWebDevices(userId: string): Promise<WebDeviceRow[]> {
  const rows = await listWebDevices(userId);
  const now = Date.now();
  return rows.filter(row => !row.revoked_at && new Date(row.expires_at).getTime() > now);
}

export class DeviceNotAuthorizedError extends Error {
  constructor(readonly access: DeviceAccessState) {
    super("Este dispositivo no tiene una sesión autorizada.");
    this.name = "DeviceNotAuthorizedError";
  }
}

/** Called only by POST. Two slots, with explicit, versioned replacement of a third. */
export async function claimThisDevice(replacement?: { deviceId: string; generation: number }): Promise<{ ok: true } | { ok: false; reason?: string }> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false };
  const store = await cookies();
  const local = parseDeviceCookie(store.get(DEVICE_COOKIE)?.value);
  const deviceId = local?.deviceId ?? generateDeviceId();
  const agent = (await headers()).get("user-agent") ?? "";
  const platform = /iPhone|iPad/.test(agent) ? "iPhone / iPad" : /Android/.test(agent) ? "Android" : /Macintosh/.test(agent) ? "Mac" : /Windows/.test(agent) ? "Windows" : "Navegador";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "Web";
  const { data, error } = await supabase.rpc("claim_web_device", { p_device_id: deviceId, p_generation: local?.generation ?? null, p_replace_device_id: replacement?.deviceId ?? null, p_replace_generation: replacement?.generation ?? null, p_label: `${platform} · ${browser}` });
  if (error || data?.status !== "authorized") return { ok: false, reason: data?.status === "full" || data?.status === "changed" ? "Los dispositivos cambiaron. Actualizá esta página y elegí cuál reemplazar." : undefined };
  store.set(DEVICE_COOKIE, serializeDeviceCookie({ deviceId, generation: Number(data.generation) }), {
    path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

export async function touchThisDevice(userId: string): Promise<DeviceAccessState> {
  if (!isDeviceSessionEnforced()) return { kind: "authorized" };
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("No pudimos comprobar los dispositivos.");
  const cookieValue = (await cookies()).get(DEVICE_COOKIE)?.value;
  const local = parseDeviceCookie(cookieValue);
  if (local) {
    const { error } = await supabase.rpc("touch_web_device", { p_device_id: local.deviceId, p_generation: local.generation });
    if (error) throw error;
  }
  const { data, error } = await supabase.from("web_device_sessions").select("device_id,generation,label,last_seen_at,expires_at,revoked_at").eq("user_id",userId);
  if (error) throw error;
  return resolveWebDeviceAccess(cookieValue,(data ?? []) as WebDeviceRow[],new Date());
}

/** A local logout releases only this browser's slot, even after replacement. */
export async function releaseThisDevice(): Promise<void> {
  try {
    const store = await cookies();
    const local = parseDeviceCookie(store.get(DEVICE_COOKIE)?.value);
    if (local) {
      const supabase = await createSupabaseServerClient();
      if (supabase) await supabase.rpc("end_web_device", { p_device_id: local.deviceId, p_generation: local.generation });
    }
    store.delete(DEVICE_COOKIE);
  } catch {
    // Logout must remain available if the network fails.
  }
}
