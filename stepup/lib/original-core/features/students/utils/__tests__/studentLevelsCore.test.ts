// Puerto VERBATIM del original (`src/features/students/utils/__tests__/studentLevelsCore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — niveles combinables): pruebas puras del
 * núcleo de `studentLevelsCore.ts` — mismo patrón que `customLevelsCore.ts`
 * (datos en memoria, sin ningún adaptador real de AsyncStorage). Cubre
 * especialmente el escenario pedido en el QA: A1 -> agregar Infantes -> A1
 * sigue seleccionado -> agregar un tercer nivel -> deseleccionar sólo uno ->
 * los demás permanecen.
 */
import { assert, assertEqual, finishTests, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { joinLevelsForDisplay, normalizeLevelsList, primaryStandardLevel, replacePrimaryStandardLevel, summarizeSelectedLevelsLabel, toggleLevel } from '../studentLevelsCore.ts';

// --- toggleLevel: el corazón de la selección combinable --------------------

test('toggleLevel: seleccionar A1 y después Infantes conserva A1 (nunca lo reemplaza)', () => {
  const step1 = toggleLevel([], 'A1');
  assertEqual(step1.join(','), 'A1', 'A1 queda seleccionado');
  const step2 = toggleLevel(step1, 'Infantes');
  assertEqual(step2.join(','), 'A1,Infantes', 'Infantes se agrega, A1 sigue ahí');
});

test('toggleLevel: agregar un tercer nivel conserva los dos anteriores', () => {
  const step3 = toggleLevel(['A1', 'Infantes'], 'B1');
  assertEqual(step3.join(','), 'A1,Infantes,B1', 'los tres niveles conviven');
});

test('toggleLevel: deseleccionar únicamente uno deja los demás intactos', () => {
  const afterRemove = toggleLevel(['A1', 'Infantes', 'B1'], 'Infantes');
  assertEqual(afterRemove.join(','), 'A1,B1', 'sólo se quita el tocado, en el mismo orden relativo');
});

test('toggleLevel: combinación de varios niveles estándar entre sí', () => {
  const combo = toggleLevel(toggleLevel(['A1'], 'B1'), 'C1');
  assertEqual(combo.join(','), 'A1,B1,C1', 'tres niveles estándar combinados a la vez, ninguno excluye a otro');
});

test('toggleLevel: nunca muta el array recibido', () => {
  const original = ['A1'];
  const snapshot = JSON.stringify(original);
  toggleLevel(original, 'B1');
  assertEqual(JSON.stringify(original), snapshot, 'el array de entrada no cambia');
});

// --- normalizeLevelsList: migración de "level" único a "levels" ------------

test('normalizeLevelsList: un alumno con "levels" ya en array lo conserva tal cual', () => {
  assertEqual(normalizeLevelsList(['A1', 'Infantes']).join(','), 'A1,Infantes', 'se conserva sin tocar');
});

test('normalizeLevelsList: un alumno viejo con "level" singular (antes de esta corrección) migra a un array de uno', () => {
  assertEqual(normalizeLevelsList(undefined, 'B1').join(','), 'B1', 'el nivel viejo nunca se pierde');
});

test('normalizeLevelsList: sin "levels" ni "level" da un array vacío, nunca inventa "A1"', () => {
  assertEqual(normalizeLevelsList(undefined, undefined).length, 0, 'array vacío, no un valor inventado');
});

test('normalizeLevelsList: ignora entradas basura dentro del array (nunca strings vacíos ni tipos ajenos)', () => {
  assertEqual(normalizeLevelsList(['A1', '', '  ', 123 as unknown as string, 'B1']).join(','), 'A1,B1', 'sólo strings reales no vacíos sobreviven');
});

test('normalizeLevelsList: quita duplicados', () => {
  assertEqual(normalizeLevelsList(['A1', 'A1', 'Infantes']).join(','), 'A1,Infantes', 'sin repetidos');
});

// --- joinLevelsForDisplay ----------------------------------------------------

test('joinLevelsForDisplay: une con ", " para mostrar en un único campo de texto', () => {
  assertEqual(joinLevelsForDisplay(['A1', 'Infantes']), 'A1, Infantes', 'formato legible');
  assertEqual(joinLevelsForDisplay([]), '', 'vacío da string vacío, nunca "undefined"');
  assertEqual(joinLevelsForDisplay(['A1']), 'A1', 'un solo nivel se ve exactamente igual que antes de esta corrección');
});

// --- primaryStandardLevel / replacePrimaryStandardLevel ---------------------
// Usados por "Registrar cambio de nivel" y "Reactivar alumno" — los dos
// únicos flujos que siguen operando sobre un solo nivel CEFR, nunca
// rediseñados para multiselección.

test('primaryStandardLevel: encuentra el primer nivel CEFR estándar presente, ignorando los personalizados', () => {
  assertEqual(primaryStandardLevel(['Infantes', 'A1', 'Conversación']), 'A1', 'A1 es el único estándar de la lista');
  assertEqual(primaryStandardLevel(['Infantes', 'Conversación']), null, 'sin ningún estándar, null (nunca inventa uno)');
  assertEqual(primaryStandardLevel([]), null, 'lista vacía, null');
});

test('replacePrimaryStandardLevel: reemplaza sólo la entrada estándar existente, preserva los personalizados intactos', () => {
  const result = replacePrimaryStandardLevel(['A1', 'Infantes'], 'B1');
  assertEqual(result.join(','), 'B1,Infantes', 'A1 se reemplaza por B1, Infantes nunca se toca');
});

test('replacePrimaryStandardLevel: si no había ningún nivel estándar, lo agrega sin borrar los personalizados', () => {
  const result = replacePrimaryStandardLevel(['Infantes'], 'A1');
  assertEqual(result.join(','), 'A1,Infantes', 'se agrega el nuevo estándar, Infantes se conserva');
});

// --- summarizeSelectedLevelsLabel: resumen de "Tus niveles" cerrada --------

test('summarizeSelectedLevelsLabel: muestra los nombres si entran cómodos', () => {
  assertEqual(summarizeSelectedLevelsLabel(['Infantes']), 'Infantes', 'un nombre corto se muestra tal cual');
  assertEqual(summarizeSelectedLevelsLabel(['Infantes', 'Conversación']), 'Infantes, Conversación', 'dos nombres cortos entran');
});

test('summarizeSelectedLevelsLabel: si no entran, muestra la cantidad en vez de romper el layout', () => {
  const longNames = ['Preparación examen internacional', 'Apoyo escolar avanzado', 'Conversación fluida'];
  const label = summarizeSelectedLevelsLabel(longNames);
  assertEqual(label, '3 seleccionados', 'cae a la cantidad cuando los nombres no entran');
});

test('summarizeSelectedLevelsLabel: sin ningún nivel personalizado seleccionado, string vacío', () => {
  assertEqual(summarizeSelectedLevelsLabel([]), '', 'nunca muestra un resumen vacío con puntuación suelta');
});

finishTests('de niveles combinables (núcleo)');
