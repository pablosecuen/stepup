// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/homeworkPendingDomain.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: "la tarea pendiente
 * debe reaparecer claramente cuando se registre la siguiente clase del
 * alumno"): pruebas del motor puro `homeworkPendingDomain.ts`. Cubre la
 * matriz obligatoria (casos 1 a 14 y 16 de la lista pedida — 15 y 17 se
 * cubren en `restoreValidation`/pruebas de teclado ya existentes).
 *
 * Identidades ficticias `qa_*`, nunca datos de un alumno real.
 */
import { DEFAULT_FORM_STATE, type HomeworkReviewEntry, type HomeworkReviewOutcome, type NewClassFormState, type SavedLesson, type StudentEvaluationEntry } from '../../types/index.ts';
import { buildHomeworkReviewEntries, collectAssignedHomeworkTasks, commonHomeworkTaskId, computePendingHomeworkTasks, getUnresolvedHomeworkTaskIds, homeworkReviewSelectionKey, homeworkReviewsToSelections, individualHomeworkTaskId, isHomeworkTaskResolved, projectPendingHomeworkSummary, upsertHomeworkReviews } from '../homeworkPendingDomain.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function form(overrides: Partial<NewClassFormState> = {}): NewClassFormState {
  return {
    ...DEFAULT_FORM_STATE,
    studentIds: ['qa_alumno_1'],
    date: '2026-08-10',
    time: '18:00',
    modality: 'presencial',
    ...overrides,
  };
}

function lesson(overrides: Partial<SavedLesson> = {}): SavedLesson {
  return {
    id: 'qa_lesson_1',
    createdAt: '2026-08-10T18:05:00.000Z',
    form: form(),
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    profileAppliedAt: '2026-08-10T18:05:00.000Z',
    ...overrides,
  };
}

function evaluationEntry(studentId: string, overrides: Partial<StudentEvaluationEntry> = {}): StudentEvaluationEntry {
  return {
    studentId,
    generalGrade: null,
    skillGrades: {},
    strengths: [],
    areasToImprove: [],
    ...overrides,
  };
}

function review(taskId: string, studentId: string, outcome: HomeworkReviewEntry['outcome'], reviewedAt = '2026-08-17T18:05:00.000Z'): HomeworkReviewEntry {
  return { taskId, studentId, outcome, reviewedAt };
}

// ===========================================================================
// 1) Tarea común sin fecha
// ===========================================================================

test('1) Tarea común sin fecha: se detecta como pendiente, dueDate queda null', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Ejercicios de listening', homeworkDueDate: null }) });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  assertEqual(pending.length, 1, 'una tarea común pendiente');
  assertEqual(pending[0].description, 'Ejercicios de listening', 'descripción exacta');
  assertEqual(pending[0].dueDate, null, 'sin fecha, tal cual se guardó');
  assertEqual(pending[0].kind, 'common', 'tipo común');
  assertEqual(pending[0].taskId, commonHomeworkTaskId('l1'), 'taskId derivado del lesson de origen');
});

// ===========================================================================
// 2) Tarea común con fecha
// ===========================================================================

test('2) Tarea común con fecha: la fecha de entrega viaja intacta en la tarea pendiente', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Redacción corta', homeworkDueDate: '2026-08-20' }) });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  assertEqual(pending[0].dueDate, '2026-08-20', 'fecha exacta');
});

// ===========================================================================
// 3) Tarea individual
// ===========================================================================

test('3) Tarea individual: se detecta con su propio taskId, independiente de la tarea común', () => {
  const origin = lesson({
    id: 'l1',
    form: form({
      homeworkDescription: 'Tarea común para todos',
      evaluations: [evaluationEntry('qa_alumno_1', { individualHomeworkDescription: 'Sólo para este alumno', individualHomeworkDueDate: '2026-08-18' })],
    }),
  });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  assertEqual(pending.length, 2, 'la tarea común Y la individual, ambas pendientes');
  const individual = pending.find((task) => task.kind === 'individual');
  assert(individual !== undefined, 'debe existir la tarea individual');
  assertEqual(individual!.description, 'Sólo para este alumno', 'descripción individual exacta');
  assertEqual(individual!.dueDate, '2026-08-18', 'fecha individual exacta');
  assertEqual(individual!.taskId, individualHomeworkTaskId('l1', 'qa_alumno_1'), 'taskId individual derivado de lesson+studentId');
});

