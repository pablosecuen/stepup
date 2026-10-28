// Puerto VERBATIM del original (`src/features/new-class/utils/__tests__/textItemEditDomain.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-14 (a pedido de Joaquín — CORRECCIÓN GENERAL: "no se
 * puede corregir un elemento de texto ya guardado sin borrarlo y volver a
 * escribirlo"): pruebas puras de `replaceChipTextAt`/`replaceTopicTextById`
 * — la lógica real que reemplaza SÓLO el elemento tocado, preservando
 * todo lo demás (posición, otros elementos, estado de "visto/planificado").
 */
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { replaceChipTextAt, replaceTopicTextById } from '../textItemEditDomain.ts';
import type { TopicEntry } from '../../types/index.ts';

// ===========================================================================
// 1) Actividad corta.
// ===========================================================================
test('1) Editar una actividad corta: reemplaza sólo ese elemento, conserva el resto exacto', () => {
  const before = ['Lectura', 'Escritura', 'Repaso'];
  const after = replaceChipTextAt(before, 1, 'Escritura creativa');
  assertEqual(after.length, 3, 'la cantidad de elementos no cambia');
  assertEqual(after[0], 'Lectura', 'el primer elemento no se toca');
  assertEqual(after[1], 'Escritura creativa', 'el elemento editado tiene el texto nuevo');
  assertEqual(after[2], 'Repaso', 'el tercer elemento no se toca');
  assertEqual(before[1], 'Escritura', 'el array original queda intacto — nunca se muta in place');
});

// ===========================================================================
// 2) Actividad extensa y multilínea.
// ===========================================================================
test('2) Editar una actividad extensa y multilínea: el texto largo con saltos de línea sobrevive exacto', () => {
  const longText =
    'Unidad 4 — Present Perfect\nObjetivo: repasar el uso con "ever/never/already/yet".\n\n' +
    'Actividad 1: completar 10 oraciones.\nActividad 2: corregir errores comunes de los alumnos.\n' +
    'Cerrar con una puesta en común oral, sin escribir en el pizarrón.';
  const before = ['Actividad corta', longText.slice(0, 40)];
  const after = replaceChipTextAt(before, 1, longText);
  assertEqual(after[1], longText, 'el texto extenso y multilínea se guarda exacto, sin recortar ni colapsar saltos de línea');
  assert(after[1].split('\n').length === longText.split('\n').length, 'conserva la cantidad exacta de líneas');
});

// ===========================================================================
// 3) Corregir una palabra en el centro sin reescribir el resto.
// ===========================================================================
test('3) Corregir una palabra en el centro: el resultado sigue siendo UN reemplazo completo del elemento, nunca requiere reescribir los demás elementos de la lista', () => {
  const before = ['Presente simple', 'Pasado simple', 'Futuro con going to'];
  // La profesora corrigió sólo la palabra del medio ("simple" → "continuo"),
  // el editor entrega el texto completo corregido — la función pura no
  // necesita saber QUÉ cambió, sólo aplica el resultado final a ESE índice.
  const corrected = 'Pasado continuo';
  const after = replaceChipTextAt(before, 1, corrected);
  assertEqual(after[0], 'Presente simple', 'elemento anterior intacto');
  assertEqual(after[1], corrected, 'sólo el elemento corregido cambia');
  assertEqual(after[2], 'Futuro con going to', 'elemento siguiente intacto');
});

// ===========================================================================
// 4) Objetivo.
// ===========================================================================
test('4) Editar un objetivo: misma función pura, reutilizada — PedagogicalContentSection usa el mismo ChipTextList para objectives', () => {
  const before = ['Mejorar fluidez oral', 'Ampliar vocabulario de negocios'];
  const after = replaceChipTextAt(before, 0, 'Mejorar fluidez oral en contextos formales');
  assertEqual(after[0], 'Mejorar fluidez oral en contextos formales', 'el primer objetivo tiene el texto corregido');
  assertEqual(after[1], 'Ampliar vocabulario de negocios', 'el segundo objetivo no se toca');
});

// ===========================================================================
// 5) Contenido pedagógico (Temas) — preserva el estado planificado/visto.
// ===========================================================================
test('5) Editar contenido pedagógico (un tema): reemplaza sólo el texto, conserva id y status (planificado/visto) exactos', () => {
  const before: TopicEntry[] = [
    { id: 'topic_1', text: 'Presente perfecto', status: 'visto' },
    { id: 'topic_2', text: 'Voz pasiva', status: 'planificado' },
  ];
  const after = replaceTopicTextById(before, 'topic_1', 'Presente perfecto continuo');
  assertEqual(after[0].text, 'Presente perfecto continuo', 'texto corregido');
  assertEqual(after[0].status, 'visto', 'el estado "visto" no se pierde al corregir el texto');
  assertEqual(after[0].id, 'topic_1', 'la identidad del tema no cambia — nunca se borra y se crea de nuevo');
  assertEqual(after[1].text, 'Voz pasiva', 'el otro tema no se toca');
  assertEqual(after[1].status, 'planificado', 'el estado del otro tema no se toca');
});

