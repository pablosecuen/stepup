import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPeriodFinancialSummary, type PeriodFinancialSummaryInput } from "../financial-summary.ts";

const RANGE = { rangeStart: "2026-09-01", rangeEnd: "2026-09-30" };

function baseInput(overrides: Partial<PeriodFinancialSummaryInput> = {}): PeriodFinancialSummaryInput {
  return {
    charges: [],
    allocations: [],
    payments: [],
    range: RANGE,
    evaluationDate: "2026-09-22",
    ...overrides,
  };
}

test("buildPeriodFinancialSummary: factura prevista = suma de originalAmount de cargos activos con dueDate en el rango", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [
        { id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" },
        { id: "c2", chargeType: "mensual", originalAmount: 40000, dueDate: "2026-08-10", voidedAt: null, studentId: "s1" }, // fuera de rango
      ],
    })
  );
  assert.equal(summary.generated, 50000);
});

test("buildPeriodFinancialSummary: nunca suma un cargo anulado a facturación prevista", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: "2026-09-11", studentId: "s1" }],
    })
  );
  assert.equal(summary.generated, 0);
});

test("buildPeriodFinancialSummary: cobrado se agrupa por paidAt real del pago, nunca por dueDate del cargo", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-08-10", voidedAt: null, studentId: "s1" }], // cargo de agosto
      allocations: [{ chargeId: "c1", amount: 50000, paymentId: "p1" }],
      payments: [{ id: "p1", paidAt: "2026-09-05", voidedAt: null }], // pagado en septiembre
    })
  );
  // el cargo no cuenta en "generated" (dueDate fuera de rango), pero SÍ cuenta en "collected" porque se pagó en septiembre.
  assert.equal(summary.generated, 0);
  assert.equal(summary.collected, 50000);
});

test("buildPeriodFinancialSummary: nunca suma un pago anulado", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" }],
      allocations: [{ chargeId: "c1", amount: 50000, paymentId: "p1" }],
      payments: [{ id: "p1", paidAt: "2026-09-05", voidedAt: "2026-09-06" }],
    })
  );
  assert.equal(summary.collected, 0);
});

test("buildPeriodFinancialSummary: nunca suma una asignación hacia un cargo anulado", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: "2026-09-11", studentId: "s1" }],
      allocations: [{ chargeId: "c1", amount: 50000, paymentId: "p1" }],
      payments: [{ id: "p1", paidAt: "2026-09-05", voidedAt: null }],
    })
  );
  assert.equal(summary.collected, 0);
});

test("buildPeriodFinancialSummary: pago parcial nunca duplica un pago repartido entre varias obligaciones (se suma por asignación, no por total del pago)", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [
        { id: "c1", chargeType: "mensual", originalAmount: 30000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" },
        { id: "c2", chargeType: "mensual", originalAmount: 20000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" },
      ],
      allocations: [
        { chargeId: "c1", amount: 30000, paymentId: "p1" },
        { chargeId: "c2", amount: 20000, paymentId: "p1" }, // MISMO pago, repartido entre 2 cargos
      ],
      payments: [{ id: "p1", paidAt: "2026-09-05", voidedAt: null }],
    })
  );
  // el pago real fue de 50000 (30000+20000) — nunca debería contarse dos veces como 100000.
  assert.equal(summary.collected, 50000);
});

test("buildPeriodFinancialSummary: un pago registrado en el rango que salda deuda de un cargo de OTRO período igual cuenta como cobrado del rango (base caja real)", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-06-10", voidedAt: null, studentId: "s1" }], // deuda vieja de junio
      allocations: [{ chargeId: "c1", amount: 50000, paymentId: "p1" }],
      payments: [{ id: "p1", paidAt: "2026-09-15", voidedAt: null }], // pagada en septiembre
    })
  );
  assert.equal(summary.generated, 0, "el cargo de junio no genera facturación prevista de septiembre");
  assert.equal(summary.collected, 50000, "pero el cobro real de septiembre sí cuenta, por paidAt");
});

test("buildPeriodFinancialSummary: saldo pendiente en término vs. vencido, mutuamente excluyentes", () => {
  // Para mensual/entrenamiento, "vencido" real (isChargeOverdueForDisplay) es exactamente
  // daysUntilDue < 0 — sin ventana de gracia (esa ventana sólo aplica a la etapa de recargo,
  // que nunca se usa acá porque los recargos están desactivados). El mismo día del vencimiento
  // ("vence hoy") todavía cuenta como "pendiente en término", nunca como vencido.
  const summary = buildPeriodFinancialSummary(
    baseInput({
      evaluationDate: "2026-09-10", // vence HOY -> todavía en término
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" }],
    })
  );
  assert.equal(summary.pending, 50000);
  assert.equal(summary.overdue, 0);
});

test("buildPeriodFinancialSummary: cargo muy vencido cuenta en overdue, nunca en pending", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      evaluationDate: "2026-10-15", // más de 27 días de atraso real
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" }],
    })
  );
  assert.equal(summary.pending, 0);
  assert.equal(summary.overdue, 50000);
});

test("buildPeriodFinancialSummary: cargo ya saldado por completo no cuenta ni en pending ni en overdue", () => {
  const summary = buildPeriodFinancialSummary(
    baseInput({
      evaluationDate: "2026-10-15",
      charges: [{ id: "c1", chargeType: "mensual", originalAmount: 50000, dueDate: "2026-09-10", voidedAt: null, studentId: "s1" }],
      allocations: [{ chargeId: "c1", amount: 50000, paymentId: "p1" }],
      payments: [{ id: "p1", paidAt: "2026-09-20", voidedAt: null }],
    })
  );
  assert.equal(summary.pending, 0);
  assert.equal(summary.overdue, 0);
});
