import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCollectionsCenterEntries } from "../collections-center.ts";
import type { PaymentChargeLike } from "../types.ts";

function charge(overrides: Partial<PaymentChargeLike & { studentId: string }> = {}): PaymentChargeLike & { studentId: string } {
  return { id: "c1", chargeType: "mensual", originalAmount: 30000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1", ...overrides };
}

const students = [
  { id: "s1", name: "PRUEBA WEB F5 Alumno 1", status: "activo" as const },
  { id: "s2", name: "PRUEBA WEB F5 Alumno inactivo", status: "inactivo" as const },
];

test("buildCollectionsCenterEntries: nunca muestra un cargo ya saldado", () => {
  const entries = buildCollectionsCenterEntries({
    charges: [charge()],
    allocations: [{ chargeId: "c1", amount: 30000, paymentVoidedAt: null }],
    students,
    todayDateKey: "2026-09-15",
  });
  assert.deepEqual(entries, []);
});

test("buildCollectionsCenterEntries: nunca muestra un cargo anulado", () => {
  const entries = buildCollectionsCenterEntries({
    charges: [charge({ voidedAt: "2026-09-11T00:00:00Z" })],
    allocations: [],
    students,
    todayDateKey: "2026-09-15",
  });
  assert.deepEqual(entries, []);
});

test("buildCollectionsCenterEntries: excluye alumnos no-activos (decisión de representación, la deuda real no se borra)", () => {
  const entries = buildCollectionsCenterEntries({
    charges: [charge({ id: "c2", studentId: "s2" })],
    allocations: [],
    students,
    todayDateKey: "2026-09-15",
  });
  assert.deepEqual(entries, []);
});

test("buildCollectionsCenterEntries: calcula saldo real y ordena por urgencia (vencido primero)", () => {
  const entries = buildCollectionsCenterEntries({
    charges: [
      charge({ id: "c-vencido", dueDate: "2026-08-01" }),
      charge({ id: "c-en-termino", dueDate: "2026-09-30" }),
    ],
    allocations: [{ chargeId: "c-vencido", amount: 10000, paymentVoidedAt: null }],
    students,
    todayDateKey: "2026-09-15",
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].chargeId, "c-vencido");
  assert.equal(entries[0].balance, 20000);
  assert.equal(entries[0].isOverdue, true);
  assert.equal(entries[1].chargeId, "c-en-termino");
  assert.equal(entries[1].isOverdue, false);
});
