// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceEngine.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../../students/types/index.ts';
import type { RecurrenceRule } from '../../types/index.ts';
import { applyExceptionsToOccurrences, buildLessonFromOccurrence, buildOccurrenceKey, generateOccurrences, PENDING_ASSIGNMENT_SERIES_LABEL, resolveOccurrenceParticipants } from '../calendarRecurrenceEngine.ts';
import { assert, assertEqual, test } from './testHarness.ts';

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
    recurrenceId: 'rule-1',
    studentId: student.id,
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [
      {
        weekIndex: 0,
        sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }],
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

test('occurrenceKey es determinística y distingue sesiones', () => {
  const base = {
    recurrenceId: 'r',
    absoluteWeekNumber: 0,
    weekIndexInCycle: 0,
    weekday: 0,
    hour: 18,
    minute: 0,
    sessionIndex: 0,
  };
  const first = buildOccurrenceKey(base);
  assertEqual(buildOccurrenceKey(base), first, 'misma entrada');
  assert(buildOccurrenceKey({ ...base, sessionIndex: 1 }) !== first, 'sesión distinta');
});

test('genera una recurrencia semanal fija', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-08-03T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 4, 'cuatro lunes');
  assertEqual(occurrences[0].start, '2026-07-13T21:00:00.000Z', 'primer lunes');
  assert(occurrences.every((item) => item.weekday === 0), 'todos son lunes');
});

