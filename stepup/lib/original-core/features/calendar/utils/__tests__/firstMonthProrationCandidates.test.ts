// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/firstMonthProrationCandidates.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-14, CUARTA ronda (a pedido de Joaquín — revisión
 * independiente, punto 1: "un entrenamiento está alterando potencialmente
 * la mensualidad normal de clases"): pruebas de COMPORTAMIENTO reales
 * (nunca regex) contra las funciones puras que reúnen "series activas de
 * clase" para el primer mes proporcional — `collectActiveSeriesForStudent`
 * (usada por el panel manual y la reparación automática) y
 * `collectFirstMonthProrationCandidates` (usada en tiempo real al
 * incorporar un alumno). Ambas deben excluir SIEMPRE cualquier serie de
 * entrenamiento — el entrenamiento se cobra aparte, nunca participa del
 * cálculo/prorrateo/reparación de la mensualidad normal de clases.
 */
import type { RecurrenceRule, RecurrenceWeek } from '../../types/index.ts';
import { collectActiveSeriesForStudent, collectFirstMonthProrationCandidates } from '../firstMonthProrationCandidates.ts';
import { assert, assertEqual, test } from './testHarness.ts';

const WEEKLY_MONDAY: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];

function baseRule(overrides: Partial<RecurrenceRule> & { recurrenceId: string }): RecurrenceRule {
  return {
    studentId: 'alumno_1',
    participantIds: ['alumno_1'],
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: WEEKLY_MONDAY,
    modality: 'presencial',
    timezone: 'America/Argentina/Buenos_Aires',
    startDate: '2026-06-01',
    endDate: null,
    status: 'active',
    ...overrides,
  } as RecurrenceRule;
}

test('collectActiveSeriesForStudent: una serie de entrenamiento NUNCA cuenta como serie activa de clase, aunque el alumno participe y esté activa', () => {
  const classRule = baseRule({ recurrenceId: 'r_clase', activityKind: 'class' });
  const trainingRule = baseRule({ recurrenceId: 'r_entrenamiento', activityKind: 'training' });
  const result = collectActiveSeriesForStudent('alumno_1', [classRule, trainingRule]);
  assertEqual(result.length, 1, 'sólo la serie de clase cuenta');
  assertEqual(result[0].recurrenceId, 'r_clase', 'es exactamente la serie de clase, nunca la de entrenamiento');
});

test('collectActiveSeriesForStudent: alumno SOLO con entrenamiento (sin ninguna clase) devuelve una lista vacía — nunca inventa una serie de clase', () => {
  const trainingRule = baseRule({ recurrenceId: 'r_entrenamiento', activityKind: 'training' });
  const result = collectActiveSeriesForStudent('alumno_1', [trainingRule]);
  assertEqual(result.length, 0, 'sin ninguna serie de clase activa, la lista queda vacía');
});

test('collectActiveSeriesForStudent: campo activityKind AUSENTE (serie histórica anterior a esta fase) sigue tratándose como clase — sigue contando normalmente', () => {
  const legacyRule = baseRule({ recurrenceId: 'r_legacy' });
  delete (legacyRule as Partial<RecurrenceRule>).activityKind;
  const result = collectActiveSeriesForStudent('alumno_1', [legacyRule]);
  assertEqual(result.length, 1, 'una regla sin activityKind persistido sigue contando como serie de clase — nunca se excluye por error');
});

test('collectActiveSeriesForStudent: una serie de clase inactiva (status !== active) sigue excluida, igual que antes de esta corrección — el filtro de entrenamiento es adicional, no reemplaza al de status', () => {
  const pausedClass = baseRule({ recurrenceId: 'r_pausada', activityKind: 'class', status: 'paused' });
  const result = collectActiveSeriesForStudent('alumno_1', [pausedClass]);
  assertEqual(result.length, 0, 'una serie pausada sigue sin contar, sea clase o entrenamiento');
});

