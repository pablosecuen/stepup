// Reglas de validación — copiadas TAL CUAL de móvil (SignUpScreen.tsx,
// NewPasswordScreen.tsx, SignInScreen.tsx, ForgotPasswordScreen.tsx). Móvil
// nunca valida formato de correo (sólo presencia) y no exige mayúsculas,
// números ni símbolos en la contraseña — sólo longitud mínima. No se
// inventa ninguna regla nueva acá.
export const MIN_PASSWORD_LENGTH = 8;

export function canSubmitSignIn(email: string, password: string): boolean {
  return email.trim().length > 0 && password.length > 0;
}

export function canSubmitSignUp(email: string, password: string, confirmPassword: string): boolean {
  return email.trim().length > 0 && passwordLongEnough(password) && passwordsMatch(password, confirmPassword);
}

export function canSubmitForgotPassword(email: string): boolean {
  return email.trim().length > 0;
}

export function canSubmitNewPassword(password: string, confirmPassword: string): boolean {
  return passwordLongEnough(password) && passwordsMatch(password, confirmPassword);
}

export function passwordLongEnough(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password.length > 0 && password === confirmPassword;
}
