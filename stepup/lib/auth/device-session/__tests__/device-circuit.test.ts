// Circuito WEB de «un solo dispositivo activo»: la decisión de la web (cookie + fila del servidor) contra un modelo fiel de las tres funciones reales de la base
// (transfer_active_session / touch_active_session / end_active_session, definiciones leídas del proyecto). Cada navegador es un «dispositivo» con su propia cookie.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generateDeviceId, parseDeviceCookie, resolveDeviceAccess, serializeDeviceCookie, isDeviceSessionEnforced, type DeviceAccessState } from "../decision.ts";
import type { ActiveSessionRow } from "../sessionAuthorization.ts";

const HOUR = 60 * 60 * 1000;

/** Modelo de la fila única por cuenta y de sus tres funciones (mismas reglas que el SQL real). */
class FakeServer {
  row: ActiveSessionRow | null = null;
  now: Date;
  constructor(now: Date) {
    this.now = now;
  }
  transfer(deviceId: string): number {
    const sameDevice = this.row?.deviceId === deviceId;
    const generation = this.row ? (sameDevice ? this.row.generation : this.row.generation + 1) : 1;
    this.row = { userId: "u", deviceId, generation, authorizedAt: this.now.toISOString(), expiresAt: new Date(this.now.getTime() + 24 * HOUR).toISOString(), lastSeenAt: this.now.toISOString() };
    return generation;
  }
  touch(deviceId: string) {
    if (this.row && this.row.deviceId === deviceId) this.row = { ...this.row, lastSeenAt: this.now.toISOString(), expiresAt: new Date(this.now.getTime() + 24 * HOUR).toISOString() };
  }
  end(deviceId: string, generation: number) {
    if (this.row && this.row.deviceId === deviceId && this.row.generation === generation) this.row = null;
  }
}

