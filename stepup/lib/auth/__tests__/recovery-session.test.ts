import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeAuthAdapter, FakeRecoveryServer } from "../testing/fake-auth-adapter.ts";
import { RECOVERY_MARKER_MAX_AGE_SECONDS, createRecoveryMarker, isValidRecoveryMarker } from "../recovery-marker.ts";
import { abandonRecovery, authCallback, confirmAuthLink, newPasswordGate, savePassword, verifyEmailCode, type RecoveryDeps } from "../recovery-session.ts";
import { authLinkSuccessDestination, planAuthLinkConfirmation } from "../recovery-flow.ts";
import { CALLBACK_ERROR_MESSAGES } from "../error-messages.ts";
import { resolvePrivateAreaAccess } from "../route-protection.ts";

/**
 * Escenarios reales de los enlaces de correo (recuperación de contraseña y
 * confirmación de alta). Cada `Device` es un navegador/dispositivo distinto
 * (su propia sesión y su propia cookie del marcador); todos comparten el mismo
 * "servidor" de Supabase, donde el token de un correo es de un solo uso. Se
 * prueba la lógica REAL de producción (`recovery-session.ts`); sólo el
 * adaptador y la cookie son de prueba.
 */
const QA = { id: "03e8e8f0-ce45-4730-93ae-31dad3666195", email: "qa@example.com", password: "vieja-12345", emailConfirmed: true };
const OTRA = { id: "99999999-aaaa-bbbb-cccc-000000000001", email: "otra@example.com", password: "otra-12345", emailConfirmed: true };
const NUEVA = { id: "77777777-aaaa-bbbb-cccc-000000000002", email: "nueva@example.com", password: "nueva-12345", emailConfirmed: false };
const T0 = 1_790_000_000_000;
const HASH = "pkce_abcdef0123456789abcdef0123456789abcdef0123456789abcdef01"; // correo "Reset Password" de QA
const CODE = "482913";
const HASH_ALTA = "pkce_fedcba9876543210fedcba9876543210fedcba9876543210fedcba98"; // correo "Confirm signup" de NUEVA
const CODE_ALTA = "135790";
const USERS = [QA, OTRA, NUEVA];
const RECOVERY = (tokenHash: string) => ({ tokenHash, type: "recovery" });

class Clock {
  nowMs = T0;
  now = () => this.nowMs;
  advanceMinutes(minutes: number) {
    this.nowMs += minutes * 60_000;
  }
}

interface DeviceOptions {
  signedInUser?: { id: string; email: string } | null;
  enforceCodeVerifier?: boolean;
  ownCodeVerifiers?: string[];
  recoveryCodes?: string[];
  marker?: string | null;
}

class Device {
  readonly name: string;
  readonly adapter: FakeAuthAdapter;
  readonly deps: RecoveryDeps;
  marker: string | null;
  verifyCalls = 0;

  constructor(name: string, server: FakeRecoveryServer, clock: Clock, options: DeviceOptions = {}) {
    this.name = name;
    this.marker = options.marker ?? null;
    this.adapter = new FakeAuthAdapter({
      users: USERS.map((user) => ({ ...user })),
      recoveryServer: server,
      now: clock.now,
      signedInUser: options.signedInUser ?? null,
      enforceCodeVerifier: options.enforceCodeVerifier,
      ownCodeVerifiers: options.ownCodeVerifiers,
      validCodes: { "pkce-code-recovery": QA.id, "pkce-code-signup": NUEVA.id },
      recoveryCodes: options.recoveryCodes ?? ["pkce-code-recovery"],
    });
    const originalVerify = this.adapter.verifyLinkToken.bind(this.adapter);
    this.adapter.verifyLinkToken = async (hash, type) => {
      this.verifyCalls += 1;
      return originalVerify(hash, type);
    };
    this.deps = {
      adapter: this.adapter,
      markers: {
        set: async (userId) => {
          this.marker = createRecoveryMarker(userId, clock.nowMs);
        },
        isValid: async (userId) => isValidRecoveryMarker(this.marker, userId, clock.nowMs),
        clear: async () => {
          this.marker = null;
        },
      },
    };
  }
}

