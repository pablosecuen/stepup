// Ensayo del TRASLADO desde la app móvil, en Postgres REAL (embedded-postgres 17.x, fuera del repo) con datos SINTÉTICOS. Nunca toca Production.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/transfer_rehearsal.cjs                (ensayo completo: importar, extraer del teléfono y comparar origen ↔ destino)
//   node supabase/tests/postgres/transfer_rehearsal.cjs --before-r10   (sólo hasta R9: muestra lo que R10 cierra)
//   node supabase/tests/postgres/transfer_rehearsal.cjs --before-r9    (la base de Production de hoy: muestra lo que R9 y R10 cierran)
//   node supabase/tests/postgres/transfer_rehearsal.cjs --write-golden (además, regenera lib/backup/__fixtures__/mobile-real-shape.destination.json para las pruebas sin Postgres)
//
// El respaldo es `lib/backup/__fixtures__/mobile-real-shape.ts`: la forma REAL que escribe la app (controlada campo por campo contra los tipos del móvil).
// El ensayo hace lo mismo que la web haría con la cuenta real: validar y adaptar → vista previa → confirmar → leer lo que quedó en la base → comparar
// campo por campo → registrar los archivos del teléfono → comparar de nuevo → alterar el volcado a propósito (el comparador tiene que notarlo) → deshacer.
const crypto = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const { A, reset, previewOf, applyOf, undoPreviewOf, undoApplyOf, apiSession } = H;
const BEFORE_R9 = process.argv.includes("--before-r9");
const BEFORE_R10 = process.argv.includes("--before-r10");
const WRITE_GOLDEN = process.argv.includes("--write-golden");
const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let failures = [];
let total = 0;
function check(name, cond, detail = "") {
  total += 1;
  const ok = Boolean(cond);
  if (!ok) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${ok ? "✓" : "✗"} ${name}${!ok && detail ? "  → " + detail : ""}`);
}
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Volcado de SÓLO LECTURA de lo que la cuenta tiene en la base (todas las tablas de negocio con owner_id, menos las técnicas de importación). */
async function dumpDestination(admin, uid) {
  const tables = (await admin.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'owner_id' order by 1`)).rows.map((r) => r.table_name);
  const dump = {};
  for (const t of tables) {
    if (/^(import_|account_|action_|quota|billing_|report_draft|report_pdf|student_creation)/.test(t) && t !== "import_source_archives") continue;
    dump[t] = (await admin.query(`select to_jsonb(x) as r from public.${t} x where owner_id = $1`, [uid])).rows.map((r) => r.r);
  }
  return dump;
}
const clone = (v) => JSON.parse(JSON.stringify(v));

