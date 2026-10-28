// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/cancelledSlotReuseIntegration.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección P0 2026-08-18 (a pedido de Joaquín — "REEMPLAZAR CON OTRO
 * ALUMNO" SIGUE SIN APARECER EN EL TELÉFONO, commit 51e20ab: las pruebas
 * puras de `cancelledSlotReuse.ts` ya pasaban, pero el recorrido real de la
 * app seguía fallando). Esta suite NUNCA fabrica un `CalendarLesson`
 * directamente — reproduce el recorrido real completo:
 *
 *   RecurrenceRule → generateOccurrences (motor real) → tarjeta virtual
 *   (buildLessonFromOccurrence, lo que WeekTimeGrid mostraría antes de
 *   tocar "Cancelar") → cancelRecurrenceOccurrence (misma mutación real
 *   que usa Calendario: buildCancelledCalendarLessonMutation +
 *   upsertMaterializedOccurrence) → se vuelve a armar la semana exactamente
 *   como useWeeklyCalendar.ts (generatedOccurrences excluyendo lo no
 *   virtual, windowLessons + generatedLessons) → se busca el objeto
 *   EXACTO que `handlePressLesson` recibiría al tocar la tarjeta →
 *   `getCancelledSlotReuseDecision` sobre ESE objeto, con la misma lista
 *   `[...lessons, ...generatedLessons]` que usa CalendarTabScreen.
 */
import type { StudentListItem } from '../../../students/types/index.ts';
import type { CalendarLesson, GeneratedOccurrence, RecurrenceException, RecurrenceRule } from '../../types/index.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { buildCancelledCalendarLessonMutation, upsertMaterializedOccurrence } from '../calendarRecurrenceMutations.ts';
import { getCancelledSlotReuseDecision, isEligibleForCancelledSlotReuse } from '../cancelledSlotReuse.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
// "18/08/2026 por la tarde" — el momento actual exacto del caso físico
// pedido (15:00 Buenos Aires = 18:00 UTC).
const NOW = new Date('2026-08-18T18:00:00.000Z');

const student: StudentListItem = {
  id: 'student-1',
  name: 'Alumna Uno',
  levels: ['B1'],
  modality: 'presencial',
  status: 'activo',
  nextClassAt: null,
  paymentStatus: 'verde',
  averageGrade: 8,
  classesThisMonth: 0,
  lastPaymentAt: null,
  isFeatured: false,
  isNew: true,
  hasOverduePayment: false,
  hasPendingReport: false,
  hasPendingHomework: false,
};

function makeRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'rec-accept',
    studentId: student.id,
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        // weekday 5 = sábado (weekday 0 = lunes, confirmado por
        // calendarRecurrenceEngine.test.ts: startDate lunes + weekday 0
        // genera "cuatro lunes").
        sessions: [{ weekday: 5, hour: 11, minute: 0, durationMinutes: 60 }],
      },
    ],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-08-17', // lunes real (semana 0)
    endDate: null,
    status: 'active',
    ...overrides,
  };
}

/**
 * Réplica EXACTA de `generatedOccurrences`/`generatedLessons` en
 * `useWeeklyCalendar.ts` (líneas 532-572) — nunca una versión simplificada:
 * mismo filtro por `materializationStatus === 'virtual'`, mismo armado de
 * participantes.
 */
function computeGeneratedLessons(
  rules: RecurrenceRule[],
  exceptions: RecurrenceException[],
  lessons: CalendarLesson[],
  rangeStart: Date,
  rangeEnd: Date,
  studentById: Map<string, StudentListItem>
): CalendarLesson[] {
  const generatedOccurrences: GeneratedOccurrence[] = rules.flatMap((rule) =>
    applyExceptionsToOccurrences(generateOccurrences(rule, rangeStart, rangeEnd), exceptions, lessons)
  );
  return generatedOccurrences
    .filter((occurrence) => occurrence.materializationStatus === 'virtual')
    .map((occurrence) => {
      if (!occurrence.studentId) return buildLessonFromOccurrence(occurrence, null);
      const primary = studentById.get(occurrence.studentId) ?? null;
      return primary ? buildLessonFromOccurrence(occurrence, primary) : null;
    })
    .filter((lesson): lesson is CalendarLesson => lesson !== null);
}