// ===========================================================================
// 4) Clase grupal con resultados diferentes
// ===========================================================================

test('4) Clase grupal: cada alumno tiene su propia tarea común pendiente, resolverla para uno no afecta a los demás', () => {
  const origin = lesson({
    id: 'l1',
    form: form({ studentIds: ['qa_a', 'qa_b', 'qa_c'], homeworkDescription: 'Tarea grupal' }),
  });
  const reviewLesson = lesson({
    id: 'l2',
    form: form({ studentIds: ['qa_a', 'qa_b', 'qa_c'], date: '2026-08-17' }),
    homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_a', 'realizada')],
  });
  const lessons = [origin, reviewLesson];
  assertEqual(computePendingHomeworkTasks('qa_a', lessons).length, 0, 'qa_a: cerrada (realizada)');
  assertEqual(computePendingHomeworkTasks('qa_b', lessons).length, 1, 'qa_b: sigue pendiente, nadie la resolvió por él');
  assertEqual(computePendingHomeworkTasks('qa_c', lessons).length, 1, 'qa_c: sigue pendiente, independiente de qa_a');
});

// ===========================================================================
// 5) Tarea realizada — cierra
// ===========================================================================

test('5) "Realizada" cierra la tarea — deja de aparecer como pendiente en cualquier clase posterior', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const reviewed = lesson({ id: 'l2', form: form({ date: '2026-08-17' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada')] });
  const evenLater = lesson({ id: 'l3', form: form({ date: '2026-08-24' }) });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, reviewed]).length, 0, 'cerrada inmediatamente tras la revisión');
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, reviewed, evenLater]).length, 0, 'sigue cerrada en clases todavía más adelante');
  assert(isHomeworkTaskResolved(commonHomeworkTaskId('l1'), 'qa_alumno_1', [origin, reviewed]), 'isHomeworkTaskResolved confirma el cierre');
});

// ===========================================================================
// 6) Tarea parcial — sigue pendiente
// ===========================================================================

test('6) "Realizada parcialmente" conserva la tarea pendiente para la clase siguiente', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const reviewed = lesson({ id: 'l2', form: form({ date: '2026-08-17' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'parcial')] });
  const pendingAfterReview = computePendingHomeworkTasks('qa_alumno_1', [origin, reviewed]);
  assertEqual(pendingAfterReview.length, 1, 'sigue pendiente después de la revisión parcial');
  assertEqual(pendingAfterReview[0].taskId, commonHomeworkTaskId('l1'), 'es la MISMA tarea de origen, no una nueva');
  assert(!isHomeworkTaskResolved(commonHomeworkTaskId('l1'), 'qa_alumno_1', [origin, reviewed]), 'parcial nunca es un resultado terminal');
});

// ===========================================================================
// 7) Tarea no realizada — sigue pendiente
// ===========================================================================

test('7) "No realizada" conserva la tarea pendiente para la clase siguiente', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const reviewed = lesson({ id: 'l2', form: form({ date: '2026-08-17' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'no_realizada')] });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, reviewed]).length, 1, 'no_realizada no cierra la tarea');
});

