// Sesión por dispositivo CONTRA LAS FUNCIONES REALES de la base (transfer / touch / end_active_session) con la misma decisión que usa la web (`resolveDeviceAccess`). Postgres REAL, datos SINTÉTICOS.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/device_session_rpcs.cjs
//
// Modela un NAVEGADOR como un «frasco de cookies» compartido por sus pestañas y cada pestaña como una conexión propia. Cubre: dos pestañas del mismo navegador (ninguna expulsa a la otra, también si se
// autorizan a la vez), dos navegadores (el segundo pide confirmación, el primero queda cerrado y no vuelve a entrar solo), carrera entre dos navegadores, vencimiento y reautorización, cierre voluntario
// que libera el lugar sin borrar la sesión de quien lo reemplazó, renovación sólo del dispositivo activo y que un error de lectura no se confunda con «autorizado» ni con «cerrado».
const { pathToFileURL } = require("url");
const path = require("path");
const { start } = require("./load.cjs");

const A = "fb000000-0000-0000-0000-000000000001";
const B = "fb000000-0000-0000-0000-000000000002";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function main() {
  const decision = await import(pathToFileURL(path.join(__dirname, "..", "..", "..", "lib", "auth", "device-session", "decision.ts")).href);
  const { resolveDeviceAccess, serializeDeviceCookie, parseDeviceCookie, generateDeviceId } = decision;
  const pg = await start({ port: 5774 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await admin.query("delete from public.active_sessions");
    await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await admin.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);

    const rowOf = async (owner) => {
      const { rows } = await admin.query("select user_id, device_id, generation, expires_at from public.active_sessions where user_id = $1", [owner]);
      return rows[0] ? { userId: rows[0].user_id, deviceId: rows[0].device_id, generation: Number(rows[0].generation), authorizedAt: new Date().toISOString(), expiresAt: new Date(rows[0].expires_at).toISOString(), lastSeenAt: new Date().toISOString() } : null;
    };
    // Un navegador: su frasco de cookies lo comparten TODAS sus pestañas.
    const browser = () => ({ cookie: null, tabs: [] });
    const openTab = async (b, owner) => {
      const tab = await pg.session(owner);
      b.tabs.push(tab);
      return tab;
    };
    const access = async (b, owner) => resolveDeviceAccess({ cookieValue: b.cookie, serverRow: await rowOf(owner), now: new Date() }).kind;
    // Autorizar desde UNA pestaña: lo mismo que `claimThisDevice` (reusa el identificador de la cookie o crea uno; guarda la generación recibida).
    const claim = async (b, tab) => {
      const deviceId = parseDeviceCookie(b.cookie)?.deviceId ?? generateDeviceId();
      const { rows } = await tab.query("select * from public.transfer_active_session($1)", [deviceId]);
      b.cookie = serializeDeviceCookie({ deviceId, generation: Number(rows[0].generation) });
      return Number(rows[0].generation);
    };

    // ---- 1) Dos pestañas del mismo navegador
    const b1 = browser();
    const t1a = await openTab(b1, A);
    const t1b = await openTab(b1, A);
    check("primer ingreso: sin nadie autorizado el navegador se autoriza solo", (await access(b1, A)) === "claim");
    const g1 = await claim(b1, t1a);
    check("tras autorizar, ambas pestañas ven «autorizado»", g1 === 1 && (await access(b1, A)) === "authorized");
    const g1b = await claim(b1, t1b);
    check("la segunda pestaña se autoriza otra vez: la generación NO cambia (no se expulsa a sí misma)", g1b === 1 && (await access(b1, A)) === "authorized", `g=${g1b}`);

    // Dos pestañas autorizándose A LA VEZ desde cero.
    await admin.query("delete from public.active_sessions where user_id = $1", [A]);
    const b1c = browser();
    const [ta, tb] = [await openTab(b1c, A), await openTab(b1c, A)];
    const deviceId = generateDeviceId();
    const [ra, rb] = await Promise.all([ta.query("select * from public.transfer_active_session($1)", [deviceId]), tb.query("select * from public.transfer_active_session($1)", [deviceId])]);
    b1c.cookie = serializeDeviceCookie({ deviceId, generation: Number(rb.rows[0].generation) });
    check("dos pestañas que se autorizan a la vez dejan UNA sola fila y la misma generación", Number(ra.rows[0].generation) === Number(rb.rows[0].generation) && Number((await admin.query("select count(*) from public.active_sessions where user_id = $1", [A])).rows[0].count) === 1);
    check("…y las dos quedan autorizadas (sin bucle de «Tu cuenta se abrió en otro dispositivo»)", (await access(b1c, A)) === "authorized");

    // ---- 2) Dos navegadores
    await admin.query("delete from public.active_sessions where user_id = $1", [A]);
    const bx = browser();
    const bxTab1 = await openTab(bx, A);
    const bxTab2 = await openTab(bx, A);
    await claim(bx, bxTab1);
    const by = browser();
    const byTab1 = await openTab(by, A);
    const byTab2 = await openTab(by, A);
    check("un segundo navegador (sin cookie) pide CONFIRMACIÓN antes de cerrar al primero", (await access(by, A)) === "confirm-transfer");
    const gy = await claim(by, byTab1);
    check("al confirmar, el segundo queda autorizado con la generación siguiente", gy === 2 && (await access(by, A)) === "authorized");
    check("el primero queda cerrado («Tu cuenta se abrió en otro dispositivo») en TODAS sus pestañas", (await access(bx, A)) === "taken-elsewhere");
    check("sus pestañas no se recuperan solas: seguir tocando la base no lo reautoriza", (await bxTab2.query("select * from public.touch_active_session($1)", [parseDeviceCookie(bx.cookie).deviceId])).rows[0].is_current_device === false && (await access(bx, A)) === "taken-elsewhere");
    check("el segundo navegador sigue autorizado en todas sus pestañas", (await access(by, A)) === "authorized" && byTab2 !== null);

    // El primero vuelve a usarlo a propósito: lo transfiere de nuevo.
    const gx = await claim(bx, bxTab1);
    check("volver a usar el primero lo transfiere de nuevo (generación 3) y cierra al segundo", gx === 3 && (await access(bx, A)) === "authorized" && (await access(by, A)) === "taken-elsewhere");

    // ---- 3) Carrera entre dos navegadores
    const bz = browser();
    const bzTab = await openTab(bz, A);
    const bw = browser();
    const bwTab = await openTab(bw, A);
    const dz = generateDeviceId();
    const dw = generateDeviceId();
    const [rz, rw] = await Promise.all([bzTab.query("select * from public.transfer_active_session($1)", [dz]), bwTab.query("select * from public.transfer_active_session($1)", [dw])]);
    bz.cookie = serializeDeviceCookie({ deviceId: dz, generation: Number(rz.rows[0].generation) });
    bw.cookie = serializeDeviceCookie({ deviceId: dw, generation: Number(rw.rows[0].generation) });
    const kinds = [await access(bz, A), await access(bw, A)].sort();
    check("dos navegadores que se autorizan a la vez: exactamente UNO queda autorizado y el otro cerrado (nadie queda sin acceso ni con los dos)", kinds[0] === "authorized" && kinds[1] === "taken-elsewhere", kinds.join(","));
    check("…y la base conserva UNA sola fila de la cuenta", Number((await admin.query("select count(*) from public.active_sessions where user_id = $1", [A])).rows[0].count) === 1);

    // ---- 4) Renovación: sólo el dispositivo activo extiende su vencimiento
    const active = (await access(bz, A)) === "authorized" ? { b: bz, tab: bzTab, id: dz } : { b: bw, tab: bwTab, id: dw };
    const stale = active.b === bz ? { b: bw, tab: bwTab, id: dw } : { b: bz, tab: bzTab, id: dz };
    await admin.query("update public.active_sessions set expires_at = now() + interval '1 hour' where user_id = $1", [A]);
    const staleTouch = (await stale.tab.query("select * from public.touch_active_session($1)", [stale.id])).rows[0];
    const afterStale = await rowOf(A);
    check("un dispositivo cerrado que «renueva» NO extiende el vencimiento ni cambia la fila", staleTouch.is_current_device === false && new Date(afterStale.expiresAt).getTime() < Date.now() + 2 * 3600 * 1000 && afterStale.deviceId === active.id);
    const activeTouch = (await active.tab.query("select * from public.touch_active_session($1)", [active.id])).rows[0];
    check("el dispositivo activo que renueva vuelve a tener 24 h", activeTouch.is_current_device === true && new Date(activeTouch.expires_at).getTime() > Date.now() + 23 * 3600 * 1000);

    // ---- 5) Vencimiento y reautorización
    await admin.query("update public.active_sessions set expires_at = now() - interval '1 minute' where user_id = $1", [A]);
    check("sin actividad 24 h el dispositivo deja de estar autorizado y se reautoriza solo (claim)", (await access(active.b, A)) === "claim");
    const regen = await claim(active.b, active.tab);
    check("al reautorizarse el mismo navegador conserva su generación (no expulsa a otras pestañas suyas)", regen === parseDeviceCookie(active.b.cookie).generation && (await access(active.b, A)) === "authorized");

    // ---- 6) Cierre voluntario
    const cookieBefore = parseDeviceCookie(stale.b.cookie);
    await stale.tab.query("select public.end_active_session($1, $2)", [cookieBefore.deviceId, cookieBefore.generation]);
    check("un dispositivo viejo que cierra sesión NUNCA borra la sesión de quien lo reemplazó", (await access(active.b, A)) === "authorized");
    const cur = parseDeviceCookie(active.b.cookie);
    await active.tab.query("select public.end_active_session($1, $2)", [cur.deviceId, cur.generation]);
    check("el dispositivo activo que cierra sesión libera el lugar", (await rowOf(A)) === null);
    check("…y otro navegador entra SIN pedir confirmación", (await access(browser(), A)) === "claim" && (await access(stale.b, A)) === "claim");

    // ---- 7) Cookies inválidas y dispositivos de otra cuenta
    const forged = browser();
    forged.cookie = "web-" + "x".repeat(10) + ".1";
    const ownerB = browser();
    const ownerBTab = await openTab(ownerB, B);
    await claim(ownerB, ownerBTab);
    check("una cuenta no ve ni afecta la sesión de otra", (await rowOf(A)) === null && (await rowOf(B)) !== null);
    await claim(forged, await openTab(forged, A));
    const other = browser();
    other.cookie = forged.cookie;
    check("la cookie de un navegador no autoriza a otra cuenta", (await access(other, B)) === "taken-elsewhere");
    check("una cookie mal formada nunca está autorizada", resolveDeviceAccess({ cookieValue: "basura", serverRow: await rowOf(A), now: new Date() }).kind !== "authorized");

    // ---- 8) Interruptor de emergencia: sin tocar datos
    const before = JSON.stringify(await rowOf(A));
    check("DEVICE_SESSION_ENFORCEMENT=off desactiva el control y no escribe nada en la base", decision.isDeviceSessionEnforced({ DEVICE_SESSION_ENFORCEMENT: "off" }) === false && decision.isDeviceSessionEnforced({}) === true && JSON.stringify(await rowOf(A)) === before);
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones correctas`);
  if (failures.length) {
    console.log("FALLAS:\n- " + failures.join("\n- "));
    process.exit(1);
  }
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
