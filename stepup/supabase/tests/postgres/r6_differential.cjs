// R6 — Prueba DIFERENCIAL: la importación nueva (por lotes) debe dar EXACTAMENTE el mismo resultado que la anterior con los mismos datos.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   set OLD_MIGRATIONS_DIR=<carpeta con las migraciones ANTERIORES a R6>      (git archive c28e114 supabase/migrations)
//   node supabase/tests/postgres/r6_differential.cjs
//
// Levanta DOS PostgreSQL reales (anterior y nuevo), siembra los mismos datos web con ids deterministas, corre vista previa → decisiones →
// aplicar → deshacer en ambos y compara: clasificación, resumen, TODAS las tablas de negocio (con los ids reemplazados por el id de la app móvil),
// instantáneas y estado tras deshacer. Las únicas diferencias admitidas están documentadas en docs/R6_IMPORTACIONES_GRANDES.md (§ equivalencia).
const assert = require("assert");
const path = require("path");
const { start } = require("./load.cjs");
const { emptyBackup } = require("./r6_dataset.cjs");
const { OWNER, scenarioDuplicatesAndConflicts, scenarioSingletons, scenarioFromGenerator } = require("./r6_scenarios.cjs");


const BUSINESS = [
  "students", "custom_levels", "teacher_profiles", "budget_distribution_settings", "teacher_availability", "surcharge_settings", "training_billing_agreements",
  "student_level_history", "recurrence_rules", "recurrence_rule_participants", "recurrence_exceptions", "calendar_lessons", "calendar_lesson_participants",
  "lesson_registrations", "lesson_registration_students", "lesson_registration_attendance", "lesson_registration_evaluations", "lesson_registration_homework_reviews",
  "package_purchases", "package_credit_movements", "payment_charges", "payments", "payment_allocations", "payment_adjustments",
  "initial_paid_surcharge_corrections", "first_month_proration_decisions",
];
const WITH_LEGACY = BUSINESS.filter((t) => !["teacher_profiles", "budget_distribution_settings", "teacher_availability", "surcharge_settings", "recurrence_rule_participants", "recurrence_exceptions", "calendar_lesson_participants", "lesson_registration_students", "lesson_registration_attendance", "lesson_registration_evaluations", "lesson_registration_homework_reviews"].includes(t));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DROP = new Set(["id", "created_at", "updated_at", "owner_id", "recorded_at"]);

// ---------------------------------------------------------------------------------------------------------------------
// Ejecución y canonicalización
// ---------------------------------------------------------------------------------------------------------------------
async function dump(admin, withSnapshots = null) {
  const rowsByTable = {};
  const idmap = new Map();
  for (const t of BUSINESS) {
    const col = ["teacher_profiles", "budget_distribution_settings", "teacher_availability", "surcharge_settings"].includes(t) ? "owner_id" : "id";
    const r = await admin.query(`select to_jsonb(t) as j from public.${t} t where owner_id = $1`, [OWNER]);
    rowsByTable[t] = r.rows.map((x) => x.j);
    if (WITH_LEGACY.includes(t)) for (const j of rowsByTable[t]) if (j.legacy_mobile_id) idmap.set(j.id, `${t}:${j.legacy_mobile_id}`);
    void col;
  }
  const canon = (j) => {
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (DROP.has(k)) continue;
      out[k] = typeof v === "string" && UUID_RE.test(v) ? (idmap.get(v) ?? v) : v;
    }
    return out;
  };
  const tables = {};
  for (const t of BUSINESS) tables[t] = rowsByTable[t].map((j) => JSON.stringify(canon(j))).sort();
  let snaps = null;
  if (withSnapshots) {
    const r = await admin.query(`select table_name, action, previous_row, new_row from public.import_run_row_snapshots where import_run_id = $1`, [withSnapshots]);
    snaps = r.rows.map((x) => JSON.stringify({ t: x.table_name, a: x.action, p: x.previous_row ? canon(x.previous_row) : null, n: canon(x.new_row) })).sort();
  }
  return { tables, snaps };
}

function normClassification(c) {
  const x = JSON.parse(JSON.stringify(c));
  x.aggregates.financial_components = x.aggregates.financial_components.map((k) => ({ ...k, members: [...k.members].map((m) => `${m.table_name}:${m.legacy_mobile_id}`).sort() })).sort((a, b) => (a.component_id < b.component_id ? -1 : 1));
  return x;
}

