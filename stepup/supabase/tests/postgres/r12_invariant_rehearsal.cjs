// R12 — El invariante de los cobros cuenta sólo las asignaciones VIGENTES (pagos no anulados). Postgres REAL aislado, datos SINTÉTICOS.
//
//   • con R12: un cobro con la asignación de un pago ANULADO (que sumada al pago vigente lo supera) se importa; el mismo respaldo con una asignación vigente de más SIGUE deteniéndose;
//   • con el rollback (invariante de R6): el caso del pago anulado vuelve a abortar; al reaplicar R12 se importa de nuevo (idempotente);
//   • nada se reduce, aumenta ni redistribuye: lo importado coincide con el respaldo (importes de pagos, cobros y asignaciones).
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/r12_invariant_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase", "migrations", "20261020100000_r12_import_invariant_active_allocations.sql"), "utf8");
const ROLLBACK = fs.readFileSync(path.join(ROOT, "supabase", "repairs", "r12_import_invariant_rollback.sql"), "utf8");

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
  const pg = await start({ port: 5711 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    check("la migración R12 existe (lo único posterior es R13 y R14)", fs.readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f > "20261020100000_zzz").every((f) => /_r1[34]_/.test(f)));

    /** Respaldo sintético: chg-1 (importe X) pagado por pay-1; a eso se suman pagos extra con sus asignaciones. */
    const backup = (extras) => {
      const doc = buildMobileBackup();
      for (const e of extras) {
        doc.payments.push({ id: e.id, studentId: "stu-1", amount: e.amount, currency: "ARS", method: "transferencia", paidAt: "2026-10-06", recordedAt: "2026-10-06T18:30:00.000Z", notes: null, voidedAt: e.voided ? "2026-10-07T10:00:00.000Z" : null, voidReason: e.voided ? "pago cargado dos veces" : null });
        doc.paymentAllocations.push({ id: `alo-${e.id}`, paymentId: e.id, chargeId: "chg-1", studentId: "stu-1", amount: e.amount });
      }
      return doc;
    };
    const run = async (doc, { stripExcess = false } = {}) => {
      await H.reset(admin);
      const validation = validateBackupPayload(doc);
      if (!validation.ok) throw new Error("la validación rechaza el respaldo sintético: " + [...new Set(validation.errors.map((e) => e.code))].join(","));
      const s = await H.apiSession(pg, H.A, 300000);
      try {
        // R13 hace que el adaptador SEPARE el exceso; para probar el invariante de R12 por sí solo se quita esa separación.
        const backup = JSON.parse(JSON.stringify(validation.backup));
        if (stripExcess) for (const a of backup.paymentAllocations ?? []) delete a.excess;
        const preview = await H.previewOf(s, backup, validation.excludedCollections);
        return { applied: await H.applyOf(s, preview.preview_id, [], []), s };
      } catch (error) {
        await s.end();
        return { error: String(error.message) };
      }
    };
    const amounts = async () => (await admin.query("select (select coalesce(sum(amount), 0) from public.payments where owner_id = $1)::text p, (select coalesce(sum(original_amount), 0) from public.payment_charges where owner_id = $1)::text c, (select coalesce(sum(amount), 0) from public.payment_allocations where owner_id = $1)::text a, (select count(*)::int from public.payment_allocations where owner_id = $1) n", [H.A])).rows[0];

    const voided = backup([{ id: "pay-v", amount: 41000.37, voided: true }]);
    const over = backup([{ id: "pay-x", amount: 100, voided: false }]);

    let r = await run(voided);
    check("con R12: el cobro con la asignación de un pago ANULADO se importa", !r.error && r.applied, r.error);
    if (r.s) {
      const got = await amounts();
      const cents = (list) => list.reduce((sum, x) => sum + Math.round(Number(x.amount ?? x.originalAmount) * 100), 0);
      check(
        "lo importado es EXACTAMENTE el respaldo: ningún pago, cobro o asignación se reduce, aumenta ni redistribuye",
        got.n === voided.paymentAllocations.length && Math.round(Number(got.a) * 100) === cents(voided.paymentAllocations) && Math.round(Number(got.p) * 100) === cents(voided.payments) && Math.round(Number(got.c) * 100) === cents(voided.paymentCharges),
        JSON.stringify(got)
      );
      await s_end(r.s);
    }

    r = await run(over, { stripExcess: true });
    check("con R12: una asignación VIGENTE de más, sin separar el exceso, SIGUE deteniendo la importación", Boolean(r.error) && /Invariante violada: las asignaciones de un cargo superan su importe original/.test(r.error), r.error ?? "se importó");
    check("y no queda nada a medias en la cuenta", Number((await amounts()).n) === 0);

    await admin.query(ROLLBACK);
    r = await run(voided);
    check("con el rollback (invariante de R6) el caso del pago anulado vuelve a abortar", Boolean(r.error) && /superan su importe original/.test(r.error), r.error ?? "se importó");

    await admin.query(MIGRATION);
    await admin.query(MIGRATION);
    r = await run(voided);
    check("al reaplicar R12 (dos veces: idempotente) se importa de nuevo", !r.error && r.applied, r.error);
    if (r.s) await s_end(r.s);
  } finally {
    await pg.stop();
    fs.rmSync(pg.dir, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n✗ ${failures.length} de ${total} fallaron:\n  - ${failures.join("\n  - ")}` : `\n✓ ${total}/${total} comprobaciones`);
  process.exitCode = failures.length ? 1 : 0;
}
const s_end = async (s) => s.end();

main().catch((e) => {
  console.error("La prueba falló:", String(e.stack || e.message).split("\n").slice(0, 4).join(" | "));
  process.exitCode = 1;
});
