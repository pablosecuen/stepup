import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectionsCenterEntries, buildCollectionsCenterEntriesFromBalances, type ChargeWithPaidAmount } from "../collections-center.ts";
import type { PaymentAllocationLike, PaymentChargeLike } from "../types.ts";

// R2 — Las dos vías para armar el Centro de cobros (listas completas de cargos/asignaciones vs. saldos ya calculados por la RPC
// `list_open_charge_balances`) deben dar EXACTAMENTE las mismas tarjetas, en el mismo orden, y los totales deben coincidir con un
// cálculo independiente. Datos en centavos enteros (sin ruido de coma flotante) y generados de forma determinista.

const TODAY = "2026-10-06";

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Dataset {
  charges: (PaymentChargeLike & { studentId: string })[];
  allocations: PaymentAllocationLike[];
  students: { id: string; name: string; status: "activo" | "pausado" | "inactivo" | "archivado" }[];
}

function dataset(seed: number, studentCount: number, periods: number): Dataset {
  const random = rng(seed);
  const students = Array.from({ length: studentCount }, (_, i) => ({
    id: `s${String(i).padStart(4, "0")}`,
    name: `Alumno ${String(i).padStart(4, "0")}`,
    status: (i % 11 === 0 ? "pausado" : i % 13 === 0 ? "archivado" : "activo") as "activo" | "pausado" | "archivado",
  }));
  const charges: Dataset["charges"] = [];
  const allocations: PaymentAllocationLike[] = [];
  let n = 0;
  for (const student of students) {
    for (let p = 0; p < periods; p += 1) {
      n += 1;
      const id = `c${String(n).padStart(7, "0")}`;
      const month = 1 + (p % 12);
      const year = 2025 + Math.floor(p / 12);
      const original = 100000 + Math.floor(random() * 5) * 50000; // centavos → montos con decimales exactos en pesos
      const voided = random() < 0.07;
      charges.push({
        id,
        studentId: student.id,
        chargeType: random() < 0.15 ? "entrenamiento" : "mensual",
        originalAmount: original / 100,
        dueDate: `${year}-${String(month).padStart(2, "0")}-10`,
        voidedAt: voided ? "2026-01-01T00:00:00Z" : null,
      });
      const pieces = Math.floor(random() * 4); // 0..3 asignaciones
      for (let k = 0; k < pieces; k += 1) {
        allocations.push({
          chargeId: id,
          amount: Math.floor((original / 2) * random() + 1) / 100,
          paymentVoidedAt: random() < 0.25 ? "2026-02-01T00:00:00Z" : null,
        });
      }
    }
  }
  return { charges, allocations, students };
}

/** Lo que la RPC calcula: cargo no anulado, pagado = asignaciones de pagos no anulados, abierto si original - pagado > 0 (en centavos). */
function balancesLikeSql(d: Dataset): ChargeWithPaidAmount[] {
  const paid = new Map<string, number>();
  for (const a of d.allocations) {
    if (a.paymentVoidedAt !== null) continue;
    paid.set(a.chargeId, (paid.get(a.chargeId) ?? 0) + Math.round(a.amount * 100));
  }
  return d.charges
    .filter((c) => c.voidedAt === null && Math.round(c.originalAmount * 100) - (paid.get(c.id) ?? 0) > 0)
    .map((charge) => ({ charge, paidAmount: (paid.get(charge.id) ?? 0) / 100 }));
}

/**
 * Importes en centavos enteros. Las listas completas suman en coma flotante (0,1 + 0,2 = 0,30000000000000004) y la RPC en
 * `numeric` exacto: lo único que puede diferir entre las dos vías es ese ruido de coma flotante, nunca el importe real.
 */
function inCents<T extends { paidAmount: number; balance: number; originalAmount: number }>(entries: T[]) {
  return entries.map((e) => ({ ...e, paidAmount: Math.round(e.paidAmount * 100), balance: Math.round(e.balance * 100), originalAmount: Math.round(e.originalAmount * 100) }));
}

for (const [label, studentCount, periods] of [["cuenta chica", 12, 3], ["1.800 cargos", 60, 30], ["más de 5.000 cargos", 130, 40]] as const) {
  test(`Centro de cobros (${label}): listas completas y saldos de la RPC dan las MISMAS tarjetas en el MISMO orden`, () => {
    const d = dataset(7 + studentCount, studentCount, periods);
    const fromLists = buildCollectionsCenterEntries({ charges: d.charges, allocations: d.allocations, students: d.students, todayDateKey: TODAY });
    const fromBalances = buildCollectionsCenterEntriesFromBalances({ balances: balancesLikeSql(d), students: d.students, todayDateKey: TODAY });
    assert.ok(fromLists.length > 0);
    assert.deepEqual(inCents(fromBalances), inCents(fromLists));
  });
}