function setup(options: { expiresInMinutes?: number } = {}) {
  const clock = new Clock();
  const server = new FakeRecoveryServer();
  const expiresAtMs = T0 + (options.expiresInMinutes ?? 60) * 60_000;
  server.issue(HASH, { userId: QA.id, email: QA.email, code: CODE, expiresAtMs, flow: "recovery" });
  server.issue(HASH_ALTA, { userId: NUEVA.id, email: NUEVA.email, code: CODE_ALTA, expiresAtMs, flow: "signup" });
  return { clock, server };
}

// ======================================================================
// Tipos aceptados
// ======================================================================

test("sólo se aceptan los tipos oficiales: recovery, signup y email (alta); cualquier otro se rechaza sin consultar a Supabase", () => {
  assert.deepEqual(planAuthLinkConfirmation({ tokenHash: HASH, type: "recovery" }), { kind: "show-confirmation", tokenHash: HASH, type: "recovery", flow: "recovery" });
  assert.deepEqual(planAuthLinkConfirmation({ tokenHash: HASH_ALTA, type: "signup" }), { kind: "show-confirmation", tokenHash: HASH_ALTA, type: "signup", flow: "signup" });
  assert.deepEqual(planAuthLinkConfirmation({ tokenHash: HASH_ALTA, type: "email" }), { kind: "show-confirmation", tokenHash: HASH_ALTA, type: "email", flow: "signup" });
  for (const type of ["magiclink", "invite", "email_change", "phone_change", "sms", "reauthentication", "RECOVERY", "Email", "", " recovery", "recovery ", null, undefined, "recovery,signup", "__proto__", "constructor"]) {
    assert.deepEqual(planAuthLinkConfirmation({ tokenHash: HASH, type }), { kind: "error", category: "link_invalid" }, `type=${String(type)}`);
  }
});

test("destino final: recuperación → Nueva contraseña, alta → Inicio (nunca al revés)", () => {
  assert.equal(authLinkSuccessDestination("recovery"), "/nueva-contrasena");
  assert.equal(authLinkSuccessDestination("signup"), "/inicio");
});

// ======================================================================
// Recuperación de contraseña
// ======================================================================

test("recuperación, mismo navegador: confirmar → Nueva contraseña → guardar → Login → Inicio con la contraseña nueva", async () => {
  const { clock, server } = setup();
  const device = new Device("desktop", server, clock);

  const plan = planAuthLinkConfirmation({ tokenHash: HASH, type: "recovery" });
  assert.equal(plan.kind, "show-confirmation");
  assert.equal(server.tokens.get(HASH)?.usedAtMs, null, "abrir el enlace (GET) no consume el token");

  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), device.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "allow" });

  assert.deepEqual(await savePassword({ password: "nueva-segura-1", confirmPassword: "nueva-segura-1" }, device.deps), { redirectTo: "/login" });
  assert.equal(await device.adapter.getUser(), null, "después de cambiarla se cierra la sesión (igual que móvil)");
  assert.equal(device.marker, null, "el marcador se borra al guardar");

  assert.equal((await device.adapter.signInWithPassword(QA.email, "nueva-segura-1")).ok, true);
  assert.equal((await device.adapter.signInWithPassword(QA.email, QA.password)).ok, false, "la anterior ya no sirve");
  assert.equal(resolvePrivateAreaAccess({ configured: true, hasSession: !!(await device.adapter.getUser()), pathname: "/inicio" }).kind, "allow");
});

test("recuperación, dispositivo distinto: se pidió en el escritorio y se abre en el iPhone — funciona (token_hash, sin PKCE)", async () => {
  const { clock, server } = setup();
  const desktop = new Device("desktop", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-recovery"] });
  const iphone = new Device("iphone", server, clock, { enforceCodeVerifier: true });

  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), iphone.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await newPasswordGate(iphone.deps), { kind: "allow" });
  assert.deepEqual(await newPasswordGate(desktop.deps), { kind: "redirect", to: "/login" }, "el escritorio no queda con sesión ni marcador");
});

