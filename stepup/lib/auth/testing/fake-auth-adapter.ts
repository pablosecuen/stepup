// Adaptador de autenticación 100% en memoria — nunca hace una request de
// red, nunca importa @supabase/ssr ni @supabase/supabase-js. EXCLUSIVO de
// pruebas: sólo lo importan archivos bajo lib/**/__tests__/. Ninguna
// página, layout, Server Action ni proxy.ts lo referencia — no existe
// ninguna variable de entorno ni flag que lo active en producción; ver
// grep de verificación en el informe de esta fase.
import type { AuthAdapter, AuthActionResult, AuthUser, SignUpOutcome } from "../auth-adapter.ts";
import { normalizeEmail } from "../normalize-email.ts";
import { AUTH_ERROR_MESSAGES, CALLBACK_ERROR_MESSAGES } from "../error-messages.ts";
import { passwordLongEnough } from "../validation.ts";

export interface FakeUserRecord {
  id: string;
  email: string;
  password: string;
  emailConfirmed: boolean;
}

export interface FakeAuthAdapterOptions {
  users?: FakeUserRecord[];
  /** Códigos de intercambio PKCE válidos y de un solo uso: code -> userId. */
  validCodes?: Record<string, string>;
  expiredCodes?: string[];
  /** Simula falta total de conexión en cada llamada del adaptador. */
  offline?: boolean;
  /** Sesión ya iniciada al crear el fake. */
  signedInUser?: AuthUser | null;
}

export class FakeAuthAdapter implements AuthAdapter {
  private readonly users: Map<string, FakeUserRecord>;
  private readonly validCodes: Map<string, string>;
  private readonly expiredCodes: Set<string>;
  private readonly usedCodes = new Set<string>();
  private readonly offline: boolean;
  private signedInUser: AuthUser | null;
  private nextUserId = 1;

  constructor(options: FakeAuthAdapterOptions = {}) {
    this.users = new Map((options.users ?? []).map((user) => [normalizeEmail(user.email), user]));
    this.validCodes = new Map(Object.entries(options.validCodes ?? {}));
    this.expiredCodes = new Set(options.expiredCodes ?? []);
    this.offline = options.offline ?? false;
    this.signedInUser = options.signedInUser ?? null;
  }

  private offlineResult(): AuthActionResult<never> | null {
    if (!this.offline) return null;
    return { ok: false, error: { message: AUTH_ERROR_MESSAGES.no_connection } };
  }

  async signInWithPassword(email: string, password: string): Promise<AuthActionResult<AuthUser>> {
    const offline = this.offlineResult();
    if (offline) return offline;

    const record = this.users.get(normalizeEmail(email));
    if (!record || record.password !== password) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.invalid_credentials } };
    }
    if (!record.emailConfirmed) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.email_not_confirmed } };
    }
    const user: AuthUser = { id: record.id, email: record.email };
    this.signedInUser = user;
    return { ok: true, data: user };
  }

  async signUp(email: string, password: string): Promise<AuthActionResult<SignUpOutcome>> {
    const offline = this.offlineResult();
    if (offline) return offline;

    const key = normalizeEmail(email);
    if (this.users.has(key)) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.user_already_exists } };
    }
    if (!passwordLongEnough(password)) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.weak_password } };
    }
    const id = `fake-user-${this.nextUserId++}`;
    this.users.set(key, { id, email: key, password, emailConfirmed: false });
    // Igual que móvil: "confirmar correo" es siempre obligatorio.
    return { ok: true, data: { needsEmailConfirmation: true } };
  }

  async resendConfirmationEmail(_email: string): Promise<AuthActionResult> {
    const offline = this.offlineResult();
    if (offline) return offline;
    // Igual que requestPasswordReset: nunca revela si la cuenta existe.
    return { ok: true, data: undefined };
  }

  async requestPasswordReset(_email: string): Promise<AuthActionResult> {
    const offline = this.offlineResult();
    if (offline) return offline;
    // Nunca revela si la cuenta existe — igual que Supabase real y que el
    // texto de móvil ("Si {email} tiene una cuenta...").
    return { ok: true, data: undefined };
  }

  async updatePassword(newPassword: string): Promise<AuthActionResult> {
    const offline = this.offlineResult();
    if (offline) return offline;
    if (!this.signedInUser) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.unknown } };
    }
    if (!passwordLongEnough(newPassword)) {
      return { ok: false, error: { message: AUTH_ERROR_MESSAGES.weak_password } };
    }
    const record = [...this.users.values()].find((user) => user.id === this.signedInUser?.id);
    if (record) record.password = newPassword;
    return { ok: true, data: undefined };
  }

  async signOut(): Promise<AuthActionResult> {
    const offline = this.offlineResult();
    if (offline) return offline;
    this.signedInUser = null;
    return { ok: true, data: undefined };
  }

  async exchangeCodeForSession(code: string): Promise<AuthActionResult<AuthUser>> {
    const offline = this.offlineResult();
    if (offline) return offline;

    if (this.usedCodes.has(code)) {
      return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES.link_already_used, code: "link_already_used" } };
    }
    if (this.expiredCodes.has(code)) {
      return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES.link_expired, code: "link_expired" } };
    }
    const userId = this.validCodes.get(code);
    if (!userId) {
      return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES.link_invalid, code: "link_invalid" } };
    }
    this.usedCodes.add(code);
    const record = [...this.users.values()].find((user) => user.id === userId);
    if (record) record.emailConfirmed = true;
    const user: AuthUser = record ? { id: record.id, email: record.email } : { id: userId, email: null };
    this.signedInUser = user;
    return { ok: true, data: user };
  }

  async getUser(): Promise<AuthUser | null> {
    return this.signedInUser;
  }
}