/**
 * Réplica EXACTA de `windowLessons`/`windowDisplayLessons`
 * (`useWeeklyCalendar.ts` líneas 461-587) — el objeto que finalmente llega
 * a `week.days[].lessons` y, por lo tanto, a `handlePressLesson`.
 */
function computeWindowDisplayLessons(
  lessons: CalendarLesson[],
  generatedLessons: CalendarLesson[],
  windowStart: Date,
  windowEnd: Date
): CalendarLesson[] {
  const minimum = windowStart.getTime();
  const maximum = windowEnd.getTime();
  const windowLessons = lessons.filter((lesson) => {
    const start = new Date(lesson.start).getTime();
    return start >= minimum && start <= maximum;
  });
  return [
    ...windowLessons,
    ...generatedLessons.filter((lesson) => {
      const start = new Date(lesson.start).getTime();
      return start >= minimum && start <= maximum;
    }),
  ].sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime());
}

const studentById = new Map([[student.id, student]]);
const RANGE_START = new Date('2026-07-01T00:00:00.000Z');
const RANGE_END = new Date('2026-10-31T23:59:59.999Z');

// ===========================================================================
// CASO DE ACEPTACIÓN FÍSICO: 18/08/2026 por la tarde, clase recurrente del
// sábado 22/08/2026 11:00, cancelada con el mismo mecanismo real que usa
// Calendario ("Cancelar esta clase" → cancelRecurrenceOccurrence).
// ===========================================================================
test('CASO DE ACEPTACIÓN (recorrido real completo): sábado 22/08/2026 cancelada aparece con "Reemplazar con otro alumno", ANTES que "Restaurar"', () => {
  const rule = makeRule();
  const virtualOccurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = virtualOccurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  assert(targetOccurrence !== undefined, 'el motor real genera la ocurrencia del sábado 22/08/2026');

  // La tarjeta que WeekTimeGrid mostraría ANTES de cancelar (aún virtual).
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  assertEqual(virtualLesson.start, '2026-08-22T14:00:00.000Z', '11:00 Buenos Aires = 14:00 UTC, sin corrimiento de zona horaria');

  // Cancelación real: EXACTAMENTE lo que hace cancelRecurrenceOccurrence
  // (useWeeklyCalendar.ts) — nunca una mutación fabricada a mano.
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessonsAfterCancel = upsertMaterializedOccurrence([], mutation.lesson);
  const exceptionsAfterCancel = mutation.exception ? [mutation.exception] : [];

  // Se vuelve a armar la semana COMPLETA desde cero, como si la profesora
  // recién ahora abriera Calendario (nunca reutilizando el objeto virtual
  // de antes de cancelar).
  const generatedLessons = computeGeneratedLessons(
    [rule],
    exceptionsAfterCancel,
    lessonsAfterCancel,
    RANGE_START,
    RANGE_END,
    studentById
  );
  assert(
    !generatedLessons.some((lesson) => lesson.recurrenceOccurrenceKey === targetOccurrence!.occurrenceKey),
    'la ocurrencia cancelada ya NO se regenera como virtual — evita el duplicado virtual/materializado'
  );

  const windowStart = new Date('2026-08-17T03:00:00.000Z'); // lunes 00:00 Buenos Aires
  const windowEnd = new Date('2026-08-24T02:59:59.999Z'); // domingo 23:59 Buenos Aires
  const windowDisplayLessons = computeWindowDisplayLessons(lessonsAfterCancel, generatedLessons, windowStart, windowEnd);

  const matchingCards = windowDisplayLessons.filter(
    (lesson) => lesson.recurrenceOccurrenceKey === targetOccurrence!.occurrenceKey
  );
  assertEqual(matchingCards.length, 1, 'exactamente UNA tarjeta para el sábado 22/08 — nunca dos (virtual + materializada) al mismo tiempo');

  // El objeto EXACTO que handlePressLesson recibiría al tocar la tarjeta.
  const tappedLesson = matchingCards[0];
  assertEqual(tappedLesson.status, 'cancelled', 'la tarjeta tocada está realmente cancelada');
  assertEqual(tappedLesson.recurrenceId, 'rec-accept', 'conserva la serie real');
  assertEqual(tappedLesson.recurrenceOccurrenceKey, targetOccurrence!.occurrenceKey, 'misma identidad de ocurrencia');

  // La MISMA lista que arma CalendarTabScreen para el panel de acciones:
  // [...lessons, ...generatedLessons] — nunca windowDisplayLessons ni
  // ninguna otra variante recortada.
  const allLessonsForEligibility = [...lessonsAfterCancel, ...generatedLessons];
  const decision = getCancelledSlotReuseDecision(tappedLesson, allLessonsForEligibility, NOW);
  assertEqual(decision.reason, 'eligible', `debía ser elegible; razón real devuelta: ${decision.reason} (status=${decision.status}, startTime=${decision.startTime}, nowTime=${decision.nowTime}, hasActiveReplacement=${decision.hasActiveReplacement}, activeReplacementIds=${decision.activeReplacementIds.join(',')})`);
  assert(decision.eligible, '"Reemplazar con otro alumno" debe aparecer en el recorrido real completo');
});

