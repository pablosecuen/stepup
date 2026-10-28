// Puerto VERBATIM del original (`src/features/students/utils/__tests__/studentDeletionCascade.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../../calendar/types/index.ts';
import type { SavedLesson } from '../../../new-class/types/index.ts';
import { emptyPaymentsState } from '../../../payments/hooks/paymentsStore.ts';
import type { ReportRecord } from '../../../reportes/types/index.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import type { StudentListItem } from '../../types/index.ts';
import { buildStudentDeletionCascade, type StudentDeletionSnapshots } from '../studentDeletionCascade.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeStudent(id: string): StudentListItem {
  return { id } as StudentListItem;
}

function makeProfile(id: string): StudentProfile {
  return { id } as StudentProfile;
}

function makeRule(recurrenceId: string, studentId: string): RecurrenceRule {
  return { recurrenceId, studentId } as RecurrenceRule;
}

function makeCalendarLesson(
  id: string,
  participantIds: string[]
): CalendarLesson {
  const participants = participantIds.map((studentId) => ({
    studentId,
    studentName: `Alumno ${studentId}`,
    level: studentId === 'delete-me' ? 'A2' : 'B1',
  }));
  const primary = participants[0];
  return {
    id,
    studentId: primary.studentId,
    studentName: primary.studentName,
    level: primary.level,
    participants,
    lessonType: participants.length > 1 ? 'group' : 'individual',
  } as CalendarLesson;
}

function makeSavedLesson(id: string, studentIds: string[]): SavedLesson {
  return {
    id,
    billedAmount: 30000,
    calendarReservationKey: `reservation:${id}`,
    calendarRegistration: {
      studentId: studentIds[0],
    },
    form: {
      studentIds,
      attendance: studentIds.map((studentId) => ({ studentId, present: true })),
      evaluations: studentIds.map((studentId) => ({
        studentId,
        generalGrade: 8,
        skillGrades: {},
        strengths: [],
        areasToImprove: [],
      })),
    },
  } as unknown as SavedLesson;
}

const source: StudentDeletionSnapshots = {
  students: [makeStudent('delete-me'), makeStudent('keep-me')],
  profiles: {
    'delete-me': makeProfile('delete-me'),
    'keep-me': makeProfile('keep-me'),
  },
  savedLessons: [
    makeSavedLesson('saved-individual', ['delete-me']),
    makeSavedLesson('saved-group', ['delete-me', 'keep-me']),
    makeSavedLesson('saved-other', ['keep-me']),
  ],
  calendarLessons: [
    makeCalendarLesson('calendar-individual', ['delete-me']),
    makeCalendarLesson('calendar-group', ['delete-me', 'keep-me']),
    makeCalendarLesson('calendar-other', ['keep-me']),
    {
      id: 'calendar-unrelated-malformed',
      studentId: 'keep-me',
      participants: [],
    } as unknown as CalendarLesson,
  ],
  recurrenceRules: [
    makeRule('rule-delete', 'delete-me'),
    makeRule('rule-keep', 'keep-me'),
  ],
  recurrenceExceptions: [
    { recurrenceId: 'rule-delete', occurrenceKey: 'deleted-exception' },
    { recurrenceId: 'rule-keep', occurrenceKey: 'kept-exception' },
  ] as RecurrenceException[],
  payments: emptyPaymentsState(),
  reportHistory: [
    { id: 'report-delete', studentId: 'delete-me' } as ReportRecord,
    { id: 'report-keep', studentId: 'keep-me' } as ReportRecord,
  ],
};

const result = buildStudentDeletionCascade('delete-me', source);

assert(result.students.length === 1 && result.students[0].id === 'keep-me', 'lista de alumnos');
assert(!result.profiles['delete-me'] && result.profiles['keep-me'], 'perfiles');
assert(!result.recurrenceRules.some((rule) => rule.studentId === 'delete-me'), 'reglas');
assert(result.recurrenceExceptions.length === 1, 'excepciones de la regla borrada');
assert(result.recurrenceExceptions[0].recurrenceId === 'rule-keep', 'excepción ajena');

assert(!result.calendarLessons.some((lesson) => lesson.id === 'calendar-individual'), 'clase individual');
const calendarGroup = result.calendarLessons.find((lesson) => lesson.id === 'calendar-group');
assert(calendarGroup, 'la clase grupal sobrevive');
assert(calendarGroup.participants.length === 1, 'se quita el participante');
assert(calendarGroup.studentId === 'keep-me', 'se reconstruye el principal');
assert(calendarGroup.studentName === 'Alumno keep-me', 'se reconstruye el nombre principal');
assert(calendarGroup.level === 'B1', 'se reconstruye el nivel principal');
assert(calendarGroup.lessonType === 'individual', 'se reclasifica la clase');
assert(
  result.calendarLessons.some((lesson) => lesson.id === 'calendar-unrelated-malformed'),
  'no elimina registros ajenos aunque estén incompletos'
);

assert(!result.savedLessons.some((lesson) => lesson.id === 'saved-individual'), 'registro individual');
const savedGroup = result.savedLessons.find((lesson) => lesson.id === 'saved-group');
assert(savedGroup, 'el registro grupal sobrevive');
assert(savedGroup.form.studentIds.length === 1, 'studentIds se limpia');
assert(savedGroup.form.attendance.length === 1, 'asistencia se limpia');
assert(savedGroup.form.evaluations.length === 1, 'evaluaciones se limpian');
assert(savedGroup.billedAmount === null, 'importe agregado queda indeterminado');
assert(savedGroup.calendarRegistration === undefined, 'registro de calendario privado se limpia');
assert(savedGroup.calendarReservationKey === undefined, 'clave de reserva privada se limpia');

assert(source.students.length === 2, 'no muta alumnos de entrada');
assert(source.calendarLessons[1].participants.length === 2, 'no muta calendario de entrada');
assert(source.savedLessons[1].form.studentIds.length === 2, 'no muta registros de entrada');

assert(
  !result.reportHistory.some((record) => record.studentId === 'delete-me'),
  'elimina el historial de reportes del alumno (corrección 2026-07-24 — antes quedaba huérfano)'
);
assert(
  result.reportHistory.some((record) => record.id === 'report-keep'),
  'conserva el historial de reportes de otros alumnos'
);

console.log('studentDeletionCascade: 20 verificaciones aprobadas');
