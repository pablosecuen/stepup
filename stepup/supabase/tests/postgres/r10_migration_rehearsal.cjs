// (Las comparaciones de cuerpos de funciones ignoran el retorno de carro: según el sistema donde se aplicó la migración, el cuerpo guardado trae CRLF o LF.)
// R10 (traslado completo) — Ensayo de la migración sobre un Postgres REAL con el estado ANTERIOR a R10 (todas las migraciones previas, R9 incluida), con datos sintéticos:
//   1) dentro de una transacción que se REVIERTE: sólo cambian las 7 funciones previstas, aparecen 6 funciones nuevas, 3 tablas vacías, 3 políticas de tabla (+3 de
//      almacenamiento) y 1 bucket; las filas existentes conservan TODOS sus datos (columnas nuevas con su valor por defecto); al revertir, todo vuelve a la huella inicial;
//   2) confirmada: es idempotente y compatible con lo que ya existía (una vista previa PENDIENTE y una importación ya aplicada, creadas con el código de R9, se confirman /
//      deshacen con el código nuevo; las filas viejas quedan con los valores por defecto);
//   3) el script de rollback devuelve las 7 funciones a su cuerpo anterior EXACTO y elimina lo nuevo (tablas, columnas, bucket, políticas).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r10_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { generateBackup, emptyBackup, student } = require("./r6_dataset.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R10 = fs.readdirSync(DIR).filter((f) => /^20261019\d{6}_r10_/.test(f)).sort();
const BEFORE_R10 = fs.readdirSync(DIR).filter((f) => f < R10[0]).sort().pop();
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r10_transfer_complete_rollback.sql"), "utf8");
const MODIFIED = ["_import_undo_analyze", "_import_check_payload", "_import_apply_histories", "_import_row_key", "_import_undo_relations", "apply_backup_import", "apply_undo_backup_import"];
const NEW = ["_import_project_row", "_import_apply_extras", "_import_inserted_ids", "_import_text_array", "_import_ts", "import_phone_extraction", "register_transfer_file", "mark_transfer_file_unavailable", "record_phone_extraction_result"];
const NEW_TABLES = ["lesson_attachments", "student_source_extras", "material_library_items", "device_local_snapshots", "phone_extraction_results"];
const WIDENED = ["lesson_registrations", "lesson_registration_students", "lesson_registration_evaluations", "calendar_lessons", "teacher_profiles", "student_price_history"];
const PUBLIC_RPC = ["preview_backup_import", "apply_backup_import", "preview_undo_backup_import", "apply_undo_backup_import", "import_phone_extraction", "register_transfer_file", "mark_transfer_file_unavailable", "record_phone_extraction_result"];
const A = "00000000-0000-4000-8000-0000000000aa";
const B = "00000000-0000-4000-8000-0000000000b2";

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function inventory(q) {
  const one = async (sql) => (await q(sql)).rows;
  const tables = await one(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const data = {};
  for (const { table_name: t } of tables) {
    data[t] = (await one(`select count(*)::int n, md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h from public.${t} x`))[0];
  }
  const funcs = Object.fromEntries((await one(`
    select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
           md5(replace(pg_get_functiondef(p.oid), chr(13), '') || coalesce(p.proacl::text, '') || coalesce(p.proconfig::text, '') || p.prosecdef::text) as h
      from pg_proc p where p.pronamespace = 'public'::regnamespace`)).map((r) => [r.sig, r.h]));
  const meta = {
    triggers: (await one(`select md5(string_agg(tgrelid::regclass::text || tgname || tgenabled::text, '|' order by tgrelid::regclass::text, tgname)) h, count(*)::int n from pg_trigger where not tgisinternal`))[0],
    policies: (await one(`select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) h, count(*)::int n from pg_policies where schemaname in ('public', 'storage')`))[0],
    buckets: (await one(`select md5(coalesce(string_agg(id || public::text || coalesce(file_size_limit::text, ''), '|' order by id), '')) h, count(*)::int n from storage.buckets`))[0],
    columns: (await one(`select md5(string_agg(table_name || '.' || column_name || ':' || data_type, '|' order by table_name, column_name)) h from information_schema.columns where table_schema = 'public'`))[0],
    indexes: (await one(`select md5(string_agg(indexdef, '|' order by indexname)) h from pg_indexes where schemaname = 'public'`))[0],
  };
  return { data, funcs, meta };
}
const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const names = (keys) => keys.map((k) => k.split("(")[0]).sort();

async function main() {
  const pg = await start({ port: 5661, upTo: BEFORE_R10 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  check("hay 1 migración R10 (la base de partida es la de Production anterior; lo único posterior es R11 a R15)", R10.length === 1 && fs.readdirSync(DIR).filter((f) => f > R10[0]).every((f) => /_r1[1-5]_/.test(f)), `${R10.length}`);

  // --- Datos sintéticos con el código anterior: dos cuentas, una importación aplicada (B) y una vista previa pendiente (A) ---
  for (const id of [A, B]) await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.invalid`]);
  const sA = await pg.session(A); const sB = await pg.session(B);
  const bk = (prefix, n) => generateBackup(n, { prefix, levelHistory: false, selfLinks: false });
  const pB = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("viejaB", 120))])).rows[0];
  const aB = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  const pA = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("pendA", 150))])).rows[0];
  const baseline = await inventory((s) => admin.query(s));
  check("el estado de partida tiene datos y NO existen las tablas nuevas", baseline.data.students.n > 0 && baseline.data.import_runs.n === 1 && baseline.data.import_previews.n === 2 && NEW_TABLES.every((t) => !(t in baseline.data)));
  const legacyRegs = (await admin.query(`select count(*)::int n from public.lesson_registrations`)).rows[0].n;

  // --- 1) Ensayo en transacción que se revierte ---
  await admin.query("begin");
  for (const f of R10) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const inside = await inventory((s) => admin.query(s));
  const changedFuncs = diffKeys(baseline.funcs, inside.funcs);
  const newFuncs = changedFuncs.filter((k) => !(k in baseline.funcs));
  const modified = changedFuncs.filter((k) => k in baseline.funcs);
  const dataDiff = diffKeys(baseline.data, inside.data).filter((t) => !NEW_TABLES.includes(t));
  check("ensayo: los DATOS de todas las tablas existentes quedan idénticos (las que ganan columnas conservan filas y datos viejos; el registro auditado de dependencias suma 3 filas)", dataDiff.every((t) => WIDENED.includes(t) || t === "import_undo_dependency_registry") && WIDENED.every((t) => inside.data[t].n === baseline.data[t].n) && inside.data.import_undo_dependency_registry.n === baseline.data.import_undo_dependency_registry.n + 3, dataDiff.join(","));
  check("ensayo: aparecen las 5 tablas nuevas, VACÍAS", NEW_TABLES.every((t) => inside.data[t]?.n === 0));
  check("ensayo: sólo cambian de cuerpo las 7 funciones previstas (el resto queda idéntico)", JSON.stringify(names(modified)) === JSON.stringify([...MODIFIED].sort()), modified.join(","));
  check("ensayo: aparecen exactamente 9 funciones nuevas", JSON.stringify(names(newFuncs)) === JSON.stringify([...NEW].sort()), newFuncs.join(","));
  check("ensayo: ningún disparador nuevo; +5 políticas de tabla +3 de almacenamiento (leer, agregar y borrar lo propio; nunca actualizar); +1 bucket privado", inside.meta.triggers.h === baseline.meta.triggers.h && inside.meta.policies.n === baseline.meta.policies.n + 8 && inside.meta.buckets.n === baseline.meta.buckets.n + 1);
  const acl = (await admin.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname = any($1) or p.proname = any($2))`, [PUBLIC_RPC, NEW])).rows;
  check("ensayo: las RPC públicas son ejecutables sólo por authenticated; las funciones internas nuevas por nadie de la API", acl.filter((r) => PUBLIC_RPC.includes(r.proname)).every((r) => r.u && !r.a) && acl.filter((r) => !PUBLIC_RPC.includes(r.proname)).every((r) => !r.u && !r.a), JSON.stringify(acl.filter((r) => r.u || r.a).map((r) => r.proname)));
  const grants = (await admin.query(`select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee in ('anon', 'authenticated')`, [NEW_TABLES])).rows;
  check("ensayo: las tablas nuevas dan a authenticated sólo lectura (RLS) y nada a anon: ninguna escritura desde la API", grants.every((g) => g.grantee === "authenticated" && g.privilege_type === "SELECT") && new Set(grants.map((g) => g.table_name)).size === 5, JSON.stringify(grants));
  const oldRows = (await admin.query(`select count(*) filter (where topics = '[]'::jsonb and objectives = '{}' and activity_notes = '' and internal_notes = '' and is_billable and consumes_monthly_package and source_event_type is null and source_extras = '{}'::jsonb)::int ok, count(*)::int n from public.lesson_registrations`)).rows[0];
  check("ensayo: las clases ya registradas quedan con los valores por defecto (nada inventado)", oldRows.n === legacyRegs && oldRows.ok === oldRows.n);
  await admin.query("rollback");
  const reverted = await inventory((s) => admin.query(s));
  check("ensayo REVERTIDO: la base vuelve EXACTAMENTE a la huella inicial (datos, funciones, disparadores, políticas, columnas, índices, buckets)", JSON.stringify(reverted) === JSON.stringify(baseline));

  // --- 2) Confirmada: idempotente y compatible ---
  for (const f of R10) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const once = await inventory((s) => admin.query(s));
  for (const f of R10) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const twice = await inventory((s) => admin.query(s));
  check("aplicada dos veces: nada cambia (idempotente)", JSON.stringify(once) === JSON.stringify(twice));

  const aA = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pA.preview_id])).rows[0];
  check("compatibilidad: una vista previa pendiente creada ANTES de R10 se confirma con la aplicación nueva y escribe todo", aA.summary.replayed === false && aA.summary.counts_by_table.students > 0, JSON.stringify(aA.summary.counts_by_table).slice(0, 160));
  const partial = (await admin.query(`select count(*) filter (where participant_status = 'completed')::int c, count(*)::int n from public.lesson_registration_students s join public.lesson_registrations r on r.id = s.lesson_registration_id where r.owner_id = $1 and r.status = 'completed'`, [A])).rows[0];
  check("una importación en formato anterior (sin estado de participantes): los registros finalizados dejan a todos «completados»", partial.n > 0 && partial.c === partial.n, JSON.stringify(partial));
  const uB = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aB.import_run_id])).rows[0];
  check("compatibilidad: una importación aplicada ANTES de R10 se puede deshacer con el deshacer nuevo", uB.is_safe === true, JSON.stringify(uB.unsafe_rows).slice(0, 200));
  const rB = (await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uB.undo_preview_id])).rows[0];
  check("compatibilidad: y lo deshecho es lo que se había agregado", rB.summary.deleted_rows === aB.summary.total_rows_written && (await admin.query(`select count(*)::int n from public.students where owner_id = $1`, [B])).rows[0].n === 0);
  const again = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  check("compatibilidad: reconfirmar la vista previa anterior repite el resultado original", again.summary.replayed === true && again.import_run_id === aB.import_run_id);

  // Importación nueva con el contenido completo (formato adaptado): contenido, estados, fechas originales, adjuntos, reportes y deshacer.
  const rich = emptyBackup();
  rich.students = [student("r10_st1"), student("r10_st2")];
  rich.pedagogicalLessons = [{
    id: "r10_les", calendarLessonId: null, activityKind: "class", countsAsClass: true, homeworkDescription: null, homeworkDueDate: null, billedAmount: null,
    scheduledStartAt: "2026-10-01T13:00:00.000Z", actualStartedAt: null, actualEndedAt: null, outcome: "clase_dictada", sourceEventType: "alumno_ausente", holidayException: false, modality: null,
    scheduledEndAt: "2026-10-01T14:00:00.000Z", scheduledDurationMinutes: 60, actualDurationMinutes: null, lateCancellationPolicy: null, lateCancellationPercentage: null, rescheduledFromRegistrationId: null,
    roster: [{ studentId: "r10_st1" }, { studentId: "r10_st2" }], attendance: [], evaluations: [{ studentId: "r10_st1", generalGrade: null, skillGrades: {}, sourceGrades: { generalGrade: 11, skillGrades: {}, flags: ["generalGrade:out_of_range"] }, strengths: [], areasToImprove: [] }],
    homeworkReviews: [], topics: [{ id: "t1", text: "tema R10", status: "visto" }], objectives: ["obj R10"], activities: [], activityNotes: "", internalNotes: "nota interna R10", materialIds: ["m1"],
    isBillable: false, consumesMonthlyPackage: false, createdAt: "2026-10-01T15:00:00.000Z", updatedAt: "2026-10-02T15:00:00.000Z", registrationStatus: "in_progress",
    participantProgress: [{ studentId: "r10_st2", status: "completed", position: 0 }, { studentId: "r10_st1", status: "omitted", position: 1 }],
    attachments: [{ id: "r10_les:a1", name: "x.pdf", kind: "pdf", mimeType: "application/pdf", sizeBytes: 10, caption: null, addedAt: "2026-10-01T14:00:00.000Z", studentId: null, sourceUri: "file:///x.pdf" }],
    editHistory: [{ editedAt: "2026-10-02T15:00:00.000Z", index: 0, snapshot: { previousForm: { internalNotes: "antes" } } }], sourceExtras: { calendarReservationKey: "k" },
  }];
  const pC = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(rich)])).rows[0];
  const aC = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pC.preview_id])).rows[0];
  const row = (await admin.query(`select * from public.lesson_registrations where owner_id = $1 and legacy_mobile_id = 'r10_les'`, [B])).rows[0];
  const parts = (await admin.query(`select s.legacy_mobile_id l, p.participant_status st, p.participant_position pos from public.lesson_registration_students p join public.students s on s.id = p.student_id where p.lesson_registration_id = $1 order by pos`, [row.id])).rows;
  check("importación nueva: contenido, marcas, estado «en curso», participantes con su estado y orden, y fechas originales", row.topics[0].text === "tema R10" && row.internal_notes === "nota interna R10" && row.material_ids[0] === "m1" && row.is_billable === false && row.consumes_monthly_package === false && row.source_event_type === "alumno_ausente" && row.status === "in_progress" && JSON.stringify(parts.map((p) => [p.l, p.st, p.pos])) === JSON.stringify([["r10_st2", "completed", 0], ["r10_st1", "omitted", 1]]) && Date.parse(row.created_at) === Date.parse("2026-10-01T15:00:00.000Z"), JSON.stringify([row.status, parts]));
  const counts = (await admin.query(`select (select count(*)::int from public.lesson_attachments where owner_id = $1) a, (select count(*)::int from public.lesson_registration_edit_history where owner_id = $1) h, (select (source_grades ->> 'generalGrade')::int from public.lesson_registration_evaluations where lesson_registration_id = $2) g`, [B, row.id])).rows[0];
  check("importación nueva: adjunto, historial de ediciones y nota original conservados", counts.a === 1 && counts.h === 1 && counts.g === 11, JSON.stringify(counts));
  const uC = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aC.import_run_id])).rows[0];
  check("importación nueva: se puede deshacer (las tablas nuevas entran al orden de borrado) y deja la cuenta vacía", uC.is_safe === true && (await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uC.undo_preview_id])).rows.length === 1 && (await admin.query(`select (select count(*)::int from public.lesson_attachments where owner_id = $1) + (select count(*)::int from public.lesson_registration_edit_history where owner_id = $1) + (select count(*)::int from public.lesson_registrations where owner_id = $1) n`, [B])).rows[0].n === 0, JSON.stringify(uC.unsafe_rows).slice(0, 160));
  // Eliminar una cuenta con adjuntos, historial de ediciones y reportes importados: la cascada desde auth.users no se traba con las referencias nuevas.
  const C = "00000000-0000-4000-8000-0000000000c3";
  await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [C, `${C}@example.invalid`]);
  const sC = await pg.session(C);
  const pDel = (await sC.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(rich)])).rows[0];
  await sC.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pDel.preview_id]);
  const before = (await admin.query(`select (select count(*)::int from public.lesson_attachments where owner_id = $1) a, (select count(*)::int from public.lesson_registration_edit_history where owner_id = $1) h`, [C])).rows[0];
  let deleted = true;
  try { await sC.query("select public.delete_own_account()"); } catch (e) { deleted = false; console.log("  (eliminar cuenta falló: " + e.message.slice(0, 120) + ")"); }
  const afterDel = (await admin.query(`select (select count(*)::int from public.lesson_attachments where owner_id = $1) + (select count(*)::int from public.students where owner_id = $1) + (select count(*)::int from public.lesson_registrations where owner_id = $1) n`, [C])).rows[0].n;
  check("eliminar la cuenta con adjuntos e historial importados funciona y no deja nada (la cascada no se traba con las tablas nuevas)", before.a === 1 && before.h === 1 && deleted && afterDel === 0, JSON.stringify({ before, deleted, afterDel }));
  await sC.end();

  const isolation = (await sA.query(`select (select count(*)::int from public.material_library_items) m, (select count(*)::int from public.device_local_snapshots) d, (select count(*)::int from public.lesson_attachments) a`)).rows[0];
  check("aislamiento: una cuenta ve sólo lo suyo en las tablas nuevas (RLS)", isolation.a === 0 && isolation.m === 0 && isolation.d === 0);
  let writeBlocked = 0;
  for (const sql of ["insert into public.material_library_items (owner_id, legacy_mobile_id, name) values (auth.uid(), 'x', 'x')", "update public.lesson_attachments set name = 'x'", "delete from public.device_local_snapshots"]) {
    try { await sA.query(sql); } catch { writeBlocked += 1; }
  }
  check("la API no puede escribir ni borrar directamente en las tablas nuevas", writeBlocked === 3, `${writeBlocked}/3`);

  // --- 3) Rollback manual ---
  await admin.query(ROLLBACK);
  const rolled = await inventory((s) => admin.query(s));
  const back = MODIFIED.every((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).every(([k, h]) => rolled.funcs[k] === h));
  check("rollback: las 7 funciones vuelven a su cuerpo, privilegios y configuración ANTERIORES exactos", back, MODIFIED.filter((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).some(([k, h]) => rolled.funcs[k] !== h)).join(","));
  const stillDiff = Object.entries(baseline.funcs).filter(([k, h]) => rolled.funcs[k] !== h).map(([k]) => k);
  check("rollback: TODAS las funciones anteriores quedan idénticas a la huella inicial", stillDiff.length === 0, stillDiff.join(","));
  check("rollback: tablas, columnas, políticas y bucket nuevos ya no existen", NEW_TABLES.every((t) => !(t in rolled.data)) && NEW.every((n) => !Object.keys(rolled.funcs).some((k) => k.startsWith(n + "("))) && rolled.meta.columns.h === baseline.meta.columns.h && rolled.meta.policies.h === baseline.meta.policies.h && rolled.meta.buckets.h === baseline.meta.buckets.h);
  const pD = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify((() => { const x = emptyBackup(); x.students = [student("rb1")]; return x; })())])).rows[0];
  const aD = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pD.preview_id])).rows[0];
  check("rollback: con las funciones anteriores una importación sencilla sigue funcionando", aD.summary.total_rows_written === 1);

  await sA.end(); await sB.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
