// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceTemplateEditing.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-26 (a pedido de Joaquín — simplificar serie
 * personalizada): pruebas de la sección "SERIE PERSONALIZADA" (1-10) del
 * pedido. Cubre tanto el motor real de recurrencias (`generateOccurrences`)
 * como la lógica pura de edición de plantilla/personalización extraída de
 * `RecurrenceOptions.tsx` (`calendarRecurrenceTemplateEditing.ts`).
 */
import type { RecurrenceRule } from '../../types/index.ts';
import { generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { validateRecurrenceDraft } from '../calendarRecurrenceDraftValidation.ts';
import { resetWeeksFromModel, resizeWeeksToCycle, sessionsEqual, toggleCustomizeWeeksOnDraft, weeksDifferFromModel } from '../calendarRecurrenceTemplateEditing.ts';
import type { AppWeekday, PendingRecurrenceDraft, RecurrenceWeek } from '../../types/index.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'rule-template',
    studentId: 'student-1',
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 1, hour: 18, minute: 0, durationMinutes: 60 },
          { weekday: 2, hour: 18, minute: 0, durationMinutes: 60 },
        ],
      },
    ],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-13',
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Plantilla martes y miércoles aplicada todas las semanas.
// ---------------------------------------------------------------------------

test('1. Plantilla con martes y miércoles se repite en todas las semanas futuras (mode weekly, cycleLengthWeeks 1)', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-08-24T23:59:59.999Z')
  );
  const weekdaysByWeek = new Map<number, Set<number>>();
  occurrences.forEach((occurrence) => {
    const set = weekdaysByWeek.get(occurrence.absoluteWeekNumber) ?? new Set<number>();
    set.add(occurrence.weekday);
    weekdaysByWeek.set(occurrence.absoluteWeekNumber, set);
  });
  assert(weekdaysByWeek.size >= 6, 'genera varias semanas dentro del rango de 6 semanas');
  weekdaysByWeek.forEach((weekdays, weekNumber) => {
    assert(weekdays.has(1), `semana ${weekNumber} incluye el martes`);
    assert(weekdays.has(2), `semana ${weekNumber} incluye el miércoles`);
  });
});

// ---------------------------------------------------------------------------
// 2. Mes con cinco semanas.
// ---------------------------------------------------------------------------

test('2. Un mes con cinco lunes (agosto 2026) mantiene el patrón semanal sin huecos ni duplicados', () => {
  // Agosto 2026 tiene 5 lunes: 3, 10, 17, 24 y 31.
  const occurrences = generateOccurrences(
    rule({
      startDate: '2026-07-27',
      weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    }),
    new Date('2026-08-01T00:00:00.000Z'),
    new Date('2026-08-31T23:59:59.999Z')
  );
  const mondayOccurrences = occurrences.filter((occurrence) => occurrence.weekday === 0);
  const mondayDates = mondayOccurrences.map((occurrence) => occurrence.start.slice(0, 10));
  assertEqual(new Set(mondayDates).size, mondayDates.length, 'ninguna fecha de lunes se repite');
  assertEqual(mondayOccurrences.length, 5, 'agosto 2026 produce exactamente 5 ocurrencias de lunes');
});

// ---------------------------------------------------------------------------
// 3. Cambio de mes y de año.
// ---------------------------------------------------------------------------

test('3. La plantilla semanal sigue produciendo clases correctamente al cruzar diciembre→enero y de año', () => {
  const occurrences = generateOccurrences(
    rule({ startDate: '2026-12-28' }),
    new Date('2026-12-28T00:00:00.000Z'),
    new Date('2027-01-15T23:59:59.999Z')
  );
  assert(occurrences.length > 0, 'genera ocurrencias cruzando el cambio de año');
  const hasDecember = occurrences.some((occurrence) => occurrence.start.startsWith('2026-12'));
  const hasJanuary = occurrences.some((occurrence) => occurrence.start.startsWith('2027-01'));
  assert(hasDecember, 'incluye ocurrencias de diciembre 2026');
  assert(hasJanuary, 'incluye ocurrencias de enero 2027, sin cortarse en el cambio de año');
});

// ---------------------------------------------------------------------------
// 4-6. Ciclo personalizado de 2, 3 y 4 semanas.
// ---------------------------------------------------------------------------

function customRuleWithCycle(cycleLengthWeeks: 2 | 3 | 4): RecurrenceRule {
  const weeks: RecurrenceWeek[] = Array.from({ length: cycleLengthWeeks }, (_, weekIndex) => ({
    weekIndex,
    sessions: [{ weekday: (weekIndex % 7) as AppWeekday, hour: 10 + weekIndex, minute: 0, durationMinutes: 60 }],
  }));
  return rule({ type: 'custom', cycleLengthWeeks, weeks });
}

