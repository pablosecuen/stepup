// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarClassTitle.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-01 (a pedido de Joaquín — nombre editable de la
 * clase): pruebas de `lessonDisplayTitle` (fuente única de verdad del
 * título visible) y de las utilidades de validación/normalización de
 * `calendarClassTitle.ts` — nunca modifican `studentName`/`participants`.
 */
import type { CalendarLesson } from '../../types/index.ts';
import { lessonDisplayTitle, resolveDraftClassTitle } from '../calendarParticipants.ts';
import { CLASS_TITLE_MAX_LENGTH, normalizeClassTitle, validateClassTitleInput } from '../calendarClassTitle.ts';
import { assert, assertEqual, test } from './testHarness.ts';

function lesson(overrides: Partial<CalendarLesson> & { id: string }): CalendarLesson {
  return {
    studentId: '',
    studentName: 'Sin alumnos',
    level: '',
    participants: [],
    lessonType: 'individual',
    start: '2026-07-13T13:00:00.000Z',
    end: '2026-07-13T14:00:00.000Z',
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

test('lessonDisplayTitle: sin alumnos y sin título propio muestra "Clase sin alumnos"', () => {
  assertEqual(lessonDisplayTitle(lesson({ id: 'l1' })), 'Clase sin alumnos', 'texto genérico sin alumnos');
});

test('lessonDisplayTitle: un solo alumno y sin título propio muestra el nombre del alumno', () => {
  const withOne = lesson({
    id: 'l1',
    studentId: 's1',
    participants: [{ studentId: 's1', studentName: 'Juan Pérez', level: 'B1' }],
  });
  assertEqual(lessonDisplayTitle(withOne), 'Juan Pérez', 'muestra el nombre real del único alumno');
});

test('lessonDisplayTitle: varios alumnos y sin título propio muestra "Clase grupal · N alumnos"', () => {
  const withMany = lesson({
    id: 'l1',
    participants: [
      { studentId: 's1', studentName: 'Juan Pérez', level: 'B1' },
      { studentId: 's2', studentName: 'Ana Gómez', level: 'A2' },
      { studentId: 's3', studentName: 'Bruno Díaz', level: 'C1' },
    ],
  });
  assertEqual(lessonDisplayTitle(withMany), 'Clase grupal · 3 alumnos', 'cuenta real de participantes, nunca un nombre individual');
});

test('lessonDisplayTitle: con título propio, éste gana sin importar cuántos alumnos tenga la clase', () => {
  const withTitleNoStudents = lesson({ id: 'l1', classTitle: 'Conversación B2' });
  const withTitleAndStudents = lesson({
    id: 'l2',
    classTitle: 'Conversación B2',
    participants: [{ studentId: 's1', studentName: 'Juan Pérez', level: 'B1' }],
  });
  assertEqual(lessonDisplayTitle(withTitleNoStudents), 'Conversación B2', 'gana el título propio, sin alumnos');
  assertEqual(lessonDisplayTitle(withTitleAndStudents), 'Conversación B2', 'gana el título propio, con alumnos');
});

test('lessonDisplayTitle: un título propio compuesto sólo de espacios se ignora, nunca se muestra en blanco', () => {
  const withBlankTitle = lesson({ id: 'l1', classTitle: '   ' });
  assertEqual(lessonDisplayTitle(withBlankTitle), 'Clase sin alumnos', 'un título en blanco no cuenta como título propio — vuelve al automático');
});

test('normalizeClassTitle: recorta espacios al inicio/fin', () => {
  assertEqual(normalizeClassTitle('  Grupo de los lunes  '), 'Grupo de los lunes', 'espacios recortados');
});

test('normalizeClassTitle: un valor vacío o sólo espacios se normaliza a undefined (elimina el título propio)', () => {
  assertEqual(normalizeClassTitle(''), undefined, 'vacío → undefined');
  assertEqual(normalizeClassTitle('   '), undefined, 'sólo espacios → undefined');
});

test('validateClassTitleInput: un nombre normal se acepta', () => {
  const result = validateClassTitleInput('Preparación IELTS');
  assert(result.isValid, 'nombre normal válido');
  assertEqual(result.error, null, 'sin mensaje de error');
});

test(`validateClassTitleInput: rechaza más de ${CLASS_TITLE_MAX_LENGTH} caracteres`, () => {
  const tooLong = 'x'.repeat(CLASS_TITLE_MAX_LENGTH + 1);
  const result = validateClassTitleInput(tooLong);
  assert(!result.isValid, 'se rechaza por longitud');
  assert(!!result.error, 'trae un mensaje de error');
});

test(`validateClassTitleInput: acepta exactamente ${CLASS_TITLE_MAX_LENGTH} caracteres (límite inclusive)`, () => {
  const exact = 'x'.repeat(CLASS_TITLE_MAX_LENGTH);
  const result = validateClassTitleInput(exact);
  assert(result.isValid, 'el límite exacto es válido');
});

test('validateClassTitleInput: acepta letras, números y signos de puntuación normales', () => {
  const result = validateClassTitleInput("Grupo de los lunes N°2 (avanzado) — 18:00");
  assert(result.isValid, 'letras, números y puntuación normal se aceptan');
});

// ---------------------------------------------------------------------------
// resolveDraftClassTitle — Corrección 2026-09-02 (a pedido de Joaquín —
// editar el nombre de una serie ANTES de guardar): única fuente que resuelve
// el `classTitle` a persistir y la vista previa ("Nombre actual") a partir
// de lo que la profesora tipeó y los participantes elegidos hasta ahora —
// reutilizada por `NewCalendarLessonSheet.tsx` (crear serie) y
// `AddParticipantsSheet.tsx` (agregar alumnos / editar participantes desde
// una fecha). El campo vacío del formulario ES el estado explícito de "sigue
// el automático" — nunca se determina comparando el texto tipeado contra el
// nombre automático calculado.
// ---------------------------------------------------------------------------

test('resolveDraftClassTitle: 1 alumno, campo sin tocar (vacío) → nombre automático del alumno', () => {
  const result = resolveDraftClassTitle('', [{ studentName: 'Juan Pérez' }]);
  assertEqual(result.classTitle, undefined, 'sin título propio a persistir: sigue el automático para siempre');
  assertEqual(result.displayTitle, 'Juan Pérez', 'la vista previa muestra el nombre real del único alumno');
});

test('resolveDraftClassTitle: varios alumnos, campo sin tocar (vacío) → regla grupal automática existente, sin inventar otra', () => {
  const result = resolveDraftClassTitle('', [
    { studentName: 'Juan Pérez' },
    { studentName: 'Ana Gómez' },
    { studentName: 'Bruno Díaz' },
  ]);
  assertEqual(result.classTitle, undefined, 'sin título propio a persistir');
  assertEqual(result.displayTitle, 'Clase grupal · 3 alumnos', 'EXACTAMENTE la misma regla que lessonDisplayTitle, nunca otra fórmula');
});

test('resolveDraftClassTitle: sin ningún alumno todavía, campo sin tocar → "Clase sin alumnos"', () => {
  const result = resolveDraftClassTitle('', []);
  assertEqual(result.classTitle, undefined, 'sin título propio a persistir');
  assertEqual(result.displayTitle, 'Clase sin alumnos', 'mismo texto genérico que el resto de la app');
});

test('resolveDraftClassTitle: nombre personalizado tipeado por la profesora se conserva y gana la vista previa', () => {
  const result = resolveDraftClassTitle('Grupo de los martes', [
    { studentName: 'Juan Pérez' },
    { studentName: 'Ana Gómez' },
  ]);
  assertEqual(result.classTitle, 'Grupo de los martes', 'el título personalizado es lo que se persiste');
  assertEqual(result.displayTitle, 'Grupo de los martes', 'la vista previa muestra el personalizado, nunca el automático de fondo');
});

test('resolveDraftClassTitle: cambiar los participantes NUNCA pisa un título ya personalizado (se llama de nuevo con el mismo texto)', () => {
  const withTwo = resolveDraftClassTitle('Grupo de los martes', [
    { studentName: 'Juan Pérez' },
    { studentName: 'Ana Gómez' },
  ]);
  // Simula agregar un tercer alumno DENTRO de la misma edición: el texto
  // tipeado (el único estado real del formulario) no cambia solo.
  const withThree = resolveDraftClassTitle('Grupo de los martes', [
    { studentName: 'Juan Pérez' },
    { studentName: 'Ana Gómez' },
    { studentName: 'Bruno Díaz' },
  ]);
  assertEqual(withTwo.classTitle, withThree.classTitle, 'el título personalizado sigue exactamente igual tras cambiar participantes');
  assertEqual(withThree.displayTitle, 'Grupo de los martes', 'la vista previa sigue mostrando el personalizado, no el conteo nuevo de alumnos');
});

test('resolveDraftClassTitle: borrar por completo el personalizado recupera el automático de los participantes actuales', () => {
  const withCustom = resolveDraftClassTitle('Grupo de los martes', [{ studentName: 'Juan Pérez' }]);
  assertEqual(withCustom.classTitle, 'Grupo de los martes', 'antes de borrar: personalizado');

  const cleared = resolveDraftClassTitle('', [{ studentName: 'Juan Pérez' }]);
  assertEqual(cleared.classTitle, undefined, 'después de borrar por completo: vuelve a "sin título propio"');
  assertEqual(cleared.displayTitle, 'Juan Pérez', 'la vista previa recupera el automático de los participantes actuales');
});

test('resolveDraftClassTitle: un campo con sólo espacios se trata igual que vacío (recupera el automático)', () => {
  const result = resolveDraftClassTitle('   ', [{ studentName: 'Juan Pérez' }, { studentName: 'Ana Gómez' }]);
  assertEqual(result.classTitle, undefined, 'sólo espacios nunca se persiste como título propio');
  assertEqual(result.displayTitle, 'Clase grupal · 2 alumnos', 'la vista previa cae en el automático grupal');
});

test('resolveDraftClassTitle: guardar por primera vez conserva exactamente el título elegido (round-trip por lessonDisplayTitle)', () => {
  const chosen = resolveDraftClassTitle('Conversación B2', [{ studentName: 'Juan Pérez' }]);
  // Simula la clase/serie YA guardada, releída con el motor real de
  // visualización — el título elegido sobrevive intacto.
  const persisted = lessonDisplayTitle({
    classTitle: chosen.classTitle,
    participants: [{ studentName: 'Juan Pérez' }],
  });
  assertEqual(persisted, 'Conversación B2', 'el título elegido antes de guardar se conserva tal cual después');
});
