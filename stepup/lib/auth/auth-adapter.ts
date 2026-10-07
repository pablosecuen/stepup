// Interfaz inyectable de autenticación. `SupabaseAuthAdapter` (real) y
// `FakeAuthAdapter` (sólo pruebas, en lib/auth/testing/) implementan esta
// misma forma — así las Server Actions y las páginas nunca llaman a
// Supabase directamente, siempre a través de un adaptador. No existe
// ninguna variable de entorno ni flag que cambie cuál adaptador usa la app
// en producción: las páginas siempre reciben `createSupabaseAuthAdapter()`
// (ver app/*/page.tsx y las Server Actions); el fake sólo se importa desde
// archivos `__tests__`.

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthActionError {
  message: string;
  /** Categoría estable, sólo presente en errores de exchangeCodeForSession — permite a /auth/error elegir la pantalla sin exponer texto crudo en la URL. */
  code?: string;
}

export type AuthActionResult<T = void> = { ok: true; data: T } | { ok: false; error: AuthActionError };

/** Usuario devuelto por el canje PKCE; `isRecovery` lo informa supabase-js (`redirectType`) cuando el código viene de un pedido de recuperación. */
export interface AuthExchangeUser extends AuthUser {
  isRecovery?: boolean;
}

export interface SignUpOutcome {
  needsEmailConfirmation: boolean;
}

/** Token de CAPTCHA (Turnstile) opcional: sin él (CAPTCHA desactivado) el comportamiento es el de siempre. */
export interface CaptchaOptions {
  captchaToken?: string;
}

export interface AuthAdapter {
  signInWithPassword(email: string, password: string, options?: CaptchaOptions): Promise<AuthActionResult<AuthUser>>;
  signUp(email: string, password: string, options?: CaptchaOptions): Promise<AuthActionResult<SignUpOutcome>>;
  resendConfirmationEmail(email: string, options?: CaptchaOptions): Promise<AuthActionResult>;
  requestPasswordReset(email: string, options?: CaptchaOptions): Promise<AuthActionResult>;
  updatePassword(newPassword: string): Promise<AuthActionResult>;
  signOut(): Promise<AuthActionResult>;
  exchangeCodeForSession(code: string): Promise<AuthActionResult<AuthExchangeUser>>;
  /**
   * Verifica el `token_hash` de un enlace de correo con `verifyOtp` (un solo uso, sin `code_verifier`: sirve desde otro
   * dispositivo). Sólo los tipos oficiales de las plantillas "Reset Password" y "Confirm signup".
   */
  verifyLinkToken(tokenHash: string, type: "recovery" | "signup" | "email"): Promise<AuthActionResult<AuthUser>>;
  /** Verifica el código de 6 dígitos del mismo correo (alternativa a prueba de escáneres). */
  verifyEmailCode(email: string, code: string, flow: "recovery" | "signup"): Promise<AuthActionResult<AuthUser>>;
  getUser(): Promise<AuthUser | null>;
}
