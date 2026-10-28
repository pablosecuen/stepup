// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarDayIso.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from './testHarness.ts';
import { localMidnightIso, shiftDayIso } from '../calendarDayIso.ts';

test('localMidnightIso: conserva el día calendario pero pone la hora en 00:00:00.000 local', () => {
  const source = new Date(2026, 6, 23, 15, 42, 10, 500);
  const result = new Date(localMidnightIso(source));
  assertEqual(result.getFullYear(), 2026, 'año intacto');
  assertEqual(result.getMonth(), 6, 'mes intacto (julio, 0-indexado)');
  assertEqual(result.getDate(), 23, 'día intacto');
  assertEqual(result.getHours(), 0, 'hora en 0');
  assertEqual(result.getMinutes(), 0, 'minutos en 0');
  assertEqual(result.getSeconds(), 0, 'segundos en 0');
  assertEqual(result.getMilliseconds(), 0, 'milisegundos en 0');
});

test('shiftDayIso: +1 avanza exactamente un día calendario, sin romper la medianoche local', () => {
  const today = localMidnightIso(new Date(2026, 6, 23));
  const tomorrow = shiftDayIso(today, 1);
  const parsed = new Date(tomorrow);
  assertEqual(parsed.getDate(), 24, 'avanza un día');
  assertEqual(parsed.getHours(), 0, 'sigue anclado a medianoche local');
});

test('shiftDayIso: -1 retrocede exactamente un día calendario', () => {
  const today = localMidnightIso(new Date(2026, 6, 23));
  const yesterday = shiftDayIso(today, -1);
  const parsed = new Date(yesterday);
  assertEqual(parsed.getDate(), 22, 'retrocede un día');
});

test('shiftDayIso: cruza el límite de mes correctamente (31 -> 1)', () => {
  const lastDayOfMonth = localMidnightIso(new Date(2026, 6, 31));
  const nextMonth = shiftDayIso(lastDayOfMonth, 1);
  const parsed = new Date(nextMonth);
  assertEqual(parsed.getMonth(), 7, 'pasa a agosto');
  assertEqual(parsed.getDate(), 1, 'primer día de agosto');
});

test('shiftDayIso: nunca revienta con una entrada inválida, cae a "hoy" a medianoche local', () => {
  const result = shiftDayIso('esto-no-es-una-fecha', 1);
  const parsed = new Date(result);
  assert(!Number.isNaN(parsed.getTime()), 'siempre devuelve una fecha válida');
  assertEqual(parsed.getHours(), 0, 'cae a medianoche local, no a la hora actual');
});

test('shiftDayIso: ida y vuelta (+1 luego -1) vuelve al mismo día exacto', () => {
  const start = localMidnightIso(new Date(2026, 6, 23));
  const roundTrip = shiftDayIso(shiftDayIso(start, 1), -1);
  assertEqual(roundTrip, start, 'no acumula desvío por redondeo de zona horaria');
});
