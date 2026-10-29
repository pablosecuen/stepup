import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyChartModel } from "../monthly-chart.ts";

test("la torta conserva los centavos y el total de la misma serie cobrada", () => {
  const model = monthlyChartModel([{ month: "2026-01", amount: 12500.50 }, { month: "2026-02", amount: 27500.25 }]);
  assert.equal(model.total, 40000.75);
  assert.deepEqual(model.segments.map(p => p.cents), [1250050, 2750025]);
  assert.ok(Math.abs(model.segments.reduce((n,p)=>n+p.percent,0)-100)<1e-9);
  assert.equal(model.segments[1].offset, 25-model.segments[0].percent);
  assert.equal(model.segments[1].isPeak,true);
});
test("marca los empates de máximo; un mes sin cobros no recibe un sector ficticio",()=>{
  const model=monthlyChartModel([{month:"2026-01",amount:0},{month:"2026-02",amount:10},{month:"2026-03",amount:10}]);
  assert.deepEqual(model.segments.map(p=>p.isPeak),[false,true,true]);
  assert.deepEqual(model.segments.map(p=>p.percent),[0,50,50]);
});
test("serie vacía o inválida no produce NaN ni porcentajes negativos",()=>{
  assert.equal(monthlyChartModel([]).total,0);
  const model=monthlyChartModel([{month:"2026-01",amount:NaN},{month:"2026-02",amount:-5}]);
  assert.equal(model.total,0);assert.ok(model.segments.every(p=>p.percent===0&&!p.isPeak));
});
