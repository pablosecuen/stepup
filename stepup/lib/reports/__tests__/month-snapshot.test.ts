import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthSnapshot, type MonthSnapshotInput } from "../month-snapshot.ts";

const TODAY = "2026-10-20";
const charge = (id: string, studentId: string, dueDate: string, originalAmount = 10000, voidedAt: string | null = null) => ({ id, studentId, originalAmount, dueDate, voidedAt });
const payment = (id: string, paidAt: string, voidedAt: string | null = null) => ({ id, paidAt, voidedAt });
const allocation = (chargeId: string, paymentId: string, amount: number) => ({ chargeId, paymentId, amount });

function snapshot(over: Partial<MonthSnapshotInput>) {
  return buildMonthSnapshot({ charges: [], allocations: [], payments: [], studentStatusById: new Map(), evaluationDate: TODAY, ...over });
}

test("alumnos que pagaron este mes: ÚNICOS (no cantidad de pagos), por la fecha real de pago y sólo pagos vigentes", () => {
  const result = snapshot({
    charges: [charge("c1", "s1", "2026-10-10"), charge("c2", "s1", "2026-10-11"), charge("c3", "s2", "2026-09-10"), charge("c4", "s3", "2026-10-10")],
    payments: [payment("p1", "2026-10-05T15:00:00.000Z"), payment("p2", "2026-10-07T15:00:00.000Z"), payment("p3", "2026-09-28T15:00:00.000Z"), payment("p4", "2026-10-08T15:00:00.000Z", "2026-10-09T00:00:00.000Z")],
    allocations: [allocation("c1", "p1", 10000), allocation("c2", "p2", 10000), allocation("c3", "p3", 10000), allocation("c4", "p4", 10000)],
  });
  assert.equal(result.studentsPaidThisMonth, 1);
});

test("un pago de la noche del último día del mes anterior (hora de Argentina) no cuenta para este mes", () => {
  // 30/09 22:30 en Argentina = 01/10 01:30Z.
  const result = snapshot({ charges: [charge("c1", "s1", "2026-09-10")], payments: [payment("p1", "2026-10-01T01:30:00.000Z")], allocations: [allocation("c1", "p1", 10000)] });
  assert.equal(result.studentsPaidThisMonth, 0);
});

test("alumnos con deuda y deuda de meses anteriores: saldo positivo de cargos activos de alumnos activos; un cargo saldado, anulado o de un alumno inactivo no cuenta", () => {
  const result = snapshot({
    charges: [
      charge("old", "s1", "2026-08-10", 10000),
      charge("part", "s2", "2026-09-10", 10000),
      charge("now", "s3", "2026-10-10", 10000),
      charge("paid", "s4", "2026-09-10", 10000),
      charge("void", "s5", "2026-09-10", 10000, "2026-09-12T00:00:00.000Z"),
      charge("inactive", "s6", "2026-09-10", 10000),
    ],
    payments: [payment("p1", "2026-09-15T15:00:00.000Z"), payment("p2", "2026-10-02T15:00:00.000Z")],
    allocations: [allocation("part", "p1", 4000), allocation("paid", "p2", 10000)],
    studentStatusById: new Map([["s6", "pausado"]]),
  });
  assert.equal(result.priorPeriodsDebt, 16000);
  assert.equal(result.studentsWithDebt, 3);
});

test("un pago anulado no salda nada: el cargo sigue con saldo", () => {
  const result = snapshot({ charges: [charge("c1", "s1", "2026-09-10")], payments: [payment("p1", "2026-10-02T15:00:00.000Z", "2026-10-03T00:00:00.000Z")], allocations: [allocation("c1", "p1", 10000)] });
  assert.equal(result.priorPeriodsDebt, 10000);
  assert.equal(result.studentsWithDebt, 1);
  assert.equal(result.studentsPaidThisMonth, 0);
});
