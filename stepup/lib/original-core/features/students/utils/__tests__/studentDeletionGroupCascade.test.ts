// Puerto VERBATIM del original (`src/features/students/utils/__tests__/studentDeletionGroupCascade.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E03, auditoría de simulación
 * anual): antes, eliminar definitivamente a un alumno que era integrante
 * SECUNDARIO de un grupo (nunca el `studentId` primario de la
 * `RecurrenceRule`) no lo quitaba de `participantIds` — las ocurrencias
 * futuras del grupo lo volvían a incluir para siempre. Y si el eliminado
 * era el integrante PRIMARIO, la regla completa se borraba aunque el grupo
 * tuviera otros integrantes vigentes. Estos tests cubren los casos
 * obligatorios de esa corrección contra `buildStudentDeletionCascade`
 * real, incluida la generación de ocurrencias futuras con el motor real de
 * calendario y un ciclo de respaldo/restauración posterior.
 */
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../../calendar/types/index.ts';
import { generateOccurrences } from '../../../calendar/utils/calendarRecurrenceEngine.ts';
import { emptyPaymentsState } from '../../../payments/hooks/paymentsStore.ts';
import { validateBackupFileContents } from '../../../../shared/backup/restoreValidation.ts';
import type { StudentProfile } from '../../../student-profile/types/index.ts';
import type { StudentListItem } from '../../types/index.ts';
import { buildStudentDeletionCascade, type StudentDeletionSnapshots } from '../studentDeletionCascade.ts';
import { assert, assertEqual, test, finishTests } from '../../../calendar/utils/__tests__/testHarness.ts';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

function makeStudent(id: string): StudentListItem {
  return { id, name: `Alumno ${id}` } as StudentListItem;
}

function makeProfile(id: string): StudentProfile {
  return { id } as StudentProfile;
}

/** Regla real (no un cast liviano) — se puede pasar tal cual a `generateOccurrences`. */
function makeGroupRule(recurrenceId: string, participantIds: string[]): RecurrenceRule {
  return {
    recurrenceId,
    studentId: participantIds[0],
    participantIds: participantIds.length > 1 ? participantIds : undefined,
    type: 'weekly',
    cycleLengthWeeks: 1,
    weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }],
    modality: 'presencial',
    timezone: BUENOS_AIRES,
    startDate: '2027-01-04', // lunes real
    endDate: null,
    status: 'active',
  };
}

function emptySnapshot(overrides: Partial<StudentDeletionSnapshots> = {}): StudentDeletionSnapshots {
  return {
    students: [],
    profiles: {},
    savedLessons: [],
    calendarLessons: [],
    recurrenceRules: [],
    recurrenceExceptions: [],
    payments: emptyPaymentsState(),
    reportHistory: [],
    ...overrides,
  };
}

test('grupo de tres: eliminar al SEGUNDO integrante (secundario) lo quita de participantIds, conserva la regla', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({
    students: [makeStudent('A'), makeStudent('B'), makeStudent('C')],
    profiles: { A: makeProfile('A'), B: makeProfile('B'), C: makeProfile('C') },
    recurrenceRules: [rule],
  });

  const result = buildStudentDeletionCascade('B', source);

  assertEqual(result.recurrenceRules.length, 1, 'la regla sobrevive');
  const survivor = result.recurrenceRules[0];
  assertEqual(survivor.studentId, 'A', 'el primario original (A) se conserva, no hacía falta promover');
  assert(survivor.participantIds !== undefined, 'sigue siendo un grupo');
  assertEqual(survivor.participantIds?.length, 2, 'quedan dos integrantes');
  assert(!survivor.participantIds?.includes('B'), 'el eliminado ya no está en participantIds');
  assert(survivor.participantIds?.includes('A') && survivor.participantIds?.includes('C'), 'A y C se conservan');
});