test("enlace PKCE ANTIGUO abierto en otro dispositivo: falla como 'otro dispositivo', no como 'ya usado' (el caso real del 3/oct)", async () => {
  const { clock, server } = setup();
  const iphone = new Device("iphone", server, clock, { enforceCodeVerifier: true });
  assert.deepEqual(await authCallback({ code: "pkce-code-recovery", next: "/nueva-contrasena" }, iphone.deps), { redirectTo: "/auth/error?type=link_other_device" });
  assert.match(CALLBACK_ERROR_MESSAGES.link_other_device, /otro|distinto/i);
  assert.equal(await iphone.adapter.getUser(), null);
  assert.equal(iphone.marker, null);
});

test("enlace PKCE antiguo en el mismo navegador: llega a Nueva contraseña — por el next de los correos ya enviados O por el tipo de canje", async () => {
  const { clock, server } = setup();
  const conNext = new Device("desktop", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-recovery"] });
  assert.deepEqual(await authCallback({ code: "pkce-code-recovery", next: "/nueva-contrasena" }, conNext.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await newPasswordGate(conNext.deps), { kind: "allow" });

  // Correo nuevo con plantilla vieja: llega a /auth/callback SIN next; el canje informa que fue una recuperación.
  const sinNext = new Device("desktop2", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-recovery"] });
  assert.deepEqual(await authCallback({ code: "pkce-code-recovery", next: null }, sinNext.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await newPasswordGate(sinNext.deps), { kind: "allow" });
});

test("recuperación: enlace vencido — error claro, sin sesión, sin marcador; la sesión previa del dispositivo no se toca", async () => {
  const { clock, server } = setup({ expiresInMinutes: 10 });
  clock.advanceMinutes(11);
  const device = new Device("iphone", server, clock, { signedInUser: { id: OTRA.id, email: OTRA.email } });

  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), device.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.equal((await device.adapter.getUser())?.id, OTRA.id, "un enlace vencido no cierra ni reemplaza la sesión que ya estaba");
  assert.equal(device.marker, null);
  assert.match(CALLBACK_ERROR_MESSAGES.link_expired, /venció o ya fue usado/);
});

test("recuperación: enlace reutilizado — el segundo uso falla aunque sea desde otro dispositivo", async () => {
  const { clock, server } = setup();
  const first = new Device("desktop", server, clock);
  const second = new Device("iphone", server, clock);

  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), first.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), second.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.equal(await second.adapter.getUser(), null);
  assert.deepEqual(await newPasswordGate(second.deps), { kind: "redirect", to: "/login" });
});

test("recuperación: escáner del correo — sólo hace GET (varias veces) y el token sigue vivo para la persona", async () => {
  const { clock, server } = setup();
  for (let i = 0; i < 5; i += 1) assert.equal(planAuthLinkConfirmation({ tokenHash: HASH, type: "recovery" }).kind, "show-confirmation");
  assert.equal(server.tokens.get(HASH)?.usedAtMs, null, "ningún GET consume el token");
  const device = new Device("iphone", server, clock);
  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), device.deps), { redirectTo: "/nueva-contrasena" });
});

