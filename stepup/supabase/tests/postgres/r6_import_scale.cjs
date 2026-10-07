// R6 — Medición de importaciones grandes en Postgres REAL (varias conexiones), con respaldos SINTÉTICOS (r6_dataset.cjs).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r6_import_scale.cjs --sizes 100,500,1000 --profile mix --label nuevo --out resultados.json
//   MIGRATIONS_DIR=<copia de las migraciones anteriores> node … --label antes     (mismo banco contra el comportamiento previo)
//
// Por cada tamaño y fase (vista previa, aplicar, vista previa de deshacer, deshacer) mide: tiempo total, pico de memoria del backend
// (conjunto de trabajo de Windows, incluye páginas compartidas tocadas), cantidad de consultas (escaneos de tablas dentro de la transacción) y de
// llamadas a funciones, tamaño del payload y de la clasificación, y la DURACIÓN REAL del advisory lock de la cuenta (sondeo de pg_locks).
// NO toca Production: usa un PostgreSQL embebido con las migraciones del repo.
const fs = require("fs");
const { execFileSync } = require("child_process");
const { start } = require("./load.cjs");
const { generateBackup, countedRows, nestedRows } = require("./r6_dataset.cjs");

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

function peakWorkingSetMb(pid) {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).PeakWorkingSet64`], { encoding: "utf8" }).trim();
    return Number(out) / 1048576;
  } catch { return null; }
}

async function main() {
  let sizes = arg("sizes", "100,500,1000").split(",").map(Number);
  if (process.argv.includes("--atmax")) {
    // Tamaño más grande del perfil que cabe en el máximo de trabajo por importación (7.500 unidades).
    const opts = { profile: arg("profile", "mix"), levelHistory: !process.argv.includes("--no-level-history"), nested: Number(arg("nested", "0")) };
    let lo = 100, hi = 30000;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); const b = generateBackup(mid, opts); if (countedRows(b) + nestedRows(b) <= 7500) lo = mid; else hi = mid - 1; }
    sizes = [lo];
  }
  const profile = arg("profile", "mix");
  const label = arg("label", "medicion");
  const port = Number(arg("port", "5471"));
  const timeoutS = Number(arg("timeout", "600"));
  const phases = arg("phases", "preview,apply,undo_preview,undo_apply").split(",");
  const out = arg("out", null);
  const giant = process.argv.includes("--giant");
  const chain = process.argv.includes("--chain");

  const pg = await start({ port });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const admin = pg.admin;
  await admin.query(`alter database postgres set track_functions = 'all'`);
  const results = [];

  for (const n of sizes) {
    const uid = (await admin.query(`insert into auth.users (email) values ($1) returning id`, [`r6-${n}@example.invalid`])).rows[0].id;
    const backup = generateBackup(n, { profile, giantComponent: giant, chainReplaces: chain, levelHistory: !process.argv.includes("--no-level-history"), nested: Number(arg("nested", "0")) });
    const payloadText = JSON.stringify(backup);
    const row = { label, profile, n, countedRows: countedRows(backup), nestedRows: nestedRows(backup), payloadBytes: Buffer.byteLength(payloadText), phases: {} };
    console.log(`\n== ${label} ${profile} n=${n} (contadas ${row.countedRows}, anidadas ${row.nestedRows}, payload ${(row.payloadBytes / 1048576).toFixed(2)} MB)`);

    // Sondeo del advisory lock de la cuenta (sólo la hora a la que se ve tomado / liberado).
    async function withLockPoll(fn) {
      const poller = await pg.connect();
      let first = null, last = null, stop = false;
      const loop = (async () => {
        while (!stop) {
          const r = await poller.query(`select count(*)::int c from pg_locks where locktype = 'advisory' and granted and objsubid = 1`);
          const now = Date.now();
          if (r.rows[0].c > 0) { if (first === null) first = now; last = now; }
          await new Promise((res) => setTimeout(res, 5));
        }
      })();
      try { return { value: await fn(), lockMs: () => (first === null ? 0 : last - first) }; } finally { stop = true; await loop; await poller.end(); }
    }

    async function measure(name, sql, params, { useLock = true, profileRollback = false } = {}) {
      const s = await pg.session(uid);
      await s.query(`set statement_timeout = ${timeoutS * 1000}`);
      const pid = (await s.query(`select pg_backend_pid() pid`)).rows[0].pid;
      const base = peakWorkingSetMb(pid);
      const t0 = Date.now();
      let res, err = null, lockMs = 0;
      try {
        const w = await withLockPoll(() => s.query(sql, params));
        res = w.value; lockMs = w.lockMs();
      } catch (e) { err = String(e.message).split("\n")[0]; }
      const ms = Date.now() - t0;
      const peak = peakWorkingSetMb(pid);
      const rec = { ms, lockMs, peakMemDeltaMb: base != null && peak != null ? Math.round((peak - base) * 10) / 10 : null, error: err };
      row.phases[name] = Object.assign(row.phases[name] || {}, rec);
      await s.end();
      console.log(`  ${name.padEnd(13)} ${String(ms).padStart(8)} ms  lock ${String(lockMs).padStart(8)} ms  mem +${rec.peakMemDeltaMb} MB${err ? "  ERROR: " + err : ""}`);
      return { res, rec };
    }

    // Perfil de una fase (consultas y funciones) dentro de una transacción que se REVIERTE (no deja residuos).
    async function profileRun(name, sql, params) {
      row.phases[name] = row.phases[name] || {};
      const s = await pg.session(uid);
      await s.query(`set statement_timeout = ${timeoutS * 1000}`);
      try {
        await s.query("begin");
        await s.query(`select pg_stat_force_next_flush()`).catch(() => {});
        const t0 = Date.now();
        await s.query(sql, params);
        const ms = Date.now() - t0;
        const tabs = (await s.query(`select coalesce(sum(seq_scan),0)::bigint seq, coalesce(sum(idx_scan),0)::bigint idx, coalesce(sum(n_tup_ins),0)::bigint ins from pg_stat_xact_user_tables`)).rows[0];
        const fns = (await s.query(`select funcid::regproc::text f, calls, round(total_time::numeric,1) tot, round(self_time::numeric,1) self from pg_stat_xact_user_functions order by self_time desc limit 24`)).rows;
        const calls = (await s.query(`select coalesce(sum(calls),0)::bigint c from pg_stat_xact_user_functions`)).rows[0].c;
        row.phases[name].queries = Number(tabs.seq) + Number(tabs.idx);
        row.phases[name].seqScans = Number(tabs.seq);
        row.phases[name].idxScans = Number(tabs.idx);
        row.phases[name].functionCalls = Number(calls);
        row.phases[name].topFunctions = fns;
        row.phases[name].profileMs = ms;
        console.log(`  ${name.padEnd(13)} consultas ${Number(tabs.seq) + Number(tabs.idx)} (seq ${tabs.seq}, idx ${tabs.idx}), llamadas a funciones ${calls}; top: ${fns.slice(0, 4).map((f) => `${f.f.replace("public.", "")} ${f.self}ms×${f.calls}`).join(" | ")}`);
      } catch (e) {
        console.log(`  ${name.padEnd(13)} perfil falló: ${String(e.message).split("\n")[0]}`);
      } finally {
        try { await s.query("rollback"); } catch {}
        await s.end();
      }
    }

    let previewId = null, undoPreviewId = null, runId = null;
    if (phases.includes("preview")) {
      const { res, rec } = await measure("preview", `select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [payloadText]);
      if (res) {
        previewId = res.rows[0].preview_id;
        rec.classificationBytes = Buffer.byteLength(JSON.stringify(res.rows[0].classification));
        const sz = (await admin.query(`select pg_column_size(normalized_payload) payload, pg_column_size(classification) cls from public.import_previews where id = $1`, [previewId])).rows[0];
        rec.storedPayloadBytes = Number(sz.payload); rec.storedClassificationBytes = Number(sz.cls);
        console.log(`    clasificación devuelta ${(rec.classificationBytes / 1024).toFixed(0)} KB; guardada: payload ${(rec.storedPayloadBytes / 1024).toFixed(0)} KB (comprimido), clasificación ${(rec.storedClassificationBytes / 1024).toFixed(0)} KB`);
      }
      if (process.argv.includes("--profile-preview")) await profileRun("preview", `select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [payloadText]);
    }
    if (previewId && phases.includes("apply")) {
      await profileRun("apply", `select * from public.apply_backup_import($1::uuid, '[]'::jsonb, '[]'::jsonb)`, [previewId]);
      const { res } = await measure("apply", `select * from public.apply_backup_import($1::uuid, '[]'::jsonb, '[]'::jsonb)`, [previewId]);
      if (res) {
        runId = res.rows[0].import_run_id;
        row.rowsWritten = res.rows[0].summary.total_rows_written;
      }
      // Reintento (respuesta perdida): mismo preview → mismo resultado, cero escrituras.
      if (res) await measure("apply_retry", `select * from public.apply_backup_import($1::uuid, '[]'::jsonb, '[]'::jsonb)`, [previewId]);
    }
    if (runId && phases.includes("undo_preview")) {
      const { res } = await measure("undo_preview", `select * from public.preview_undo_backup_import($1::uuid)`, [runId]);
      if (res) { undoPreviewId = res.rows[0].undo_preview_id; row.undoSafe = res.rows[0].is_safe; }
      await profileRun("undo_preview", `select * from public.preview_undo_backup_import($1::uuid)`, [runId]);
    }
    if (undoPreviewId && phases.includes("undo_apply")) {
      await profileRun("undo_apply", `select * from public.apply_undo_backup_import($1::uuid)`, [undoPreviewId]);
      await measure("undo_apply", `select * from public.apply_undo_backup_import($1::uuid)`, [undoPreviewId]);
    }

    results.push(row);
    await admin.query(`delete from public.import_runs where owner_id = $1`, [uid]).catch(() => {});
    await admin.query(`delete from auth.users where id = $1`, [uid]);
    if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  }
  await pg.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
