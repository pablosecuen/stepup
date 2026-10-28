// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/monthlyAmountCorrectionLogStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { parsePersistedMonthlyAmountCorrectionLog } from '../monthlyAmountCorrectionLogStore.ts';
import type { MonthlyAmountCorrectionEntry } from '../../types/index.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const validEntry: MonthlyAmountCorrectionEntry = {
  id: 'monthly_amount_correction_rocio_1',
  studentId: 'rocio',
  billingPeriod: '2026-07',
  previousAmount: 1008000,
  newAmount: 100800,
  changedAt: '2026-07-30T12:00:00.000Z',
  reason: 'Corrección de monto mensual',
};

test('parsePersistedMonthlyAmountCorrectionLog: clave inexistente (null) devuelve lista vacía', () => {
  assertEqual(
    parsePersistedMonthlyAmountCorrectionLog(null).length,
    0,
    'instalación nueva o nunca corregido nada todavía'
  );
});

test('parsePersistedMonthlyAmountCorrectionLog: JSON corrupto devuelve lista vacía, nunca lanza', () => {
  assertEqual(
    parsePersistedMonthlyAmountCorrectionLog('{esto no es JSON válido').length,
    0,
    'registro de auditoría best-effort: nunca bloquea nada por un JSON dañado'
  );
});

test('parsePersistedMonthlyAmountCorrectionLog: un valor que no es una lista devuelve lista vacía', () => {
  assertEqual(parsePersistedMonthlyAmountCorrectionLog('"un string"').length, 0, 'no es un array');
  assertEqual(parsePersistedMonthlyAmountCorrectionLog('42').length, 0, 'un número no es un array');
  assertEqual(parsePersistedMonthlyAmountCorrectionLog(JSON.stringify({ id: 'x' })).length, 0, 'un objeto no es un array');
});

test('parsePersistedMonthlyAmountCorrectionLog acepta una entrada válida tal cual', () => {
  const result = parsePersistedMonthlyAmountCorrectionLog(JSON.stringify([validEntry]));
  assertEqual(result.length, 1, 'conserva la entrada válida');
  assertEqual(result[0].previousAmount, 1008000, 'importe anterior correcto');
  assertEqual(result[0].newAmount, 100800, 'importe nuevo correcto');
  assertEqual(result[0].billingPeriod, '2026-07', 'mes afectado correcto');
  assertEqual(result[0].reason, 'Corrección de monto mensual', 'motivo por defecto correcto');
});

test('parsePersistedMonthlyAmountCorrectionLog descarta entradas individuales corruptas sin invalidar el resto', () => {
  const corrupted = { id: 'sin-los-demas-campos' };
  const result = parsePersistedMonthlyAmountCorrectionLog(JSON.stringify([validEntry, corrupted]));
  assertEqual(result.length, 1, 'sólo sobrevive la entrada válida');
  assertEqual(result[0].id, validEntry.id, 'es la entrada correcta la que sobrevive');
});

test('parsePersistedMonthlyAmountCorrectionLog rechaza un billingPeriod con formato inválido', () => {
  const invalid = { ...validEntry, billingPeriod: '07-2026' };
  assertEqual(
    parsePersistedMonthlyAmountCorrectionLog(JSON.stringify([invalid])).length,
    0,
    'formato de período incorrecto'
  );
});

test('parsePersistedMonthlyAmountCorrectionLog rechaza previousAmount/newAmount no numéricos', () => {
  const invalid = { ...validEntry, newAmount: 'cien mil' };
  assertEqual(
    parsePersistedMonthlyAmountCorrectionLog(JSON.stringify([invalid])).length,
    0,
    'newAmount debe ser number'
  );
});

test('parsePersistedMonthlyAmountCorrectionLog conserva el orden y permite varias correcciones del mismo alumno', () => {
  const second: MonthlyAmountCorrectionEntry = {
    ...validEntry,
    id: 'monthly_amount_correction_rocio_2',
    previousAmount: 100800,
    newAmount: 105000,
    changedAt: '2026-07-31T09:00:00.000Z',
  };
  const result = parsePersistedMonthlyAmountCorrectionLog(JSON.stringify([validEntry, second]));
  assertEqual(result.length, 2, 'nunca reemplaza el historial — se acumula');
  assert(result[0].id === validEntry.id && result[1].id === second.id, 'conserva el orden cronológico de carga');
});
