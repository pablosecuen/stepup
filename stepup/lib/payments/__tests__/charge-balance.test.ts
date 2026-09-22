import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAssignableForCharge, calculateChargeBalance, calculatePaidAmountForCharge } from "../charge-balance.ts";
import type { PaymentAllocationLike, PaymentChargeLike } from "../types.ts";

const charge: PaymentChargeLike = { id: "c1", chargeType: "mensual", originalAmount: 80000, dueDate: "2026-09-10", voidedAt: null };

test("calculatePaidAmountForCharge: ignora asignaciones cuyo pago está anulado", () => {
  const allocations: PaymentAllocationLike[] = [
    { chargeId: "c1", amount: 40000, paymentVoidedAt: null },
    { chargeId: "c1", amount: 40000, paymentVoidedAt: "2026-09-15T00:00:00Z" },
    { chargeId: "c2", amount: 99999, paymentVoidedAt: null },
  ];
  assert.equal(calculatePaidAmountForCharge("c1", allocations), 40000);
});

test("calculateChargeBalance: pago parcial de $40.000 sobre deuda de $80.000 deja EXACTAMENTE $40.000 pendientes, sin recargo", () => {
  const balance = calculateChargeBalance(charge, 40000);
  assert.deepEqual(balance, { totalDue: 80000, paidAmount: 40000, balance: 40000, isFullyPaid: false });
});

test("calculateChargeBalance: pago completo deja saldo 0", () => {
  assert.equal(calculateChargeBalance(charge, 80000).balance, 0);
  assert.equal(calculateChargeBalance(charge, 80000).isFullyPaid, true);
});

test("calculateAssignableForCharge: 0 si el cargo está anulado", () => {
  assert.equal(calculateAssignableForCharge({ ...charge, voidedAt: "2026-09-20T00:00:00Z" }, 0), 0);
});

test("calculateAssignableForCharge: 0 si el cargo no existe", () => {
  assert.equal(calculateAssignableForCharge(undefined, 0), 0);
});

test("calculateAssignableForCharge: capacidad de UN cargo nunca se mezcla con otro del mismo alumno (caso real corregido en el móvil)", () => {
  // Cuota de entrenamiento $80.000 + mensualidad $27.500, pago de $40.000 aplicado sólo al entrenamiento.
  const training: PaymentChargeLike = { id: "training1", chargeType: "entrenamiento", originalAmount: 80000, dueDate: "2026-09-10", voidedAt: null };
  const paid = calculatePaidAmountForCharge("training1", [{ chargeId: "training1", amount: 40000, paymentVoidedAt: null }]);
  assert.equal(calculateAssignableForCharge(training, paid), 40000); // nunca 67500
});
