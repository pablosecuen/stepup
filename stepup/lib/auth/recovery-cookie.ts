import "server-only";
import { cookies } from "next/headers";
import { RECOVERY_MARKER_COOKIE, RECOVERY_MARKER_MAX_AGE_SECONDS, createRecoveryMarker, isValidRecoveryMarker } from "@/lib/auth/recovery-marker";

/**
 * Lectura/escritura de la cookie de "recuperación en curso" (ver
 * recovery-marker.ts). Nunca guarda tokens ni datos personales: sólo el id del
 * usuario de la sesión recién creada y la hora de emisión.
 */
export async function setRecoveryMarker(userId: string): Promise<void> {
  const store = await cookies();
  store.set(RECOVERY_MARKER_COOKIE, createRecoveryMarker(userId, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RECOVERY_MARKER_MAX_AGE_SECONDS,
  });
}

export async function hasValidRecoveryMarker(userId: string): Promise<boolean> {
  const store = await cookies();
  return isValidRecoveryMarker(store.get(RECOVERY_MARKER_COOKIE)?.value, userId, Date.now());
}

export async function clearRecoveryMarker(): Promise<void> {
  const store = await cookies();
  store.delete(RECOVERY_MARKER_COOKIE);
}
