import "server-only";
import { cookies } from "next/headers";
import { RECOVERY_MARKER_COOKIE, RECOVERY_MARKER_MAX_AGE_SECONDS, createRecoveryMarker, isValidRecoveryMarker } from "@/lib/auth/recovery-marker";
import { getRecoverySecrets } from "@/lib/auth/recovery-secret";

/**
 * Lectura/escritura de la cookie de "recuperación en curso" (ver
 * recovery-marker.ts). Nunca guarda tokens ni datos personales: sólo el id del
 * usuario de la sesión recién creada, la hora de emisión y la firma. Sin secreto
 * de firma configurado en Production no se emite (lanza `RecoveryMarkerUnavailableError`,
 * que el flujo convierte en un error controlado) y ninguna cookie se considera válida.
 */
export async function setRecoveryMarker(userId: string): Promise<void> {
  const value = createRecoveryMarker(userId, Date.now(), getRecoverySecrets());
  const store = await cookies();
  store.set(RECOVERY_MARKER_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: RECOVERY_MARKER_MAX_AGE_SECONDS,
  });
}

export async function hasValidRecoveryMarker(userId: string): Promise<boolean> {
  const store = await cookies();
  return isValidRecoveryMarker(store.get(RECOVERY_MARKER_COOKIE)?.value, userId, Date.now(), getRecoverySecrets());
}

export async function clearRecoveryMarker(): Promise<void> {
  const store = await cookies();
  store.delete(RECOVERY_MARKER_COOKIE);
}