test("recuperación: enlace manipulado — se corta ANTES de consultar a Supabase", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);

  for (const bad of [null, undefined, "", "abc", "x".repeat(300), `${HASH}%20DROP`, `${HASH}<script>`, "../../etc/passwd", `${HASH}\n`]) {
    assert.deepEqual(await confirmAuthLink({ tokenHash: bad, type: "recovery" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" }, String(bad));
  }
  for (const type of ["magiclink", "invite", "RECOVERY", "", null, undefined]) {
    assert.deepEqual(await confirmAuthLink({ tokenHash: HASH, type }, device.deps), { redirectTo: "/auth/error?type=link_invalid" }, `type=${String(type)}`);
  }
  assert.equal(device.verifyCalls, 0, "ningún intento manipulado llegó al servidor");
  assert.equal(server.tokens.get(HASH)?.usedAtMs, null, "el token real sigue intacto");

  const tampered = HASH.slice(0, -1) + (HASH.endsWith("1") ? "2" : "1");
  assert.deepEqual(await confirmAuthLink(RECOVERY(tampered), device.deps), { redirectTo: "/auth/error?type=link_invalid" }, "hash alterado con forma válida: lo rechaza el servidor");
  assert.equal(device.verifyCalls, 1);
  assert.equal(await device.adapter.getUser(), null);
});

test("recuperación: el token de un correo de ALTA no puede usarse como recuperación (no se obtiene marcador ni Nueva contraseña)", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "recovery" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" });
  assert.equal(device.marker, null);
  assert.equal(await device.adapter.getUser(), null);
  assert.equal(server.tokens.get(HASH_ALTA)?.usedAtMs, null, "ni siquiera lo consume");
});

test("recuperación: sesión previa de OTRA cuenta — no se puede cambiar su contraseña por accidente", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock, { signedInUser: { id: OTRA.id, email: OTRA.email } });

  assert.deepEqual(await newPasswordGate(device.deps), { kind: "redirect", to: "/recuperar-contrasena" });
  const attempt = await savePassword({ password: "intruso-12345", confirmPassword: "intruso-12345" }, device.deps);
  assert.ok("error" in attempt);
  assert.equal((await device.adapter.signInWithPassword(OTRA.email, OTRA.password)).ok, true, "la contraseña de la otra cuenta no cambió");

  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), device.deps), { redirectTo: "/nueva-contrasena" });
  assert.equal((await device.adapter.getUser())?.id, QA.id, "la sesión se REEMPLAZA por la de QA");
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "allow" });
  assert.deepEqual(await savePassword({ password: "nueva-segura-1", confirmPassword: "nueva-segura-1" }, device.deps), { redirectTo: "/login" });
  assert.equal((await device.adapter.signInWithPassword(OTRA.email, OTRA.password)).ok, true, "la otra cuenta sigue con su contraseña");
});

test("marcador: de otra cuenta, vencido o ausente — la puerta lo rechaza y la contraseña no se modifica", async () => {
  const { clock, server } = setup();
  const otraCuenta = new Device("iphone", server, clock, { signedInUser: { id: QA.id, email: QA.email }, marker: createRecoveryMarker(OTRA.id, T0) });
  assert.deepEqual(await newPasswordGate(otraCuenta.deps), { kind: "redirect", to: "/recuperar-contrasena" });

  const device = new Device("desktop", server, clock);
  await confirmAuthLink(RECOVERY(HASH), device.deps);
  clock.advanceMinutes(RECOVERY_MARKER_MAX_AGE_SECONDS / 60 + 1);
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "redirect", to: "/recuperar-contrasena" });
  assert.ok("error" in (await savePassword({ password: "nueva-segura-1", confirmPassword: "nueva-segura-1" }, device.deps)));
  assert.equal((await device.adapter.signInWithPassword(QA.email, QA.password)).ok, true, "la contraseña no se cambió");
});

test("contraseñas que no coinciden o demasiado cortas se rechazan sin tocar nada; la recuperación sigue en curso", async () => {
  const { clock, server } = setup();
  const device = new Device("desktop", server, clock);
  await confirmAuthLink(RECOVERY(HASH), device.deps);
  assert.ok("error" in (await savePassword({ password: "nueva-segura-1", confirmPassword: "otra-distinta" }, device.deps)));
  assert.ok("error" in (await savePassword({ password: "corta", confirmPassword: "corta" }, device.deps)));
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "allow" });
});

