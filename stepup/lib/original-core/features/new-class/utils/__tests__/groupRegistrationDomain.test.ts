// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/groupRegistrationDomain.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-12 (a pedido de Joaquín — REDISEÑO SEGURO E INTUITIVO
 * DEL REGISTRO DE CLASES): dominio puro del progreso grupal, título de
 * identidad y tarea única. Identidades ficticias `qa_*`.
 */
import { buildInitialGroupProgress, firstOpenParticipant, formatGroupProgressLabel, isGroupRegistrationComplete, isStudentHomeworkPersonalized, resolveRegistrationPanelIdentity, resolveStudentHomework, setParticipantStatus, summarizeGroupProgress } from '../groupRegistrationDomain.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const STUDENTS = ['qa_alumno_1', 'qa_alumno_2', 'qa_alumno_3'];

test('buildInitialGroupProgress: arranca todos pending, en el mismo orden recibido', () => {
  const progress = buildInitialGroupProgress(STUDENTS);
  assertEqual(progress.participantOrder.join(','), STUDENTS.join(','), 'orden estable = orden de entrada');
  STUDENTS.forEach((id) => assertEqual(progress.participantStatus[id], 'pending', `${id} arranca pending`));
});

test('setParticipantStatus: nunca muta el progreso original, sólo cambia al alumno indicado', () => {
  const progress = buildInitialGroupProgress(STUDENTS);
  const updated = setParticipantStatus(progress, 'qa_alumno_2', 'completed');
  assertEqual(progress.participantStatus.qa_alumno_2, 'pending', 'el original queda intacto');
  assertEqual(updated.participantStatus.qa_alumno_2, 'completed', 'el nuevo refleja el cambio');
  assertEqual(updated.participantStatus.qa_alumno_1, 'pending', 'los demás no se tocan');
});

test('firstOpenParticipant: abre el siguiente pending en orden; si no hay pending, el primer omitted; si todos completed, null', () => {
  let progress = buildInitialGroupProgress(STUDENTS);
  assertEqual(firstOpenParticipant(progress), 'qa_alumno_1', 'primero pendiente en orden');

  progress = setParticipantStatus(progress, 'qa_alumno_1', 'completed');
  assertEqual(firstOpenParticipant(progress), 'qa_alumno_2', 'abre el siguiente pendiente tras completar el primero');

  progress = setParticipantStatus(progress, 'qa_alumno_2', 'omitted');
  assertEqual(firstOpenParticipant(progress), 'qa_alumno_3', 'un omitido no bloquea avanzar al siguiente pendiente real');

  progress = setParticipantStatus(progress, 'qa_alumno_3', 'completed');
  assertEqual(firstOpenParticipant(progress), 'qa_alumno_2', 'sin pendientes reales, vuelve al primer omitido');

  progress = setParticipantStatus(progress, 'qa_alumno_2', 'completed');
  assertEqual(firstOpenParticipant(progress), null, 'todos completed: no queda a quién abrir');
});

test('isGroupRegistrationComplete: false mientras exista al menos un omitted, true sólo si TODOS son completed', () => {
  let progress = buildInitialGroupProgress(STUDENTS);
  assert(!isGroupRegistrationComplete(progress), 'todos pending: incompleto');

  progress = setParticipantStatus(progress, 'qa_alumno_1', 'completed');
  progress = setParticipantStatus(progress, 'qa_alumno_2', 'completed');
  progress = setParticipantStatus(progress, 'qa_alumno_3', 'omitted');
  assert(!isGroupRegistrationComplete(progress), 'un omitido NUNCA cuenta como completo para habilitar Finalizar');

  progress = setParticipantStatus(progress, 'qa_alumno_3', 'completed');
  assert(isGroupRegistrationComplete(progress), 'los 3 completed: ahora sí está completo');
});

test('summarizeGroupProgress / formatGroupProgressLabel: cuenta y texto exactos', () => {
  let progress = buildInitialGroupProgress(STUDENTS);
  progress = setParticipantStatus(progress, 'qa_alumno_1', 'completed');
  progress = setParticipantStatus(progress, 'qa_alumno_2', 'omitted');
  const summary = summarizeGroupProgress(progress);
  assertEqual(summary.total, 3, 'total real');
  assertEqual(summary.completed, 1, 'completados reales');
  assertEqual(summary.omitted, 1, 'omitidos reales');
  assertEqual(summary.pending, 1, 'pendientes reales');
  assertEqual(formatGroupProgressLabel(progress), '1 de 3 alumnos completados', 'texto exacto pedido en la especificación');
});

test('buildInitialGroupProgress (reapertura): conserva orden y estados ya guardados, nunca reinicia', () => {
  let progress = buildInitialGroupProgress(STUDENTS);
  progress = setParticipantStatus(progress, 'qa_alumno_1', 'completed');
  progress = setParticipantStatus(progress, 'qa_alumno_2', 'omitted');

  const reopened = buildInitialGroupProgress(STUDENTS, progress);
  assertEqual(reopened.participantOrder.join(','), STUDENTS.join(','), 'mismo orden');
  assertEqual(reopened.participantStatus.qa_alumno_1, 'completed', 'alumno 1 sigue completed al reabrir');
  assertEqual(reopened.participantStatus.qa_alumno_2, 'omitted', 'alumno 2 sigue omitted al reabrir');
  assertEqual(reopened.participantStatus.qa_alumno_3, 'pending', 'alumno 3 sigue pending al reabrir');
});

