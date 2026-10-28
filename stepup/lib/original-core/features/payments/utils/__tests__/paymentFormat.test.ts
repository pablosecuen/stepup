// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentFormat.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { formatBillingPeriodChartLabel } from '../paymentFormat.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('formatBillingPeriodChartLabel: agosto de 2025 da "AGO" arriba y "25" abajo', () => {
  const label = formatBillingPeriodChartLabel('2025-08');
  assertEqual(label.top, 'AGO', 'mes abreviado en mayúsculas');
  assertEqual(label.bottom, '25', 'año de dos dígitos');
});

test('formatBillingPeriodChartLabel: enero y diciembre (límites del año)', () => {
  assertEqual(formatBillingPeriodChartLabel('2026-01').top, 'ENE', 'enero');
  assertEqual(formatBillingPeriodChartLabel('2026-12').top, 'DIC', 'diciembre');
});

test('formatBillingPeriodChartLabel: nunca corta un mes a la mitad — cada mitad es corta y fija', () => {
  for (let month = 1; month <= 12; month += 1) {
    const period = `2026-${String(month).padStart(2, '0')}`;
    const label = formatBillingPeriodChartLabel(period);
    assertEqual(label.top.length, 3, `mes ${period} siempre tiene 3 letras`);
    assertEqual(label.bottom.length, 2, `mes ${period} siempre tiene 2 dígitos de año`);
  }
});

test('formatBillingPeriodChartLabel: período mal formado nunca lanza, devuelve placeholder', () => {
  assertEqual(formatBillingPeriodChartLabel('').top, '—', 'vacío');
  assertEqual(formatBillingPeriodChartLabel('2026').top, '—', 'sin guion de mes');
  assertEqual(formatBillingPeriodChartLabel('2026-13').top, '—', 'mes 13 fuera de rango');
  assertEqual(formatBillingPeriodChartLabel('2026-00').top, '—', 'mes 00 fuera de rango');
});