test("recuperación: código de 6 dígitos — funciona desde otro dispositivo y es del mismo token que el enlace (un solo uso)", async () => {
  const { clock, server } = setup();
  const iphone = new Device("iphone", server, clock, { enforceCodeVerifier: true });
  const desktop = new Device("desktop", server, clock);

  assert.deepEqual(await verifyEmailCode({ flow: "recovery", email: QA.email, code: CODE }, iphone.deps), { redirectTo: "/nueva-contrasena" });
  assert.deepEqual(await newPasswordGate(iphone.deps), { kind: "allow" });

  const reused = await verifyEmailCode({ flow: "recovery", email: QA.email, code: CODE }, desktop.deps);
  assert.ok("error" in reused);
  assert.match(reused.error, /venció o ya fue usado/);
  assert.deepEqual(await confirmAuthLink(RECOVERY(HASH), desktop.deps), { redirectTo: "/auth/error?type=link_expired" });
});

test("recuperación: código incorrecto o con mala forma — mensaje claro, sin sesión, sin consumir el token", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);
  for (const bad of ["", "12345", "1234567", "abcdef", "12 456", "<b>1</b>"]) {
    assert.ok("error" in (await verifyEmailCode({ flow: "recovery", email: QA.email, code: bad }, device.deps)), bad);
  }
  assert.ok("error" in (await verifyEmailCode({ flow: "recovery", email: QA.email, code: "000000" }, device.deps)));
  assert.equal(await device.adapter.getUser(), null);
  assert.equal(server.tokens.get(HASH)?.usedAtMs, null);
});

test("abandonar: 'Cancelar' borra el marcador y cierra la sesión que dejó el enlace", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);
  await confirmAuthLink(RECOVERY(HASH), device.deps);
  assert.notEqual(device.marker, null);

  assert.deepEqual(await abandonRecovery(device.deps), { redirectTo: "/login" });
  assert.equal(device.marker, null);
  assert.equal(await device.adapter.getUser(), null);
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "redirect", to: "/login" });
});

// ======================================================================
// Confirmación de alta
// ======================================================================

test("alta, mismo navegador: confirmar (type=email) → Inicio, con sesión de la cuenta nueva y SIN acceso a Nueva contraseña", async () => {
  const { clock, server } = setup();
  const device = new Device("desktop", server, clock);

  assert.equal(planAuthLinkConfirmation({ tokenHash: HASH_ALTA, type: "email" }).kind, "show-confirmation");
  assert.equal(server.tokens.get(HASH_ALTA)?.usedAtMs, null, "abrir el enlace (GET) no consume el token");

  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, device.deps), { redirectTo: "/inicio" });
  assert.equal((await device.adapter.getUser())?.id, NUEVA.id);
  assert.equal((await device.adapter.signInWithPassword(NUEVA.email, NUEVA.password)).ok, true, "la cuenta quedó confirmada");
  assert.equal(device.marker, null, "una alta no deja marcador de recuperación");
  assert.deepEqual(await newPasswordGate(device.deps), { kind: "redirect", to: "/recuperar-contrasena" }, "la sesión de alta no puede cambiar la contraseña");
  assert.equal(resolvePrivateAreaAccess({ configured: true, hasSession: true, pathname: "/inicio" }).kind, "allow");
});

test("alta: también se acepta type=signup (misma verificación, mismo destino)", async () => {
  const { clock, server } = setup();
  const device = new Device("desktop", server, clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "signup" }, device.deps), { redirectTo: "/inicio" });
});

test("alta, dispositivo distinto: se creó la cuenta en el escritorio y se confirma en el iPhone — funciona", async () => {
  const { clock, server } = setup();
  const desktop = new Device("desktop", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-signup"] });
  const iphone = new Device("iphone", server, clock, { enforceCodeVerifier: true });
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, iphone.deps), { redirectTo: "/inicio" });
  assert.equal((await iphone.adapter.getUser())?.id, NUEVA.id);
  assert.equal(await desktop.adapter.getUser(), null);
});

