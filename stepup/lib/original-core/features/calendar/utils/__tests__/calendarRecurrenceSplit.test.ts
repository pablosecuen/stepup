// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceSplit.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, PendingRecurrenceDraft, RecurrenceException, RecurrenceRule } from '../../types/index.ts';
import type { TeacherAvailability } from '../../types/teacherAvailability.ts';
import { consolidateStudentFutureRecurrences, findDetachedFutureLessonsForStudent, removeFutureMaterializationsForRecurrences, repairExplicitSuccessorDuplicates, selectCanonicalRecurrenceRules, selectManageableRecurrenceSeries, removeSupersededFutureMaterializations, resolveEditableRecurrenceRule, sanitizeMaterializationsByRuleBounds, splitRecurrenceFromDate, validateFutureRecurrence } from '../calendarRecurrenceSplit.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const rule: RecurrenceRule = {
  recurrenceId: 'old', studentId: 's1', type: 'weekly', cycleLengthWeeks: 1,
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 10, minute: 0, durationMinutes: 60 }]}],
  modality: 'presencial', timezone: 'America/Argentina/Buenos_Aires',
  startDate: '2026-07-06', endDate: null, status: 'active',
};
const draft: PendingRecurrenceDraft = {
  mode: 'custom', cycleLengthWeeks: 2,
  weeks: [
    { weekIndex: 0, sessions: [
      { weekday: 0, hour: 9, minute: 0, durationMinutes: 60 },
      { weekday: 4, hour: 15, minute: 0, durationMinutes: 60 },
    ]},
    { weekIndex: 1, sessions: [{ weekday: 2, hour: 11, minute: 0, durationMinutes: 45 }]},
  ],
};

test('corta original y crea sucesora sin mutar entradas', () => {
  const exceptions: RecurrenceException[] = [{
    recurrenceId: 'old', occurrenceKey: 'historical', type: 'cancelled', createdAt: '2026-07-10T00:00:00Z',
  }];
  const result = splitRecurrenceFromDate({
    rule, draft, exceptions, effectiveDate: '2026-07-15', todayDate: '2026-07-13',
    newRecurrenceId: 'new', createdAt: '2026-07-13T12:00:00Z',
  });
  assertEqual(result.originalRule.endDate, '2026-07-14', 'corte inclusivo');
  assertEqual(result.successorRule.startDate, '2026-07-13', 'lunes de semana efectiva');
  assertEqual(result.successorRule.recurrenceId, 'new', 'identidad nueva');
  assertEqual(result.successorRule.cycleLengthWeeks, 2, 'patrón nuevo');
  assertEqual(result.exceptions[0].occurrenceKey, 'historical', 'preserva excepción histórica');
  assert(result.addedExceptions.length === 1, 'excluye el lunes anterior a la fecha efectiva');
  assertEqual(rule.endDate, null, 'no muta regla original');
  assertEqual(exceptions.length, 1, 'no muta excepciones originales');
});

test('20. Editar futuras con fecha efectiva IGUAL al inicio de la serie ahora se permite (antes se rechazaba incorrectamente)', () => {
  const result = splitRecurrenceFromDate({
    rule, draft, exceptions: [], effectiveDate: rule.startDate, todayDate: rule.startDate,
    newRecurrenceId: 'successor-from-start', createdAt: '2026-07-06T12:00:00Z',
  });
  assertEqual(result.originalRule.status, 'ended', 'la regla original se cierra por estado: nunca hubo un tramo previo real que conservar');
  assertEqual(result.originalRule.endDate, rule.endDate, 'nunca fabrica un endDate anterior a su propio startDate');
  assertEqual(result.successorRule.startDate, rule.startDate, 'la sucesora arranca exactamente en la fecha de inicio original');
  assertEqual(result.successorRule.effectiveFromDate, rule.startDate, 'effectiveFromDate queda registrado correctamente');
});