test('6b/7b) Una tarea revisada varias veces como parcial/no_realizada sigue abierta indefinidamente hasta un resultado terminal', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const secondReview = lesson({ id: 'l2', form: form({ date: '2026-08-17' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'parcial')] });
  const thirdReview = lesson({ id: 'l3', form: form({ date: '2026-08-24' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'no_realizada')] });
  const lessons = [origin, secondReview, thirdReview];
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', lessons).length, 1, 'sigue abierta tras dos revisiones no terminales seguidas');
  const finallyResolved = [...lessons, lesson({ id: 'l4', form: form({ date: '2026-08-31' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada')] })];
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', finallyResolved).length, 0, 'recién se cierra con el primer resultado terminal, sin importar cuántas revisiones no terminales hubo antes');
});

// ===========================================================================
// 8) Tarea descartada — cierra
// ===========================================================================

test('8) "Ya no corresponde" cierra la tarea, igual que "realizada"', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const reviewed = lesson({ id: 'l2', form: form({ date: '2026-08-17' }), homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'ya_no_corresponde')] });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, reviewed]).length, 0, 'ya_no_corresponde cierra la tarea');
});

// ===========================================================================
// 9) Alumno ausente — la tarea sigue pendiente (nadie la resolvió)
// ===========================================================================

test('9) Alumno ausente en la clase siguiente: sin ninguna revisión registrada, la tarea sigue pendiente tal cual', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  // "alumno_ausente" no cuenta como clase dictada — countsAsClass false,
  // y sobre todo: nadie pudo revisar nada, así que no se agrega ningún
  // homeworkReviews. La tarea de origen sigue intacta.
  const absentClass = lesson({ id: 'l2', form: form({ date: '2026-08-17', eventType: 'alumno_ausente' }), countsAsClass: false });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, absentClass]).length, 1, 'sigue pendiente — nadie la revisó porque el alumno faltó');
});

// ===========================================================================
// 10) Clase cancelada — no cuenta como revisión ni genera tarea nueva
// ===========================================================================

test('10) Clase cancelada: no resuelve tareas pendientes anteriores ni asigna una tarea nueva', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const cancelled = lesson({ id: 'l2', form: form({ date: '2026-08-17', eventType: 'cancelada_con_aviso', homeworkDescription: '' }), countsAsClass: false });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, cancelled]).length, 1, 'la tarea de origen sigue pendiente — la cancelación no la resolvió');
  const tasksFromCancelled = collectAssignedHomeworkTasks([cancelled]);
  assertEqual(tasksFromCancelled.length, 0, 'una clase cancelada (countsAsClass false) nunca asigna una tarea nueva, tenga texto o no');
});

test('10b) Feriado sin excepción: tampoco cuenta como revisión ni asigna tarea', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const holiday = lesson({ id: 'l2', form: form({ date: '2026-08-17', eventType: 'feriado', holidayException: false }), countsAsClass: false });
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', [origin, holiday]).length, 1, 'sigue pendiente');
});

// ===========================================================================
// 11) Cambio de serie entre una clase y la siguiente
// ===========================================================================

test('11) La tarea sigue al ALUMNO, no a la serie — aparece en la próxima clase real aunque sea otra serie o una clase suelta', () => {
  const origin = lesson({
    id: 'l1',
    form: form({ date: '2026-08-10', homeworkDescription: 'Tarea de la serie vieja' }),
    calendarReservationKey: 'recurrence:serie_vieja:2026-08-10T18:00:00.000Z',
  });
  // Clase siguiente de una serie DISTINTA (nuevo recurrenceId), o incluso
  // una clase suelta sin ninguna serie — da igual, nunca se filtra por
  // calendarReservationKey/recurrenceId, sólo por studentId + fecha.
  const nextInDifferentSeries = lesson({
    id: 'l2',
    form: form({ date: '2026-08-17' }),
    calendarReservationKey: 'lesson:clase_suelta_1',
  });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [origin], { excludeOriginLessonId: 'l2' });
  assertEqual(pending.length, 1, 'la tarea de la serie vieja sigue detectándose como pendiente para la clase suelta siguiente');
  assertEqual(pending[0].originLessonId, 'l1', 'la tarea sigue referenciando su clase de origen real');
  void nextInDifferentSeries;
});

// ===========================================================================
// 12) Edición posterior — corregir la revisión ya guardada
// ===========================================================================

