// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/dailyCollectionsNoticeStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { parsePersistedDailyCollectionsNoticeState } from '../dailyCollectionsNoticeStore.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

test('parsePersistedDailyCollectionsNoticeState: clave inexistente (null) devuelve null', () => {
  assertEqual(parsePersistedDailyCollectionsNoticeState(null), null, 'instalación nueva o nunca descartado');
});

test('parsePersistedDailyCollectionsNoticeState: JSON corrupto devuelve null, nunca lanza', () => {
  const result = parsePersistedDailyCollectionsNoticeState('{esto no es json válido');
  assertEqual(result, null, 'corrupción de bajo riesgo: se trata como "nunca descartado", no como error fatal');
});

test('parsePersistedDailyCollectionsNoticeState: un valor que no es un objeto devuelve null', () => {
  assertEqual(parsePersistedDailyCollectionsNoticeState('"un string cualquiera"'), null, 'no es un objeto');
  assertEqual(parsePersistedDailyCollectionsNoticeState('42'), null, 'un número no es un objeto');
  assertEqual(parsePersistedDailyCollectionsNoticeState('null'), null, 'null explícito tampoco es válido');
});

test('parsePersistedDailyCollectionsNoticeState: rechaza dismissedOnDate ausente o con formato inválido', () => {
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(JSON.stringify({ dismissedWorstUrgencyRank: 0 })),
    null,
    'sin dismissedOnDate'
  );
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '20-07-2026', dismissedWorstUrgencyRank: 0 })
    ),
    null,
    'formato de fecha inválido (no YYYY-MM-DD)'
  );
});

test('parsePersistedDailyCollectionsNoticeState: rechaza dismissedWorstUrgencyRank ausente, fuera de rango o no entero', () => {
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(JSON.stringify({ dismissedOnDate: '2026-07-20' })),
    null,
    'sin dismissedWorstUrgencyRank'
  );
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 99 })
    ),
    null,
    'fuera del rango válido de URGENCY_RANK'
  );
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 1.5 })
    ),
    null,
    'no es un entero'
  );
  assertEqual(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: '0' })
    ),
    null,
    'tipo incorrecto (string en vez de number)'
  );
});

test('parsePersistedDailyCollectionsNoticeState: acepta un estado válido tal cual', () => {
  const result = parsePersistedDailyCollectionsNoticeState(
    JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 2 })
  );
  assert(result !== null, 'se acepta');
  assertEqual(result!.dismissedOnDate, '2026-07-20', 'fecha correcta');
  assertEqual(result!.dismissedWorstUrgencyRank, 2, 'rango correcto');
});

test('parsePersistedDailyCollectionsNoticeState: acepta los límites del rango de urgencia (0 y 3)', () => {
  assert(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 0 })
    ) !== null,
    'el más severo (0) es válido'
  );
  assert(
    parsePersistedDailyCollectionsNoticeState(
      JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 3 })
    ) !== null,
    'el menos severo (3, "vence hoy") es válido'
  );
});

test('parsePersistedDailyCollectionsNoticeState: ignora campos extra sin fallar', () => {
  const result = parsePersistedDailyCollectionsNoticeState(
    JSON.stringify({ dismissedOnDate: '2026-07-20', dismissedWorstUrgencyRank: 1, campoDesconocido: 'x' })
  );
  assert(result !== null, 'campos extra no invalidan el estado');
  assertEqual(Object.keys(result!).length, 2, 'sólo se conservan los dos campos esperados');
});