test("el orden NO depende del orden en que llegan los saldos (desempate determinista por alumno y luego id)", () => {
  const d = dataset(99, 40, 6);
  const balances = balancesLikeSql(d);
  const expected = buildCollectionsCenterEntriesFromBalances({ balances, students: d.students, todayDateKey: TODAY });
  const reversed = buildCollectionsCenterEntriesFromBalances({ balances: [...balances].reverse(), students: d.students, todayDateKey: TODAY });
  const shuffled = buildCollectionsCenterEntriesFromBalances({
    balances: [...balances].sort((a, b) => (a.charge.id.charCodeAt(4) % 5) - (b.charge.id.charCodeAt(4) % 5) || (a.charge.id < b.charge.id ? 1 : -1)),
    students: d.students,
    todayDateKey: TODAY,
  });
  assert.deepEqual(reversed, expected);
  assert.deepEqual(shuffled, expected);
});

test("mensualidades del mismo día (empate): salen en el orden de la lista de alumnos (como las creó ensure_monthly_charges)", () => {
  const students = ["Zoe", "Ana", "Mara"].map((name, i) => ({ id: `s${i}`, name, status: "activo" as const }));
  // La lista de alumnos llega ordenada por nombre (como la lee la web): Ana, Mara, Zoe.
  const ordered = [students[1], students[2], students[0]];
  const balances: ChargeWithPaidAmount[] = ["s0", "s1", "s2"].map((studentId, i) => ({
    charge: { id: `c${i}`, studentId, chargeType: "mensual", originalAmount: 1000, dueDate: "2026-10-10", voidedAt: null },
    paidAmount: 0,
  }));
  const entries = buildCollectionsCenterEntriesFromBalances({ balances, students: ordered, todayDateKey: TODAY });
  assert.deepEqual(entries.map((e) => e.studentName), ["Ana", "Mara", "Zoe"]);
});

test("totales exactos frente a un cálculo independiente (suma en centavos enteros)", () => {
  const d = dataset(2026, 90, 24);
  const entries = buildCollectionsCenterEntriesFromBalances({ balances: balancesLikeSql(d), students: d.students, todayDateKey: TODAY });
  const activeIds = new Set(d.students.filter((s) => s.status === "activo").map((s) => s.id));
  let independentCents = 0;
  const paid = new Map<string, number>();
  for (const a of d.allocations) if (a.paymentVoidedAt === null) paid.set(a.chargeId, (paid.get(a.chargeId) ?? 0) + Math.round(a.amount * 100));
  for (const c of d.charges) {
    if (c.voidedAt !== null || !activeIds.has(c.studentId)) continue;
    independentCents += Math.max(0, Math.round(c.originalAmount * 100) - (paid.get(c.id) ?? 0));
  }
  const engineCents = entries.reduce((sum, e) => sum + Math.round(e.balance * 100), 0);
  assert.equal(engineCents, independentCents);
  // Sólo alumnos activos y cargos con saldo
  assert.ok(entries.every((e) => activeIds.has(e.studentId) && e.balance > 0));
});

test("un cargo ya saldado o anulado pasado de más no genera tarjeta (igual que antes)", () => {
  const students = [{ id: "s1", name: "Ana", status: "activo" as const }];
  const balances: ChargeWithPaidAmount[] = [
    { charge: { id: "c1", studentId: "s1", chargeType: "mensual", originalAmount: 1000, dueDate: "2026-10-10", voidedAt: null }, paidAmount: 1000 },
    { charge: { id: "c2", studentId: "s1", chargeType: "mensual", originalAmount: 1000, dueDate: "2026-09-10", voidedAt: "2026-10-01T00:00:00Z" }, paidAmount: 0 },
    { charge: { id: "c3", studentId: "s1", chargeType: "mensual", originalAmount: 1000, dueDate: "2026-08-10", voidedAt: null }, paidAmount: 400 },
  ];
  const entries = buildCollectionsCenterEntriesFromBalances({ balances, students, todayDateKey: TODAY });
  assert.deepEqual(entries.map((e) => [e.chargeId, e.balance, e.paidAmount]), [["c3", 600, 400]]);
});