test('12) Editar una clase y cambiar el resultado de una revisión la REEMPLAZA — nunca agrega una segunda entrada', () => {
  const original = [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'no_realizada', '2026-08-17T18:00:00.000Z')];
  const corrected = upsertHomeworkReviews(original, [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada', '2026-08-17T19:00:00.000Z')]);
  assertEqual(corrected.length, 1, 'sigue habiendo una sola entrada para ese taskId');
  assertEqual(corrected[0].outcome, 'realizada', 'el resultado corregido reemplazó al anterior');
  assertEqual(corrected[0].reviewedAt, '2026-08-17T19:00:00.000Z', 'la fecha de revisión también se actualiza');
});

// ===========================================================================
// 13) Doble guardado — nunca duplica
// ===========================================================================

test('13) Guardar la misma revisión dos veces (reintento) nunca duplica la entrada', () => {
  const first = upsertHomeworkReviews(undefined, [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada')]);
  const second = upsertHomeworkReviews(first, [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada')]);
  assertEqual(second.length, 1, 'la segunda escritura idéntica no agrega una entrada nueva');
});

test('13b) upsertHomeworkReviews con múltiples taskId distintos en la misma llamada: cada uno se resuelve de forma independiente', () => {
  const existing = [review(commonHomeworkTaskId('l1'), 'qa_a', 'parcial'), review(individualHomeworkTaskId('l1', 'qa_b'), 'qa_b', 'parcial')];
  const updated = upsertHomeworkReviews(existing, [review(commonHomeworkTaskId('l1'), 'qa_a', 'realizada')]);
  assertEqual(updated.length, 2, 'el taskId no tocado sigue intacto');
  assertEqual(updated.find((entry) => entry.studentId === 'qa_a')?.outcome, 'realizada', 'el taskId tocado se actualizó');
  assertEqual(updated.find((entry) => entry.studentId === 'qa_b')?.outcome, 'parcial', 'nunca se toca la revisión de otro alumno/tarea');
});

// ===========================================================================
// 14) Cierre y reapertura — round-trip de JSON
// ===========================================================================

test('14) Cierre y rehidratación: homeworkReviews sobrevive intacto a un round-trip de JSON (cerrar/reabrir la app)', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea de origen' }) });
  const reviewed = lesson({
    id: 'l2',
    form: form({ date: '2026-08-17' }),
    homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'parcial', '2026-08-17T18:00:00.000Z')],
  });
  const rehydrated = JSON.parse(JSON.stringify([origin, reviewed])) as SavedLesson[];
  assertEqual(rehydrated[1].homeworkReviews?.length, 1, 'la revisión sobrevive al reinicio');
  assertEqual(rehydrated[1].homeworkReviews?.[0].outcome, 'parcial', 'el resultado exacto sobrevive');
  assertEqual(computePendingHomeworkTasks('qa_alumno_1', rehydrated).length, 1, 'el cálculo de pendientes sigue funcionando igual tras rehidratar');
});

// ===========================================================================
// 16) Datos antiguos que sólo contienen pendingHomework (sin homeworkReviews
// en ninguna SavedLesson) — nunca deben romper el cálculo.
// ===========================================================================

test('16) SavedLesson vieja sin homeworkReviews (registro anterior a esta fase): no rompe el cálculo, se trata como "sin revisiones"', () => {
  const legacyOrigin: SavedLesson = {
    id: 'legacy_1',
    createdAt: '2026-01-10T18:00:00.000Z',
    form: form({ date: '2026-01-10', homeworkDescription: 'Tarea vieja, de antes de esta fase' }),
    countsAsClass: true,
    billedAmount: null,
    appliedPolicy: null,
    profileAppliedAt: '2026-01-10T18:05:00.000Z',
    // homeworkReviews: undefined — deliberadamente ausente, como cualquier registro real de antes de esta fase.
  };
  const pending = computePendingHomeworkTasks('qa_alumno_1', [legacyOrigin]);
  assertEqual(pending.length, 1, 'una tarea vieja sin revisiones se detecta igual como pendiente — nunca se pierde');
  assert(!isHomeworkTaskResolved(commonHomeworkTaskId('legacy_1'), 'qa_alumno_1', [legacyOrigin]), 'sin homeworkReviews, isHomeworkTaskResolved nunca lanza, sólo devuelve false');
});

// ===========================================================================
// Proyección del resumen de perfil (pendingHomework: string | null)
// ===========================================================================

test('projectPendingHomeworkSummary: null cuando no hay tareas abiertas', () => {
  assertEqual(projectPendingHomeworkSummary('qa_alumno_1', []), null, 'sin lecciones, no hay resumen');
});

test('projectPendingHomeworkSummary: une las descripciones de TODAS las tareas abiertas, de la más vieja a la más nueva — nunca sólo la última', () => {
  const first = lesson({ id: 'l1', form: form({ date: '2026-08-01', homeworkDescription: 'Primera tarea vieja' }) });
  const second = lesson({ id: 'l2', form: form({ date: '2026-08-08', homeworkDescription: 'Segunda tarea' }) });
  const summary = projectPendingHomeworkSummary('qa_alumno_1', [first, second]);
  assertEqual(summary, 'Primera tarea vieja; Segunda tarea', 'ambas tareas abiertas aparecen, en orden cronológico — la vieja nunca se pierde silenciosamente');
});

test('projectPendingHomeworkSummary: una tarea cerrada deja de sumar al resumen', () => {
  const first = lesson({ id: 'l1', form: form({ date: '2026-08-01', homeworkDescription: 'Ya resuelta' }) });
  const second = lesson({ id: 'l2', form: form({ date: '2026-08-08', homeworkDescription: 'Sigue abierta' }) });
  const reviewLesson = lesson({
    id: 'l3',
    form: form({ date: '2026-08-15' }),
    homeworkReviews: [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada')],
  });
  const summary = projectPendingHomeworkSummary('qa_alumno_1', [first, second, reviewLesson]);
  assertEqual(summary, 'Sigue abierta', 'la tarea resuelta ya no aparece; sólo la que sigue abierta');
});

// ===========================================================================
// "Una tarea escrita en la clase actual no debe aparecer como pendiente
// dentro de esa misma clase" (FASE 2) — excludeOriginLessonId.
// ===========================================================================

test('Una clase nunca se muestra a sí misma como pendiente de su propia tarea recién escrita (todavía sin guardar como "otra" clase)', () => {
  const currentDraft = lesson({ id: 'l_current', form: form({ homeworkDescription: 'Recién la estoy escribiendo ahora' }) });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [currentDraft], { excludeOriginLessonId: 'l_current' });
  assertEqual(pending.length, 0, 'la propia clase nunca aparece como pendiente de sí misma');
});

// ===========================================================================
// Corrección P0 (a pedido de Joaquín — TAREAS PENDIENTES SIN RESPUESTA
// PRESELECCIONADA): matriz de pruebas obligatorias pedida explícitamente.
// Causa raíz real: ninguna pantalla forzaba a elegir una respuesta antes de
// "Completar alumno"/"Guardar clase"/"Finalizar registro", y el estado de
// selección en pantalla (y `upsertHomeworkReviews`) indexaba SÓLO por
// `taskId` — una tarea COMÚN comparte taskId entre varios alumnos a
// propósito, así que la selección (o el guardado) de un alumno tapaba la
// del otro. Identidades ficticias `qa_*` (con semilla fija donde aplica),
// nunca datos de un alumno real.
// ===========================================================================

// --- Individual con tarea pendiente: ninguna respuesta inicial --------------
test('P0) Individual con tarea pendiente: arranca sin ninguna respuesta elegida (selecciones vacías, nunca preseleccionadas)', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Practicar verbos irregulares' }) });
  const pendingTasks = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  assertEqual(pendingTasks.length, 1, 'una tarea pendiente real');
  const selections: Record<string, HomeworkReviewOutcome> = {}; // estado inicial real de un panel recién abierto
  assertEqual(selections[homeworkReviewSelectionKey(pendingTasks[0].taskId, 'qa_alumno_1')], undefined, 'sin ninguna respuesta preseleccionada');
  assertEqual(getUnresolvedHomeworkTaskIds(pendingTasks, selections).length, 1, 'sigue sin responder');
});

// --- Grupo de tres alumnos: ninguno recibe respuesta automática ------------
test('P0) Grupo de tres alumnos con una tarea COMÚN pendiente: ninguno arranca con una respuesta automática, y la de uno nunca se filtra a los demás', () => {
  const origin = lesson({ id: 'l1', form: form({ studentIds: ['qa_a', 'qa_b', 'qa_c'], homeworkDescription: 'Tarea grupal' }) });
  const pendingA = computePendingHomeworkTasks('qa_a', [origin]);
  const pendingB = computePendingHomeworkTasks('qa_b', [origin]);
  const pendingC = computePendingHomeworkTasks('qa_c', [origin]);
  const commonTaskId = commonHomeworkTaskId('l1');
  assertEqual(pendingA[0].taskId, commonTaskId, 'comparten el mismo taskId a propósito (tarea común)');
  assertEqual(pendingB[0].taskId, commonTaskId, 'comparten el mismo taskId a propósito (tarea común)');

  // Estado de selección real de un panel grupal recién abierto (nunca preseleccionado).
  let selections: Record<string, HomeworkReviewOutcome> = {};
  assertEqual(getUnresolvedHomeworkTaskIds(pendingA, selections).length, 1, 'qa_a sin responder');
  assertEqual(getUnresolvedHomeworkTaskIds(pendingB, selections).length, 1, 'qa_b sin responder');
  assertEqual(getUnresolvedHomeworkTaskIds(pendingC, selections).length, 1, 'qa_c sin responder');

  // La profesora elige la respuesta de qa_a — con la clave compuesta real,
  // nunca "hereda" la de qa_b ni qa_c (antes, con sólo taskId como clave,
  // esta misma escritura habría quedado visible para los tres).
  selections = { ...selections, [homeworkReviewSelectionKey(commonTaskId, 'qa_a')]: 'realizada' };
  assertEqual(getUnresolvedHomeworkTaskIds(pendingA, selections).length, 0, 'qa_a ya respondió');
  assertEqual(getUnresolvedHomeworkTaskIds(pendingB, selections).length, 1, 'qa_b NUNCA hereda la respuesta de qa_a');
  assertEqual(getUnresolvedHomeworkTaskIds(pendingC, selections).length, 1, 'qa_c NUNCA hereda la respuesta de qa_a');
});

// --- No permite completar sin elegir respuesta -------------------------------
test('P0) getUnresolvedHomeworkTaskIds bloquea mientras falte responder — cada una de las cuatro respuestas reales permite continuar', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea' }) });
  const pendingTasks = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  const taskId = pendingTasks[0].taskId;

  (['realizada', 'parcial', 'no_realizada', 'ya_no_corresponde'] as const).forEach((outcome) => {
    const selections = { [homeworkReviewSelectionKey(taskId, 'qa_alumno_1')]: outcome };
    assertEqual(getUnresolvedHomeworkTaskIds(pendingTasks, selections).length, 0, `"${outcome}" permite continuar`);
  });
});

