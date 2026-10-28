// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/savedLessonLinkageDiagnostics.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — SOLUCIÓN
 * ESTRUCTURAL DEFINITIVA — INTEGRIDAD DE SERIES Y REGISTROS DE CLASE):
 * pruebas del diagnóstico PURO de vinculación `SavedLesson` ↔
 * `CalendarLesson` — identidades ficticias `qa_*`, en memoria, nunca
 * AsyncStorage/Supabase reales. El matching aproximado por fecha/hora/
 * participantes de la ronda anterior se retiró (ver LIMPIEZA OBLIGATORIA
 * en el pedido) — sólo quedan las dos identidades canónicas reales:
 * `calendarReservationKey` y `calendarLessonId`.
 */
import type { CalendarLesson } from '../../../calendar/types/index.ts';
import { buildCalendarReservationKey } from '../../../calendar/utils/calendarRecurrenceMutations.ts';
import { DEFAULT_FORM_STATE, type NewClassFormState, type SavedLesson } from '../../types/index.ts';
import { classifySavedLessonLinkage, findSavedLessonIntegrityIssues, recoverOrphanedSavedLessonLinks } from '../savedLessonLinkageDiagnostics.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function baseForm(overrides: Partial<NewClassFormState> = {}): NewClassFormState {
  return {
    ...DEFAULT_FORM_STATE,
    studentIds: ['qa_alumno_1'],
    date: '2026-08-12',
    time: '15:45',
    modality: 'presencial',
    ...overrides,
  };
}

// Formulario ESTRUCTURALMENTE válido según validateNewClassForm (misma
// validación real que ya usa el guardado) — asistencia resuelta para cada
// alumno y duración real cargada, ambas exigidas cuando eventType es
// 'clase_dictada' (el default de DEFAULT_FORM_STATE).
function baseValidForm(overrides: Partial<NewClassFormState> = {}): NewClassFormState {
  const studentIds = overrides.studentIds ?? ['qa_alumno_1'];
  return baseForm({
    attendance: studentIds.map((studentId) => ({ studentId, present: true, status: 'presente' as const })),
    ...overrides,
    studentIds,
  });
}

function baseSavedLesson(overrides: Partial<SavedLesson> = {}): SavedLesson {
  const form = overrides.form ?? baseForm();
  return {
    id: 'qa_saved_1',
    createdAt: '2026-08-12T18:45:00.000Z',
    form,
    countsAsClass: true,
    billedAmount: 10000,
    appliedPolicy: null,
    ...overrides,
  };
}

function baseCalendarLesson(overrides: Partial<CalendarLesson> = {}): CalendarLesson {
  return {
    id: 'qa_calendar_1',
    studentId: 'qa_alumno_1',
    studentName: 'qa_anon',
    level: '',
    participants: [{ studentId: 'qa_alumno_1', studentName: 'qa_anon', level: '' }],
    lessonType: 'individual',
    start: '2026-08-12T18:45:00.000Z', // 15:45 ART
    end: '2026-08-12T19:45:00.000Z',
    modality: 'presencial',
    status: 'completed',
    color: '#000',
    overlapAllowed: false,
    overlapGroupId: null,
    isRecurring: false,
    recurrenceId: null,
    recurrenceOccurrenceKey: null,
    recurrenceIndex: null,
    recurrenceOriginalStart: null,
    ...overrides,
  } as CalendarLesson;
}

// ===========================================================================
// A) Registro correctamente vinculado
// ===========================================================================

test('1) Registro correctamente vinculado: calendarReservationKey coincide exacto con una CalendarLesson completed real', () => {
  const lesson = baseCalendarLesson();
  const saved = baseSavedLesson({
    calendarLessonId: lesson.id,
    calendarReservationKey: buildCalendarReservationKey(lesson),
  });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [lesson] });
  assertEqual(report.results.length, 1, 'un solo resultado');
  assertEqual(report.results[0].kind, 'linked', 'vinculado por identidad canónica exacta');
  assertEqual(report.results[0].matchedCalendarLessonId, lesson.id, 'apunta a la clase real correcta');
  assertEqual(JSON.stringify(report.completedWithoutSavedLesson), '[]', 'la clase ya tiene su registro — no aparece como huérfana del otro lado');
});

