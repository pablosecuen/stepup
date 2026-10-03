// Adaptador de autenticación 100% en memoria — nunca hace una request de
// red, nunca importa @supabase/ssr ni @supabase/supabase-js. EXCLUSIVO de
// pruebas: sólo lo importan archivos bajo lib/**/__tests__/. Ninguna
// página, layout, Server Action ni proxy.ts lo referencia — no existe
// ninguna variable de entorno ni flag que lo active en producción; ver
// grep de verificación en el informe de esta fase.
import type { AuthAdapter, AuthActionResult, AuthExchangeUser, AuthUser, SignUpOutcome } from "../auth-adapter.ts";
import { normalizeEmail } from "../normalize-email.ts";
import { AUTH_ERROR_MESSAGES, CALLBACK_ERROR_MESSAGES, type CallbackErrorCategory } from "../error-messages.ts";
import { passwordLongEnough } from "../validation.ts";

export interface FakeUserRecord {
  id: string;
  email: string;
  password: string;
  emailConfirmed: boolean;
}

export type FakeTokenFlow = "recovery" | "signup";

export interface FakeRecoveryTokenRecord {
  userId: string;
  email: string;
  /** Qué correo originó el token: "Reset Password" o "Confirm signup". */
  flow: FakeTokenFlow;
  /** Código de 6 dígitos del mismo correo. */
  code: string;
  expiresAtMs: number;
  usedAtMs: number | null;
}

type FakeConsumeResult = { ok: true; userId: string; email: string; flow: FakeTokenFlow } | { ok: false; category: CallbackErrorCategory };

/**
 * "Servidor" de Supabase compartido entre varios dispositivos de prueba (cada
 * `FakeAuthAdapter` es un navegador con su propia sesión y sus propias cookies,
 * pero el token de un correo vive acá: un solo uso para todos). Como Supabase
 * real, un token vencido y uno ya consumido responden lo mismo (`otp_expired`),
 * y el enlace y el código de 6 dígitos del mismo correo son el MISMO token.
 */
export class FakeRecoveryServer {
  readonly tokens = new Map<string, FakeRecoveryTokenRecord>();

  issue(tokenHash: string, record: Omit<FakeRecoveryTokenRecord, "usedAtMs" | "flow"> & { flow?: FakeTokenFlow }): void {
    this.tokens.set(tokenHash, { ...record, flow: record.flow ?? "recovery", usedAtMs: null });
  }

  consume(tokenHash: string, nowMs: number, expectedFlow: FakeTokenFlow): FakeConsumeResult {
    const record = this.tokens.get(tokenHash);
    if (!record) return { ok: false, category: "link_invalid" };
    // Un token de un correo no sirve con el `type` del otro.
    if (record.flow !== expectedFlow) return { ok: false, category: "link_invalid" };
    if (record.usedAtMs !== null || nowMs > record.expiresAtMs) return { ok: false, category: "link_expired" };
    record.usedAtMs = nowMs;
    return { ok: true, userId: record.userId, email: record.email, flow: record.flow };
  }

  consumeByCode(email: string, code: string, nowMs: number, expectedFlow: FakeTokenFlow): FakeConsumeResult {
    const entry = [...this.tokens.entries()].find(([, record]) => normalizeEmail(record.email) === normalizeEmail(email) && record.code === code);
    if (!entry) return { ok: false, category: "link_invalid" };
    return this.consume(entry[0], nowMs, expectedFlow);
  }
}

