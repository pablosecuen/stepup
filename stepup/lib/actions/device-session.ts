"use server";

import { redirect } from "next/navigation";
import { getRenderUser } from "@/lib/auth/render-user";
import { sanitizeNextPath, DEFAULT_AUTH_REDIRECT } from "@/lib/auth/safe-redirect";
import { claimThisDevice, touchThisDevice } from "@/lib/auth/device-session/server";
import type { DeviceAccessState } from "@/lib/auth/device-session/decision";

// Server Actions — «un solo dispositivo activo». Nunca reciben el identificador del dispositivo ni la cuenta del navegador: salen de la cookie propia y de la sesión.

export interface ClaimDeviceState {
  error?: string;
}

/** «Usar TeacherFlow en este dispositivo»: autoriza este navegador (la sesión del que estaba activo se cierra de inmediato) y vuelve a la pantalla pedida. */
export async function claimDeviceAction(next: string, _prev: ClaimDeviceState): Promise<ClaimDeviceState> {
  const user = await getRenderUser();
  if (!user) redirect("/login");
  const claimed = await claimThisDevice();
  if (!claimed.ok) return { error: "No pudimos autorizar este dispositivo. Revisá tu conexión e intentá de nuevo." };
  redirect(sanitizeNextPath(next, DEFAULT_AUTH_REDIRECT));
}

export type DeviceCheckResult = { status: DeviceAccessState["kind"] } | { error: true };

/** Revisión periódica mientras la pantalla está abierta: renueva el vencimiento de este dispositivo y avisa si otro tomó la cuenta. Un fallo de red nunca cierra nada. */
export async function checkDeviceSessionAction(): Promise<DeviceCheckResult> {
  try {
    const user = await getRenderUser();
    if (!user) return { status: "taken-elsewhere" };
    const access = await touchThisDevice(user.id);
    return { status: access.kind };
  } catch {
    return { error: true };
  }
}
