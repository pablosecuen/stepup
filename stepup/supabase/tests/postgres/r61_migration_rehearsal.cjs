// (Las comparaciones de cuerpos de funciones ignoran el retorno de carro: según el sistema donde se aplicó la migración, el cuerpo guardado trae CRLF o LF.)
// R6.1 — Ensayo de la migración sobre un Postgres REAL con el estado de Production ANTERIOR a R6.1 (todas las migraciones hasta R6), con datos sintéticos:
//   1) dentro de una transacción que se REVIERTE: sólo cambian las 6 funciones previstas y aparecen 3 funciones internas nuevas; los datos, el resto de las
//      funciones, los privilegios, los disparadores, las políticas y los índices quedan idénticos; al revertir, todo vuelve a la huella inicial;
//   2) confirmada: es idempotente (aplicarla dos veces no cambia nada) y compatible con lo que ya existía (una vista previa PENDIENTE y una importación ya aplicada,
//      creadas con el código de R6, se confirman / deshacen con el código nuevo);
//   3) el script de rollback devuelve las 6 funciones a su cuerpo anterior EXACTO y elimina las 3 nuevas.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   node supabase/tests/postgres/r61_migration_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { start } = require("./load.cjs");
const { generateBackup, emptyBackup, student } = require("./r6_dataset.cjs");

const DIR = path.join(__dirname, "..", "..", "migrations");
const R61 = fs.readdirSync(DIR).filter((f) => /^20261011\d{6}_r61_/.test(f)).sort();
const LAST_R6 = "20261010130000_r6_import_undo_set_based.sql";
const ROLLBACK = fs.readFileSync(path.join(__dirname, "..", "..", "repairs", "r61_import_rollback.sql"), "utf8");
const MODIFIED = ["_import_available_ids", "_import_classify_custom_levels", "_import_apply_custom_levels", "_apply_singleton", "_import_validate_selection", "preview_backup_import"];
const NEW = ["_import_classify_recurrence_rules", "_import_classify_calendar_lessons", "_import_classify_lesson_registrations"];
const PUBLIC_RPC = ["preview_backup_import", "apply_backup_import", "preview_undo_backup_import", "apply_undo_backup_import"];
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
    policies: (await one(`select md5(string_agg(tablename || policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname)) h, count(*)::int n from pg_policies where schemaname = 'public'`))[0],
    indexes: (await one(`select md5(string_agg(indexdef, '|' order by indexname)) h, count(*)::int n from pg_indexes where schemaname = 'public'`))[0],
    tableAcl: (await one(`select md5(string_agg(c.relname || coalesce(c.relacl::text, ''), '|' order by c.relname)) h from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`))[0],
  };
  return { data, funcs, meta };
}
const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
const names = (keys) => keys.map((k) => k.split("(")[0]).sort();

