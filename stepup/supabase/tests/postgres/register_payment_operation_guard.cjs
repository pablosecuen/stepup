// register_payment: protección de la clave de operación (migración 20261112100000). Postgres REAL aislado, datos SINTÉTICOS.
//
//   set NODE_PATH=C:\Users\joaqu\tf-design\epg\node_modules
//   node supabase/tests/postgres/register_payment_operation_guard.cjs            (con la protección)
//   node supabase/tests/postgres/register_payment_operation_guard.cjs --before   (sólo hasta la migración anterior: muestra el defecto real; termina con error A PROPÓSITO)
//
// Misma clave + mismo contenido = reintento seguro (la misma fila); misma clave + otro importe/cobro/método/fecha/notas = error claro (no «éxito» con el pago anterior); una clave nueva = pago nuevo;
// un error de validación no guarda nada y la misma clave se puede reintentar con datos correctos; doble envío simultáneo = un solo pago; otra cuenta no ve ni pisa la clave.
const { start } = require("./load.cjs");

const BEFORE = process.argv.includes("--before");
const A = "fe000000-0000-0000-0000-000000000001";
const B = "fe000000-0000-0000-0000-000000000002";
const SA = "fe100000-0000-0000-0000-000000000001";
const SB = "fe100000-0000-0000-0000-000000000002";
const C1 = "fe200000-0000-0000-0000-000000000001";
const C2 = "fe200000-0000-0000-0000-000000000002";
const CB = "fe200000-0000-0000-0000-000000000003";
const op = (n) => `fe300000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
const pay = (s, payload) => attempt(async () => (await s.query("select to_jsonb(public.register_payment($1::jsonb)) as p", [JSON.stringify(payload)])).rows[0].p);
const base = (n, extra = {}) => ({ operation_id: op(n), student_id: SA, amount: 1000, method: "efectivo", paid_at: "2026-11-12", notes: null, charge_id: C1, replaces_payment_id: null, ...extra });
const count = async (admin, owner) => Number((await admin.query("select count(*)::int n from public.payments where owner_id = $1", [owner])).rows[0].n);
const allocSum = async (admin, chargeId) => Number((await admin.query("select coalesce(sum(a.amount),0) s from public.payment_allocations a join public.payments p on p.id = a.payment_id where a.charge_id = $1 and p.voided_at is null", [chargeId])).rows[0].s);

async function main() {
  const pg = await start({ port: 5792, ...(BEFORE ? { upTo: "20261111110000_plan_json_null_entrypoints.sql" } : {}) });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await admin.query("delete from auth.users where id in ($1, $2)", [A, B]);
    await admin.query("insert into auth.users (id, email) values ($1, 'a@example.invalid'), ($2, 'b@example.invalid')", [A, B]);
    const mk = async (id, owner, name) => admin.query(`insert into public.students (id, owner_id, name, modality, category, billing_type, date_joined, price) values ($1, $2, $3, 'presencial', 'otro', 'mensual', '2026-01-01', 10000)`, [id, owner, name]);
    await mk(SA, A, "Alumno A");
    await mk(SB, B, "Alumno B");
    const charge = (id, owner, student, amount, period) => admin.query(`insert into public.payment_charges (id, owner_id, student_id, charge_type, original_amount, due_date, billing_period) values ($1, $2, $3, 'mensual', $4, '2026-11-10', $5)`, [id, owner, student, amount, period]);
    await charge(C1, A, SA, 10000, "2026-11");
    await charge(C2, A, SA, 5000, "2026-12");
    await charge(CB, B, SB, 10000, "2026-11");
    const sa = await pg.session(A);
    const sb = await pg.session(B);

    // 1) Reintento exacto
    const first = await pay(sa, base(1));
    check("pago nuevo con clave nueva: se registra", first.ok && Number(first.value.amount) === 1000, first.message);
    const retry = await pay(sa, base(1));
    check("misma clave y mismo contenido: devuelve el MISMO pago (reintento seguro)", retry.ok && first.ok && retry.value.id === first.value.id, retry.message);
    check("…y no duplica pagos ni asignaciones", (await count(admin, A)) === 1 && (await allocSum(admin, C1)) === 1000);

    // 2) Misma clave, otros datos
    const cases = [
      ["otro importe", base(1, { amount: 1500 })],
      ["otro cobro", base(1, { charge_id: C2 })],
      ["otro método", base(1, { method: "transferencia" })],
      ["otra fecha", base(1, { paid_at: "2026-11-13" })],
      ["otras notas", base(1, { notes: "distinto" })],
      ["sin cobro único (modo general)", base(1, { charge_id: null, amount: 1000 })],
    ];
    for (const [label, payload] of cases) {
      const r = await pay(sa, payload);
      const expectedReject = label !== "sin cobro único (modo general)"; // el modo general con los mismos datos de pago no se distingue por el pago en sí
      if (expectedReject) check(`misma clave con ${label}: se RECHAZA con un error claro, no «éxito» con el pago anterior`, !r.ok && r.code === "22023" && /ya se registró con otros datos/.test(r.message), r.ok ? "FALLA SILENCIOSA: devolvió el pago anterior" : r.message);
    }
    check("los rechazos no escribieron nada", (await count(admin, A)) === 1 && (await allocSum(admin, C1)) === 1000);

    // 3) Segundo pago real sobre el mismo cobro, sin recargar = clave nueva
    const second = await pay(sa, base(2, { amount: 2500 }));
    check("segundo pago sobre el mismo cobro con clave nueva: se registra", second.ok && second.value.id !== first.value?.id, second.message);
    check("saldo del cobro correcto tras dos pagos (1000 + 2500)", (await allocSum(admin, C1)) === 3500 && (await count(admin, A)) === 2);

    // 4) Un error de validación no guarda nada y la misma clave se puede reintentar corregida
    const tooMuch = await pay(sa, base(3, { amount: 999999 }));
    check("importe mayor al saldo: error y no se guarda nada", !tooMuch.ok && (await count(admin, A)) === 2, tooMuch.message);
    const fixed = await pay(sa, base(3, { amount: 500 }));
    check("la misma clave se puede reintentar con datos correctos tras un error de validación", fixed.ok && Number(fixed.value.amount) === 500, fixed.message);

    // 5) Doble envío simultáneo con la misma clave
    const sa2 = await pg.session(A);
    const [x, y] = await Promise.all([pay(sa, base(4, { amount: 700 })), pay(sa2, base(4, { amount: 700 }))]);
    check("doble clic simultáneo con la misma clave: los dos «ven» el mismo pago", x.ok && y.ok && x.value.id === y.value.id, `${x.message ?? ""} ${y.message ?? ""}`);
    check("…y hay UN solo pago de 700 y una sola asignación", Number((await admin.query("select count(*)::int n from public.payments where owner_id = $1 and operation_id = $2", [A, op(4)])).rows[0].n) === 1 && (await allocSum(admin, C1)) === 3500 + 500 + 700);
    const [m, n] = await Promise.all([pay(sa, base(5, { amount: 100 })), pay(sa2, base(5, { amount: 200 }))]);
    check("dos envíos simultáneos con la misma clave y distinto importe: uno se registra y el otro se rechaza", [m, n].filter((r) => r.ok).length === 1 && [m, n].filter((r) => !r.ok && r.code === "22023").length === 1, JSON.stringify([m.message, n.message]));

    // 6) Aislamiento entre cuentas
    const bOwn = await pay(sb, { ...base(1), student_id: SB, charge_id: CB, amount: 4000 });
    check("otra cuenta puede usar el mismo operation_id para SU pago (la clave es por cuenta)", bOwn.ok && Number(bOwn.value.amount) === 4000, bOwn.message);
    const bOnA = await pay(sb, base(6));
    check("otra cuenta no puede pagar un alumno ajeno", !bOnA.ok);
    check("el pago de la cuenta A con esa clave no cambió", Number((await admin.query("select amount from public.payments where owner_id = $1 and operation_id = $2", [A, op(1)])).rows[0].amount) === 1000);
    const reuse = await pay(sa, base(1, { amount: 1000 }));
    check("la cuenta A sigue viendo su reintento exacto", reuse.ok && reuse.value.id === first.value.id);

    await sa.end?.(); await sa2.end?.(); await sb.end?.();
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