// --- Omitir conserva el estado sin responder --------------------------------
test('P0) Omitir a un alumno nunca escribe una selección — la tarea sigue exactamente "sin responder"', () => {
  const origin = lesson({ id: 'l1', form: form({ homeworkDescription: 'Tarea' }) });
  const pendingTasks = computePendingHomeworkTasks('qa_alumno_1', [origin]);
  // "Omitir por ahora" (ver RegisterPendingClassSheet.tsx: handleOmitParticipant)
  // nunca llama a setHomeworkReviewSelections — el estado real que le llega
  // es el mismo de antes, sin ninguna clave nueva.
  const selectionsAfterOmit: Record<string, HomeworkReviewOutcome> = {};
  assertEqual(getUnresolvedHomeworkTaskIds(pendingTasks, selectionsAfterOmit).length, 1, 'sigue sin responder tras omitir');
});

// --- Guardar borrador y reabrir: sin respuesta conserva null ----------------
test('P0) Guardar un borrador con la tarea SIN responder y reabrirlo: sigue sin ninguna selección (nunca "Realizada" por defecto)', () => {
  const draftHomeworkReviews: HomeworkReviewEntry[] | undefined = undefined; // nunca se guardó ninguna revisión
  const restored = homeworkReviewsToSelections(draftHomeworkReviews);
  assertEqual(Object.keys(restored).length, 0, 'reabrir sin haber respondido nunca preselecciona nada');
});