test("alta con enlace PKCE antiguo: mismo navegador → Inicio (sin marcador); otro dispositivo → 'otro dispositivo'", async () => {
  const { clock, server } = setup();
  const mismo = new Device("desktop", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-signup"], recoveryCodes: [], marker: createRecoveryMarker(QA.id, T0) });
  assert.deepEqual(await authCallback({ code: "pkce-code-signup", next: null }, mismo.deps), { redirectTo: "/inicio" });
  assert.equal(mismo.marker, null, "un marcador viejo no sobrevive a una confirmación de alta");

  const otro = new Device("iphone", server, clock, { enforceCodeVerifier: true, recoveryCodes: [] });
  assert.deepEqual(await authCallback({ code: "pkce-code-signup", next: null }, otro.deps), { redirectTo: "/auth/error?type=link_other_device" });
});

test("alta: escáner del correo — sólo GET, el token sigue vivo", async () => {
  const { clock, server } = setup();
  for (let i = 0; i < 5; i += 1) assert.equal(planAuthLinkConfirmation({ tokenHash: HASH_ALTA, type: "email" }).kind, "show-confirmation");
  assert.equal(server.tokens.get(HASH_ALTA)?.usedAtMs, null);
  const device = new Device("iphone", server, clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, device.deps), { redirectTo: "/inicio" });
});

test("alta: vencida, reutilizada y manipulada se rechazan sin dejar sesión y NUNCA terminan en Inicio", async () => {
  const vencida = setup({ expiresInMinutes: 5 });
  vencida.clock.advanceMinutes(6);
  const a = new Device("iphone", vencida.server, vencida.clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, a.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.equal(await a.adapter.getUser(), null);

  const { clock, server } = setup();
  const primero = new Device("desktop", server, clock);
  const segundo = new Device("iphone", server, clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, primero.deps), { redirectTo: "/inicio" });
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, segundo.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.equal(await segundo.adapter.getUser(), null);

  const manipulado = new Device("iphone2", server, clock);
  for (const bad of [null, "", "abc", `${HASH_ALTA}<x>`, "x".repeat(300)]) {
    assert.deepEqual(await confirmAuthLink({ tokenHash: bad, type: "email" }, manipulado.deps), { redirectTo: "/auth/error?type=link_invalid" }, String(bad));
  }
  assert.equal(manipulado.verifyCalls, 0);
});

test("alta: el token de un correo de ALTA no sirve como recuperación, ni el de recuperación como alta (tipos cruzados)", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH, type: "email" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" }, "token de recuperación con type=email");
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH, type: "signup" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" });
  assert.equal(await device.adapter.getUser(), null);
  assert.equal(server.tokens.get(HASH)?.usedAtMs, null);
  assert.equal(server.tokens.get(HASH_ALTA)?.usedAtMs, null);
});

test("alta con una sesión previa de OTRA cuenta: se reemplaza por la nueva, la otra no se modifica; si el enlace falla, la vieja queda intacta y no se va a Inicio", async () => {
  const { clock, server } = setup({ expiresInMinutes: 5 });
  const device = new Device("iphone", server, clock, { signedInUser: { id: OTRA.id, email: OTRA.email }, marker: createRecoveryMarker(OTRA.id, T0) });

  clock.advanceMinutes(6);
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, device.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.equal((await device.adapter.getUser())?.id, OTRA.id, "enlace vencido: la sesión previa queda como estaba");

  const fresh = setup();
  const device2 = new Device("iphone2", fresh.server, fresh.clock, { signedInUser: { id: OTRA.id, email: OTRA.email }, marker: createRecoveryMarker(OTRA.id, T0) });
  assert.deepEqual(await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, device2.deps), { redirectTo: "/inicio" });
  assert.equal((await device2.adapter.getUser())?.id, NUEVA.id, "la sesión previa NO se reutiliza: ahora es la cuenta confirmada");
  assert.equal(device2.marker, null, "y el marcador viejo de la otra cuenta se borró");
  assert.equal((await device2.adapter.signInWithPassword(OTRA.email, OTRA.password)).ok, true, "la otra cuenta conserva su contraseña");
});