// ===========================================================================
// B) Registro huérfano por cambio de id materializado — recuperable
// ===========================================================================

test('2) Registro huérfano por cambio de id materializado: sin calendarReservationKey pero con calendarLessonId real, se recupera por esa identidad secundaria', () => {
  const lesson = baseCalendarLesson({ id: 'qa_calendar_regenerated' });
  const saved = baseSavedLesson({
    calendarLessonId: lesson.id,
    calendarReservationKey: undefined, // dato legacy: nunca se guardó esta clave
  });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [lesson] });
  assertEqual(report.results[0].kind, 'recoverable_by_stable_identity', 'se recupera por calendarLessonId, sin fusionar a ciegas');
  assertEqual(report.results[0].matchedCalendarLessonId, lesson.id, 'mismo id real de la clase');
});

test('3) Recuperación por identidad canónica funciona igual para clase INDIVIDUAL y clase GRUPAL', () => {
  const groupLesson = baseCalendarLesson({
    id: 'qa_calendar_group',
    lessonType: 'group',
    participants: [
      { studentId: 'qa_alumno_1', studentName: 'qa_anon_1', level: '' },
      { studentId: 'qa_alumno_2', studentName: 'qa_anon_2', level: '' },
    ],
  });
  const saved = baseSavedLesson({
    calendarLessonId: groupLesson.id,
    calendarReservationKey: undefined,
    form: baseForm({ studentIds: ['qa_alumno_1', 'qa_alumno_2'] }),
  });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [groupLesson] });
  assertEqual(report.results[0].kind, 'recoverable_by_stable_identity', 'clase grupal también se recupera, por el mismo id real');
  assertEqual(report.results[0].matchedCalendarLessonId, groupLesson.id, 'mismo grupo real');
});

// ===========================================================================
// C) Ambigüedad — nunca se fusiona automáticamente
// ===========================================================================

test('4) Dos materializaciones reales duplicadas con la MISMA reservationKey canónica (recurrenceId+occurrenceKey) NUNCA se fusionan automáticamente', () => {
  // Escenario real posible: una duplicación de materialización deja dos
  // CalendarLesson con idéntica identidad de ocurrencia (mismo
  // recurrenceId+recurrenceOccurrenceKey) pero distinto id técnico — la
  // reservationKey calculada es idéntica para ambas.
  const lessonA = baseCalendarLesson({
    id: 'qa_calendar_dup_a',
    recurrenceId: 'qa_rec_dup',
    recurrenceOccurrenceKey: 'qa_key_dup',
  });
  const lessonB = baseCalendarLesson({
    id: 'qa_calendar_dup_b',
    recurrenceId: 'qa_rec_dup',
    recurrenceOccurrenceKey: 'qa_key_dup',
  });
  const saved = baseSavedLesson({
    calendarLessonId: undefined,
    calendarReservationKey: buildCalendarReservationKey(lessonA),
  });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [lessonA, lessonB] });
  assertEqual(report.results[0].kind, 'ambiguous', 'dos candidatos reales — nunca se decide por adivinanza');
  assertEqual(report.results[0].matchedCalendarLessonId, null, 'ningún vínculo automático');
  assertEqual(
    JSON.stringify([...report.results[0].candidateCalendarLessonIds].sort()),
    JSON.stringify(['qa_calendar_dup_a', 'qa_calendar_dup_b']),
    'ambos candidatos quedan registrados para revisión manual, ninguno se descarta'
  );
});

// ===========================================================================
// Clase completada sin registro: honestamente "Sin registrar", nunca inventado
// ===========================================================================

