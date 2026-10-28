// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarRecurrenceMutations.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { RecurrenceException, RecurrenceRule } from '../../types/index.ts';
import { buildCancelledOccurrence, buildCancelledCalendarLessonMutation, buildCalendarReservationKey, buildCompletedCalendarLesson, buildDeletedCalendarLessonMutation, buildRescheduledOccurrence, buildRescheduledStandaloneLesson, buildRestoredOccurrence, replaceRecurrenceRule, removeRecurrenceException, upsertMaterializedOccurrence, upsertRecurrenceException } from '../calendarRecurrenceMutations.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const rule: RecurrenceRule = {
  recurrenceId: 'rule-1',
  studentId: 'student-1',
  type: 'weekly',
  cycleLengthWeeks: 1,
  weeks: [
    {
      weekIndex: 0,
      sessions: [{ weekday: 0, hour: 10, minute: 0, durationMinutes: 60 }],
    },
  ],
  modality: 'presencial',
  timezone: 'America/Argentina/Buenos_Aires',
  startDate: '2026-07-13',
  endDate: null,
  status: 'active',
};

test('actualiza una regla existente sin duplicarla', () => {
  const result = replaceRecurrenceRule([rule], { ...rule, status: 'paused' });
  assertEqual(result.length, 1, 'una sola regla');
  assertEqual(result[0].status, 'paused', 'regla pausada');
});

test('una excepción repetida reemplaza la anterior', () => {
  const cancelled: RecurrenceException = {
    occurrenceKey: 'occurrence-1',
    recurrenceId: rule.recurrenceId,
    type: 'cancelled',
    createdAt: '2026-07-13T12:00:00.000Z',
  };
  const rescheduled: RecurrenceException = {
    ...cancelled,
    type: 'rescheduled',
    replacementLessonId: 'replacement-1',
  };
  const result = upsertRecurrenceException([cancelled], rescheduled);
  assertEqual(result.length, 1, 'una sola excepción');
  assertEqual(result[0].type, 'rescheduled', 'última decisión conservada');
});

const virtualLesson = {
  id: 'virtual-1',
  studentId: 'student-1',
  studentName: 'Alumno Uno',
  level: 'B1',
  participants: [{ studentId: 'student-1', studentName: 'Alumno Uno', level: 'B1' }],
  lessonType: 'individual' as const,
  start: '2026-07-20T13:00:00.000Z',
  end: '2026-07-20T14:00:00.000Z',
  modality: 'presencial' as const,
  status: 'scheduled' as const,
  color: '#fff',
  overlapAllowed: false,
  overlapGroupId: null,
  isRecurring: true,
  recurrenceId: 'rule-1',
  recurrenceOccurrenceKey: 'rule-1:w1:c0:d0:t1000:s0',
  recurrenceIndex: 100,
  recurrenceOriginalStart: null,
};

test('cancelar materializa la ocurrencia y crea excepción', () => {
  const mutation = buildCancelledOccurrence(
    virtualLesson,
    '2026-07-13T12:00:00.000Z'
  );
  assertEqual(mutation.lesson.status, 'cancelled', 'clase cancelada');
  assertEqual(mutation.exception.type, 'cancelled', 'excepción cancelada');
  assertEqual(
    mutation.lesson.recurrenceOriginalStart,
    virtualLesson.start,
    'conserva horario original'
  );
});

test('reprogramar conserva occurrenceKey y reemplaza el materializado', () => {
  const first = buildRescheduledOccurrence(
    virtualLesson,
    '2026-07-21T15:00:00.000Z',
    '2026-07-21T16:00:00.000Z'
  );
  const second = buildRescheduledOccurrence(
    virtualLesson,
    '2026-07-22T15:00:00.000Z',
    '2026-07-22T16:00:00.000Z'
  );
  const lessons = upsertMaterializedOccurrence([first.lesson], second.lesson);
  assertEqual(lessons.length, 1, 'un solo reemplazo');
  assertEqual(lessons[0].start, second.lesson.start, 'último horario');
  assertEqual(
    second.lesson.recurrenceOccurrenceKey,
    virtualLesson.recurrenceOccurrenceKey,
    'misma identidad lógica'
  );
});

test('restaurar reactiva la materialización y elimina la excepción', () => {
  const cancelled = buildCancelledOccurrence(virtualLesson);
  const restored = buildRestoredOccurrence(cancelled.lesson);
  const lessons = upsertMaterializedOccurrence([cancelled.lesson], restored);
  const exceptions = removeRecurrenceException(
    [cancelled.exception],
    cancelled.exception.recurrenceId,
    cancelled.exception.occurrenceKey
  );
  assertEqual(lessons.length, 1, 'una clase restaurada materializada');
  assertEqual(lessons[0].status, 'scheduled', 'vuelve a programada');
  assertEqual(exceptions.length, 0, 'sin excepción de cancelación');
});

test('la identidad de reserva recurrente es estable', () => {
  assertEqual(
    buildCalendarReservationKey(virtualLesson),
    `recurrence:${virtualLesson.recurrenceId}:${virtualLesson.recurrenceOccurrenceKey}`,
    'clave recurrente'
  );
});