/** Un navegador: su cookie y lo que hace con el servidor. */
class Browser {
  cookie: string | null = null;
  readonly server: FakeServer;
  constructor(server: FakeServer) {
    this.server = server;
  }
  access(): DeviceAccessState {
    return resolveDeviceAccess({ cookieValue: this.cookie, serverRow: this.server.row, now: this.server.now });
  }
  /** `claimThisDevice`: reutiliza el identificador del navegador, o crea uno. */
  claim() {
    const deviceId = parseDeviceCookie(this.cookie)?.deviceId ?? generateDeviceId(() => `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
    this.cookie = serializeDeviceCookie({ deviceId, generation: this.server.transfer(deviceId) });
  }
  /** `touchThisDevice` (revisión periódica). */
  check(): DeviceAccessState {
    const local = parseDeviceCookie(this.cookie);
    if (local) this.server.touch(local.deviceId);
    return this.access();
  }
  /** `releaseThisDevice` (cerrar sesión). */
  signOut() {
    const local = parseDeviceCookie(this.cookie);
    if (local) this.server.end(local.deviceId, local.generation);
    this.cookie = null;
  }
}

test("primer ingreso: sin nadie autorizado el navegador se autoriza solo (sin preguntar) y queda autorizado", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  assert.equal(a.access().kind, "claim");
  a.claim();
  assert.equal(a.access().kind, "authorized");
  assert.equal(server.row?.generation, 1);
});

test("un segundo dispositivo pide confirmación; al confirmar, el primero queda cerrado («Tu cuenta se abrió en otro dispositivo») y el segundo autorizado", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  const b = new Browser(server);
  a.claim();
  assert.equal(b.access().kind, "confirm-transfer", "b nunca se autorizó y a está activo: confirmar antes de cerrar a");
  assert.equal(a.access().kind, "authorized", "mientras b no confirme, a sigue intacto");
  b.claim();
  assert.equal(b.access().kind, "authorized");
  assert.equal(a.access().kind, "taken-elsewhere");
  assert.equal(a.check().kind, "taken-elsewhere", "la revisión periódica de a lo detecta y no lo resucita");
  assert.equal(server.row?.generation, 2);
});

test("volver a usar el primero lo transfiere de nuevo (b queda cerrado) y la generación sube", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  const b = new Browser(server);
  a.claim();
  b.claim();
  a.claim();
  assert.equal(a.access().kind, "authorized");
  assert.equal(b.access().kind, "taken-elsewhere");
  assert.equal(server.row?.generation, 3);
});

test("autorizar el mismo navegador dos veces (dos pestañas) no cambia la generación: no se expulsa a sí mismo", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  a.claim();
  const first = server.row?.generation;
  a.claim();
  assert.equal(server.row?.generation, first);
  assert.equal(a.access().kind, "authorized");
});

test("vencimiento: sin actividad 24 h el dispositivo deja de estar autorizado y se reautoriza solo; con actividad (revisión periódica) nunca vence", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  a.claim();
  server.now = new Date(server.now.getTime() + 20 * HOUR);
  assert.equal(a.check().kind, "authorized", "la revisión renueva 24 h más");
  server.now = new Date(server.now.getTime() + 20 * HOUR);
  assert.equal(a.check().kind, "authorized", "40 h desde el ingreso pero con actividad a las 20 h");
  server.now = new Date(server.now.getTime() + 25 * HOUR);
  assert.equal(a.access().kind, "claim", "25 h sin actividad: venció; nadie más la tomó, se reautoriza sin preguntar");
  a.claim();
  assert.equal(a.access().kind, "authorized");
});

test("cerrar sesión libera el lugar: otro dispositivo entra sin pedir confirmación; un dispositivo viejo nunca borra la sesión del que lo reemplazó", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  const b = new Browser(server);
  a.claim();
  a.signOut();
  assert.equal(server.row, null);
  assert.equal(b.access().kind, "claim");
  b.claim();
  // a (cookie borrada) no puede borrar nada; pero un a con cookie vieja sí intentaría: la base exige dispositivo Y generación vigentes.
  const stale = new Browser(server);
  stale.cookie = serializeDeviceCookie({ deviceId: "web-viejo-viejo-viejo", generation: 1 });
  stale.signOut();
  assert.equal(b.access().kind, "authorized");
});

test("un navegador con cookie alterada o mal formada nunca está autorizado", () => {
  const server = new FakeServer(new Date("2026-10-28T12:00:00Z"));
  const a = new Browser(server);
  a.claim();
  const real = a.cookie!;
  for (const bad of ["", "basura", ".3", "web-xxxxxxxx.0", "web-xxxxxxxx.abc", "a.1", `${real}x`]) {
    const attacker = new Browser(server);
    attacker.cookie = bad;
    assert.notEqual(attacker.access().kind, "authorized", bad);
  }
  const copy = new Browser(server);
  copy.cookie = real;
  assert.equal(copy.access().kind, "authorized", "copiar la cookie de un navegador autorizado lo hace ese mismo dispositivo (es su identidad); la protección es la cookie HttpOnly");
  const b = new Browser(server);
  b.claim();
  assert.equal(copy.access().kind, "taken-elsewhere", "…y deja de valer apenas otro dispositivo toma la cuenta");
});

test("interruptor de emergencia: sólo `off` desactiva el control", () => {
  assert.equal(isDeviceSessionEnforced({}), true);
  assert.equal(isDeviceSessionEnforced({ DEVICE_SESSION_ENFORCEMENT: "on" }), true);
  assert.equal(isDeviceSessionEnforced({ DEVICE_SESSION_ENFORCEMENT: "off" }), false);
});

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

test("cableado: toda pantalla y acción pasa por el control; sólo una Server Action escribe la cookie; cerrar sesión libera el lugar", () => {
  assert.match(read("lib/db/server-context.ts"), /readDeviceAccess\(user\.id\)[\s\S]*DeviceNotAuthorizedError/);
  const layout = read("app/(app)/layout.tsx");
  assert.match(layout, /readDeviceAccess\(user\.id\)/);
  assert.match(layout, /<DeviceSessionWatcher \/>/);
  assert.match(layout, /redirect\("\/dispositivo\?motivo=otro"\)/);
  const proxy = read("proxy.ts");
  assert.match(proxy, /!request\.cookies\.get\(DEVICE_COOKIE\)/);
  assert.match(proxy, /\/dispositivo/);
  assert.match(read("lib/auth/actions.ts"), /await releaseThisDevice\(\);\s*await createSupabaseAuthAdapter\(\)\.signOut\(\);/);
  // La cookie del dispositivo sólo se escribe en `claimThisDevice`, que sólo llama una Server Action (POST), nunca un render (GET).
  const server = read("lib/auth/device-session/server.ts");
  assert.equal((server.match(/store\.set\(/g) ?? []).length, 1);
  assert.match(read("lib/actions/device-session.ts"), /^"use server";/);
  assert.match(read("lib/actions/device-session.ts"), /claimThisDevice\(\)/);
  assert.doesNotMatch(read("app/dispositivo/page.tsx"), /claimThisDevice|touchThisDevice/);
  // La cookie es HttpOnly (el navegador no la lee) y las acciones nunca aceptan un identificador de dispositivo del cliente.
  assert.match(server, /httpOnly: true/);
  assert.doesNotMatch(read("lib/actions/device-session.ts"), /deviceId:/);
});
