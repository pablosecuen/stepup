// ENSAYO CON EL RESPALDO REAL en un Postgres LOCAL AISLADO (obligatorio antes del traslado definitivo; NUNCA toca Production ni ninguna red).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/real_rehearsal.cjs <copia-origen.tfsc>        (la frase de paso se pide con la pantalla oculta, o TF_COPY_PASSPHRASE en tu entorno)
//   node supabase/tests/postgres/real_rehearsal.cjs --clean                    (borra restos de un ensayo interrumpido)
//
// Qué hace: descifra la copia del ORIGEN en memoria, levanta un Postgres temporal con TODAS las migraciones (incluidas R9/R10), importa el respaldo en una cuenta vacía
// con el mismo código que usará la web (validar → adaptar → vista previa → confirmar), vuelve a leer lo que quedó y compara origen ↔ destino campo por campo,
// y comprueba que «deshacer» deja la cuenta vacía. Informa SÓLO identificadores de origen, nombres de campo y cantidades: nunca nombres, teléfonos ni importes.
//
// Privacidad: el Postgres temporal guarda los datos EN CLARO en una carpeta de %TEMP% (no hay otra forma de tener un Postgres real). Se borra al terminar, ante un
// error y ante Ctrl+C; si el proceso se mata a la fuerza, correr --clean. Cuanto antes se borre, mejor: no dejar el ensayo abierto. Nada se escribe fuera de esa carpeta.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const MARK = ".tf-real-rehearsal";

function clean() {
  let n = 0;
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith("tf-epg-")) continue;
    const dir = path.join(os.tmpdir(), name);
    if (fs.existsSync(path.join(dir, MARK))) {
      fs.rmSync(dir, { recursive: true, force: true });
      n += 1;
    }
  }
  console.log(`Restos del ensayo borrados: ${n}.`);
}

// Misma entrada que el resto de las herramientas del traslado (una sola sesión de lectura, frase oculta): tools/transfer/prompt.mjs.
let prompter = null;
async function askHidden(question) {
  prompter ??= (await mod("tools/transfer/prompt.mjs")).createPrompter();
  try {
    return await prompter.ask(question, true);
  } finally {
    prompter.close(); // la terminal vuelve a su modo normal: Ctrl+C durante el ensayo dispara el borrado del Postgres temporal
  }
}

// --diagnostico-invariante-cargos: SÓLO para medir el resto del traslado cuando el invariante de cobros detiene la importación por un hallazgo todavía sin resolver. Relaja ese control
// ÚNICAMENTE en el Postgres descartable de este ensayo (nunca toca una migración ni Production) y el resultado se rotula como diagnóstico.
const argv = process.argv.slice(2);
const DIAGNOSTIC_RELAX_CHARGE_INVARIANT = argv.includes("--diagnostico-invariante-cargos");
const arg = argv.find((a) => !a.startsWith("--")) ?? (argv.includes("--clean") ? "--clean" : undefined);
if (arg === "--clean") {
  clean();
  process.exit(0);
}
if (!arg) {
  console.error("Uso: real_rehearsal.cjs <copia-origen.tfsc> | --clean");
  process.exit(2);
}

async function dumpDestination(admin, uid, tables) {
  const dump = {};
  for (const t of tables) {
    const exists = (await admin.query("select to_regclass($1) r", [`public.${t}`])).rows[0].r;
    if (!exists) continue;
    dump[t] = (await admin.query(`select to_jsonb(x) as r from public.${t} x where owner_id = $1`, [uid])).rows.map((r) => r.r);
  }
  return dump;
}

