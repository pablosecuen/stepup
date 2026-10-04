import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Servidor (Vercel, TZ=UTC) y navegador (America/Argentina/Buenos_Aires)
 * deben calcular EXACTAMENTE lo mismo: las siete claves civiles, el rótulo
 * semanal, el resaltado de hoy, la posición de cada tarjeta y los enlaces de
 * navegación. Cualquier diferencia es un hydration mismatch (React #418) y,
 * como pasó en producción, una grilla corrida un día.
 *
 * Cada zona corre en un proceso hijo REAL con su propio `TZ`, así que el
 * `Date` local del proceso es genuinamente distinto en cada caso.
 */
const PROBE = fileURLToPath(new URL("./support/civil-calendar-probe.ts", import.meta.url));

function run(tz: string, mode: "current" | "legacy-server" | "legacy-client", nowIso?: string, wire?: string): { stdout: string; offsetMinutes: number } {
  const args = [PROBE, mode, nowIso ?? "2026-10-03T20:07:00.000Z", ...(wire ? [wire] : [])];
  const result = spawnSync(process.execPath, args, { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(result.status, 0, `sonda falló en ${tz}: ${result.stderr}`);
  const stderrLine = result.stderr.trim().split("\n").filter((line) => line.startsWith("{")).pop() ?? "{}";
  return { stdout: result.stdout.trim(), offsetMinutes: JSON.parse(stderrLine).offsetMinutes };
}

const SERVER_TZ = "UTC";
const CLIENT_TZ = "America/Argentina/Buenos_Aires";
const OTHER_ZONES = ["America/Los_Angeles", "Pacific/Honolulu", "America/Sao_Paulo", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Auckland"];

test("la sonda realmente corre con zonas distintas (TZ toma efecto en el proceso hijo)", () => {
  assert.equal(run(SERVER_TZ, "current").offsetMinutes, 0);
  assert.equal(run(CLIENT_TZ, "current").offsetMinutes, 180, "Buenos Aires = UTC-3");
  assert.equal(run("Pacific/Honolulu", "current").offsetMinutes, 600, "zona negativa lejana (UTC-10)");
});

test("servidor UTC vs cliente Argentina: salida idéntica (claves, rótulos, hoy, tarjetas, enlaces)", () => {
  const server = run(SERVER_TZ, "current").stdout;
  const client = run(CLIENT_TZ, "current").stdout;
  assert.equal(client, server);
  const parsed = JSON.parse(server);
  assert.deepEqual(parsed.window.dayKeys, ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(parsed.weekLabel, "28 sept – 4 oct 2026");
  assert.deepEqual(
    parsed.header.map((h: { weekday: string; dom: number }) => `${h.weekday} ${h.dom}`),
    ["LUN 28", "MAR 29", "MIÉ 30", "JUE 1", "VIE 2", "SÁB 3", "DOM 4"]
  );
  assert.deepEqual(parsed.header.filter((h: { today: boolean }) => h.today).map((h: { key: string }) => h.key), ["2026-10-03"], "sólo el sábado 3 es hoy");
  assert.equal(parsed.window.rangeEndIso, "2026-10-05T02:59:59.999Z", "el domingo entero entra al rango");
  const byKey = Object.fromEntries(parsed.columns.map((c: { key: string; cards: Array<{ id: string; time: string }> }) => [c.key, c.cards.map((card) => `${card.id}@${card.time}`)]));
  assert.deepEqual(byKey["2026-09-28"], ["lun-0800@08:00"]);
  assert.deepEqual(byKey["2026-10-03"], ["sab-2059@20:59", "sab-2100@21:00"], "21:00 de BA sigue siendo sábado aunque en UTC sea domingo");
  assert.deepEqual(byKey["2026-10-04"], ["dom-2330@23:30"]);
});

test("misma salida en zonas negativas y positivas (no sólo UTC vs Argentina)", () => {
  const reference = run(CLIENT_TZ, "current").stdout;
  for (const zone of OTHER_ZONES) {
    assert.equal(run(zone, "current").stdout, reference, zone);
  }
});

test("instantes cerca del cambio de día: servidor y cliente coinciden minuto a minuto", () => {
  const nowSamples = [
    "2026-10-04T02:59:59.999Z", // sáb 23:59:59.999 en BA
    "2026-10-04T03:00:00.000Z", // dom 00:00 en BA
    "2026-10-05T02:59:59.999Z", // dom 23:59:59.999 en BA
    "2026-10-05T03:00:00.000Z", // lun 00:00 en BA
    "2026-12-31T23:59:00.000Z", // fin de año (UTC) = 20:59 en BA
    "2027-01-01T02:59:59.999Z", // 31/dic 23:59:59.999 en BA
    "2027-01-01T03:00:00.000Z", // 1/ene 00:00 en BA
  ];
  for (const now of nowSamples) {
    const server = run(SERVER_TZ, "current", now).stdout;
    assert.equal(run(CLIENT_TZ, "current", now).stdout, server, now);
    assert.equal(run("Pacific/Honolulu", "current", now).stdout, server, `${now} (Honolulu)`);
  }
});

test("canario: la lógica anterior (Date en el servidor + getters locales en el cliente) reproduce el defecto de producción", () => {
  // Si esto dejara de fallar, las pruebas de igualdad de arriba perderían poder de detección.
  const wire = JSON.stringify(JSON.parse(run(SERVER_TZ, "legacy-server").stdout).wire);
  const sameZone = JSON.parse(run(SERVER_TZ, "legacy-client", undefined, wire).stdout).dayKeys;
  const argentina = JSON.parse(run(CLIENT_TZ, "legacy-client", undefined, wire).stdout).dayKeys;
  assert.deepEqual(sameZone, ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"], "servidor y cliente en UTC: sin corrimiento");
  assert.deepEqual(argentina, ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"], "cliente en Argentina: todos los días un día antes (el bug real)");
});