async function runScenario(pg, sc, { undo }) {
  const admin = pg.admin;
  await admin.query(`delete from auth.users where id = $1`, [OWNER]);
  await admin.query(`insert into auth.users (id, email) values ($1, 'diff@example.invalid')`, [OWNER]);
  for (const s of sc.seed) await admin.query(s);
  const before = await dump(admin);
  const sess = await pg.session(OWNER);
  const result = { name: sc.name };
  const p = (await sess.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(sc.backup)])).rows[0];
  result.classification = normClassification(p.classification);
  result.previewSummary = p.summary;
  const d = sc.decide(p.classification);
  const a = (await sess.query(`select * from public.apply_backup_import($1::uuid, $2::jsonb, $3::jsonb)`, [p.preview_id, JSON.stringify(d.overrides), JSON.stringify(d.decisions)])).rows[0];
  result.summary = a.summary;
  result.afterApply = await dump(admin, a.import_run_id);
  // reintento: mismo resultado, cero escrituras
  const again = (await sess.query(`select * from public.apply_backup_import($1::uuid, $2::jsonb, $3::jsonb)`, [p.preview_id, JSON.stringify(d.overrides), JSON.stringify(d.decisions)])).rows[0];
  result.retry = { replayed: again.summary.replayed, same: again.import_run_id === a.import_run_id };
  if (undo) {
    const u = (await sess.query(`select * from public.preview_undo_backup_import($1::uuid)`, [a.import_run_id])).rows[0];
    result.undoPreview = { is_safe: u.is_safe, unsafe: u.unsafe_rows.length };
    if (u.is_safe) {
      const r = (await sess.query(`select * from public.apply_undo_backup_import($1::uuid)`, [u.undo_preview_id])).rows[0];
      result.undoSummary = r.summary;
      result.afterUndo = await dump(admin);
      result.restoredEqualsBefore = JSON.stringify(result.afterUndo.tables) === JSON.stringify(before.tables);
    }
  }
  await sess.end();
  return result;
}

function firstDiff(a, b, p = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return `${p}: ${JSON.stringify(a)?.slice(0, 200)}  ≠  ${JSON.stringify(b)?.slice(0, 200)}`;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; }
  return null;
}

async function main() {
  const oldDir = process.env.OLD_MIGRATIONS_DIR;
  if (!oldDir) throw new Error("Falta OLD_MIGRATIONS_DIR (migraciones anteriores a R6).");
  const oldPg = await start({ port: 5521, migrationsDir: oldDir });
  const newPg = await start({ port: 5522 });
  if (oldPg.failures.length || newPg.failures.length) { console.log("migraciones con error", oldPg.failures, newPg.failures); process.exit(1); }
  const scenarios = [
    { name: "vacio", backup: emptyBackup(), seed: [], links: false, decide: () => ({ overrides: [], decisions: [] }), undoComparable: true },
    scenarioFromGenerator("minimo", 3, { selfLinks: false }),
    scenarioFromGenerator("normal_sin_vinculos", 300, { selfLinks: false }),
    scenarioFromGenerator("normal_con_vinculos", 300, {}),
    scenarioFromGenerator("alumnos_pesado", 400, { profile: "students_heavy", selfLinks: false }),
    scenarioFromGenerator("financiero_pesado", 400, { profile: "financial_heavy", selfLinks: false }),
    scenarioFromGenerator("financiero_cadena_y_gigante", 300, { profile: "financial_heavy", chainReplaces: true, giantComponent: true }),
    scenarioDuplicatesAndConflicts(),
    scenarioSingletons(),
  ];
  let failed = 0;
  for (const sc of scenarios) {
    const undo = sc.undoComparable ?? false;
    const o = await runScenario(oldPg, sc, { undo });
    const n = await runScenario(newPg, sc, { undo });
    const diffs = [];
    const cmp = (label, a, b) => { const d = firstDiff(a, b); if (d) diffs.push(`${label} → ${d}`); };
    cmp("clasificación", o.classification, n.classification);
    cmp("resumen de la vista previa", o.previewSummary, n.previewSummary);
    cmp("resumen", { c: o.summary.counts_by_table, t: o.summary.total_rows_written }, { c: n.summary.counts_by_table, t: n.summary.total_rows_written });
    cmp("tablas tras aplicar", o.afterApply.tables, n.afterApply.tables);
    // Con vínculos entre filas de la misma tabla la versión anterior dejaba la instantánea DESACTUALIZADA (segunda pasada): se compara sin esas 4 tablas.
    const strip = (snaps) => (sc.links ? snaps.filter((s) => !/"t":"(calendar_lessons|recurrence_rules|payments|lesson_registrations)"/.test(s)) : snaps);
    cmp("instantáneas", strip(o.afterApply.snaps), strip(n.afterApply.snaps));
    cmp("reintento", o.retry, n.retry);
    if (undo) {
      cmp("vista previa de deshacer", o.undoPreview, n.undoPreview);
      cmp("resumen de deshacer", o.undoSummary, n.undoSummary);
      cmp("tablas tras deshacer", o.afterUndo?.tables, n.afterUndo?.tables);
      if (!(o.restoredEqualsBefore && n.restoredEqualsBefore)) diffs.push(`deshacer no restauró el estado previo (antes=${o.restoredEqualsBefore}, ahora=${n.restoredEqualsBefore})`);
    }
    const written = n.summary.total_rows_written;
    console.log(`${diffs.length ? "✗" : "✓"} ${sc.name.padEnd(40)} filas escritas: ${written}${undo ? `, deshacer: ${n.undoPreview.is_safe ? "ok" : "bloqueado"}` : ""}`);
    for (const d of diffs) console.log("    · " + d);
    if (diffs.length) failed++;
  }
  await oldPg.stop();
  await newPg.stop();
  console.log(failed ? `\n${failed} escenario(s) con diferencias` : "\nTodos los escenarios coinciden con la versión anterior.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
void assert; void path;