test('sigue rechazando una fecha efectiva realmente anterior al inicio de la serie', () => {
  let rejected = false;
  try {
    splitRecurrenceFromDate({
      rule, draft, exceptions: [], effectiveDate: '2026-07-01', todayDate: '2026-06-25',
      newRecurrenceId: 'too-early',
    });
  } catch (error) {
    rejected = true;
    assert(
      error instanceof Error && /igual o posterior al inicio/.test(error.message),
      'el mensaje explica que debe ser igual o posterior al inicio de la serie'
    );
  }
  assert(rejected, 'una fecha efectiva antes del inicio real de la serie se sigue rechazando');
});

test('rechaza fecha pasada y reutilizar id', () => {
  let past = false;
  try {
    splitRecurrenceFromDate({ rule, draft, exceptions: [], effectiveDate: '2026-07-12', todayDate: '2026-07-13', newRecurrenceId: 'new' });
  } catch { past = true; }
  assert(past, 'fecha pasada rechazada');
  let sameId = false;
  try {
    splitRecurrenceFromDate({ rule, draft, exceptions: [], effectiveDate: '2026-07-15', todayDate: '2026-07-13', newRecurrenceId: 'old' });
  } catch { sameId = true; }
  assert(sameId, 'id repetido rechazado');
});

const availability: TeacherAvailability = {
  schemaVersion: 1, timezone: rule.timezone, weeklyBlocks: [], exceptions: [],
};

test('valida conflicto de clase y disponibilidad futura', () => {
  const split = splitRecurrenceFromDate({
    rule, draft: { mode: 'weekly', cycleLengthWeeks: 1, weeks: [{
      weekIndex: 0, sessions: [{ weekday: 2, hour: 10, minute: 0, durationMinutes: 60 }],
    }]}, exceptions: [], effectiveDate: '2026-07-15', todayDate: '2026-07-13', newRecurrenceId: 'new',
  });
  const lesson = {
    id: 'busy', start: '2026-07-15T13:00:00.000Z', end: '2026-07-15T14:00:00.000Z',
    status: 'scheduled', overlapAllowed: false, recurrenceId: null,
  } as unknown as CalendarLesson;
  const conflicts = validateFutureRecurrence({
    successorRule: split.successorRule, effectiveDate: '2026-07-15',
    horizonEnd: new Date('2026-07-30T00:00:00.000Z'), lessons: [lesson],
    availability, originalRecurrenceId: 'old',
  });
  assert(conflicts.some((item) => item.calendarConflicts.length > 0), 'detecta clase ocupada');

  const blocked = validateFutureRecurrence({
    successorRule: split.successorRule, effectiveDate: '2026-07-15',
    horizonEnd: new Date('2026-07-30T00:00:00.000Z'), lessons: [],
    availability: { ...availability, exceptions: [{
      id: 'leave', date: '2026-07-22', type: 'unavailable_full_day', reason: 'leave',
    }]}, originalRecurrenceId: 'old',
  });
  assert(blocked.some((item) => !item.availability.isAvailable), 'detecta indisponibilidad');
});

test('al cambiar sÃ¡bado por miÃ©rcoles elimina sÃ³lo materializaciones futuras de la serie vieja', () => {
  const lesson = (
    id: string,
    start: string,
    recurrenceId: string | null,
    recurrenceOriginalStart: string | null = null
  ) => ({
    id,
    studentId: 's1',
    studentName: 'BÃ¡rbara',
    level: 'B1',
    participants: [{ studentId: 's1', studentName: 'BÃ¡rbara', level: 'B1' }],
    lessonType: 'individual',
    start,
    end: new Date(new Date(start).getTime() + 60 * 60_000).toISOString(),
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: recurrenceId !== null,
    recurrenceId,
    recurrenceOccurrenceKey: recurrenceId ? `${id}:occurrence` : null,
    recurrenceIndex: recurrenceId ? 1 : null,
    recurrenceOriginalStart,
  }) as CalendarLesson;

  const pastSaturday = lesson('past-saturday', '2026-07-11T13:00:00.000Z', 'old');
  const futureSaturday = lesson('future-saturday', '2026-07-18T13:00:00.000Z', 'old');
  const unrelated = lesson('other-series', '2026-07-18T13:00:00.000Z', 'other');
  const rescheduledHistorical = lesson(
    'past-moved-forward',
    '2026-07-20T13:00:00.000Z',
    'old',
    '2026-07-11T13:00:00.000Z'
  );

  const result = removeSupersededFutureMaterializations(
    [pastSaturday, futureSaturday, unrelated, rescheduledHistorical],
    rule,
    '2026-07-15'
  );

  assert(!result.some((item) => item.id === 'future-saturday'), 'el sÃ¡bado viejo futuro desaparece');
  assert(result.some((item) => item.id === 'past-saturday'), 'el sÃ¡bado pasado se conserva');
  assert(result.some((item) => item.id === 'other-series'), 'otra serie se conserva');
  assert(result.some((item) => item.id === 'past-moved-forward'), 'reprogramaciÃ³n histÃ³rica se conserva');
});