async function main() {
  const pg = await start({ port: 5641, upTo: LAST_R6 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  check("hay 1 migración R6.1 y la base de partida es la de Production anterior a R6.1 (hasta R6: 52 migraciones)", R61.length === 1 && fs.readdirSync(DIR).filter((f) => f <= LAST_R6).length === 52, `${R61.length} / ${fs.readdirSync(DIR).filter((f) => f <= LAST_R6).length}`);

  // --- Datos sintéticos con el código de R6: dos cuentas, una importación aplicada (B) y una vista previa pendiente (A) ---
  for (const id of [A, B]) await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@example.invalid`]);
  const sA = await pg.session(A); const sB = await pg.session(B);
  const bk = (prefix, n) => generateBackup(n, { prefix, levelHistory: false, selfLinks: false });
  const pB = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(bk("viejaB", 120))])).rows[0];
  const aB = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  const pendingBackup = bk("pendA", 150);
  pendingBackup.budgetDistribution = { distribution: { needs: 50, wants: 30, savings: 20 }, savingsGoal: { enabled: false, targetAmount: null, targetDate: null } };
  pendingBackup.customLevels = pendingBackup.customLevels.concat([{ id: "cv_pend", name: "Nivel pendiente", createdAt: "2025-01-01T00:00:00.000Z" }]);
  const pA = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(pendingBackup)])).rows[0];
  const baseline = await inventory((s) => admin.query(s));
  check("el estado de partida tiene datos (alumnos, importación aplicada y vista previa pendiente)", baseline.data.students.n > 0 && baseline.data.import_runs.n === 1 && baseline.data.import_previews.n === 2);

  // --- 1) Ensayo en transacción que se revierte ---
  await admin.query("begin");
  for (const f of R61) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const inside = await inventory((s) => admin.query(s));
  const changedFuncs = diffKeys(baseline.funcs, inside.funcs);
  const newFuncs = changedFuncs.filter((k) => !(k in baseline.funcs));
  const modified = changedFuncs.filter((k) => k in baseline.funcs);
  check("ensayo: los DATOS quedan idénticos (todas las tablas: conteo y huella)", diffKeys(baseline.data, inside.data).length === 0, diffKeys(baseline.data, inside.data).join(","));
  check("ensayo: sólo cambian de cuerpo las 6 funciones previstas (el resto de las funciones existentes queda idéntico)", JSON.stringify(names(modified)) === JSON.stringify([...MODIFIED].sort()), modified.join(","));
  check("ensayo: aparecen exactamente 3 funciones internas nuevas (las de series, clases y registros con el mapa de ids)", JSON.stringify(names(newFuncs)) === JSON.stringify([...NEW].sort()), newFuncs.join(","));
  check("ensayo: disparadores, políticas, índices y privilegios de tablas idénticos", JSON.stringify(baseline.meta) === JSON.stringify(inside.meta));
  const acl = (await admin.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') u from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname = any($1) or p.proname like '\\_import\\_%' or p.proname = '_apply_singleton')`, [PUBLIC_RPC])).rows;
  check("ensayo: las RPC públicas siguen siendo ejecutables sólo por authenticated; las internas por nadie de la API", acl.filter((r) => PUBLIC_RPC.includes(r.proname)).every((r) => r.u && !r.a) && acl.filter((r) => !PUBLIC_RPC.includes(r.proname)).every((r) => !r.u && !r.a), acl.filter((r) => !PUBLIC_RPC.includes(r.proname) && (r.u || r.a)).map((r) => r.proname).join(","));
  await admin.query("rollback");
  const reverted = await inventory((s) => admin.query(s));
  check("ensayo REVERTIDO: la base vuelve EXACTAMENTE a la huella inicial (datos, funciones, disparadores, políticas, índices, privilegios)", JSON.stringify(reverted) === JSON.stringify(baseline));

  // --- 2) Confirmada: idempotente y compatible ---
  for (const f of R61) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const once = await inventory((s) => admin.query(s));
  for (const f of R61) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const twice = await inventory((s) => admin.query(s));
  check("aplicada dos veces: nada cambia (idempotente)", JSON.stringify(once) === JSON.stringify(twice));
  check("aplicada: los datos siguen idénticos a la huella inicial", diffKeys(baseline.data, once.data).length === 0);

  // La vista previa PENDIENTE creada con R6 (sin la clave de duplicados de niveles) se confirma con el código nuevo.
  const aA = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pA.preview_id])).rows[0];
  check("compatibilidad: una vista previa pendiente creada ANTES de R6.1 se confirma con la aplicación nueva y escribe todo", aA.summary.replayed === false && aA.summary.counts_by_table.students === pendingBackup.students.length && aA.summary.counts_by_table.custom_levels === 1 && aA.summary.counts_by_table.budget_distribution_settings === 1, JSON.stringify(aA.summary.counts_by_table).slice(0, 200));
  const uB = (await sB.query(`select * from public.preview_undo_backup_import($1::uuid)`, [aB.import_run_id])).rows[0];
  check("compatibilidad: una importación aplicada ANTES de R6.1 se puede deshacer con el deshacer vigente", uB.is_safe === true, JSON.stringify(uB.unsafe_rows).slice(0, 200));
  const rB = (await sB.query(`select * from public.apply_undo_backup_import($1::uuid)`, [uB.undo_preview_id])).rows[0];
  check("compatibilidad: y lo deshecho es lo que se había agregado", rB.summary.deleted_rows === aB.summary.total_rows_written && (await admin.query(`select count(*)::int n from public.students where owner_id = $1`, [B])).rows[0].n === 0);
  const again = (await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pB.preview_id])).rows[0];
  check("compatibilidad: reconfirmar la vista previa anterior repite el resultado original", again.summary.replayed === true && again.import_run_id === aB.import_run_id);
  // Una importación NUEVA con la cadena completa dentro de la copia funciona con la migración confirmada.
  const chain = emptyBackup();
  chain.students = [student("rh_st1")];
  chain.trainingBillingAgreements = [{ id: "rh_ta", monthlyFee: 5000, pendingMonthlyFee: null, pendingMonthlyFeeEffectiveFrom: null, startPeriod: "2025-01" }];
  chain.recurrenceRules = [{ id: "rh_rr", primaryStudentId: "rh_st1", ruleType: "weekly", cycleLengthWeeks: 1, weeks: [], modality: "online", timezone: "UTC", startDate: "2025-02-03", endDate: null, status: "active", supersedesRecurrenceId: null, supersededByRecurrenceId: null, effectiveFromDate: "2025-02-03", classTitle: null, activityKind: "class", trainingBillingAgreementId: "rh_ta", participantStudentIds: ["rh_st1"] }];
  const pC = (await sB.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(chain)])).rows[0];
  check("la migración confirmada importa una serie con un acuerdo que agrega la misma copia", pC.classification.aggregates.recurrence_rules[0].status === "insertable");
  await sB.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pC.preview_id]);

  // --- 3) Rollback manual ---
  await admin.query(ROLLBACK);
  const rolled = await inventory((s) => admin.query(s));
  const back = MODIFIED.every((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).every(([k, h]) => rolled.funcs[k] === h));
  check("rollback: las 6 funciones vuelven a su cuerpo, privilegios y configuración ANTERIORES exactos", back, MODIFIED.filter((n) => Object.entries(baseline.funcs).filter(([k]) => k.startsWith(n + "(")).some(([k, h]) => rolled.funcs[k] !== h)).join(","));
  const stillDiff = Object.entries(baseline.funcs).filter(([k, h]) => rolled.funcs[k] !== h).map(([k]) => k);
  check("rollback: TODAS las funciones anteriores quedan idénticas a la huella inicial", stillDiff.length === 0, stillDiff.join(","));
  check("rollback: las 3 funciones nuevas de 4 argumentos ya no existen", NEW.every((n) => !Object.keys(rolled.funcs).some((k) => k.startsWith(n + "("))) || Object.keys(rolled.funcs).filter((k) => NEW.some((n) => k.startsWith(n + "("))).every((k) => k in baseline.funcs));
  const pD = (await sA.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify((() => { const x = emptyBackup(); x.students = [student("rb1")]; return x; })())])).rows[0];
  const aD = (await sA.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [pD.preview_id])).rows[0];
  check("rollback: con las funciones anteriores una importación sencilla sigue funcionando", aD.summary.total_rows_written === 1);

  await sA.end(); await sB.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
void B;