// --- Guardar borrador con respuesta y reabrir: recupera exactamente esa ----
test('P0) Guardar un borrador CON una respuesta ya elegida y reabrirlo: recupera exactamente esa opción, ni otra', () => {
  const draftHomeworkReviews: HomeworkReviewEntry[] = [review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'parcial')];
  const restored = homeworkReviewsToSelections(draftHomeworkReviews);
  assertEqual(restored[homeworkReviewSelectionKey(commonHomeworkTaskId('l1'), 'qa_alumno_1')], 'parcial', 'recupera EXACTAMENTE "parcial", no "realizada" ni ninguna otra');
});

test('P0) Borrador grupal con respuestas de VARIOS alumnos para la misma tarea común: reabrir recupera la de cada uno, sin que ninguna pise a la otra', () => {
  const draftHomeworkReviews: HomeworkReviewEntry[] = [
    review(commonHomeworkTaskId('l1'), 'qa_a', 'realizada'),
    review(commonHomeworkTaskId('l1'), 'qa_b', 'no_realizada'),
  ];
  const restored = homeworkReviewsToSelections(draftHomeworkReviews);
  assertEqual(restored[homeworkReviewSelectionKey(commonHomeworkTaskId('l1'), 'qa_a')], 'realizada', 'recupera la de qa_a');
  assertEqual(restored[homeworkReviewSelectionKey(commonHomeworkTaskId('l1'), 'qa_b')], 'no_realizada', 'recupera la de qa_b, sin pisar la de qa_a');
});

