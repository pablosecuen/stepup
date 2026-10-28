// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/cancelledSlotReuse.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-18, revisada el mismo día (CORRECCIÓN URGENTE — FALTA
 * "REEMPLAZAR ESTA CLASE", tras prueba física real: cancelar una clase
 * futura con el botón directo "Cancelar esta clase" nunca mostraba la
 * acción). Pruebas puras (sin React/RN) de `cancelledSlotReuse.ts` —
 * elegibilidad real (`status === 'cancelled'`, sin ningún lookup de
 * `SavedLesson`) y el preset de fecha/hora/duración/modalidad que arma la
 * clase de reemplazo. También cubre, con las funciones REALES ya
 * existentes (nunca reimplementadas), las reglas de integridad, conflictos,
 * series, layout visual y motor financiero que este flujo debe respetar.
 *
 * Corrección puntual 2026-08-18 (REEMPLAZO SÓLO EN HORARIOS FUTUROS): la
 * elegibilidad ya no es sólo `status === 'cancelled'` — también exige un
 * horario futuro válido y que no exista ya un reemplazo activo. Todas las
 * pruebas de elegibilidad fijan `NOW` explícitamente (nunca `Date.now()`
 * real) para que el resultado sea 100% determinista.
 */
import type { CalendarLesson } from '../../types/index.ts';
import type { EventType, NewClassFormState, SavedLesson } from '../../../new-class/types/index.ts';
import { buildReuseSlotPreset, hasActiveReplacementForCancelledSlot, hasRegisteredCancellationOutcome, hideCancelledLessonsWithActiveReplacement, isEligibleForCancelledSlotReuse } from '../cancelledSlotReuse.ts';
import { buildCancelledCalendarLessonMutation } from '../calendarRecurrenceMutations.ts';
import { findCalendarConflicts, hasBlockingConflict } from '../calendarConflicts.ts';
import { computeLessonColumnLayout } from '../calendarLessonLayout.ts';
import { computeLessonBilledAmount } from '../../../new-class/utils/lessonRegistrationDomain.ts';
import { assert, assertEqual, test } from './testHarness.ts';

// "Hoy" del caso de aceptación exacto pedido: 18/08/2026.
const NOW = new Date('2026-08-18T12:00:00.000Z');