test('6) Clase completada sin SavedLesson real permanece honestamente "Sin registrar" — nunca se le atribuye un registro ajeno', () => {
  const lesson = baseCalendarLesson({ id: 'qa_calendar_no_saved' });
  const report = classifySavedLessonLinkage({ savedLessons: [], calendarLessons: [lesson] });
  assertEqual(report.results.length, 0, 'no hay SavedLesson que clasificar');
  assertEqual(report.completedWithoutSavedLesson.length, 1, 'la clase completada sin registro se reporta aparte');
  assertEqual(report.completedWithoutSavedLesson[0].calendarLessonId, lesson.id, 'identifica la clase real, nunca inventa contenido');
});

test('6b) Un registro sin ninguna CalendarLesson vinculada se clasifica como no_calendar_link — NUNCA un problema, es el caso normal de una ocurrencia virtual o regenerada (evidencia física real: 23 registros reales sin clase materializada)', () => {
  const saved = baseSavedLesson({
    calendarLessonId: undefined,
    calendarReservationKey: undefined,
    form: baseForm({ date: '2099-01-01', time: '00:00' }), // ninguna clase real coincide
  });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [] });
  assertEqual(report.results[0].kind, 'no_calendar_link', 'sin ningún candidato real — normal, no un error');
  assertEqual(report.results[0].matchedCalendarLessonId, null, 'nunca inventa una vinculación');
});

// ===========================================================================
// Recuperación (escritura aditiva, pura): recoverOrphanedSavedLessonLinks
// ===========================================================================

test('7) recoverOrphanedSavedLessonLinks completa la identidad canónica de un huérfano recuperable, sin duplicar ni copiar el registro', () => {
  const lesson = baseCalendarLesson({ id: 'qa_calendar_recover' });
  const orphan = baseSavedLesson({ calendarLessonId: lesson.id, calendarReservationKey: undefined });
  const result = recoverOrphanedSavedLessonLinks({ savedLessons: [orphan], calendarLessons: [lesson] });

  assertEqual(JSON.stringify(result.recoveredSavedLessonIds), JSON.stringify([orphan.id]), 'reporta exactamente el registro reparado');
  assertEqual(result.savedLessons.length, 1, 'sigue siendo UN solo registro — nunca se duplicó');
  const repaired = result.savedLessons[0];
  assertEqual(repaired.id, orphan.id, 'mismo id — nunca una copia nueva');
  assertEqual(repaired.calendarReservationKey, buildCalendarReservationKey(lesson), 'clave de reserva canónica completada');
  assertEqual(JSON.stringify(repaired.form), JSON.stringify(orphan.form), 'el contenido real del registro (asistencia, notas, evaluación) no se toca en absoluto');
});

test('8) recoverOrphanedSavedLessonLinks nunca toca un registro ambiguo ni uno sin vínculo (no_calendar_link — válido igual, no se le inventa una vinculación)', () => {
  const lessonA = baseCalendarLesson({ id: 'qa_calendar_amb_a', recurrenceId: 'qa_rec_amb', recurrenceOccurrenceKey: 'qa_key_amb' });
  const lessonB = baseCalendarLesson({ id: 'qa_calendar_amb_b', recurrenceId: 'qa_rec_amb', recurrenceOccurrenceKey: 'qa_key_amb' });
  const ambiguous = baseSavedLesson({
    id: 'qa_saved_ambiguous',
    calendarLessonId: undefined,
    calendarReservationKey: buildCalendarReservationKey(lessonA),
  });
  const noCalendarLink = baseSavedLesson({
    id: 'qa_saved_no_calendar_link',
    calendarLessonId: undefined,
    calendarReservationKey: undefined,
  });
  const result = recoverOrphanedSavedLessonLinks({
    savedLessons: [ambiguous, noCalendarLink],
    calendarLessons: [lessonA, lessonB],
  });
  assertEqual(JSON.stringify(result.recoveredSavedLessonIds), '[]', 'nada se repara automáticamente');
  assertEqual(JSON.stringify(result.savedLessons), JSON.stringify([ambiguous, noCalendarLink]), 'ambos registros quedan exactamente igual que antes');
});

