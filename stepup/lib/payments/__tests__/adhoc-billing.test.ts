import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLateCancellationBillingFactor, computePerClassBilledAmount } from "../adhoc-billing.ts";

test("computeLateCancellationBillingFactor: 'clase_dictada' siempre factor 1", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "clase_dictada", isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null }),
    1,
  );
});

test("computeLateCancellationBillingFactor: 'profesora_ausente'/'feriado' sin excepción/'cancelada_con_aviso'/'reprogramada' -> factor 0", () => {
  for (const outcome of ["profesora_ausente", "feriado", "cancelada_con_aviso", "reprogramada"] as const) {
    assert.equal(
      computeLateCancellationBillingFactor({ outcome, isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }),
      0,
    );
  }
});

test("computeLateCancellationBillingFactor: 'feriado' con excepción se dictó -> factor 1", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "feriado", isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null }),
    1,
  );
});

test("computeLateCancellationBillingFactor: 'cancelada_tarde' + 'cobrar_100' cobra el 100% AUNQUE no se haya dictado", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_100", lateCancellationPercentage: null }),
    1,
  );
});

test("computeLateCancellationBillingFactor: 'cancelada_tarde' + 'cobrar_porcentaje'", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 50 }),
    0.5,
  );
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: null }),
    0,
  );
});

test("computeLateCancellationBillingFactor: 'cancelada_tarde' + 'descontar_del_paquete'/'no_cobrar' -> factor 0", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "descontar_del_paquete", lateCancellationPercentage: null }),
    0,
  );
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "no_cobrar", lateCancellationPercentage: null }),
    0,
  );
});

test("computeLateCancellationBillingFactor: 'cancelada_tarde' SIN política todavía elegida -> cae al caso general (0, nunca se dictó)", () => {
  assert.equal(
    computeLateCancellationBillingFactor({ outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }),
    0,
  );
});

test("computePerClassBilledAmount: redondea el importe final", () => {
  assert.equal(
    computePerClassBilledAmount({ perClassAmount: 7000, outcome: "cancelada_tarde", isClassHeld: false, lateCancellationPolicy: "cobrar_porcentaje", lateCancellationPercentage: 33 }),
    2310, // 7000 * 0.33 = 2310
  );
  assert.equal(
    computePerClassBilledAmount({ perClassAmount: 7000, outcome: "clase_dictada", isClassHeld: true, lateCancellationPolicy: null, lateCancellationPercentage: null }),
    7000,
  );
  assert.equal(
    computePerClassBilledAmount({ perClassAmount: 7000, outcome: "reprogramada", isClassHeld: false, lateCancellationPolicy: null, lateCancellationPercentage: null }),
    0,
  );
});
