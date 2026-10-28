// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/pendingStudentSelection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from './testHarness.ts';
import { createPendingStudentSelection, isStudentAgendable, resolveSlotPresetFromPendingStudent, shouldClearPendingStudentAfterLesson, shouldClearPendingStudentAfterRecurrence } from '../pendingStudentSelection.ts';
import type { StudentListItem } from '../../../students/types/index.ts';

function buildStudent(overrides: Partial<StudentListItem> = {}): StudentListItem {
  return {
    id: 'student-1',
    name: 'Alumno Nuevo',
    levels: ['A1'],
    modality: 'online',
    status: 'activo',
    nextClassAt: null,
    paymentStatus: 'verde',
    averageGrade: 0,
    classesThisMonth: 0,
    lastPaymentAt: null,
    isFeatured: false,
    isNew: true,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
    ...overrides,
  };
}

test('createPendingStudentSelection: siempre identifica por studentId, nunca por nombre', () => {
  const pending = createPendingStudentSelection('student-1');
  assertEqual(pending.studentId, 'student-1', 'sólo guarda el id');
  assertEqual(Object.keys(pending).length, 1, 'no guarda ningún otro dato del alumno');
});

test('isStudentAgendable: un alumno activo es agendable', () => {
  assert(isStudentAgendable(buildStudent({ status: 'activo' })), 'activo debe ser agendable');
});

test('isStudentAgendable: pausado, inactivo y archivado no son agendables', () => {
  assert(!isStudentAgendable(buildStudent({ status: 'pausado' })), 'pausado');
  assert(!isStudentAgendable(buildStudent({ status: 'inactivo' })), 'inactivo');
  assert(!isStudentAgendable(buildStudent({ status: 'archivado' })), 'archivado');
});

test('isStudentAgendable: alumno inexistente (null/undefined) nunca es agendable', () => {
  assert(!isStudentAgendable(null), 'null');
  assert(!isStudentAgendable(undefined), 'undefined');
});

test('resolveSlotPresetFromPendingStudent: usa la duración habitual real del perfil', () => {
  const pending = createPendingStudentSelection('student-1');
  const student = buildStudent({ modality: 'presencial' });
  const preset = resolveSlotPresetFromPendingStudent(pending, student, 45);
  assertEqual(preset.presetStudentId, 'student-1', 'preselecciona por id');
  assertEqual(preset.presetDurationMinutes, 45, 'duración real del perfil');
  assertEqual(preset.presetModality, 'presencial', 'modalidad real del alumno');
});

test('resolveSlotPresetFromPendingStudent: nunca inventa una duración si el perfil no la tiene', () => {
  const pending = createPendingStudentSelection('student-1');
  const student = buildStudent();
  assertEqual(
    resolveSlotPresetFromPendingStudent(pending, student, null).presetDurationMinutes,
    undefined,
    'perfil sin duración -> sin preset (el sheet cae a su propio default)'
  );
  assertEqual(
    resolveSlotPresetFromPendingStudent(pending, student, undefined).presetDurationMinutes,
    undefined,
    'perfil todavía no disponible -> sin preset'
  );
  assertEqual(
    resolveSlotPresetFromPendingStudent(pending, student, 0).presetDurationMinutes,
    undefined,
    'duración inválida (0) -> sin preset'
  );
  assertEqual(
    resolveSlotPresetFromPendingStudent(pending, student, -10).presetDurationMinutes,
    undefined,
    'duración inválida (negativa) -> sin preset'
  );
});

test('shouldClearPendingStudentAfterLesson: se limpia cuando el alumno pendiente participó en la clase guardada', () => {
  const pending = createPendingStudentSelection('student-1');
  assert(
    shouldClearPendingStudentAfterLesson(pending, ['student-1']),
    'clase individual del alumno pendiente'
  );
  assert(
    shouldClearPendingStudentAfterLesson(pending, ['student-2', 'student-1']),
    'clase grupal que incluye al alumno pendiente'
  );
});

test('shouldClearPendingStudentAfterLesson: nunca se limpia por la clase de otro alumno', () => {
  const pending = createPendingStudentSelection('student-1');
  assert(
    !shouldClearPendingStudentAfterLesson(pending, ['student-2']),
    'clase de un alumno distinto no libera al pendiente'
  );
});

test('shouldClearPendingStudentAfterLesson: sin alumno pendiente, nunca hay nada que limpiar', () => {
  assert(!shouldClearPendingStudentAfterLesson(null, ['student-1']), 'null nunca se limpia');
});

test('shouldClearPendingStudentAfterRecurrence: mismo criterio que para una clase suelta', () => {
  const pending = createPendingStudentSelection('student-1');
  assert(shouldClearPendingStudentAfterRecurrence(pending, 'student-1'), 'misma serie del alumno pendiente');
  assert(!shouldClearPendingStudentAfterRecurrence(pending, 'student-2'), 'serie de otro alumno');
  assert(!shouldClearPendingStudentAfterRecurrence(null, 'student-1'), 'sin alumno pendiente');
});
