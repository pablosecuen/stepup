// R13 — Fidelidad completa del origen: cobro de importe 0, exceso separado y clasificado, referencias originales faltantes e incidencias explícitas. Postgres REAL aislado, datos SINTÉTICOS.
//
//   • un respaldo con un cobro de importe 0 + su condonación, un exceso pagado, un pago anulado con asignación, una corrección con alumno y pagos inexistentes y registros/cobros con la clase del
//     calendario inexistente se importa COMPLETO con las validaciones reales; lo importado coincide campo por campo (comparador) y el balance origen = destino cierra;
//   • sin la separación del exceso, la importación SIGUE deteniéndose (el invariante no se relaja);
//   • deshacer deja la cuenta vacía (incluidas las incidencias); el rollback de R13 se rehúsa mientras hay datos nuevos y funciona con la cuenta vacía; R13 se reaplica (idempotente).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r13_fidelity_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261020110000_r13_transfer_fidelity.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r13_transfer_fidelity_rollback.sql"), "utf8");

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

async function dump(admin, uid, tables) {
  const out = {};
  for (const t of tables) {
    const exists = (await admin.query("select to_regclass($1) r", [`public.${t}`])).rows[0].r;
    if (!exists) continue;
    out[t] = (await admin.query(`select to_jsonb(x) as r from public.${t} x where owner_id = $1`, [uid])).rows.map((r) => r.r);
  }
  return out;
}