test('redirige una tarjeta vieja cortada hacia la sucesora vigente', () => {
  const oldTranche: RecurrenceRule = { ...rule, endDate: '2026-07-14' };
  const successor: RecurrenceRule = {
    ...rule,
    recurrenceId: 'successor',
    startDate: '2026-07-13',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 13, minute: 0, durationMinutes: 60 }] }],
  };
  assertEqual(
    resolveEditableRecurrenceRule(oldTranche, [oldTranche, successor], '2026-07-15').recurrenceId,
    'successor',
    'sanea un split legado sin campos de linaje'
  );

  const linkedOld = { ...oldTranche, supersededByRecurrenceId: 'successor' };
  const linkedSuccessor = {
    ...successor,
    supersedesRecurrenceId: 'old',
    effectiveFromDate: '2026-07-15',
  };
  assertEqual(
    resolveEditableRecurrenceRule(linkedOld, [linkedOld, linkedSuccessor], '2026-07-15').recurrenceId,
    'successor',
    'sigue linaje explÃ­cito'
  );
});

test('una clase cancelada el miÃ©rcoles libera el horario para la sucesora', () => {
  const successor: RecurrenceRule = {
    ...rule,
    recurrenceId: 'successor-wed',
    startDate: '2026-07-13',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 13, minute: 0, durationMinutes: 60 }] }],
  };
  const cancelled = {
    id: 'cancelled-wed',
    start: '2026-07-15T16:00:00.000Z',
    end: '2026-07-15T17:00:00.000Z',
    status: 'cancelled',
    overlapAllowed: false,
    recurrenceId: null,
  } as unknown as CalendarLesson;
  const conflicts = validateFutureRecurrence({
    successorRule: successor,
    effectiveDate: '2026-07-15',
    horizonEnd: new Date('2026-07-16T00:00:00.000Z'),
    lessons: [cancelled],
    availability,
    originalRecurrenceId: 'old',
  });
  assertEqual(conflicts.length, 0, 'cancelada no bloquea');
});

test('sanea al hidratar un sÃ¡bado futuro materializado de un ancestro ya cortado', () => {
  const oldTranche: RecurrenceRule = { ...rule, endDate: '2026-07-14' };
  const make = (
    id: string,
    start: string,
    recurrenceId: string,
    recurrenceOriginalStart: string | null = null
  ) => ({
    id, start, recurrenceId, recurrenceOriginalStart,
  }) as CalendarLesson;
  const staleSaturday = make('stale-saturday', '2026-07-18T13:00:00.000Z', 'old');
  const past = make('past', '2026-07-11T13:00:00.000Z', 'old');
  const historicalMoved = make(
    'historical-moved',
    '2026-07-20T13:00:00.000Z',
    'old',
    '2026-07-11T13:00:00.000Z'
  );
  const successorLesson = make('successor-wed', '2026-07-15T16:00:00.000Z', 'successor');

  const cleaned = sanitizeMaterializationsByRuleBounds(
    [staleSaturday, past, historicalMoved, successorLesson],
    [oldTranche, { ...rule, recurrenceId: 'successor', startDate: '2026-07-13' }]
  );
  assert(!cleaned.some((item) => item.id === 'stale-saturday'), 'elimina materializaciÃ³n fuera de endDate');
  assert(cleaned.some((item) => item.id === 'past'), 'conserva pasado');
  assert(cleaned.some((item) => item.id === 'historical-moved'), 'conserva reprogramada histÃ³rica');
  assert(cleaned.some((item) => item.id === 'successor-wed'), 'conserva sucesora');
});

