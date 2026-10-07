// R6 — Mutaciones de la importación grande. Cada una modifica A PROPÓSITO el texto de una migración (restaura el comportamiento cuadrático, rompe la
// atomicidad, la idempotencia, el lock, los límites, las cuotas, el aislamiento entre cuentas, las instantáneas o el deshacer), carga las migraciones
// mutadas en un Postgres real y corre las secciones de `r6_import.cjs` que cubren esa garantía: la mutación está DETECTADA si alguna comprobación falla.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const F1 = "20261010100000_r6_import_limits_and_helpers.sql";
const F2 = "20261010110000_r6_import_preview_set_based.sql";
const F3 = "20261010120000_r6_import_apply_set_based.sql";
const F4 = "20261010130000_r6_import_undo_set_based.sql";

const MUTATIONS = [
  {
    name: "vista previa vuelve a clasificar por elemento (cuadrática)",
    only: "scaling",
    edits: [[F2, "public._import_classify_students(v_owner, p_payload)", "public._classify_students(v_owner, p_payload)"], [F2, "public._import_classify_recurrence_rules(v_owner, p_payload, v_students)", "public._classify_recurrence_rules(v_owner, p_payload, v_students)"], [F2, "public._import_classify_calendar_lessons(v_owner, p_payload, v_students)", "public._classify_calendar_lessons(v_owner, p_payload, v_students)"], [F2, "public._import_classify_lesson_registrations(v_owner, p_payload, v_students)", "public._classify_lesson_registrations(v_owner, p_payload, v_students)"], [F2, "public._import_classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations)", "public._classify_financial_components(v_owner, p_payload, v_students, v_training_agreements, v_calendar, v_lesson_registrations)"]],
  },
  {
    name: "aplicación vuelve a escribir fila por fila (cuotas de R3 por fila, búsquedas lineales)",
    only: "scaling,undo",
    edits: [
      [F3, "perform public._import_apply_students(v_run_id, v_owner, p_preview_id);", "perform public._apply_students(v_run_id, v_owner, v_payload, v_preview.classification, p_field_overrides, p_duplicate_decisions);"],
      [F3, "perform public._import_apply_calendar_lessons(v_run_id, v_owner);", "perform public._apply_calendar_lessons(v_run_id, v_owner, v_payload, v_preview.classification);"],
      [F3, "perform public._import_apply_lesson_registrations(v_run_id, v_owner);", "perform public._apply_lesson_registrations(v_run_id, v_owner, v_payload, v_preview.classification);"],
      [F3, "perform public._import_apply_financial(v_run_id, v_owner);", "perform public._apply_financial_components(v_run_id, v_owner, v_payload, v_preview.classification);"],
    ],
  },
  {
    name: "se traga un error a mitad de la aplicación (rompe la atomicidad)",
    only: "midfailure",
    edits: [[F3, "perform public._import_apply_financial(v_run_id, v_owner);", "begin perform public._import_apply_financial(v_run_id, v_owner); exception when others then null; end;"]],
  },
  {
    name: "el reintento no se reconoce como repetido (rompe la idempotencia)",
    only: "lost,concurrent",
    edits: [[F3, "v_summary || jsonb_build_object('replayed', true)", "v_summary || jsonb_build_object('replayed', false)"]],
  },
  {
    name: "se quita el lock de la cuenta",
    only: "concurrent",
    edits: [[F3, "perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));", "null;"]],
  },
  {
    name: "el lock de la cuenta se toma ANTES del análisis",
    only: "concurrent",
    edits: [[F3, "  perform public._import_validate_selection(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);", "  perform pg_advisory_xact_lock(hashtext('backup_import:' || v_owner::text));\n  perform public._import_validate_selection(p_preview_id, v_preview.classification, p_field_overrides, p_duplicate_decisions);"]],
  },
  {
    name: "se agranda el máximo de trabajo",
    only: "limits",
    edits: [[F1, "'max_work_units', 7500", "'max_work_units', 75000000"]],
  },
  {
    name: "la vista previa no controla los límites",
    only: "limits",
    edits: [[F2, "  perform public._import_check_payload(p_payload);", "  null;"]],
  },
  {
    name: "no se proyectan las cuotas de R3 al previsualizar",
    only: "quotas",
    edits: [[F2, "  perform public._import_project_quotas(v_owner, v_classification);", "  null;"]],
  },
  {
    name: "se aceptan datos repetidos dentro de la copia",
    only: "duplicates",
    edits: [[F2, "    raise exception 'El backup tiene datos repetidos.' using errcode = '22023';", "    null;"]],
  },
  {
    name: "las instantáneas quedan desactualizadas (segunda pasada que modifica filas ya registradas)",
    only: "undo,duplicates",
    edits: [[F3, "    select p_run_id, 'calendar_lesson_participants', i.id, 'inserted', null, to_jsonb(i) from ins i;", "    select p_run_id, 'calendar_lesson_participants', i.id, 'inserted', null, to_jsonb(i) from ins i;\n  update public.calendar_lessons set notes = coalesce(notes, '') where owner_id = p_owner and id in (select new_id from _ia_lsn);"]],
  },
  {
    name: "deshacer no re-verifica que las filas importadas sigan iguales",
    only: "undo",
    edits: [[F4, "  if exists (select 1 from _iu_state where not ok) then", "  if false then"]],
  },
  {
    name: "deshacer no comprueba dependencias creadas después",
    only: "undo",
    edits: [[F4, "  if exists (select 1 from _iu_blockers) then", "  if false then"]],
  },
  {
    name: "no se verifican las huellas de lo que la usuaria vio",
    only: "duplicates",
    edits: [[F3, "  if v_bad then", "  if false then"]],
  },
  {
    name: "las decisiones y reemplazos no se validan",
    only: "duplicates",
    edits: [[F3, "  if v_code is not null then raise exception '%', v_code using errcode = '22023'; end if;", "  null;"]],
  },
  {
    name: "la clasificación de alumnos deja de filtrar por cuenta (fuga entre propietarias)",
    only: "parallel,references",
    edits: [[F2, "left join public.students s on s.owner_id = p_owner and s.legacy_mobile_id = b.r ->> 'id'", "left join public.students s on s.legacy_mobile_id = b.r ->> 'id'"]],
  },
  {
    name: "la instantánea de alumnos agregados guarda una fila distinta de la real",
    only: "undo,duplicates",
    edits: [[F3, "select p_run_id, 'students', i.id, 'inserted', null, to_jsonb(i) from ins i;", "select p_run_id, 'students', i.id, 'inserted', null, to_jsonb(i) || '{\"x\": 1}'::jsonb from ins i;"]],
  },
];

