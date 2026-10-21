// R14 — Declarar que el teléfono ya no tiene un archivo NO impide deshacer la importación. Postgres REAL aislado, datos SINTÉTICOS.
//
//   • con R14: importar, declarar el adjunto ausente y pedir «deshacer» → SEGURO (y deshacer deja la cuenta vacía);
//   • con el rollback (definición de R10): el mismo recorrido → NO seguro (el adjunto figura «editado después de la importación»);
//   • al reaplicar R14: vuelve a ser seguro (idempotente); aplicada dos veces no cambia nada más; sólo cambia esa función.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r14_unavailable_file_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261020120000_r14_unavailable_file_keeps_undo_safe.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r14_unavailable_file_rollback.sql"), "utf8");

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
  const pg = await start({ port: 5741 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    const validation = validateBackupPayload(buildMobileBackup());
    if (!validation.ok) throw new Error("el respaldo sintético no valida");

    const funcs = async () => Object.fromEntries((await admin.query("select p.oid::regprocedure::text k, md5(pg_get_functiondef(p.oid)) h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'")).rows.map((r) => [r.k, r.h]));
    const scenario = async () => {
      await H.reset(admin);
      const s = await H.apiSession(pg, H.A, 300000);
      try {
        const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
        const applied = await H.applyOf(s, preview.preview_id, [], []);
        const attachments = (await admin.query("select legacy_mobile_id from public.lesson_attachments where owner_id = $1 order by 1", [H.A])).rows;
        const marked = (await s.query("select public.mark_transfer_file_unavailable('lesson_attachment', $1) r", [attachments[0].legacy_mobile_id])).rows[0].r;
        const status = (await admin.query("select file_status from public.lesson_attachments where owner_id = $1 and legacy_mobile_id = $2", [H.A, attachments[0].legacy_mobile_id])).rows[0].file_status;
        const undo = await H.undoPreviewOf(s, applied.import_run_id);
        return { s, undo, marked, status, applied, attachments: attachments.length };
      } catch (e) {
        await s.end();
        throw e;
      }
    };

    // Con R14 (las migraciones ya la incluyen).
    const withR14 = await scenario();
    check("el fixture tiene al menos un adjunto y se declara ausente (marcado = 1)", withR14.attachments >= 1 && withR14.marked.marked === 1 && withR14.status === "no_disponible", JSON.stringify(withR14.marked));
    check("con R14: tras declarar el archivo ausente, deshacer la importación es SEGURO", withR14.undo.is_safe === true, JSON.stringify(withR14.undo.unsafe_rows));
    await H.undoApplyOf(withR14.s, withR14.undo.undo_preview_id);
    await withR14.s.end();
    const left = (await admin.query("select (select count(*)::int from public.students where owner_id = $1) + (select count(*)::int from public.lesson_attachments where owner_id = $1) n", [H.A])).rows[0].n;
    check("…y deshacer deja la cuenta vacía (el estado «no disponible» no sobrevive a la importación deshecha)", left === 0, String(left));

    // Aplicada otra vez: nada cambia.
    const before = await funcs();
    await admin.query(MIGRATION);
    check("aplicar R14 dos veces no cambia ninguna función (idempotente)", JSON.stringify(before) === JSON.stringify(await funcs()));

    // Rollback → la definición de R10: el mismo recorrido NO es seguro.
    await admin.query(ROLLBACK);
    const afterRollback = await funcs();
    const changed = Object.keys(afterRollback).filter((k) => before[k] !== afterRollback[k]);
    check("el rollback cambia SÓLO mark_transfer_file_unavailable", changed.length === 1 && changed[0].startsWith("mark_transfer_file_unavailable"), changed.join(","));
    const withoutR14 = await scenario();
    check("sin R14 (definición de R10): declarar el archivo ausente bloquea deshacer (el defecto que R14 corrige)", withoutR14.undo.is_safe === false && JSON.stringify(withoutR14.undo.unsafe_rows).includes("editada después de la importación"), JSON.stringify(withoutR14.undo.unsafe_rows).slice(0, 160));
    await withoutR14.s.end();

    // Reaplicar R14: vuelve a ser seguro.
    await admin.query(MIGRATION);
    check("al reaplicar R14 las funciones vuelven exactamente a su definición", JSON.stringify(await funcs()) === JSON.stringify(before));
    const again = await scenario();
    check("…y el recorrido vuelve a ser seguro", again.undo.is_safe === true);
    await again.s.end();
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
