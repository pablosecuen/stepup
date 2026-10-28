// Puerto VERBATIM del original (`src/features/students/utils/__tests__/customLevelsCore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — niveles personalizados): pruebas puras
 * del núcleo de `customLevelsCore.ts` — mismo patrón que
 * `reportHistoryCore`/`textItemEditDomain` (datos en memoria, sin ningún
 * adaptador real de AsyncStorage).
 */
import { assert, assertEqual, finishTests, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { addCustomLevelEntry, countStudentsUsingLevel, isDuplicateCustomLevelName, isReservedStandardLevelName, normalizeCustomLevelName, removeCustomLevelEntry, renameCustomLevelEntry } from '../customLevelsCore.ts';
import type { CustomLevel } from '../../types/index.ts';

function level(overrides: Partial<CustomLevel> & { id: string; name: string }): CustomLevel {
  return { createdAt: '2026-08-20T00:00:00.000Z', ...overrides };
}

test('normalizeCustomLevelName: recorta espacios y colapsa espacios internos repetidos', () => {
  assertEqual(normalizeCustomLevelName('  Infantes  '), 'Infantes', 'recorta bordes');
  assertEqual(normalizeCustomLevelName('Apoyo   escolar'), 'Apoyo escolar', 'colapsa espacios internos');
  assertEqual(normalizeCustomLevelName('   '), '', 'sólo espacios da string vacío');
});

test('isReservedStandardLevelName: bloquea los 6 nombres estándar sin importar mayúsculas/espacios, permite todo lo demás', () => {
  assert(isReservedStandardLevelName('A1'), 'coincidencia exacta');
  assert(isReservedStandardLevelName('a1'), 'minúsculas también reservado');
  assert(isReservedStandardLevelName('  B2  '), 'con espacios también reservado');
  assert(!isReservedStandardLevelName('Infantes'), 'nombre genérico libre');
  assert(!isReservedStandardLevelName('A1 avanzado'), 'no es coincidencia exacta, no está reservado');
});

test('isDuplicateCustomLevelName: detecta duplicados sin importar mayúsculas/espacios; excludeId permite renombrar sin chocar contra sí mismo', () => {
  const levels = [level({ id: 'l1', name: 'Infantes' }), level({ id: 'l2', name: 'Conversación' })];
  assert(isDuplicateCustomLevelName(levels, 'infantes'), 'duplicado por minúsculas');
  assert(isDuplicateCustomLevelName(levels, '  Infantes  '), 'duplicado por espacios');
  assert(!isDuplicateCustomLevelName(levels, 'Preescolar'), 'nombre nuevo no es duplicado');
  assert(!isDuplicateCustomLevelName(levels, 'Infantes', 'l1'), 'excludeId permite que un nivel se compare consigo mismo al renombrar');
  assert(isDuplicateCustomLevelName(levels, 'Infantes', 'l2'), 'sigue detectando duplicado contra OTRO nivel aunque se excluya uno distinto');
});

test('addCustomLevelEntry: agrega sin mutar el array original', () => {
  const levels = [level({ id: 'l1', name: 'Infantes' })];
  const snapshot = JSON.stringify(levels);
  const updated = addCustomLevelEntry(levels, level({ id: 'l2', name: 'Conversación' }));
  assertEqual(JSON.stringify(levels), snapshot, 'el array original no cambia');
  assertEqual(updated.length, 2, 'el nuevo array tiene el nivel agregado');
});

test('renameCustomLevelEntry: cambia sólo el nombre del nivel indicado, conserva el resto intacto', () => {
  const levels = [level({ id: 'l1', name: 'Infantes' }), level({ id: 'l2', name: 'Conversación' })];
  const updated = renameCustomLevelEntry(levels, 'l1', 'Preescolar');
  assertEqual(updated[0].name, 'Preescolar', 'nombre actualizado');
  assertEqual(updated[0].id, 'l1', 'id se conserva');
  assertEqual(updated[1].name, 'Conversación', 'el otro nivel no se toca');
});

test('removeCustomLevelEntry: quita sólo el nivel pedido, nunca otros', () => {
  const levels = [level({ id: 'l1', name: 'Infantes' }), level({ id: 'l2', name: 'Conversación' })];
  const updated = removeCustomLevelEntry(levels, 'l1');
  assertEqual(updated.length, 1, 'sólo queda un nivel');
  assertEqual(updated[0].id, 'l2', 'el nivel restante es el correcto');
});

test('countStudentsUsingLevel: cuenta por inclusión en la lista de niveles del alumno (nunca por igualdad exacta de un único valor — un alumno combina varios a la vez), incluyendo alumnos en cualquier estado', () => {
  const students = [
    { levels: ['Infantes'] },
    { levels: ['A1', 'Infantes'] },
    { levels: ['A1'] },
    { levels: ['Conversación'] },
  ];
  assertEqual(countStudentsUsingLevel(students, 'Infantes'), 2, 'dos alumnos tienen "Infantes" entre sus niveles, uno de ellos combinado con A1');
  assertEqual(countStudentsUsingLevel(students, 'A1'), 2, 'funciona igual para un nivel estándar, incluyendo al alumno combinado');
  assertEqual(countStudentsUsingLevel(students, 'Preescolar'), 0, 'cero si nadie lo tiene');
});

finishTests('de niveles personalizados (núcleo)');