async function main() {
  const { buildMobileBackup, buildPhoneExtraction } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { compareTransfer } = await mod("lib/backup/transfer-compare.ts");
  const { runPhoneExtraction } = await mod("lib/phone-extraction/runner.ts");
  const source = buildMobileBackup();
  const phone = buildPhoneExtraction();

  const upTo = BEFORE_R9 ? "20261014120000_m2_billing_ops.sql" : BEFORE_R10 ? "20261019100000_r9_transfer_archive_and_histories.sql" : null;
  const pg = await start({ port: 5611, upTo });
  if (pg.failures.length) {
    console.log("migraciones con error:", pg.failures);
    process.exit(1);
  }
  const { admin } = pg;
  await reset(admin);
  const s = await apiSession(pg, A, 60000);
  const FULL = !BEFORE_R9 && !BEFORE_R10;

  // 1) Validación + adaptación (lo mismo que hace la acción de la web antes de llamar a la base).
  const validation = validateBackupPayload(source);
  check("la validación acepta un respaldo real de la app (formato móvil)", validation.ok, validation.ok ? "" : JSON.stringify(validation.errors));
  if (!validation.ok) {
    await pg.stop();
    console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
    process.exit(1);
  }
  const adaptation = validation.adaptation;
  check("el adaptador reconoce el formato móvil y no omite ninguna fila ni deja campos sin conocer", adaptation.shape === "mobile" && adaptation.omitted.length === 0 && adaptation.notRepresented.length === 0, JSON.stringify([adaptation.omitted, adaptation.notRepresented]));

  // 2) Vista previa y confirmación (cuenta vacía: todo se agrega, nada que decidir).
  const preview = await previewOf(s, validation.backup, validation.excludedCollections);
  const cls = preview.classification;
  check("vista previa: los alumnos se agregan todos (sin conflictos ni posibles duplicados)", cls.maestros.students.inserts.length === 4 && cls.maestros.students.conflicts.length === 0 && cls.maestros.students.duplicates.length === 0, JSON.stringify(cls.maestros.students).slice(0, 200));
  const skipped = (list) => list.filter((e) => e.status !== "insertable").map((e) => `${e.legacy_mobile_id}:${e.reason ?? e.status}`);
  check("vista previa: series, clases y registros se agregan todos (ninguno omitido)", skipped(cls.aggregates.recurrence_rules).length + skipped(cls.aggregates.calendar_lessons).length + skipped(cls.aggregates.lesson_registrations).length === 0, [...skipped(cls.aggregates.recurrence_rules), ...skipped(cls.aggregates.calendar_lessons), ...skipped(cls.aggregates.lesson_registrations)].join(" | "));
  const comps = cls.aggregates.financial_components;
  check("vista previa: cobros y pagos se agregan todos (ningún componente omitido)", comps.every((c) => c.status === "insertable"), comps.filter((c) => c.status !== "insertable").map((c) => c.reason ?? c.status).join(" | "));
  const applied = await applyOf(s, preview.preview_id, [], []);
  check("confirmar: la importación se aplica", Boolean(applied && applied.import_run_id), JSON.stringify(applied).slice(0, 160));

  // 3) Comparación origen ↔ destino, campo por campo.
  const dump = await dumpDestination(admin, A);
  const cmp = compareTransfer(source, dump, { adapterOmitted: adaptation.omitted, revealValues: true });
  console.log("\nEntidades (origen → web):");
  for (const e of cmp.entities) console.log(`  ${e.ok ? "✓" : "✗"} ${e.entity.padEnd(34)} origen ${String(e.source).padStart(3)}  esperadas ${String(e.expected).padStart(3)}  web ${String(e.destination).padStart(3)}${e.missing.length ? "  FALTAN: " + e.missing.join(", ") : ""}`);
  console.log("\nCampos que NO coinciden:");
  const bad = cmp.fields.filter((f) => f.mismatched > 0);
  if (bad.length === 0) console.log("  (ninguno)");
  for (const f of bad) console.log(`  ✗ ${f.entity} · ${f.field}: ${f.mismatched}/${f.checked}  ej.: ${f.examples.map((e) => `${e.id}: «${e.source}» ≠ «${e.destination}»`).join(" · ")}`);
  console.log("\nClaves del origen sin declarar:", cmp.undeclared.length ? JSON.stringify(cmp.undeclared) : "(ninguna)");
  console.log("Duplicados:", cmp.duplicates.length ? JSON.stringify(cmp.duplicates) : "(ninguno)");
  console.log(`Resumen: ${cmp.summary.rowsFound}/${cmp.summary.rowsExpected} filas, ${cmp.summary.fieldChecks} campos comparados, ${cmp.summary.fieldMismatches} diferencias.`);

  for (const e of cmp.entities) check(`entidad: ${e.entity} (${e.table})`, e.ok, `faltan ${e.missing.join(", ") || "-"}`);
  check(`campos: ${cmp.summary.fieldChecks} comparaciones campo por campo, ninguna diferencia`, cmp.summary.fieldMismatches === 0, bad.map((f) => `${f.entity}·${f.field}`).join(", "));
  check("claves del origen sin destino: ninguna", cmp.undeclared.length === 0, JSON.stringify(cmp.undeclared));
  check("duplicados: ningún identificador de origen repetido", cmp.duplicates.length === 0);
  const filesBefore = Object.fromEntries(cmp.files.map((f) => [f.kind, f]));
  if (FULL) {
    check("archivos: adjuntos, materiales y PDF figuran como PENDIENTES de extraer (todavía no hay nada que mostrar)", filesBefore.adjunto.pending === 1 && filesBefore.reporte_pdf.pending === 1 && filesBefore.material.pending === 1, JSON.stringify(filesBefore));
    check("veredicto ANTES de extraer los archivos: NO completo (y la única razón son los archivos)", cmp.verdict.complete === false && cmp.verdict.reasons.every((r) => r.startsWith("Archivos")), JSON.stringify(cmp.verdict.reasons));
  }

  // 4) Detalles que importan para el uso diario.
  const rows = (t) => dump[t] ?? [];
  const reg = Object.fromEntries(rows("lesson_registrations").map((r) => [r.legacy_mobile_id, r]));
  const students = Object.fromEntries(rows("students").map((r) => [r.legacy_mobile_id, r]));
  const uuidOf = (table, legacy) => rows(table).find((r) => r.legacy_mobile_id === legacy)?.id;
  check("registro «alumno ausente»: queda como clase dictada con asistencia «ausente»", reg["les-3"]?.outcome === "clase_dictada" && rows("lesson_registration_attendance").some((a) => a.lesson_registration_id === reg["les-3"].id && a.status === "ausente"));
  check("registro «cancelada tarde»: conserva política y porcentaje", reg["les-4"]?.outcome === "cancelada_tarde" && reg["les-4"].late_cancellation_policy === "cobrar_porcentaje" && Number(reg["les-4"].late_cancellation_percentage) === 50);
  check("registro «reprogramada»: apunta al registro anterior", reg["les-5"]?.rescheduled_from_registration_id === reg["les-4"]?.id);
  check("alumno 1: fecha de alta, nacimiento y plan de cobro (instantes pasados al día de Argentina)", students["stu-1"]?.date_joined === "2026-03-02" && students["stu-1"]?.birth_date === "1990-05-17" && students["stu-1"]?.billing_plan?.pendingAmount === 45000.12);
  const money = Object.fromEntries(rows("payment_charges").map((r) => [r.legacy_mobile_id, r]));
  check("cobros: tipo, importe, período y anulación", money["chg-1"]?.charge_type === "mensual" && Number(money["chg-1"].original_amount) === 41000.37 && money["chg-1"].billing_period === "2026-10" && money["chg-5"]?.voided_at && money["chg-5"].void_reason === "ZQ cobro cargado por error");

  if (FULL) {
    const archives = (await admin.query("select source_payload from public.import_source_archives where owner_id = $1", [A])).rows;
    check("archivo del origen: una copia por importación confirmada", archives.length === 1);

    // Estado de los registros grupales.
    const parts = (legacy) => rows("lesson_registration_students").filter((p) => p.lesson_registration_id === reg[legacy].id).map((p) => `${rows("students").find((st) => st.id === p.student_id).legacy_mobile_id}:${p.participant_status}:${p.participant_position}`).sort();
    check("registro grupal A MEDIAS: queda «en curso» con el estado y el orden de cada participante", reg["les-2"].status === "in_progress" && JSON.stringify(parts("les-2")) === JSON.stringify(["stu-2:completed:0", "stu-3:pending:1"]), JSON.stringify(parts("les-2")));
    check("registro grupal FINALIZADO: todos los participantes quedan «completados» (como lo deja la web al finalizar)", reg["les-9"].status === "completed" && parts("les-9").every((p) => p.includes(":completed:")), JSON.stringify(parts("les-9")));
    check("registro individual finalizado: el participante queda «completado»", parts("les-1").every((p) => p.includes(":completed:")), JSON.stringify(parts("les-1")));

    // Contenido pedagógico.
    const les1 = reg["les-1"];
    check("clase 1: temas con su estado, objetivos, actividades, notas, notas internas y materiales", JSON.stringify(les1.topics.map((t) => [t.id, t.text, t.status])) === JSON.stringify([["top-1", "ZQ tema visto uno", "visto"], ["top-2", "ZQ tema planificado dos", "planificado"]]) && les1.objectives[0] === "ZQ objetivo de la clase" && les1.activities[0] === "ZQ actividad uno" && les1.activity_notes === "ZQ notas de actividades" && les1.internal_notes === "ZQ notas internas de la clase" && les1.material_ids[0] === "mat-1");
    check("clase 1: fechas ORIGINALES de creación y edición (no la fecha de la importación)", Date.parse(les1.created_at) === Date.parse("2026-10-13T14:20:00.000Z") && Date.parse(les1.updated_at) === Date.parse("2026-10-13T14:30:00.000Z"));
    check("clase 1: cronómetro, puntualidad, reserva de calendario e importes por alumno conservados", les1.source_extras.studentArrival.status === "within_grace" && les1.source_extras.calendarReservationKey === "rule-1:2026-10-13:0" && les1.source_extras.billedAmountByStudent["stu-1"] === 9000.61 && les1.source_extras.sessionUpdatedAt === "2026-10-13T14:12:00.000Z");
    check("«alumno ausente»: el resultado original queda en el registro", reg["les-3"].source_event_type === "alumno_ausente");

    // Notas fuera de rango.
    const ev8 = rows("lesson_registration_evaluations").find((e) => e.lesson_registration_id === reg["les-8"].id);
    check("notas fuera de rango: la nota válida queda vacía pero el valor ORIGINAL se conserva y se marca para revisión", ev8.general_grade === null && ev8.source_grades.generalGrade === 12 && ev8.source_grades.skillGrades.listening === "ocho" && ev8.source_grades.skillGrades.speaking === 0 && JSON.stringify(Object.keys(ev8.skill_grades)) === JSON.stringify(["writing"]) && ev8.source_grades.flags.includes("generalGrade:out_of_range") && ev8.source_grades.flags.includes("skillGrades.speaking:unset") && ev8.source_grades.flags.includes("skillGrades.grammar:out_of_range"), JSON.stringify(ev8.source_grades));

    // Historial de ediciones y adjuntos.
    const edits = rows("lesson_registration_edit_history").filter((h) => h.lesson_registration_id === les1.id);
    check("historial de ediciones: la versión anterior de la clase llegó íntegra", edits.length === 1 && edits[0].previous_snapshot.previousForm.internalNotes === "ZQ nota previa a la edición" && edits[0].previous_snapshot.previousBilledAmount === 8000.11);
    const att = rows("lesson_attachments");
    check("adjuntos: la fila existe con su nombre, tipo, alumno y estado «pendiente» (el archivo está en el teléfono)", att.length === 1 && att[0].name === "ZQ guia.pdf" && att[0].student_id === uuidOf("students", "stu-1") && att[0].file_status === "pendiente" && att[0].size_bytes === 20480);

    // Fechas originales de finanzas, reportes y demás.
    const pay = Object.fromEntries(rows("payments").map((r) => [r.legacy_mobile_id, r]));
    check("pagos: fecha de registro ORIGINAL; cobros: fecha de creación ORIGINAL", Date.parse(pay["pay-1"].recorded_at) === Date.parse("2026-10-05T18:30:00.000Z") && Date.parse(money["chg-1"].created_at) === Date.parse("2026-10-01T03:00:00.000Z"));
    const rep = rows("report_records");
    check("reporte generado: llegó con su snapshot en el formato de la web y el registro original completo adentro", rep.length === 1 && rep[0].snapshot.data.classesHeld === 8 && rep[0].snapshot._mobileRecord.snapshot.data.topicsSeen[0] === "ZQ tema del reporte" && rep[0].pdf_url === null);
    const tp = rows("teacher_profiles")[0];
    check("perfil de la profesora: avance del tutorial y fechas originales", tp.completed_tutorial_version === 2 && Date.parse(tp.tutorial_completed_at) === Date.parse("2026-03-05T12:00:00.000Z") && Date.parse(tp.source_updated_at) === Date.parse("2026-09-01T12:00:00.000Z"));
    const sc = rows("surcharge_settings")[0];
    check("recargos: el cambio programado (pendiente) llegó junto con su vigencia", sc.pending?.graceDay === 12 && sc.pending_effective_from === "2027-01");
    const cal = rows("calendar_lessons").filter((c) => c.legacy_overlap_group_id);
    check("clases de calendario: el grupo de superposición original se conserva", cal.length >= 1 && cal.every((c) => c.legacy_overlap_group_id === "ovl-ZQ-1" && typeof c.overlap_group_id === "string"));
    const fm = rows("first_month_proration_decisions")[0];
    check("primer mes proporcional: series y versión de regla", JSON.stringify(fm.recurrence_ids) === JSON.stringify(["rule-1"]) && fm.rule_version === 2 && Array.isArray(fm.series_pattern_snapshot));
    const extras1 = rows("student_source_extras").find((e) => e.student_id === students["stu-1"].id)?.extras ?? {};
    check("alumno 1: datos calculados por la app (totales, promedio, etiquetas) conservados en su tabla de extras", extras1.profile?.totalClasses !== undefined && extras1.card?.paymentStatus !== undefined, JSON.stringify(Object.keys(extras1)));
    check("historiales: estados, precios y correcciones mensuales llegaron", rows("student_status_history").length === 2 && rows("student_price_history").length === 3 && rows("monthly_amount_corrections").length === 1);

    // 5) Archivos que sólo existen en el teléfono: la extracción (el MISMO código que correrá en el teléfono, con un teléfono simulado) los sube y registra con su huella.
    const manifest = clone(phone);
    const files = {
      "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf": "ZQ-contenido-guia".padEnd(20480, "."),
      "file:///data/user/0/host.exp.exponent/files/attachments/matatt-1.pdf": "ZQ-contenido-unidad3".padEnd(4096, "."),
      "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf": "ZQ-contenido-reporte",
    };
    const keys = { "@teacherflow/lessons": JSON.stringify(source.pedagogicalLessons), "@teacherflow/report_history": JSON.stringify(source.reportRecords), "@teacherflow/materials_library": JSON.stringify(manifest.materials), ...manifest.deviceLocal };
    const objects = new Set();
    const sqlRpc = async (name, args) => {
      const names = Object.keys(args);
      try {
        const r = await s.query("select public." + name + "(" + names.map((n, i) => "$" + (i + 1) + (typeof args[n] === "object" ? "::jsonb" : "")).join(", ") + ") as r", names.map((n) => (typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    };
    const phoneDeps = {
      readKey: async (k) => keys[k] ?? null,
      fileInfo: async (uri) => (uri in files ? { exists: true, size: files[uri].length } : { exists: false, size: null }),
      readBytes: async (uri) => new TextEncoder().encode(files[uri]),
      sha256Hex: async (bytes) => crypto.createHash("sha256").update(bytes).digest("hex"),
      ownerId: async () => A,
      listReports: async () => (await s.query("select id, student_id, legacy_mobile_id from public.report_records")).rows,
      upload: async (bucket, objectPath, bytes) => {
        const full = bucket + "/" + objectPath;
        if (objects.has(full)) return { error: { message: "The resource already exists", statusCode: "409" } };
        objects.add(full);
        await admin.query("insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3::jsonb)", [bucket, objectPath, JSON.stringify({ size: bytes.length })]);
        return { error: null };
      },
      rpc: sqlRpc,
    };
    // Antes de subir nada: registrar un archivo que NO existe en el almacenamiento se rechaza (nunca se simula un archivo disponible).
    const refusedUnuploaded = await sqlRpc("register_transfer_file", { p_kind: "lesson_attachment", p_legacy_id: att[0].legacy_mobile_id, p_path: A + "/attachments/" + sha256("x") + ".pdf", p_sha256: sha256("x"), p_size: 1 });
    check("registrar un archivo que todavía no está en el almacenamiento se RECHAZA", refusedUnuploaded.error !== null);
    const summary = await runPhoneExtraction(phoneDeps);
    check("extracción desde el teléfono (código real, teléfono simulado): 3 archivos subidos y registrados, 2 materiales y los datos locales a la cuenta, sin fallos", summary.complete && summary.counts.lesson_attachment.uploaded === 1 && summary.counts.material.uploaded === 1 && summary.counts.report_pdf.uploaded === 1 && summary.materialsInserted === 2 && summary.deviceKeysSaved === 3 && summary.failed.length === 0, JSON.stringify(summary));
    const again = await runPhoneExtraction(phoneDeps);
    check("extracción repetida: no duplica nada (todo «ya estaba»)", again.complete && again.materialsInserted === 0 && again.counts.lesson_attachment.alreadyThere === 1 && again.counts.report_pdf.alreadyThere === 1 && objects.size === 3, JSON.stringify(again.counts));
    const saved = (await admin.query("select count(*)::int n from public.device_local_snapshots where owner_id = $1", [A])).rows[0].n;
    const results = (await admin.query("select count(*)::int n from public.phone_extraction_results where owner_id = $1", [A])).rows[0].n;
    check("los datos locales del teléfono quedan guardados UNA vez en la cuenta y cada extracción deja su resultado", saved === 1 && results === 2, JSON.stringify({ saved, results }));
    const wrongPath = await sqlRpc("register_transfer_file", { p_kind: "report_pdf", p_legacy_id: "rep-1", p_path: A + "/otra-ruta/x.pdf", p_sha256: sha256("x"), p_size: 5 });
    check("el PDF de un reporte sólo se registra en SU ruta (dueña/alumno/reporte)", wrongPath.error !== null);
    const foreign = await sqlRpc("register_transfer_file", { p_kind: "lesson_attachment", p_legacy_id: att[0].legacy_mobile_id, p_path: "00000000-0000-4000-8000-0000000000b2/attachments/x.pdf", p_sha256: sha256("x"), p_size: 3 });
    check("no se puede registrar un archivo bajo la carpeta de OTRA cuenta", foreign.error !== null);
    const downgrade = await sqlRpc("mark_transfer_file_unavailable", { p_kind: "lesson_attachment", p_legacy_id: att[0].legacy_mobile_id });
    check("declarar «el teléfono ya no lo tiene» nunca pisa un archivo que YA está disponible", downgrade.error === null && downgrade.data.marked === 0);

    const dump2 = await dumpDestination(admin, A);
    if (WRITE_GOLDEN) {
      // Volcado de referencia (sintético) de lo que la base deja con el respaldo del fixture: lo usan las pruebas del comparador sin necesitar Postgres.
      const golden = clone(dump2);
      golden.import_source_archives = [];
      require("fs").writeFileSync(path.join(ROOT, "lib", "backup", "__fixtures__", "mobile-real-shape.destination.json"), JSON.stringify(golden, null, 1) + String.fromCharCode(10));
      console.log("volcado de referencia escrito");
    }
    const cmp2 = compareTransfer(source, dump2, { adapterOmitted: adaptation.omitted, revealValues: true });
    const filesAfter = Object.fromEntries(cmp2.files.map((f) => [f.kind, f]));
    check("archivos: todo DISPONIBLE (adjunto, 2 materiales, PDF del reporte) — el comparador lo lee de la propia cuenta", filesAfter.adjunto.available === 1 && filesAfter.material.available === 2 && filesAfter.reporte_pdf.available === 1 && cmp2.files.every((f) => f.pending === 0), JSON.stringify(filesAfter));
    check("veredicto DESPUÉS de extraer los archivos: COMPLETO (sin faltantes, diferencias, omisiones, claves sin declarar ni archivos pendientes)", cmp2.verdict.complete === true, JSON.stringify(cmp2.verdict.reasons));
    check("nada queda «sólo en el archivo del origen»", cmp2.preservedOnlyInArchive.length === 0);

    // 6) El comparador tiene que NOTAR cada tipo de problema (se altera una copia del volcado, nunca la base).
    const mutate = (fn) => {
      const d = clone(dump2);
      fn(d);
      return compareTransfer(source, d, { adapterOmitted: adaptation.omitted, revealValues: true });
    };
    const findField = (c, entity, field) => c.fields.find((f) => f.entity === entity && f.field === field);
    const swapped = mutate((d) => {
      const c1 = d.payment_charges.find((c) => c.legacy_mobile_id === "chg-1");
      const c2 = d.payment_charges.find((c) => c.legacy_mobile_id === "chg-2");
      [c1.student_id, c2.student_id] = [c2.student_id, c1.student_id];
    });
    check("detecta cobros intercambiados entre dos alumnos (relación)", findField(swapped, "Cobros", "alumno (relación)").mismatched === 2 && swapped.verdict.complete === false);
    const wrongAmount = mutate((d) => {
      d.payment_charges.find((c) => c.legacy_mobile_id === "chg-1").original_amount += 0.01;
    });
    check("detecta un importe incorrecto (un centavo)", findField(wrongAmount, "Cobros", "originalAmount").mismatched === 1);
    const swappedPhones = mutate((d) => {
      const a = d.students.find((x) => x.legacy_mobile_id === "stu-1");
      const b = d.students.find((x) => x.legacy_mobile_id === "stu-2");
      [a.phone, b.phone] = [b.phone, a.phone];
    });
    check("detecta teléfonos intercambiados entre dos alumnos aunque ambos números sigan existiendo en el destino", findField(swappedPhones, "Alumnos", "phone").mismatched === 2);
    const swappedTopics = mutate((d) => {
      const a = d.lesson_registrations.find((x) => x.legacy_mobile_id === "les-1");
      const b = d.lesson_registrations.find((x) => x.legacy_mobile_id === "les-2");
      [a.topics, b.topics] = [b.topics, a.topics];
    });
    check("detecta temas intercambiados entre dos clases", findField(swappedTopics, "Clases registradas", "form.topics").mismatched === 2);
    const archiveOnly = mutate((d) => {
      for (const r of d.lesson_registrations) {
        r.topics = [];
        r.internal_notes = "";
      }
    });
    check("un dato que SÓLO está en el archivo del origen NO cuenta como migrado: el veredicto no es completo aunque el archivo lo tenga", archiveOnly.verdict.complete === false && findField(archiveOnly, "Clases registradas", "form.topics").mismatched >= 1 && archiveOnly.verdict.reasons.some((r) => r.includes("form.topics")));
    const lostRow = mutate((d) => {
      d.payments = d.payments.filter((p) => p.legacy_mobile_id !== "pay-2");
    });
    check("detecta una fila que falta, por su identificador de origen", lostRow.entities.find((e) => e.entity === "Pagos").missing.join() === "pay-2");
    const dup = mutate((d) => {
      d.students.push({ ...d.students.find((x) => x.legacy_mobile_id === "stu-1"), id: crypto.randomUUID() });
    });
    check("detecta un duplicado del mismo identificador de origen", dup.duplicates.some((x) => x.table === "students" && x.legacyId === "stu-1"));
    const lostDate = mutate((d) => {
      d.payments.find((p) => p.legacy_mobile_id === "pay-1").recorded_at = "2026-10-19T00:00:00+00:00";
    });
    check("detecta una fecha original reemplazada por la de la importación", findField(lostDate, "Pagos", "recordedAt").mismatched === 1);
    const resetState = mutate((d) => {
      for (const p of d.lesson_registration_students) p.participant_status = "pending";
    });
    check("detecta estados de participantes reiniciados", findField(resetState, "Integrantes de registros", "estado del participante").mismatched >= 1);
    const lostGrade = mutate((d) => {
      for (const e of d.lesson_registration_evaluations) e.source_grades = null;
    });
    check("detecta notas originales perdidas (valor fuera de rango sin conservar)", findField(lostGrade, "Evaluaciones", "generalGrade ORIGINAL (source_grades)").mismatched >= 1);
    const noFiles = mutate((d) => {
      d.lesson_attachments[0].file_status = "pendiente";
      d.lesson_attachments[0].storage_path = null;
    });
    check("un adjunto sin archivo registrado figura como pendiente y el veredicto no es completo", noFiles.files.find((f) => f.kind === "adjunto").pending === 1 && noFiles.verdict.complete === false);
    const mixedSource = clone(source);
    mixedSource.pedagogicalLessons[0].form.campoNuevoDeLaApp = "ZQ-nuevo";
    mixedSource.paymentCharges[0].campoNuevoDeLaApp = "ZQ-cobro-nuevo";
    const undeclared = compareTransfer(mixedSource, dump2, { adapterOmitted: adaptation.omitted, revealValues: true });
    check("un campo del origen que ningún mapeo conoce se informa (no se ignora)", undeclared.undeclared.some((u) => u.entity === "Cobros" && u.key === "campoNuevoDeLaApp") && undeclared.verdict.complete === false);
  }

  // 7) Deshacer: la importación se revierte completa y la cuenta queda vacía (ensayo de recuperación).
  const runId = applied.import_run_id;
  const undoPreview = await undoPreviewOf(s, runId);
  check("deshacer: la vista previa dice que se puede deshacer", undoPreview.is_safe === true, JSON.stringify(undoPreview.unsafe_rows ?? "").slice(0, 200));
  const undone = await undoApplyOf(s, undoPreview.undo_preview_id);
  const after = await dumpDestination(admin, A);
  const additive = new Set(["material_library_items", "device_local_snapshots", "phone_extraction_results"]);
  const left = Object.entries(after).filter(([t, r]) => r.length > 0 && !/^(import_)/.test(t) && !additive.has(t)).map(([t, r]) => `${t}:${r.length}`);
  check("deshacer: la cuenta vuelve a quedar vacía (la extracción del teléfono es aditiva y no forma parte de la importación)", left.length === 0, left.join(", ") || JSON.stringify(undone).slice(0, 120));
  if (FULL || BEFORE_R10) {
    const kept = (await admin.query("select count(*)::int n from public.import_source_archives where owner_id = $1", [A])).rows[0].n;
    check("deshacer: el archivo del origen se conserva", kept === 1);
  }

  await s.end();
  await pg.stop();
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
