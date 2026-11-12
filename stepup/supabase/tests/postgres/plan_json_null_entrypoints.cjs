// Otros puntos de entrada del JSON null (migración 20261111110000): la importación del respaldo y `apply_financial_reconciliation`. Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=C:\Users\joaqu\tf-design\epg\node_modules
//   node supabase/tests/postgres/plan_json_null_entrypoints.cjs            (con la corrección)
//   node supabase/tests/postgres/plan_json_null_entrypoints.cjs --before   (sólo hasta la migración anterior: muestra el defecto real; termina con error A PROPÓSITO)
//
// SQL NULL, JSON null y valores inválidos: importación (JSON null → NULL de SQL, objeto intacto, texto/número/arreglo/booleano rechazados sin guardar nada) y reconciliación (el plan se
// resuelve con la misma función validada: las comprobaciones de importe y de cobertura ya no «fallan abiertas» con JSON null, NULL de SQL ni escalares).
const { start } = require("./load.cjs");
const { emptyBackup, student } = require("./r6_dataset.cjs");

const BEFORE = process.argv.includes("--before");
const A = "fd000000-0000-0000-0000-000000000001";
const B = "fd000000-0000-0000-0000-000000000002";
const S = (n) => `fd1000${String(n).padStart(2, "0")}-0000-0000-0000-000000000001`;
const C = (n) => `fd2000${String(n).padStart(2, "0")}-0000-0000-0000-000000000001`;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, code: error.code, message: String(error.message) };
  }
}
const previewOf = async (s, backup) => (await s.query("select * from public.preview_backup_import($1::jsonb, '[]'::jsonb)", [JSON.stringify(backup)])).rows[0];
const applyOf = async (s, id) => (await s.query("select * from public.apply_backup_import($1::uuid, '[]'::jsonb, '[]'::jsonb)", [id])).rows[0];

async function importPlans(pg, session, plans) {
  const backup = emptyBackup();
  backup.students = plans.map(([id, plan]) => {
    const row = student(id);
    if (plan === undefined) delete row.billingPlan;
    else row.billingPlan = plan;
    return row;
  });
  const preview = await previewOf(session, backup);
  return attempt(() => applyOf(session, preview.preview_id));
}
const planOf = async (admin, legacyId) => (await admin.query("select billing_plan as p, jsonb_typeof(billing_plan) as t from public.students where owner_id = $1 and legacy_mobile_id = $2", [A, legacyId])).rows[0];
const countStudents = async (admin, owner) => Number((await admin.query("select count(*)::int n from public.students where owner_id = $1", [owner])).rows[0].n);

async function seedReconciliation(admin) {
  await admin.query("truncate public.students cascade");
  const period = (await admin.query("select to_char(now() at time zone 'America/Argentina/Buenos_Aires','YYYY-MM') p")).rows[0].p;
  const due = `${period}-10`;
  const mk = async (n, type, price, plan, chargeType, chargeAmount) => {
    await admin.query(`insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price, billing_plan) values ($1, $2, $3, 'presencial', 'otro', $4, '2026-01-01', $5, $6::jsonb)`, [S(n), A, `RC ${n}`, type, price, plan]);
    // Un cargo por clase exige su clase registrada (restricción payment_charges_saved_lesson_required).
    const saved = chargeType === "por_clase" ? (await admin.query("insert into public.lesson_registrations (owner_id) values ($1) returning id", [A])).rows[0].id : null;
    await admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period, saved_lesson_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [C(n), A, S(n), chargeType, chargeAmount, due, period, saved]);
  };
  await mk(1, "mensual", 100000, "null", "mensual", 90000); // JSON null, mensual: el plan derivado vale 100000
  await mk(2, "mensual", 100000, null, "mensual", 90000); // NULL de SQL, mensual
  await mk(3, "mensual", 100000, JSON.stringify({ type: "monthly", amount: 100000, dueDay: 10 }), "mensual", 90000); // objeto
  await mk(4, "mensual", 100000, '"monthly"', "mensual", 90000); // escalar no reconocido
  await mk(5, "por_clase", 8000, "null", "por_clase", 8000); // JSON null, por clase: NO está cubierto por un plan mensual
  await mk(6, "por_clase", 8000, JSON.stringify({ type: "per_class", amount: 8000 }), "por_clase", 8000); // objeto por clase
  return { period, due };
}
const snapshotOf = async (s) => (await s.query("select public.financial_reconciliation_snapshot() as r")).rows[0].r;
async function reconcile(s, patch) {
  const snap = await snapshotOf(s);
  return attempt(async () => (await s.query("select public.apply_financial_reconciliation($1, $2::jsonb) as n", [snap.token, JSON.stringify([patch])])).rows[0].n);
}
const chargeRow = async (admin, n) => (await admin.query("select original_amount as a, voided_at as v from public.payment_charges where id = $1", [C(n)])).rows[0];