async function run({ runAll, state, reset }) {
  let undetected = 0;
  for (const [i, m] of MUTATIONS.entries()) {
    if (process.env.MUT && !m.name.includes(process.env.MUT)) continue;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-r6-mut-"));
    for (const f of fs.readdirSync(MIG)) fs.copyFileSync(path.join(MIG, f), path.join(dir, f));
    for (const [file, from, to] of m.edits) {
      const p = path.join(dir, file);
      const text = fs.readFileSync(p, "utf8");
      if (!text.includes(from)) throw new Error(`La mutación «${m.name}» no encontró su texto en ${file}`);
      fs.writeFileSync(p, text.split(from).join(to));
    }
    const pg = await start({ port: 5610 + i, migrationsDir: dir });
    reset();
    process.env.ONLY = m.only;
    let crashed = null;
    try {
      if (pg.failures.length) crashed = `migraciones: ${pg.failures[0][1]}`;
      else await runAll(pg, { quick: true });
    } catch (e) {
      crashed = String(e.message).split("\n")[0];
    }
    const { failures, total } = state();
    const detected = failures.length > 0 || crashed !== null;
    console.log(`${detected ? "✔ detectada " : "✘ NO DETECTADA"}  ${m.name}  [${total} comprobaciones, ${failures.length} fallan${crashed ? ", se interrumpió: " + crashed.slice(0, 90) : ""}]`);
    if (!detected) undetected += 1;
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(undetected ? `\n${undetected} mutación(es) SIN detectar` : `\nLas ${MUTATIONS.length} mutaciones se detectan.`);
  return undetected ? 1 : 0;
}

module.exports = { run, MUTATIONS };