test('buildInitialGroupProgress: un alumno agregado después entra al final como pending, uno quitado desaparece sin romper a los demás', () => {
  let progress = buildInitialGroupProgress(STUDENTS);
  progress = setParticipantStatus(progress, 'qa_alumno_1', 'completed');

  const withNewStudent = buildInitialGroupProgress([...STUDENTS, 'qa_alumno_4'], progress);
  assertEqual(withNewStudent.participantOrder.join(','), 'qa_alumno_1,qa_alumno_2,qa_alumno_3,qa_alumno_4', 'el nuevo se agrega al final, sin reordenar a los demás');
  assertEqual(withNewStudent.participantStatus.qa_alumno_4, 'pending', 'el nuevo arranca pending');
  assertEqual(withNewStudent.participantStatus.qa_alumno_1, 'completed', 'el progreso de los demás no se pierde');

  const withoutOne = buildInitialGroupProgress(['qa_alumno_1', 'qa_alumno_3'], progress);
  assertEqual(withoutOne.participantOrder.join(','), 'qa_alumno_1,qa_alumno_3', 'el quitado desaparece del orden');
  assertEqual(withoutOne.participantStatus.qa_alumno_1, 'completed', 'los que quedan conservan su estado');
});

test('resolveRegistrationPanelIdentity: individual usa el nombre del alumno como título', () => {
  const identity = resolveRegistrationPanelIdentity({
    isGroupClass: false,
    participants: [{ studentId: 'qa_alumno_1', studentName: 'Ana Pérez' }],
  });
  assertEqual(identity.isGroup, false, 'no es grupal');
  assertEqual(identity.title, 'Ana Pérez', 'título = nombre del alumno');
});

test('resolveRegistrationPanelIdentity: grupo CON nombre personalizado usa ese nombre, nunca el del primer alumno', () => {
  const identity = resolveRegistrationPanelIdentity({
    isGroupClass: true,
    classTitle: 'Conversación B2',
    participants: [
      { studentId: 'qa_alumno_1', studentName: 'Ana Pérez' },
      { studentId: 'qa_alumno_2', studentName: 'Beto Gómez' },
    ],
  });
  assertEqual(identity.title, 'Conversación B2', 'usa el nombre personalizado real');
});

test('resolveRegistrationPanelIdentity: grupo SIN nombre personalizado dice "Clase grupal", nunca el nombre del primer alumno', () => {
  const identity = resolveRegistrationPanelIdentity({
    isGroupClass: true,
    participants: [
      { studentId: 'qa_alumno_1', studentName: 'Ana Pérez' },
      { studentId: 'qa_alumno_2', studentName: 'Beto Gómez' },
    ],
  });
  assertEqual(identity.title, 'Clase grupal', 'nunca usa "Ana Pérez" como título del grupo');
});

test('resolveRegistrationPanelIdentity: un classTitle en blanco (sólo espacios) se trata como ausente', () => {
  const identity = resolveRegistrationPanelIdentity({
    isGroupClass: true,
    classTitle: '   ',
    participants: [
      { studentId: 'qa_alumno_1', studentName: 'Ana Pérez' },
      { studentId: 'qa_alumno_2', studentName: 'Beto Gómez' },
    ],
  });
  assertEqual(identity.title, 'Clase grupal', 'espacios en blanco no cuentan como nombre real');
});

// ===========================================================================
// Tarea única (§9)
// ===========================================================================

test('resolveStudentHomework: clase individual siempre usa la tarea común — nunca ofrece personalizar aparte', () => {
  const resolved = resolveStudentHomework({
    isGroup: false,
    commonDescription: 'Unidad 3 completa',
    commonDueDate: '2026-08-20',
    individualHomeworkDescription: 'esto nunca debería importar en individual',
  });
  assertEqual(resolved.isPersonalized, false, 'individual nunca personaliza');
  assertEqual(resolved.description, 'Unidad 3 completa', 'usa la tarea común');
  assertEqual(resolved.dueDate, '2026-08-20', 'usa la fecha común');
});

test('resolveStudentHomework: grupo sin personalizar usa la tarea común para ese alumno', () => {
  const resolved = resolveStudentHomework({
    isGroup: true,
    commonDescription: 'Tarea común del grupo',
    commonDueDate: '2026-08-21',
  });
  assertEqual(resolved.isPersonalized, false, 'sin descripción individual, no está personalizado');
  assertEqual(resolved.description, 'Tarea común del grupo', 'hereda la común');
});

test('resolveStudentHomework: grupo con tarea personalizada activa la reemplaza, nunca muestra las dos', () => {
  const resolved = resolveStudentHomework({
    isGroup: true,
    commonDescription: 'Tarea común del grupo',
    commonDueDate: '2026-08-21',
    individualHomeworkDescription: 'Repasar verbos irregulares 1-20',
    individualHomeworkDueDate: '2026-08-19',
  });
  assertEqual(resolved.isPersonalized, true, 'queda marcado como personalizado');
  assertEqual(resolved.description, 'Repasar verbos irregulares 1-20', 'usa la individual, no la común');
  assertEqual(resolved.dueDate, '2026-08-19', 'usa la fecha individual, no la común (2026-08-21)');
});

test('isStudentHomeworkPersonalized: texto vacío o sólo espacios NO cuenta como personalizado', () => {
  assert(!isStudentHomeworkPersonalized(undefined), 'undefined no es personalizado');
  assert(!isStudentHomeworkPersonalized(''), 'cadena vacía no es personalizado');
  assert(!isStudentHomeworkPersonalized('   '), 'sólo espacios no es personalizado');
  assert(isStudentHomeworkPersonalized('Ejercicio extra'), 'texto real sí es personalizado');
});