// ===========================================================================
// Cancelada futura SUELTA (sin serie) — mismo recorrido, sin motor de
// recurrencias de por medio.
// ===========================================================================
test('Cancelada futura suelta (clase suelta, sin recurrencia): aparece', () => {
  const standalone: CalendarLesson = {
    id: 'standalone-1',
    studentId: student.id,
    studentName: student.name,
    level: student.levels.join(', '),
    participants: [{ studentId: student.id, studentName: student.name, level: student.levels.join(', ') }],
    lessonType: 'individual',
    start: '2026-08-25T15:00:00.000Z',
    end: '2026-08-25T16:00:00.000Z',
    modality: 'presencial',
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
  };
  const mutation = buildCancelledCalendarLessonMutation(standalone);
  const lessonsAfterCancel = upsertMaterializedOccurrence([], mutation.lesson);
  const tappedLesson = lessonsAfterCancel[0];
  const decision = getCancelledSlotReuseDecision(tappedLesson, lessonsAfterCancel, NOW);
  assertEqual(decision.reason, 'eligible', `razón real: ${decision.reason}`);
});

// ===========================================================================
// Cancelada PASADA (recurrente, recorrido real completo): no aparece.
// ===========================================================================
test('Cancelada pasada (recorrido real completo, serie distinta con inicio anterior): NO aparece', () => {
  const rule = makeRule({ recurrenceId: 'rec-past', startDate: '2026-08-03' }); // primer sábado real: 2026-08-08
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const pastOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-08'));
  assert(pastOccurrence !== undefined, 'genera la ocurrencia pasada real');

  const virtualLesson = buildLessonFromOccurrence(pastOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessonsAfterCancel = upsertMaterializedOccurrence([], mutation.lesson);
  const exceptionsAfterCancel = mutation.exception ? [mutation.exception] : [];
  const generatedLessons = computeGeneratedLessons([rule], exceptionsAfterCancel, lessonsAfterCancel, RANGE_START, RANGE_END, studentById);

  const tappedLesson = lessonsAfterCancel.find(
    (lesson) => lesson.recurrenceOccurrenceKey === pastOccurrence!.occurrenceKey
  )!;
  const decision = getCancelledSlotReuseDecision(tappedLesson, [...lessonsAfterCancel, ...generatedLessons], NOW);
  assertEqual(decision.reason, 'not_future', `razón real: ${decision.reason}`);
});

// ===========================================================================
// Horario EXACTAMENTE actual: no aparece.
// ===========================================================================
test('Cancelada con inicio EXACTAMENTE igual a "ahora" (recorrido real): NO aparece', () => {
  const rule = makeRule({
    recurrenceId: 'rec-exact-now',
    startDate: '2026-08-17',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 15, minute: 0, durationMinutes: 60 }] }], // martes 18/08 15:00 Bs As = 18:00 UTC = NOW
  });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const exactNowOccurrence = occurrences.find((occurrence) => occurrence.start === NOW.toISOString());
  assert(exactNowOccurrence !== undefined, 'genera la ocurrencia exactamente en NOW');

  const virtualLesson = buildLessonFromOccurrence(exactNowOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessonsAfterCancel = upsertMaterializedOccurrence([], mutation.lesson);
  const decision = getCancelledSlotReuseDecision(lessonsAfterCancel[0], lessonsAfterCancel, NOW);
  assertEqual(decision.reason, 'not_future', `razón real: ${decision.reason}`);
});

