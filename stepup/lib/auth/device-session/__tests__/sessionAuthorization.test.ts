// Pruebas de la app original (sessionAuthorization.test.ts) ejecutadas contra la copia idéntica de la web SIN cambiar sus casos ni sus expectativas.
import {
  evaluateSessionAuthorization,
  needsTransferConfirmation,
  evaluateOfflineAuthorization,
  computeCachedAuthorizationExpiry,
  OFFLINE_AUTHORIZATION_MAX_MS,
  type ActiveSessionRow,
  type CachedAuthorization,
} from '../sessionAuthorization.ts';
import assertStrict from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
// Mismo arnés que usa la aplicación original (`testHarness`), sobre node:assert / node:test.
const assert = (condition: unknown, message?: string): void => assertStrict.ok(condition, message);
const assertEqual = <T,>(actual: T, expected: T, message?: string): void => assertStrict.deepEqual(actual, expected, message);
const test = (name: string, run: () => void): void => { nodeTest(name, run); };

function row(overrides: Partial<ActiveSessionRow> = {}): ActiveSessionRow {
  return {
    userId: 'user-1',
    deviceId: 'device-A',
    generation: 1,
    authorizedAt: '2026-07-14T12:00:00.000Z',
    expiresAt: '2026-10-12T12:00:00.000Z',
    lastSeenAt: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-07-14T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Primer dispositivo
// ---------------------------------------------------------------------------

test('primer dispositivo: sin fila en el servidor, no hay sesión activa todavía', () => {
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: null,
    serverRow: null,
    now: NOW,
  });
  assertEqual(result.status, 'no_active_session', 'nadie está autorizado todavía');
  assertEqual(result.serverRow, null, 'sin fila');
});

test('primer dispositivo: recién autorizado, coincide device y generación, sigue vigente', () => {
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: 1,
    serverRow: row({ deviceId: 'device-A', generation: 1 }),
    now: NOW,
  });
  assertEqual(result.status, 'authorized', 'todo coincide');
});

// ---------------------------------------------------------------------------
// Transferencia al segundo dispositivo
// ---------------------------------------------------------------------------

test('transferencia: hay otro dispositivo activo, hace falta confirmación explícita', () => {
  const needsConfirm = needsTransferConfirmation({
    localDeviceId: 'device-B',
    serverRow: row({ deviceId: 'device-A' }),
  });
  assert(needsConfirm, 'otro dispositivo está activo: hay que confirmar antes de transferir');
});

test('sin confirmación necesaria si el dispositivo activo ya es este mismo (re-login)', () => {
  const needsConfirm = needsTransferConfirmation({
    localDeviceId: 'device-A',
    serverRow: row({ deviceId: 'device-A' }),
  });
  assert(!needsConfirm, 'no hay "otro" dispositivo: es el mismo');
});

test('sin confirmación necesaria si nunca hubo ninguna sesión activa', () => {
  const needsConfirm = needsTransferConfirmation({ localDeviceId: 'device-A', serverRow: null });
  assert(!needsConfirm, 'primera vez: nada que transferir');
});

// ---------------------------------------------------------------------------
// Invalidación del primer dispositivo tras la transferencia
// ---------------------------------------------------------------------------

test('invalidación: el dispositivo anterior detecta que el activo ahora es otro', () => {
  // El dispositivo A recuerda su propia generación (1), pero el servidor
  // ahora dice que el dispositivo activo es B con generación 2.
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: 1,
    serverRow: row({ deviceId: 'device-B', generation: 2 }),
    now: NOW,
  });
  assertEqual(result.status, 'locked_elsewhere', 'A quedó afuera: B es el nuevo activo');
});

// ---------------------------------------------------------------------------
// Generación antigua rechazada
// ---------------------------------------------------------------------------

test('generación antigua: mismo dispositivo, pero la generación local quedó vieja', () => {
  // Puede pasar si el propio dispositivo A transfirió la sesión hacia sí
  // mismo dos veces (por ejemplo, cerró y volvió a iniciar sesión) sin que
  // esta instancia de la app se enterara de la generación nueva.
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: 1,
    serverRow: row({ deviceId: 'device-A', generation: 3 }),
    now: NOW,
  });
  assertEqual(result.status, 'locked_elsewhere', 'la generación no coincide: no se puede confirmar autorización');
});