test('grupo de tres: eliminar al TERCER integrante (secundario) lo quita de participantIds, conserva la regla', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({
    students: [makeStudent('A'), makeStudent('B'), makeStudent('C')],
    profiles: { A: makeProfile('A'), B: makeProfile('B'), C: makeProfile('C') },
    recurrenceRules: [rule],
  });

  const result = buildStudentDeletionCascade('C', source);

  const survivor = result.recurrenceRules[0];
  assertEqual(survivor.studentId, 'A', 'el primario original se conserva');
  assertEqual(survivor.participantIds?.length, 2, 'quedan A y B');
  assert(!survivor.participantIds?.includes('C'), 'el eliminado ya no está');
});

test('grupo de tres: eliminar al integrante PRINCIPAL promueve determinísticamente al siguiente, nunca borra la serie', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({
    students: [makeStudent('A'), makeStudent('B'), makeStudent('C')],
    profiles: { A: makeProfile('A'), B: makeProfile('B'), C: makeProfile('C') },
    recurrenceRules: [rule],
  });

  const result = buildStudentDeletionCascade('A', source);

  assertEqual(result.recurrenceRules.length, 1, 'la regla NUNCA debe borrarse solo porque el primario se eliminó');
  const survivor = result.recurrenceRules[0];
  assertEqual(survivor.studentId, 'B', 'se promueve al primer integrante restante en el orden original (B antes que C)');
  assertEqual(survivor.participantIds?.length, 2, 'quedan B y C');
  assert(!survivor.participantIds?.includes('A'), 'el eliminado ya no aparece ni siquiera en participantIds');
});

test('grupo de tres que queda con dos: participantIds nunca incluye al eliminado, sin duplicados', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({ recurrenceRules: [rule] });

  const result = buildStudentDeletionCascade('B', source);
  const survivor = result.recurrenceRules[0];
  const uniqueIds = new Set(survivor.participantIds);
  assertEqual(uniqueIds.size, survivor.participantIds?.length, 'sin ids duplicados en participantIds');
});

test('grupo de dos que queda con uno: deja de ser grupo (participantIds vuelve a undefined)', () => {
  const rule = makeGroupRule('rule-2', ['A', 'B']);
  const source = emptySnapshot({ recurrenceRules: [rule] });

  const result = buildStudentDeletionCascade('B', source);

  assertEqual(result.recurrenceRules.length, 1, 'la regla sobrevive como clase individual');
  const survivor = result.recurrenceRules[0];
  assertEqual(survivor.studentId, 'A', 'A queda como único alumno');
  assertEqual(survivor.participantIds, undefined, 'ya no es un grupo: participantIds vuelve a undefined');
});

test('clase individual cuyo único alumno se elimina: la regla desaparece por completo', () => {
  const rule = makeGroupRule('rule-solo', ['A']);
  const source = emptySnapshot({
    recurrenceRules: [rule],
    recurrenceExceptions: [{ recurrenceId: 'rule-solo', occurrenceKey: 'k1', type: 'cancelled', createdAt: '2027-01-01T00:00:00.000Z' } as RecurrenceException],
  });

  const result = buildStudentDeletionCascade('A', source);

  assertEqual(result.recurrenceRules.length, 0, 'sin nadie que la use, la regla se elimina');
  assertEqual(result.recurrenceExceptions.length, 0, 'las excepciones de la regla eliminada también desaparecen');
});

test('generar ocurrencias futuras después de eliminar: el alumno eliminado nunca reaparece', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({ recurrenceRules: [rule] });

  const result = buildStudentDeletionCascade('B', source);
  const survivingRule = result.recurrenceRules[0];

  const occurrences = generateOccurrences(
    survivingRule,
    new Date('2027-01-01T00:00:00.000Z'),
    new Date('2027-03-01T00:00:00.000Z')
  );

  assert(occurrences.length > 0, 'la regla sigue generando ocurrencias reales');
  for (const occurrence of occurrences) {
    assert(!occurrence.participantIds.includes('B'), 'ninguna ocurrencia futura vuelve a incluir al alumno eliminado');
    assert(occurrence.participantIds.includes('A') && occurrence.participantIds.includes('C'), 'los integrantes restantes siguen presentes en cada ocurrencia futura');
  }
});

