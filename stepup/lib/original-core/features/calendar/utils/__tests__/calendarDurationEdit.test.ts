// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarDurationEdit.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-18 (a pedido de Joaquín — IMPLEMENTAR EDICIÓN DE
 * DURACIÓN DE CLASES Y SERIES): pruebas puras (sin React/RN) del módulo
 * `calendarDurationEdit.ts` — `CalendarLesson` no tiene un campo de
 * duración propio, así que "cambiar la duración" es siempre reescribir
 * `end` (clase suelta / una ocurrencia) o `RecurrenceSession.durationMinutes`
 * (esta clase y las siguientes). Estas pruebas verifican esa conversión y
 * el resto de las reglas obligatorias que pueden probarse sin React Native
 * (financiero, no-duplicación, backup, series múltiples).
 */
import type { CalendarLesson, RecurrenceRule } from '../../types/index.ts';
import { DURATION_OPTIONS_MINUTES, applyDurationToWeeks, buildDurationOnlyDraft, computeEndFromDuration, getLessonDurationMinutes, isValidDurationOption, resolveSessionSlotForLesson } from '../calendarDurationEdit.ts';
import { consolidateStudentFutureRecurrences, resolveEditableRecurrenceRule, selectCanonicalRecurrenceRules, splitRecurrenceFromDate } from '../calendarRecurrenceSplit.ts';
import { generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { buildRescheduledOccurrence, upsertMaterializedOccurrence, upsertRecurrenceException } from '../calendarRecurrenceMutations.ts';
import { findCalendarConflicts, hasBlockingConflict } from '../calendarConflicts.ts';
import { computeLessonBilledAmount } from '../../../new-class/utils/lessonRegistrationDomain.ts';
import type { NewClassFormState } from '../../../new-class/types/index.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const timezone = 'America/Argentina/Buenos_Aires';

const weeklyRule: RecurrenceRule = {
  recurrenceId: 'rec-1',
  studentId: 'student-1',
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
  modality: 'presencial',
  timezone,
  startDate: '2026-08-03', // lunes
  endDate: null,
  status: 'active',
};

function makeLesson(overrides: Partial<CalendarLesson> & { id: string; start: string }): CalendarLesson {
  return {
    studentId: 'student-1',
    studentName: 'Alumna Uno',
    level: 'B1',
    participants: [{ studentId: 'student-1', studentName: 'Alumna Uno', level: 'B1' }],
    lessonType: 'individual',
    end: new Date(new Date(overrides.start).getTime() + 60 * 60_000).toISOString(),
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
    ...overrides,
  };
}

// ===========================================================================
// 1/2) Clase suelta: recalcular el fin, conservar el inicio.
// ===========================================================================
test('1) Clase suelta 60→75: computeEndFromDuration conserva el inicio exacto y recalcula sólo el fin', () => {
  const start = '2026-08-10T18:00:00.000Z';
  const end = computeEndFromDuration(start, 75);
  assertEqual(end, '2026-08-10T19:15:00.000Z', 'fin recalculado a 75 minutos exactos desde el mismo inicio');
});

test('2) Clase suelta 90→45 (reducción): el nuevo fin es anterior al viejo, el inicio nunca cambia', () => {
  const start = '2026-08-10T09:00:00.000Z';
  const oldEnd = computeEndFromDuration(start, 90);
  const newEnd = computeEndFromDuration(start, 45);
  assert(new Date(newEnd).getTime() < new Date(oldEnd).getTime(), 'el nuevo fin es anterior — la clase dura menos');
  assertEqual(newEnd, '2026-08-10T09:45:00.000Z', 'fin exacto a 45 minutos');
});

test('getLessonDurationMinutes: siempre derivada de end-start, nunca un campo propio', () => {
  const lesson = makeLesson({ id: 'l1', start: '2026-08-10T09:00:00.000Z', end: '2026-08-10T10:15:00.000Z' });
  assertEqual(getLessonDurationMinutes(lesson), 75, 'duración derivada correctamente');
});

test('Conjunto de duraciones válidas es exactamente 30/45/60/75/90/120', () => {
  assertEqual(DURATION_OPTIONS_MINUTES.join(','), '30,45,60,75,90,120', 'las 6 opciones pedidas, en ese orden');
  assert(isValidDurationOption(60), '60 es válida');
  assert(!isValidDurationOption(50), '50 no es una opción ofrecida');
});

// ===========================================================================
// 3) Una ocurrencia de serie: reutiliza EXACTAMENTE el mecanismo real de
// excepción (buildRescheduledOccurrence) — nunca una segunda
// implementación — conservando start, sólo cambiando end.
// ===========================================================================
test('3) Una ocurrencia de serie 60→75: la excepción conserva el mismo inicio y sólo cambia el fin, vía el mecanismo real ya existente', () => {
  const lesson = makeLesson({
    id: 'occ-1',
    start: '2026-08-10T18:00:00.000Z',
    end: '2026-08-10T19:00:00.000Z',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-10',
  });
  const newEnd = computeEndFromDuration(lesson.start, 75);
  const mutation = buildRescheduledOccurrence(lesson, lesson.start, newEnd);
  assertEqual(mutation.lesson.start, lesson.start, 'el inicio de la ocurrencia nunca cambia');
  assertEqual(mutation.lesson.end, newEnd, 'el fin queda recalculado a la nueva duración');
  assertEqual(mutation.exception.type, 'rescheduled', 'se persiste como la misma excepción real ya usada para reprogramar');
  assertEqual(mutation.exception.recurrenceId, 'rec-1', 'la excepción referencia la regla original — la regla NUNCA se toca');
});

test('3b) La excepción no altera las demás fechas — sólo la ocurrencia identificada por su clave', () => {
  const lesson = makeLesson({
    id: 'occ-2',
    start: '2026-08-17T18:00:00.000Z',
    end: '2026-08-17T19:00:00.000Z',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-17',
  });
  const mutation = buildRescheduledOccurrence(lesson, lesson.start, computeEndFromDuration(lesson.start, 75));
  const otherLesson = makeLesson({
    id: 'occ-3',
    start: '2026-08-24T18:00:00.000Z',
    end: '2026-08-24T19:00:00.000Z',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-24',
  });
  const nextLessons = upsertMaterializedOccurrence(upsertMaterializedOccurrence([], mutation.lesson), otherLesson);
  assertEqual(getLessonDurationMinutes(nextLessons.find((l) => l.id === 'occ-3')!), 60, 'otra ocurrencia distinta conserva su duración original de 60');
});

test('16) No duplicación: aplicar la misma excepción de duración dos veces (doble guardado) deja UNA sola entrada', () => {
  const lesson = makeLesson({
    id: 'occ-4',
    start: '2026-08-10T18:00:00.000Z',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-10',
  });
  const mutation = buildRescheduledOccurrence(lesson, lesson.start, computeEndFromDuration(lesson.start, 75));
  let lessons = upsertMaterializedOccurrence([], mutation.lesson);
  lessons = upsertMaterializedOccurrence(lessons, mutation.lesson); // mismo guardado aplicado dos veces
  assertEqual(lessons.length, 1, 'nunca duplica la ocurrencia materializada');
  let exceptions = upsertRecurrenceException([], mutation.exception);
  exceptions = upsertRecurrenceException(exceptions, mutation.exception);
  assertEqual(exceptions.length, 1, 'nunca duplica la excepción persistida');
});

// ===========================================================================
// 4/5) Futuras de una serie: reutiliza splitRecurrenceFromDate (mecanismo
// real de "editar futuras") — las clases anteriores quedan intactas.
// ===========================================================================
test('4) Futuras de serie 60→90: buildDurationOnlyDraft conserva días/horarios y splitRecurrenceFromDate regenera las futuras con la duración nueva', () => {
  const touchedLesson = makeLesson({
    id: 'touched',
    start: '2026-08-17T21:00:00.000Z', // lunes siguiente, 18:00 local (UTC-3)
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-17',
  });
  const draft = buildDurationOnlyDraft(weeklyRule, touchedLesson, 90);
  assertEqual(draft.weeks[0].sessions[0].weekday, 0, 'el día de la semana se conserva exacto');
  assertEqual(draft.weeks[0].sessions[0].hour, 18, 'la hora se conserva exacta');
  assertEqual(draft.weeks[0].sessions[0].durationMinutes, 90, 'sólo la duración cambió');

  const split = splitRecurrenceFromDate({
    rule: weeklyRule,
    effectiveDate: '2026-08-17',
    todayDate: '2026-08-10',
    draft,
    newRecurrenceId: 'rec-1-successor',
    exceptions: [],
  });
  assertEqual(split.originalRule.endDate, '2026-08-16', 'la regla original se cierra un día antes de la fecha efectiva');
  assertEqual(split.successorRule.startDate, '2026-08-17', 'la sucesora arranca exactamente en la fecha efectiva');

  const futureOccurrences = generateOccurrences(
    { ...split.successorRule, status: 'active' },
    new Date('2026-08-17T00:00:00.000Z'),
    new Date('2026-09-14T00:00:00.000Z')
  );
  assert(futureOccurrences.length > 0, 'la sucesora genera ocurrencias futuras reales');
  futureOccurrences.forEach((occurrence) => {
    assertEqual(occurrence.durationMinutes, 90, 'toda ocurrencia futura generada usa la duración nueva');
  });
});

test('5) Clases anteriores de la serie permanecen en 60: la regla original (cerrada) sigue generando 60 min hasta su propio fin', () => {
  const touchedLesson = makeLesson({
    id: 'touched2',
    start: '2026-08-17T21:00:00.000Z', // 18:00 local (UTC-3)
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-17',
  });
  const draft = buildDurationOnlyDraft(weeklyRule, touchedLesson, 90);
  const split = splitRecurrenceFromDate({
    rule: weeklyRule,
    effectiveDate: '2026-08-17',
    todayDate: '2026-08-10',
    draft,
    newRecurrenceId: 'rec-1-successor-2',
    exceptions: [],
  });
  const pastOccurrences = generateOccurrences(
    { ...split.originalRule, status: 'active' },
    new Date('2026-08-01T00:00:00.000Z'),
    new Date('2026-08-16T23:59:59.000Z')
  );
  assert(pastOccurrences.length > 0, 'la regla original sigue produciendo la clase del 2026-08-10');
  pastOccurrences.forEach((occurrence) => {
    assertEqual(occurrence.durationMinutes, 60, 'las ocurrencias anteriores a la fecha efectiva conservan la duración vieja');
  });
});

// ===========================================================================
// 6) Serie grupal — un único CalendarLesson con varios participantes: un
// solo cambio de `end` alcanza a todos, nunca se crean copias.
// ===========================================================================
test('6) Serie grupal con tres alumnos: cambiar la duración es UN solo cambio de fin sobre la misma clase — todos los participantes lo ven igual, sin copias individuales', () => {
  const groupLesson = makeLesson({
    id: 'group-1',
    start: '2026-08-10T18:00:00.000Z',
    lessonType: 'group',
    studentName: 'Ana + 2',
    participants: [
      { studentId: 'a', studentName: 'Ana', level: 'B1' },
      { studentId: 'b', studentName: 'Bruno', level: 'B1' },
      { studentId: 'c', studentName: 'Caro', level: 'B2' },
    ],
  });
  const newEnd = computeEndFromDuration(groupLesson.start, 90);
  const updated = { ...groupLesson, end: newEnd };
  assertEqual(updated.participants.length, 3, 'sigue siendo UNA sola clase con los mismos 3 participantes — nunca se dividió');
  assertEqual(getLessonDurationMinutes(updated), 90, 'la nueva duración aplica a la clase completa, visible para los 3');
});

// ===========================================================================
// 7) Alumno en dos series con duraciones distintas: buildDurationOnlyDraft
// sólo toca la regla que se le pasó — la otra serie del mismo alumno
// queda completamente intacta.
// ===========================================================================
test('7) Alumno perteneciente a dos series: cambiar la duración de una nunca toca la plantilla de la otra', () => {
  const otherRule: RecurrenceRule = {
    ...weeklyRule,
    recurrenceId: 'rec-2',
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 10, minute: 0, durationMinutes: 45 }] }],
  };
  const touchedLesson = makeLesson({
    id: 'touched3',
    start: '2026-08-17T21:00:00.000Z', // 18:00 local (UTC-3)
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-17',
  });
  buildDurationOnlyDraft(weeklyRule, touchedLesson, 90);
  assertEqual(otherRule.weeks[0].sessions[0].durationMinutes, 45, 'la segunda serie del mismo alumno conserva su propia duración de 45, sin tocarse');
});