function makeLesson(overrides: Partial<CalendarLesson> & { id: string; start: string }): CalendarLesson {
  // `new Date(invalid).toISOString()` lanza "Invalid time value" — se
  // calcula de forma defensiva para que probar una fecha de inicio
  // corrupta (caso 7) no reviente el propio fixture antes de llegar a la
  // función real bajo prueba.
  const startTime = new Date(overrides.start).getTime();
  const defaultEnd = Number.isNaN(startTime)
    ? overrides.start
    : new Date(startTime + 60 * 60_000).toISOString();
  return {
    studentId: 'student-1',
    studentName: 'Alumna Uno',
    level: 'B1',
    participants: [{ studentId: 'student-1', studentName: 'Alumna Uno', level: 'B1' }],
    lessonType: 'individual',
    end: defaultEnd,
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

function makeSavedLesson(overrides: { id: string; calendarReservationKey: string; eventType: EventType }): SavedLesson {
  return {
    id: overrides.id,
    createdAt: '2026-08-01T00:00:00.000Z',
    form: {
      eventType: overrides.eventType,
      studentIds: ['student-1'],
      isBillable: true,
    } as unknown as NewClassFormState,
    countsAsClass: overrides.eventType === 'clase_dictada',
    billedAmount: null,
    appliedPolicy: null,
    calendarReservationKey: overrides.calendarReservationKey,
  };
}

// ===========================================================================
// CASO DE ACEPTACIÓN EXACTO del pedido: hoy 18/08/2026, clase recurrente
// 22/08/2026 11:00 60min, cancelada DIRECTAMENTE (nunca registrada
// pedagógicamente — sin ningún SavedLesson asociado). La acción debe
// aparecer igual.
// ===========================================================================
test('CASO DE ACEPTACIÓN: ocurrencia recurrente futura cancelada con "Cancelar esta clase" directo (sin SavedLesson) SÍ muestra la acción', () => {
  const occurrence = makeLesson({
    id: 'calendar_cancelled_rec-1:2026-08-22',
    start: '2026-08-22T14:00:00.000Z', // 11:00 Buenos Aires (UTC-3)
    end: '2026-08-22T15:00:00.000Z',
    status: 'cancelled',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-22',
  });
  // Nunca existió ningún SavedLesson para esta clase — el caso real del
  // botón directo "Cancelar esta clase".
  assert(isEligibleForCancelledSlotReuse(occurrence, [occurrence], NOW), 'una ocurrencia recurrente futura cancelada directamente, sin registrar y sin reemplazo activo, muestra "Reemplazar con otro alumno"');
  assert(!hasRegisteredCancellationOutcome(occurrence, []), 'sin ningún registro pedagógico, "Restaurar esta clase" sigue disponible también');
});

// ===========================================================================
// 1) Cancelada FUTURA sin reemplazo: permite reemplazar.
// ===========================================================================
test('1) Cancelada futura sin reemplazo (clase suelta, sin serie, sin SavedLesson) permite reemplazar', () => {
  const lesson = makeLesson({ id: 'l1', start: '2026-08-19T18:00:00.000Z', status: 'cancelled', isRecurring: false });
  assert(isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'clase suelta cancelada, futura, sin reemplazo: elegible');
});

// ===========================================================================
// 2) Cancelada PASADA: no permite reemplazar, aunque siga cancelled.
// ===========================================================================
test('2) Cancelada pasada (horario ya transcurrido) NO permite reemplazar', () => {
  const lesson = makeLesson({ id: 'l2', start: '2026-08-15T18:00:00.000Z', status: 'cancelled' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'un horario que ya pasó nunca se ofrece para reemplazar, aunque status siga cancelled');
});

// ===========================================================================
// 3) Cancelada EXACTAMENTE en el horario actual: no permite reemplazar.
// ===========================================================================
test('3) Cancelada con inicio EXACTAMENTE igual a "ahora" NO permite reemplazar (no es estrictamente futura)', () => {
  const lesson = makeLesson({ id: 'l3', start: NOW.toISOString(), status: 'cancelled' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'el inicio debe ser POSTERIOR a ahora, nunca igual');
});

// ===========================================================================
// 4) Cancelada FUTURA con reemplazo activo existente: no permite crear otro.
// ===========================================================================
test('4) Cancelada futura CON reemplazo activo ya existente NO permite crear un segundo reemplazo', () => {
  const cancelled = makeLesson({ id: 'l4', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const activeReplacement = makeLesson({
    id: 'l4-replacement',
    start: '2026-08-20T18:00:00.000Z',
    status: 'scheduled',
    freedByLessonId: 'l4',
  });
  assert(hasActiveReplacementForCancelledSlot(cancelled, [cancelled, activeReplacement]), 'el reemplazo activo se detecta');
  assert(!isEligibleForCancelledSlotReuse(cancelled, [cancelled, activeReplacement], NOW), 'con un reemplazo ya activo, no se ofrece crear otro');
});

test('4b) Un reemplazo COMPLETADO (la clase de reemplazo ya se dictó) también cuenta como activo — sigue ocupando el horario', () => {
  const cancelled = makeLesson({ id: 'l4b', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const completedReplacement = makeLesson({
    id: 'l4b-replacement',
    start: '2026-08-20T18:00:00.000Z',
    status: 'completed',
    freedByLessonId: 'l4b',
  });
  assert(hasActiveReplacementForCancelledSlot(cancelled, [cancelled, completedReplacement]), 'completed también bloquea un segundo reemplazo');
});

test('4c) Un reemplazo vinculado a OTRA clase cancelada (freedByLessonId distinto) nunca bloquea', () => {
  const cancelled = makeLesson({ id: 'l4c', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const unrelatedReplacement = makeLesson({
    id: 'l4c-other-replacement',
    start: '2026-08-20T18:00:00.000Z',
    status: 'scheduled',
    freedByLessonId: 'otra-clase-cancelada-distinta',
  });
  assert(!hasActiveReplacementForCancelledSlot(cancelled, [cancelled, unrelatedReplacement]), 'un freedByLessonId que apunta a otra cancelada no cuenta');
  assert(isEligibleForCancelledSlotReuse(cancelled, [cancelled, unrelatedReplacement], NOW), 'sigue elegible: nadie ocupó específicamente ESTE horario');
});

// ===========================================================================
// 5) Reemplazo eliminado definitivamente: vuelve a liberar el horario.
// ===========================================================================
test('5) Reemplazo eliminado definitivamente (ya no existe en la lista de clases) vuelve a liberar el horario', () => {
  const cancelled = makeLesson({ id: 'l5', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  // El reemplazo existía, pero se borró por completo — allLessons ya no lo contiene.
  const allLessonsAfterDeletion: CalendarLesson[] = [cancelled];
  assert(!hasActiveReplacementForCancelledSlot(cancelled, allLessonsAfterDeletion), 'sin ningún registro con ese freedByLessonId, no hay reemplazo activo');
  assert(isEligibleForCancelledSlotReuse(cancelled, allLessonsAfterDeletion, NOW), 'el horario vuelve a estar disponible para un nuevo reemplazo');
});

// ===========================================================================
// 6) Reemplazo cancelado: vuelve a estar disponible.
// ===========================================================================
test('6) Reemplazo que a su vez fue cancelado ya NO cuenta como activo — el horario vuelve a estar disponible', () => {
  const cancelled = makeLesson({ id: 'l6', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const cancelledReplacement = makeLesson({
    id: 'l6-replacement',
    start: '2026-08-20T18:00:00.000Z',
    status: 'cancelled',
    freedByLessonId: 'l6',
  });
  assert(!hasActiveReplacementForCancelledSlot(cancelled, [cancelled, cancelledReplacement]), 'un reemplazo cancelado no bloquea otro reemplazo');
  assert(isEligibleForCancelledSlotReuse(cancelled, [cancelled, cancelledReplacement], NOW), 'con el reemplazo anterior cancelado, se puede volver a reemplazar');
});

// ===========================================================================
// 7) Fecha inválida: no permite reemplazar.
// ===========================================================================
test('7) Fecha de inicio inválida (dato corrupto) NUNCA permite reemplazar', () => {
  // `end` se fija a mano (en vez de dejar que el helper lo derive de
  // `start`): derivarlo de una fecha inválida lanzaría "Invalid time
  // value" en el propio fixture, antes siquiera de llegar a la función
  // real bajo prueba.
  const lesson = makeLesson({ id: 'l7', start: 'fecha-invalida', end: '2026-08-20T19:00:00.000Z', status: 'cancelled' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'una fecha que no se puede parsear nunca habilita la acción');
});

// ===========================================================================
// 2-5 (ronda anterior) Elegibilidad ya no depende de ningún registro
// pedagógico ni de un texto visual específico — sólo status + horario +
// ausencia de reemplazo activo.
// ===========================================================================
test('8) Cancelada con aviso YA REGISTRADA, futura y sin reemplazo, también permite reemplazar (sigue siendo status cancelled)', () => {
  const lesson = makeLesson({ id: 'l8', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const saved = makeSavedLesson({ id: 's8', calendarReservationKey: 'lesson:l8', eventType: 'cancelada_con_aviso' });
  assert(isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'elegible: la clase está cancelada y es futura, sin importar el origen');
  assert(hasRegisteredCancellationOutcome(lesson, [saved]), 'pero SÍ tiene un registro real — esto oculta "Restaurar", nunca "Reemplazar"');
});

test('9) Una clase todavía activa (scheduled) NUNCA muestra la acción', () => {
  const lesson = makeLesson({ id: 'l9', start: '2026-08-20T18:00:00.000Z', status: 'scheduled' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'una clase futura todavía vigente nunca se ofrece como horario libre');
});

test('10) Una clase completada (cualquiera de los otros 6 resultados registrados) NUNCA muestra la acción', () => {
  const lesson = makeLesson({ id: 'l10', start: '2026-08-20T18:00:00.000Z', status: 'completed' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'clase_dictada, cancelada_tarde, profesora_ausente, feriado, reprogramada y alumno_ausente dejan status completed — nunca elegibles');
});

test('11) Una clase reprogramada (status rescheduled) NUNCA muestra la acción', () => {
  const lesson = makeLesson({ id: 'l11', start: '2026-08-20T18:00:00.000Z', status: 'rescheduled' });
  assert(!isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'rescheduled no es cancelled');
});

test('11b) hasRegisteredCancellationOutcome es false para cualquier eventType distinto de cancelada_con_aviso, incluso si la clase está cancelada', () => {
  const lesson = makeLesson({ id: 'l11b', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const savedTarde = makeSavedLesson({ id: 's11b', calendarReservationKey: 'lesson:l11b', eventType: 'cancelada_tarde' });
  assert(!hasRegisteredCancellationOutcome(lesson, [savedTarde]), 'cancelada_tarde nunca oculta Restaurar');
});

// ===========================================================================
// 12) Precarga fecha, hora y duración correctas.
// ===========================================================================
test('12) buildReuseSlotPreset: fecha/hora/duración/modalidad exactas de la clase cancelada', () => {
  const lesson = makeLesson({
    id: 'l12',
    start: '2026-08-17T21:30:00.000Z',
    end: '2026-08-17T22:45:00.000Z',
    modality: 'online',
  });
  const preset = buildReuseSlotPreset(lesson);
  assertEqual(preset.durationMinutes, 75, 'duración exacta (75 minutos)');
  assertEqual(preset.modality, 'online', 'modalidad exacta');
  assertEqual(preset.freedByLessonId, 'l12', 'vínculo hacia la clase cancelada real');
  assertEqual(new Date(preset.date).toDateString(), lesson.start ? new Date(lesson.start).toDateString() : '', 'la fecha corresponde al mismo día calendario de la clase cancelada');
});

// ===========================================================================
// 13) Permite elegir otro alumno — el preset nunca incluye un alumno
// preseleccionado (a diferencia de otros presets del mismo mecanismo).
// ===========================================================================
test('13) El preset nunca incluye un alumno preseleccionado — la profesora elige desde cero', () => {
  const lesson = makeLesson({ id: 'l13', start: '2026-08-20T18:00:00.000Z' });
  const preset = buildReuseSlotPreset(lesson);
  assert(!('presetStudentId' in preset), 'ReuseSlotPreset no tiene ningún campo de alumno — nunca hereda al alumno de la clase cancelada');
});

// ===========================================================================
// 14) Grupo: la cancelada tenía varios participantes — todos deben
// excluirse, no sólo el primero.
// ===========================================================================
test('14) Clase grupal cancelada, futura y sin reemplazo: todos los participantes originales quedan disponibles para excluir, no sólo uno', () => {
  const lesson = makeLesson({
    id: 'l14',
    start: '2026-08-20T18:00:00.000Z',
    status: 'cancelled',
    lessonType: 'group',
    participants: [
      { studentId: 'a', studentName: 'Alumno A', level: 'B1' },
      { studentId: 'b', studentName: 'Alumno B', level: 'B1' },
      { studentId: 'c', studentName: 'Alumno C', level: 'B1' },
    ],
  });
  assert(isEligibleForCancelledSlotReuse(lesson, [lesson], NOW), 'un grupo cancelado, futuro y sin reemplazo, también es elegible');
  const excludeIds = lesson.participants.map((participant) => participant.studentId);
  assertEqual(excludeIds.join(','), 'a,b,c', 'los tres participantes originales del grupo se excluyen del selector de reemplazo');
});

// ===========================================================================
// 15) La original continúa cancelada — reutiliza EXACTAMENTE el mismo
// mecanismo real de "Cancelar esta clase", nunca uno nuevo.
// ===========================================================================
test('15) buildCancelledCalendarLessonMutation (mismo mecanismo real de "Cancelar esta clase"): status sigue cancelled, participantes/fecha/serie intactos', () => {
  const lesson = makeLesson({
    id: 'l15',
    start: '2026-08-20T18:00:00.000Z',
    status: 'cancelled',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-20',
  });
  const mutation = buildCancelledCalendarLessonMutation(lesson);
  assertEqual(mutation.lesson.status, 'cancelled', 'sigue cancelada');
  assertEqual(mutation.lesson.start, lesson.start, 'fecha/hora intactas');
  assertEqual(mutation.lesson.studentId, lesson.studentId, 'nunca cambia de alumno');
  assertEqual(mutation.lesson.recurrenceId, 'rec-1', 'sigue perteneciendo a la misma serie');
  assert(mutation.exception !== null, 'conserva su excepción de cancelación real');
});

// ===========================================================================
// 16) La sustituta tiene identidad independiente.
// ===========================================================================
test('16) La clase de reemplazo nunca reutiliza el id de la cancelada — sólo lleva freedByLessonId como referencia', () => {
  const cancelled = makeLesson({ id: 'cancelled-1', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const preset = buildReuseSlotPreset(cancelled);
  const substitute = makeLesson({
    id: 'substitute-1',
    start: '2026-08-20T18:00:00.000Z',
    freedByLessonId: preset.freedByLessonId,
    participants: [{ studentId: 'student-2', studentName: 'Alumna Nueva', level: 'B1' }],
  });
  assert(substitute.id !== cancelled.id, 'ids completamente distintos');
  assertEqual(substitute.freedByLessonId, 'cancelled-1', 'sólo el vínculo informativo apunta a la cancelada');
  assertEqual(substitute.participants[0].studentId, 'student-2', 'el alumno de la sustituta es el elegido, no el original');
  assert(!isEligibleForCancelledSlotReuse(cancelled, [cancelled, substitute], NOW), 'apenas se crea la sustituta (status scheduled por defecto), la cancelada deja de ofrecer un nuevo reemplazo');
});

// ===========================================================================
// 17/18) No modifica la serie original ni agrega participantes a semanas
// futuras — el vínculo es puramente informativo, nunca toca RecurrenceRule.
// La serie original continúa igual en semanas posteriores.
// ===========================================================================
test('17/18) La sustituta es una clase suelta (recurrenceId null) — la serie original de la cancelada continúa igual, sin verse afectada', () => {
  const cancelledOccurrence = makeLesson({
    id: 'calendar_cancelled_rec-1:2026-08-22',
    start: '2026-08-22T14:00:00.000Z',
    status: 'cancelled',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-22',
  });
  const laterOccurrenceOfSameSeries = makeLesson({
    id: 'rec-1:2026-08-29',
    start: '2026-08-29T14:00:00.000Z',
    status: 'scheduled',
    isRecurring: true,
    recurrenceId: 'rec-1',
    recurrenceOccurrenceKey: 'rec-1:2026-08-29',
  });
  const preset = buildReuseSlotPreset(cancelledOccurrence);
  const substitute = makeLesson({
    id: 'substitute-2',
    start: cancelledOccurrence.start,
    freedByLessonId: preset.freedByLessonId,
  });
  assertEqual(substitute.recurrenceId, null, 'la sustituta nunca hereda recurrenceId de la cancelada');
  assertEqual(substitute.isRecurring, false, 'por defecto es una clase suelta, nunca una serie');
  assertEqual(laterOccurrenceOfSameSeries.status, 'scheduled', 'la semana siguiente de la serie original sigue programada, sin tocar');
  assertEqual(laterOccurrenceOfSameSeries.recurrenceId, 'rec-1', 'sigue perteneciendo exactamente a la misma serie original');
});

// ===========================================================================
// 19/20) Conflictos: nunca choca con la cancelada; sí detecta un bloqueo
// real nuevo (otra clase activa).
// ===========================================================================
test('19) No genera conflicto con la cancelada: el motor real ya excluye status cancelled', () => {
  const cancelled = makeLesson({ id: 'l19', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const substituteStart = cancelled.start;
  const substituteEnd = cancelled.end;
  const conflicts = findCalendarConflicts(substituteStart, substituteEnd, [cancelled]);
  assertEqual(conflicts.length, 0, 'una clase cancelada nunca aparece como conflicto para la sustituta, mismo horario exacto');
});

test('20) Conflicto real: otra clase activa agendada en el mismo horario SÍ bloquea la creación de la sustituta', () => {
  const otherRealLesson = makeLesson({ id: 'l20-other', start: '2026-08-20T18:15:00.000Z', status: 'scheduled' });
  const conflicts = findCalendarConflicts('2026-08-20T18:00:00.000Z', '2026-08-20T19:00:00.000Z', [otherRealLesson]);
  assert(hasBlockingConflict(conflicts), 'un bloqueo real (vacaciones, trabajo, estudios u otra clase) sigue detectándose con el motor real, sin ninguna excepción para este flujo');
});

// ===========================================================================
// 21) Reinicio y restauración de respaldo: conserva correctamente la
// relación cancelada↔reemplazo, y la elegibilidad se recalcula igual.
// ===========================================================================
test('21) Reinicio y restauración de respaldo: freedByLessonId, status cancelled y la elegibilidad (bloqueada por el reemplazo activo) sobreviven un round-trip JSON completo', () => {
  const cancelled = makeLesson({ id: 'l21', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const preset = buildReuseSlotPreset(cancelled);
  const activeReplacement = makeLesson({
    id: 'l21-sub',
    start: '2026-08-20T18:00:00.000Z',
    status: 'scheduled',
    freedByLessonId: preset.freedByLessonId,
  });
  const restored: { lessons: CalendarLesson[] } = JSON.parse(JSON.stringify({ lessons: [cancelled, activeReplacement] }));
  assertEqual(restored.lessons[0].status, 'cancelled', 'la cancelada sigue cancelada tras el round-trip');
  assertEqual(restored.lessons[1].freedByLessonId, 'l21', 'el vínculo sobrevive exacto');
  // Tras "reiniciar"/restaurar el backup, la elegibilidad se recalcula sólo
  // con los datos persistidos — sin ningún estado en memoria perdido, y
  // sigue reconociendo que el reemplazo activo bloquea uno nuevo.
  assert(
    !isEligibleForCancelledSlotReuse(restored.lessons[0], restored.lessons, NOW),
    'después de restaurar, el reemplazo activo persistido sigue bloqueando un segundo reemplazo'
  );
  assert(
    hasActiveReplacementForCancelledSlot(restored.lessons[0], restored.lessons),
    'la relación cancelada↔reemplazo se reconstruye correctamente sólo con freedByLessonId, sin ningún campo adicional en memoria'
  );
});

// ===========================================================================
// 22) Estadísticas: cancelación y clase nueva quedan como eventos
// separados — countsAsClass de cada una depende sólo de SU PROPIO eventType.
// ===========================================================================
test('22) La cancelación (no cuenta) y una futura clase dictada por la sustituta (si cuenta) son eventos financieramente independientes', () => {
  const cancelledSaved = makeSavedLesson({ id: 's22a', calendarReservationKey: 'lesson:l22', eventType: 'cancelada_con_aviso' });
  const substituteSavedLater = makeSavedLesson({ id: 's22b', calendarReservationKey: 'lesson:l22-sub', eventType: 'clase_dictada' });
  assertEqual(cancelledSaved.countsAsClass, false, 'la cancelación con aviso nunca cuenta como clase dictada');
  assertEqual(substituteSavedLater.countsAsClass, true, 'la clase sustituta, cuando se dicte y registre, cuenta con total independencia');
});

// ===========================================================================
// 23) La interfaz no superpone dos tarjetas completas — el layout real ya
// reparte el ancho entre clases que comparten el mismo horario.
// ===========================================================================
test('23) computeLessonColumnLayout (motor real de layout, sin cambios): la cancelada y la sustituta comparten el mismo horario y quedan en columnas separadas, nunca superpuestas', () => {
  const cancelled = makeLesson({ id: 'l23a', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const substitute = makeLesson({ id: 'l23b', start: '2026-08-20T18:00:00.000Z', freedByLessonId: 'l23a' });
  const visible = hideCancelledLessonsWithActiveReplacement([cancelled, substitute]);
  const layout = computeLessonColumnLayout(visible);
  assertEqual(visible.length, 1, 'la cancelada no se dibuja junto al reemplazo activo');
  assertEqual(visible[0]?.id, 'l23b', 'la tarjeta visible es el reemplazo');
  assertEqual(layout[0]?.columnCount, 1, 'el reemplazo recupera el ancho normal del horario');
});

test('23b) un reemplazo cancelado vuelve a liberar visualmente el horario original — y el reemplazo cancelado NUNCA se muestra como segunda tarjeta', () => {
  const cancelled = makeLesson({ id: 'l23c', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const substitute = makeLesson({ id: 'l23d', start: '2026-08-20T18:00:00.000Z', status: 'cancelled', freedByLessonId: 'l23c' });
  const visible = hideCancelledLessonsWithActiveReplacement([cancelled, substitute]);
  assertEqual(visible.length, 1, 'CORRECCIÓN 2026-08-18 — DUPLICACIÓN DE CANCELACIONES: antes ambas quedaban visibles (dos tarjetas grises en el mismo horario); ahora sólo una');
  assert(visible.some((lesson) => lesson.id === 'l23c'), 'la cancelación original vuelve a quedar visible');
  assert(!visible.some((lesson) => lesson.id === 'l23d'), 'el reemplazo que a su vez fue cancelado nunca se muestra — sería la segunda tarjeta gris duplicada');
});

// ===========================================================================
// CORRECCIÓN 2026-08-18 (a pedido de Joaquín — CORREGIR DUPLICACIÓN DE
// CANCELACIONES Y CONGELAR LA ESCALA DE COLORES): las 5 CASOS obligatorios
// de "COMPORTAMIENTO VISUAL OBLIGATORIO" sobre hideCancelledLessonsWithActive-
// Replacement — la ÚNICA fuente real que decide el conjunto visible, ya
// conectada en useWeeklyCalendar.ts (windowDisplayLessons) antes de layout/
// columnas/contadores, y por lo tanto compartida sin diferencia alguna por
// la vista semanal y la vista diaria (mismo WeekTimeGrid.tsx).
// ===========================================================================

test('CASO 1) Cancelación sin reemplazo: se ve una única tarjeta, la original gris — nunca se oculta ni se duplica', () => {
  const cancelled = makeLesson({ id: 'caso1', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const visible = hideCancelledLessonsWithActiveReplacement([cancelled]);
  assertEqual(visible.length, 1, 'una única tarjeta visible');
  assertEqual(visible[0]?.id, 'caso1', 'es la cancelación original, sin ningún reemplazo que la oculte');
});

test('CASO 2) Cancelación con reemplazo activo: se oculta la cancelada, se ve sólo el reemplazo — la cancelación sigue existiendo en los datos', () => {
  const cancelled = makeLesson({ id: 'caso2-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const activeReplacement = makeLesson({ id: 'caso2-rep', start: '2026-08-20T18:00:00.000Z', status: 'scheduled', freedByLessonId: 'caso2-orig' });
  const allLessons = [cancelled, activeReplacement];
  const visible = hideCancelledLessonsWithActiveReplacement(allLessons);
  assertEqual(visible.length, 1, 'sólo una tarjeta visible en ese horario');
  assertEqual(visible[0]?.id, 'caso2-rep', 'la visible es el reemplazo activo, tamaño completo');
  assert(allLessons.some((lesson) => lesson.id === 'caso2-orig'), 'la cancelación original se preserva íntegra en los datos reales, sólo se oculta de la grilla');
});

test('CASO 3) El reemplazo también fue cancelado: se ve sólo la cancelación original, gris — el slot vuelve a estar libre para uno nuevo', () => {
  const cancelled = makeLesson({ id: 'caso3-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const cancelledReplacement = makeLesson({ id: 'caso3-rep', start: '2026-08-20T18:00:00.000Z', status: 'cancelled', freedByLessonId: 'caso3-orig' });
  const allLessons = [cancelled, cancelledReplacement];
  const visible = hideCancelledLessonsWithActiveReplacement(allLessons);
  assertEqual(visible.length, 1, 'nunca dos cancelaciones relacionadas en el mismo horario');
  assertEqual(visible[0]?.id, 'caso3-orig', 'se ve la cancelación original, nunca el intento de reemplazo cancelado');
  assert(allLessons.some((lesson) => lesson.id === 'caso3-rep'), 'el reemplazo cancelado se preserva en los datos, nunca se borra');
  assert(isEligibleForCancelledSlotReuse(cancelled, allLessons, NOW), 'con el reemplazo anterior cancelado, el horario vuelve a estar disponible para uno nuevo, si sigue siendo futuro');
});

test('CASO 4) Cadena: primer reemplazo cancelado, segundo reemplazo activo: se ve sólo el segundo, coral — original y primer intento quedan ocultos', () => {
  const cancelled = makeLesson({ id: 'caso4-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const firstReplacementCancelled = makeLesson({ id: 'caso4-rep1', start: '2026-08-20T18:00:00.000Z', status: 'cancelled', freedByLessonId: 'caso4-orig' });
  const secondReplacementActive = makeLesson({ id: 'caso4-rep2', start: '2026-08-20T18:00:00.000Z', status: 'scheduled', freedByLessonId: 'caso4-orig' });
  const allLessons = [cancelled, firstReplacementCancelled, secondReplacementActive];
  const visible = hideCancelledLessonsWithActiveReplacement(allLessons);
  assertEqual(visible.length, 1, 'una sola tarjeta visible pese a la cadena de 3 clases relacionadas');
  assertEqual(visible[0]?.id, 'caso4-rep2', 'sólo el segundo reemplazo, el activo');
  assert(!visible.some((lesson) => lesson.id === 'caso4-orig'), 'la cancelación original queda oculta');
  assert(!visible.some((lesson) => lesson.id === 'caso4-rep1'), 'el primer intento de reemplazo, cancelado, también queda oculto');
});

test('CASO 8) Nunca aparecen dos cancelaciones relacionadas en el mismo horario, con clases normales de otros horarios sin verse afectadas', () => {
  const cancelled = makeLesson({ id: 'caso8-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const cancelledReplacement = makeLesson({ id: 'caso8-rep', start: '2026-08-20T18:00:00.000Z', status: 'cancelled', freedByLessonId: 'caso8-orig' });
  const unrelatedNormalLesson = makeLesson({ id: 'caso8-normal', start: '2026-08-21T18:00:00.000Z', status: 'scheduled' });
  const visible = hideCancelledLessonsWithActiveReplacement([cancelled, cancelledReplacement, unrelatedNormalLesson]);
  const visibleIds = visible.map((lesson) => lesson.id).sort();
  assertEqual(visibleIds.join(','), 'caso8-normal,caso8-orig', 'exactamente una cancelación por horario relacionado, y la clase normal de otro horario no se toca');
});

test('CASO 18) Los contadores diarios (misma fuente que alimenta el layout) sólo cuentan tarjetas visibles, nunca la cancelación oculta ni el reemplazo cancelado', () => {
  const cancelled = makeLesson({ id: 'caso18-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const activeReplacement = makeLesson({ id: 'caso18-rep', start: '2026-08-20T18:00:00.000Z', status: 'scheduled', freedByLessonId: 'caso18-orig' });
  const normal = makeLesson({ id: 'caso18-normal', start: '2026-08-20T20:00:00.000Z', status: 'scheduled' });
  const visible = hideCancelledLessonsWithActiveReplacement([cancelled, activeReplacement, normal]);
  assertEqual(visible.length, 2, 'un contador construido sobre este mismo arreglo (windowDisplayLessons en useWeeklyCalendar.ts) cuenta exactamente 2, nunca 3');
});

test('CASO 17) Vista semanal y vista diaria consumen exactamente el mismo conjunto — la función no tiene ningún parámetro de "modo de vista"', () => {
  const cancelled = makeLesson({ id: 'caso17-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const activeReplacement = makeLesson({ id: 'caso17-rep', start: '2026-08-20T18:00:00.000Z', status: 'scheduled', freedByLessonId: 'caso17-orig' });
  const resultForWeekView = hideCancelledLessonsWithActiveReplacement([cancelled, activeReplacement]);
  const resultForDayView = hideCancelledLessonsWithActiveReplacement([cancelled, activeReplacement]);
  assertEqual(
    resultForWeekView.map((lesson) => lesson.id).join(','),
    resultForDayView.map((lesson) => lesson.id).join(','),
    'WeekTimeGrid.tsx es el mismo componente para ambas vistas (displayMode "week"/"day"); ambas reciben windowDisplayLessons ya resuelto por esta misma función'
  );
});

test('CASO 20) Reinicio y restauración de respaldo (round-trip JSON) preservan la ocultación correcta de la cadena de reemplazos', () => {
  const cancelled = makeLesson({ id: 'caso20-orig', start: '2026-08-20T18:00:00.000Z', status: 'cancelled' });
  const firstReplacementCancelled = makeLesson({ id: 'caso20-rep1', start: '2026-08-20T18:00:00.000Z', status: 'cancelled', freedByLessonId: 'caso20-orig' });
  const secondReplacementActive = makeLesson({ id: 'caso20-rep2', start: '2026-08-20T18:00:00.000Z', status: 'scheduled', freedByLessonId: 'caso20-orig' });
  const restored: { lessons: CalendarLesson[] } = JSON.parse(
    JSON.stringify({ lessons: [cancelled, firstReplacementCancelled, secondReplacementActive] })
  );
  const visible = hideCancelledLessonsWithActiveReplacement(restored.lessons);
  assertEqual(visible.length, 1, 'tras un round-trip JSON completo, la relación se reconstruye igual — sigue habiendo una sola tarjeta visible');
  assertEqual(visible[0]?.id, 'caso20-rep2', 'sigue siendo el reemplazo activo el que se ve');
});

test('Motor financiero: computeLessonBilledAmount nunca depende de freedByLessonId — el cargo de la sustituta es sólo el plan de SU alumno', () => {
  const baseForm = {
    studentIds: ['student-2'],
    isBillable: true,
    eventType: 'clase_dictada',
    lateCancellationPolicy: null,
    lateCancellationPercentage: null,
  } as unknown as NewClassFormState;
  const amount = computeLessonBilledAmount(baseForm, { 'student-2': 20000 });
  assertEqual(amount, 20000, 'el importe es exactamente el precio plano del alumno nuevo, sin ninguna relación con la clase cancelada');
});
