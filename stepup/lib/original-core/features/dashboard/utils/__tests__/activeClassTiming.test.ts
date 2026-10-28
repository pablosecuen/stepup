// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/activeClassTiming.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { buildClassSessionNotificationBody, computeElapsedMinutesRounded, computeElapsedSeconds, computeOvertimeSeconds, computeProgressFraction, formatCountdown } from '../activeClassTiming.ts';

function isoMinutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

test('computeElapsedSeconds: nunca es negativo, aunque el reloj del dispositivo esté raro (startedAt en el futuro)', () => {
  const futureStart = new Date(Date.now() + 60_000).toISOString();
  assertEqual(computeElapsedSeconds(futureStart, new Date()), 0, 'un inicio en el futuro no debe dar segundos negativos');
});

test('computeOvertimeSeconds: negativo mientras falta tiempo, cero justo al terminar, positivo en tiempo extra', () => {
  const startedAt = isoMinutesAgo(10);
  assert(computeOvertimeSeconds(startedAt, 20, new Date()) < 0, 'a los 10 min de una clase de 20, todavía faltan minutos');
  assert(computeOvertimeSeconds(startedAt, 10, new Date()) >= -2, 'a los 10 min de una clase de 10, está terminando (tolerancia de 2s por el tiempo real de ejecución)');
  assert(computeOvertimeSeconds(startedAt, 5, new Date()) > 0, 'a los 10 min de una clase de 5, ya está en tiempo extra');
});

test('computeProgressFraction: 0 a 1, nunca supera 1 aunque esté en tiempo extra', () => {
  assertEqual(computeProgressFraction(isoMinutesAgo(0), 30, new Date()), 0, 'recién empezada, progreso 0');
  const halfway = computeProgressFraction(isoMinutesAgo(15), 30, new Date());
  assert(halfway > 0.45 && halfway < 0.55, 'a la mitad del tiempo asignado, progreso cercano a 0.5');
  assertEqual(computeProgressFraction(isoMinutesAgo(45), 30, new Date()), 1, 'en tiempo extra, el progreso se queda en 1, nunca lo supera');
});

test('formatCountdown: mm:ss para tiempo restante, "+mm:ss" para tiempo extra', () => {
  assertEqual(formatCountdown(-125), '02:05', '125 segundos restantes se formatean como 02:05');
  assertEqual(formatCountdown(0), '00:00', 'exactamente en cero, sin signo');
  assertEqual(formatCountdown(65), '+01:05', '65 segundos de tiempo extra se formatean como +01:05');
});

test('computeElapsedMinutesRounded: redondea al minuto más cercano, nunca da 0 (mínimo 1 minuto real)', () => {
  assertEqual(computeElapsedMinutesRounded(isoMinutesAgo(45), new Date()), 45, '45 minutos transcurridos redondean a 45');
  assertEqual(computeElapsedMinutesRounded(isoMinutesAgo(0), new Date()), 1, 'una clase recién arrancada nunca prefillea 0 minutos de duración real');
});

test('buildClassSessionNotificationBody: texto de tiempo restante o tiempo extra, mismo umbral que la tarjeta de Inicio', () => {
  const restante = buildClassSessionNotificationBody(isoMinutesAgo(10), 30, new Date());
  assert(restante.startsWith('Quedan '), 'con tiempo restante debe empezar con "Quedan"');
  assert(restante.includes('de 30 min'), 'debe mencionar el total de minutos asignados');

  const extra = buildClassSessionNotificationBody(isoMinutesAgo(40), 30, new Date());
  assert(extra.startsWith('Tiempo extra: +'), 'en tiempo extra debe empezar con "Tiempo extra: +"');
});
