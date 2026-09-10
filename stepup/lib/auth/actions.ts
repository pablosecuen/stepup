"use server";

import { redirect } from "next/navigation";
import { createSupabaseAuthAdapter } from "@/lib/auth/supabase-auth-adapter";
import { canSubmitSignIn, canSubmitSignUp, canSubmitForgotPassword, canSubmitNewPassword } from "@/lib/auth/validation";
import { sanitizeNextPath } from "@/lib/auth/safe-redirect";
import { AUTH_ERROR_MESSAGES } from "@/lib/auth/error-messages";

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

  return { sent: true, email: email.trim() };
}

export async function updatePasswordAction(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = readString(formData, "password");
  const confirmPassword = readString(formData, "confirmPassword");

  if (!canSubmitNewPassword(password, confirmPassword)) {
    return { error: AUTH_ERROR_MESSAGES.unknown };
  }

  const adapter = createSupabaseAuthAdapter();
  const result = await adapter.updatePassword(password);
  if (!result.ok) return { error: result.error.message };

  // Igual que móvil (deliberado, "nunca un atajo para saltarse el inicio
  // de sesión manual"): tras cambiar la contraseña, se cierra la sesión y
  // el usuario tiene que volver a iniciar sesión con la nueva.
  await adapter.signOut();
  redirect("/login");
}

export async function signOutAction(): Promise<void> {
  await createSupabaseAuthAdapter().signOut();
  redirect("/login");
}