// --- Pasar al siguiente alumno no hereda la respuesta anterior --------------
test('P0) buildHomeworkReviewEntries: dos alumnos con la misma tarea común, cada uno con su propia respuesta, produce DOS entradas reales (nunca una sola pisando a la otra)', () => {
  const origin = lesson({ id: 'l1', form: form({ studentIds: ['qa_a', 'qa_b'], homeworkDescription: 'Tarea grupal' }) });
  const pendingA = computePendingHomeworkTasks('qa_a', [origin]);
  const pendingB = computePendingHomeworkTasks('qa_b', [origin]);
  const allPendingTasks = [...pendingA, ...pendingB];
  const commonTaskId = commonHomeworkTaskId('l1');
  const selections = {
    [homeworkReviewSelectionKey(commonTaskId, 'qa_a')]: 'realizada' as const,
    [homeworkReviewSelectionKey(commonTaskId, 'qa_b')]: 'ya_no_corresponde' as const,
  };
  const entries = buildHomeworkReviewEntries(selections, allPendingTasks, '2026-08-21T12:00:00.000Z');
  assertEqual(entries.length, 2, 'dos alumnos, dos entradas reales — antes colapsaba a una sola (Map por taskId crudo)');
  const forA = entries.find((e) => e.studentId === 'qa_a');
  const forB = entries.find((e) => e.studentId === 'qa_b');
  assertEqual(forA?.outcome, 'realizada', 'la respuesta de qa_a es la suya');
  assertEqual(forB?.outcome, 'ya_no_corresponde', 'la respuesta de qa_b es la suya, no la de qa_a');
});