test('reiniciar/hidratar y volver a generar: aplicar la cascada dos veces seguidas sobre el mismo resultado es idempotente', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({ recurrenceRules: [rule] });

  const firstPass = buildStudentDeletionCascade('B', source);
  // "reiniciar la app" = tomar el resultado ya persistido como nuevo estado de entrada.
  const secondPass = buildStudentDeletionCascade('B', { ...source, recurrenceRules: firstPass.recurrenceRules });

  assertEqual(
    JSON.stringify(secondPass.recurrenceRules),
    JSON.stringify(firstPass.recurrenceRules),
    'repetir la cascada sobre el estado ya limpio no cambia nada más'
  );
});

test('backup/restauración posterior: la regla resultante de la cascada sigue siendo válida para el respaldo real', () => {
  const rule = makeGroupRule('rule-3', ['A', 'B', 'C']);
  const source = emptySnapshot({ recurrenceRules: [rule] });

  const result = buildStudentDeletionCascade('B', source);

  // Sólo interesa validar la colección recurrenceRules resultante — students/profiles
  // van vacíos a propósito (no son objeto de esta prueba y `makeStudent`/`makeProfile`
  // de este archivo son casts livianos, no pasarían la validación completa de esas colecciones).
  const backup = {
    schemaVersion: 2 as const,
    exportedAt: '2027-01-01T00:00:00.000Z',
    appVersion: 'test',
    students: [],
    profiles: {},
    pedagogicalLessons: result.savedLessons,
    calendarLessons: result.calendarLessons,
    recurrenceRules: result.recurrenceRules,
    recurrenceExceptions: result.recurrenceExceptions,
    teacherAvailability: null,
    paymentCharges: result.payments.charges,
    payments: result.payments.payments,
    paymentAllocations: result.payments.allocations,
    paymentAdjustments: result.payments.adjustments,
  };

  const validated = validateBackupFileContents(JSON.stringify(backup));
  assert(validated.ok, 'la regla con el alumno eliminado ya quitado de participantIds sigue siendo un respaldo válido');
  if (!validated.ok) return;
  const restoredRule = validated.backup.recurrenceRules.find((r) => r.recurrenceId === 'rule-3');
  assert(restoredRule !== undefined, 'la regla sobreviviente se restaura');
  assert(!restoredRule?.participantIds?.includes('B'), 'el alumno eliminado nunca reaparece tras un ciclo de respaldo/restauración');
});

test('el alumno eliminado nunca reaparece: ni como studentId primario, ni en participantIds, en ningún escenario de los de arriba', () => {
  const scenarios: Array<{ participants: string[]; deleted: string }> = [
    { participants: ['A', 'B', 'C'], deleted: 'A' },
    { participants: ['A', 'B', 'C'], deleted: 'B' },
    { participants: ['A', 'B', 'C'], deleted: 'C' },
    { participants: ['A', 'B'], deleted: 'A' },
    { participants: ['A', 'B'], deleted: 'B' },
  ];
  for (const scenario of scenarios) {
    const rule = makeGroupRule(`rule-${scenario.participants.join('')}`, scenario.participants);
    const source = emptySnapshot({ recurrenceRules: [rule] });
    const result = buildStudentDeletionCascade(scenario.deleted, source);
    for (const survivingRule of result.recurrenceRules) {
      assert(survivingRule.studentId !== scenario.deleted, `[${scenario.participants.join(',')} - ${scenario.deleted}] nunca queda como primario`);
      assert(!survivingRule.participantIds?.includes(scenario.deleted), `[${scenario.participants.join(',')} - ${scenario.deleted}] nunca queda en participantIds`);
    }
  }
});

finishTests('de eliminación de alumnos en grupos (E03)');
