// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/firstMonthProrationJoinDate.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
 * automático al crear/incorporar a una serie a mitad de mes): pruebas de
 * `resolveEffectiveFirstMonthJoinDate` — ÚNICA regla central para "cuándo
 * empieza de verdad" un alumno mensual, reutilizada por la detección
 * automática, la reparación y el panel manual de revisión.
 */
import { resolveEffectiveFirstMonthJoinDate } from '../firstMonthProration.ts';
import { assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const series = (recurrenceId: string, startDate: string) => ({ recurrenceId, startDate });

test('sin ninguna serie activa: null, nunca inventa una fecha', () => {
  const result = resolveEffectiveFirstMonthJoinDate({ activeSeries: [] });
  assertEqual(result, null, 'sin series, no hay fecha efectiva que calcular');
});

test('una sola serie, sin fecha de mutación real (reparación): usa el inicio real de la serie', () => {
  const result = resolveEffectiveFirstMonthJoinDate({ activeSeries: [series('qa_a', '2026-08-18')] });
  assertEqual(result, '2026-08-18', 'la fecha de inicio de la serie es la fuente, nunca "hoy" en una reparación');
});

test('serie ya existente (inicio en el pasado) + incorporación real hoy: usa la fecha real de la incorporación, nunca el inicio viejo de la serie', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_a', '2026-06-01')], // la serie arrancó hace dos meses
    realMutationDateKey: '2026-08-18', // recién hoy se agrega el alumno
    realMutationRecurrenceId: 'qa_a',
  });
  assertEqual(result, '2026-08-18', 'sus clases anteriores a hoy no le corresponden');
});

test('serie nueva que arranca en el futuro cercano + creación hoy: usa el inicio de la serie, nunca hoy', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_a', '2026-08-24')], // la serie arranca dentro de unos días
    realMutationDateKey: '2026-08-18', // se crea/incorpora hoy
    realMutationRecurrenceId: 'qa_a',
  });
  assertEqual(result, '2026-08-24', 'su primera clase real es cuando arranca la serie, no el día que se la crea');
});

test('varias series activas: se usa la más temprana entre las fechas efectivas de cada una', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_a', '2026-08-20'), series('qa_b', '2026-08-05')],
  });
  assertEqual(result, '2026-08-05', 'la primera clase real (de cualquiera de sus series) es la más temprana');
});

test('la fecha de incorporación sólo ajusta la serie tocada; una serie previa conserva su inicio real', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_previa', '2026-08-05'), series('qa_tocada', '2026-06-01')],
    realMutationDateKey: '2026-08-18',
    realMutationRecurrenceId: 'qa_tocada',
  });
  assertEqual(result, '2026-08-05', 'nunca desplaza al presente una serie a la que el alumno ya pertenecía');
});

test('cruce diciembre -> enero: la comparación de fechas cruza el año sin romperse', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_a', '2026-12-28'), series('qa_b', '2027-01-05')],
  });
  assertEqual(result, '2026-12-28', 'diciembre es efectivamente anterior a enero del año siguiente');
});

test('cruce diciembre -> enero con incorporación real en enero: domina la incorporación real', () => {
  const result = resolveEffectiveFirstMonthJoinDate({
    activeSeries: [series('qa_a', '2026-12-28')], // serie de fin de año, ya en curso
    realMutationDateKey: '2027-01-05', // se incorpora recién en enero
    realMutationRecurrenceId: 'qa_a',
  });
  assertEqual(result, '2027-01-05', 'nunca antes de cuando realmente se incorporó, aunque la serie sea de diciembre');
});

test('nunca usa una fecha ajena a los datos reales provistos (no hay parámetro de "ahora" implícito)', () => {
  // Dos llamadas con exactamente los mismos datos dan exactamente el mismo
  // resultado, sin importar cuándo se ejecute la prueba — prueba pura,
  // determinística, sin leer Date.now() por su cuenta.
  const first = resolveEffectiveFirstMonthJoinDate({ activeSeries: [series('qa_a', '2026-08-18')] });
  const second = resolveEffectiveFirstMonthJoinDate({ activeSeries: [series('qa_a', '2026-08-18')] });
  assertEqual(first, second, 'misma entrada, mismo resultado siempre');
});
