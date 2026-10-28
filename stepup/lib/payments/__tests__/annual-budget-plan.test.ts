// Pruebas de la app original (annualBudgetProjection.test.ts) ejecutadas contra el puerto web SIN cambiar sus casos ni sus expectativas.
import { DEFAULT_BUDGET_DISTRIBUTION } from "../budget-distribution.ts";
import { buildAnnualBudgetPlan, PROJECTION_WARNING_MESSAGES } from "../annual-budget-plan.ts";
import assertStrict from "node:assert/strict";
import { test } from "node:test";

// Mismas funciones auxiliares que el arnés de la app original (`testHarness`), sobre node:assert.
const assert = (condition: unknown, message?: string): void => assertStrict.ok(condition, message);
const assertEqual = <T,>(actual: T, expected: T, message?: string): void => assertStrict.deepEqual(actual, expected, message);

/**
 * Fase financiera — "Plan de distribución 50/30/20", gráfico de 12 meses:
 * pruebas del clasificador real/actual/proyectado y del ahorro teórico
 * acumulado. Reglas exactas de proyección documentadas en
 * `annualBudgetProjection.ts` — no se repiten acá.
 */

function monthEntry(plan: ReturnType<typeof buildAnnualBudgetPlan>, period: string) {
  const entry = plan.months.find((month) => month.billingPeriod === period);
  if (!entry) throw new Error(`No se encontró el mes ${period} en el plan`);
  return entry;
}

test('arma exactamente los 12 meses de enero a diciembre del año pedido, en orden', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-15',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: {},
  });
  assertEqual(plan.months.length, 12, 'doce meses');
  assertEqual(plan.months[0].billingPeriod, '2026-01', 'empieza en enero');
  assertEqual(plan.months[11].billingPeriod, '2026-12', 'termina en diciembre');
});

// ---------------------------------------------------------------------------
// Meses completos transcurridos: siempre reales, tal cual el cobro.
// ---------------------------------------------------------------------------

test('un mes pasado usa el cobro real tal cual, incluso si fue 0 (mes sin actividad, dato real válido)', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-15',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 0 }, // presente, dato real de "sin actividad"
  });
  const march = monthEntry(plan, '2026-03');
  assertEqual(march.status, 'real', 'mes pasado');
  assertEqual(march.realAmount, 0, 'sin actividad ese mes, pero es un dato real (no inventado)');
  assertEqual(march.totalForDistribution, 0, 'se distribuye sobre 0, nunca se inventa un número');
});

// ---------------------------------------------------------------------------
// 0 meses de historial: nunca se inventa una proyección.
// ---------------------------------------------------------------------------

test('sin ningún mes histórico con dato real: advertencia "no_history", el mes actual y los futuros muestran 0, nunca un número inventado', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-03-15',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    // enero y febrero deliberadamente AUSENTES del mapa (nunca hubo datos)
    monthlyCollectedByPeriod: {},
  });
  assertEqual(plan.projectionWarning, 'no_history', 'advertencia de historial inexistente');
  assertEqual(PROJECTION_WARNING_MESSAGES.no_history, 'Todavía no hay datos suficientes para proyectar.', 'mensaje exacto');

  const current = monthEntry(plan, '2026-03');
  assertEqual(current.estimateAvailable, false, 'el mes actual no tiene con qué proyectar');
  assertEqual(current.totalForDistribution, 0, 'nunca inventa un número');

  const future = monthEntry(plan, '2026-08');
  assertEqual(future.status, 'projected', 'mes futuro');
  assertEqual(future.estimateAvailable, false, 'tampoco puede proyectar');
  assertEqual(future.totalForDistribution, 0, 'nunca inventa un número');
});

// ---------------------------------------------------------------------------
// 1 o 2 meses de historial: se usan igual, con advertencia de historial
// limitado.
// ---------------------------------------------------------------------------