test('genera varios días con horarios distintos', () => {
  const occurrences = generateOccurrences(
    rule({
      weeks: [
        {
          weekIndex: 0,
          sessions: [
            { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 },
            { weekday: 2, hour: 16, minute: 30, durationMinutes: 45 },
          ],
        },
      ],
    }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-19T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 2, 'dos sesiones');
  assertEqual(occurrences[1].start, '2026-07-15T19:30:00.000Z', 'miércoles');
});

test('alterna lunes y martes en un ciclo de dos semanas', () => {
  const occurrences = generateOccurrences(
    rule({
      type: 'custom',
      cycleLengthWeeks: 2,
      weeks: [
        { weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] },
        { weekIndex: 1, sessions: [{ weekday: 1, hour: 17, minute: 0, durationMinutes: 60 }] },
      ],
    }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-08-10T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 5, 'cinco ocurrencias');
  assertEqual(occurrences[0].weekday, 0, 'semana 1 lunes');
  assertEqual(occurrences[1].weekday, 1, 'semana 2 martes');
  assertEqual(occurrences[2].weekday, 0, 'repite lunes');
});

test('respeta ciclos de tres y cuatro semanas', () => {
  ([3, 4] as const).forEach((cycleLengthWeeks) => {
    const weeks = Array.from({ length: cycleLengthWeeks }, (_, weekIndex) => ({
      weekIndex,
      sessions: [{ weekday: weekIndex as 0 | 1 | 2 | 3, hour: 10, minute: 0, durationMinutes: 60 }],
    }));
    const occurrences = generateOccurrences(
      rule({ type: 'custom', cycleLengthWeeks, weeks }),
      new Date('2026-07-13T00:00:00.000Z'),
      new Date(`2026-08-${cycleLengthWeeks === 3 ? '02' : '09'}T23:59:59.999Z`)
    );
    assertEqual(occurrences.length, cycleLengthWeeks, `ciclo ${cycleLengthWeeks}`);
  });
});

test('aplica exclusión, cancelación y materialización sin duplicar', () => {
  const occurrences = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-27T23:59:59.999Z')
  );
  const materialized = buildLessonFromOccurrence(occurrences[0], student);
  const applied = applyExceptionsToOccurrences(
    [...occurrences, occurrences[0]],
    [
      {
        occurrenceKey: occurrences[1].occurrenceKey,
        recurrenceId: occurrences[1].recurrenceId,
        type: 'cancelled',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
      {
        occurrenceKey: occurrences[2].occurrenceKey,
        recurrenceId: occurrences[2].recurrenceId,
        type: 'excluded',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    [materialized]
  );
  assertEqual(applied.length, 2, 'sin excluida ni duplicado');
  assertEqual(applied[0].materializationStatus, 'materialized', 'materializada');
  assertEqual(applied[1].materializationStatus, 'cancelled', 'cancelada');
});

test('endDate trunca futuras sin afectar las anteriores', () => {
  const occurrences = generateOccurrences(
    rule({ endDate: '2026-07-20' }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-08-31T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 2, 'solo hasta la fecha final');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-20 (a pedido de Joaquín — agendar series sin
// alumnos): una RecurrenceRule ya no exige studentId — una serie puede
// reservar el horario ("Serie sin alumnos") y recibir su alumno después,
// mismo criterio ya aprobado para una clase suelta.
// ---------------------------------------------------------------------------

test('una regla con studentId vacío genera ocurrencias igual (Serie sin alumnos no rompe el motor)', () => {
  const occurrences = generateOccurrences(
    rule({ studentId: '' }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-27T23:59:59.999Z')
  );
  assertEqual(occurrences.length, 3, 'genera igual que con un alumno real');
  occurrences.forEach((occurrence) => {
    assertEqual(occurrence.studentId, '', 'la ocurrencia hereda el studentId vacío de la regla');
  });
});

test('buildLessonFromOccurrence con student=null produce "Serie sin alumnos" pendiente de asignar', () => {
  const [occurrence] = generateOccurrences(
    rule({ studentId: '' }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const lesson = buildLessonFromOccurrence(occurrence, null);

  assertEqual(lesson.studentId, '', 'sin alumno asignado');
  assertEqual(lesson.studentName, PENDING_ASSIGNMENT_SERIES_LABEL, 'texto canónico "Serie sin alumnos"');
  assertEqual(lesson.participants.length, 0, 'sin participantes');
  assert(lesson.isRecurring, 'sigue marcada como recurrente');
  assertEqual(lesson.recurrenceId, occurrence.recurrenceId, 'conserva el recurrenceId');
  assertEqual(
    lesson.recurrenceOccurrenceKey,
    occurrence.occurrenceKey,
    'conserva el occurrenceKey (necesario para materializar después)'
  );
});

test('buildLessonFromOccurrence sigue funcionando igual con un alumno real (sin regresión)', () => {
  const [occurrence] = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const lesson = buildLessonFromOccurrence(occurrence, student);

  assertEqual(lesson.studentId, student.id, 'alumno real asignado');
  assertEqual(lesson.studentName, student.name, 'nombre real, nunca el texto de pendiente');
  assertEqual(lesson.participants.length, 1, 'un participante');
});

test('buildLessonFromOccurrence rechaza un alumno que no coincide con la ocurrencia', () => {
  const [occurrence] = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const otroAlumno: StudentListItem = { ...student, id: 'student-otro' };
  let threw = false;
  try {
    buildLessonFromOccurrence(occurrence, otroAlumno);
  } catch {
    threw = true;
  }
  assert(threw, 'debe rechazar un alumno que no coincide con occurrence.studentId');
});

// ---------------------------------------------------------------------------
// participantIds (Fase "Clase como contenedor", 2026-07-21) — aditivo, nunca
// rompe una serie de un único alumno sin este campo.
// ---------------------------------------------------------------------------

const studentB: StudentListItem = { ...student, id: 'student-2', name: 'Alumno Dos', levels: ['A2'] };
const studentC: StudentListItem = { ...student, id: 'student-3', name: 'Alumno Tres', levels: ['C1'] };

test('una regla SIN participantIds genera ocurrencias con participantIds=[studentId] (compatibilidad)', () => {
  const [occurrence] = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  assertEqual(occurrence.participantIds.length, 1, 'un único participante heredado de studentId');
  assertEqual(occurrence.participantIds[0], student.id, 'es el studentId de la regla');
});

test('una regla con participantIds genera ocurrencias con TODOS los participantes de la serie', () => {
  const [occurrence] = generateOccurrences(
    rule({ participantIds: [student.id, studentB.id, studentC.id] }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  assertEqual(occurrence.participantIds.length, 3, 'los tres alumnos de la serie grupal');
  assert(occurrence.participantIds.includes(studentB.id), 'incluye al segundo alumno');
  assert(occurrence.participantIds.includes(studentC.id), 'incluye al tercer alumno');
});

test('una regla sin studentId ni participantIds (serie sin alumnos) genera participantIds vacío', () => {
  const [occurrence] = generateOccurrences(
    rule({ studentId: '' }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  assertEqual(occurrence.participantIds.length, 0, 'ningún participante todavía');
});

test('buildLessonFromOccurrence con additionalParticipants construye una clase grupal, sin perder a nadie', () => {
  const [occurrence] = generateOccurrences(
    rule({ participantIds: [student.id, studentB.id, studentC.id] }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const lesson = buildLessonFromOccurrence(occurrence, student, [studentB, studentC]);
  assertEqual(lesson.participants.length, 3, 'los tres alumnos aparecen en la ocurrencia materializada');
  assertEqual(lesson.lessonType, 'group', 'con más de un participante, se clasifica como clase grupal');
  assertEqual(lesson.studentId, student.id, 'studentId sigue siendo el alumno principal (compatibilidad)');
});

test('buildLessonFromOccurrence sin additionalParticipants (comportamiento previo) sigue siendo individual', () => {
  const [occurrence] = generateOccurrences(
    rule(),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const lesson = buildLessonFromOccurrence(occurrence, student);
  assertEqual(lesson.participants.length, 1, 'un único participante, exactamente como antes');
  assertEqual(lesson.lessonType, 'individual', 'nunca se clasifica como grupal con un solo alumno');
});

test('resolveOccurrenceParticipants: separa el alumno principal del resto y descarta ids que ya no existen', () => {
  const [occurrence] = generateOccurrences(
    rule({ participantIds: [student.id, studentB.id, 'alumno-eliminado'] }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const studentById = new Map([
    [student.id, student],
    [studentB.id, studentB],
    // 'alumno-eliminado' deliberadamente ausente del mapa (fue borrado).
  ]);
  const { primary, additional } = resolveOccurrenceParticipants(occurrence, studentById);
  assertEqual(primary?.id, student.id, 'el principal es siempre occurrence.studentId');
  assertEqual(additional.length, 1, 'sólo el alumno que sigue existiendo, nunca el eliminado');
  assertEqual(additional[0].id, studentB.id, 'es el segundo alumno real');
});

test('resolveOccurrenceParticipants: sin alumno principal (serie sin alumnos), primary es null', () => {
  const [occurrence] = generateOccurrences(
    rule({ studentId: '' }),
    new Date('2026-07-13T00:00:00.000Z'),
    new Date('2026-07-13T23:59:59.999Z')
  );
  const { primary, additional } = resolveOccurrenceParticipants(occurrence, new Map());
  assertEqual(primary, null, 'sin alumno principal asignado todavía');
  assertEqual(additional.length, 0, 'sin participantes adicionales');
});