export interface FakeAuthAdapterOptions {
  users?: FakeUserRecord[];
  /** Códigos de intercambio PKCE válidos y de un solo uso: code -> userId. */
  validCodes?: Record<string, string>;
  /** Subconjunto de `validCodes` que vino de un pedido de recuperación (supabase-js `redirectType`). */
  recoveryCodes?: string[];
  expiredCodes?: string[];
  /** Simula falta total de conexión en cada llamada del adaptador. */
  offline?: boolean;
  /** Sesión ya iniciada al crear el fake. */
  signedInUser?: AuthUser | null;
  /** Servidor de recuperación compartido entre dispositivos (ver `FakeRecoveryServer`). */
  recoveryServer?: FakeRecoveryServer;
  /** Reloj inyectable (ms). */
  now?: () => number;
  /**
   * PKCE real: el `code_verifier` vive en el navegador que PIDIÓ el enlace. Con `true`, sólo
   * se pueden canjear los códigos listados en `ownCodeVerifiers`; cualquier otro falla como
   * `link_other_device` (abierto desde otro dispositivo/escáner), no como "ya usado".
   */
  enforceCodeVerifier?: boolean;
  ownCodeVerifiers?: string[];
}

export class FakeAuthAdapter implements AuthAdapter {
  private readonly users: Map<string, FakeUserRecord>;
  private readonly validCodes: Map<string, string>;
  private readonly expiredCodes: Set<string>;
  private readonly recoveryCodes: Set<string>;
  private readonly usedCodes = new Set<string>();
  private readonly offline: boolean;
  private signedInUser: AuthUser | null;
  private nextUserId = 1;
  private readonly recoveryServer: FakeRecoveryServer;
  private readonly now: () => number;
  private readonly enforceCodeVerifier: boolean;
  private readonly ownCodeVerifiers: Set<string>;

  constructor(options: FakeAuthAdapterOptions = {}) {
    this.users = new Map((options.users ?? []).map((user) => [normalizeEmail(user.email), user]));
    this.validCodes = new Map(Object.entries(options.validCodes ?? {}));
    this.expiredCodes = new Set(options.expiredCodes ?? []);
    this.recoveryCodes = new Set(options.recoveryCodes ?? []);
    this.offline = options.offline ?? false;
    this.signedInUser = options.signedInUser ?? null;
    this.recoveryServer = options.recoveryServer ?? new FakeRecoveryServer();
    this.now = options.now ?? (() => Date.now());
    this.enforceCodeVerifier = options.enforceCodeVerifier ?? false;
    this.ownCodeVerifiers = new Set(options.ownCodeVerifiers ?? []);
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

  async exchangeCodeForSession(code: string): Promise<AuthActionResult<AuthExchangeUser>> {
    const offline = this.offlineResult();
    if (offline) return offline;

    if (this.enforceCodeVerifier && !this.ownCodeVerifiers.has(code)) {
      return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES.link_other_device, code: "link_other_device" } };
    }
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
    return { ok: true, data: { ...user, isRecovery: this.recoveryCodes.has(code) } };
  }

  private verifyResult(result: ReturnType<FakeRecoveryServer["consume"]>): AuthActionResult<AuthUser> {
    if (!result.ok) {
      return { ok: false, error: { message: CALLBACK_ERROR_MESSAGES[result.category], code: result.category } };
    }
    // Verificar con éxito crea una sesión NUEVA que reemplaza cualquier sesión previa del dispositivo.
    const user: AuthUser = { id: result.userId, email: result.email };
    if (result.flow === "signup") {
      const record = [...this.users.values()].find((candidate) => candidate.id === result.userId);
      if (record) record.emailConfirmed = true;
    }
    this.signedInUser = user;
    return { ok: true, data: user };
  }

  async verifyLinkToken(tokenHash: string, type: "recovery" | "signup" | "email"): Promise<AuthActionResult<AuthUser>> {
    const offline = this.offlineResult();
    if (offline) return offline;
    return this.verifyResult(this.recoveryServer.consume(tokenHash, this.now(), type === "recovery" ? "recovery" : "signup"));
  }

  async verifyEmailCode(email: string, code: string, flow: "recovery" | "signup"): Promise<AuthActionResult<AuthUser>> {
    const offline = this.offlineResult();
    if (offline) return offline;
    return this.verifyResult(this.recoveryServer.consumeByCode(email, code.trim(), this.now(), flow));
  }

  async getUser(): Promise<AuthUser | null> {
    return this.signedInUser;
  }
}