([2, 3, 4] as const).forEach((cycleLengthWeeks) => {
  test(`${cycleLengthWeeks === 2 ? 4 : cycleLengthWeeks === 3 ? 5 : 6}. Ciclo personalizado de ${cycleLengthWeeks} semanas produce el patrón correcto en cada vuelta del ciclo`, () => {
    const testRule = customRuleWithCycle(cycleLengthWeeks);
    const occurrences = generateOccurrences(
      testRule,
      new Date('2026-07-13T00:00:00.000Z'),
      new Date(new Date('2026-07-13T00:00:00.000Z').getTime() + cycleLengthWeeks * 3 * 7 * 86_400_000)
    );
    for (let weekIndexInCycle = 0; weekIndexInCycle < cycleLengthWeeks; weekIndexInCycle += 1) {
      const matches = occurrences.filter((occurrence) => occurrence.weekIndexInCycle === weekIndexInCycle);
      assert(matches.length >= 2, `la semana ${weekIndexInCycle} del ciclo de ${cycleLengthWeeks} se repite al menos 2 veces`);
      matches.forEach((occurrence) => {
        assertEqual(occurrence.weekday, weekIndexInCycle % 7, `ocurrencia de la semana ${weekIndexInCycle} usa el día configurado`);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Activar personalización y modificar solamente Semana 2.
// ---------------------------------------------------------------------------

test('7. Activar "Personalizar semanas" copia la plantilla a todo el ciclo; modificar sólo la Semana 2 no toca las demás', () => {
  const draft: PendingRecurrenceDraft = {
    mode: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }],
  };

  const customized = toggleCustomizeWeeksOnDraft(draft, true, 3);
  assertEqual(customized.mode, 'custom', 'activar personalizar cambia a modo custom');
  assertEqual(customized.cycleLengthWeeks, 3, 'usa el ciclo por defecto pedido (3 semanas)');
  assertEqual(customized.weeks.length, 3, 'genera 3 semanas');
  customized.weeks.forEach((week) => {
    assert(
      sessionsEqual(week.sessions, draft.weeks[0].sessions),
      'todas las semanas arrancan copiando la plantilla habitual'
    );
  });

  const onlyWeek2Modified: PendingRecurrenceDraft = {
    ...customized,
    weeks: customized.weeks.map((week) =>
      week.weekIndex === 1
        ? { ...week, sessions: [{ weekday: 3, hour: 9, minute: 30, durationMinutes: 45 }] }
        : week
    ),
  };

  assert(
    sessionsEqual(onlyWeek2Modified.weeks[0].sessions, draft.weeks[0].sessions),
    'la Semana 1 sigue igual a la plantilla'
  );
  assert(
    !sessionsEqual(onlyWeek2Modified.weeks[1].sessions, draft.weeks[0].sessions),
    'la Semana 2 quedó modificada'
  );
  assert(
    sessionsEqual(onlyWeek2Modified.weeks[2].sessions, draft.weeks[0].sessions),
    'la Semana 3 sigue igual a la plantilla, sin tocarse'
  );
  assert(weeksDifferFromModel(onlyWeek2Modified.weeks), 'weeksDifferFromModel detecta la diferencia real');
});

// ---------------------------------------------------------------------------
// 8. Restablecer desde la plantilla.
// ---------------------------------------------------------------------------

test('8. "Restablecer todas desde la semana modelo" vuelve a copiar la Semana 1 a todo el ciclo', () => {
  const weeks: RecurrenceWeek[] = [
    { weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] },
    { weekIndex: 1, sessions: [{ weekday: 3, hour: 9, minute: 0, durationMinutes: 45 }] },
    { weekIndex: 2, sessions: [{ weekday: 5, hour: 20, minute: 0, durationMinutes: 90 }] },
  ];
  assert(weeksDifferFromModel(weeks), 'antes de restablecer, las semanas difieren');

  const reset = resetWeeksFromModel(weeks);
  assertEqual(reset.length, 3, 'conserva la cantidad de semanas');
  reset.forEach((week) => {
    assert(sessionsEqual(week.sessions, weeks[0].sessions), 'cada semana quedó igual a la semana modelo');
  });
  assert(!weeksDifferFromModel(reset), 'después de restablecer, ya no difieren');
});

// ---------------------------------------------------------------------------
// 9. Duración de 75 minutos en la plantilla y en cambios de ciclo.
// ---------------------------------------------------------------------------

test('9. Una plantilla de 75 minutos conserva la duración al cambiar de ciclo y al restablecer', () => {
  const weeks: RecurrenceWeek[] = [
    { weekIndex: 0, sessions: [{ weekday: 1, hour: 14, minute: 0, durationMinutes: 75 }] },
  ];
  const resized = resizeWeeksToCycle(weeks, 3);
  resized.forEach((week) => {
    week.sessions.forEach((session) => {
      assertEqual(session.durationMinutes, 75, 'cada semana nueva conserva los 75 minutos de la plantilla');
    });
  });

  const modified: RecurrenceWeek[] = resized.map((week) =>
    week.weekIndex === 1 ? { ...week, sessions: [{ weekday: 2, hour: 16, minute: 0, durationMinutes: 60 }] } : week
  );
  const reset = resetWeeksFromModel(modified);
  reset.forEach((week) => {
    week.sessions.forEach((session) => {
      assertEqual(session.durationMinutes, 75, 'restablecer desde la plantilla recupera los 75 minutos');
    });
  });
});

// ---------------------------------------------------------------------------
// 10. Conflictos, vacaciones y horarios bloqueados con una plantilla de
// varios días — confirma que ampliar la plantilla a más de un día por
// semana no rompe la detección de conflictos existente (ya probada a fondo
// en calendarConflicts.test.ts): acá sólo se confirma que las ocurrencias
// de AMBOS días de la plantilla se generan con su horario real, listas
// para pasar por `findCalendarConflicts`/`isSessionAvailable`.
// ---------------------------------------------------------------------------

test('10. La plantilla de varios días por semana genera ocurrencias independientes por día, cada una lista para el chequeo de conflictos/disponibilidad', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-20T23:59:59.999Z')
  );
  const tuesday = occurrences.find((occurrence) => occurrence.weekday === 1);
  const wednesday = occurrences.find((occurrence) => occurrence.weekday === 2);
  assert(tuesday !== undefined, 'la ocurrencia del martes se genera');
  assert(wednesday !== undefined, 'la ocurrencia del miércoles se genera, de forma independiente');
  assertEqual(
    Math.round((new Date(tuesday!.end).getTime() - new Date(tuesday!.start).getTime()) / 60_000),
    60,
    'cada ocurrencia trae su propia duración exacta para el chequeo de superposición'
  );
});

// ---------------------------------------------------------------------------
// Validaciones puras del borrador (VALIDACIONES del pedido).
// ---------------------------------------------------------------------------

test('validateRecurrenceDraft rechaza una semana sin ningún día/horario', () => {
  const draft: PendingRecurrenceDraft = { mode: 'weekly', cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [] }] };
  const errors = validateRecurrenceDraft(draft);
  assertEqual(errors.length, 1, 'reporta exactamente un error');
  assertEqual(errors[0].weekIndex, 0, 'el error apunta a la semana vacía');
});