async function main() {
  const { buildMobileBackup } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { compareTransfer, DESTINATION_TABLES } = await mod("lib/backup/transfer-compare.ts");
  const pg = await start({ port: 5721 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    check("R13 es seguida sólo por R14 y R15 (ajustes puntuales)", fs.readdirSync(path.join(ROOT, "supabase", "migrations")).sort().slice(-3).join().includes("r13_transfer_fidelity") && fs.readdirSync(path.join(ROOT, "supabase", "migrations")).sort().slice(-2).join().includes("r14_unavailable_file"));

    /** Respaldo sintético con TODOS los casos. */
    const backup = () => {
      const doc = buildMobileBackup();
      const base = doc.paymentCharges.find((c) => c.id === "chg-1");
      // cobro de importe 0 + condonación automática
      doc.paymentCharges.push({ id: "chg-zero", studentId: "stu-1", type: "por_clase", savedLessonId: "les-5", originalAmount: 0, currency: "ARS", dueDate: "2026-10-12", createdAt: "2026-10-12T10:00:00.000Z", billingPeriod: "2026-10", voidedAt: null, voidReason: null });
      doc.paymentAdjustments = [...(doc.paymentAdjustments ?? []), { id: "adj-zero", chargeId: "chg-zero", studentId: "stu-1", reason: "Recargo condonado automáticamente", createdAt: "2026-10-12T10:00:00.000Z", voidedAt: null, voidReason: null }];
      // pago anulado (con su asignación) + pago vigente de más sobre chg-1 → exceso
      doc.payments.push({ id: "pay-void", studentId: "stu-1", amount: base.originalAmount, currency: "ARS", method: "transferencia", paidAt: "2026-10-06", recordedAt: "2026-10-06T18:30:00.000Z", notes: null, voidedAt: "2026-10-07T10:00:00.000Z", voidReason: "cargado dos veces" });
      doc.paymentAllocations.push({ id: "alo-void", paymentId: "pay-void", chargeId: "chg-1", studentId: "stu-1", amount: base.originalAmount });
      doc.payments.push({ id: "pay-extra", studentId: "stu-1", amount: 100, currency: "ARS", method: "transferencia", paidAt: "2026-10-20", recordedAt: "2026-10-20T18:30:00.000Z", notes: null, voidedAt: null, voidReason: null });
      doc.paymentAllocations.push({ id: "alo-extra", paymentId: "pay-extra", chargeId: "chg-1", studentId: "stu-1", amount: 100 });
      // corrección con alumno y pagos inexistentes
      doc.initialPaidSurchargeCorrections = [{ id: "isc-orphan", studentId: "stu-borrado", billingPeriod: "2026-10", previousSurchargeAmount: 50, voidedPaymentId: "pay-no-existe-1", newPaymentId: "pay-no-existe-2", correctedAt: "2026-10-13T10:00:00.000Z", reason: "Corrección automática" }];
      // registro y cobro cuya clase del calendario no existe
      const reg = doc.pedagogicalLessons.find((l) => l.id === "les-3");
      reg.calendarLessonId = "calendar_recurrence_inexistente_w1";
      reg.calendarRegistration = { lessonId: "calendar_recurrence_inexistente_w1", start: "2026-08-03T13:00:00.000Z", studentId: "stu-1", recurrenceOccurrenceKey: "recurrence_inexistente:w1" };
      doc.paymentCharges.find((c) => c.id === "chg-3").calendarLessonId = "calendar_recurrence_inexistente_w2";
      doc.calendarLessons[0].freedByLessonId = "calendar_cancelled_recurrence_inexistente";
      return doc;
    };

    const run = async (payload, { applyOnly = true } = {}) => {
      await H.reset(admin);
      const validation = validateBackupPayload(payload);
      if (!validation.ok) throw new Error("la validación rechaza el respaldo sintético: " + [...new Set(validation.errors.map((e) => e.code))].join(","));
      const s = await H.apiSession(pg, H.A, 300000);
      try {
        const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
        const applied = await H.applyOf(s, preview.preview_id, [], []);
        return { validation, s, applied };
      } catch (error) {
        await s.end();
        return { error: String(error.message), validation };
      }
    };

    const doc = backup();
    let r = await run(doc);
    check("con las validaciones reales el respaldo se importa COMPLETO (sin omisiones del adaptador)", !r.error && r.applied && r.validation.adaptation.omitted.length === 0, r.error);
    if (r.error) throw new Error(r.error);

    const tables = await dump(admin, H.A, DESTINATION_TABLES);
    const result = compareTransfer(doc, tables, { adapterOmitted: r.validation.adaptation.omitted });
    const wrong = result.fields.filter((f) => f.mismatched > 0).map((f) => `${f.entity}·${f.field}`);
    check("el comparador no encuentra ninguna diferencia de campo", wrong.length === 0, wrong.join(", "));
    check("el balance origen = omitidas + esperadas y esperadas = encontradas + faltantes cierra, sin faltantes", result.reconciliation.balanced && result.reconciliation.missingRows === 0 && result.reconciliation.omittedByAdapter === 0, JSON.stringify(result.reconciliation));

    const zero = (await admin.query("select original_amount::text a from public.payment_charges where owner_id = $1 and legacy_mobile_id = 'chg-zero'", [H.A])).rows[0];
    check("el cobro de importe 0 se conserva con su importe EXACTO (0) y su condonación", zero?.a === "0.00" && (await admin.query("select 1 from public.payment_adjustments where owner_id = $1 and legacy_mobile_id = 'adj-zero'", [H.A])).rowCount === 1, JSON.stringify(zero));

    const alloc = (await admin.query("select legacy_mobile_id, amount::text a, excess_amount::text e, excess_status s, jsonb_typeof(excess_evidence) t from public.payment_allocations where owner_id = $1 and legacy_mobile_id in ('alo-extra','alo-void','alo-1') order by 1", [H.A])).rows;
    const byId = Object.fromEntries(alloc.map((x) => [x.legacy_mobile_id, x]));
    check("el exceso queda SEPARADO en la asignación que lo produce (100), con el monto de la asignación intacto y su clasificación sin inventar causa", byId["alo-extra"]?.a === "100.00" && byId["alo-extra"]?.e === "100.00" && byId["alo-extra"]?.s === "pendiente_de_clasificacion" && byId["alo-extra"]?.t === "object", JSON.stringify(byId["alo-extra"]));
    check("las asignaciones sin exceso (y la del pago anulado) quedan sin exceso", byId["alo-1"]?.e === "0.00" && byId["alo-void"]?.e === "0.00" && byId["alo-1"]?.s === null, JSON.stringify([byId["alo-1"], byId["alo-void"]]));

    const corr = (await admin.query("select student_id, student_missing_ref, voided_payment_id, voided_payment_missing_ref, new_payment_id, new_payment_missing_ref from public.initial_paid_surcharge_corrections where owner_id = $1 and legacy_mobile_id = 'isc-orphan'", [H.A])).rows[0];
    check("la corrección con alumno y pagos inexistentes se conserva con relaciones vacías y las referencias originales (sin alumno ni pagos ficticios)", corr && corr.student_id === null && corr.student_missing_ref === "stu-borrado" && corr.voided_payment_id === null && corr.voided_payment_missing_ref === "pay-no-existe-1" && corr.new_payment_id === null && corr.new_payment_missing_ref === "pay-no-existe-2", JSON.stringify(corr));
    check("no se creó ningún pago ni alumno de más", Number((await admin.query("select count(*)::int n from public.payments where owner_id = $1", [H.A])).rows[0].n) === doc.payments.length && Number((await admin.query("select count(*)::int n from public.students where owner_id = $1", [H.A])).rows[0].n) === doc.students.length);

    const inc = (await admin.query("select entity, row_legacy_id, field, original_reference from public.origin_incidents where owner_id = $1 order by 1,2,3", [H.A])).rows;
    check("las referencias ya rotas en el origen quedan como incidencias explícitas con su referencia original", result.originIncidents.length === inc.length && inc.length >= 6 && inc.some((i) => i.field === "calendarLessonId" && i.original_reference === "calendar_recurrence_inexistente_w1"), `${inc.length} filas`);
    const reg = (await admin.query("select calendar_lesson_id, source_extras ->> 'calendarLessonIdAtOrigin' as ref, source_extras ->> 'calendarLessonMissingAtOrigin' as flag from public.lesson_registrations where owner_id = $1 and legacy_mobile_id = 'les-3'", [H.A])).rows[0];
    check("el registro sin clase en el origen conserva todo, sin enlace, con su referencia original y la marca", reg && reg.calendar_lesson_id === null && reg.ref === "calendar_recurrence_inexistente_w1" && reg.flag === "true", JSON.stringify(reg));

    // El rollback se NIEGA a destruir información: con datos de R13 en la cuenta falla sin tocar nada.
    let rollbackMessage = null;
    try { await admin.query(ROLLBACK); } catch (error) { rollbackMessage = String(error.message); }
    check("el rollback de R13 se rehúsa mientras la cuenta tiene datos nuevos (no destruye información)", rollbackMessage !== null && /R13: hay /.test(rollbackMessage), rollbackMessage ?? "se ejecutó");
    check("y no cambió nada: las columnas y tablas siguen", (await admin.query("select to_regclass('public.origin_incidents') t")).rows[0].t !== null);

    // deshacer: la cuenta queda vacía, incluidas las incidencias
    const undoPreview = await H.undoPreviewOf(r.s, r.applied.import_run_id);
    check("deshacer es seguro", undoPreview.is_safe === true);
    await H.undoApplyOf(r.s, undoPreview.undo_preview_id);
    await r.s.end();
    const left = (await admin.query("select (select count(*)::int from public.origin_incidents where owner_id = $1) + (select count(*)::int from public.payment_charges where owner_id = $1) + (select count(*)::int from public.payment_allocations where owner_id = $1) + (select count(*)::int from public.initial_paid_surcharge_corrections where owner_id = $1) + (select count(*)::int from public.students where owner_id = $1) n", [H.A])).rows[0].n;
    check("deshacer deja la cuenta vacía (incidencias, cobros, asignaciones, correcciones y alumnos)", Number(left) === 0, String(left));

    // sin separar el exceso, el invariante SIGUE deteniendo la importación
    const noMetadata = backup();
    const adapted = r.validation.backup;
    const stripped = JSON.parse(JSON.stringify(adapted));
    for (const a of stripped.paymentAllocations) delete a.excess;
    await H.reset(admin);
    const s2 = await H.apiSession(pg, H.A, 300000);
    let message = null;
    try {
      const preview = await H.previewOf(s2, stripped, r.validation.excludedCollections);
      await H.applyOf(s2, preview.preview_id, [], []);
    } catch (error) {
      message = String(error.message);
    }
    await s2.end();
    check("sin la separación explícita del exceso, la importación SIGUE deteniéndose (el invariante no se relaja)", message !== null && /Invariante violada: las asignaciones de un cargo superan su importe original/.test(message), message ?? "se importó");
    void noMetadata;

    // rollback / reaplicación con la cuenta vacía
    await admin.query(ROLLBACK);
    const gone = (await admin.query("select to_regclass('public.origin_incidents') t, (select count(*)::int from information_schema.columns where table_name = 'payment_allocations' and column_name = 'excess_amount') c")).rows[0];
    check("el rollback (cuenta vacía) quita las tablas y columnas de R13", gone.t === null && Number(gone.c) === 0);
    await admin.query(MIGRATION);
    await admin.query(MIGRATION);
    r = await run(backup());
    check("R13 se reaplica (dos veces: idempotente) y la importación completa vuelve a funcionar", !r.error && r.applied, r.error);
    if (r.s) await r.s.end();
  } finally {
    await pg.stop();
    fs.rmSync(pg.dir, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n✗ ${failures.length} de ${total} fallaron:\n  - ${failures.join("\n  - ")}` : `\n✓ ${total}/${total} comprobaciones`);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error("La prueba falló:", String(e.stack || e.message).split("\n").slice(0, 5).join(" | "));
  process.exitCode = 1;
});