test('consolida reglas concurrentes del mismo alumno en una sola serie futura', () => {
  const split = splitRecurrenceFromDate({
    rule,
    draft: {
      mode: 'weekly', cycleLengthWeeks: 1,
      weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 13, minute: 0, durationMinutes: 60 }] }],
    },
    exceptions: [], effectiveDate: '2026-07-15', todayDate: '2026-07-13',
    newRecurrenceId: 'successor',
  });
  const duplicateRunning: RecurrenceRule = { ...rule, recurrenceId: 'duplicate-running' };
  const duplicateNotStarted: RecurrenceRule = {
    ...rule, recurrenceId: 'duplicate-future', startDate: '2026-07-20',
  };
  const otherStudent: RecurrenceRule = { ...rule, recurrenceId: 'other', studentId: 's2' };
  const consolidation = consolidateStudentFutureRecurrences({
    rules: [rule, duplicateRunning, duplicateNotStarted, otherStudent],
    originalRule: split.originalRule,
    successorRule: split.successorRule,
    effectiveDate: '2026-07-15',
  });
  const running = consolidation.rules.find((item) => item.recurrenceId === 'duplicate-running');
  const notStarted = consolidation.rules.find((item) => item.recurrenceId === 'duplicate-future');
  assertEqual(running?.endDate, '2026-07-14', 'corta duplicada ya iniciada');
  assertEqual(notStarted?.status, 'ended', 'finaliza duplicada que todavÃ­a no empezÃ³');
  assertEqual(notStarted?.endDate, null, 'no fabrica endDate anterior a startDate');
  assertEqual(
    consolidation.rules.filter(
      (item) => item.studentId === 's1' && item.status !== 'ended' && (!item.endDate || item.endDate >= '2026-07-15')
    ).length,
    1,
    'queda una sola serie futura'
  );
  assertEqual(
    consolidation.rules.find((item) => item.recurrenceId === 'other')?.endDate,
    null,
    'no toca otra persona'
  );

  const futureOld = { id: 'old-future', recurrenceId: 'old', start: '2026-07-18T13:00:00Z', recurrenceOriginalStart: null } as CalendarLesson;
  const futureDuplicate = { id: 'duplicate-future-lesson', recurrenceId: 'duplicate-running', start: '2026-07-18T13:00:00Z', recurrenceOriginalStart: null } as CalendarLesson;
  const cleaned = removeFutureMaterializationsForRecurrences(
    [futureOld, futureDuplicate],
    consolidation.supersededRecurrenceIds,
    '2026-07-15',
    rule.timezone
  );
  assertEqual(cleaned.length, 0, 'limpia materializaciones de todos los supersedidos');
});

test('reporta pero no borra automÃ¡ticamente una clase suelta futura', () => {
  const detached = {
    id: 'detached', studentId: 's1', participants: [], recurrenceId: null,
    status: 'scheduled', start: '2026-07-18T13:00:00.000Z',
  } as unknown as CalendarLesson;
  const cancelled = { ...detached, id: 'detached-cancelled', status: 'cancelled' } as CalendarLesson;
  const found = findDetachedFutureLessonsForStudent(
    [detached, cancelled], 's1', '2026-07-15', rule.timezone
  );
  assertEqual(found.length, 1, 'sÃ³lo reporta la suelta activa');
  assertEqual(found[0].id, 'detached', 'conserva identidad para advertencia');
});