test('completar materializa una ocurrencia virtual sin duplicarla', () => {
  const completed = buildCompletedCalendarLesson(virtualLesson, 'saved-1');
  const twice = upsertMaterializedOccurrence(
    [completed],
    buildCompletedCalendarLesson(virtualLesson, 'saved-1')
  );
  assertEqual(twice.length, 1, 'una sola materialización');
  assertEqual(twice[0].status, 'completed', 'estado completado');
});

test('eliminar cancelada recurrente reemplaza cancelaciÃ³n por exclusiÃ³n persistente', () => {
  const cancelled = buildCancelledOccurrence(virtualLesson);
  const deleted = buildDeletedCalendarLessonMutation(
    [cancelled.lesson],
    [cancelled.exception],
    cancelled.lesson,
    '2026-07-13T13:00:00.000Z'
  );
  assertEqual(deleted.lessons.length, 0, 'quita materializaciÃ³n');
  assertEqual(deleted.exceptions.length, 1, 'mantiene una decisiÃ³n persistente');
  assertEqual(deleted.exceptions[0].type, 'excluded', 'no regenera la virtual');
  assertEqual(deleted.exceptions[0].replacementLessonId, undefined, 'limpia reemplazo anterior');
});

test('eliminar cancelada suelta o huÃ©rfana quita lesson y referencia legacy', () => {
  const orphan = {
    ...virtualLesson,
    id: 'legacy-orphan',
    isRecurring: true,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    status: 'cancelled' as const,
  };
  const legacyException: RecurrenceException = {
    recurrenceId: 'missing-rule',
    occurrenceKey: 'missing-occurrence',
    type: 'rescheduled',
    replacementLessonId: orphan.id,
    createdAt: '2026-07-13T12:00:00.000Z',
  };
  const deleted = buildDeletedCalendarLessonMutation(
    [orphan],
    [legacyException],
    orphan
  );
  assertEqual(deleted.lessons.length, 0, 'quita huÃ©rfana');
  assertEqual(deleted.exceptions.length, 0, 'quita referencia sin identidad restaurable');
});

test('no elimina definitivamente una clase sin cancelar antes', () => {
  let rejected = false;
  try {
    buildDeletedCalendarLessonMutation([virtualLesson], [], virtualLesson);
  } catch {
    rejected = true;
  }
  assertEqual(rejected, true, 'exige cancelaciÃ³n previa');
});

test('cancela una clase suelta o huÃ©rfana sin exigir identidad recurrente', () => {
  const orphan = {
    ...virtualLesson,
    isRecurring: true,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
  };
  const cancelled = buildCancelledCalendarLessonMutation(orphan);
  assertEqual(cancelled.lesson.status, 'cancelled', 'queda visible como cancelada');
  assertEqual(cancelled.exception, null, 'no inventa una identidad que no existe');
});

// ---------------------------------------------------------------------------
// CORRECCIÓN (a pedido de Joaquín — reprogramar una sola ocurrencia y
// editar su horario): `buildRescheduledStandaloneLesson` — una clase suelta
// (nunca perteneció a una serie) también puede corregir su fecha y hora,
// sin excepción de recurrencia ni id nuevo.
// ---------------------------------------------------------------------------

const standaloneLesson = {
  id: 'calendar_lesson_standalone_1',
  studentId: 'student-1',
  studentName: 'Alumno Suelto',
  level: 'B1',
  participants: [{ studentId: 'student-1', studentName: 'Alumno Suelto', level: 'B1' }],
  lessonType: 'individual' as const,
  start: '2026-08-26T18:30:00.000Z',
  end: '2026-08-26T19:30:00.000Z',
  modality: 'presencial' as const,
  status: 'scheduled' as const,
  color: '#fff',
  overlapAllowed: false,
  overlapGroupId: null,
  isRecurring: false,
  recurrenceId: null,
  recurrenceOccurrenceKey: null,
  recurrenceIndex: null,
  recurrenceOriginalStart: null,
  notes: 'Nota original de la profesora',
};

const standaloneGroupLesson = {
  ...standaloneLesson,
  id: 'calendar_lesson_standalone_group_1',
  lessonType: 'group' as const,
  participants: [
    { studentId: 'student-1', studentName: 'Alumno Suelto', level: 'B1' },
    { studentId: 'student-2', studentName: 'Alumna Dos', level: 'A2' },
    { studentId: 'student-3', studentName: 'Alumno Tres', level: 'B2' },
  ],
};

test('reprogramar una clase suelta con un alumno: cambia fecha y hora, conserva al alumno, marca "reprogramada"', () => {
  const result = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  assertEqual(result.start, '2026-08-28T20:00:00.000Z', 'nueva fecha/hora de inicio');
  assertEqual(result.end, '2026-08-28T21:00:00.000Z', 'nueva fecha/hora de fin');
  assertEqual(result.status, 'rescheduled', 'queda marcada como reprogramada');
  assertEqual(result.id, standaloneLesson.id, 'conserva el mismo id — una clase suelta ya es su propia identidad estable, nunca necesita una nueva');
  assertEqual(result.participants.length, 1, 'conserva a su único alumno');
  assertEqual(result.participants[0].studentId, 'student-1', 'el mismo alumno de siempre');
});

