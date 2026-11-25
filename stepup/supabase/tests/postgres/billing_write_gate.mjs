// COMPUERTA DE ESCRITURA EN LA BASE (migración 20261125130000) — prueba en Postgres REAL aislado (embedded-postgres 17, TODAS las migraciones reales, roles y RLS reales).
//
//   NODE_PATH=%TEMP%\epg\node_modules node supabase/tests/postgres/tf_write_gate.mjs
//
// Qué demuestra: con la compuerta ENCENDIDA, una cuenta limitada que habla DIRECTO con la base con su propia sesión (tablas, funciones y archivos) ya no puede escribir;
// las cuentas con acceso, el aislamiento entre cuentas (RLS), las operaciones permitidas (preferencias, sesión, eliminar la propia cuenta) y la recuperación al pagar siguen
// funcionando; el espejo SQL del estado coincide con `projectStatus` de TypeScript sobre una grilla de casos; y TODA tabla escribible está clasificada (con compuerta o exenta).
// Qué NO prueba: el Supabase alojado (no hay Docker ni un proyecto de prueba) ni Production: nada de esto se aplicó allí.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { importLib, makeRpcCaller, uuidFor } from "./billing_pg.mjs";

const require = createRequire(import.meta.url);
const { start } = require("./load.cjs");
console.info = () => {};
console.warn = () => {};
console.error = () => {};

const { RpcBillingStore } = await importLib("billing/rpc-store.ts");
const { projectStatus } = await importLib("billing/ledger.ts");

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok    ${name}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`  FALLA ${name}\n        ${String(error?.message ?? error).split("\n").slice(0, 6).join("\n        ")}`);
  }
};
const blocked = (promise, what) => assert.rejects(promise, (error) => error.code === "TF006" && /modo limitado/.test(error.message), `${what}: debía bloquearse con TF006`);

// Tablas donde una cuenta autenticada puede escribir y que NO llevan compuerta a propósito.
const EXEMPT = new Map([
  ["teacher_interaction_preferences", "preferencias de uso: permitido en modo limitado"],
  ["cloud_backups", "tabla de la app antigua del repositorio original; esta web no la escribe"],
  ["web_device_sessions", "sesión del dispositivo: sin esto no se puede ni entrar"],
  ["active_sessions", "sesión activa (función de la app antigua usada para cerrar sesión)"],
  ["account_action_events", "cuota de acciones: limitador, no es información operativa"],
]);