test('con un solo mes histórico presente: se usa igual (advertencia "limited_history")', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-04-10',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 90000 }, // único mes histórico presente
  });
  assertEqual(plan.projectionWarning, 'limited_history', 'advertencia de historial limitado');
  assertEqual(PROJECTION_WARNING_MESSAGES.limited_history, 'Proyección con historial limitado.', 'mensaje exacto');

  const future = monthEntry(plan, '2026-09');
  assertEqual(future.totalForDistribution, 90000, 'usa el único mes disponible como promedio');
  assertEqual(future.estimateAvailable, true, 'sí hay con qué proyectar, aunque sea poco');
});

test('con dos meses históricos presentes: promedia esos dos (advertencia "limited_history")', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-05-10',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 80000, '2026-04': 100000 },
  });
  assertEqual(plan.projectionWarning, 'limited_history', 'todavía no llega a los 3 meses pedidos');
  const future = monthEntry(plan, '2026-10');
  assertEqual(future.totalForDistribution, 90000, 'promedio de los dos meses disponibles ((80000+100000)/2)');
});

// ---------------------------------------------------------------------------
// 3 meses completos: promedio de los últimos 3, sin advertencia.
// ---------------------------------------------------------------------------

test('con tres meses históricos completos: promedia los últimos 3, sin advertencia', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 60000, '2026-04': 90000, '2026-05': 120000 },
  });
  assertEqual(plan.projectionWarning, null, 'con 3 meses completos no hace falta advertir nada');
  const future = monthEntry(plan, '2026-11');
  assertEqual(future.totalForDistribution, 90000, 'promedio de los últimos 3 meses ((60000+90000+120000)/3)');
});

test('con más de 3 meses históricos disponibles: sólo usa los últimos 3, nunca todo el historial', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: {
      '2026-01': 999999, // mes histórico lejano, no debe entrar en el promedio de "los últimos 3"
      '2026-03': 60000,
      '2026-04': 90000,
      '2026-05': 120000,
    },
  });
  const future = monthEntry(plan, '2026-11');
  assertEqual(future.totalForDistribution, 90000, 'ignora enero: sólo toma marzo/abril/mayo, los 3 más cercanos');
});

// ---------------------------------------------------------------------------
// Mes actual: nunca puede mostrar menos de lo ya cobrado.
// ---------------------------------------------------------------------------

test('el mes actual nunca muestra menos de lo ya cobrado, aunque supere la proyección', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: {
      '2026-03': 60000,
      '2026-04': 90000,
      '2026-05': 120000,
      '2026-06': 150000, // ya cobró más que el promedio proyectado (90000)
    },
  });
  const current = monthEntry(plan, '2026-06');
  assertEqual(current.status, 'current_month', 'mes actual');
  assertEqual(current.totalForDistribution, 150000, 'usa lo ya cobrado porque es mayor que la proyección');
});

test('el mes actual usa la proyección cuando todavía cobró menos que el promedio', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: {
      '2026-03': 60000,
      '2026-04': 90000,
      '2026-05': 120000,
      '2026-06': 10000, // recién empezó el mes
    },
  });
  const current = monthEntry(plan, '2026-06');
  assertEqual(current.totalForDistribution, 90000, 'usa la extensión estimada porque es mayor que lo ya cobrado');
});

// ---------------------------------------------------------------------------
// Estimación reemplazada automáticamente por dato real al avanzar el mes,
// sin alterar el historial ya mostrado.
// ---------------------------------------------------------------------------

