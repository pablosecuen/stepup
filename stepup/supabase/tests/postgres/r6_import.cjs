// R6 — Batería de la importación grande en Postgres REAL (varias conexiones), con datos SINTÉTICOS. Nunca toca Production.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules                 (embedded-postgres 17.x: la misma versión mayor que Production)
//   node supabase/tests/postgres/r6_import.cjs               (batería completa)
//   node supabase/tests/postgres/r6_import.cjs --mutations  (rompe a propósito cada garantía; cada mutación debe ser detectada)
//
// Cubre: límites (−1 / exacto / +1), vacía / mínima / normal / máxima, muchos alumnos con muchas relaciones, duplicados y conflictos, referencias faltantes
// y cruzadas, dos propietarias en paralelo, dos importaciones simultáneas de la misma propietaria, respuesta perdida y reintento, error / timeout / corte a
// mitad de la aplicación, deshacer completo y bloqueado, revisión vencida, cuotas de R3 al previsualizar y al aplicar, purga de R4, huellas y cero residuos.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("./load.cjs");
const { generateBackup, emptyBackup, student, countedRows, nestedRows, workUnits } = require("./r6_dataset.cjs");
const { OWNER, uuid, scenarioDuplicatesAndConflicts, scenarioSingletons } = require("./r6_scenarios.cjs");

const A = OWNER;
const B = uuid(0xb2);
// Los límites ESPERADOS (los mismos de lib/backup/limits.ts): las pruebas generan datos con estos números, nunca con lo que diga la base (una base con un
// límite mal puesto no puede hacer que la prueba intente armar un respaldo de cien millones de filas).
const LIM = { max_payload_bytes: 20971520, max_rows_per_collection: 5000, max_rows_total: 7500, max_nested_rows: 7500, max_work_units: 7500, max_field_overrides: 2000, max_duplicate_decisions: 2000 };
const MUTATIONS = process.argv.includes("--mutations");
const QUICK = MUTATIONS; // las mutaciones corren el subconjunto que prueba lo que se rompe