test('generación nunca guardada localmente (null) se trata igual que una generación vieja', () => {
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: null,
    serverRow: row({ deviceId: 'device-A', generation: 1 }),
    now: NOW,
  });
  assertEqual(result.status, 'locked_elsewhere', 'sin generación local confirmada, no se asume autorizado');
});

// ---------------------------------------------------------------------------
// Vencimiento
// ---------------------------------------------------------------------------

test('una autorización vencida se reporta como expired, no como authorized', () => {
  const result = evaluateSessionAuthorization({
    localDeviceId: 'device-A',
    localGeneration: 1,
    serverRow: row({ deviceId: 'device-A', generation: 1, expiresAt: '2026-07-14T11:59:59.000Z' }),
    now: NOW,
  });
  assertEqual(result.status, 'expired', 'venció un segundo antes de "ahora"');
});

test('no muta los objetos recibidos', () => {
  const input = {
    localDeviceId: 'device-A',
    localGeneration: 1,
    serverRow: row({ deviceId: 'device-A', generation: 1 }),
    now: NOW,
  };
  const snapshot = JSON.stringify(input.serverRow);
  evaluateSessionAuthorization(input);
  assertEqual(JSON.stringify(input.serverRow), snapshot, 'la fila del servidor no cambia');
});

// ---------------------------------------------------------------------------
// Corrección obligatoria — funcionamiento offline (máximo 24 horas)
// ---------------------------------------------------------------------------

function cached(overrides: Partial<CachedAuthorization> = {}): CachedAuthorization {
  return {
    deviceId: 'device-A',
    generation: 3,
    expiresAt: '2026-07-15T00:00:00.000Z', // 12h después de NOW
    ...overrides,
  };
}

test('inicio offline con autorización vigente: dispositivo coincide y no venció → authorized', () => {
  const result = evaluateOfflineAuthorization({ localDeviceId: 'device-A', cached: cached(), now: NOW });
  assertEqual(result.status, 'authorized', 'sigue dentro de la ventana offline');
  assertEqual(result.serverRow, null, 'offline nunca hay fila real del servidor');
});

test('inicio offline con autorización vencida: expiresAt ya pasó → expired', () => {
  const result = evaluateOfflineAuthorization({
    localDeviceId: 'device-A',
    cached: cached({ expiresAt: '2026-07-14T11:59:59.000Z' }),
    now: NOW,
  });
  assertEqual(result.status, 'expired', 'venció un segundo antes de "ahora"');
});

test('inicio offline sin ningún caché local → no_active_session (nunca se autoriza sin haber confirmado antes)', () => {
  const result = evaluateOfflineAuthorization({ localDeviceId: 'device-A', cached: null, now: NOW });
  assertEqual(result.status, 'no_active_session', 'sin caché no hay nada que autorizar offline');
});

test('inicio offline con caché de otro dispositivo (defensivo) → locked_elsewhere', () => {
  const result = evaluateOfflineAuthorization({
    localDeviceId: 'device-A',
    cached: cached({ deviceId: 'device-B' }),
    now: NOW,
  });
  assertEqual(result.status, 'locked_elsewhere', 'el caché no corresponde a este dispositivo');
});

test('computeCachedAuthorizationExpiry recorta a 24 horas aunque el servidor autorice más tiempo', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const serverExpiresAt = '2026-08-14T12:00:00.000Z'; // muy lejos (mucho más de 24h)
  const result = computeCachedAuthorizationExpiry(now, serverExpiresAt);
  const expectedMax = new Date(now.getTime() + OFFLINE_AUTHORIZATION_MAX_MS).toISOString();
  assertEqual(result, expectedMax, 'nunca guarda offline más de 24 horas, aunque el servidor permita más');
});

test('computeCachedAuthorizationExpiry respeta el vencimiento del servidor si es MÁS CORTO que 24 horas', () => {
  const now = new Date('2026-07-14T12:00:00.000Z');
  const serverExpiresAt = '2026-07-14T13:00:00.000Z'; // sólo 1 hora
  const result = computeCachedAuthorizationExpiry(now, serverExpiresAt);
  assertEqual(result, serverExpiresAt, 'usa el vencimiento del servidor cuando es más corto que el máximo offline');
});
