// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarClassTitleFromDate.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
 * clase): pruebas de `planClassTitleFromDate` (alcance "Esta y las
 * siguientes") contra la función pura real usada por la app — nunca
 * contra una reimplementación de prueba. Mismo patrón que
 * `calendarParticipantsFromDate.test.ts`, del que este alcance es hermano
 * (misma decisión de Joaquín: nunca `splitRecurrenceFromDate`).
 */
import type { StudentListItem } from '../../../students/types/index.ts';
import type { CalendarLesson, GeneratedOccurrence, RecurrenceException, RecurrenceRule } from '../../types/index.ts';
import { DEFAULT_RECURRENCE_HORIZON_DAYS, generateOccurrences } from '../calendarRecurrenceEngine.ts';
import { planClassTitleFromDate } from '../calendarClassTitleFromDate.ts';
import { assert, assertEqual, assertThrows, test } from './testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

const student: StudentListItem = {
  id: 'student-1',
  name: 'Alumno Uno',
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

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    recurrenceId: 'rule-title',
    studentId: student.id,
    participantIds: [student.id],
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2026-07-13', // lunes
    endDate: null,
    status: 'active',
    classTitle: 'Conversación B2',
    ...overrides,
  };
}

function horizonFrom(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_RECURRENCE_HORIZON_DAYS * 86_400_000);
}

