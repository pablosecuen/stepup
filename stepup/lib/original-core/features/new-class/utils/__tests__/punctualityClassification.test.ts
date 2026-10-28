// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/punctualityClassification.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { classifyArrival, computeLateMinutes, computeMinutesBeforeEffectiveStart } from '../punctualityClassification.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const EFFECTIVE_START = '2026-07-20T17:00:00.000Z';

test('computeLateMinutes: llegada antes del horario efectivo da 0, nunca negativo', () => {
  assertEqual(computeLateMinutes('2026-07-20T16:50:00.000Z', EFFECTIVE_START), 0, 'llegó antes');
});

test('computeLateMinutes: llegada justo a horario da 0', () => {
  assertEqual(computeLateMinutes(EFFECTIVE_START, EFFECTIVE_START), 0, 'llegó exactamente a horario');
});

test('computeLateMinutes: minutos reales de diferencia cuando llega tarde', () => {
  assertEqual(computeLateMinutes('2026-07-20T17:12:00.000Z', EFFECTIVE_START), 12, 'demora real');
});

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "ELIMINAR TOLERANCIA DE
 * PUNTUALIDAD"): `classifyArrival` ya no recibe minutos de tolerancia — se
 * retiró la clasificación automática "dentro de la tolerancia", que
 * dependía de esa configuración ya eliminada. Ahora sólo distingue a
 * horario (0 minutos de demora) de tarde (más de 0 minutos), sin importar
 * cuántos.
 */
test('classifyArrival: a horario o antes siempre es on_time', () => {
  const result = classifyArrival('2026-07-20T16:55:00.000Z', EFFECTIVE_START);
  assertEqual(result.status, 'on_time', 'llegó antes');
  assertEqual(result.lateMinutes, 0, 'sin demora');
});

test('classifyArrival: justo a horario es on_time', () => {
  const result = classifyArrival(EFFECTIVE_START, EFFECTIVE_START);
  assertEqual(result.status, 'on_time', 'llegó exactamente a horario');
  assertEqual(result.lateMinutes, 0, 'sin demora');
});

test('classifyArrival: un minuto de demora ya es late (nunca hay una "zona gris" automática)', () => {
  const result = classifyArrival('2026-07-20T17:01:00.000Z', EFFECTIVE_START);
  assertEqual(result.status, 'late', '1 minuto de demora clasifica como tarde, sin tolerancia que lo perdone');
  assertEqual(result.lateMinutes, 1, 'demora real');
});

test('classifyArrival: cualquier demora mayor sigue siendo late, con los minutos reales', () => {
  const result = classifyArrival('2026-07-20T17:25:00.000Z', EFFECTIVE_START);
  assertEqual(result.status, 'late', '25 minutos de demora');
  assertEqual(result.lateMinutes, 25, 'demora real');
});

test('classifyArrival: siempre clasifica contra effectiveStartAt, nunca contra el horario original', () => {
  // effectiveStartAt ya representa el horario ajustado (17:00) — la
  // función ni siquiera recibe el horario original, así que no puede
  // usarlo por error.
  const result = classifyArrival('2026-07-20T17:03:00.000Z', EFFECTIVE_START);
  assertEqual(result.status, 'late', 'clasifica sólo contra el horario efectivo recibido');
  assertEqual(result.lateMinutes, 3, 'demora real contra el horario efectivo');
});

test('computeMinutesBeforeEffectiveStart: positivo cuando se comienza antes', () => {
  const minutes = computeMinutesBeforeEffectiveStart('2026-07-20T16:48:00.000Z', EFFECTIVE_START);
  assertEqual(minutes, 12, 'faltan 12 minutos para el horario efectivo');
});

test('computeMinutesBeforeEffectiveStart: negativo cuando ya pasó el horario efectivo', () => {
  const minutes = computeMinutesBeforeEffectiveStart('2026-07-20T17:05:00.000Z', EFFECTIVE_START);
  assertEqual(minutes, -5, 'ya pasaron 5 minutos del horario efectivo');
});
