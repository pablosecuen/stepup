// Puerto VERBATIM del original (`src/features/reportes/utils/__tests__/reportPeriods.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildCurrentMonthPeriod, buildCustomPeriod, buildLast30DaysPeriod, buildPreviousMonthPeriod } from '../reportPeriods.ts';

test('buildCurrentMonthPeriod: cubre del día 1 al último día del mes de "hoy"', () => {
  const period = buildCurrentMonthPeriod(new Date(2026, 6, 15)); // 15 de julio de 2026
  assertEqual(period.startDate, '2026-07-01', 'empieza el día 1');
  assertEqual(period.endDate, '2026-07-31', 'julio tiene 31 días');
  assertEqual(period.label, 'Julio 2026', 'etiqueta legible en español');
});

test('buildCurrentMonthPeriod: respeta meses de 28/29/30 días', () => {
  const period = buildCurrentMonthPeriod(new Date(2026, 1, 10)); // febrero 2026 (no bisiesto)
  assertEqual(period.endDate, '2026-02-28', 'febrero 2026 tiene 28 días');
});

test('buildPreviousMonthPeriod: mes anterior dentro del mismo año', () => {
  const period = buildPreviousMonthPeriod(new Date(2026, 6, 15)); // julio -> junio
  assertEqual(period.startDate, '2026-06-01', 'empieza el 1 de junio');
  assertEqual(period.endDate, '2026-06-30', 'junio tiene 30 días');
  assertEqual(period.label, 'Junio 2026', 'etiqueta del mes anterior');
});

test('buildPreviousMonthPeriod: enero retrocede a diciembre del año anterior', () => {
  const period = buildPreviousMonthPeriod(new Date(2026, 0, 15));
  assertEqual(period.startDate, '2025-12-01', 'diciembre del año anterior');
  assertEqual(period.endDate, '2025-12-31', 'diciembre tiene 31 días');
  assertEqual(period.label, 'Diciembre 2025', 'etiqueta con el año anterior');
});

test('buildLast30DaysPeriod: termina hoy y empieza 29 días antes (30 días inclusive)', () => {
  const period = buildLast30DaysPeriod(new Date(2026, 6, 18));
  assertEqual(period.endDate, '2026-07-18', 'termina hoy');
  assertEqual(period.startDate, '2026-06-19', '29 días antes de hoy');
});

test('buildCustomPeriod: arma el rango y la etiqueta día/mes/año pedidos', () => {
  const period = buildCustomPeriod('2026-07-01', '2026-07-20');
  assertEqual(period.startDate, '2026-07-01', 'inicio tal cual se pidió');
  assertEqual(period.endDate, '2026-07-20', 'fin tal cual se pidió');
  assertEqual(period.label, '01/07/2026 - 20/07/2026', 'formato día/mes/año');
});

test('buildCustomPeriod: rechaza un inicio posterior al fin', () => {
  let threw = false;
  try {
    buildCustomPeriod('2026-07-20', '2026-07-01');
  } catch {
    threw = true;
  }
  assert(threw, 'debe rechazar un período con inicio posterior al fin');
});
