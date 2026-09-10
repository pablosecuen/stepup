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

export interface SignUpOutcome {
  needsEmailConfirmation: boolean;
}

export interface AuthAdapter {
  signInWithPassword(email: string, password: string): Promise<AuthActionResult<AuthUser>>;
  signUp(email: string, password: string): Promise<AuthActionResult<SignUpOutcome>>;
  resendConfirmationEmail(email: string): Promise<AuthActionResult>;
  requestPasswordReset(email: string): Promise<AuthActionResult>;
  updatePassword(newPassword: string): Promise<AuthActionResult>;
  signOut(): Promise<AuthActionResult>;
  exchangeCodeForSession(code: string): Promise<AuthActionResult<AuthUser>>;
  getUser(): Promise<AuthUser | null>;
}