test('5b) Editar un tema por id que no existe: la lista vuelve idéntica (defensivo, nunca crea un elemento fantasma)', () => {
  const before: TopicEntry[] = [{ id: 'topic_1', text: 'Presente perfecto', status: 'visto' }];
  const after = replaceTopicTextById(before, 'no-existe', 'texto nuevo');
  assertEqual(after.length, 1, 'no agrega ni quita elementos');
  assertEqual(after[0].text, 'Presente perfecto', 'nada cambia si el id no existe');
});

// ===========================================================================
// 10) Serie recurrente: editar el texto de UNA ocurrencia/registro nunca
// afecta a otro registro independiente (misma lógica de "sólo ese campo").
// ===========================================================================
test('10) Serie recurrente: editar las actividades de un registro nunca altera las de otro registro independiente de la misma serie', () => {
  const occurrence1Activities = ['Actividad A', 'Actividad B'];
  const occurrence2Activities = ['Actividad A', 'Actividad B'];
  const editedOccurrence1 = replaceChipTextAt(occurrence1Activities, 0, 'Actividad A corregida');
  assertEqual(editedOccurrence1[0], 'Actividad A corregida', 'la ocurrencia editada tiene el texto nuevo');
  assertEqual(occurrence2Activities[0], 'Actividad A', 'la otra ocurrencia de la misma serie queda exactamente igual — arrays independientes, nunca se comparten por referencia');
});

// ===========================================================================
// 13/14) Persistencia: round-trip JSON (simula AsyncStorage / respaldo).
// ===========================================================================
test('13) Cerrar y reabrir (round-trip JSON, simula AsyncStorage): el texto editado sobrevive exacto', () => {
  const edited = replaceChipTextAt(['Actividad vieja'], 0, 'Actividad corregida\ncon salto de línea');
  const persisted = JSON.parse(JSON.stringify({ activities: edited }));
  assertEqual(persisted.activities[0], 'Actividad corregida\ncon salto de línea', 'sobrevive exacto, incluido el salto de línea');
});

test('14) Respaldar y restaurar (mismo round-trip que usa el contrato de respaldo real): el texto editado de actividades/objetivos/temas sobrevive sin migración — el esquema (string[] / TopicEntry[]) no cambió', () => {
  const savedLessonLike = {
    id: 'lesson_1',
    form: {
      activities: replaceChipTextAt(['Vieja'], 0, 'Corregida'),
      objectives: replaceChipTextAt(['Objetivo viejo'], 0, 'Objetivo corregido'),
      topics: replaceTopicTextById(
        [{ id: 'topic_1', text: 'Tema viejo', status: 'planificado' }] as TopicEntry[],
        'topic_1',
        'Tema corregido'
      ),
    },
  };
  const restored = JSON.parse(JSON.stringify(savedLessonLike));
  assertEqual(restored.form.activities[0], 'Corregida', 'actividades corregidas sobreviven al respaldo/restauración');
  assertEqual(restored.form.objectives[0], 'Objetivo corregido', 'objetivos corregidos sobreviven al respaldo/restauración');
  assertEqual(restored.form.topics[0].text, 'Tema corregido', 'temas corregidos sobreviven al respaldo/restauración');
  assertEqual(restored.form.topics[0].status, 'planificado', 'el estado del tema sobrevive junto con el texto corregido');
});

// ===========================================================================
// 18) Unicode, tildes, ñ y saltos de línea.
// ===========================================================================
test('18) Unicode, tildes, ñ y saltos de línea sobreviven exactos, en chips y en temas', () => {
  const withUnicode = 'Repasar “ñ”, tildes (café, acción) y emojis 🎉 — línea 1\nlínea 2 con salto real';
  const chips = replaceChipTextAt(['placeholder'], 0, withUnicode);
  assertEqual(chips[0], withUnicode, 'ChipTextList: el texto unicode/con saltos de línea se guarda exacto');

  const topics = replaceTopicTextById(
    [{ id: 't1', text: 'placeholder', status: 'planificado' }] as TopicEntry[],
    't1',
    withUnicode
  );
  assertEqual(topics[0].text, withUnicode, 'TopicChecklist: el texto unicode/con saltos de línea se guarda exacto');

  // Round-trip JSON también preserva unicode/saltos de línea (no se escapan mal).
  const roundTripped = JSON.parse(JSON.stringify({ text: withUnicode }));
  assertEqual(roundTripped.text, withUnicode, 'unicode y saltos de línea sobreviven también a un round-trip JSON real');
});

// ===========================================================================
// 12) Guardar y comprobar actualización inmediata (nueva referencia de array).
// ===========================================================================
test('12) Guardar produce una referencia de array NUEVA (nunca muta la existente) — la UI de React se actualiza de inmediato al recibir un array distinto', () => {
  const before = ['Actividad'];
  const after = replaceChipTextAt(before, 0, 'Actividad corregida');
  assert(after !== before, 'nunca reutiliza la misma referencia — React detecta el cambio y re-renderiza de inmediato');
});
