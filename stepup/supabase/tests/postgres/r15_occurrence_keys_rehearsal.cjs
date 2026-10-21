// R15 — Las claves de ocurrencia de las series importadas usan el id NUEVO de la serie. Postgres REAL aislado, datos SINTÉTICOS.
//
//   • al importar, las clases y excepciones de las series quedan con la clave «<id nuevo de la serie> + resto de la clave original» (el motor de la web las reconoce);
//   • «deshacer» sigue siendo seguro; el disparador normaliza también lo que se guarde después con la forma vieja;
//   • rollback: vuelve a las claves viejas y quita los disparadores; al reaplicar R15 se corrige lo ya importado (idempotente);
//   • una clave sin el prefijo viejo (serie creada en la web) no se toca.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r15_occurrence_keys_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261021100000_r15_occurrence_keys_use_series_id.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r15_occurrence_keys_rollback.sql"), "utf8");

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function main() {
  const { buildMobileBackup } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { generateOccurrences } = await mod("lib/calendar/recurrence-engine.ts");
  const pg = await start({ port: 5751 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    check("la migración R15 existe y es la última", fs.readdirSync(path.join(ROOT, "supabase", "migrations")).sort().pop().includes("r15_occurrence_keys"));

    const source = buildMobileBackup();
    const validation = validateBackupPayload(source);
    if (!validation.ok) throw new Error("el respaldo sintético no valida");
    await H.reset(admin);
    const s = await H.apiSession(pg, H.A, 300000);
    const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
    const applied = await H.applyOf(s, preview.preview_id, [], []);

    const rules = (await admin.query("select id, legacy_mobile_id from public.recurrence_rules where owner_id = $1", [H.A])).rows;
    const newOf = new Map(rules.map((r) => [r.legacy_mobile_id, r.id]));
    const sourceLessons = source.calendarLessons.filter((l) => l.recurrenceId && l.recurrenceOccurrenceKey);
    const lessonRows = (await admin.query("select legacy_mobile_id, recurrence_id, recurrence_occurrence_key k from public.calendar_lessons where owner_id = $1 and recurrence_id is not null and recurrence_occurrence_key is not null", [H.A])).rows;
    const lessonKey = new Map(lessonRows.map((r) => [r.legacy_mobile_id, r.k]));
    const expectedLesson = (l) => newOf.get(l.recurrenceId) + l.recurrenceOccurrenceKey.slice(l.recurrenceId.length);
    check("hay clases de series con clave en el respaldo", sourceLessons.length >= 1, String(sourceLessons.length));
    check("al importar, la clave de cada clase de una serie = id NUEVO de la serie + el resto de la clave original", sourceLessons.every((l) => lessonKey.get(l.id) === expectedLesson(l)), JSON.stringify(sourceLessons.slice(0, 2).map((l) => [lessonKey.get(l.id), expectedLesson(l)])));
    const excRows = (await admin.query("select recurrence_id, occurrence_key k from public.recurrence_exceptions where owner_id = $1", [H.A])).rows;
    const sourceExc = source.recurrenceExceptions;
    check("…y lo mismo en las excepciones (canceladas/reprogramadas)", excRows.length === sourceExc.length && sourceExc.every((e) => excRows.some((r) => r.recurrence_id === newOf.get(e.recurrenceId) && r.k === newOf.get(e.recurrenceId) + e.occurrenceKey.slice(e.recurrenceId.length))));
    const excDates = (await admin.query("select recurrence_id, occurrence_key k, created_at from public.recurrence_exceptions where owner_id = $1", [H.A])).rows;
    check("la importación conserva la fecha original de creación de cada excepción (la busca por la clave ya traducida)", sourceExc.every((e) => new Date(excDates.find((r) => r.recurrence_id === newOf.get(e.recurrenceId) && r.k === newOf.get(e.recurrenceId) + e.occurrenceKey.slice(e.recurrenceId.length))?.created_at).getTime() === new Date(e.createdAt).getTime()));
    const undo1 = await H.undoPreviewOf(s, applied.import_run_id);
    check("deshacer la importación sigue siendo SEGURO (la instantánea ya trae las claves nuevas)", undo1.is_safe === true, JSON.stringify(undo1.unsafe_rows));

    // El motor de la web reconoce la clave: se genera una ocurrencia real de la serie y se guarda una clase con la clave VIEJA → el disparador la deja igual a la del motor.
    const ruleRow = (await admin.query("select * from public.recurrence_rules where owner_id = $1 and legacy_mobile_id = 'rule-1'", [H.A])).rows[0];
    const engineRule = { recurrenceId: ruleRow.id, studentId: ruleRow.primary_student_id, participantIds: [ruleRow.primary_student_id], cycleLengthWeeks: ruleRow.cycle_length_weeks, weeks: ruleRow.weeks, modality: ruleRow.modality, timezone: ruleRow.timezone, startDate: ruleRow.start_date.toISOString ? ruleRow.start_date.toISOString().slice(0, 10) : String(ruleRow.start_date).slice(0, 10), endDate: null, status: "active", classTitle: ruleRow.class_title, activityKind: ruleRow.activity_kind };
    const occ = generateOccurrences(engineRule, new Date("2026-11-02T00:00:00Z"), new Date("2026-11-08T23:59:00Z"))[0];
    check("el motor genera una ocurrencia cuya clave empieza con el id nuevo de la serie", Boolean(occ) && occ.occurrenceKey.startsWith(ruleRow.id + ":"), occ?.occurrenceKey);
    const legacyKey = "rule-1" + occ.occurrenceKey.slice(ruleRow.id.length);
    const stu = ruleRow.primary_student_id;
    await admin.query("insert into public.calendar_lessons (owner_id, primary_student_id, student_name, level, lesson_type, start_at, end_at, modality, status, color, is_recurring, recurrence_id, recurrence_occurrence_key) values ($1, $2, 'ZQ', 'B1', 'individual', $3, $4, 'online', 'completed', 'blue', true, $5, $6)", [H.A, stu, occ.start, occ.end, ruleRow.id, legacyKey]);
    const stored = (await admin.query("select recurrence_occurrence_key k from public.calendar_lessons where owner_id = $1 and start_at = $2::timestamptz", [H.A, occ.start])).rows[0].k;
    check("una clase guardada después con la clave VIEJA queda con la clave que genera el motor (disparador)", stored === occ.occurrenceKey, `${stored} ≠ ${occ.occurrenceKey}`);
    const other = (await admin.query("select public._normalize_occurrence_key($1::uuid, 'otra-clave:w0:c0') k", [ruleRow.id])).rows[0].k;
    check("una clave que no empieza con el id viejo de la serie no se toca", other === "otra-clave:w0:c0");
    await admin.query("delete from public.calendar_lessons where owner_id = $1 and start_at = $2::timestamptz and recurrence_occurrence_key = $3", [H.A, occ.start, occ.occurrenceKey]);

    // Rollback → claves viejas y sin disparadores; reaplicar → corrige lo ya importado, sin cambiar nada más.
    const snapshot = async () => JSON.stringify((await admin.query("select id, recurrence_occurrence_key from public.calendar_lessons where owner_id = $1 order by id", [H.A])).rows) + JSON.stringify((await admin.query("select id, occurrence_key from public.recurrence_exceptions where owner_id = $1 order by id", [H.A])).rows);
    const withR15 = await snapshot();
    await admin.query(ROLLBACK);
    const triggersAfterRollback = (await admin.query("select count(*)::int n from pg_trigger where tgname = 'normalize_occurrence_key'")).rows[0].n;
    const legacyAgain = (await admin.query("select recurrence_occurrence_key k, legacy_mobile_id from public.calendar_lessons where owner_id = $1 and recurrence_occurrence_key is not null", [H.A])).rows;
    check("rollback: quita los disparadores y las claves vuelven a las de la app anterior", triggersAfterRollback === 0 && sourceLessons.every((l) => legacyAgain.find((r) => r.legacy_mobile_id === l.id)?.k === l.recurrenceOccurrenceKey));
    const undo2 = await H.undoPreviewOf(s, applied.import_run_id);
    check("con el rollback deshacer sigue siendo seguro (la instantánea se refrescó)", undo2.is_safe === true, JSON.stringify(undo2.unsafe_rows));
    await admin.query(MIGRATION);
    check("al reaplicar R15 se corrige lo ya importado: las claves quedan exactamente como al importar con R15", (await snapshot()) === withR15);
    await admin.query(MIGRATION);
    check("aplicada otra vez no cambia nada (idempotente)", (await snapshot()) === withR15);
    const undo3 = await H.undoPreviewOf(s, applied.import_run_id);
    check("…y deshacer sigue siendo seguro", undo3.is_safe === true, JSON.stringify(undo3.unsafe_rows));
    await H.undoApplyOf(s, undo3.undo_preview_id);
    const left = (await admin.query("select (select count(*)::int from public.calendar_lessons where owner_id = $1) + (select count(*)::int from public.recurrence_exceptions where owner_id = $1) + (select count(*)::int from public.recurrence_rules where owner_id = $1) n", [H.A])).rows[0].n;
    check("deshacer deja la cuenta sin clases, excepciones ni series", left === 0, String(left));
    await s.end();
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) {
    console.log("FALLAN:\n - " + failures.join("\n - "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
