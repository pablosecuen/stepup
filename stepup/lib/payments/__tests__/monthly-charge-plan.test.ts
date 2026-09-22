import { test } from "node:test";
import assert from "node:assert/strict";
import { isStudentBillableForPeriod } from "../monthly-charge-plan.ts";

test("isStudentBillableForPeriod: activo siempre factura", () => {
  assert.equal(isStudentBillableForPeriod({ status: "activo", statusChangeDate: null, billingPeriod: "2026-09" }), true);
});

test("isStudentBillableForPeriod: inactivo sin fecha nunca factura", () => {
  assert.equal(isStudentBillableForPeriod({ status: "inactivo", statusChangeDate: null, billingPeriod: "2026-09" }), false);
});

test("isStudentBillableForPeriod: inactivo con fecha factura hasta el período de la baja inclusive, nunca uno posterior", () => {
  assert.equal(isStudentBillableForPeriod({ status: "inactivo", statusChangeDate: "2026-09-15", billingPeriod: "2026-09" }), true);
  assert.equal(isStudentBillableForPeriod({ status: "inactivo", statusChangeDate: "2026-09-15", billingPeriod: "2026-10" }), false);
  assert.equal(isStudentBillableForPeriod({ status: "inactivo", statusChangeDate: "2026-09-15", billingPeriod: "2026-08" }), true);
});