test('hidratacion repara duplicadas solo ante sucesora con linaje explicito', () => {
  const original: RecurrenceRule = {
    ...rule, endDate: '2026-07-14', supersededByRecurrenceId: 'successor-explicit',
  };
  const successor: RecurrenceRule = {
    ...rule, recurrenceId: 'successor-explicit', startDate: '2026-07-13',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 13, minute: 0, durationMinutes: 60 }] }],
    supersedesRecurrenceId: 'old', effectiveFromDate: '2026-07-15',
  };
  const duplicate: RecurrenceRule = { ...rule, recurrenceId: 'duplicate-saturday' };
  const stale = {
    id: 'stale-duplicate', recurrenceId: 'duplicate-saturday',
    start: '2026-07-18T13:00:00.000Z', recurrenceOriginalStart: null,
  } as CalendarLesson;
  const repaired = repairExplicitSuccessorDuplicates({
    rules: [original, successor, duplicate], lessons: [stale],
  });
  assert(repaired.changed, 'detecta reparacion');
  assertEqual(repaired.lessons.length, 0, 'limpia sabado duplicado persistido');
  assertEqual(
    repaired.rules.find((item) => item.recurrenceId === 'duplicate-saturday')?.endDate,
    '2026-07-14',
    'corta duplicada desde effectiveFromDate'
  );
  assertEqual(
    repaired.rules.filter(
      (item) => item.studentId === 's1' && item.status !== 'ended' && (!item.endDate || item.endDate >= '2026-07-15')
    ).length,
    1,
    'queda solo sucesora futura'
  );

  const ambiguous = repairExplicitSuccessorDuplicates({
    rules: [rule, duplicate], lessons: [stale],
  });
  assert(!ambiguous.changed, 'no deduplica reglas legacy ambiguas');
  assertEqual(ambiguous.rules.length, 2, 'conserva reglas sin linaje');
  assertEqual(ambiguous.lessons.length, 1, 'conserva materializacion ambigua');
});

test('vista canÃ³nica prioriza sucesora explÃ­cita mÃ¡s reciente por alumno', () => {
  const old = { ...rule, recurrenceId: 'old-card' };
  const firstSuccessor: RecurrenceRule = {
    ...rule, recurrenceId: 'successor-1', supersedesRecurrenceId: 'old-card',
    effectiveFromDate: '2026-07-15', startDate: '2026-07-13',
  };
  const latestSuccessor: RecurrenceRule = {
    ...rule, recurrenceId: 'successor-2', supersedesRecurrenceId: 'successor-1',
    effectiveFromDate: '2026-07-22', startDate: '2026-07-20', status: 'paused',
  };
  const cards = selectCanonicalRecurrenceRules(
    [old, firstSuccessor, latestSuccessor],
    '2026-07-13T12:00:00.000Z'
  );
  assertEqual(cards.length, 1, 'una tarjeta por alumno');
  assertEqual(cards[0].recurrenceId, 'successor-2', 'elige linaje mÃ¡s reciente');
  assertEqual(cards[0].status, 'paused', 'mantiene canÃ³nica pausada accionable');
});

test('vista canÃ³nica legacy elige Ãºltima vigente y oculta finalizadas o vencidas', () => {
  const legacyFirst = { ...rule, recurrenceId: 'legacy-1' };
  const legacyLast = { ...rule, recurrenceId: 'legacy-2' };
  const expired = { ...rule, recurrenceId: 'expired', studentId: 's2', endDate: '2026-07-10' };
  const ended = { ...rule, recurrenceId: 'ended', studentId: 's3', status: 'ended' as const };
  const other = { ...rule, recurrenceId: 'other-current', studentId: 's4' };
  const cards = selectCanonicalRecurrenceRules(
    [legacyFirst, legacyLast, expired, ended, other],
    '2026-07-13T12:00:00.000Z'
  );
  assertEqual(cards.length, 2, 'sÃ³lo alumnos con serie vigente');
  assertEqual(
    cards.find((item) => item.studentId === 's1')?.recurrenceId,
    'legacy-2',
    'legacy ambiguo usa Ãºltima en storage'
  );
  assert(cards.some((item) => item.recurrenceId === 'other-current'), 'mantiene otra persona');
});

// ===========================================================================
// Corrección 2026-09-16 (a pedido de Joaquín — SERIES DE ENTRENAMIENTO QUE
// DESAPARECEN DE "SERIES"): `selectManageableRecurrenceSeries` — identidad
// por LINAJE real (supersedesRecurrenceId/effectiveFromDate), nunca por
// studentId ni por trainingBillingAgreementId === undefined. Cubre
// exactamente los casos que ocultaba `selectCanonicalRecurrenceRules` (que
// sigue existiendo intacta, sin cambios, para sus consumidores reales de
// "serie vigente DE ESTE alumno").
// ===========================================================================