const pg = await start({ port: 6900 + Math.floor(Math.random() * 300) });
try {
  assert.deepEqual(pg.failures, [], "las migraciones cargan sin errores");
  const admin = pg.admin;
  const svc = await pg.session("", "service_role");
  const store = new RpcBillingStore(await makeRpcCaller(svc));

  const [E, N, P, D, X] = [1, 2, 3, 4, 5].map((n) => uuidFor(9100 + n));
  const old = "now() - interval '30 days'";
  for (const [id, label, created] of [[E, "existente", old], [N, "nueva", "now()"], [P, "paga", "now()"], [D, "borrable", "now()"], [X, "otra", "now()"]]) {
    await admin.query(`insert into auth.users (id, email, created_at) values ($1, $2, ${created})`, [id, `${label}@example.test`]);
    await store.ensureAccount(id);
  }
  const pay = async (owner, tag, days = 30) => {
    const at = new Date().toISOString();
    const until = new Date(Date.now() + days * 86_400_000).toISOString();
    await store.commitBatch({ executions: [{ ownerId: owner, provider: "rebill", executionUid: `exe_gate_${tag}`, providerPaymentId: `pay_gate_${tag}`, outcome: "approved", planCode: "tf_monthly_ars_v2", amountMinor: 2590000, currency: "ARS", dueAt: at, occurredAt: at }], periods: [{ ownerId: owner, provider: "rebill", executionUid: `exe_gate_${tag}`, planCode: "tf_monthly_ars_v2", priceVersion: 2, amountMinor: 2590000, currency: "ARS", periodStart: at, periodEnd: until }], subscriptions: [], reconciliations: [], events: [] });
    await admin.query("update public.billing_subscriptions set status = 'active', plan_code = 'tf_monthly_ars_v2', grandfathered = false, current_period_start = $2, current_period_end = $3, grace_ends_at = $3::timestamptz + interval '5 days', version = version + 1 where owner_id = $1", [owner, at, until]);
  };
  await pay(P, "p1");
  const as = async (uid) => pg.session(uid);
  const student = (label) => ({ name: label, modality: "presencial", category: "otro", billing_type: "por_clase", date_joined: "2026-01-01", price: 1000 });
  const insertStudent = (session, owner, label) => session.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values (gen_random_uuid(), $1, $2, 'presencial', 'otro', 'por_clase', '2026-01-01', 1000)", [owner, label]);
  const rpcStudent = (session, label) => session.query("select * from public.create_student_with_operation(gen_random_uuid(), $1::jsonb, false)", [JSON.stringify({ name: label, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [] })]);
  const setGate = (on) => admin.query("update public.billing_settings set write_gate_enabled = $1", [on]);

  const sE = await as(E), sN = await as(N), sP = await as(P), sD = await as(D), sX = await as(X);

  await step("1. la migración queda aplicada y la compuerta APAGADA por defecto", async () => {
    assert.equal((await admin.query("select write_gate_enabled from public.billing_settings")).rows[0].write_gate_enabled, false);
    const triggers = (await admin.query("select count(*)::int n from pg_trigger where tgname = 'tf_write_gate' and not tgisinternal")).rows[0].n;
    assert.ok(triggers >= 55, `triggers instalados: ${triggers}`);
  });

  await step("2. APAGADA: nada cambia — la cuenta nueva (sin pago) escribe directo y por función como hoy", async () => {
    await insertStudent(sN, N, "directo apagado");
    await rpcStudent(sN, "por función apagado");
    assert.equal((await admin.query("select count(*)::int n from public.students where owner_id = $1", [N])).rows[0].n, 2);
  });

  await setGate(true);

  await step("3. ENCENDIDA: la cuenta limitada NO puede escribir directo (insertar, modificar, borrar) con su propia sesión", async () => {
    await blocked(insertStudent(sN, N, "directo bloqueado"), "INSERT students");
    await blocked(sN.query("update public.students set notes = 'x' where owner_id = $1", [N]), "UPDATE students");
    await assert.rejects(sN.query("delete from public.students where owner_id = $1", [N]), (e) => e.code === "42501" || e.code === "TF006", "DELETE students: sin permiso de tabla o con compuerta"); // students no concede DELETE directo
    await blocked(sN.query("delete from public.custom_levels where owner_id = $1", [N]), "DELETE custom_levels");
    await blocked(sN.query("insert into public.custom_levels (owner_id, name) values ($1, 'B2 bloqueado')", [N]), "INSERT custom_levels");
    assert.equal((await admin.query("select count(*)::int n from public.students where owner_id = $1", [N])).rows[0].n, 2, "no se cambió nada");
  });

  await step("4. ENCENDIDA: tampoco por las FUNCIONES de la base (SECURITY DEFINER pasa por encima de RLS, no del disparador)", async () => {
    await blocked(rpcStudent(sN, "por función bloqueado"), "rpc create_student_with_operation");
    assert.equal((await admin.query("select count(*)::int n from public.students where owner_id = $1", [N])).rows[0].n, 2);
  });

  await step("5. ENCENDIDA: subir o reemplazar archivos de la aplicación también se bloquea; borrar sigue permitido", async () => {
    await assert.rejects(sN.query("insert into storage.objects (bucket_id, name, owner) values ('lesson-files', $1, $2)", [`${N}/a.pdf`, N]), /row-level security/i);
    await admin.query("insert into storage.objects (bucket_id, name, owner) values ('lesson-files', $1, $2)", [`${N}/previo.pdf`, N]);
    await sN.query("delete from storage.objects where bucket_id = 'lesson-files' and name = $1", [`${N}/previo.pdf`]); // eliminar la cuenta limpia sus archivos
    await sP.query("insert into storage.objects (bucket_id, name, owner) values ('lesson-files', $1, $2)", [`${P}/ok.pdf`, P]);
  });

  await step("6. ENCENDIDA: lo permitido en modo limitado sigue funcionando (preferencias, cuota de acciones, lectura propia y exportar)", async () => {
    await sN.query("insert into public.teacher_interaction_preferences (owner_id, live_tracking) values ($1, true)", [N]);
    await sN.query("update public.teacher_interaction_preferences set live_tracking = false where owner_id = $1", [N]);
    assert.equal((await sN.query("select count(*)::int n from public.students")).rows[0].n, 2, "lee lo suyo");
    assert.equal((await sN.query("select count(*)::int n from public.students where owner_id <> $1", [N])).rows[0].n, 0, "no ve lo de otras cuentas");
  });

  await step("7. ENCENDIDA: eliminar la PROPIA cuenta sigue funcionando para una cuenta limitada (la cascada no la frena la compuerta)", async () => {
    await admin.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values (gen_random_uuid(), $1, 'se va con la cuenta', 'presencial', 'otro', 'por_clase', '2026-01-01', 1)", [D]);
    await admin.query("insert into public.custom_levels (owner_id, name) values ($1, 'se va')", [D]);
    await sD.query("select public.delete_own_account()");
    assert.equal((await admin.query("select count(*)::int n from auth.users where id = $1", [D])).rows[0].n, 0);
    assert.equal((await admin.query("select count(*)::int n from public.students where owner_id = $1", [D])).rows[0].n, 0, "se borraron en cascada");
  });

  await step("8. ENCENDIDA: la cuenta existente (grandfathered) y la que pagó escriben igual que siempre, por tabla y por función", async () => {
    for (const [session, owner, label] of [[sE, E, "existente"], [sP, P, "paga"]]) {
      await insertStudent(session, owner, `directo ${label}`);
      await rpcStudent(session, `función ${label}`);
      await session.query("update public.students set notes = 'editado' where owner_id = $1", [owner]);
      await session.query("insert into public.custom_levels (owner_id, name) values ($1, $2)", [owner, `Nivel ${label}`]);
    }
  });

  await step("9. ENCENDIDA: el aislamiento entre cuentas se conserva (RLS): una cuenta con acceso no escribe ni ve filas de otra", async () => {
    await assert.rejects(insertStudent(sP, N, "ajeno"), /row-level security/i, "RLS: no puede crear filas a nombre de otra cuenta");
    assert.equal((await sP.query("select count(*)::int n from public.students where owner_id = $1", [N])).rows[0].n, 0);
    const update = await sP.query("update public.students set notes = 'ajeno' where owner_id = $1", [N]);
    assert.equal(update.rowCount, 0, "RLS: no toca filas de otra cuenta");
  });

  await step("10. ENCENDIDA: los roles que no son `authenticated` (servicio de facturación, administración) no se ven afectados", async () => {
    await svc.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values (gen_random_uuid(), $1, 'por servicio', 'presencial', 'otro', 'por_clase', '2026-01-01', 1)", [N]);
    await admin.query("insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values (gen_random_uuid(), $1, 'por administración', 'presencial', 'otro', 'por_clase', '2026-01-01', 1)", [N]);
  });

  await step("11. RECUPERACIÓN: al registrarse el pago la cuenta limitada vuelve a escribir en el acto (sin caché ni espera)", async () => {
    await blocked(insertStudent(sN, N, "antes de pagar"), "antes del pago");
    await pay(N, "n1");
    await insertStudent(sN, N, "después de pagar");
    await rpcStudent(sN, "función después de pagar");
  });

  await step("12. VENCIMIENTO: al terminar el período y la gracia la cuenta vuelve a quedar bloqueada, y pagar de nuevo la recupera", async () => {
    await admin.query("update public.billing_subscriptions set status = 'expired', current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days', grace_ends_at = now() - interval '5 days', version = version + 1 where owner_id = $1", [N]);
    await blocked(insertStudent(sN, N, "vencida"), "vencida");
    await pay(N, "n2");
    await insertStudent(sN, N, "renovada");
  });

  await step("13. un cambio de estado se refleja en la MISMA conexión ya abierta (nada queda guardado en la sesión)", async () => {
    await admin.query("update public.billing_subscriptions set status = 'expired', current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days', grace_ends_at = now() - interval '5 days', version = version + 1 where owner_id = $1", [N]);
    await blocked(insertStudent(sN, N, "mismo cliente"), "misma conexión");
    await pay(N, "n3");
    await insertStudent(sN, N, "mismo cliente otra vez");
  });

  await step("14. ESPEJO SQL = TypeScript: `tf_write_access` coincide con `projectStatus` en una grilla de casos (fechas en el borde del día civil argentino)", async () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const iso = (v) => (v ? new Date(v).toISOString() : null); // mismo formato que guarda la base (con milisegundos): la comparación de texto de TypeScript lo exige
    const ends = [null, "2026-12-05T03:00:00Z", "2026-11-20T10:00:00Z", "2026-11-19T10:00:00Z", "2026-11-23T15:20:00Z", "2026-11-18T15:20:00Z", "2026-11-25T02:59:59Z", "2026-11-25T12:00:00Z"].map(iso);
    const graces = [null, "2026-11-30T03:00:00Z", "2026-11-22T03:00:00Z"].map(iso);
    const cancels = [null, "2026-11-01T10:00:00Z", "2026-12-01T10:00:00Z"].map(iso);
    const restarts = [null, "2026-11-10T00:00:00Z", "2026-12-20T00:00:00Z"].map(iso);
    const chargebacks = [null, "2026-11-24T00:00:00Z", "2026-12-24T00:00:00Z"].map(iso);
    let n = 0;
    await admin.query("set session_replication_role = replica"); // sólo para sembrar casos: sin los disparadores de coherencia de facturación
    try {
      for (const grandfathered of [true, false]) for (const end of ends) for (const grace of graces) for (const cancel of cancels) for (const providerEnded of [null, iso("2026-11-24T10:00:00Z")]) for (const restart of restarts) for (const chargeback of chargebacks) {
        if (end === null && (grace || restart || chargeback)) continue; // sin período esos datos no existen
        const owner = uuidFor(100000 + n);
        await admin.query("insert into auth.users (id, email, created_at) values ($1, $2, now())", [owner, `grid${n}@example.test`]);
        const start = end ? new Date(Date.parse(end) - 30 * 86_400_000).toISOString() : null;
        await admin.query(
          "insert into public.billing_subscriptions (owner_id, status, grandfathered, provider_reference, current_period_start, current_period_end, grace_ends_at, cancel_requested_at, provider_ended_at, restarted_at, chargeback_at) values ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [owner, grandfathered, `tfs_${String(n).padStart(32, "0")}`, start, end, grace, cancel, providerEnded, restart, chargeback],
        );
        const sql = (await admin.query("select public.tf_write_access($1, $2::timestamptz) as ok", [owner, now.toISOString()])).rows[0].ok;
        const status = projectStatus({ grandfathered, currentPeriodEnd: end, renewalRejectedDueAt: null, graceEndsAt: grace, cancelRequestedAt: cancel, providerEndedAt: providerEnded, restartedAt: restart, chargebackAt: chargeback }, now);
        const ts = ["grandfathered", "active", "past_due", "grace_period", "cancel_at_period_end"].includes(status);
        assert.equal(sql, ts, `caso ${JSON.stringify({ grandfathered, end, grace, cancel, providerEnded, restart, chargeback })}: SQL=${sql} TS=${status}`);
        n += 1;
      }
    } finally {
      await admin.query("set session_replication_role = origin");
    }
    assert.ok(n > 1000, `casos comparados: ${n}`);
    console.log(`        (${n} casos comparados, sin diferencias)`);
  });

  await step("15. cuenta sin fila de suscripción: misma regla que `billing_ensure_account` (anterior al corte escribe; posterior no); sin dueño no escribe", async () => {
    const [oldId, newId] = [uuidFor(300001), uuidFor(300002)];
    await admin.query("insert into auth.users (id, email, created_at) values ($1, 'viejo@example.test', now() - interval '60 days'), ($2, 'reciente@example.test', now() + interval '1 hour')", [oldId, newId]);
    assert.equal((await admin.query("select public.tf_write_access($1) a, public.tf_write_access($2) b, public.tf_write_access(null) c", [oldId, newId])).rows[0].a, true);
    const row = (await admin.query("select public.tf_write_access($1) a, public.tf_write_access($2) b, public.tf_write_access(null) c", [oldId, newId])).rows[0];
    assert.deepEqual([row.b, row.c], [false, false]);
  });

  await step("16. COBERTURA: toda tabla donde una cuenta puede escribir (permiso directo o función de escritura de la web) está con compuerta o EXENTA con motivo", async () => {
    const guardSrc = readFileSync(new URL("../../../lib/billing/write-guard.ts", import.meta.url), "utf8");
    const writeRpc = [...guardSrc.match(/export const WRITE_RPC[\s\S]*?\]\);/)[0].matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
    const rows = (await admin.query("select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'")).rows;
    const defs = new Map();
    for (const r of rows) defs.set(r.proname, `${defs.get(r.proname) ?? ""}\n${r.def}`);
    const tables = new Set((await admin.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')")).rows.map((r) => r.relname));
    const WRITE = /\b(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi;
    const fnNames = [...defs.keys()];
    const memo = new Map();
    const targets = (name, seen = new Set()) => {
      if (memo.has(name)) return memo.get(name);
      if (seen.has(name)) return new Set();
      seen.add(name);
      const def = (defs.get(name) ?? "").replace(/--[^\n]*/g, "");
      const out = new Set([...def.matchAll(WRITE)].map((m) => m[1].toLowerCase()).filter((t) => tables.has(t)));
      for (const other of fnNames) if (other !== name && new RegExp(`\\b${other}\\s*\\(`).test(def)) for (const t of targets(other, seen)) out.add(t);
      memo.set(name, out);
      return out;
    };
    for (const fn of writeRpc) assert.ok(defs.has(fn), `WRITE_RPC ${fn} existe en la base`);
    const dynamic = writeRpc.filter((fn) => /execute\s+(?:format\s*\()?[^;]*\b(?:insert|update|delete)\b/i.test(defs.get(fn).replace(/--[^\n]*/g, "")));
    // Conocidas (el análisis estático no ve su destino exacto): `apply_financial_reconciliation` (sólo `for update` dinámico), `apply_undo_backup_import` y
    // `delete_student_permanently` (borran de listas de tablas). Una función NUEVA con escritura dinámica obliga a revisarla acá.
    assert.deepEqual([...dynamic].sort(), ["apply_financial_reconciliation", "apply_undo_backup_import", "delete_student_permanently"], "funciones con SQL dinámico conocidas");

    const reachable = new Set(writeRpc.flatMap((fn) => [...targets(fn)]));
    const granted = (await admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and (has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE') or has_table_privilege('authenticated', c.oid, 'DELETE') or exists (select 1 from information_schema.column_privileges cp where cp.table_schema = 'public' and cp.table_name = c.relname and cp.grantee = 'authenticated' and cp.privilege_type in ('INSERT','UPDATE')))`)).rows.map((r) => r.relname);
    const gated = new Set((await admin.query("select c.relname from pg_trigger tg join pg_class c on c.oid = tg.tgrelid where tg.tgname = 'tf_write_gate' and not tg.tgisinternal")).rows.map((r) => r.relname));
    const writable = new Set([...reachable, ...granted]);
    const missing = [...writable].filter((t) => !gated.has(t) && !EXEMPT.has(t)).sort();
    assert.deepEqual(missing, [], `tablas escribibles sin compuerta ni exención: ${missing.join(", ")}`);
    const pointless = [...gated].filter((t) => !writable.has(t)).sort();
    assert.deepEqual(pointless, [], `tablas con compuerta que nadie puede escribir (lista de más): ${pointless.join(", ")}`);
    // Escritura dinámica: todo nombre de tabla que la función menciona (listas de tablas, tablas del respaldo) debe tener compuerta o estar exento.
    for (const fn of dynamic) {
      const mentioned = [...new Set([...defs.get(fn).replace(/--[^\n]*/g, "").matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]).filter((name) => tables.has(name)))];
      const loose = mentioned.filter((name) => !gated.has(name) && !EXEMPT.has(name));
      assert.deepEqual(loose, [], `${fn}: tablas que menciona sin compuerta ni exención`);
      assert.ok([...targets(fn)].some((name) => gated.has(name)), `${fn} también escribe en alguna tabla con compuerta de forma estática (todo el llamado se revierte para una cuenta limitada)`);
    }
    const exemptButGated = [...EXEMPT.keys()].filter((t) => gated.has(t));
    assert.deepEqual(exemptButGated, [], "una tabla exenta no lleva compuerta");
    console.log(`        (tablas escribibles: ${writable.size} · con compuerta: ${gated.size} · exentas: ${[...EXEMPT.keys()].filter((t) => writable.has(t)).length})`);
  });

  await step("17. APAGAR de nuevo devuelve el comportamiento anterior (reversión inmediata, sin tocar datos ni funciones)", async () => {
    await admin.query("update public.billing_subscriptions set status = 'expired', current_period_start = now() - interval '40 days', current_period_end = now() - interval '10 days', grace_ends_at = now() - interval '5 days', version = version + 1 where owner_id = $1", [N]);
    await blocked(insertStudent(sN, N, "encendida"), "encendida");
    await setGate(false);
    await insertStudent(sN, N, "apagada otra vez");
    await setGate(true);
  });

  await step("18. un usuario autenticado NO puede ejecutar la función de estado con un dueño ajeno ni apagar la compuerta", async () => {
    await assert.rejects(sP.query("select public.tf_write_access($1)", [N]), /permission denied/i);
    await assert.rejects(sP.query("update public.billing_settings set write_gate_enabled = false"), /permission denied/i);
    assert.equal((await sP.query("select public.tf_can_write() as ok")).rows[0].ok, true, "sólo informa su propio estado");
    assert.equal((await sX.query("select public.tf_can_write() as ok")).rows[0].ok, false, "otra cuenta sin pago: false");
  });
} finally {
  await pg.stop();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nCOMPUERTA DE ESCRITURA (aislada): ${results.length - failed.length}/${results.length} pasos ok`);
process.exit(failed.length ? 1 : 0);