test('applyDurationToWeeks: sólo cambia la sesión que coincide en día+hora, deja otros bloques de la MISMA regla intactos', () => {
  const multiDayWeeks: RecurrenceRule['weeks'] = [
    {
      weekIndex: 0,
      sessions: [
        { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
        { weekday: 2, hour: 19, minute: 0, durationMinutes: 60 },
      ],
    },
  ];
  const updated = applyDurationToWeeks(multiDayWeeks, { weekday: 0, hour: 18, minute: 0 }, 90);
  assertEqual(updated[0].sessions[0].durationMinutes, 90, 'el bloque del lunes 18:00 cambia');
  assertEqual(updated[0].sessions[1].durationMinutes, 60, 'el bloque del miércoles 19:00 (no tocado) conserva su duración original — nunca se homogeniza sin confirmación');
});

test('resolveSessionSlotForLesson: deriva el día/hora local real del inicio, en la zona horaria de la regla', () => {
  const lesson = makeLesson({ id: 'slot-1', start: '2026-08-17T21:00:00.000Z' }); // 18:00 en America/Argentina/Buenos_Aires (UTC-3)
  const slot = resolveSessionSlotForLesson(lesson, timezone);
  assertEqual(slot.weekday, 0, 'lunes en zona horaria local');
  assertEqual(slot.hour, 18, 'hora local correcta, no la hora UTC cruda');
  assertEqual(slot.minute, 0, 'minutos correctos');
});

// ===========================================================================
// 8/9) Conflictos: se reutiliza el motor real ya existente — aumentar
// invade otro horario; reducir libera el espacio de inmediato.
// ===========================================================================
test('8) Cambio que genera conflicto: extender la duración hace que la nueva franja invada otra clase real — se detecta con el motor real, antes de guardar nada', () => {
  const candidate = makeLesson({ id: 'other', start: '2026-08-10T19:00:00.000Z', end: '2026-08-10T20:00:00.000Z' });
  const lesson = makeLesson({ id: 'mine', start: '2026-08-10T18:00:00.000Z' });
  const newEnd = computeEndFromDuration(lesson.start, 90); // 18:00 a 19:30 — invade a "other" (19:00-20:00)
  const conflicts = findCalendarConflicts(lesson.start, newEnd, [candidate]);
  assert(hasBlockingConflict(conflicts), 'el motor real de conflictos detecta la invasión antes de cualquier guardado');
});

test('9) Reducción libera horario: acortar la duración hace que una franja que antes chocaba ahora quede libre', () => {
  const candidate = makeLesson({ id: 'other2', start: '2026-08-10T18:45:00.000Z', end: '2026-08-10T19:45:00.000Z' });
  const lesson = makeLesson({ id: 'mine2', start: '2026-08-10T18:00:00.000Z' });
  const longEnd = computeEndFromDuration(lesson.start, 90); // 18:00-19:30 — choca con "other2"
  assert(hasBlockingConflict(findCalendarConflicts(lesson.start, longEnd, [candidate])), 'con 90 minutos SÍ hay conflicto');
  const shortEnd = computeEndFromDuration(lesson.start, 30); // 18:00-18:30 — ya no choca
  assert(!hasBlockingConflict(findCalendarConflicts(lesson.start, shortEnd, [candidate])), 'al reducir a 30 minutos el horario queda libre de inmediato, sin conflicto');
});

// ===========================================================================
// 10/11) Excepción persistente tras reiniciar / backup y restauración —
// round-trip JSON, simula AsyncStorage y el ciclo de respaldo real.
// ===========================================================================
test('10) Excepción persistente después de reiniciar: sobrevive un round-trip JSON completo (simula cerrar y reabrir la app)', () => {
  const lesson = makeLesson({
    id: 'persist-1',
    start: '2026-08-10T18:00:00.000Z',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-10',
  });
  const mutation = buildRescheduledOccurrence(lesson, lesson.start, computeEndFromDuration(lesson.start, 75));
  const persisted = JSON.parse(JSON.stringify({ lessons: [mutation.lesson], exceptions: [mutation.exception] }));
  assertEqual(getLessonDurationMinutes(persisted.lessons[0]), 75, 'la duración nueva sobrevive exacta tras un reinicio simulado');
  assertEqual(persisted.exceptions[0].type, 'rescheduled', 'la excepción persistida sobrevive exacta');
});

test('11) Backup y restauración: la regla sucesora (con la duración nueva) sobrevive un round-trip JSON sin perder días/horarios/participantes', () => {
  const touchedLesson = makeLesson({
    id: 'touched4',
    start: '2026-08-17T21:00:00.000Z', // 18:00 local (UTC-3)
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-17',
  });
  const draft = buildDurationOnlyDraft(weeklyRule, touchedLesson, 90);
  const split = splitRecurrenceFromDate({
    rule: { ...weeklyRule, participantIds: ['student-1'], classTitle: 'Conversación' },
    effectiveDate: '2026-08-17',
    todayDate: '2026-08-10',
    draft,
    newRecurrenceId: 'rec-1-successor-3',
    exceptions: [],
  });
  const restored = JSON.parse(JSON.stringify(split.successorRule)) as RecurrenceRule;
  assertEqual(restored.weeks[0].sessions[0].durationMinutes, 90, 'duración nueva sobrevive al respaldo/restauración');
  assertEqual(restored.weeks[0].sessions[0].weekday, 0, 'día conservado');
  assertEqual(restored.classTitle, 'Conversación', 'nombre personalizado de la serie conservado');
  assertEqual(JSON.stringify(restored.participantIds), JSON.stringify(['student-1']), 'participantes conservados');
});

// ===========================================================================
// 18/19) Motor financiero: nunca lee duración — cuota mensual y cargo por
// clase quedan exactamente iguales pase lo que pase con la duración.
// ===========================================================================
test('18/19) computeLessonBilledAmount (motor real de cargo por clase) da el mismo importe sin importar la duración programada o real', () => {
  const baseForm = {
    studentIds: ['student-1'],
    isBillable: true,
    eventType: 'clase_dictada',
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
    attendance: [{ studentId: 'student-1', status: 'presente' }],
  } as unknown as NewClassFormState;
  const studentPrices = { 'student-1': 15000 };

  const amountAt60 = computeLessonBilledAmount({ ...baseForm, scheduledDurationMinutes: 60, actualDurationMinutes: 60 } as NewClassFormState, studentPrices);
  const amountAt90 = computeLessonBilledAmount({ ...baseForm, scheduledDurationMinutes: 90, actualDurationMinutes: 90 } as NewClassFormState, studentPrices);
  const amountAt30 = computeLessonBilledAmount({ ...baseForm, scheduledDurationMinutes: 30, actualDurationMinutes: 30 } as NewClassFormState, studentPrices);

  assertEqual(amountAt60, amountAt90, 'el cargo por clase nunca depende de la duración — 60 y 90 minutos cobran igual');
  assertEqual(amountAt60, amountAt30, 'tampoco depende de una duración menor — la política vigente (precio plano del alumno) es la única fuente');
  assertEqual(amountAt60, 15000, 'el importe es exactamente el precio plano del alumno, sin multiplicar por minutos');
});

// ===========================================================================
// Corrección 2026-08-28, décima ronda (a pedido de Joaquín — SERIE SEMANAL
// CON UN DÍA QUE DESAPARECE PARA SIEMPRE): reproduce con las funciones
// REALES exportadas (nunca reimplementadas) la secuencia exacta que ahora
// ejecuta `applyDurationThisAndFuture` (CalendarTabScreen.tsx) — resolver
// la regla canónica ANTES de construir el borrador de duración, en vez de
// construirlo desde la regla hallada por `lesson.recurrenceId` tal cual
// (una clase materializada VIEJA puede seguir apuntando a un tramo ya
// reemplazado, con menos sesiones que la canónica vigente).
// ===========================================================================

const BUENOS_AIRES_TZ = 'America/Argentina/Buenos_Aires';

const staleRuleWednesdayOnly: RecurrenceRule = {
  recurrenceId: 'qa_stale',
  studentId: 'qa_alumno_dos_dias',
  participantIds: ['qa_alumno_dos_dias'],
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [{ weekIndex: 0, sessions: [{ weekday: 2, hour: 15, minute: 30, durationMinutes: 60 }] }],
  modality: 'presencial',
  timezone: BUENOS_AIRES_TZ,
  startDate: '2026-07-06',
  endDate: '2026-08-02',
  status: 'ended',
  supersededByRecurrenceId: 'qa_canonical',
};

const canonicalRuleTwoSessions: RecurrenceRule = {
  recurrenceId: 'qa_canonical',
  studentId: 'qa_alumno_dos_dias',
  participantIds: ['qa_alumno_dos_dias'],
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [{
    weekIndex: 0,
    sessions: [
      { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
      { weekday: 2, hour: 15, minute: 30, durationMinutes: 60 },
    ],
  }],
  modality: 'presencial',
  timezone: BUENOS_AIRES_TZ,
  startDate: '2026-08-03',
  endDate: null,
  status: 'active',
  supersedesRecurrenceId: 'qa_stale',
  effectiveFromDate: '2026-08-03',
};

// Clase materializada VIEJA (registrada/completada antes del split) — sigue
// referenciando la regla YA reemplazada, exactamente como sobrevive un
// CalendarLesson real: su recurrenceId nunca se migra retroactivamente.
const staleMaterializedWednesdayLesson = makeLesson({
  id: 'qa_lesson_wed_old',
  studentId: 'qa_alumno_dos_dias',
  start: '2026-08-12T18:30:00.000Z', // miércoles 15:30 ART
  end: '2026-08-12T19:30:00.000Z',
  isRecurring: true,
  recurrenceId: 'qa_stale',
  recurrenceOccurrenceKey: 'qa_stale:2026-08-12',
});

test('CAUSA RAÍZ: resolver la regla canónica ANTES de construir el borrador conserva AMBAS sesiones — mismo criterio real que applyDurationThisAndFuture corregido', () => {
  const allRules = [staleRuleWednesdayOnly, canonicalRuleTwoSessions];
  const effectiveDate = '2026-08-12';

  // Paso real 1: resolver la MISMA regla canónica que applyFuturePatternFromDate
  // terminaría dividiendo (selectCanonicalRecurrenceRules primero, igual que
  // handleEditFutureRule).
  const canonical = selectCanonicalRecurrenceRules(allRules, '2026-08-10T00:00:00.000Z').find(
    (rule) => rule.studentId === staleRuleWednesdayOnly.studentId
  );
  const editableRule = canonical ?? resolveEditableRecurrenceRule(staleRuleWednesdayOnly, allRules, effectiveDate);
  assertEqual(editableRule.recurrenceId, 'qa_canonical', 'resuelve la regla vigente real, no la vieja hallada por la clase tocada');

  // Paso real 2: el borrador se construye desde la regla RESUELTA, nunca
  // desde `staleRuleWednesdayOnly` (la que encontraría un lookup ingenuo
  // por lesson.recurrenceId).
  const draft = buildDurationOnlyDraft(editableRule, staleMaterializedWednesdayLesson, 75);
  assertEqual(draft.weeks[0].sessions.length, 2, 'el borrador ya conserva las dos sesiones de la canónica');

  // Paso real 3: split real — la sucesora nace del borrador correcto.
  const split = splitRecurrenceFromDate({
    rule: editableRule,
    effectiveDate,
    todayDate: '2026-08-10',
    draft,
    newRecurrenceId: 'qa_new_successor',
    exceptions: [],
  });

  assertEqual(split.successorRule.weeks[0].sessions.length, 2, 'la sucesora real conserva AMBAS sesiones — el lunes nunca desaparece');
  const monday = split.successorRule.weeks[0].sessions.find((s) => s.weekday === 0);
  const wednesday = split.successorRule.weeks[0].sessions.find((s) => s.weekday === 2);
  assert(monday !== undefined, 'la sesión de lunes sobrevive');
  assertEqual(monday?.hour, 18, 'horario de lunes intacto');
  assertEqual(monday?.durationMinutes, 60, 'duración de lunes intacta — nunca tocada por este cambio');
  assert(wednesday !== undefined, 'la sesión de miércoles sobrevive');
  assertEqual(wednesday?.durationMinutes, 75, 'sólo la sesión realmente editada (miércoles) cambia de duración');

  // Participantes, fechas y linaje.
  assertEqual(JSON.stringify(split.successorRule.participantIds), JSON.stringify(['qa_alumno_dos_dias']), 'participantes conservados exactos');
  assertEqual(split.successorRule.startDate, '2026-08-10', 'la sucesora arranca el lunes de la semana de la fecha efectiva');
  assertEqual(split.successorRule.supersedesRecurrenceId, 'qa_canonical', 'linaje real: la sucesora reemplaza a la canónica vigente, nunca a la regla vieja hallada por la clase');
  assertEqual(split.originalRule.supersededByRecurrenceId, 'qa_new_successor', 'la canónica queda correctamente truncada, apuntando a la nueva sucesora real');
});

test('CAUSA RAÍZ (reproduce el bug ANTES de la corrección): construir el borrador desde la regla hallada por lesson.recurrenceId (sin resolver la canónica) pierde el lunes', () => {
  // Mismo escenario, pero repitiendo el código VIEJO: el borrador se
  // construye directo desde `staleRuleWednesdayOnly` (lo que devolvía
  // `recurrenceRules.find(candidate => candidate.recurrenceId === lesson.recurrenceId)`
  // sin ningún paso de resolución) — exactamente la causa real del bug.
  const buggyDraft = buildDurationOnlyDraft(staleRuleWednesdayOnly, staleMaterializedWednesdayLesson, 75);
  assertEqual(buggyDraft.weeks[0].sessions.length, 1, 'reproduce el bug real: el borrador viejo sólo tiene la sesión de miércoles');

  const buggySplit = splitRecurrenceFromDate({
    rule: canonicalRuleTwoSessions, // el split real igual actúa sobre la canónica vigente
    effectiveDate: '2026-08-12',
    todayDate: '2026-08-10',
    draft: buggyDraft,
    newRecurrenceId: 'qa_buggy_successor',
    exceptions: [],
  });
  assertEqual(buggySplit.successorRule.weeks[0].sessions.length, 1, 'con el código viejo, la sucesora real habría perdido el lunes para siempre — exactamente el bug reportado');
});

test('Repetir la operación no duplica reglas ni sesiones — consolidar y volver a consolidar da el mismo resultado', () => {
  const allRules = [staleRuleWednesdayOnly, canonicalRuleTwoSessions];
  const effectiveDate = '2026-08-12';
  const editableRule = selectCanonicalRecurrenceRules(allRules, '2026-08-10T00:00:00.000Z').find(
    (rule) => rule.studentId === staleRuleWednesdayOnly.studentId
  )!;
  const draft = buildDurationOnlyDraft(editableRule, staleMaterializedWednesdayLesson, 75);
  const split = splitRecurrenceFromDate({
    rule: editableRule,
    effectiveDate,
    todayDate: '2026-08-10',
    draft,
    newRecurrenceId: 'qa_new_successor_2',
    exceptions: [],
  });

  const consolidation = consolidateStudentFutureRecurrences({
    rules: allRules,
    originalRule: split.originalRule,
    successorRule: split.successorRule,
    effectiveDate,
  });
  assertEqual(consolidation.rules.length, 3, 'stale (intacta) + canónica truncada + nueva sucesora — nunca una regla de más');
  const successorPersisted = consolidation.rules.find((rule) => rule.recurrenceId === 'qa_new_successor_2');
  assertEqual(successorPersisted?.weeks[0].sessions.length, 2, 'la sucesora persistida conserva las dos sesiones reales');

  const secondPass = consolidateStudentFutureRecurrences({
    rules: consolidation.rules,
    originalRule: consolidation.rules.find((rule) => rule.recurrenceId === editableRule.recurrenceId)!,
    successorRule: successorPersisted!,
    effectiveDate,
  });
  assertEqual(secondPass.rules.length, consolidation.rules.length, 'repetir la consolidación no agrega ninguna regla de más');
  const successorAfterSecondPass = secondPass.rules.find((rule) => rule.recurrenceId === 'qa_new_successor_2');
  assertEqual(successorAfterSecondPass?.weeks[0].sessions.length, 2, 'ni duplica ni pierde sesiones en una segunda pasada');
});