test("alta: código de 6 dígitos — funciona en otro dispositivo, es de un solo uso y no se mezcla con el de recuperación", async () => {
  const { clock, server } = setup();
  const iphone = new Device("iphone", server, clock, { enforceCodeVerifier: true });
  assert.deepEqual(await verifyEmailCode({ flow: "signup", email: NUEVA.email, code: CODE_ALTA }, iphone.deps), { redirectTo: "/inicio" });
  assert.equal((await iphone.adapter.getUser())?.id, NUEVA.id);
  assert.equal(iphone.marker, null);

  const otro = new Device("desktop", server, clock);
  const reusado = await verifyEmailCode({ flow: "signup", email: NUEVA.email, code: CODE_ALTA }, otro.deps);
  assert.ok("error" in reusado);
  assert.match(reusado.error, /venció o ya fue usado/);

  // El código de recuperación no activa una alta, ni al revés.
  const cruzado = await verifyEmailCode({ flow: "signup", email: QA.email, code: CODE }, otro.deps);
  assert.ok("error" in cruzado);
  const cruzado2 = await verifyEmailCode({ flow: "recovery", email: NUEVA.email, code: CODE_ALTA }, otro.deps);
  assert.ok("error" in cruzado2);
  assert.equal(await otro.adapter.getUser(), null);
  assert.equal(otro.marker, null);
});

// ======================================================================
// Callback (compatibilidad) y destino final
// ======================================================================

test("callback: error de Supabase en la URL, sin código y destino malicioso", async () => {
  const { clock, server } = setup();
  const device = new Device("iphone", server, clock);
  assert.deepEqual(await authCallback({ urlErrorCode: "otp_expired", next: "/nueva-contrasena" }, device.deps), { redirectTo: "/auth/error?type=link_expired" });
  assert.deepEqual(await authCallback({ urlErrorCode: "access_denied" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" });
  assert.deepEqual(await authCallback({ next: "/nueva-contrasena" }, device.deps), { redirectTo: "/auth/error?type=link_invalid" });
  assert.equal(device.marker, null);

  const desktop = new Device("desktop", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-signup"], recoveryCodes: [] });
  assert.deepEqual(await authCallback({ code: "pkce-code-signup", next: "https://evil.example.com" }, desktop.deps), { redirectTo: "/inicio" }, "un next externo cae a Inicio");
  assert.equal(desktop.marker, null);

  const malicioso = new Device("desktop2", server, clock, { enforceCodeVerifier: true, ownCodeVerifiers: ["pkce-code-signup"], recoveryCodes: [] });
  assert.deepEqual(await authCallback({ code: "pkce-code-signup", next: "/nueva-contrasena/../../x" }, malicioso.deps), { redirectTo: "/inicio" }, "variantes del next de recuperación no cuentan");
  assert.equal(malicioso.marker, null);
});

test("destino final por flujo: la recuperación termina en Nueva contraseña y el alta en Inicio, por cualquiera de los tres caminos", async () => {
  const { clock, server } = setup();
  const r1 = new Device("r1", server, clock);
  assert.equal((await confirmAuthLink(RECOVERY(HASH), r1.deps)).redirectTo, "/nueva-contrasena");
  const r2 = new Device("r2", server, clock);
  assert.ok("error" in (await verifyEmailCode({ flow: "recovery", email: QA.email, code: CODE }, r2.deps)), "el código ya se consumió con el enlace");

  const fresh = setup();
  const code = new Device("c", fresh.server, fresh.clock);
  assert.deepEqual(await verifyEmailCode({ flow: "recovery", email: QA.email, code: CODE }, code.deps), { redirectTo: "/nueva-contrasena" });
  const a1 = new Device("a1", fresh.server, fresh.clock);
  assert.equal((await confirmAuthLink({ tokenHash: HASH_ALTA, type: "email" }, a1.deps)).redirectTo, "/inicio");
});