test('Tres series activas de entrenamiento sin alumno principal (studentId === "") aparecen las tres, nunca colapsadas en una sola', () => {
  const groupA: RecurrenceRule = {
    ...rule, recurrenceId: 'group-a', studentId: '', participantIds: ['s1', 's2'],
    activityKind: 'training', classTitle: 'Grupo A',
  };
  const groupB: RecurrenceRule = {
    ...rule, recurrenceId: 'group-b', studentId: '', participantIds: ['s3', 's4'],
    activityKind: 'training', classTitle: 'Grupo B',
  };
  const groupC: RecurrenceRule = {
    ...rule, recurrenceId: 'group-c', studentId: '', participantIds: ['s5', 's6'],
    activityKind: 'training', classTitle: 'Grupo C',
  };
  const series = selectManageableRecurrenceSeries([groupA, groupB, groupC], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 3, 'las tres series sin alumno principal aparecen — nunca se fusionan por compartir studentId vacío');
  assert(series.some((item) => item.recurrenceId === 'group-a'), 'Grupo A presente');
  assert(series.some((item) => item.recurrenceId === 'group-b'), 'Grupo B presente');
  assert(series.some((item) => item.recurrenceId === 'group-c'), 'Grupo C presente');
});

test('Dos series de entrenamiento distintas con el MISMO alumno principal aparecen ambas', () => {
  const morning: RecurrenceRule = { ...rule, recurrenceId: 'training-morning', studentId: 's1', activityKind: 'training' };
  const evening: RecurrenceRule = {
    ...rule, recurrenceId: 'training-evening', studentId: 's1', activityKind: 'training',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 19, minute: 0, durationMinutes: 60 }] }],
  };
  const series = selectManageableRecurrenceSeries([morning, evening], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 2, 'dos series independientes del mismo alumno nunca se colapsan en una');
  assert(series.some((item) => item.recurrenceId === 'training-morning'), 'training-morning presente');
  assert(series.some((item) => item.recurrenceId === 'training-evening'), 'training-evening presente');
});

test('Serie grupal con varios participantIds: el selector devuelve UNA sola entrada, con participantIds intactos (nunca sólo el primer alumno)', () => {
  const group: RecurrenceRule = {
    ...rule, recurrenceId: 'group-training', studentId: 's1', participantIds: ['s1', 's2', 's3'],
    activityKind: 'training', trainingBillingAgreementId: 'agreement-1',
  };
  const series = selectManageableRecurrenceSeries([group], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 1, 'una sola tarjeta representa toda la serie grupal');
  assertEqual(series[0].participantIds?.length, 3, 'conserva TODOS los participantes, no sólo studentId');
});

test('Dos series históricas SIN trainingBillingAgreementId permanecen independientes — nunca se agrupan por compartir "undefined"', () => {
  const historicA: RecurrenceRule = { ...rule, recurrenceId: 'hist-a', studentId: 's1', activityKind: 'training' };
  const historicB: RecurrenceRule = {
    ...rule, recurrenceId: 'hist-b', studentId: 's1', activityKind: 'training',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 8, minute: 0, durationMinutes: 60 }] }],
  };
  assertEqual(historicA.trainingBillingAgreementId, undefined, 'fixture sin acuerdo');
  assertEqual(historicB.trainingBillingAgreementId, undefined, 'fixture sin acuerdo');
  const series = selectManageableRecurrenceSeries([historicA, historicB], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 2, 'sin trainingBillingAgreementId, cada serie sigue siendo independiente');
});