function lessonFromOccurrence(occurrence: GeneratedOccurrence, classTitle: string | undefined): CalendarLesson {
  return {
    id: `calendar_${occurrence.occurrenceKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    studentId: student.id,
    studentName: student.name,
    level: student.levels.join(', '),
    participants: [{ studentId: student.id, studentName: student.name, level: student.levels.join(', ') }],
    lessonType: 'individual',
    start: occurrence.start,
    end: occurrence.end,
    modality: occurrence.modality,
    status: 'scheduled',
    color: '#fff',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: true,
    recurrenceId: occurrence.recurrenceId,
    recurrenceOccurrenceKey: occurrence.occurrenceKey,
    recurrenceIndex: occurrence.absoluteWeekNumber * 100 + occurrence.sessionIndex,
    recurrenceOriginalStart: null,
    classTitle,
  };
}

test('Esta y las siguientes: la ocurrencia elegida y una futura virtual quedan con el título NUEVO', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const selected = occurrences[1]; // 27/07 — la próxima (20/07) queda "antes" de la elegida
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: 'Grupo de los lunes',
    existingLessons: [],
    exceptions: [],
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  assertEqual(plan.nextRule.classTitle, 'Grupo de los lunes', 'la regla canónica queda con el título nuevo');
  const selectedInPlan = plan.lessonsToUpsert.find((lesson) => lesson.recurrenceOccurrenceKey === selected.occurrenceKey);
  assert(selectedInPlan !== undefined, 'la ocurrencia elegida se materializa en el plan');
  assertEqual(selectedInPlan!.classTitle, 'Grupo de los lunes', 'la ocurrencia elegida ya tiene el título nuevo');

  const laterOccurrence = occurrences[2]; // 03/08 — futura respecto de la elegida
  const laterInPlan = plan.lessonsToUpsert.find((lesson) => lesson.recurrenceOccurrenceKey === laterOccurrence.occurrenceKey);
  assert(laterInPlan !== undefined, 'una ocurrencia futura respecto de la elegida también se materializa con el título nuevo');
  assertEqual(laterInPlan!.classTitle, 'Grupo de los lunes', 'la ocurrencia futura queda con el título nuevo');
});

test('Esta y las siguientes: una ocurrencia ANTERIOR a la elegida se "congela" con el título VIEJO, nunca queda con el nuevo', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const earlier = occurrences[0]; // 20/07
  const selected = occurrences[1]; // 27/07
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: 'Grupo de los lunes',
    existingLessons: [],
    exceptions: [],
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  const earlierInPlan = plan.lessonsToUpsert.find((lesson) => lesson.recurrenceOccurrenceKey === earlier.occurrenceKey);
  assert(earlierInPlan !== undefined, 'la ocurrencia anterior se congela como clase real (para que el cambio de regla no la afecte)');
  assertEqual(earlierInPlan!.classTitle, 'Conversación B2', 'la ocurrencia anterior conserva el título VIEJO, nunca el nuevo');
});

test('Esta y las siguientes: una ocurrencia anterior YA materializada con su propio título nunca se toca', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const earlier = occurrences[0]; // 20/07
  const selected = occurrences[1]; // 27/07
  const alreadyMaterialized = lessonFromOccurrence(earlier, 'Título puntual ya elegido antes');
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: 'Grupo de los lunes',
    existingLessons: [alreadyMaterialized],
    exceptions: [],
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  const touchedEarlier = plan.lessonsToUpsert.find((lesson) => lesson.id === alreadyMaterialized.id);
  assert(touchedEarlier === undefined, 'nunca se toca una ocurrencia anterior que ya tenía su propio título persistido');
});

test('Esta y las siguientes: vaciar el título (undefined) restaura el nombre automático desde la fecha elegida en adelante', () => {
  const testRule = rule();
  const now = new Date('2026-07-06T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const selected = occurrences[0]; // 13/07, coincide con el inicio de la serie
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: undefined,
    existingLessons: [],
    exceptions: [],
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  assertEqual(plan.nextRule.classTitle, undefined, 'la regla queda sin título propio (vuelve al nombre automático)');
  const selectedInPlan = plan.lessonsToUpsert.find((lesson) => lesson.recurrenceOccurrenceKey === selected.occurrenceKey);
  assertEqual(selectedInPlan!.classTitle, undefined, 'la ocurrencia elegida queda sin título propio también');
});

test('Esta y las siguientes: una ocurrencia cancelada entre "ahora" y la fecha elegida nunca se revive ni se toca', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const cancelledOccurrence = occurrences[0]; // 20/07
  const selected = occurrences[1]; // 27/07
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const exceptions: RecurrenceException[] = [
    {
      recurrenceId: testRule.recurrenceId,
      occurrenceKey: cancelledOccurrence.occurrenceKey,
      type: 'cancelled',
      createdAt: '2026-07-14T00:00:00.000Z',
    },
  ];

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: 'Grupo de los lunes',
    existingLessons: [],
    exceptions,
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  const touchedCancelled = plan.lessonsToUpsert.find(
    (lesson) => lesson.recurrenceOccurrenceKey === cancelledOccurrence.occurrenceKey
  );
  assert(touchedCancelled === undefined, 'la ocurrencia cancelada nunca aparece en el plan');
});

test('Esta y las siguientes: aplicar el cambio a una clase que ya pasó se rechaza', () => {
  const testRule = rule();
  const now = new Date('2026-07-25T12:00:00.000Z');
  const pastOccurrence: GeneratedOccurrence = {
    occurrenceKey: 'rule-title:w0:c0:d0:t1800:s0',
    recurrenceId: testRule.recurrenceId,
    studentId: student.id,
    participantIds: [student.id],
    absoluteWeekNumber: 0,
    weekIndexInCycle: 0,
    weekday: 0,
    sessionIndex: 0,
    hour: 18,
    minute: 0,
    durationMinutes: 60,
    modality: 'presencial',
    start: '2026-07-13T21:00:00.000Z', // ya pasó respecto de "now"
    end: '2026-07-13T22:00:00.000Z',
    materializationStatus: 'virtual',
    materializedLessonId: null,
    classTitle: testRule.classTitle,
  };
  const targetLesson = lessonFromOccurrence(pastOccurrence, testRule.classTitle);

  assertThrows(
    () =>
      planClassTitleFromDate({
        rule: testRule,
        targetLesson,
        newClassTitle: 'Grupo de los lunes',
        existingLessons: [targetLesson],
        exceptions: [],
        students: [student],
        now,
        horizonEnd: horizonFrom(now),
      }),
    /ya pasó/,
    'rechaza aplicar el cambio a una fecha ya pasada respecto de "ahora"'
  );
});

test('Esta y las siguientes: una clase sin recurrenceOccurrenceKey (no identificable dentro de la serie) se rechaza', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const targetLesson: CalendarLesson = {
    ...lessonFromOccurrence(occurrences[0], testRule.classTitle),
    recurrenceOccurrenceKey: null,
  };

  assertThrows(
    () =>
      planClassTitleFromDate({
        rule: testRule,
        targetLesson,
        newClassTitle: 'Grupo de los lunes',
        existingLessons: [],
        exceptions: [],
        students: [student],
        now,
        horizonEnd: horizonFrom(now),
      }),
    /no pertenece a una repetición identificable/,
    'rechaza una clase sin recurrenceOccurrenceKey'
  );
});

test('Esta y las siguientes: nunca crea una serie sucesora — todo el plan queda bajo el mismo recurrenceId', () => {
  const testRule = rule();
  const now = new Date('2026-07-15T12:00:00.000Z');
  const occurrences = generateOccurrences(testRule, now, horizonFrom(now));
  const selected = occurrences[1];
  const targetLesson = lessonFromOccurrence(selected, testRule.classTitle);

  const plan = planClassTitleFromDate({
    rule: testRule,
    targetLesson,
    newClassTitle: 'Grupo de los lunes',
    existingLessons: [],
    exceptions: [],
    students: [student],
    now,
    horizonEnd: horizonFrom(now),
  });

  assertEqual(plan.nextRule.recurrenceId, testRule.recurrenceId, 'la regla resultante conserva el mismo recurrenceId (decisión de Joaquín: nunca splitRecurrenceFromDate)');
  assert(
    plan.lessonsToUpsert.every((lesson) => lesson.recurrenceId === testRule.recurrenceId),
    'todas las ocurrencias del plan quedan bajo el mismo recurrenceId'
  );
});