test('validateRecurrenceDraft rechaza dos bloques idénticos en la misma semana', () => {
  const draft: PendingRecurrenceDraft = {
    mode: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 1, hour: 18, minute: 0, durationMinutes: 60 },
          { weekday: 1, hour: 18, minute: 0, durationMinutes: 75 },
        ],
      },
    ],
  };
  const errors = validateRecurrenceDraft(draft);
  assert(errors.length === 1, 'reporta el bloque duplicado (mismo día/hora, aunque cambie la duración)');
});

test('validateRecurrenceDraft no reporta errores para una plantilla válida con varios días', () => {
  const draft: PendingRecurrenceDraft = {
    mode: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [
          { weekday: 1, hour: 18, minute: 0, durationMinutes: 60 },
          { weekday: 2, hour: 18, minute: 0, durationMinutes: 60 },
        ],
      },
    ],
  };
  assertEqual(validateRecurrenceDraft(draft).length, 0, 'una plantilla válida no genera errores');
});

test('validateRecurrenceDraft nunca valida el modo "single" (clase suelta)', () => {
  const draft: PendingRecurrenceDraft = {
    mode: 'single',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [] }],
  };
  assertEqual(validateRecurrenceDraft(draft).length, 0, 'clase suelta nunca exige día/horario de serie');
});

test('toggleCustomizeWeeksOnDraft(false) colapsa a una única semana con la plantilla, sin fabricar una semana vacía', () => {
  const draft: PendingRecurrenceDraft = {
    mode: 'custom',
    cycleLengthWeeks: 3,
    weeks: [
      { weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] },
      { weekIndex: 1, sessions: [{ weekday: 2, hour: 9, minute: 0, durationMinutes: 45 }] },
      { weekIndex: 2, sessions: [{ weekday: 4, hour: 20, minute: 0, durationMinutes: 90 }] },
    ],
  };
  const collapsed = toggleCustomizeWeeksOnDraft(draft, false);
  assertEqual(collapsed.mode, 'weekly', 'vuelve a modo weekly');
  assertEqual(collapsed.cycleLengthWeeks, 1, 'vuelve a un ciclo de 1 semana');
  assertEqual(collapsed.weeks.length, 1, 'sólo queda la semana modelo');
  assert(sessionsEqual(collapsed.weeks[0].sessions, draft.weeks[0].sessions), 'conserva la plantilla de la Semana 1');
});