test('Tramo original + sucesora explícita ("esta y las siguientes"): aparece UNA sola serie canónica vigente, nunca las dos tarjetas', () => {
  const original: RecurrenceRule = {
    ...rule, recurrenceId: 'lineage-original', studentId: 's1',
    endDate: '2026-07-14', supersededByRecurrenceId: 'lineage-successor',
  };
  const successor: RecurrenceRule = {
    ...rule, recurrenceId: 'lineage-successor', studentId: 's1',
    supersedesRecurrenceId: 'lineage-original', effectiveFromDate: '2026-07-15', startDate: '2026-07-13',
  };
  const series = selectManageableRecurrenceSeries([original, successor], '2026-07-20T12:00:00.000Z');
  assertEqual(series.length, 1, 'el linaje real (original + sucesora explícita) es UNA sola serie');
  assertEqual(series[0].recurrenceId, 'lineage-successor', 'la tarjeta representa el tramo vigente');
});

test('Series finalizadas o tramos históricos no aparecen — por lo tanto nunca ofrecen "Configurar cuota" futura', () => {
  const original: RecurrenceRule = {
    ...rule, recurrenceId: 'ended-original', studentId: 's1',
    endDate: '2026-07-14', supersededByRecurrenceId: 'ended-successor',
  };
  const successorEnded: RecurrenceRule = {
    ...rule, recurrenceId: 'ended-successor', studentId: 's1', status: 'ended',
    supersedesRecurrenceId: 'ended-original', effectiveFromDate: '2026-07-15', startDate: '2026-07-13',
  };
  const untouchedEnded: RecurrenceRule = { ...rule, recurrenceId: 'plain-ended', studentId: 's2', status: 'ended' };
  const series = selectManageableRecurrenceSeries(
    [original, successorEnded, untouchedEnded],
    '2026-07-20T12:00:00.000Z'
  );
  assertEqual(series.length, 0, 'ningún tramo del linaje finalizado aparece — ni el histórico ni la sucesora ya cerrada');
});

test('La lista de series no pierde clases recurrentes normales (activityKind class, sin entrenamiento) mientras se corrige la vista de entrenamientos', () => {
  const regularClass: RecurrenceRule = { ...rule, recurrenceId: 'plain-class', studentId: 's1' };
  const training: RecurrenceRule = {
    ...rule, recurrenceId: 'plain-training', studentId: 's2', activityKind: 'training',
  };
  const series = selectManageableRecurrenceSeries([regularClass, training], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 2, 'una clase normal y un entrenamiento, cada uno su propia tarjeta');
  assert(series.some((item) => item.recurrenceId === 'plain-class'), 'la clase normal sigue apareciendo');
});

test('REGRESIÓN: nunca vuelve a agrupar por studentId — tres series con el MISMO studentId no vinculadas por linaje aparecen las tres', () => {
  const first: RecurrenceRule = { ...rule, recurrenceId: 'reg-1', studentId: 's1' };
  const second: RecurrenceRule = {
    ...rule, recurrenceId: 'reg-2', studentId: 's1',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 9, minute: 0, durationMinutes: 60 }] }],
  };
  const third: RecurrenceRule = {
    ...rule, recurrenceId: 'reg-3', studentId: 's1',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 5, hour: 16, minute: 0, durationMinutes: 60 }] }],
  };
  const series = selectManageableRecurrenceSeries([first, second, third], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 3, 'agrupar por studentId volvería a ocultar 2 de las 3 — la identidad real es el linaje, no el alumno');
});

test('REGRESIÓN: nunca vuelve a agrupar por trainingBillingAgreementId === undefined — dos series de entrenamiento sin acuerdo configurado aparecen ambas', () => {
  const noAgreementA: RecurrenceRule = { ...rule, recurrenceId: 'no-agreement-a', studentId: '', participantIds: ['s1', 's2'], activityKind: 'training' };
  const noAgreementB: RecurrenceRule = { ...rule, recurrenceId: 'no-agreement-b', studentId: '', participantIds: ['s3', 's4'], activityKind: 'training' };
  assertEqual(noAgreementA.trainingBillingAgreementId, undefined, 'fixture sin acuerdo');
  assertEqual(noAgreementB.trainingBillingAgreementId, undefined, 'fixture sin acuerdo');
  const series = selectManageableRecurrenceSeries([noAgreementA, noAgreementB], '2026-07-13T12:00:00.000Z');
  assertEqual(series.length, 2, 'agrupar por "ambas sin acuerdo" fusionaría series independientes — deben quedar separadas');
});
