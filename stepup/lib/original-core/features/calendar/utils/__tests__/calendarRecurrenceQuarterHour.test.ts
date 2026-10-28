// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceQuarterHour.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PendingRecurrenceDraft, RecurrenceRule } from '../../types/index.ts';
import { generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { splitRecurrenceFromDate } from '../calendarRecurrenceSplit.ts';
import { assert, assertEqual, test } from './testHarness.ts';

// ---------------------------------------------------------------------------
// Corrección 2026-07-31 (a pedido de Joaquín — horarios de 15 minutos): el
// motor de recurrencias ya soportaba minutos arbitrarios sin redondeo — este
// archivo confirma explícitamente los escenarios 5, 6, 9, 10 y 14 del pedido
// con horarios de cuarto de hora, sin modificar el motor.
// ---------------------------------------------------------------------------

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'rule-quarter-hour',
    studentId: 's1',
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [{ weekday: 0, hour: 11, minute: 15, durationMinutes: 60 }],
      },
    ],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-08-03', // lunes
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

test('escenario 5: duración de 60 minutos desde 11:15 termina a las 12:15', () => {
  const [occurrence] = generateOccurrences(
    rule({ weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 11, minute: 15, durationMinutes: 60 }] }] }),
    new Date('2026-08-03T00:00:00.000Z'),
    new Date('2026-08-03T23:59:59.999Z')
  );
  assert(!!occurrence, 'genera la ocurrencia del lunes 3/8');
  assertEqual(occurrence.hour, 11, 'comienza a las 11');
  assertEqual(occurrence.minute, 15, 'con minuto exacto 15, nunca redondeado');
  // 2026-08-03 11:15 en Buenos Aires (UTC-3) = 14:15 UTC; +60min = 15:15 UTC = 12:15 local.
  assertEqual(occurrence.start, '2026-08-03T14:15:00.000Z', 'inicio exacto en UTC');
  assertEqual(occurrence.end, '2026-08-03T15:15:00.000Z', 'fin exacto: 12:15 local, 60 minutos después de 11:15');
});

test('escenario 6: duración de 75 minutos desde 11:45 termina a las 13:00', () => {
  const [occurrence] = generateOccurrences(
    rule({ weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 11, minute: 45, durationMinutes: 75 }] }] }),
    new Date('2026-08-03T00:00:00.000Z'),
    new Date('2026-08-03T23:59:59.999Z')
  );
  assert(!!occurrence, 'genera la ocurrencia');
  assertEqual(occurrence.hour, 11, 'comienza a las 11');
  assertEqual(occurrence.minute, 45, 'con minuto exacto 45');
  // 11:45 local = 14:45 UTC; +75min = 16:00 UTC = 13:00 local.
  assertEqual(occurrence.start, '2026-08-03T14:45:00.000Z', 'inicio exacto en UTC');
  assertEqual(occurrence.end, '2026-08-03T16:00:00.000Z', 'fin exacto: 13:00 local, 75 minutos después de 11:45');
});

test('escenario 9: una serie que arranca a las 11:15 repite exactamente esa hora en todas sus ocurrencias', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-08-03T00:00:00.000Z'),
    new Date('2026-08-24T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 4, 'cuatro lunes en el rango');
  assert(
    occurrences.every((occurrence) => occurrence.hour === 11 && occurrence.minute === 15),
    'todas las ocurrencias arrancan exactamente a las 11:15, ninguna se redondea a 11:00 ni 11:30'
  );
});

test('escenario 10: editar una serie de 11:00 a 11:15 no deja duplicadas las ocurrencias futuras de las 11:00', () => {
  const originalRule = rule({
    recurrenceId: 'serie-original',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 11, minute: 0, durationMinutes: 60 }] }],
    startDate: '2026-07-06', // lunes anterior
  });

  const draft: PendingRecurrenceDraft = {
    mode: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 11, minute: 15, durationMinutes: 60 }] }],
  };

  const result = splitRecurrenceFromDate({
    rule: originalRule,
    draft,
    exceptions: [],
    effectiveDate: '2026-08-03',
    todayDate: '2026-07-27',
    newRecurrenceId: 'serie-corregida',
    createdAt: '2026-07-27T12:00:00.000Z',
  });

  assertEqual(result.originalRule.endDate, '2026-08-02', 'la regla original queda cortada justo antes de la fecha efectiva');

  const originalOccurrencesAfterCut = generateOccurrences(
    result.originalRule,
    new Date('2026-08-03T00:00:00.000Z'),
    new Date('2026-08-24T23:59:59.999Z')
  );
  assertEqual(originalOccurrencesAfterCut.length, 0, 'la regla original (11:00) no genera nada después del corte — sin duplicados');

  const successorOccurrences = generateOccurrences(
    result.successorRule,
    new Date('2026-08-03T00:00:00.000Z'),
    new Date('2026-08-24T23:59:59.999Z')
  );
  assertEqual(successorOccurrences.length, 4, 'la serie sucesora genera sus cuatro ocurrencias');
  assert(
    successorOccurrences.every((occurrence) => occurrence.hour === 11 && occurrence.minute === 15),
    'todas las ocurrencias futuras quedan a las 11:15, ninguna a las 11:00'
  );
});

test('escenario 14: generateOccurrences no muta la regla recibida (motor de recurrencias intacto)', () => {
  const input = rule();
  const snapshot = JSON.stringify(input);
  generateOccurrences(input, new Date('2026-08-03T00:00:00.000Z'), new Date('2026-08-24T23:59:59.999Z'));
  assertEqual(JSON.stringify(input), snapshot, 'la regla de entrada queda exactamente igual tras generar ocurrencias');
});

test('escenario 14b: splitRecurrenceFromDate no muta la regla original ni el borrador recibidos', () => {
  const originalRule = rule({ recurrenceId: 'no-mutar', startDate: '2026-07-06' });
  const draft: PendingRecurrenceDraft = {
    mode: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 11, minute: 15, durationMinutes: 60 }] }],
  };
  const ruleSnapshot = JSON.stringify(originalRule);
  const draftSnapshot = JSON.stringify(draft);
  splitRecurrenceFromDate({
    rule: originalRule,
    draft,
    exceptions: [],
    effectiveDate: '2026-08-03',
    todayDate: '2026-07-27',
    newRecurrenceId: 'sucesora-no-mutar',
  });
  assertEqual(JSON.stringify(originalRule), ruleSnapshot, 'la regla original recibida no se mutó');
  assertEqual(JSON.stringify(draft), draftSnapshot, 'el borrador recibido no se mutó');
});
