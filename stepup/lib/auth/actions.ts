"use server";

import { redirect } from "next/navigation";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { canSubmitSignIn, canSubmitSignUp, canSubmitForgotPassword, canSubmitNewPassword } from "@/lib/auth/validation";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";
import { abandonRecovery, confirmAuthLink, savePassword, verifyEmailCode, type RecoveryDeps } from "@/lib/auth/recovery-session";
import { clearRecoveryMarker, hasValidRecoveryMarker, setRecoveryMarker } from "@/lib/auth/recovery-cookie";

function recoveryDeps(): RecoveryDeps {
  return {
    adapter: createSupabaseAuthAdapter(),
    markers: { set: setRecoveryMarker, isValid: hasValidRecoveryMarker, clear: clearRecoveryMarker },
  };
}

// Server Actions — corren siempre en el servidor, sobre el adaptador REAL
// (`createSupabaseAuthAdapter()`, nunca el fake de pruebas). Nunca se
// loguean contraseñas, tokens ni datos personales acá — sólo se retorna un
// mensaje de error ya traducido (ver lib/auth/error-messages.ts) para
// mostrar en el formulario.

export interface AuthFormState {
  error?: string;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signInAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readString(formData, "email");
  const password = readString(formData, "password");
  const nextParam = readString(formData, "next");

  if (!canSubmitSignIn(email, password)) {
    return { error: AUTH_ERROR_MESSAGES.unknown };
  }

  const result = await createSupabaseAuthAdapter().signInWithPassword(email, password);
  if (!result.ok) return { error: result.error.message };

  // Un inicio de sesión normal abandona cualquier recuperación que haya quedado a medias en este dispositivo.
  await clearRecoveryMarker();
  redirect(sanitizeNextPath(nextParam));
}

export interface SignUpFormState extends AuthFormState {
  needsEmailConfirmation?: boolean;
}

export async function signUpAction(_prevState: SignUpFormState, formData: FormData): Promise<SignUpFormState> {
  const email = readString(formData, "email");
  const password = readString(formData, "password");
  const confirmPassword = readString(formData, "confirmPassword");

  if (!canSubmitSignUp(email, password, confirmPassword)) {
    return { error: AUTH_ERROR_MESSAGES.unknown };
  }

  const result = await createSupabaseAuthAdapter().signUp(email, password);
  if (!result.ok) return { error: result.error.message };

  return { needsEmailConfirmation: result.data.needsEmailConfirmation };
}

export async function resendConfirmationAction(
  _prevState: AuthFormState & { sent?: boolean },
  formData: FormData
): Promise<AuthFormState & { sent?: boolean }> {
  const email = readString(formData, "email");
  if (!canSubmitForgotPassword(email)) {
    return { error: AUTH_ERROR_MESSAGES.unknown };
  }

  const result = await createSupabaseAuthAdapter().resendConfirmationEmail(email);
  if (!result.ok) return { error: result.error.message };
  return { sent: true };
}

export async function requestPasswordResetAction(
  _prevState: AuthFormState & { sent?: boolean; email?: string },
  formData: FormData
): Promise<AuthFormState & { sent?: boolean; email?: string }> {
  const email = readString(formData, "email");

  if (!canSubmitForgotPassword(email)) {
    return { error: AUTH_ERROR_MESSAGES.unknown };
  }

  const result = await createSupabaseAuthAdapter().requestPasswordReset(email);
  if (!result.ok) return { error: result.error.message };

  // Un pedido nuevo reemplaza al anterior: no sobrevive el marcador de un intento viejo.
  await clearRecoveryMarker();
  return { sent: true, email: email.trim() };
}

/**
 * Paso explícito de confirmación de un enlace de correo (el botón de `/auth/confirm`), para recuperación y
 * para alta. Sólo acá se consume el token (un solo uso): abrir el enlace nunca lo consume, así que un
 * escáner del correo no lo quema. El `type` se revalida acá contra la lista de tipos oficiales (nunca se
 * confía en lo que mostró la página). Recuperación → "Nueva contraseña"; alta → Inicio; error → pantalla de error.
 */
export async function confirmAuthLinkAction(formData: FormData): Promise<void> {
  const outcome = await confirmAuthLink({ tokenHash: readString(formData, "tokenHash"), type: readString(formData, "type") }, recoveryDeps());
  redirect(outcome.redirectTo);
}

export interface EmailCodeFormState extends AuthFormState {
  email?: string;
}

/** Alternativa al enlace: el código de 6 dígitos del mismo correo (ningún escáner puede consumirlo de antemano). */
export async function verifyEmailCodeAction(_prevState: EmailCodeFormState, formData: FormData): Promise<EmailCodeFormState> {
  const flow = readString(formData, "flow") === "signup" ? "signup" : "recovery";
  const outcome = await verifyEmailCode({ flow, email: readString(formData, "email"), code: readString(formData, "code") }, recoveryDeps());
  if ("error" in outcome) return outcome;
  redirect(outcome.redirectTo);
}

/** "Cancelar" en Nueva contraseña: abandona la recuperación (borra el marcador y cierra la sesión que dejó el enlace). */
export async function abandonRecoveryAction(): Promise<void> {
  const outcome = await abandonRecovery(recoveryDeps());
  redirect(outcome.redirectTo);
}

export async function updatePasswordAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  // Sólo se cambia la contraseña de la sesión que acaba de verificar un enlace/código de recuperación,
  // nunca la de una sesión vieja que quedó abierta en el dispositivo (ver recovery-session.ts).
  const outcome = await savePassword({ password: readString(formData, "password"), confirmPassword: readString(formData, "confirmPassword") }, recoveryDeps());
  if ("error" in outcome) return { error: outcome.error };
  redirect(outcome.redirectTo);
}

export async function signOutAction(): Promise<void> {
  await createSupabaseAuthAdapter().signOut();
  await clearRecoveryMarker();
  redirect("/login");
}
