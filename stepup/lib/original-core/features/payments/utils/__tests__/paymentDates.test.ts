// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentDates.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { ARGENTINA_TIME_ZONE, firstDayOfBillingPeriod, isValidBillingPeriod, lastNBillingPeriods, localDateKeyInTimeZone } from '../paymentDates.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('isValidBillingPeriod acepta los límites 01 y 12', () => {
  assert(isValidBillingPeriod('2026-01'), 'enero (01) es un mes válido');
  assert(isValidBillingPeriod('2026-12'), 'diciembre (12) es un mes válido');
});

test('isValidBillingPeriod rechaza meses imposibles', () => {
  assert(!isValidBillingPeriod('2026-00'), 'mes 00 no existe');
  assert(!isValidBillingPeriod('2026-13'), 'mes 13 no existe');
  assert(!isValidBillingPeriod('2026-99'), 'mes 99 no existe');
});

test('isValidBillingPeriod rechaza formatos que no son YYYY-MM', () => {
  assert(!isValidBillingPeriod('2026-7'), 'mes sin cero a la izquierda se rechaza');
  assert(!isValidBillingPeriod('2026/07'), 'separador incorrecto');
  assert(!isValidBillingPeriod('26-07'), 'año incompleto');
  assert(!isValidBillingPeriod(''), 'string vacío');
});

test('firstDayOfBillingPeriod rechaza un período con mes imposible en vez de devolver una fecha inválida', () => {
  let rejected = false;
  try {
    firstDayOfBillingPeriod('2026-13');
  } catch {
    rejected = true;
  }
  assert(rejected, 'nunca debe devolver algo como "2026-13-01"');
});

test('firstDayOfBillingPeriod acepta los límites 01 y 12', () => {
  assertEqual(firstDayOfBillingPeriod('2026-01'), '2026-01-01', 'enero');
  assertEqual(firstDayOfBillingPeriod('2026-12'), '2026-12-01', 'diciembre');
});

test('localDateKeyInTimeZone usa el día de Buenos Aires (UTC-3), no el UTC', () => {
  // 02:59 UTC del 14/07 todavía es 23:59 del 13/07 en Buenos Aires.
  assertEqual(
    localDateKeyInTimeZone(new Date('2026-07-14T02:59:00.000Z'), ARGENTINA_TIME_ZONE),
    '2026-07-13',
    'un ratito antes de medianoche AR sigue siendo el día anterior'
  );
  // 03:00 UTC del 14/07 es exactamente 00:00 del 14/07 en Buenos Aires.
  assertEqual(
    localDateKeyInTimeZone(new Date('2026-07-14T03:00:00.000Z'), ARGENTINA_TIME_ZONE),
    '2026-07-14',
    'a partir de las 03:00 UTC ya es el día siguiente en Buenos Aires'
  );
});

test('localDateKeyInTimeZone rechaza un instante inválido', () => {
  let rejected = false;
  try {
    localDateKeyInTimeZone(new Date('no-es-una-fecha'), ARGENTINA_TIME_ZONE);
  } catch {
    rejected = true;
  }
  assert(rejected, 'un Date inválido debe rechazarse explícitamente');
});

test('lastNBillingPeriods devuelve exactamente 12 períodos terminando en el mes de evaluationDate', () => {
  const periods = lastNBillingPeriods('2026-07-15', 12);
  assertEqual(periods.length, 12, 'doce meses');
  assertEqual(periods[periods.length - 1], '2026-07', 'el último es el mes de evaluationDate');
  assertEqual(periods[0], '2025-08', 'el primero es 11 meses antes');
});

test('lastNBillingPeriods está en orden cronológico ascendente, sin huecos ni repetidos', () => {
  const periods = lastNBillingPeriods('2026-07-15', 12);
  for (let i = 1; i < periods.length; i++) {
    assert(periods[i - 1] < periods[i], `orden ascendente: ${periods[i - 1]} < ${periods[i]}`);
  }
  assertEqual(new Set(periods).size, periods.length, 'sin períodos repetidos');
});

test('lastNBillingPeriods cruza correctamente el límite de año', () => {
  const periods = lastNBillingPeriods('2026-02-10', 12);
  assertEqual(periods[0], '2025-03', 'arranca en marzo del año anterior');
  assertEqual(periods[periods.length - 1], '2026-02', 'termina en febrero del año actual');
  assert(periods.includes('2025-12'), 'incluye diciembre del año anterior');
  assert(periods.includes('2026-01'), 'incluye enero del año actual');
});

test('lastNBillingPeriods con n=1 devuelve sólo el mes actual', () => {
  assertEqual(lastNBillingPeriods('2026-07-15', 1).length, 1, 'un único período');
  assertEqual(lastNBillingPeriods('2026-07-15', 1)[0], '2026-07', 'el mes actual');
});

test('lastNBillingPeriods rechaza n no positivo o no entero', () => {
  let rejectedZero = false;
  try {
    lastNBillingPeriods('2026-07-15', 0);
  } catch {
    rejectedZero = true;
  }
  assert(rejectedZero, 'n=0 se rechaza');

  let rejectedFraction = false;
  try {
    lastNBillingPeriods('2026-07-15', 2.5);
  } catch {
    rejectedFraction = true;
  }
  assert(rejectedFraction, 'n fraccionario se rechaza');
});