test('al avanzar el mes evaluado, un mes que era proyectado pasa a real con su propio dato, y el historial anterior no cambia', () => {
  const historicalData = { '2026-03': 60000, '2026-04': 90000, '2026-05': 120000 };

  const planBefore = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { ...historicalData, '2026-06': 50000 },
  });
  const julyBefore = monthEntry(planBefore, '2026-07');
  assertEqual(julyBefore.status, 'projected', 'julio todavía es una proyección en junio');
  assertEqual(julyBefore.totalForDistribution, 90000, 'proyección basada en el promedio histórico');

  // Un mes después: julio ya cerró con dato real, junio pasó a ser histórico.
  const planAfter = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-07-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { ...historicalData, '2026-06': 50000, '2026-07': 200000 },
  });
  const julyAfter = monthEntry(planAfter, '2026-07');
  assertEqual(julyAfter.status, 'current_month', 'julio ahora es el mes actual');
  assertEqual(julyAfter.totalForDistribution, 200000, 'reemplaza la estimación por el dato real de julio (mayor que la proyección)');

  const marchAfter = monthEntry(planAfter, '2026-03');
  assertEqual(marchAfter.totalForDistribution, 60000, 'el historial ya real (marzo) no se alteró al avanzar el mes');
});

// ---------------------------------------------------------------------------
// Ahorro teórico acumulado: real y proyectado nunca se mezclan.
// ---------------------------------------------------------------------------

test('el ahorro teórico acumulado real y el proyectado se calculan por separado y difieren cuando hay proyección', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION, // 20% ahorro
    monthlyCollectedByPeriod: {
      '2026-01': 100000,
      '2026-02': 100000,
      '2026-03': 100000,
      '2026-04': 100000,
      '2026-05': 100000,
      '2026-06': 100000,
    },
  });
  // Real: enero..junio, 6 meses * 100000 * 20% = 120000. Julio..diciembre son proyectados: 0 aporte real.
  assertEqual(plan.cumulativeRealTheoreticalSavings, 120000, 'sólo suma el ahorro de los meses reales/actual, con el importe REAL');
  // Proyectado: 6 meses reales (100000 c/u) + 6 meses proyectados (promedio de los últimos 3 = 100000 c/u) = 12*100000*20%
  assertEqual(plan.cumulativeProjectedTheoreticalSavings, 240000, 'suma los 12 meses, mezclando real + proyección');
  assert(
    plan.cumulativeRealTheoreticalSavings !== plan.cumulativeProjectedTheoreticalSavings,
    'nunca deben mostrarse como una única cifra ambigua cuando hay proyección de por medio'
  );
});

test('sin ningún mes proyectado necesario (año completamente pasado): el ahorro real y el proyectado coinciden', () => {
  const plan = buildAnnualBudgetPlan({
    year: '2025',
    evaluationDate: '2026-06-05', // el año 2025 completo ya pasó
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: {
      '2025-01': 50000,
      '2025-02': 50000,
    },
  });
  assertEqual(plan.projectionWarning, null, 'un año enteramente pasado nunca necesita proyectar nada');
  assertEqual(
    plan.cumulativeRealTheoreticalSavings,
    plan.cumulativeProjectedTheoreticalSavings,
    'sin meses proyectados, ambas cifras coinciden exactamente'
  );
});

// ---------------------------------------------------------------------------
// Multi-usuario / no mezcla de datos: dos planes calculados con estados
// independientes nunca se contaminan entre sí (función pura, sin estado
// compartido).
// ---------------------------------------------------------------------------

test('dos llamadas con estados de distintos "usuarios" (mapas independientes) nunca se mezclan entre sí', () => {
  const planA = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 10000, '2026-04': 10000, '2026-05': 10000 },
  });
  const planB = buildAnnualBudgetPlan({
    year: '2026',
    evaluationDate: '2026-06-05',
    distribution: DEFAULT_BUDGET_DISTRIBUTION,
    monthlyCollectedByPeriod: { '2026-03': 999000, '2026-04': 999000, '2026-05': 999000 },
  });
  assertEqual(monthEntry(planA, '2026-11').totalForDistribution, 10000, 'plan A conserva sus propios datos');
  assertEqual(monthEntry(planB, '2026-11').totalForDistribution, 999000, 'plan B conserva los suyos, sin contaminarse con A');
});