let failures = [];
let total = 0;
const seenErrors = [];
function check(name, cond, detail = "") {
  total += 1;
  const ok = Boolean(cond);
  if (!ok) failures.push(`${name}${detail ? " → " + detail : ""}`);
  if (!MUTATIONS) console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`);
}
async function fails(fn, pattern, name) {
  try {
    await fn();
    check(name, false, "no falló");
    return null;
  } catch (e) {
    seenErrors.push(String(e.message));
    check(name, pattern.test(String(e.message)) || pattern.test(String(e.code)), `${e.code} ${String(e.message).slice(0, 140)}`);
    return e;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------
async function mkOwner(admin, id) {
  await admin.query(`insert into auth.users (id, email) values ($1, $2) on conflict do nothing`, [id, `${id}@example.invalid`]);
}
async function reset(admin) {
  for (const id of [A, B]) await admin.query(`delete from auth.users where id = $1`, [id]);
  await admin.query(`delete from public.account_quota_overrides`).catch(() => {});
  await mkOwner(admin, A);
  await mkOwner(admin, B);
}
let ownerTables = null;
async function tablesOf(admin) {
  if (!ownerTables) ownerTables = (await admin.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'owner_id' order by 1`)).rows.map((r) => r.table_name);
  return ownerTables;
}
/** Huella de TODO lo que la cuenta tiene en la base (conteo + hash de cada tabla con owner_id, sin updated_at) y de sus instantáneas. */
async function fp(admin, uid, { business = false } = {}) {
  const out = {};
  for (const t of await tablesOf(admin)) {
    if (business && /^(import_|account_quota|action_quota|student_creation|report_)/.test(t)) continue;
    const r = await admin.query(
      `select count(*)::int n, md5(coalesce(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by (to_jsonb(x) - 'updated_at')::text), '')) h from public.${t} x where owner_id = $1`,
      [uid]
    );
    out[t] = `${r.rows[0].n}:${r.rows[0].h}`;
  }
  if (!business) out.snapshots = (await admin.query(`select count(*)::int n from public.import_run_row_snapshots s join public.import_runs r on r.id = s.import_run_id where r.owner_id = $1`, [uid])).rows[0].n;
  return out;
}
function sameFp(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function diffFp(a, b) {
  return Object.keys(a).filter((k) => a[k] !== b[k]).join(", ");
}
async function count(admin, table, uid) {
  return (await admin.query(`select count(*)::int n from public.${table} where owner_id = $1`, [uid])).rows[0].n;
}
async function advisoryLocks(admin) {
  return (await admin.query(`select count(*)::int n from pg_locks where locktype = 'advisory'`)).rows[0].n;
}
async function previewOf(s, backup, excluded = {}) {
  return (await s.query(`select * from public.preview_backup_import($1::jsonb, $2::jsonb)`, [JSON.stringify(backup), JSON.stringify(excluded)])).rows[0];
}
async function applyOf(s, previewId, overrides = [], decisions = []) {
  return (await s.query(`select * from public.apply_backup_import($1::uuid, $2::jsonb, $3::jsonb)`, [previewId, JSON.stringify(overrides), JSON.stringify(decisions)])).rows[0];
}
async function undoPreviewOf(s, runId) {
  return (await s.query(`select * from public.preview_undo_backup_import($1::uuid)`, [runId])).rows[0];
}
async function undoApplyOf(s, undoPreviewId) {
  return (await s.query(`select * from public.apply_undo_backup_import($1::uuid)`, [undoPreviewId])).rows[0];
}
async function timed(fn) {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}
/** Sesión con el mismo tope que la API de Production para el rol `authenticated`. */
async function apiSession(pg, uid, timeoutMs = 8000) {
  const s = await pg.session(uid);
  await s.query(`set statement_timeout = ${timeoutMs}`);
  return s;
}
/** Mayor `n` del generador cuyo respaldo cabe en el máximo de trabajo (búsqueda binaria; el generador es barato). */
function largestWithin(limitUnits, opts) {
  let lo = 100;
  let hi = 20000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (workUnits(generateBackup(mid, opts)) <= limitUnits) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function items(n, prefix = "x") {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------------------------------------------------
async function sectionStatic(pg) {
  const admin = pg.admin;
  const dir = path.join(__dirname, "..", "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => /^20261010\d{6}_r6_/.test(f)).sort();
  const stripped = (f) => fs.readFileSync(path.join(dir, f), "utf8").replace(/--.*$/gm, "").replace(/drop table if exists _\w+/gi, "");
  check("R6: 4 migraciones nuevas y aditivas (sólo funciones nuevas o redefinidas con la misma firma: ningún drop, truncate ni alter de tablas)", files.length === 4 && files.every((f) => !/(drop|truncate)|alter\s+table/i.test(stripped(f))), files.join(","));
  const sqlAll = files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  check("R6: ningún aviso ni log con datos (raise notice / log / warning)", !/raise\s+(notice|log|warning|info|debug)/i.test(sqlAll));
  const rows = (await admin.query(`
    select p.proname, p.prosecdef, coalesce(p.proconfig @> array['search_path=""'], false) as empty_path,
           has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\\_import\\_%'`)).rows;
  check("R6: hay funciones internas nuevas _import_*", rows.length >= 25, String(rows.length));
  check("R6: ninguna función interna nueva es ejecutable por la API (anon ni authenticated)", rows.every((r) => !r.anon_x && !r.auth_x), rows.filter((r) => r.anon_x || r.auth_x).map((r) => r.proname).join(","));
  check("R6: las internas de escritura son SECURITY DEFINER con search_path vacío", rows.filter((r) => r.prosecdef).every((r) => r.empty_path), rows.filter((r) => r.prosecdef && !r.empty_path).map((r) => r.proname).join(","));
  const pub = (await admin.query(`
    select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_x, has_function_privilege('authenticated', p.oid, 'execute') as auth_x, p.prosecdef
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('preview_backup_import','apply_backup_import','preview_undo_backup_import','apply_undo_backup_import','discard_import_undo','fetch_own_latest_cloud_backup')`)).rows;
  check("R6: las 6 RPC públicas conservan sus privilegios (authenticated sí, anon no) y SECURITY DEFINER", pub.length === 6 && pub.every((r) => r.auth_x && !r.anon_x && r.prosecdef));
  const sig = (await admin.query(`select pg_get_function_identity_arguments(p.oid) a, pg_get_function_result(p.oid) r from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'apply_backup_import'`)).rows[0];
  check("R6: apply_backup_import conserva firma y resultado (compatibilidad con la web ya desplegada)", sig.a === "p_preview_id uuid, p_field_overrides jsonb, p_duplicate_decisions jsonb" && sig.r === "TABLE(import_run_id uuid, summary jsonb)", `${sig.a} / ${sig.r}`);
  const reg = (await admin.query(`select parent_table || '.' || child_table || '.' || fk_column k from public.import_undo_dependency_registry order by 1`)).rows.map((r) => r.k);
  const rel = (await admin.query(`select parent_table || '.' || child_table || '.' || fk_column k from public._import_undo_relations() order by 1`)).rows.map((r) => r.k);
  const special = ["students.report_draft_claims.student_id", "lesson_registrations.lesson_registration_edit_history.lesson_registration_id"];
  check("R6: las relaciones del deshacer nuevo = el registro auditado de dependencias (menos las dos que se tratan aparte)", JSON.stringify(reg.filter((k) => !special.includes(k))) === JSON.stringify(rel), `${reg.length} vs ${rel.length}`);
}

async function sectionLimits(pg) {
  const admin = pg.admin;
  await reset(admin);
  const lim = LIM;
  const dbLim = (await admin.query(`select public._import_limits() as l`)).rows[0].l;
  check("límites: la base tiene EXACTAMENTE los límites documentados (iguales a los de la web)", JSON.stringify(Object.entries(dbLim).sort()) === JSON.stringify(Object.entries(LIM).sort()), JSON.stringify(dbLim));
  const call = (payload) => admin.query(`select public._import_check_payload($1::jsonb) as r`, [JSON.stringify(payload)]);
  const okAt = async (payload, name) => { try { const r = (await call(payload)).rows[0].r; check(name, true); return r; } catch (e) { check(name, false, e.message); return null; } };
  const rejects = (payload, name, re = /demasiados datos para importar de una vez/) => fails(() => call(payload), re, name);

  // Por colección
  let b = emptyBackup();
  b.students = items(lim.max_rows_per_collection);
  await okAt(b, `límite por colección: exactamente ${lim.max_rows_per_collection} alumnos entra`);
  b.students = items(lim.max_rows_per_collection + 1);
  await rejects(b, `límite por colección: ${lim.max_rows_per_collection + 1} alumnos se rechaza`);

  // Filas contadas (varias colecciones, cada una por debajo del tope por colección)
  const perColl = lim.max_rows_per_collection;
  const fill = (total) => {
    const bb = emptyBackup();
    const keys = ["students", "calendarLessons", "payments", "paymentCharges", "customLevels"];
    let left = total;
    for (const k of keys) { const n = Math.min(perColl, left); bb[k] = items(n, k[0]); left -= n; }
    return bb;
  };
  await okAt(fill(lim.max_rows_total), `límite de filas contadas: exactamente ${lim.max_rows_total} entra`);
  await rejects(fill(lim.max_rows_total + 1), `límite de filas contadas: ${lim.max_rows_total + 1} se rechaza`);

  // Filas anidadas: un único registro con roster enorme (la cuenta contada es mínima)
  const nestedDoc = (n) => { const bb = emptyBackup(); bb.profiles = { p1: { id: "p1", levelHistory: Array.from({ length: n }, (_, i) => ({ id: `lh${i}` })) } }; return bb; };
  await okAt(nestedDoc(lim.max_nested_rows), `límite de filas anidadas: exactamente ${lim.max_nested_rows} entra`);
  await rejects(nestedDoc(lim.max_nested_rows + 1), `límite de filas anidadas: ${lim.max_nested_rows + 1} se rechaza`);

  // Trabajo total (contadas + anidadas) cuando ninguna de las dos pasa sola
  const workDoc = (counted, nested) => { const bb = nestedDoc(nested); bb.students = items(counted); return bb; };
  const half = Math.floor(lim.max_work_units / 2);
  await okAt(workDoc(half, lim.max_work_units - half - 1), `límite de trabajo: ${lim.max_work_units - 1} unidades entra`);
  await okAt(workDoc(half, lim.max_work_units - half), `límite de trabajo: exactamente ${lim.max_work_units} unidades entra`);
  await rejects(workDoc(half, lim.max_work_units - half + 1), `límite de trabajo: ${lim.max_work_units + 1} unidades se rechaza`);

  // El mismo rechazo por la vista previa real (la RPC controla los límites aunque el cliente no lo haya hecho) y sin dejar nada
  {
    const sv = await apiSession(pg, A, 20000);
    const over = emptyBackup(); over.students = items(lim.max_rows_per_collection + 1);
    const fpv = await fp(admin, A);
    await fails(() => previewOf(sv, over), /demasiados datos para importar de una vez/, "límites: la vista previa de la base rechaza una colección que pasa el máximo");
    const overTotal = fill(lim.max_rows_total + 1);
    await fails(() => previewOf(sv, overTotal), /demasiados datos para importar de una vez/, "límites: la vista previa de la base rechaza el exceso de filas totales");
    check("límites: los rechazos de la vista previa no dejan nada", sameFp(fpv, await fp(admin, A)));
    await sv.end();
  }

  // Forma
  const bad = emptyBackup(); bad.payments = {};
  await rejects(bad, "forma: una colección que no es lista se rechaza", /no tiene el formato esperado/);
  const noId = emptyBackup(); noId.students = [{ name: "sin id" }];
  await rejects(noId, "forma: un elemento sin id se rechaza", /no tiene el formato esperado/);
  const noRef = emptyBackup(); noRef.paymentAllocations = [{ id: "a1" }];
  await rejects(noRef, "forma: una asignación sin pago ni cobro se rechaza", /no tiene el formato esperado/);

  // Tamaño en bytes: pasa por la vista previa real (el tamaño se mide sobre el jsonb recibido) y no deja nada si se rechaza
  const s = await apiSession(pg, A, 60000);
  const before = await fp(admin, A);
  const big = (chars, n) => { const bb = emptyBackup(); bb.students = Array.from({ length: n }, (_, i) => student(`g${i}`, { notes: "ñ".repeat(chars) })); return bb; };
  const tooBig = big(5000, 2200); // ≈ 22 MB de JSON
  const e = await fails(() => previewOf(s, tooBig), /supera el tamaño máximo/, "tamaño: un respaldo de ≈ 22 MB se rechaza al previsualizar");
  void e;
  check("tamaño: el rechazo no deja ninguna fila ni huella (cero residuos)", sameFp(before, await fp(admin, A)), diffFp(before, await fp(admin, A)));
  const t = await timed(() => fails(() => previewOf(s, tooBig), /supera el tamaño máximo/, "tamaño: se rechaza también en el segundo intento"));
  check("tamaño: el rechazo es inmediato (no procesa nada)", t.ms < 6000, `${t.ms} ms`);
  const justUnder = big(4500, 2000); // ≈ 18–19 MB, 2.000 alumnos
  const sizeJson = Buffer.byteLength(JSON.stringify(justUnder));
  const under = await timed(() => previewOf(s, justUnder));
  check(`tamaño: un respaldo de ${(sizeJson / 1048576).toFixed(1)} MB (por debajo del tope) se previsualiza dentro del presupuesto`, !!under.value.preview_id && under.ms < 5000, `${under.ms} ms`);
  const applyBig = await timed(() => applyOf(s, under.value.preview_id));
  check("tamaño: y se aplica dentro del tope de 8 s de la API", applyBig.value.summary.total_rows_written === 2000 && applyBig.ms < 8000, `${applyBig.value.summary.total_rows_written} filas, ${applyBig.ms} ms`);
  await s.end();
  await reset(admin);

  // Decisiones: demasiadas se rechazan ANTES de preparar nada
  const s2 = await apiSession(pg, A);
  const pv = await previewOf(s2, (() => { const bb = emptyBackup(); bb.students = [student("d1")]; return bb; })());
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ table_name: "students", row_id: uuid(1000 + i), fields: ["name"] }));
  const fpBefore = await fp(admin, A);
  await fails(() => applyOf(s2, pv.preview_id, mk(lim.max_field_overrides + 1), []), /demasiadas decisiones para confirmar/, `decisiones: ${lim.max_field_overrides + 1} reemplazos se rechazan sin tocar nada`);
  await fails(() => applyOf(s2, pv.preview_id, [], Array.from({ length: lim.max_duplicate_decisions + 1 }, (_, i) => ({ backup_legacy_mobile_id: `d${i}`, decision: "skip", candidate_student_id: null }))), /demasiadas decisiones para confirmar/, `decisiones: ${lim.max_duplicate_decisions + 1} decisiones de duplicado se rechazan`);
  check("decisiones: el rechazo no deja residuos", sameFp(fpBefore, await fp(admin, A)));
  await s2.end();
}

async function sectionSizes(pg) {
  const admin = pg.admin;
  const lim = LIM;
  await reset(admin);
  const s = await apiSession(pg, A, 8000);

  // Vacía
  const baseline = await fp(admin, A, { business: true });
  const pe = await previewOf(s, emptyBackup());
  const ae = await applyOf(s, pe.preview_id);
  check("vacía: se importa sin escribir ninguna fila de negocio", ae.summary.total_rows_written === 0 && sameFp(baseline, await fp(admin, A, { business: true })));
  const ue = await undoPreviewOf(s, ae.import_run_id);
  check("vacía: se puede deshacer", ue.is_safe === true);
  await undoApplyOf(s, ue.undo_preview_id);

  // Mínima
  await reset(admin);
  const minB = emptyBackup(); minB.students = [student("m1")];
  const before1 = await fp(admin, A, { business: true });
  const p1 = await previewOf(s, minB);
  const a1 = await applyOf(s, p1.preview_id);
  check("mínima: 1 alumno → 1 fila escrita", a1.summary.total_rows_written === 1 && (await count(admin, "students", A)) === 1);
  const u1 = await undoPreviewOf(s, a1.import_run_id);
  await undoApplyOf(s, u1.undo_preview_id);
  check("mínima: deshacer deja la cuenta como estaba", sameFp(before1, await fp(admin, A, { business: true })));

  // Normal (con historial de niveles y vínculos entre filas)
  await reset(admin);
  const normal = generateBackup(1000, { levelHistory: true });
  const before2 = await fp(admin, A, { business: true });
  const p2 = await timed(() => previewOf(s, normal));
  const a2 = await timed(() => applyOf(s, p2.value.preview_id));
  const cbt = a2.value.summary.counts_by_table;
  check("normal (1.000): vista previa y aplicación dentro del tope de 8 s", p2.ms < 4000 && a2.ms < 6000, `${p2.ms}/${a2.ms} ms`);
  check("normal: se escribe todo lo importable (alumnos, clases, registros, cobros, historial de niveles)", cbt.students === normal.students.length && cbt.calendar_lessons === normal.calendarLessons.length && cbt.lesson_registrations === normal.pedagogicalLessons.length && cbt.payments === normal.payments.length && cbt.student_level_history === normal.students.length, JSON.stringify(cbt));
  const u2 = await undoPreviewOf(s, a2.value.import_run_id);
  check("normal: con vínculos entre filas (clase liberada, serie que reemplaza, pago que reemplaza) se puede DESHACER", u2.is_safe === true, JSON.stringify(u2.unsafe_rows).slice(0, 200));
  await undoApplyOf(s, u2.undo_preview_id);
  check("normal: deshacer devuelve exactamente la huella anterior", sameFp(before2, await fp(admin, A, { business: true })), diffFp(before2, await fp(admin, A, { business: true })));

  // Máxima aceptada
  await reset(admin);
  const nMax = largestWithin(lim.max_work_units, { levelHistory: true });
  const max = generateBackup(nMax, { levelHistory: true });
  check("máxima: el respaldo más grande que entra está pegado al tope de trabajo", workUnits(max) <= lim.max_work_units && workUnits(max) > lim.max_work_units * 0.97 && countedRows(max) <= lim.max_rows_total && nestedRows(max) <= lim.max_nested_rows, `${workUnits(max)} unidades`);
  const before3 = await fp(admin, A, { business: true });
  const p3 = await timed(() => previewOf(s, max));
  const a3 = await timed(() => applyOf(s, p3.value.preview_id));
  // El presupuesto de diseño es ≤ 3 s en una máquina sin carga (medido en docs/R6_IMPORTACIONES_GRANDES.md); la prueba exige el tope REAL de la API (8 s,
  // ya fijado en la sesión) para no volverse inestable cuando la máquina está ocupada, e imprime lo medido.
  check(`máxima (${workUnits(max)} unidades): la vista previa entra en el tope de 8 s de la API`, p3.ms < 8000, `${p3.ms} ms`);
  check(`máxima: la aplicación entra en el tope de 8 s de la API (presupuesto de diseño ≤ 3 s sin carga)`, a3.ms < 8000, `${a3.ms} ms`);
  const u3 = await timed(() => undoPreviewOf(s, a3.value.import_run_id));
  check("máxima: la vista previa de deshacer entra en el tope y es segura", u3.ms < 8000 && u3.value.is_safe === true, `${u3.ms} ms`);
  const ua3 = await timed(() => undoApplyOf(s, u3.value.undo_preview_id));
  check("máxima: deshacer entra en el tope y restaura la huella anterior", ua3.ms < 8000 && sameFp(before3, await fp(admin, A, { business: true })), `${ua3.ms} ms`);
  console.log(`   (máxima, ms: vista previa ${p3.ms}, aplicar ${a3.ms}, revisar deshacer ${u3.ms}, deshacer ${ua3.ms})`);
  await s.end();
  return { nMax, ms: { preview: p3.ms, apply: a3.ms, undoPreview: u3.ms, undoApply: ua3.ms } };
}

async function sectionManyRelations(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 8000);
  const b = generateBackup(1200, { profile: "students_heavy", nested: 3, selfLinks: true });
  const before = await fp(admin, A, { business: true });
  const p = await previewOf(s, b);
  const a = await timed(() => applyOf(s, p.preview_id));
  const cbt = a.value.summary.counts_by_table;
  const parts = b.calendarLessons.reduce((n, l) => n + l.participants.length, 0);
  check("muchos alumnos con muchas relaciones: todas las filas hijas se escriben (participantes, roster, asistencias, evaluaciones, revisiones)", cbt.calendar_lesson_participants >= parts * 0.9 && cbt.lesson_registration_students > 0 && cbt.lesson_registration_attendance > 0 && cbt.lesson_registration_evaluations > 0 && cbt.lesson_registration_homework_reviews > 0, JSON.stringify(cbt));
  const orphans = (await admin.query(`
    select (select count(*) from public.calendar_lesson_participants x where x.owner_id = $1 and not exists (select 1 from public.calendar_lessons l where l.id = x.calendar_lesson_id and l.owner_id = $1)) +
           (select count(*) from public.lesson_registration_students x where x.owner_id = $1 and not exists (select 1 from public.lesson_registrations l where l.id = x.lesson_registration_id and l.owner_id = $1)) as n`, [A])).rows[0].n;
  check("muchos alumnos con muchas relaciones: ninguna fila hija huérfana ni de otra cuenta", Number(orphans) === 0);
  const u = await undoPreviewOf(s, a.value.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("muchos alumnos con muchas relaciones: deshacer completo", u.is_safe && sameFp(before, await fp(admin, A, { business: true })));
  await s.end();
}

async function sectionDuplicates(pg) {
  const admin = pg.admin;
  await reset(admin);
  const sc = scenarioDuplicatesAndConflicts();
  for (const q of sc.seed) await admin.query(q);
  const before = await fp(admin, A, { business: true });
  const s = await apiSession(pg, A);
  const p = await previewOf(s, sc.backup);
  const c = p.classification;
  const dupIds = c.maestros.students.duplicates.map((d) => d.backup_legacy_mobile_id).sort();
  check("duplicados: se detectan por nombre, correo y teléfono normalizados", JSON.stringify(dupIds) === JSON.stringify(["st_dup_email", "st_dup_name", "st_dup_phone", "st_dup_skip"]), dupIds.join(","));
  check("conflictos e iguales: 2 conflictos, 1 igual, 3 altas", c.maestros.students.conflicts.length === 2 && c.maestros.students.equal.length === 1 && c.maestros.students.inserts.length === 3);
  const d = sc.decide(c);
  const a = await applyOf(s, p.preview_id, d.overrides, d.decisions);
  const st = async (legacy) => (await admin.query(`select * from public.students where owner_id = $1 and legacy_mobile_id = $2`, [A, legacy])).rows;
  const link = (await admin.query(`select legacy_mobile_id from public.students where id = $1`, [uuid(4)])).rows[0];
  check("decisión «vincular»: el alumno web recibe el id de la copia y no se crea otro", link.legacy_mobile_id === "st_dup_name" && (await st("st_dup_name")).length === 1);
  const sep = await st("st_dup_email");
  const webCand = (await admin.query(`select legacy_mobile_id from public.students where id = $1`, [uuid(5)])).rows[0];
  check("decisión «crear aparte»: se crea el alumno nuevo y el candidato web queda intacto", sep.length === 1 && sep[0].id !== uuid(5) && webCand.legacy_mobile_id === null);
  const skipped = await st("st_dup_phone");
  check("decisión «no importar»: no se crea nada y el candidato web queda intacto", skipped.length === 0 && (await admin.query(`select legacy_mobile_id from public.students where id = $1`, [uuid(6)])).rows[0].legacy_mobile_id === null);
  const conf1 = (await st("st_conf1"))[0]; const conf2 = (await st("st_conf2"))[0]; const eq = (await st("st_eq"))[0];
  check("conflicto con reemplazo elegido: se reemplazan sólo los campos marcados", conf1.name === "Nombre Backup" && conf1.phone === "+5491111111");
  check("conflicto sin reemplazo: se CONSERVA lo de la web", conf2.notes === "nota web" && conf2.name === "Conflicto Dos");
  check("alumno igual: no se toca", eq.name === "Igual Uno");
  const lvl = (await admin.query(`select name from public.custom_levels where owner_id = $1 and legacy_mobile_id = 'cv_conf'`, [A])).rows[0];
  check("nivel en conflicto con reemplazo: se reemplaza el nombre", lvl.name === "Nivel backup");
  const acts = (await admin.query(`select action, count(*)::int n from public.import_run_row_snapshots where import_run_id = $1 and table_name = 'students' group by 1 order by 1`, [a.import_run_id])).rows;
  check("instantáneas: altas, vínculo de identidad y reemplazos de campos quedan registrados", acts.some((r) => r.action === "inserted") && acts.some((r) => r.action === "identity_linked" && r.n === 1) && acts.some((r) => r.action === "field_overwritten" && r.n === 1), JSON.stringify(acts));
  const u = await undoPreviewOf(s, a.import_run_id);
  check("deshacer con vínculo y reemplazos: es seguro mientras nada cambió", u.is_safe === true, JSON.stringify(u.unsafe_rows).slice(0, 200));
  await undoApplyOf(s, u.undo_preview_id);
  check("deshacer restaura el vínculo, los campos reemplazados y borra lo agregado (huella igual a la inicial)", sameFp(before, await fp(admin, A, { business: true })), diffFp(before, await fp(admin, A, { business: true })));
  await s.end();

  // Datos repetidos dentro de la copia: se rechazan al previsualizar (antes terminaban en «ya existe» al confirmar)
  await reset(admin);
  const sr = await apiSession(pg, A);
  const rep = emptyBackup(); rep.students = [student("r1"), student("r2"), student("r1", { name: "Repetido" })];
  const fpr = await fp(admin, A);
  await fails(() => previewOf(sr, rep), /datos repetidos/, "datos repetidos en la copia: se rechazan al previsualizar");
  check("datos repetidos: no queda ninguna vista previa", sameFp(fpr, await fp(admin, A)));
  // Huellas: si la web cambió después de la revisión, la importación se frena y no pisa nada
  const sc3 = scenarioDuplicatesAndConflicts();
  for (const q of sc3.seed) await admin.query(q);
  const p3 = await previewOf(sr, sc3.backup);
  const d3 = sc3.decide(p3.classification);
  await admin.query(`update public.students set notes = 'cambió la web' where id = $1`, [uuid(2)]);
  const fpf = await fp(admin, A);
  await fails(() => applyOf(sr, p3.preview_id, d3.overrides, d3.decisions), /cambió desde que se generó/, "huellas: una fila de la web que cambió después de la revisión frena la importación");
  check("huellas: la importación frenada no deja residuos", sameFp(fpf, await fp(admin, A)));
  await sr.end();

  // Decisiones inválidas
  await reset(admin);
  for (const q of sc.seed) await admin.query(q);
  const s2 = await apiSession(pg, A);
  const p2 = await previewOf(s2, sc.backup);
  const cand = p2.classification.maestros.students.duplicates[0];
  await fails(() => applyOf(s2, p2.preview_id, [], [{ backup_legacy_mobile_id: cand.backup_legacy_mobile_id, decision: "link", candidate_student_id: uuid(9) }]), /candidate_student_id|Decisión de duplicado/, "decisión inválida: vincular con otro alumno que el analizado se rechaza");
  await fails(() => applyOf(s2, p2.preview_id, [], [{ backup_legacy_mobile_id: "no_existe", decision: "skip", candidate_student_id: null }]), /candidato de duplicado/, "decisión inválida: un duplicado que no existe en la vista previa se rechaza");
  await fails(() => applyOf(s2, p2.preview_id, [{ table_name: "students", row_id: uuid(1), fields: ["name"] }], []), /no está clasificada|Campo/, "reemplazo inválido: un alumno igual (sin conflicto) no admite reemplazos");
  await fails(() => applyOf(s2, p2.preview_id, [{ table_name: "payments", row_id: uuid(1), fields: ["amount"] }], []), /no admite overrides/, "reemplazo inválido: una tabla que no admite reemplazos se rechaza");
  await fails(() => applyOf(s2, p2.preview_id, [], [{ backup_legacy_mobile_id: cand.backup_legacy_mobile_id, decision: "link", candidate_student_id: cand.candidate_student_id }, { backup_legacy_mobile_id: cand.backup_legacy_mobile_id, decision: "skip", candidate_student_id: null }]), /Decisión de duplicado/, "decisión inválida: dos decisiones para el mismo duplicado se rechazan");
  await s2.end();
}

async function sectionReferences(pg) {
  const admin = pg.admin;
  await reset(admin);
  const sc = scenarioDuplicatesAndConflicts();
  for (const q of sc.seed) await admin.query(q);
  const s = await apiSession(pg, A);
  const p = await previewOf(s, sc.backup);
  const c = p.classification;
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.legacy_mobile_id, x]));
  const rr = byId(c.aggregates.recurrence_rules); const cl = byId(c.aggregates.calendar_lessons); const lr = byId(c.aggregates.lesson_registrations);
  check("referencias faltantes: serie con alumno que sólo es «posible duplicado» o con acuerdo inexistente se omite", rr.rr_dupref.status === "omitted_broken_reference" && rr.rr_badagr.status === "omitted_broken_reference" && rr.rr_new1.status === "insertable" && rr.rr_exist.status === "preserved");
  check("referencias faltantes: clase con alumno inexistente se omite; con serie ya existente O con una serie que la misma copia agrega (R6.1) entra", cl.cl_badstu.status === "omitted_broken_reference" && cl.cl_recnew.status === "insertable" && cl.cl_recweb.status === "insertable" && cl.cl_exist.status === "preserved");
  check("referencias faltantes: registro con integrante inexistente se omite", lr.pl_badroster.status === "omitted_broken_reference" && lr.pl_new.status === "insertable");
  const fin = Object.fromEntries(c.aggregates.financial_components.flatMap((k) => k.members.map((m) => [m.legacy_mobile_id, k])));
  check("referencias rotas en cobros: el pago que no existe arrastra TODA la componente (nunca un cobro sin su pago)", fin.al_missing.status === "omitted" && fin.ch_missing_pay.status === "omitted" && /no existe ni en el backup ni en la web/.test(fin.al_missing.reason));
  check("cobros: un pago que ya existe en la web omite la componente completa", fin.al_inweb.status === "omitted" && /ya existe en la web/.test(fin.al_inweb.reason));
  check("cobros: un cobro con acuerdo de entrenamiento inexistente se omite; con acuerdo que se agrega o ya existe, entra", fin.ch_badagr.status === "omitted" && fin.ch_agr_ok.status === "insertable");
  const d = sc.decide(c);
  const a = await applyOf(s, p.preview_id, d.overrides, d.decisions);
  const orph = (await admin.query(`
    select (select count(*) from public.payment_allocations x where x.owner_id = $1 and (not exists (select 1 from public.payments p where p.id = x.payment_id) or not exists (select 1 from public.payment_charges c where c.id = x.charge_id))) as n`, [A])).rows[0].n;
  check("referencias rotas: lo omitido no se escribe y no queda ninguna asignación sin pago o sin cobro", Number(orph) === 0 && (await admin.query(`select count(*)::int n from public.payment_allocations where owner_id = $1 and legacy_mobile_id in ('al_missing','al_inweb')`, [A])).rows[0].n === 0);
  check("se escribió algo (no todo se omitió)", a.summary.total_rows_written > 20);
  await s.end();

  // Referencias cruzadas: la copia de A menciona ids de alumnos que sólo existen en B
  await reset(admin);
  await admin.query(`insert into public.students (id, owner_id, legacy_mobile_id, name, levels, initial_level, modality, status, category, billing_type, date_joined, usual_duration_minutes, weekly_frequency, price)
    values ($1, $2, 'st_de_b', 'Alumno de B', array['A1'], 'A1', 'online', 'activo', 'adulto_interes_personal', 'mensual', '2025-01-10', 60, 1, 1000)`, [uuid(7001), B]);
  const cross = emptyBackup();
  cross.students = [student("st_de_a")];
  cross.calendarLessons = [{ id: "cl_x", primaryStudentId: "st_de_b", studentName: "x", level: "A1", lessonType: "individual", startAt: "2025-03-03T10:00:00.000Z", endAt: "2025-03-03T11:00:00.000Z", modality: "online", status: "scheduled", color: "#fff", participants: [] }];
  cross.payments = [{ id: "pa_x", studentId: "st_de_b", amount: 10, currency: "ARS", method: "efectivo", paidAt: "2025-04-01" }];
  const fpB = await fp(admin, B);
  const sA = await apiSession(pg, A);
  const px = await previewOf(sA, cross);
  const aClass = Object.fromEntries(px.classification.aggregates.calendar_lessons.map((x) => [x.legacy_mobile_id, x.status]));
  check("referencias cruzadas: una clase que apunta a un alumno de OTRA cuenta se omite", aClass.cl_x === "omitted_broken_reference");
  await applyOf(sA, px.preview_id);
  check("referencias cruzadas: lo de la otra cuenta queda intacto y A no escribe nada que lo referencie", sameFp(fpB, await fp(admin, B)) && (await count(admin, "calendar_lessons", A)) === 0 && (await count(admin, "payments", A)) === 0);
  await sA.end();
}

