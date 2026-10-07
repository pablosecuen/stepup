import type { AuthAdapter } from "./auth-adapter.ts";
import { AUTH_ERROR_MESSAGES, CALLBACK_ERROR_MESSAGES, classifyCallbackUrlError } from "./error-messages.ts";
import { authLinkSuccessDestination, isValidEmailCode, planAuthLinkConfirmation, resolveNewPasswordAccess, type AuthLinkFlow } from "./recovery-flow.ts";
import { RecoveryMarkerUnavailableError } from "./recovery-marker.ts";
import { RECOVERY_PASSWORD_PATH, sanitizeNextPath } from "./safe-redirect.ts";
import { canSubmitForgotPassword, canSubmitNewPassword } from "./validation.ts";

/**
 * Orquestación PURA de los enlaces de correo (recuperación de contraseña y
 * confirmación de alta): confirmar enlace, código de 6 dígitos, callback PKCE
 * antiguo, puerta de "Nueva contraseña", guardado y abandono. Las Server
 * Actions, `/auth/callback` y las páginas sólo inyectan el adaptador real y la
 * cookie real; las pruebas inyectan un adaptador en memoria y un almacén de
 * marcadores por "dispositivo". Nada acá toca Next ni la red, y nada loguea
 * tokens, códigos, URLs ni correos.
 */
export interface RecoveryMarkerStore {
  set(userId: string): Promise<void>;
  isValid(userId: string): Promise<boolean>;
  clear(): Promise<void>;
}

export interface RecoveryDeps {
  adapter: AuthAdapter;
  markers: RecoveryMarkerStore;
}

export interface Redirect {
  redirectTo: string;
}

function errorRedirect(category: string | undefined): Redirect {
  return { redirectTo: `/auth/error?type=${category ?? "unknown"}` };
}

/**
 * Deja o quita el marcador según el flujo ya verificado: la recuperación lo crea (atado al usuario de la
 * sesión nueva y FIRMADO, ver recovery-marker.ts); cualquier otra verificación borra uno viejo, para que no
 * sobreviva de otro intento. Devuelve `false` si no se pudo firmar (sin secreto en el servidor): en ese caso la
 * sesión que dejó el enlace se cierra, porque sin marcador no podría cambiar la contraseña y no debe quedar abierta.
 */
async function settleMarker(flow: AuthLinkFlow, userId: string, deps: RecoveryDeps): Promise<boolean> {
  if (flow !== "recovery") {
    await deps.markers.clear();
    return true;
  }
  return setMarkerOrSignOut(userId, deps);
}

async function setMarkerOrSignOut(userId: string, deps: RecoveryDeps): Promise<boolean> {
  try {
    await deps.markers.set(userId);
    return true;
  } catch (error) {
    if (!(error instanceof RecoveryMarkerUnavailableError)) throw error;
    await deps.markers.clear();
    await deps.adapter.signOut();
    return false;
  }
}

/** Botón "Continuar" de /auth/confirm: recién acá se consume el token. Recuperación → Nueva contraseña; alta → Inicio; error → pantalla de error. */
export async function confirmAuthLink(input: { tokenHash?: string | null; type?: string | null }, deps: RecoveryDeps): Promise<Redirect> {
  const plan = planAuthLinkConfirmation({ tokenHash: input.tokenHash, type: input.type });
  if (plan.kind !== "show-confirmation") return errorRedirect(plan.kind === "error" ? plan.category : "link_invalid");

  const result = await deps.adapter.verifyLinkToken(plan.tokenHash, plan.type);
  if (!result.ok) return errorRedirect(result.error.code);

  if (!(await settleMarker(plan.flow, result.data.id, deps))) return errorRedirect("server_error");
  return { redirectTo: authLinkSuccessDestination(plan.flow) };
}

/** Código de 6 dígitos del mismo correo (recuperación o alta). */
export async function verifyEmailCode(input: { flow: AuthLinkFlow; email: string; code: string }, deps: RecoveryDeps): Promise<Redirect | { error: string; email: string }> {
  if (!canSubmitForgotPassword(input.email) || !isValidEmailCode(input.code)) {
    return { email: input.email, error: "Ingresá el código de 6 dígitos que llegó a tu correo." };
  }

  const result = await deps.adapter.verifyEmailCode(input.email, input.code, input.flow);
  if (!result.ok) return { email: input.email, error: result.error.message };

  if (!(await settleMarker(input.flow, result.data.id, deps))) return { email: input.email, error: CALLBACK_ERROR_MESSAGES.server_error };
  return { redirectTo: authLinkSuccessDestination(input.flow) };
}

/**
 * `/auth/callback`: enlaces PKCE antiguos (los correos ya enviados) y compatibilidad. El destino lo decide el
 * resultado del canje (`isRecovery`, que supabase-js recuerda desde el pedido de recuperación) o un `next`
 * de recuperación de los correos antiguos; nunca confía en el `next` crudo (se sanea).
 */
export async function authCallback(input: { code?: string | null; next?: string | null; urlErrorCode?: string | null }, deps: RecoveryDeps): Promise<Redirect> {
  const next = sanitizeNextPath(input.next);

  if (input.urlErrorCode) return errorRedirect(classifyCallbackUrlError(input.urlErrorCode));
  if (!input.code) return errorRedirect("link_invalid");

  const result = await deps.adapter.exchangeCodeForSession(input.code);
  if (!result.ok) return errorRedirect(result.error.code);

  if (result.data.isRecovery || next === RECOVERY_PASSWORD_PATH) {
    if (!(await setMarkerOrSignOut(result.data.id, deps))) return errorRedirect("server_error");
    return { redirectTo: RECOVERY_PASSWORD_PATH };
  }

  await deps.markers.clear();
  return { redirectTo: next };
}

/** Puerta de /nueva-contrasena: sesión + marcador de ESA sesión. */
export async function newPasswordGate(deps: RecoveryDeps): Promise<{ kind: "allow" } | { kind: "redirect"; to: string }> {
  const user = await deps.adapter.getUser();
  return resolveNewPasswordAccess({ hasSession: !!user, markerValid: user ? await deps.markers.isValid(user.id) : false });
}

/** Guardado de la contraseña nueva: sólo para la sesión que verificó un enlace/código; después cierra sesión y vuelve a Login (igual que móvil). */
export async function savePassword(input: { password: string; confirmPassword: string }, deps: RecoveryDeps): Promise<{ error: string } | Redirect> {
  if (!canSubmitNewPassword(input.password, input.confirmPassword)) return { error: AUTH_ERROR_MESSAGES.unknown };

  const gate = await newPasswordGate(deps);
  if (gate.kind !== "allow") return { error: CALLBACK_ERROR_MESSAGES.link_expired };

  const result = await deps.adapter.updatePassword(input.password);
  if (!result.ok) return { error: result.error.message };

  await deps.markers.clear();
  await deps.adapter.signOut();
  return { redirectTo: "/login" };
}

/** Abandonar la recuperación ("Cancelar"): borra el marcador y cierra la sesión que el enlace dejó abierta. */
export async function abandonRecovery(deps: RecoveryDeps): Promise<Redirect> {
  await deps.markers.clear();
  await deps.adapter.signOut();
  return { redirectTo: "/login" };
}