async function main() {
  const pg = await start({ port: 5791, ...(BEFORE ? { upTo: "20261111100000_student_plan_json_null.sql" } : {}) });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await admin.query("insert into auth.users (id, email) values ($1, 'a@example.invalid'), ($2, 'b@example.invalid')", [A, B]);
    const sa = await pg.session(A);

    // ── Importación ──
    const ok = await importPlans(pg, sa, [
      ["i-null", null], // JSON null del respaldo de la app
      ["i-missing", undefined], // la clave no viene
      ["i-object", { type: "monthly", amount: 5000.5, dueDay: 5 }],
    ]);
    check("importación: un respaldo con JSON null, clave ausente y objeto se aplica", ok.ok, ok.message);
    const nullPlan = await planOf(admin, "i-null");
    const missingPlan = await planOf(admin, "i-missing");
    const objectPlan = await planOf(admin, "i-object");
    check("importación: billingPlan JSON null se guarda como NULL de SQL (no como jsonb 'null')", nullPlan && nullPlan.p === null && nullPlan.t === null, JSON.stringify(nullPlan));
    check("importación: sin clave billingPlan también queda NULL de SQL", missingPlan && missingPlan.p === null, JSON.stringify(missingPlan));
    check("importación: un plan objeto se conserva idéntico (centavos exactos)", objectPlan && objectPlan.t === "object" && objectPlan.p.type === "monthly" && Number(objectPlan.p.amount) === 5000.5 && objectPlan.p.dueDay === 5, JSON.stringify(objectPlan));

    if (!BEFORE) {
      for (const [label, bad] of [["texto", "monthly"], ["número", 12], ["arreglo", [1, 2]], ["booleano", true]]) {
        const sb = await pg.session(B);
        const before = await countStudents(admin, B);
        const result = await importPlans(pg, sb, [["bad-" + label, bad]]);
        const after = await countStudents(admin, B);
        check(`importación: un billingPlan ${label} se rechaza con mensaje claro y no se guarda ningún alumno`, !result.ok && /formato no reconocido/.test(result.message) && after === before, `${result.message ?? "aceptado"} (${before}→${after})`);
        await sb.end?.();
      }
    }

    // ── Reconciliación ──
    const { period, due } = await seedReconciliation(admin);
    const patchAmount = (n, amount) => ({ id: C(n), amount, dueDate: due, reason: "monthly_amount", voidedAt: null, voidReason: null });
    const noMatch = /El importe no coincide con el plan vigente/;

    for (const [n, label] of [[1, "JSON null"], [2, "NULL de SQL"]]) {
      const wrong = await reconcile(sa, patchAmount(n, 95000));
      check(`reconciliación (${label}, mensual): un importe que NO es el del plan derivado se rechaza`, !wrong.ok && noMatch.test(wrong.message), wrong.ok ? "FALLA ABIERTA: se aceptó 95000" : wrong.message);
      check(`reconciliación (${label}): el cargo no cambió tras el rechazo`, Number((await chargeRow(admin, n)).a) === 90000);
      const right = await reconcile(sa, patchAmount(n, 100000));
      check(`reconciliación (${label}, mensual): el importe del plan derivado (100000) se acepta y queda exacto`, right.ok && Number((await chargeRow(admin, n)).a) === 100000, right.message);
    }
    const objWrong = await reconcile(sa, patchAmount(3, 95000));
    check("reconciliación (plan objeto): sin cambios — un importe distinto del plan se rechaza", !objWrong.ok && noMatch.test(objWrong.message), objWrong.message ?? "aceptado");
    const objRight = await reconcile(sa, patchAmount(3, 100000));
    check("reconciliación (plan objeto): el importe del plan se acepta", objRight.ok && Number((await chargeRow(admin, 3)).a) === 100000, objRight.message);

    const scalar = await reconcile(sa, patchAmount(4, 95000));
    check("reconciliación (plan escalar no reconocido): se rechaza (antes fallaba abierta)", !scalar.ok, scalar.ok ? "FALLA ABIERTA: se aceptó" : scalar.message);
    if (!BEFORE) check("reconciliación (plan escalar): el motivo es el formato no reconocido, con un mensaje claro", /formato no reconocido/.test(scalar.message ?? ""), scalar.message);
    check("reconciliación (plan escalar): el cargo no cambió", Number((await chargeRow(admin, 4)).a) === 90000);

    const coverage = (n) => ({ id: C(n), amount: 8000, dueDate: due, reason: "monthly_coverage", voidedAt: new Date().toISOString(), voidReason: "cubierto por el plan mensual" });
    const forged = await reconcile(sa, coverage(5));
    check("reconciliación (JSON null, por clase): anular «por cobertura mensual» se rechaza — el plan derivado no es mensual", !forged.ok && /no está cubierto por el plan individual/.test(forged.message), forged.ok ? "FALLA ABIERTA: se anuló" : forged.message);
    check("reconciliación (JSON null, por clase): el cargo sigue vigente", (await chargeRow(admin, 5)).v === null);
    const forgedObject = await reconcile(sa, coverage(6));
    check("reconciliación (plan objeto por clase): la misma anulación se rechaza (sin regresión)", !forgedObject.ok && /no está cubierto por el plan individual/.test(forgedObject.message), forgedObject.message ?? "aceptado");

    const foreign = await pg.session(B);
    const crossOwner = await reconcile(foreign, patchAmount(1, 100000));
    check("reconciliación: otra cuenta no puede tocar el cargo", !crossOwner.ok);
    await foreign.end?.();

    // ── Datos históricos sin reescribir ──
    const untouched = (await admin.query("select count(*)::int n from public.students where owner_id = $1 and id = $2 and billing_plan = 'null'::jsonb", [A, S(1)])).rows[0].n;
    check("los alumnos que ya tenían jsonb 'null' siguen igual (no se reescriben datos históricos)", Number(untouched) === 1);
    void period;
    await sa.end?.();
  } finally {
    await pg.stop();
  }
  console.log(`\n${total - failures.length}/${total} comprobaciones`);
  if (failures.length) {
    console.log("FALLAS:\n- " + failures.join("\n- "));
    process.exit(BEFORE ? 2 : 1);
  }
  process.exit(0);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