test('collectFirstMonthProrationCandidates: agregar un alumno a un ENTRENAMIENTO (touchedRecurrenceId es la serie de entrenamiento) nunca produce candidato con series de clase inventadas — sólo reúne sus series de CLASE reales, si las tiene', () => {
  // Caso "alumno mensual sin clases, agregado a entrenamiento": ninguna
  // serie de clase real → activeSeries vacía → el llamador (enqueueForNewlyAddedParticipants)
  // nunca dispara ninguna decisión/cargo de mensualidad normal para este alumno.
  const trainingRule = baseRule({ recurrenceId: 'r_entrenamiento', activityKind: 'training' });
  const withoutClasses = collectFirstMonthProrationCandidates({
    newlyAddedStudentIds: ['alumno_1'],
    touchedRecurrenceId: 'r_entrenamiento',
    recurrenceRules: [trainingRule],
  });
  assertEqual(withoutClasses.length, 1, 'un candidato por alumno recién incorporado, sin importar el tipo de la serie tocada');
  assertEqual(withoutClasses[0].activeSeries.length, 0, 'sin ninguna serie de clase real, activeSeries queda vacía — nunca crea/prorratea una mensualidad de clase inexistente');

  // Caso "alumno mensual CON clases, agregado a entrenamiento": su serie de
  // clase real sigue apareciendo (monto/decisión de clases sin cambios),
  // pero la serie de entrenamiento tocada NUNCA se suma al cálculo.
  const classRule = baseRule({ recurrenceId: 'r_clase', activityKind: 'class' });
  const withClasses = collectFirstMonthProrationCandidates({
    newlyAddedStudentIds: ['alumno_1'],
    touchedRecurrenceId: 'r_entrenamiento',
    recurrenceRules: [trainingRule, classRule],
  });
  assertEqual(withClasses[0].activeSeries.length, 1, 'la serie de clase real sigue contando — su mensualidad no se toca');
  assertEqual(withClasses[0].activeSeries[0].recurrenceId, 'r_clase', 'es la serie de clase, nunca la de entrenamiento recién tocada');
});

test('collectFirstMonthProrationCandidates: una clase normal (serie de clase recién tocada) sigue aplicando el proporcional exactamente igual que antes — no rompe el caso normal', () => {
  const classRule = baseRule({ recurrenceId: 'r_clase_nueva', activityKind: 'class' });
  const result = collectFirstMonthProrationCandidates({
    newlyAddedStudentIds: ['alumno_1'],
    touchedRecurrenceId: 'r_clase_nueva',
    recurrenceRules: [classRule],
  });
  assertEqual(result[0].activeSeries.length, 1, 'la serie de clase recién tocada sigue contando — el caso normal no cambia');
});

test('collectFirstMonthProrationCandidates: campo activityKind ausente en la serie tocada sigue tratándose como clase — sigue disparando el proporcional normal', () => {
  const legacyRule = baseRule({ recurrenceId: 'r_legacy_tocada' });
  delete (legacyRule as Partial<RecurrenceRule>).activityKind;
  const result = collectFirstMonthProrationCandidates({
    newlyAddedStudentIds: ['alumno_1'],
    touchedRecurrenceId: 'r_legacy_tocada',
    recurrenceRules: [legacyRule],
  });
  assertEqual(result[0].activeSeries.length, 1, 'ausente = clase, sigue contando exactamente igual que antes de esta corrección');
});

test('collectFirstMonthProrationCandidates: agregar un participante a un entrenamiento YA EXISTENTE (varios alumnos, series mixtas) nunca mezcla series de entrenamiento de OTROS alumnos en el cálculo de nadie', () => {
  const trainingA = baseRule({ recurrenceId: 'r_entrenamiento_a', studentId: 'alumno_a', participantIds: ['alumno_a', 'alumno_b'], activityKind: 'training' });
  const classB = baseRule({ recurrenceId: 'r_clase_b', studentId: 'alumno_b', participantIds: ['alumno_b'], activityKind: 'class' });
  const result = collectFirstMonthProrationCandidates({
    newlyAddedStudentIds: ['alumno_b'],
    touchedRecurrenceId: 'r_entrenamiento_a',
    recurrenceRules: [trainingA, classB],
  });
  assert(result.length === 1 && result[0].studentId === 'alumno_b', 'un candidato para el alumno recién agregado al entrenamiento');
  assertEqual(result[0].activeSeries.length, 1, 'sólo su propia serie de CLASE cuenta — la serie de entrenamiento (tocada) nunca se suma, sea propia o de otro participante');
  assertEqual(result[0].activeSeries[0].recurrenceId, 'r_clase_b', 'es la serie de clase real del alumno, nunca la de entrenamiento');
});