async function main() {
  const { openCopy } = await mod("lib/secure-copy/open-copy.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { compareTransfer, DESTINATION_TABLES } = await mod("lib/backup/transfer-compare.ts");

  // Las copias nuevas (Windows DPAPI) se abren solas con tu usuario; la frase sólo se pide para una copia anterior que la lleve.
  const origin = JSON.parse((await openCopy(fs.readFileSync(arg), async () => process.env.TF_COPY_PASSPHRASE || (await askHidden("Frase de paso de la copia del origen: ")))).toString("utf8"));
  if (origin.kind !== "origin" || !origin.payload) throw new Error("La copia no es una copia del ORIGEN.");
  console.log(`Origen: copia de la nube del ${origin.cloudBackup?.createdAt ?? "?"}.`);

  const validation = validateBackupPayload(origin.payload);
  if (!validation.ok) {
    console.log("La validación NO acepta el respaldo:", [...new Set(validation.errors.map((e) => e.code))].join(", "));
    if (validation.adaptation) console.log("Adaptador — omitidas:", validation.adaptation.omitted.map((o) => `${o.collection}:${o.id ?? "?"}:${o.code}`).slice(0, 30).join(" | "));
    process.exitCode = 1;
    return;
  }
  const adaptation = validation.adaptation;
  console.log(`Validación: válido · formato ${adaptation.shape} · filas omitidas por el adaptador: ${adaptation.omitted.length} · campos sin conocer: ${adaptation.notRepresented.length}`);
  for (const o of adaptation.omitted.slice(0, 30)) console.log(`   ✗ ${o.collection} ${o.id ?? "(sin id)"} → ${o.code}`);
  for (const c of adaptation.conversions) console.log(`   · conversión ${c.collection}.${c.code}: ${c.count}`);

  const pg = await start({ port: 5691 });
  fs.writeFileSync(path.join(pg.dir, MARK), "ensayo con datos reales: borrar\n");
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await pg.stop();
    fs.rmSync(pg.dir, { recursive: true, force: true });
    console.log(fs.existsSync(pg.dir) ? "AVISO: no se pudo borrar la carpeta temporal (ejecutá --clean)." : "Postgres temporal y sus datos borrados.");
  };
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => cleanup().finally(() => process.exit(130)));
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await H.reset(admin);
    if (DIAGNOSTIC_RELAX_CHARGE_INVARIANT) {
      const def = (await admin.query("select pg_get_functiondef('public._import_validate_invariants(uuid,uuid)'::regprocedure) as d")).rows[0].d;
      const relaxed = def.replace("> c.original_amount\n  ) then", "> c.original_amount * 1000\n  ) then");
      if (relaxed === def) throw new Error("no se pudo relajar el invariante de cargos para el diagnóstico");
      await admin.query(relaxed);
      console.log("DIAGNÓSTICO: el invariante de importes de los cobros está RELAJADO sólo en este Postgres descartable; no es el comportamiento real de la importación.");
    }
    const s = await H.apiSession(pg, H.A, 300000);

    const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
    const c = preview.classification;
    const count = (list) => (Array.isArray(list) ? list.length : 0);
    console.log(`Vista previa: alumnos a agregar ${count(c.maestros.students.inserts)} · conflictos ${count(c.maestros.students.conflicts)} · posibles duplicados ${count(c.maestros.students.duplicates)}`);
    const notInsertable = (list) => (Array.isArray(list) ? list.filter((e) => e.status !== "insertable").map((e) => `${e.legacy_mobile_id}:${e.reason ?? e.status}`) : []);
    let registrationsSummary = { total: 0, insertable: 0, notInsertable: 0, byReason: {} };
    for (const [name, list] of [["series", c.aggregates.recurrence_rules], ["clases", c.aggregates.calendar_lessons], ["registros", c.aggregates.lesson_registrations]]) {
      const bad = notInsertable(list);
      const byReason = {};
      for (const entry of bad) {
        const reason = entry.slice(entry.indexOf(":") + 1);
        byReason[reason] = (byReason[reason] ?? 0) + 1;
      }
      console.log(`   ${bad.length ? "✗" : "✓"} ${name}: ${count(list) - bad.length}/${count(list)} se agregan${bad.length ? " · NO: " + Object.entries(byReason).map(([r, n]) => `${r} ×${n}`).join("; ") : ""}`);
      for (const entry of bad) console.log(`      sin importar (${name}) ${entry.split(":")[0]} → ${entry.slice(entry.indexOf(":") + 1)}`);
      if (name === "registros") registrationsSummary = { total: count(list), insertable: count(list) - bad.length, notInsertable: bad.length, byReason };
    }
    const applied = await H.applyOf(s, preview.preview_id, [], []);
    console.log(`Importación aplicada: ${applied.summary.total_rows_written} filas escritas.`);

    const dump = await dumpDestination(admin, H.A, DESTINATION_TABLES);
    const result = compareTransfer(origin.payload, dump, { adapterOmitted: adaptation.omitted });
    console.log("\nBALANCE POR ENTIDAD (origen = omitidas + esperadas; destino = esperadas − pendientes + de más):");
    for (const e of result.entities) console.log(`  ${e.ok && e.source === e.omitted + e.expected ? "✓" : "✗"} ${e.entity.padEnd(36)} origen ${String(e.source).padStart(4)} · omitidas ${String(e.omitted).padStart(2)} · esperadas ${String(e.expected).padStart(4)} · destino ${String(e.destination - e.extra.length).padStart(4)} · pendientes ${String(e.missing.length).padStart(2)}${e.extra.length ? " · de más " + e.extra.length : ""}${e.missing.length ? "  FALTAN: " + e.missing.slice(0, 5).join(", ") : ""}`);
    const rc = result.reconciliation;
    console.log(`  TOTAL: origen ${rc.sourceRows} = omitidas ${rc.omittedByAdapter} + esperadas ${rc.expectedRows} · destino ${rc.foundRows} de ${rc.expectedRows} esperadas · pendientes ${rc.missingRows} · de más ${rc.extraRows} · el balance ${rc.balanced && rc.sourceRows === rc.omittedByAdapter + rc.expectedRows && rc.expectedRows === rc.foundRows + rc.missingRows ? "CIERRA" : "NO CIERRA"}`);
    const bad = result.fields.filter((f) => f.mismatched > 0);
    console.log(`\nCampos comparados: ${result.summary.fieldChecks} · con diferencias: ${bad.length}`);
    for (const f of bad) console.log(`  ✗ ${f.entity} · ${f.field}: ${f.mismatched}/${f.checked}  ej.: ${f.examples.map((x) => `${x.id} → ${x.source} / ${x.destination}`).join(" · ")}`);
    console.log("Claves del origen sin destino:", result.undeclared.length ? result.undeclared.map((u) => `${u.entity}.${u.key} (${u.rows})`).join(", ") : "ninguna");
    const incidents = result.originIncidents ?? [];
    const incidentsByField = {};
    for (const i of incidents) incidentsByField[`${i.entity}.${i.field}`] = (incidentsByField[`${i.entity}.${i.field}`] ?? 0) + 1;
    console.log("Incidencias del ORIGEN conservadas (la clase, el pago o el alumno ya no existían en el respaldo):", incidents.length ? Object.entries(incidentsByField).map(([k, n]) => `${k} ×${n}`).join(" · ") : "ninguna");
    for (const i of incidents) console.log(`   incidencia: ${i.entity} · ${i.rowId} · ${i.field}`);
    const { rows: excessRows } = await admin.query("select excess_status st, count(*)::int n, sum(excess_amount / nullif(c.original_amount, 0))::numeric(8,4)::text rel from public.payment_allocations pa join public.payment_charges c on c.id = pa.charge_id where pa.owner_id = $1 and pa.excess_amount > 0 group by 1", [H.A]);
    console.log("Exceso pagado sobre el importe base (separado en la asignación):", excessRows.length ? excessRows.map((r) => `${r.st} ×${r.n} (proporción del importe base ${r.rel})`).join(" · ") : "ninguno");
    const { rows: zeroRows } = await admin.query("select count(*)::int n from public.payment_charges where owner_id = $1 and original_amount = 0", [H.A]);
    console.log("Cobros de importe 0 conservados:", zeroRows[0].n);
    console.log("Duplicados:", result.duplicates.length ? result.duplicates.map((d) => `${d.table}:${d.legacyId}×${d.count}`).join(", ") : "ninguno");
    const attachmentRows = (origin.payload.pedagogicalLessons ?? []).flatMap((l) => (Array.isArray(l.form?.activityAttachments) ? l.form.activityAttachments : []));
    const attachmentSummary = { rows: attachmentRows.length, registrations: (origin.payload.pedagogicalLessons ?? []).filter((l) => Array.isArray(l.form?.activityAttachments) && l.form.activityAttachments.length > 0).length, distinctPaths: new Set(attachmentRows.map((a) => a.uri)).size, declaredBytes: attachmentRows.reduce((n, a) => n + Number(a.sizeBytes ?? 0), 0), byKind: attachmentRows.reduce((m, a) => ((m[a.kind ?? "?"] = (m[a.kind ?? "?"] ?? 0) + 1), m), {}), byMime: attachmentRows.reduce((m, a) => ((m[a.mimeType ?? "?"] = (m[a.mimeType ?? "?"] ?? 0) + 1), m), {}) };
    const fileKinds = Object.fromEntries(result.files.map((f) => [f.kind, f]));
    console.log(`ARCHIVOS: adjuntos ${attachmentSummary.rows} (en ${attachmentSummary.registrations} registros, ${attachmentSummary.distinctPaths} rutas distintas, ${(attachmentSummary.declaredBytes / 1048576).toFixed(1)} MB declarados; ${JSON.stringify(attachmentSummary.byMime)}) · materiales ${fileKinds.material?.total ?? 0} · PDF de reportes ${fileKinds.reporte_pdf?.total ?? 0}`);
    console.log(`  Por extraer del teléfono: adjuntos ${fileKinds.adjunto?.pending ?? 0}/${fileKinds.adjunto?.total ?? 0} · materiales ${fileKinds.material?.pending ?? 0}/${fileKinds.material?.total ?? 0} · PDF ${fileKinds.reporte_pdf?.pending ?? 0}/${fileKinds.reporte_pdf?.total ?? 0}`);
    console.log(`  Ausentes en el teléfono: ${result.verdict.absentAtOriginVerified ? result.verdict.absentAtOrigin : "NO COMPROBADO (hace falta leer el teléfono: «0 ausentes» todavía no es un dato)"}. La biblioteca de materiales y los PDF generados viven sólo en el teléfono: su total real tampoco está comprobado.`);
    const nonFile = result.verdict.reasons.filter((r) => !r.startsWith("Archivos"));
    console.log(`\nVEREDICTO sin contar los archivos del teléfono: ${nonFile.length === 0 ? "SIN DIFERENCIAS" : "HAY DIFERENCIAS"}`);
    for (const r of nonFile) console.log(`  - ${r}`);
    console.log(`\nCIERRE · DEFECTOS DEL TRASLADO: ${nonFile.length} · INCONSISTENCIAS DEL ORIGEN CONSERVADAS (no son defectos): ${incidents.length} incidencias, ${excessRows.reduce((n, r) => n + r.n, 0)} asignaciones con exceso, ${zeroRows[0].n} cobro(s) de importe 0 · PENDIENTE DE COMPROBAR: archivos y ausentes del teléfono`);

    const undoPreview = await H.undoPreviewOf(s, applied.import_run_id);
    await H.undoApplyOf(s, undoPreview.undo_preview_id);
    const left = (await admin.query("select (select count(*)::int from public.students where owner_id = $1) + (select count(*)::int from public.lesson_registrations where owner_id = $1) + (select count(*)::int from public.payments where owner_id = $1) + (select count(*)::int from public.payment_charges where owner_id = $1) + (select count(*)::int from public.payment_allocations where owner_id = $1) + (select count(*)::int from public.origin_incidents where owner_id = $1) + (select count(*)::int from public.initial_paid_surcharge_corrections where owner_id = $1) n", [H.A])).rows[0].n;
    console.log(`Deshacer: ${undoPreview.is_safe ? "seguro" : "NO seguro"} · filas que quedan en la cuenta: ${left}`);
    // Resumen para quien orquesta el ensayo (sólo números y tipos; nunca datos personales).
    console.log("@@RESULT " + JSON.stringify({
      differences: nonFile.length,
      mismatchedFields: bad.length,
      fieldChecks: result.summary.fieldChecks,
      rowsExpected: result.summary.rowsExpected,
      rowsFound: result.summary.rowsFound,
      omittedByAdapter: adaptation.omitted.length,
      registrations: registrationsSummary,
      reconciliation: result.reconciliation,
      originIncidents: incidents.length,
      originIncidentsByField: incidentsByField,
      excess: excessRows,
      zeroAmountCharges: zeroRows[0].n,
      attachments: attachmentSummary,
      absentAtOriginVerified: result.verdict.absentAtOriginVerified,
      diagnosticRelaxedChargeInvariant: DIAGNOSTIC_RELAX_CHARGE_INVARIANT,
      files: result.files.map((f) => ({ kind: f.kind, total: f.total, available: f.available, pending: f.pending, unavailableAtOrigin: f.unavailableAtOrigin })),
      undoSafe: Boolean(undoPreview.is_safe),
      leftAfterUndo: left,
    }));
    process.exitCode = nonFile.length === 0 && left === 0 ? 0 : 1;
    await s.end();
  } finally {
    await cleanup();
  }
}

main().catch((e) => {
  console.error("El ensayo falló:", String(e.message).split("\n")[0].slice(0, 200));
  process.exitCode = 1;
});
