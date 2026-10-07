// R6.1 — Mutaciones de la corrección funcional. Cada una modifica A PROPÓSITO el texto de una migración (rompe el orden de las fases, el mapa de ids, la suma
// 100 del presupuesto, la detección de niveles repetidos, el aislamiento entre cuentas, la idempotencia o el costo lineal), carga las migraciones mutadas en un
// Postgres real y corre las secciones de `r61_import.cjs` que cubren esa garantía: la mutación está DETECTADA si alguna comprobación falla.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("./load.cjs");

const MIG = path.join(__dirname, "..", "..", "migrations");
const F3 = "20261010120000_r6_import_apply_set_based.sql";
const F4 = "20261010130000_r6_import_undo_set_based.sql";
const F5 = "20261011100000_r61_import_dependencies_budget_levels.sql";

const MUTATIONS = [
  {
    name: "orden de fases: las series se clasifican sin los acuerdos que agrega la misma copia",
    only: "chain,mixed",
    edits: [[F5, "public._import_classify_recurrence_rules(v_owner, p_payload, v_students, v_training_agreements)", "public._import_classify_recurrence_rules(v_owner, p_payload, v_students, '[]'::jsonb)"]],
  },
  {
    name: "orden de fases: las clases se clasifican sin las series que agrega la misma copia",
    only: "chain,mixed",
    edits: [[F5, "public._import_classify_calendar_lessons(v_owner, p_payload, v_students, v_recurrence)", "public._import_classify_calendar_lessons(v_owner, p_payload, v_students, '[]'::jsonb)"]],
  },
  {
    name: "orden de fases: los registros se clasifican sin las clases que agrega la misma copia",
    only: "chain,mixed",
    edits: [[F5, "public._import_classify_lesson_registrations(v_owner, p_payload, v_students, v_calendar)", "public._import_classify_lesson_registrations(v_owner, p_payload, v_students, '[]'::jsonb)"]],
  },
  {
    name: "mapa de ids: lo que la importación va a agregar no se cuenta como disponible",
    only: "chain,independent",
    edits: [[F5, "where (e ->> 'status') is null or e ->> 'status' = 'insertable'", "where false"]],
  },
  {
    name: "mapa de ids: se cuentan también las series omitidas (una clase de una serie omitida quedaría importable)",
    only: "chain",
    edits: [[F5, "where (e ->> 'status') is null or e ->> 'status' = 'insertable'", "where true"]],
  },
  {
    name: "mapa de ids sin filtrar por cuenta (un acuerdo o una serie de OTRA propietaria se vería disponible)",
    only: "owners",
    edits: [
      [F5, "where a.owner_id = p_owner and a.legacy_mobile_id is not null", "where a.legacy_mobile_id is not null"],
      [F5, "where r.owner_id = p_owner and r.legacy_mobile_id is not null", "where r.legacy_mobile_id is not null"],
    ],
  },
  {
    name: "una clase SIN alumno principal se considera importable",
    only: "chain",
    edits: [[F5, "(b.r ->> 'primaryStudentId' is not null and st.a is not null) as stu_ok", "(b.r ->> 'primaryStudentId' is null or st.a is not null) as stu_ok"]],
  },
  {
    name: "orden de fases al escribir: las clases se agregan ANTES que las series (ids que no se resuelven)",
    only: "chain,independent",
    edits: [[F3, "  perform public._import_apply_recurrence_rules(v_run_id, v_owner);\n  perform public._import_apply_calendar_lessons(v_run_id, v_owner);", "  perform public._import_apply_calendar_lessons(v_run_id, v_owner);\n  perform public._import_apply_recurrence_rules(v_run_id, v_owner);"]],
  },
  {
    name: "orden de fases al escribir: los cobros se agregan ANTES que los registros",
    only: "chain",
    edits: [[F3, "  perform public._import_apply_lesson_registrations(v_run_id, v_owner);\n  perform public._import_apply_financial(v_run_id, v_owner);", "  perform public._import_apply_financial(v_run_id, v_owner);\n  perform public._import_apply_lesson_registrations(v_run_id, v_owner);"]],
  },
  {
    name: "mapa de ids al escribir: las clases pierden el vínculo con su serie importada",
    only: "chain,independent",
    edits: [[F3, "left join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = b.recurrence_lid", "left join public.recurrence_rules rr on rr.owner_id = p_owner and rr.legacy_mobile_id = b.lid"]],
  },
  {
    name: "mapa de ids al escribir: los registros pierden el vínculo con su clase importada",
    only: "chain,independent",
    edits: [[F3, "left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = s.calendar_lesson_lid", "left join public.calendar_lessons cl on cl.owner_id = p_owner and cl.legacy_mobile_id = s.lid"]],
  },
  {
    name: "mapa de ids al escribir: los cobros pierden el vínculo con su registro importado",
    only: "chain,independent",
    edits: [[F3, "left join public.lesson_registrations lr on lr.owner_id = p_owner and lr.legacy_mobile_id = s.saved_lesson_lid", "left join public.lesson_registrations lr on lr.owner_id = p_owner and lr.legacy_mobile_id = s.lid"]],
  },
  {
    name: "mapa de ids al escribir: «reemplaza a» de una serie no resuelve la serie de la misma copia",
    only: "chain",
    edits: [[F3, "s.effective_from_date, s.class_title, s.activity_kind, ag.id, coalesce(prev.new_id, w.id)", "s.effective_from_date, s.class_title, s.activity_kind, ag.id, w.id"]],
  },
  {
    name: "mapa de ids al escribir: la clase «liberada por» otra no resuelve la clase de la misma copia",
    only: "chain",
    edits: [[F3, "coalesce(fl.new_id, fw.id)", "fw.id"]],
  },
  {
    name: "el reintento no se reconoce como repetido (rompe la idempotencia)",
    only: "chain,levels,budget",
    edits: [[F3, "v_summary || jsonb_build_object('replayed', true)", "v_summary || jsonb_build_object('replayed', false)"]],
  },
  {
    name: "se traga un error a mitad de la aplicación (rompe la atomicidad)",
    only: "midfailure",
    edits: [[F3, "perform public._import_apply_financial(v_run_id, v_owner);", "begin perform public._import_apply_financial(v_run_id, v_owner); exception when others then null; end;"]],
  },
  {
    name: "presupuesto: los porcentajes se actualizan de a UNO (la suma se comprueba por sentencia)",
    only: "budget",
    edits: [
      [F5, "  if p_table_name = 'budget_distribution_settings' then\n    -- Estado final", "  if false then\n    -- Estado final"],
      [F5, "        when 'teacher_availability:timezone' then", "        when 'budget_distribution_settings:needs_percent' then update public.budget_distribution_settings set needs_percent = (p_backup_doc->'distribution'->>'needs')::smallint where owner_id = p_owner;\n        when 'budget_distribution_settings:wants_percent' then update public.budget_distribution_settings set wants_percent = (p_backup_doc->'distribution'->>'wants')::smallint where owner_id = p_owner;\n        when 'budget_distribution_settings:savings_percent' then update public.budget_distribution_settings set savings_percent = (p_backup_doc->'distribution'->>'savings')::smallint where owner_id = p_owner;\n        when 'teacher_availability:timezone' then"],
    ],
  },
  {
    name: "presupuesto: no se valida que la suma final sea 100 (ni antes ni durante la escritura)",
    only: "budget",
    edits: [
      [F5, "if v_n + v_w + v_s <> 100 then", "if false then"],
      [F5, "if v_needs + v_wants + v_savings <> 100 then", "if false then"],
    ],
  },
  {
    name: "presupuesto: deshacer no restaura los porcentajes",
    only: "budget",
    edits: [[F4, "s.table_name = 'budget_distribution_settings' and s.action in ('field_overwritten', 'identity_linked')", "s.table_name = 'budget_distribution_settings' and s.action = 'nunca'"]],
  },
  {
    name: "niveles: un nivel repetido DENTRO de la copia se agrega igual",
    only: "levels",
    edits: [[F5, "else 'dup_copy' end as kind", "else 'insert' end as kind"]],
  },
  {
    name: "niveles: un nivel repetido de la web se agrega igual",
    only: "levels",
    edits: [[F5, "when wn.id is not null then 'dup_web'", "when false then 'dup_web'"], [F5, "where m.cid is null and m.nn <> '' and webn.id is null", "where m.cid is null and m.nn <> ''"]],
  },
  {
    name: "niveles: un nivel sin nombre ya no se distingue",
    only: "levels",
    edits: [[F5, "when m.nn = '' then 'blank'", "when false then 'blank'"]],
  },
  {
    name: "niveles: la aplicación no vigila nombres repetidos que aparecen después de revisar",
    only: "levels",
    edits: [[F5, "  if exists (select 1 from _ia_cl_new s join public.custom_levels w on w.owner_id = p_owner and lower(btrim(w.name)) = lower(s.name))", "  if false and exists (select 1 from _ia_cl_new s join public.custom_levels w on w.owner_id = p_owner and lower(btrim(w.name)) = lower(s.name))"]],
  },
  {
    name: "niveles: un reemplazo de nombre que choca con otro nivel no tiene mensaje propio",
    only: "levels",
    edits: [
      [F5, "    if exists (select 1 from _ia_cl_ren n join public.custom_levels x", "    if false and exists (select 1 from _ia_cl_ren n join public.custom_levels x"],
      [F5, "    when unique_violation then\n      raise exception 'Ya existe otro nivel con ese nombre.' using errcode = '22023';", "    when unique_violation then\n      raise;"],
    ],
  },
  {
    name: "costo: las referencias a clases se resuelven con una llamada al mapa de ids POR REGISTRO",
    only: "scale",
    edits: [[F5, "        left join cl on cl.a = b.r ->> 'calendarLessonId'", "        left join lateral (select x as a from public._import_available_ids('calendar_lessons', p_owner, case when b.ord > 0 then p_lessons_classified end) x where x = b.r ->> 'calendarLessonId' limit 1) cl on true"]],
  },
];

function normalize(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n"));
  }
}

async function run({ runAll, state, reset }) {
  let undetected = 0;
  for (const [i, m] of MUTATIONS.entries()) {
    if (process.env.MUT && !m.name.includes(process.env.MUT)) continue;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-r61-mut-"));
    for (const f of fs.readdirSync(MIG)) fs.copyFileSync(path.join(MIG, f), path.join(dir, f));
    normalize(dir);
    for (const [file, from, to] of m.edits) {
      const p = path.join(dir, file);
      const text = fs.readFileSync(p, "utf8");
      if (!text.includes(from)) throw new Error(`La mutación «${m.name}» no encontró su texto en ${file}`);
      fs.writeFileSync(p, text.split(from).join(to));
    }
    const pg = await start({ port: 5720 + i, migrationsDir: dir });
    reset();
    process.env.ONLY = m.only;
    let crashed = null;
    try {
      if (pg.failures.length) crashed = `migraciones: ${pg.failures[0][1]}`;
      else await runAll(pg, { quick: m.only !== "scale" });
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