async function sectionParallelOwners(pg) {
  const admin = pg.admin;
  await reset(admin);
  // El MISMO respaldo (mismos ids de la app móvil) en dos cuentas distintas, al mismo tiempo.
  const backup = generateBackup(800, { levelHistory: true });
  const sA = await apiSession(pg, A, 8000);
  const sB = await apiSession(pg, B, 8000);
  const [pA, pB] = await Promise.all([previewOf(sA, backup), previewOf(sB, backup)]);
  const [aA, aB] = await Promise.all([applyOf(sA, pA.preview_id), applyOf(sB, pB.preview_id)]);
  check("dos propietarias en paralelo: ambas importaciones se completan", aA.summary.total_rows_written > 0 && aA.summary.total_rows_written === aB.summary.total_rows_written, `${aA.summary.total_rows_written}/${aB.summary.total_rows_written}`);
  const cross = (await admin.query(`
    select (select count(*) from public.calendar_lessons l join public.students s on s.id = l.primary_student_id where l.owner_id = $1 and s.owner_id <> $1) +
           (select count(*) from public.payment_allocations x join public.payments p on p.id = x.payment_id where x.owner_id = $1 and p.owner_id <> $1) +
           (select count(*) from public.lesson_registration_students x join public.students s on s.id = x.student_id where x.owner_id = $1 and s.owner_id <> $1) as n`, [A])).rows[0].n;
  check("dos propietarias en paralelo: ninguna fila de una apunta a datos de la otra", Number(cross) === 0);
  check("dos propietarias en paralelo: cada una tiene exactamente su copia", (await count(admin, "students", A)) === backup.students.length && (await count(admin, "students", B)) === backup.students.length);
  const fpB = await fp(admin, B);
  const uA = await undoPreviewOf(sA, aA.import_run_id);
  await undoApplyOf(sA, uA.undo_preview_id);
  check("dos propietarias en paralelo: deshacer la de A no toca nada de B", (await count(admin, "students", A)) === 0 && sameFp(fpB, await fp(admin, B)));
  // B conserva los MISMOS ids de la app móvil: la vista previa de A nunca los ve (todo es alta para A, nada «igual», nada se pisa en B).
  const pAgain = await previewOf(sA, backup);
  check("aislamiento: con los mismos ids de la app móvil ya importados en OTRA cuenta, la vista previa de A los trata como altas propias", pAgain.classification.maestros.students.inserts.length === backup.students.length && pAgain.classification.maestros.students.equal.length === 0 && pAgain.classification.maestros.students.conflicts.length === 0);
  await applyOf(sA, pAgain.preview_id);
  check("aislamiento: y al aplicar, A escribe lo suyo y B queda exactamente igual", (await count(admin, "students", A)) === backup.students.length && sameFp(fpB, await fp(admin, B)));
  await sA.end(); await sB.end();
}