// --- Editar una clase conserva la respuesta real ----------------------------
test('P0) Editar un registro conserva la respuesta real ya guardada — nunca la reemplaza automáticamente por "realizada"', () => {
  const existingReviews: HomeworkReviewEntry[] = [review(commonHomeworkTaskId('l0'), 'qa_alumno_1', 'no_realizada')];
  // Mismo patrón real de EditRegisteredLessonSheet.tsx (initialHomeworkReviewSelections).
  const initialSelections = homeworkReviewsToSelections(existingReviews);
  assertEqual(initialSelections[homeworkReviewSelectionKey(commonHomeworkTaskId('l0'), 'qa_alumno_1')], 'no_realizada', 'conserva exactamente la respuesta persistida, nunca la sobrescribe con "realizada"');
});

// --- Registro histórico sin respuesta nunca se convierte en "Realizada" ----
test('P0) Un SavedLesson histórico sin homeworkReviews (anterior a esta fase) nunca se interpreta como "realizada" — sigue pendiente de verdad', () => {
  const origin = lesson({ id: 'l_old', form: form({ homeworkDescription: 'Tarea de un registro viejo' }) });
  // Ninguna clase posterior tiene homeworkReviews en absoluto (dato histórico real).
  const laterLessonWithoutReviews = lesson({ id: 'l_later', form: form({ date: '2026-09-01' }) });
  const pending = computePendingHomeworkTasks('qa_alumno_1', [origin, laterLessonWithoutReviews]);
  assertEqual(pending.length, 1, 'sigue pendiente — la ausencia de homeworkReviews nunca se migra ni se interpreta como resuelta');
  assert(!isHomeworkTaskResolved(commonHomeworkTaskId('l_old'), 'qa_alumno_1', [origin, laterLessonWithoutReviews]), 'nunca se asume "realizada" para datos históricos sin respuesta real');
});

// --- Doble toque no produce una respuesta automática ------------------------
test('P0) Doble toque: guardar la misma revisión dos veces seguidas (mismo taskId+studentId+outcome) nunca produce una segunda entrada ni cambia el resultado', () => {
  const entry = review(commonHomeworkTaskId('l1'), 'qa_alumno_1', 'realizada');
  const afterFirstTap = upsertHomeworkReviews(undefined, [entry]);
  const afterSecondTap = upsertHomeworkReviews(afterFirstTap, [entry]); // reintento idéntico, mismo instante
  assertEqual(afterSecondTap.length, 1, 'sigue habiendo una sola entrada real, nunca duplicada');
  assertEqual(afterSecondTap[0].outcome, 'realizada', 'el resultado sigue siendo el mismo elegido, nunca uno inventado');
});

// --- Backup/restauración conserva respuesta o ausencia de respuesta --------
test('P0) Backup y restauración (round-trip JSON completo): conserva exactamente cada respuesta real, y la ausencia de respuesta sigue ausente', () => {
  const original: HomeworkReviewEntry[] = [
    review(commonHomeworkTaskId('l1'), 'qa_a', 'parcial'),
    review(individualHomeworkTaskId('l1', 'qa_b'), 'qa_b', 'ya_no_corresponde'),
  ];
  const backupJson = JSON.stringify(original);
  const restored: HomeworkReviewEntry[] = JSON.parse(backupJson);
  assertEqual(restored.length, 2, 'las dos revisiones reales sobreviven al respaldo');
  assertEqual(restored[0].outcome, 'parcial', 'la respuesta de qa_a sobrevive exacta');
  assertEqual(restored[1].outcome, 'ya_no_corresponde', 'la respuesta de qa_b sobrevive exacta');

  // Un alumno SIN ninguna revisión (nunca respondió) sigue sin respuesta
  // real tras el respaldo — nunca aparece una entrada inventada para él.
  const selections = homeworkReviewsToSelections(restored);
  assertEqual(selections[homeworkReviewSelectionKey(commonHomeworkTaskId('l1'), 'qa_c')], undefined, 'un alumno que nunca respondió sigue sin respuesta tras restaurar');
});
