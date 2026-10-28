// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarTimezone.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { addDaysToDateKey, daysBetweenDateKeys, getLocalDateKey, getLocalTimeKey, localDateTimeToInstantIso } from '../calendarTimezone.ts';
import { assertEqual, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

test('convierte un instante a fecha y hora de Buenos Aires', () => {
  const instant = '2026-07-14T02:30:00.000Z';
  assertEqual(getLocalDateKey(instant, BUENOS_AIRES), '2026-07-13', 'fecha local');
  assertEqual(getLocalTimeKey(instant, BUENOS_AIRES), '23:30', 'hora local');
});

test('convierte intención local a instante UTC', () => {
  assertEqual(
    localDateTimeToInstantIso({
      date: '2026-07-13',
      hour: 18,
      minute: 0,
      timeZone: BUENOS_AIRES,
    }),
    '2026-07-13T21:00:00.000Z',
    'conversión local a UTC'
  );
});

test('opera fechas locales sin depender de la zona del dispositivo', () => {
  assertEqual(addDaysToDateKey('2026-07-31', 1), '2026-08-01', 'cambio de mes');
  assertEqual(daysBetweenDateKeys('2026-07-13', '2026-08-01'), 19, 'diferencia');
});
