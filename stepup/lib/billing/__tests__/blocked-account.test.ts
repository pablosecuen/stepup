import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOCKED_ACCOUNT_HOME, isAllowedWhenBlocked } from "../blocked-paths.ts";
import { BLOCKED_MODE_READ_TABLES, BLOCKED_MODE_RPC, BLOCKED_MODE_WRITE_TABLES, LIMITED_MODE_RPC, allowedWhenBlocked } from "../write-guard.ts";
import { PRIVATE_ROUTE_PREFIXES } from "../../auth/safe-redirect.ts";

const ORIGIN = "https://proyecto.supabase.test";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("cuenta BLOQUEADA — páginas: sólo «Suscripción pendiente», Facturación (y subrutas) y Configuración EXACTA; todo lo demás del área privada redirige", () => {
  for (const path of ["/suscripcion-pendiente", "/facturacion", "/facturacion/planes", "/facturacion/resultado", "/facturacion/condiciones", "/configuracion"]) assert.equal(isAllowedWhenBlocked(path), true, path);
  for (const path of ["/inicio", "/alumnos", "/alumnos/nuevo", "/alumnos/abc", "/calendario", "/calendario/nueva", "/cobros", "/registro", "/registro/xyz", "/recordatorios", "/resumen-financiero", "/configuracion/respaldo", "/configuracion/consistencia", "/configuracion/datos-de-prueba", "/configuracion/tutorial"]) {
    assert.equal(isAllowedWhenBlocked(path), false, path);
  }
  // Variantes que intentan colarse: prefijos parecidos, mayúsculas, rutas con parámetros o con barras dobles.
  for (const path of ["/facturacionx", "/Facturacion", "/configuracionx", "//alumnos", "/suscripcion-pendiente-x", "/inicio/facturacion", "/alumnos/../facturacion"]) assert.equal(isAllowedWhenBlocked(path), false, path);
  assert.equal(BLOCKED_ACCOUNT_HOME, "/suscripcion-pendiente");
  assert.ok((PRIVATE_ROUTE_PREFIXES as readonly string[]).includes(BLOCKED_ACCOUNT_HOME), "el área privada exige sesión también para la pantalla de suscripción pendiente");
});

test("cuenta BLOQUEADA — datos: el servidor no LEE ni ESCRIBE datos operativos; sólo sesión, dispositivo, cuota, eliminar la cuenta, perfil, preferencias, su facturación y borrar/listar archivos", () => {
  const ok = (method: string, path: string) => allowedWhenBlocked({ method, url: `${ORIGIN}${path}`, supabaseOrigin: ORIGIN });
  // Permitido
  for (const [method, path] of [["POST", "/auth/v1/token"], ["GET", "/auth/v1/user"], ["GET", "/rest/v1/teacher_profiles?select=*"], ["GET", "/rest/v1/billing_subscriptions"], ["POST", "/rest/v1/teacher_interaction_preferences"], ["POST", "/rest/v1/rpc/claim_web_device"], ["POST", "/rest/v1/rpc/delete_own_account"], ["DELETE", "/storage/v1/object/lesson-files"], ["POST", "/storage/v1/object/list/lesson-files"]] as const) assert.equal(ok(method, path), true, `${method} ${path}`);
  // Bloqueado: toda lectura y escritura operativa, también las funciones de lectura y la descarga de archivos.
  for (const [method, path] of [["GET", "/rest/v1/students?select=*"], ["GET", "/rest/v1/calendar_lessons"], ["GET", "/rest/v1/payments"], ["POST", "/rest/v1/students"], ["PATCH", "/rest/v1/students"], ["POST", "/rest/v1/rpc/calendar_agenda_stamp"], ["POST", "/rest/v1/rpc/list_open_charge_balances"], ["POST", "/rest/v1/rpc/create_student_with_operation"], ["POST", "/rest/v1/rpc/funcion_nueva_sin_clasificar"], ["POST", "/storage/v1/object/sign/lesson-files/a.png"], ["GET", "/storage/v1/object/lesson-files/a.png"], ["POST", "/storage/v1/object/lesson-files/a.png"], ["GET", "/storage/v1/otra-cosa"]] as const) assert.equal(ok(method, path), false, `${method} ${path}`);
  // Lo que no es de Supabase no es asunto de esta guarda.
  assert.equal(allowedWhenBlocked({ method: "GET", url: "https://otro.example/rest/v1/students", supabaseOrigin: ORIGIN }), true);
  // Las listas son mínimas y se mantienen dentro de lo ya clasificado.
  for (const name of BLOCKED_MODE_RPC) assert.equal(LIMITED_MODE_RPC.has(name), true, `${name} figura también entre las funciones sin datos operativos`);
  assert.deepEqual([...BLOCKED_MODE_WRITE_TABLES], ["teacher_interaction_preferences"]);
  for (const table of BLOCKED_MODE_READ_TABLES) assert.doesNotMatch(table, /student|lesson|payment|charge|report|calendar|recurrence/i, `${table}: no es una tabla operativa`);
});

test("estructura: el proxy corre la compuerta de páginas en cada navegación privada; la pantalla pendiente vuelve a Inicio sola cuando el pago se confirma (sin cerrar sesión ni recargar)", () => {
  const proxy = read("proxy.ts");
  assert.match(proxy, /resolveBlockedRedirect\(\{ userId, pathname \}\)/);
  assert.ok(proxy.indexOf("if (!isPrivatePath(pathname))") < proxy.indexOf("resolveBlockedRedirect({"), "sólo en rutas privadas y después de verificar la sesión");
  const page = read("app/(app)/suscripcion-pendiente/page.tsx");
  assert.match(page, /AccessRestoredRedirect/);
  assert.match(page, /AccessRecoveryWatcher/);
  assert.match(page, /AutoRefresh/);
  const action = read("components/billing/limited-mode-action.tsx");
  assert.match(action, /router\.replace\("\/inicio"\)/);
  assert.doesNotMatch(action, /location\.reload|window\.location/, "nunca se recarga la página");
  const gate = read("lib/billing/page-gate.ts");
  assert.match(gate, /!access\.reason\.startsWith\("state_unavailable"\)/, "con el estado ilegible la navegación no bloquea (decide la guarda de datos)");
  assert.match(gate, /if \(!runtime\.flags\.enforcement \|\| isAllowedWhenBlocked\(input\.pathname\)\) return null;/, "con el control apagado no hace nada");
  const nav = read("components/nav/primary-nav.tsx");
  assert.equal((nav.match(/!restricted && PRIMARY_NAV_ITEMS\.map/g) ?? []).length, 2, "una cuenta bloqueada no ve los destinos operativos (menú del logo y barra lateral)");
  assert.match(nav, /\{!restricted && \(\s*<nav\s+aria-label="Navegación principal"\s+data-tf-bottom-nav/, "ni la barra inferior");
});
