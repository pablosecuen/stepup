import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyCollectedSeries, chartMonthsForRange, collectedCentsByMonth, monthsBetween, sumSeries, MIN_CHART_MONTHS } from "../monthly-collected.ts";
import { buildPeriodFinancialSummary } from "../financial-summary.ts";
import { resolveFinancialPeriodRange, type FinancialPeriodPreset } from "../period.ts";

/** «Evolución de cobros»: sólo dinero efectivamente cobrado, por mes civil de Argentina, cronológico y sin barras ficticias. */
const charge = (id: string, dueDate: string, originalAmount: number, voidedAt: string | null = null) => ({
  id,
  studentId: "s1",
  dueDate,
  originalAmount,
  voidedAt,
  chargeType: "monthly",
  billingPeriod: dueDate.slice(0, 7),
});
const payment = (id: string, paidAt: string, voidedAt: string | null = null) => ({ id, paidAt, voidedAt });
const allocation = (chargeId: string, paymentId: string, amount: number) => ({ chargeId, paymentId, amount });

test("monthsBetween: meses consecutivos en orden cronológico, cruzando de año", () => {
  assert.deepEqual(monthsBetween("2026-10", "2026-12"), ["2026-10", "2026-11", "2026-12"]);
  assert.deepEqual(monthsBetween("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(monthsBetween("2026-10", "2026-10"), ["2026-10"]);
  assert.deepEqual(monthsBetween("2026-10", "2026-09"), [], "un rango invertido no inventa meses");
});

test("agrupa por el día REAL de pago en la zona de Argentina: el límite de mes no se corre por UTC", () => {
  const charges = [charge("c1", "2026-09-10", 1000)];
  const payments = [
    payment("p-fin-de-septiembre", "2026-10-01T02:30:00Z"), // 30/09 23:30 en Argentina → septiembre
    payment("p-inicio-de-octubre", "2026-10-01T03:00:00Z"), // 01/10 00:00 en Argentina → octubre
    payment("p-clave-civil", "2026-10-31"), // una clave civil se respeta tal cual
    payment("p-ultimo-segundo", "2026-11-01T02:59:59Z"), // 31/10 23:59:59 → octubre
  ];
  const allocations = [allocation("c1", "p-fin-de-septiembre", 100), allocation("c1", "p-inicio-de-octubre", 200), allocation("c1", "p-clave-civil", 300), allocation("c1", "p-ultimo-segundo", 400)];
  const series = buildMonthlyCollectedSeries({ charges, allocations, payments }, ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(series, [
    { month: "2026-09", amount: 100 },
    { month: "2026-10", amount: 900 },
    { month: "2026-11", amount: 0 },
  ]);
});

test("límite de año: el 31/12 a las 23:59 y el 01/01 a las 00:00 de Argentina caen en años distintos", () => {
  const charges = [charge("c1", "2026-12-10", 1000)];
  const payments = [payment("a", "2027-01-01T02:59:00Z"), payment("b", "2027-01-01T03:00:00Z")];
  const allocations = [allocation("c1", "a", 10), allocation("c1", "b", 20)];
  assert.deepEqual(buildMonthlyCollectedSeries({ charges, allocations, payments }, ["2026-12", "2027-01"]), [
    { month: "2026-12", amount: 10 },
    { month: "2027-01", amount: 20 },
  ]);
});

test("nunca cuenta pagos anulados, cargos anulados, asignaciones huérfanas ni meses fuera de lo pedido", () => {
  const charges = [charge("c1", "2026-10-10", 1000), charge("c2", "2026-10-10", 1000, "2026-10-20T10:00:00Z")];
  const payments = [payment("ok", "2026-10-05T15:00:00Z"), payment("anulado", "2026-10-06T15:00:00Z", "2026-10-07T15:00:00Z"), payment("viejo", "2025-01-05T15:00:00Z")];
  const allocations = [
    allocation("c1", "ok", 500),
    allocation("c1", "anulado", 999), // pago anulado
    allocation("c2", "ok", 777), // cargo anulado
    allocation("fantasma", "ok", 555), // cargo inexistente
    allocation("c1", "no-existe", 444), // pago inexistente
    allocation("c1", "viejo", 333), // fuera de los meses pedidos
  ];
  const series = buildMonthlyCollectedSeries({ charges, allocations, payments }, ["2026-09", "2026-10"]);
  assert.deepEqual(series, [{ month: "2026-09", amount: 0 }, { month: "2026-10", amount: 500 }]);
});

test("centavos exactos: la suma de los meses es el total exacto, sin errores de flotante", () => {
  const charges = [charge("c1", "2026-10-10", 1000)];
  const payments = [payment("p1", "2026-10-05T15:00:00Z"), payment("p2", "2026-10-06T15:00:00Z"), payment("p3", "2026-11-06T15:00:00Z")];
  const allocations = [allocation("c1", "p1", 0.1), allocation("c1", "p2", 0.2), allocation("c1", "p3", 1234567.89)];
  const series = buildMonthlyCollectedSeries({ charges, allocations, payments }, ["2026-10", "2026-11"]);
  assert.equal(series[0].amount, 0.3, "0,1 + 0,2 = 0,30 exacto");
  assert.equal(series[1].amount, 1234567.89);
  assert.equal(sumSeries(series), 1234568.19);
  assert.equal(collectedCentsByMonth({ charges, allocations, payments }, ["2026-10"]).get("2026-10"), 30);
});

test("los meses del gráfico por período: cronológicos, sin meses futuros y con contexto para «Mes actual»", () => {
  const evaluationDate = "2026-10-14";
  const months = (preset: FinancialPeriodPreset) => chartMonthsForRange(resolveFinancialPeriodRange(preset, evaluationDate), evaluationDate, preset);
  assert.deepEqual(months("current_month"), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "un mes solo no hace un gráfico: seis meses de contexto");
  assert.equal(months("current_month").length, MIN_CHART_MONTHS);
  assert.deepEqual(months("last_3_months"), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(months("last_6_months"), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(months("current_year"), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "enero a octubre: no se dibujan noviembre ni diciembre");
  assert.deepEqual(months("previous_year"), monthsBetween("2025-01", "2025-12"));
  for (const preset of ["current_month", "last_3_months", "last_6_months", "current_year", "previous_year"] as const) {
    const list = months(preset);
    assert.deepEqual([...list].sort(), list, `${preset}: en orden cronológico`);
    assert.ok(list.every((m) => m <= evaluationDate.slice(0, 7)), `${preset}: ningún mes futuro`);
  }
});

test("períodos que cruzan el año: «Últimos 3/6 meses» en enero y febrero", () => {
  const months = (preset: FinancialPeriodPreset, evaluationDate: string) => chartMonthsForRange(resolveFinancialPeriodRange(preset, evaluationDate), evaluationDate, preset);
  assert.deepEqual(months("last_3_months", "2027-01-05"), ["2026-11", "2026-12", "2027-01"]);
  assert.deepEqual(months("last_6_months", "2027-02-28"), ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  assert.deepEqual(months("current_month", "2027-01-31"), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.equal(months("current_year", "2027-01-31").length, 1);
});

test("coincide con «Cobrado» del Resumen: la suma de los meses de cada período es exactamente su total cobrado (misma regla de caja)", () => {
  const charges = [charge("c1", "2026-08-10", 5000), charge("c2", "2026-09-10", 5000), charge("c3", "2026-10-10", 5000), charge("anulado", "2026-10-10", 9999, "2026-10-11T00:00:00Z")];
  const payments = [
    payment("p1", "2026-08-12T15:00:00Z"),
    payment("p2", "2026-09-30T23:00:00Z"),
    payment("p3", "2026-10-01T02:00:00Z"), // 30/09 en Argentina
    payment("p4", "2026-10-13T15:00:00Z"),
    payment("p5", "2026-10-14T15:00:00Z", "2026-10-14T16:00:00Z"), // anulado
  ];
  const allocations = [allocation("c1", "p1", 1500.5), allocation("c2", "p2", 2000), allocation("c2", "p3", 1000.25), allocation("c3", "p4", 4000), allocation("c3", "p5", 1000), allocation("anulado", "p4", 50)];
  const evaluationDate = "2026-10-14";
  for (const preset of ["last_3_months", "last_6_months", "current_year"] as const) {
    const range = resolveFinancialPeriodRange(preset, evaluationDate);
    const summary = buildPeriodFinancialSummary({ charges: charges as never, allocations, payments, range, evaluationDate });
    const series = buildMonthlyCollectedSeries({ charges, allocations, payments }, chartMonthsForRange(range, evaluationDate, preset));
    assert.ok(Math.abs(sumSeries(series) - summary.collected) < 0.005, `${preset}: ${sumSeries(series)} vs ${summary.collected}`);
  }
  // «Mes actual»: el último punto del gráfico es exactamente el cobrado del mes
  const range = resolveFinancialPeriodRange("current_month", evaluationDate);
  const summary = buildPeriodFinancialSummary({ charges: charges as never, allocations, payments, range, evaluationDate });
  const series = buildMonthlyCollectedSeries({ charges, allocations, payments }, chartMonthsForRange(range, evaluationDate, "current_month"));
  assert.equal(series[series.length - 1].amount, summary.collected);
  assert.equal(series[series.length - 1].amount, 4000);
});

test("sin datos no hay barras: un gráfico sin cobros suma cero y cada mes queda en $ 0 (la pantalla muestra un estado vacío)", () => {
  const series = buildMonthlyCollectedSeries({ charges: [], allocations: [], payments: [] }, ["2026-09", "2026-10"]);
  assert.deepEqual(series, [{ month: "2026-09", amount: 0 }, { month: "2026-10", amount: 0 }]);
  assert.equal(sumSeries(series), 0);
  assert.deepEqual(buildMonthlyCollectedSeries({ charges: [], allocations: [], payments: [] }, []), []);
  assert.deepEqual(chartMonthsForRange({ rangeStart: "2027-01-01", rangeEnd: "2027-12-31" }, "2026-10-14", "current_year"), [], "un período totalmente futuro no inventa meses");
});
