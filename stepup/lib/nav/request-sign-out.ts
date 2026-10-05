import { signOutAction } from "@/lib/auth/actions";

/**
 * Cerrar sesión desde el cliente: reusa el Server Action EXISTENTE (`signOutAction`, sin lógica nueva de auth) con la forma
 * que exige `guardNetwork` (`Promise<{ error?: string }>`). El redirect a /login lo hace el propio Server Action, no se
 * resuelve acá: si la red falla antes de llegar al servidor, `guardNetwork` lo convierte en un mensaje en vez de romper la
 * pantalla.
 */
export async function requestSignOut(): Promise<{ error?: string }> {
  await signOutAction();
  return {};
}