async function sectionSameOwnerConcurrent(pg) {
  const admin = pg.admin;
  // (a) La MISMA vista previa confirmada dos veces a la vez: una sola importación, la otra repite el resultado.
  await reset(admin);
  const b = generateBackup(600, { levelHistory: false });
  const s1 = await apiSession(pg, A, 20000); const s2 = await apiSession(pg, A, 20000);
  const p = await previewOf(s1, b);
  const [r1, r2] = await Promise.all([applyOf(s1, p.preview_id), applyOf(s2, p.preview_id)]);
  const replays = [r1, r2].filter((r) => r.summary.replayed === true).length;
  check("misma vista previa a la vez: una aplica y la otra devuelve el mismo resultado (replayed)", replays === 1 && r1.import_run_id === r2.import_run_id);
  check("misma vista previa a la vez: una sola corrida y ninguna fila duplicada", (await count(admin, "import_runs", A)) === 1 && (await count(admin, "students", A)) === b.students.length);

  // (b) Dos vistas previas con datos distintos a la vez: se serializan y entran las dos.
  await reset(admin);
  const bA = generateBackup(300, { prefix: "uno", levelHistory: false });
  const bB = generateBackup(300, { prefix: "dos", levelHistory: false });
  const pA = await previewOf(s1, bA); const pB = await previewOf(s2, bB);
  const [x1, x2] = await Promise.all([applyOf(s1, pA.preview_id), applyOf(s2, pB.preview_id)]);
  check("dos importaciones distintas a la vez de la misma cuenta: entran las dos, sin pisarse", (await count(admin, "students", A)) === bA.students.length + bB.students.length && (await count(admin, "import_runs", A)) === 2 && x1.import_run_id !== x2.import_run_id);

  // (c) Dos vistas previas que quieren agregar los MISMOS datos: gana una y la otra se frena sin dejar nada.
  await reset(admin);
  const same = generateBackup(300, { prefix: "igual", levelHistory: false });
  const q1 = await previewOf(s1, same); const q2 = await previewOf(s2, same);
  const settled = await Promise.allSettled([applyOf(s1, q1.preview_id), applyOf(s2, q2.preview_id)]);
  const won = settled.filter((r) => r.status === "fulfilled").length;
  const lost = settled.filter((r) => r.status === "rejected");
  check("mismos datos desde dos vistas previas a la vez: exactamente una gana", won === 1 && lost.length === 1);
  check("el perdedor recibe «la vista previa quedó desactualizada» (no un error interno de clave duplicada)", lost.length === 1 && /desactualizad|ya existe/i.test(lost[0].reason.message) && !/duplicate key|violates/i.test(lost[0].reason.message), lost[0] && lost[0].reason.message.slice(0, 120));
  if (lost[0]) seenErrors.push(lost[0].reason.message);
  const after = await fp(admin, A);
  check("el perdedor no deja residuos: la cuenta tiene exactamente UNA copia", (await count(admin, "students", A)) === same.students.length && (await count(admin, "import_runs", A)) === 1 && (await advisoryLocks(admin)) === 0, diffFp(after, after));

  // (d) El análisis se hace ANTES del lock: con el lock de la cuenta tomado por otra conexión, una confirmación con un dato inválido falla ENSEGUIDA
  // (la conversión del respaldo ya corrió) en lugar de quedarse esperando el lock; una válida espera el lock con todo ya preparado.
  await reset(admin);
  const holder = await pg.connect();
  const sx = await apiSession(pg, A, 30000);
  const invalid = emptyBackup(); invalid.students = [student("inv1", { birthDate: "no-es-una-fecha" })];
  const pi = await previewOf(sx, invalid);
  await holder.query(`select pg_advisory_lock(hashtext('backup_import:' || $1::text))`, [A]);
  const raced = await Promise.race([
    applyOf(sx, pi.preview_id).then(() => "terminó", (e) => `falló ${e.code}`),
    new Promise((r) => setTimeout(() => r("esperando el lock"), 3000)),
  ]);
  check("el lock de la cuenta se pide DESPUÉS del análisis: con el lock ocupado, un dato inválido se detecta sin esperarlo", /^falló 22007/.test(raced), raced);
  await sx.query("rollback").catch(() => {});
  const big = generateBackup(800, { prefix: "lk", levelHistory: false });
  const pv = await previewOf(sx, big);
  const running = applyOf(sx, pv.preview_id);
  let waiting = false;
  for (let i = 0; i < 100 && !waiting; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
    waiting = (await admin.query(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and wait_event = 'advisory'`)).rows[0].n > 0;
  }
  const runRows = (await admin.query(`select count(*)::int n from public.import_runs where owner_id = $1`, [A])).rows[0].n;
  check("una confirmación válida espera el lock de la cuenta sin haber escrito nada", waiting && runRows === 0 && (await count(admin, "students", A)) === 0, `espera=${waiting} corridas=${runRows}`);
  await holder.query(`select pg_advisory_unlock(hashtext('backup_import:' || $1::text))`, [A]);
  const done = await running;
  check("al liberarse el lock, la confirmación termina bien y escribe todo", done.summary.replayed === false && done.summary.counts_by_table.students === big.students.length && (await count(admin, "students", A)) === big.students.length);
  await holder.end(); await sx.end(); await s1.end(); await s2.end();
}

async function sectionLostResponse(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = generateBackup(400, { levelHistory: true });
  const p = await previewOf(s, b);
  const first = await applyOf(s, p.preview_id);
  const after1 = await fp(admin, A);
  // La respuesta se perdió: la usuaria reconfirma con la misma revisión.
  const again = await applyOf(s, p.preview_id);
  check("respuesta perdida y reintento: devuelve la MISMA corrida marcada como repetida", again.import_run_id === first.import_run_id && again.summary.replayed === true && again.summary.total_rows_written === first.summary.total_rows_written);
  check("respuesta perdida y reintento: cero escrituras (la huella no cambia)", sameFp(after1, await fp(admin, A)), diffFp(after1, await fp(admin, A)));
  const again2 = await applyOf(s, p.preview_id, [{ table_name: "students", row_id: uuid(1), fields: ["name"] }], []);
  check("el reintento con otras decisiones tampoco cambia nada: gana la corrida original", again2.import_run_id === first.import_run_id && sameFp(after1, await fp(admin, A)));
  // Vencida la vista previa, el reintento SIGUE devolviendo el resultado original.
  await admin.query(`update public.import_previews set expires_at = now() - interval '5 minutes' where id = $1`, [p.preview_id]);
  const late = await applyOf(s, p.preview_id);
  check("el reintento después de vencida la revisión sigue devolviendo la corrida original", late.import_run_id === first.import_run_id && late.summary.replayed === true);
  // Deshacer: la respuesta también puede perderse.
  const u = await undoPreviewOf(s, first.import_run_id);
  const ua = await undoApplyOf(s, u.undo_preview_id);
  const afterUndo = await fp(admin, A);
  const ub = await undoApplyOf(s, u.undo_preview_id);
  check("deshacer repetido: mismo resultado marcado como repetido y cero escrituras", ua.summary.replayed === false && ub.summary.replayed === true && ub.summary.deleted_rows === ua.summary.deleted_rows && sameFp(afterUndo, await fp(admin, A)));
  await fails(() => undoPreviewOf(s, first.import_run_id), /ya fue deshecha/, "una importación ya deshecha no se puede deshacer otra vez");
  await s.end();
}

async function sectionMidFailure(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 30000);
  const b = generateBackup(500, { levelHistory: true });
  const p = await previewOf(s, b);
  const before = await fp(admin, A);
  // Falla a MITAD de la aplicación: un disparador (de prueba) hace fallar la última tabla que se escribe.
  await admin.query(`create or replace function public.t_r6_boom() returns trigger language plpgsql as $$ begin raise exception 'falla de prueba'; end $$`);
  await admin.query(`create trigger t_r6_boom before insert on public.package_credit_movements for each statement execute function public.t_r6_boom()`);
  const e = await fails(() => applyOf(s, p.preview_id), /falla de prueba/, "error a mitad de la aplicación: la confirmación falla");
  void e;
  const mid = await fp(admin, A);
  check("error a mitad de la aplicación: TODO se revierte (cero filas, cero instantáneas, ninguna corrida)", sameFp(before, mid), diffFp(before, mid));
  check("error a mitad de la aplicación: no queda ningún lock de la cuenta", (await advisoryLocks(admin)) === 0);
  check("error a mitad de la aplicación: la vista previa sigue pendiente y utilizable", (await admin.query(`select status from public.import_previews where id = $1`, [p.preview_id])).rows[0].status === "pending");
  await admin.query(`drop trigger t_r6_boom on public.package_credit_movements`);
  await admin.query(`drop function public.t_r6_boom()`);
  const ok = await applyOf(s, p.preview_id);
  check("corregida la causa, la MISMA vista previa se aplica bien (sin duplicados por el intento anterior)", ok.summary.replayed === false && (await count(admin, "students", A)) === b.students.length && (await count(admin, "import_runs", A)) === 1);
  const u = await undoPreviewOf(s, ok.import_run_id); await undoApplyOf(s, u.undo_preview_id);
  await s.end();

  // Tiempo agotado a mitad de la aplicación (el tope de la API): se revierte todo y se suelta el lock.
  await reset(admin);
  const sT = await apiSession(pg, A, 60000);
  const big = generateBackup(2800, { levelHistory: false });
  const pb = await previewOf(sT, big);
  const beforeT = await fp(admin, A);
  await sT.query(`set statement_timeout = 400`);
  await fails(() => applyOf(sT, pb.preview_id), /statement timeout|tiempo|canceling/, "tiempo agotado a mitad de la aplicación: la base cancela la operación");
  check("tiempo agotado: TODO se revierte y no queda ningún lock", sameFp(beforeT, await fp(admin, A)) && (await advisoryLocks(admin)) === 0, diffFp(beforeT, await fp(admin, A)));
  await sT.query(`set statement_timeout = 60000`);
  const okT = await applyOf(sT, pb.preview_id);
  check("tras un tiempo agotado, reconfirmar con la misma revisión funciona y no duplica", okT.summary.replayed === false && (await count(admin, "students", A)) === big.students.length);
  const uT = await undoPreviewOf(sT, okT.import_run_id); await undoApplyOf(sT, uT.undo_preview_id);
  await sT.end();

  // Corte de red: se mata la conexión a mitad de la aplicación.
  await reset(admin);
  const sC = await apiSession(pg, A, 60000);
  const pc = await previewOf(sC, big);
  const beforeC = await fp(admin, A);
  const pid = (await sC.query(`select pg_backend_pid() pid`)).rows[0].pid;
  const running = applyOf(sC, pc.preview_id).then(() => "terminó", (err) => `cortó: ${err.code || err.message}`);
  await new Promise((r) => setTimeout(r, 450));
  await admin.query(`select pg_terminate_backend($1)`, [pid]);
  const outcome = await running;
  await new Promise((r) => setTimeout(r, 300));
  check("corte de la conexión a mitad de la aplicación: la operación se interrumpe", /cortó/.test(outcome), outcome);
  check("corte de la conexión: no queda nada escrito ni ningún lock", sameFp(beforeC, await fp(admin, A)) && (await advisoryLocks(admin)) === 0, diffFp(beforeC, await fp(admin, A)));
  const sD = await apiSession(pg, A, 60000);
  const redo = await applyOf(sD, pc.preview_id);
  check("tras un corte, reconfirmar con la misma revisión importa una sola vez", redo.summary.replayed === false && (await count(admin, "students", A)) === big.students.length && (await count(admin, "import_runs", A)) === 1);
  const uD = await undoPreviewOf(sD, redo.import_run_id); await undoApplyOf(sD, uD.undo_preview_id);
  await sD.end();
  try { await sC.end(); } catch {}
}

async function sectionUndo(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = generateBackup(500, { levelHistory: true });
  const before = await fp(admin, A, { business: true });
  const p = await previewOf(s, b);
  const a = await applyOf(s, p.preview_id);
  // 1) Las instantáneas coinciden con las filas finales (antes la segunda pasada las dejaba desactualizadas)
  const stale = (await admin.query(`
    select count(*)::int n from public.import_run_row_snapshots s join public.calendar_lessons l on l.id = s.row_id
     where s.import_run_id = $1 and s.table_name = 'calendar_lessons' and (s.new_row ->> 'freed_by_lesson_id') is distinct from l.freed_by_lesson_id::text`, [a.import_run_id])).rows[0].n;
  check("instantáneas: coinciden con la fila final (con «clase liberada» ya resuelta en el mismo INSERT)", stale === 0);
  check("hay vínculos entre filas de la misma tabla (el caso que antes bloqueaba deshacer)", (await admin.query(`select count(*)::int n from public.calendar_lessons where owner_id = $1 and freed_by_lesson_id is not null`, [A])).rows[0].n > 0 && (await admin.query(`select count(*)::int n from public.recurrence_rules where owner_id = $1 and supersedes_recurrence_id is not null`, [A])).rows[0].n > 0 && (await admin.query(`select count(*)::int n from public.lesson_registrations where owner_id = $1 and rescheduled_from_registration_id is not null`, [A])).rows[0].n > 0);

  // 2) Editar un alumno importado bloquea deshacer y no cambia nada (cualquier edición cuenta: cambia también la fecha de modificación)
  const targetRow = (await admin.query(`select id from public.students where owner_id = $1 order by legacy_mobile_id limit 1`, [A])).rows[0];
  const target = targetRow.id;
  await admin.query(`update public.students set notes = 'editada a mano' where id = $1`, [target]);
  const u1 = await undoPreviewOf(s, a.import_run_id);
  check("deshacer: una fila importada que se editó después bloquea (no es seguro)", u1.is_safe === false && u1.unsafe_rows.some((r) => r.table_name === "students" && r.row_id === target && /editada/.test(r.reason)));
  const snapBlocked = await fp(admin, A);
  await fails(() => undoApplyOf(s, u1.undo_preview_id), /deshacer bloqueado/, "deshacer: confirmar con una fila editada se frena");
  check("deshacer bloqueado: no se tocó nada", sameFp(snapBlocked, await fp(admin, A)));
  // Segunda importación limpia para seguir con los demás casos
  await reset(admin);
  const p0 = await previewOf(s, b);
  const a0 = await applyOf(s, p0.preview_id);
  a.import_run_id = a0.import_run_id; a.summary = a0.summary;

  // 3) Un dato creado después que depende de una fila importada también bloquea
  const stu = (await admin.query(`select id from public.students where owner_id = $1 order by legacy_mobile_id limit 1`, [A])).rows[0].id;
  const extra = (await admin.query(`insert into public.payments (owner_id, student_id, amount, currency, method, paid_at) values ($1, $2, 5, 'ARS', 'efectivo', '2025-12-01') returning id`, [A, stu])).rows[0].id;
  const u2 = await undoPreviewOf(s, a.import_run_id);
  check("deshacer: un pago creado después sobre un alumno importado bloquea y se informa qué lo bloquea", u2.is_safe === false && u2.unsafe_rows.some((r) => r.table_name === "students" && r.row_id === stu && (r.blocking_children || []).some((c) => c.table_name === "payments" && c.row_id === extra)));
  const snapDep = await fp(admin, A);
  await fails(() => undoApplyOf(s, u2.undo_preview_id), /deshacer bloqueado/, "deshacer: confirmar con un dato posterior que depende de lo importado se frena");
  check("deshacer bloqueado por dependencia: no se tocó nada", sameFp(snapDep, await fp(admin, A)));
  await admin.query(`delete from public.payments where id = $1`, [extra]);

  // 4) Sin bloqueos: se deshace COMPLETO
  const u3 = await undoPreviewOf(s, a.import_run_id);
  check("deshacer: sin cambios posteriores es seguro", u3.is_safe === true, JSON.stringify(u3.unsafe_rows).slice(0, 200));
  const r = await undoApplyOf(s, u3.undo_preview_id);
  check("deshacer completo: borra todo lo agregado (el resumen cuenta las filas)", r.summary.deleted_rows === a.summary.total_rows_written && r.summary.restored_rows === 0, JSON.stringify(r.summary));
  check("deshacer completo: la cuenta vuelve EXACTAMENTE a su huella inicial (cero residuos)", sameFp(before, await fp(admin, A, { business: true })), diffFp(before, await fp(admin, A, { business: true })));
  check("deshacer completo: la corrida queda como historial marcada como deshecha", (await admin.query(`select status from public.import_runs where id = $1`, [a.import_run_id])).rows[0].status === "undone");
  await s.end();
}

async function sectionExpired(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = emptyBackup(); b.students = [student("e1"), student("e2")];
  const p = await previewOf(s, b);
  await admin.query(`update public.import_previews set expires_at = now() - interval '1 minute' where id = $1`, [p.preview_id]);
  const before = await fp(admin, A);
  await fails(() => applyOf(s, p.preview_id), /ya no es válido|vencido/, "revisión vencida: confirmar se rechaza");
  check("revisión vencida: cero residuos", sameFp(before, await fp(admin, A)) && (await advisoryLocks(admin)) === 0);
  await fails(() => applyOf(s, uuid(424242)), /no existe o no te pertenece/, "revisión inexistente: se rechaza");
  // La revisión de otra cuenta no se puede confirmar
  const sB = await apiSession(pg, B, 20000);
  const pB = await previewOf(sB, b);
  await fails(() => applyOf(s, pB.preview_id), /no existe o no te pertenece/, "revisión de OTRA cuenta: se rechaza");
  // Vista previa de deshacer vencida
  const p2 = await previewOf(s, b);
  const a2 = await applyOf(s, p2.preview_id);
  const u = await undoPreviewOf(s, a2.import_run_id);
  await admin.query(`update public.import_undo_previews set expires_at = now() - interval '1 minute' where id = $1`, [u.undo_preview_id]);
  const beforeU = await fp(admin, A);
  await fails(() => undoApplyOf(s, u.undo_preview_id), /preview de undo ya no es válido|Generá uno nuevo/, "revisión de deshacer vencida: confirmar se rechaza");
  check("revisión de deshacer vencida: cero residuos", sameFp(beforeU, await fp(admin, A)));
  await admin.query(`update public.import_runs set undo_expires_at = now() - interval '1 minute' where id = $1`, [a2.import_run_id]);
  await fails(() => undoPreviewOf(s, a2.import_run_id), /plazo para deshacer/, "plazo de deshacer vencido: se rechaza");
  await s.end(); await sB.end();
}

async function sectionQuotas(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = generateBackup(300, { levelHistory: false });
  // (a) Al previsualizar: alumnos por encima del tope de la cuenta → se rechaza ANTES de guardar nada.
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'students', 5)`, [A]);
  const before = await fp(admin, A);
  const e = await fails(() => previewOf(s, b), /quota_exceeded/, "cuota de R3 al previsualizar: se rechaza con el error de cuota");
  check("cuota al previsualizar: SQLSTATE 53400 y categoría «students»", e && e.code === "53400" && e.detail === "students", e && `${e.code} ${e.detail}`);
  check("cuota al previsualizar: no se guardó ninguna vista previa (cero residuos)", sameFp(before, await fp(admin, A)));
  await admin.query(`delete from public.account_quota_overrides where owner_id = $1`, [A]);

  // (b) Durante la aplicación: una categoría ANIDADA llega al tope a mitad de la escritura → se revierte TODO.
  const p = await previewOf(s, b);
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'lesson_registration_attendance', 10)`, [A]);
  const before2 = await fp(admin, A);
  const e2 = await fails(() => applyOf(s, p.preview_id), /quota_exceeded/, "cuota de R3 durante la aplicación: la confirmación se frena");
  check("cuota durante la aplicación: SQLSTATE 53400 y categoría correcta", e2 && e2.code === "53400" && e2.detail === "lesson_registration_attendance", e2 && `${e2.code} ${e2.detail}`);
  check("cuota durante la aplicación: TODO se revierte (los alumnos, clases y cobros escritos antes también)", sameFp(before2, await fp(admin, A)) && (await advisoryLocks(admin)) === 0, diffFp(before2, await fp(admin, A)));
  await admin.query(`delete from public.account_quota_overrides where owner_id = $1`, [A]);
  const ok = await applyOf(s, p.preview_id);
  check("liberada la cuota, la misma revisión se aplica", ok.summary.replayed === false && (await count(admin, "students", A)) === b.students.length);
  const u = await undoPreviewOf(s, ok.import_run_id); await undoApplyOf(s, u.undo_preview_id);

  // (c) Otra operación llena la cuota entre la revisión y la confirmación.
  const p2 = await previewOf(s, b);
  await admin.query(`insert into public.account_quota_overrides (owner_id, quota_key, max_total) values ($1, 'students', $2)`, [A, b.students.length + 1]);
  for (let i = 0; i < 3; i += 1) await admin.query(`insert into public.students (owner_id, name, levels, initial_level, modality, status, category, billing_type, date_joined, usual_duration_minutes, weekly_frequency, price) values ($1, $2, array['A1'], 'A1', 'online', 'activo', 'adulto_interes_personal', 'mensual', '2025-01-10', 60, 1, 1000)`, [A, `Otro ${i}`]);
  const before3 = await fp(admin, A);
  const e3 = await fails(() => applyOf(s, p2.preview_id), /quota_exceeded|desactualizad/, "cuota llenada entre la revisión y la confirmación: se frena");
  void e3;
  check("cuota llenada entre la revisión y la confirmación: cero residuos", sameFp(before3, await fp(admin, A)));
  await s.end();
}

async function sectionPurge(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = generateBackup(300, { levelHistory: true });
  const p = await previewOf(s, b);
  const a = await applyOf(s, p.preview_id);
  const bizBefore = await fp(admin, A, { business: true });
  // Pendiente vencido hace más de 24 h (sin corrida): lo limpia la purga.
  const old = await previewOf(s, (() => { const x = emptyBackup(); x.students = [student("viejo")]; return x; })());
  await admin.query(`update public.import_previews set created_at = now() - interval '2 days', expires_at = now() - interval '2 days' where id = $1`, [old.preview_id]);
  await admin.query(`update public.import_runs set undo_expires_at = now() - interval '3 hours' where id = $1`, [a.import_run_id]);
  const r = (await admin.query(`select public.purge_expired_import_data(200) as r`)).rows[0].r;
  void r;
  const run = (await admin.query(`select retained_payload is null as payload_gone, payload_purged_at is not null as p_at, snapshots_purged_at is not null as s_at from public.import_runs where id = $1`, [a.import_run_id])).rows[0];
  check("purga de R4 posterior: libera el payload conservado y las instantáneas de la corrida vencida", run.payload_gone && run.p_at && run.s_at);
  check("purga de R4 posterior: la fila de la corrida queda como historial y los datos de negocio NO se tocan", (await count(admin, "import_runs", A)) === 1 && sameFp(bizBefore, await fp(admin, A, { business: true })));
  check("purga de R4 posterior: sin instantáneas, no quedan restos y el pendiente viejo se borró", (await admin.query(`select count(*)::int n from public.import_run_row_snapshots where import_run_id = $1`, [a.import_run_id])).rows[0].n === 0 && (await admin.query(`select count(*)::int n from public.import_previews where id = $1`, [old.preview_id])).rows[0].n === 0);
  await fails(() => undoPreviewOf(s, a.import_run_id), /plazo para deshacer/, "purga de R4: después del plazo ya no se puede deshacer");
  // Con el lock de la cuenta tomado (importación en curso) la purga NO espera ni toca esa cuenta.
  const holder = await pg.connect();
  await holder.query(`select pg_advisory_lock(hashtext('backup_import:' || $1::text))`, [A]);
  const t = await timed(() => admin.query(`select public.purge_expired_import_data(200)`));
  check("purga de R4: con una importación en curso no espera el lock (devuelve enseguida)", t.ms < 2000, `${t.ms} ms`);
  await holder.query(`select pg_advisory_unlock(hashtext('backup_import:' || $1::text))`, [A]);
  await holder.end(); await s.end();
}

async function sectionLevelHistory(pg) {
  const admin = pg.admin;
  await reset(admin);
  const s = await apiSession(pg, A, 20000);
  const b = emptyBackup();
  b.students = [student("h1"), student("h2")];
  b.profiles = {
    h1: { id: "h1", levelHistory: [{ id: "lh1", level: "A2", date: "2025-06-01", fromLevel: "A1", recordedAt: "2025-06-01T12:00:00.000Z", durationDays: 100, note: "n", origin: "manual" }, { id: "lh2", level: "B1", date: "2025-09-01", fromLevel: "A2" }] },
    h2: { id: "h2", levelHistory: [{ id: "lh3", level: "A2", date: "2025-07-01" }] },
  };
  const p = await previewOf(s, b);
  check("historial de niveles: la vista previa lo clasifica como alta", p.classification.insert_only.student_level_history.inserts.length === 3);
  const a = await applyOf(s, p.preview_id);
  const rows = (await admin.query(`select h.legacy_mobile_id, s.legacy_mobile_id sl from public.student_level_history h join public.students s on s.id = h.student_id where h.owner_id = $1 order by 1`, [A])).rows;
  check("historial de niveles: se escribe cada entrada asociada a su alumno (antes la aplicación fallaba con cualquier respaldo que lo trajera)", rows.length === 3 && rows[0].sl === "h1" && rows[2].sl === "h2", JSON.stringify(rows));
  const again = await previewOf(s, b);
  check("historial de niveles: reimportar lo deja como «conservar»", again.classification.insert_only.student_level_history.inserts.length === 0 && again.classification.insert_only.student_level_history.preserved.length === 3);
  const u = await undoPreviewOf(s, a.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("historial de niveles: deshacer lo borra", (await count(admin, "student_level_history", A)) === 0 && u.is_safe);
  await s.end();
}

async function sectionSingletons(pg) {
  const admin = pg.admin;
  await reset(admin);
  const sc = scenarioSingletons();
  for (const q of sc.seed) await admin.query(q);
  const before = await fp(admin, A, { business: true });
  const s = await apiSession(pg, A, 20000);
  const p = await previewOf(s, sc.backup);
  const d = sc.decide(p.classification);
  const a = await applyOf(s, p.preview_id, d.overrides, d.decisions);
  const prof = (await admin.query(`select display_name from public.teacher_profiles where owner_id = $1`, [A])).rows[0];
  check("perfil, presupuesto, disponibilidad y recargos: conflicto con reemplazo elegido, alta y conservación", prof.display_name === "Prof Backup" && (await count(admin, "teacher_availability", A)) === 1 && (await count(admin, "surcharge_settings", A)) === 1 && (await admin.query(`select needs_percent from public.budget_distribution_settings where owner_id = $1`, [A])).rows[0].needs_percent === 50);
  const u = await undoPreviewOf(s, a.import_run_id);
  await undoApplyOf(s, u.undo_preview_id);
  check("perfil, presupuesto, disponibilidad y recargos: deshacer restaura", u.is_safe && sameFp(before, await fp(admin, A, { business: true })));
  await s.end();
}

async function sectionScaling(pg) {
  const admin = pg.admin;
  await admin.query(`alter database postgres set track_functions = 'all'`);
  await reset(admin);
  // Mide el trabajo por fase en transacciones que se REVIERTEN (consultas de tabla y llamadas a funciones). Un crecimiento cuadrático no cabe en estos topes.
  async function profile(n) {
    const out = {};
    const s = await pg.session(A);
    await s.query(`set statement_timeout = 60000`);
    const b = generateBackup(n, { levelHistory: false });
    await s.query("begin");
    await s.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(b)]);
    const stats = async () => {
      const t = (await s.query(`select coalesce(sum(seq_scan),0)::int seq, coalesce(sum(idx_scan),0)::int idx from pg_stat_xact_user_tables`)).rows[0];
      const f = (await s.query(`select funcid::regproc::text f, calls::int calls from pg_stat_xact_user_functions`)).rows;
      return { seq: t.seq, idx: t.idx, calls: Object.fromEntries(f.map((r) => [r.f.replace("public.", ""), r.calls])) };
    };
    out.preview = await stats();
    await s.query("rollback");
    const pv = await previewOf(s, b);
    await s.query("begin");
    await applyOf(s, pv.preview_id);
    out.apply = await stats();
    await s.query("rollback");
    await s.end();
    return out;
  }
  const small = await profile(400);
  const large = await profile(1600);
  check("escala (vista previa): las lecturas secuenciales de tabla crecen mucho menos que el tamaño (4x filas → ≤ 3x; antes: 313 → 4.572, es decir 14x)", large.preview.seq <= small.preview.seq * 3 + 30 && large.preview.seq <= 400, `${small.preview.seq} → ${large.preview.seq}`);
  check("escala (vista previa): ya no hay una llamada por elemento a la comprobación de referencias", (large.preview.calls._external_ref_available || 0) === 0 && (large.preview.calls._classify_students || 0) === 0);
  check("escala (aplicación): el disparador de cuotas de R3 corre UNA vez por tabla, no una vez por fila (antes: una por fila)", (large.apply.calls.tf_quota_after_insert || 0) <= 60 && (large.apply.calls.tf_quota_after_insert || 0) <= (small.apply.calls.tf_quota_after_insert || 0) + 6, `${small.apply.calls.tf_quota_after_insert} → ${large.apply.calls.tf_quota_after_insert}`);
  check("escala (aplicación): las funciones por elemento de la versión anterior ya no se usan", ["_apply_students", "_apply_calendar_lessons", "_apply_financial_components", "_apply_lesson_registrations"].every((f) => !(large.apply.calls[f] > 0)));
  const ratio = (large.apply.seq + large.apply.idx) / Math.max(1, small.apply.seq + small.apply.idx);
  check("escala (aplicación): las consultas crecen LINEALMENTE con las filas (4x filas → ≤ 4,6x consultas)", ratio <= 4.6, `x${ratio.toFixed(2)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
async function runAll(pg, { quick = false } = {}) {
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  const run = async (name, fn) => { if (!only || only.includes(name)) await fn(pg); };
  await run("static", sectionStatic);
  await run("limits", sectionLimits);
  if (!quick) await run("sizes", sectionSizes);
  await run("levels", sectionLevelHistory);
  await run("duplicates", sectionDuplicates);
  await run("references", sectionReferences);
  if (!quick) await run("relations", sectionManyRelations);
  await run("undo", sectionUndo);
  await run("lost", sectionLostResponse);
  await run("midfailure", sectionMidFailure);
  await run("concurrent", sectionSameOwnerConcurrent);
  await run("parallel", sectionParallelOwners);
  await run("expired", sectionExpired);
  await run("quotas", sectionQuotas);
  await run("purge", sectionPurge);
  await run("singletons", sectionSingletons);
  await run("scaling", sectionScaling);
  // Los mensajes de error que llegarían a la usuaria no llevan ids, nombres de tablas ni datos del respaldo.
  const leaky = seenErrors.filter((m) => /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\bpublic\.|legacy_mobile_id|\bstudents\b|payments|calendar_lessons|lesson_registrations|s_st_|st_new|Alumno \d/.test(m) && !/violates|duplicate key/.test(m));
  check("errores: ningún mensaje propio lleva ids, nombres de tablas ni datos del respaldo", leaky.length === 0, leaky.slice(0, 2).join(" | ").slice(0, 200));
}

async function main() {
  if (!MUTATIONS) {
    const pg = await start({ port: 5601 });
    if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
    await runAll(pg);
    await pg.stop();
    console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
    if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
    return;
  }
  require("./r6_import_mutations.cjs").run({ runAll, state: () => ({ failures, total }), reset: () => { failures = []; total = 0; seenErrors.length = 0; } }).then((code) => process.exit(code));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { runAll, helpers: { A, B, LIM, mkOwner, reset, fp, sameFp, diffFp, count, advisoryLocks, previewOf, applyOf, undoPreviewOf, undoApplyOf, timed, apiSession } };
void os;