test('9) recoverOrphanedSavedLessonLinks es idempotente: una segunda pasada no vuelve a tocar lo ya reparado', () => {
  const lesson = baseCalendarLesson({ id: 'qa_calendar_idempotent' });
  const orphan = baseSavedLesson({ calendarLessonId: lesson.id, calendarReservationKey: undefined });
  const firstPass = recoverOrphanedSavedLessonLinks({ savedLessons: [orphan], calendarLessons: [lesson] });
  const secondPass = recoverOrphanedSavedLessonLinks({ savedLessons: firstPass.savedLessons, calendarLessons: [lesson] });
  assertEqual(JSON.stringify(secondPass.recoveredSavedLessonIds), '[]', 'segunda pasada: ya está vinculado, nada que reparar');
  assertEqual(JSON.stringify(secondPass.savedLessons), JSON.stringify(firstPass.savedLessons), 'el estado no cambia en la segunda pasada');
});

// ===========================================================================
// Respaldo y restauración
// ===========================================================================

test('10) Respaldo y restauración: la reparación sobrevive un round-trip real de JSON.stringify/parse, y sigue idempotente después', () => {
  const lesson = baseCalendarLesson({ id: 'qa_calendar_backup' });
  const orphan = baseSavedLesson({ calendarLessonId: lesson.id, calendarReservationKey: undefined });
  const repaired = recoverOrphanedSavedLessonLinks({ savedLessons: [orphan], calendarLessons: [lesson] });

  const restored: SavedLesson[] = JSON.parse(JSON.stringify(repaired.savedLessons));
  assertEqual(JSON.stringify(restored), JSON.stringify(repaired.savedLessons), 'el respaldo conserva la reparación exacta');

  const repairAfterRestore = recoverOrphanedSavedLessonLinks({ savedLessons: restored, calendarLessons: [lesson] });
  assertEqual(JSON.stringify(repairAfterRestore.recoveredSavedLessonIds), '[]', 'tras restaurar un respaldo ya reparado, no se vuelve a tocar nada');
});

// ===========================================================================
// Nunca expone datos personales — sólo ids
// ===========================================================================

test('11) El reporte de diagnóstico nunca incluye nombres de alumnos ni contenido del formulario — sólo ids', () => {
  const lesson = baseCalendarLesson();
  const saved = baseSavedLesson({ calendarLessonId: lesson.id, calendarReservationKey: buildCalendarReservationKey(lesson) });
  const report = classifySavedLessonLinkage({ savedLessons: [saved], calendarLessons: [lesson] });
  const serialized = JSON.stringify(report);
  assert(!serialized.includes('qa_anon'), 'nunca incluye nombres de alumnos');
  assert(!serialized.includes('internalNotes'), 'nunca incluye contenido del formulario');
});

// ===========================================================================
// Integridad REAL de SavedLesson (2026-08-28, sexta ronda) — sólo formulario
// inválido o identidad canónica duplicada; NUNCA "sin CalendarLesson".
// ===========================================================================

test('12) findSavedLessonIntegrityIssues: un registro con formulario estructuralmente válido y sin clave duplicada no reporta ningún problema', () => {
  const saved = baseSavedLesson({ form: baseValidForm() });
  const issues = findSavedLessonIntegrityIssues([saved]);
  assertEqual(JSON.stringify(issues), '[]', 'formulario válido, sin duplicado — cero problemas');
});

test('13) findSavedLessonIntegrityIssues: un formulario que no pasa validateNewClassForm (asistencia sin resolver) se reporta como invalid_form', () => {
  const saved = baseSavedLesson({ id: 'qa_saved_invalid_form', form: baseForm() }); // baseForm no resuelve asistencia
  const issues = findSavedLessonIntegrityIssues([saved]);
  assertEqual(issues.length, 1, 'un solo problema real');
  assertEqual(issues[0].kind, 'invalid_form', 'la misma validación real del guardado detecta el formulario incompleto');
  assertEqual(issues[0].savedLessonId, saved.id, 'identifica el registro real');
});