// ===========================================================================
// Clase NO cancelada (recorrido real, todavía virtual): no aparece.
// ===========================================================================
test('Clase futura NO cancelada (todavía virtual, recorrido real completo): NUNCA aparece', () => {
  const rule = makeRule({ recurrenceId: 'rec-not-cancelled' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const futureOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(futureOccurrence!, student);
  // Nunca se cancela — sigue tal cual la generó el motor real.
  const decision = getCancelledSlotReuseDecision(virtualLesson, [virtualLesson], NOW);
  assertEqual(decision.reason, 'not_cancelled', `razón real: ${decision.reason}`);
});

// ===========================================================================
// Cancelada futura CON reemplazo activo (recorrido real completo): muestra
// el aviso, no el botón.
// ===========================================================================
test('Cancelada futura CON reemplazo activo (recorrido real completo): no ofrece un segundo reemplazo', () => {
  const rule = makeRule({ recurrenceId: 'rec-with-replacement' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  let lessons = upsertMaterializedOccurrence([], mutation.lesson);
  const cancelledLesson = lessons[0];

  // Reemplazo creado exactamente como handleCreateLesson: clase suelta
  // independiente con freedByLessonId apuntando a la cancelada real.
  const replacement: CalendarLesson = {
    id: 'replacement-1',
    studentId: 'student-2',
    studentName: 'Alumna Nueva',
    level: 'B1',
    participants: [{ studentId: 'student-2', studentName: 'Alumna Nueva', level: 'B1' }],
    lessonType: 'individual',
    start: cancelledLesson.start,
    end: cancelledLesson.end,
    modality: cancelledLesson.modality,
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    freedByLessonId: cancelledLesson.id,
  };
  lessons = [...lessons, replacement];

  const generatedLessons = computeGeneratedLessons([rule], mutation.exception ? [mutation.exception] : [], lessons, RANGE_START, RANGE_END, studentById);
  const decision = getCancelledSlotReuseDecision(cancelledLesson, [...lessons, ...generatedLessons], NOW);
  assertEqual(decision.reason, 'has_active_replacement', `razón real: ${decision.reason}`);
  assertEqual(decision.activeReplacementIds.join(','), 'replacement-1', 'identifica exactamente el reemplazo real');
});

// ===========================================================================
// Reemplazo cancelado o eliminado: vuelve a aparecer.
// ===========================================================================
test('Reemplazo cancelado (recorrido real completo): la cancelada original vuelve a ofrecer "Reemplazar"', () => {
  const rule = makeRule({ recurrenceId: 'rec-replacement-cancelled' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessons = upsertMaterializedOccurrence([], mutation.lesson);
  const cancelledLesson = lessons[0];

  const cancelledReplacement: CalendarLesson = {
    id: 'replacement-cancelled-1',
    studentId: 'student-2',
    studentName: 'Alumna Nueva',
    level: 'B1',
    participants: [],
    lessonType: 'individual',
    start: cancelledLesson.start,
    end: cancelledLesson.end,
    modality: cancelledLesson.modality,
    status: 'cancelled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    freedByLessonId: cancelledLesson.id,
  };
  const allLessons = [...lessons, cancelledReplacement];
  const decision = getCancelledSlotReuseDecision(cancelledLesson, allLessons, NOW);
  assertEqual(decision.reason, 'eligible', `razón real: ${decision.reason}`);
});

test('Reemplazo eliminado por completo (recorrido real completo): la cancelada original vuelve a ofrecer "Reemplazar"', () => {
  const rule = makeRule({ recurrenceId: 'rec-replacement-deleted' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessons = upsertMaterializedOccurrence([], mutation.lesson);
  const cancelledLesson = lessons[0];
  // El reemplazo nunca llegó a existir en esta lista (se borró por completo).
  const decision = getCancelledSlotReuseDecision(cancelledLesson, lessons, NOW);
  assertEqual(decision.reason, 'eligible', `razón real: ${decision.reason}`);
});

// ===========================================================================
// Duplicado virtual/materializado: no produce falso reemplazo.
// ===========================================================================
test('Duplicado virtual/materializado forzado (mismo occurrenceKey en ambas listas): no produce un falso reemplazo ni bloquea la elegibilidad', () => {
  const rule = makeRule({ recurrenceId: 'rec-duplicate-guard' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const cancelledLesson = mutation.lesson;

  // Escenario forzado: por algún fallo de deduplicación, la MISMA
  // cancelación aparece dos veces en allLessons (misma id, mismo objeto
  // lógico) — nunca debe contarse a sí misma como su propio reemplazo.
  const allLessonsWithDuplicate = [cancelledLesson, { ...cancelledLesson }];
  const decision = getCancelledSlotReuseDecision(cancelledLesson, allLessonsWithDuplicate, NOW);
  assertEqual(decision.hasActiveReplacement, false, 'un duplicado exacto de la propia cancelada (status cancelled) nunca cuenta como reemplazo');
  assertEqual(decision.reason, 'eligible', `razón real: ${decision.reason}`);

  // Variante: el duplicado NO está cancelado (representa la tarjeta
  // virtual que un bug de deduplicación dejó pasar) pero es un objeto
  // REALMENTE distinto sin freedByLessonId — tampoco debe contar.
  const staleVirtualDuplicate: CalendarLesson = { ...virtualLesson, status: 'scheduled' };
  const decision2 = getCancelledSlotReuseDecision(cancelledLesson, [cancelledLesson, staleVirtualDuplicate], NOW);
  assertEqual(decision2.hasActiveReplacement, false, 'un duplicado virtual sin freedByLessonId nunca se confunde con un reemplazo real');
  assertEqual(decision2.reason, 'eligible', `razón real: ${decision2.reason}`);
});

// ===========================================================================
// Reinicio y restauración: conserva la relación.
// ===========================================================================
test('Reinicio y restauración de respaldo (recorrido real completo, round-trip JSON): conserva la relación cancelada↔reemplazo y la decisión', () => {
  const rule = makeRule({ recurrenceId: 'rec-restore' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessons = upsertMaterializedOccurrence([], mutation.lesson);
  const exceptions = mutation.exception ? [mutation.exception] : [];

  // Round-trip JSON completo — simula cerrar la app y restaurar el backup.
  const restored: { lessons: CalendarLesson[]; exceptions: RecurrenceException[]; rules: RecurrenceRule[] } = JSON.parse(
    JSON.stringify({ lessons, exceptions, rules: [rule] })
  );

  const generatedLessons = computeGeneratedLessons(restored.rules, restored.exceptions, restored.lessons, RANGE_START, RANGE_END, studentById);
  const tappedLesson = restored.lessons.find(
    (lesson) => lesson.recurrenceOccurrenceKey === targetOccurrence!.occurrenceKey
  )!;
  const decision = getCancelledSlotReuseDecision(tappedLesson, [...restored.lessons, ...generatedLessons], NOW);
  assertEqual(decision.reason, 'eligible', `tras restaurar, razón real: ${decision.reason}`);
  assertEqual(decision.status, 'cancelled', 'sigue cancelada tras restaurar');
});

// ===========================================================================
// Consistencia: isEligibleForCancelledSlotReuse (wrapper) y
// getCancelledSlotReuseDecision (fuente única) nunca discrepan.
// ===========================================================================
test('isEligibleForCancelledSlotReuse coincide exactamente con getCancelledSlotReuseDecision().eligible en todos los casos anteriores', () => {
  const rule = makeRule({ recurrenceId: 'rec-consistency' });
  const occurrences = generateOccurrences(rule, RANGE_START, RANGE_END);
  const targetOccurrence = occurrences.find((occurrence) => occurrence.start.startsWith('2026-08-22'));
  const virtualLesson = buildLessonFromOccurrence(targetOccurrence!, student);
  const mutation = buildCancelledCalendarLessonMutation(virtualLesson);
  const lessons = upsertMaterializedOccurrence([], mutation.lesson);
  const decision = getCancelledSlotReuseDecision(lessons[0], lessons, NOW);
  assertEqual(isEligibleForCancelledSlotReuse(lessons[0], lessons, NOW), decision.eligible, 'nunca hay dos fuentes de verdad que puedan discrepar');
});