test('reprogramar una clase suelta GRUPAL (2 o más alumnos): conserva a TODOS los participantes, nunca la divide', () => {
  const result = buildRescheduledStandaloneLesson(standaloneGroupLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  assertEqual(result.participants.length, 3, 'los 3 alumnos siguen presentes');
  const ids = result.participants.map((participant) => participant.studentId).sort();
  assertEqual(JSON.stringify(ids), JSON.stringify(['student-1', 'student-2', 'student-3']), 'exactamente los mismos 3, sin agregar ni quitar a nadie');
  assertEqual(result.lessonType, 'group', 'sigue siendo una única clase grupal, nunca se parte en clases individuales');
});

test('reprogramar una clase suelta conserva duración implícita (start/end nuevos), modalidad, notas y demás campos no editados', () => {
  const result = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  assertEqual(result.modality, standaloneLesson.modality, 'modalidad intacta');
  assertEqual(result.notes, standaloneLesson.notes, 'notas intactas');
  assertEqual(result.level, standaloneLesson.level, 'nivel intacto');
  assertEqual(result.studentName, standaloneLesson.studentName, 'nombre del alumno intacto');
  assertEqual(
    new Date(result.end).getTime() - new Date(result.start).getTime(),
    60 * 60 * 1000,
    'la duración pedida (1h) se conserva tal cual se pidió'
  );
});

test('reprogramar una clase suelta guarda su horario ORIGINAL la primera vez, y lo conserva en reprogramaciones posteriores (nunca lo pisa)', () => {
  const first = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  assertEqual(first.recurrenceOriginalStart, standaloneLesson.start, 'primera reprogramación: guarda el horario real original');

  const second = buildRescheduledStandaloneLesson(first, '2026-08-30T15:00:00.000Z', '2026-08-30T16:00:00.000Z');
  assertEqual(
    second.recurrenceOriginalStart,
    standaloneLesson.start,
    'segunda reprogramación: sigue recordando el horario ORIGINAL real, nunca el intermedio'
  );
});

test('reprogramar una clase suelta rechaza un fin anterior o igual al nuevo inicio, sin mutar nada', () => {
  let rejected = false;
  try {
    buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T20:00:00.000Z');
  } catch {
    rejected = true;
  }
  assert(rejected, 'un fin igual al inicio se rechaza');
});

test('reprogramar una clase que SÍ pertenece a una serie con buildRescheduledStandaloneLesson lanza — nunca se usa por error para una ocurrencia real', () => {
  let rejected = false;
  try {
    buildRescheduledStandaloneLesson(virtualLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  } catch {
    rejected = true;
  }
  assert(rejected, 'una clase con recurrenceId/recurrenceOccurrenceKey debe reprogramarse con buildRescheduledOccurrence, nunca con esta función');
});

test('reprogramar una clase suelta nunca crea una excepción de recurrencia (no hay ningún patrón del que excepcionar)', () => {
  const result = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  assertEqual(result.recurrenceId, null, 'sigue sin pertenecer a ninguna serie');
  assertEqual(result.recurrenceOccurrenceKey, null, 'sin identidad de ocurrencia — nunca se le inventa una');
});

test('reprogramar la misma clase suelta dos veces (mismo id): al insertarla en la lista de clases, reemplaza en vez de duplicar', () => {
  const first = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z');
  const lessonsAfterFirst = [first];
  const second = buildRescheduledStandaloneLesson(first, '2026-08-30T15:00:00.000Z', '2026-08-30T16:00:00.000Z');
  // Mismo criterio de "upsert por id" que usa rescheduleRecurrenceOccurrence
  // en useWeeklyCalendar.ts para la rama sin recurrencia.
  const lessonsAfterSecond = lessonsAfterFirst.some((item) => item.id === second.id)
    ? lessonsAfterFirst.map((item) => (item.id === second.id ? second : item))
    : [...lessonsAfterFirst, second];
  assertEqual(lessonsAfterSecond.length, 1, 'nunca duplica — un único registro para la misma clase suelta');
  assertEqual(lessonsAfterSecond[0].start, second.start, 'con el horario más reciente');
});

test('reprogramar respeta overlapAllowed/overlapGroupId cuando se pide agendar dos clases superpuestas a propósito', () => {
  const result = buildRescheduledStandaloneLesson(standaloneLesson, '2026-08-28T20:00:00.000Z', '2026-08-28T21:00:00.000Z', {
    overlapAllowed: true,
    overlapGroupId: 'overlap_1',
  });
  assertEqual(result.overlapAllowed, true, 'superposición permitida, mismo criterio que una ocurrencia de serie');
  assertEqual(result.overlapGroupId, 'overlap_1', 'mismo grupo de superposición');
});