test('14) findSavedLessonIntegrityIssues: dos registros distintos con la misma calendarReservationKey se reportan como duplicate_canonical_key', () => {
  const first = baseSavedLesson({ id: 'qa_saved_dup_1', form: baseValidForm(), calendarReservationKey: 'lesson:qa_dup' });
  const second = baseSavedLesson({ id: 'qa_saved_dup_2', form: baseValidForm(), calendarReservationKey: 'lesson:qa_dup' });
  const issues = findSavedLessonIntegrityIssues([first, second]);
  assertEqual(issues.length, 1, 'sólo el segundo (el que repite la clave ya vista) se reporta');
  assertEqual(issues[0].kind, 'duplicate_canonical_key', 'identidad canónica duplicada — corrupción real');
  assertEqual(issues[0].savedLessonId, second.id, 'el segundo registro es el que entra en conflicto');
  assertEqual(issues[0].relatedSavedLessonId, first.id, 'referencia al primero, real');
});

// ===========================================================================
// PRUEBA PRINCIPAL (evidencia física real, sexta ronda): 23 SavedLesson
// reales, ninguno con CalendarLesson materializada — deben aparecer todos,
// cada uno con su propio contenido, ninguno marcado como inconsistente,
// ninguno copiado/relinkeado/modificado, y sobrevivir un respaldo real.
// ===========================================================================

test('15) PRUEBA PRINCIPAL: 23 SavedLesson válidos sin ninguna CalendarLesson materializada — todos cuentan como registros válidos, ninguno como problema', () => {
  const savedLessons: SavedLesson[] = Array.from({ length: 23 }, (_, index) =>
    baseSavedLesson({
      id: `qa_saved_evidencia_${index + 1}`,
      form: baseValidForm({
        date: '2026-08-12',
        internalNotes: `nota real distinta número ${index + 1}`,
        evaluations: [
          { studentId: 'qa_alumno_1', generalGrade: (index % 10) + 1, skillGrades: {}, strengths: [], areasToImprove: [] },
        ],
      }),
    })
  );

  // Ninguna CalendarLesson materializada para ninguno de los 23 — exactamente la topología reportada.
  const report = classifySavedLessonLinkage({ savedLessons, calendarLessons: [] });
  assertEqual(report.results.length, 23, 'los 23 registros se clasifican, ninguno se descarta');
  assert(
    report.results.every((result) => result.kind === 'no_calendar_link'),
    'sin CalendarLesson materializada es el caso normal — nunca un problema'
  );

  const issues = findSavedLessonIntegrityIssues(savedLessons);
  assertEqual(JSON.stringify(issues), '[]', 'ningún registro válido se marca como inconsistente');

  // Cada uno mantiene su propio contenido real — nunca se reutiliza el de otro.
  const uniqueNotes = new Set(savedLessons.map((saved) => saved.form.internalNotes));
  assertEqual(uniqueNotes.size, 23, 'cada registro conserva su propio contenido, nunca el de otro');
  const uniqueIds = new Set(savedLessons.map((saved) => saved.id));
  assertEqual(uniqueIds.size, 23, 'cada registro tiene su propia identidad permanente (SavedLesson.id)');

  // Respaldo/restauración: round-trip real de JSON.stringify/parse conserva los 23 exactos.
  const restored: SavedLesson[] = JSON.parse(JSON.stringify(savedLessons));
  assertEqual(JSON.stringify(restored), JSON.stringify(savedLessons), 'el respaldo conserva los 23 registros exactos, sin copiar ni fusionar');
  const restoredReport = classifySavedLessonLinkage({ savedLessons: restored, calendarLessons: [] });
  assert(
    restoredReport.results.every((result) => result.kind === 'no_calendar_link'),
    'tras restaurar, siguen siendo válidos — nunca se relinkean por coincidencia'
  );
  assertEqual(JSON.stringify(findSavedLessonIntegrityIssues(restored)), '[]', 'tras restaurar, ninguno pasa a ser inconsistente');
});
