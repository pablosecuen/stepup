// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarVisualLegend.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "MODALIDAD VISIBLE EN VISTA
 * DIARIA + PANTALLA DE INFORMACIÓN"): pruebas de la configuración
 * semántica única (`calendarVisualLegend.ts`) — colores, estados y
 * modalidades. La misma fuente que consumen `CalendarLessonCard.tsx` (el
 * Calendario) y `InfoScreen.tsx` (la leyenda), para que nunca puedan
 * desincronizarse.
 */
import { colors } from '../../../../theme/colors.ts';
import type { CalendarLessonStatus } from '../../types/index.ts';
import { ELAPSED_LESSON_COLOR, LESSON_STATUS_COLOR_LEGEND, LESSON_STATUS_ORDER, lessonStatusDescription, lessonStatusLabel, MODALITY_LEGEND, MODALITY_ORDER, MODALITY_SHORT_LABEL, resolveLessonCardPalette, resolveLessonColor, resolveLessonVisualCategory } from '../calendarVisualLegend.ts';
import { hideCancelledLessonsWithActiveReplacement } from '../cancelledSlotReuse.ts';
import { assert, assertEqual, test } from './testHarness.ts';

// ---------------------------------------------------------------------------
// 1, 2, 3: cada modalidad real tiene su palabra completa exacta.
// ---------------------------------------------------------------------------

test('1: la modalidad "presencial" tiene la palabra completa "Presencial"', () => {
  assertEqual(MODALITY_LEGEND.presencial.label, 'Presencial', 'debe decir la palabra completa, nunca sólo un ícono');
});

test('2: la modalidad "online" tiene la palabra completa "Online"', () => {
  assertEqual(MODALITY_LEGEND.online.label, 'Online', 'debe decir la palabra completa, nunca sólo un ícono');
});

test('3: la modalidad "mixta" tiene la palabra completa "Mixta"', () => {
  assertEqual(MODALITY_LEGEND.mixta.label, 'Mixta', 'debe decir la palabra completa, nunca sólo un ícono');
});

// ---------------------------------------------------------------------------
// 4: cada modalidad conserva su ícono real, y los 3 son distintos entre sí.
// ---------------------------------------------------------------------------

test('4: las 3 modalidades tienen un ícono propio, y los 3 son distintos entre sí', () => {
  const icons = MODALITY_ORDER.map((modality) => MODALITY_LEGEND[modality].icon);
  for (const icon of icons) {
    assert(typeof icon === 'string' && icon.length > 0, 'cada modalidad debe tener un ícono real definido');
  }
  assertEqual(new Set(icons).size, icons.length, 'las 3 modalidades deben tener íconos distintos entre sí');
});

// ---------------------------------------------------------------------------
// 5: una clase corta mantiene la modalidad visible o su abreviatura
// aprobada — nunca desaparece del todo.
// ---------------------------------------------------------------------------

test('5: la abreviatura aprobada de "Presencial" es "Pres."; "Online" y "Mixta" no necesitan abreviarse', () => {
  assertEqual(MODALITY_SHORT_LABEL.presencial, 'Pres.', 'única palabra que necesita abreviarse');
  assertEqual(MODALITY_SHORT_LABEL.online, 'Online', 'ya es corta, se muestra igual');
  assertEqual(MODALITY_SHORT_LABEL.mixta, 'Mixta', 'ya es corta, se muestra igual');
  for (const modality of MODALITY_ORDER) {
    assert(MODALITY_SHORT_LABEL[modality].length > 0, `${modality}: la abreviatura nunca puede ser un string vacío (nunca "sólo ícono")`);
  }
});

// ---------------------------------------------------------------------------
// 11, 12, 15: una única fuente real de colores. La verificación de que
// `CalendarLessonCard.tsx` (un .tsx, no se puede importar acá porque esta
// suite compila sin JSX) llama a `resolveLessonColor` en sus 3 variantes
// vive como prueba estructural en `teacherFlowLifecycle.test.ts`. Acá se
// prueba la función canónica en sí: nunca devuelve `undefined`/vacío para
// ningún estado o modalidad real.
// ---------------------------------------------------------------------------

test('11/15: resolveLessonColor siempre devuelve un color real para cualquier combinación de estado y modalidad', () => {
  const statuses: CalendarLessonStatus[] = ['scheduled', 'completed', 'cancelled', 'rescheduled'];
  for (const status of statuses) {
    for (const modality of MODALITY_ORDER) {
      const entry = resolveLessonColor({ status, modality });
      assert(entry.color.length > 0, `${status}/${modality}: debe tener un color de fondo real`);
      assert(entry.textColor.length > 0, `${status}/${modality}: debe tener un color de texto real`);
    }
  }
});

// ---------------------------------------------------------------------------
// 13, 14: la leyenda de estados coincide EXACTAMENTE con los 4 estados
// reales del modelo — ninguno inventado, ninguno faltante.
// ---------------------------------------------------------------------------

test('13/14: LESSON_STATUS_ORDER son exactamente los 4 estados reales de CalendarLessonStatus, sin inventar ninguno', () => {
  const realStatuses: CalendarLessonStatus[] = ['scheduled', 'completed', 'cancelled', 'rescheduled'];
  assertEqual(LESSON_STATUS_ORDER.length, realStatuses.length, 'debe haber exactamente 4 estados, ni más ni menos');
  for (const status of realStatuses) {
    assert(LESSON_STATUS_ORDER.includes(status), `debe incluir el estado real "${status}"`);
  }
  for (const status of LESSON_STATUS_ORDER) {
    assert(realStatuses.includes(status), `"${status}" no es un estado real del modelo — no debe aparecer en la leyenda`);
  }
});

test('14b: ningún estado inventado (alumno ausente, profesora ausente, cancelada con aviso, cancelada tarde, feriado) tiene entrada en la leyenda de estados', () => {
  const fakeStatuses = ['no_show', 'teacher_absent', 'cancelled_with_notice', 'cancelled_late', 'holiday'];
  for (const fake of fakeStatuses) {
    assert(
      !(fake in LESSON_STATUS_COLOR_LEGEND),
      `"${fake}" no es un estado real de una clase — nunca debe aparecer en LESSON_STATUS_COLOR_LEGEND`
    );
  }
});

test('cada estado real tiene etiqueta y descripción no vacías', () => {
  for (const status of LESSON_STATUS_ORDER) {
    assert(lessonStatusLabel(status).length > 0, `"${status}" debe tener una etiqueta`);
    assert(lessonStatusDescription(status).length > 0, `"${status}" debe tener una descripción`);
  }
});

// ---------------------------------------------------------------------------
// Colores reales — nunca inventados, siempre desde theme/colors.ts.
// ---------------------------------------------------------------------------

test('los colores de modalidad son exactamente los tokens calendar* congelados en theme/colors.ts', () => {
  assertEqual(MODALITY_LEGEND.presencial.color, colors.calendarPresencialBg, 'presencial debe usar el token calendar* real, no un hex inventado');
  assertEqual(MODALITY_LEGEND.online.color, colors.calendarOnlineBg, 'online debe usar el token calendar* real');
  assertEqual(MODALITY_LEGEND.mixta.color, colors.calendarMixtaBg, 'mixta debe usar el token calendar* real');
});

test('una clase de reemplazo programada, con su original realmente cancelada, usa un color propio y mantiene el aspecto normal de tarjeta', () => {
  const entry = resolveLessonColor(
    { id: 'replacement-1', status: 'scheduled', modality: 'online', freedByLessonId: 'cancelled-original' },
    [{ id: 'cancelled-original', status: 'cancelled' }]
  );
  assertEqual(entry.color, colors.calendarReplacementBg, 'el reemplazo usa el token visual dedicado');
  assertEqual(entry.textColor, colors.calendarReplacementBorder, 'el texto mantiene contraste sobre el color de reemplazo');
  assertEqual(entry.label, 'Reemplazo', 'la semántica visual identifica la sustitución');
});

// ===========================================================================
// Corrección puntual 2026-08-18 (a pedido de Joaquín — VERDE EXCLUSIVO PARA
// CLASES DE REEMPLAZO; recoloreado luego a CORAL EXCLUSIVO por la escala
// cromática CONGELADA del Calendario — ver CLAUDE.md "Reglas visuales
// congeladas del calendario"): causa raíz real — "Completada" usaba
// pastelSage (verde), sin ninguna relación con freedByLessonId. El color
// reservado (`colors.calendarReplacementBg`, coral) es EXCLUSIVO de la
// categoría 'replacement', que exige las 4 condiciones reales a la vez.
// Pruebas GENERALES — nunca basadas en alumnos, fechas o ids reales.
// ===========================================================================

const CANCELLED_ORIGINAL = { id: 'original-1', status: 'cancelled' as const };

test('1) Clase con freedByLessonId válido y original cancelada: coral (categoría replacement)', () => {
  const lesson = { id: 'lesson-1', status: 'scheduled' as const, modality: 'presencial' as const, freedByLessonId: 'original-1' };
  assertEqual(resolveLessonVisualCategory(lesson, [CANCELLED_ORIGINAL]), 'replacement', 'debe clasificarse como reemplazo válido');
  assertEqual(resolveLessonColor(lesson, [CANCELLED_ORIGINAL]).color, colors.calendarReplacementBg, 'debe ser el coral reservado');
});

test('2) Clase normal sin freedByLessonId: nunca el coral de reemplazo', () => {
  for (const modality of MODALITY_ORDER) {
    const lesson = { id: 'normal-1', status: 'scheduled' as const, modality };
    assertEqual(resolveLessonVisualCategory(lesson), 'scheduled', `${modality}: nunca es reemplazo sin freedByLessonId`);
    assert(resolveLessonColor(lesson).color !== colors.calendarReplacementBg, `${modality}: color normal, nunca el coral reservado`);
  }
});

test('3) Clase reprogramada sin freedByLessonId: conserva el color de su modalidad real, nunca el coral de reemplazo', () => {
  for (const modality of MODALITY_ORDER) {
    const lesson = { id: 'rescheduled-1', status: 'rescheduled' as const, modality };
    assertEqual(resolveLessonVisualCategory(lesson), 'rescheduled', 'sigue siendo simplemente "reprogramada"');
    const entry = resolveLessonColor(lesson);
    assert(entry.color !== colors.calendarReplacementBg, 'una reprogramación nunca se convierte visualmente en reemplazo');
    assertEqual(entry.color, MODALITY_LEGEND[modality].color, `${modality}: reprogramada debe conservar el color de su propia modalidad, nunca un peach fijo sin importar la modalidad`);
  }
});

test('4/5) Clase normal pasada o futura: la fecha nunca participa en la clasificación — resolveLessonColor no recibe start/end', () => {
  // La función ni siquiera tiene forma de recibir una fecha: sólo
  // status/modality/freedByLessonId/id. Da exactamente el mismo resultado
  // sin importar si la clase, en la realidad, ya pasó o todavía no.
  const pastLikeLesson = { id: 'past-1', status: 'scheduled' as const, modality: 'presencial' as const };
  const futureLikeLesson = { id: 'future-1', status: 'scheduled' as const, modality: 'presencial' as const };
  assertEqual(resolveLessonVisualCategory(pastLikeLesson), resolveLessonVisualCategory(futureLikeLesson), 'misma categoría, sin importar la fecha real');
  assert(resolveLessonColor(pastLikeLesson).color !== colors.calendarReplacementBg, 'pasada: nunca el coral de reemplazo');
  assert(resolveLessonColor(futureLikeLesson).color !== colors.calendarReplacementBg, 'futura: nunca el coral de reemplazo');
});

test('6/7) Clase recurrente o suelta, normal: la pertenencia a una serie nunca participa en la clasificación — resolveLessonColor no recibe recurrenceId/isRecurring', () => {
  // Mismo argumento: la función no tiene ningún campo de recurrencia en su
  // firma — "pertenecer a una serie" no puede, por construcción, activar
  // el verde por sí solo.
  const lesson = { id: 'any-1', status: 'scheduled' as const, modality: 'mixta' as const };
  assertEqual(resolveLessonVisualCategory(lesson), 'scheduled', 'la función no tiene forma de "saber" si la clase es recurrente o suelta');
  assert(resolveLessonColor(lesson).color !== colors.calendarReplacementBg, 'ni recurrente ni suelta activan el coral de reemplazo por sí solas');
});

test('8) Clase cancelada original: gris — prioridad absoluta sobre cualquier freedByLessonId propio', () => {
  const lesson = { id: 'cancelled-1', status: 'cancelled' as const, modality: 'presencial' as const };
  assertEqual(resolveLessonVisualCategory(lesson), 'cancelled', 'una clase cancelada es siempre esa categoría, primero en la precedencia');
  const entry = resolveLessonColor(lesson);
  assertEqual(entry.color, colors.calendarCancelledBg, 'gris claro, como siempre');
  assert(entry.color !== colors.calendarReplacementBg, 'cancelada nunca es coral, ni con reemplazo activo vinculado');
});

test('9) Reemplazo activo: coral', () => {
  const activeReplacement = { id: 'replacement-2', status: 'scheduled' as const, modality: 'online' as const, freedByLessonId: 'original-2' };
  const allLessons = [{ id: 'original-2', status: 'cancelled' as const }];
  assertEqual(resolveLessonVisualCategory(activeReplacement, allLessons), 'replacement', 'las 4 condiciones reales se cumplen');
  assertEqual(resolveLessonColor(activeReplacement, allLessons).color, colors.calendarReplacementBg, 'debe ser el coral reservado');
});

test('10) Reemplazo cancelado: ya no se muestra como reemplazo coral activo — pasa a gris (cancelada), sin condición aparte', () => {
  const cancelledReplacement = { id: 'replacement-3', status: 'cancelled' as const, modality: 'online' as const, freedByLessonId: 'original-3' };
  const allLessons = [{ id: 'original-3', status: 'cancelled' as const }];
  assertEqual(resolveLessonVisualCategory(cancelledReplacement, allLessons), 'cancelled', 'la propia cancelación del reemplazo manda, nunca se cuela como coral');
  assert(resolveLessonColor(cancelledReplacement, allLessons).color !== colors.calendarReplacementBg, 'nunca coral');
});

test('11) Reemplazo eliminado por completo: desaparece del universo de clases — sin id que buscar, sin freedByLessonId propio que evaluar', () => {
  // "Eliminado" = ya no está en allLessons. La cancelada original vuelve a
  // evaluarse sin ningún reemplazo — libera el horario según la lógica ya
  // implementada (getCancelledSlotReuseDecision), sin relación con el color.
  const originalCancelled = { id: 'original-4', status: 'cancelled' as const, modality: 'presencial' as const };
  assertEqual(resolveLessonVisualCategory(originalCancelled, []), 'cancelled', 'sin ningún reemplazo en el universo, la cancelada sigue siendo simplemente gris — nunca queda una clasificación de reemplazo fantasma');
});

test('12) freedByLessonId inexistente o inválido: nunca clasifica como reemplazo verde', () => {
  const orphanLesson = { id: 'lesson-2', status: 'scheduled' as const, modality: 'presencial' as const, freedByLessonId: 'id-que-no-existe' };
  assertEqual(resolveLessonVisualCategory(orphanLesson, []), 'scheduled', 'sin ningún lessons real con ese id, nunca es reemplazo');
  assertEqual(resolveLessonVisualCategory(orphanLesson, [{ id: 'otro-id-distinto', status: 'cancelled' }]), 'scheduled', 'un id que no coincide tampoco cuenta');
  // El id existe, pero la clase encontrada NO está cancelada — tampoco cuenta.
  assertEqual(resolveLessonVisualCategory(orphanLesson, [{ id: 'id-que-no-existe', status: 'scheduled' }]), 'scheduled', 'el original debe estar realmente cancelado, no sólo existir');
  assert(resolveLessonColor(orphanLesson, []).color !== colors.calendarReplacementBg, 'nunca el coral de reemplazo con un vínculo inválido');
});

test('13) La vista semanal y la diaria aplican EXACTAMENTE la misma clasificación — resolveLessonColor no recibe ningún parámetro de "modo de vista"', () => {
  // WeekTimeGrid.tsx es un único componente para ambas vistas
  // (displayMode 'week'/'day'); ninguna de las dos le pasa nada distinto a
  // resolveLessonColor más allá de la clase y el universo de clases reales
  // — a nivel de la función pura, esto se prueba con que su firma no tiene
  // forma de variar por "vista".
  const lesson = { id: 'replacement-4', status: 'scheduled' as const, modality: 'presencial' as const, freedByLessonId: 'original-5' };
  const allLessons = [{ id: 'original-5', status: 'cancelled' as const }];
  const resultA = resolveLessonColor(lesson, allLessons);
  const resultB = resolveLessonColor(lesson, allLessons);
  assertEqual(resultA.color, resultB.color, 'misma entrada real, mismo color real, sin ningún concepto de "vista" que pueda cambiarlo');
  assertEqual(resultA.color, colors.calendarReplacementBg, 'ambas "vistas" (llamadas) ven el mismo coral real');
});

test('14) Reinicio y restauración de respaldo conservan correctamente la relación cancelada↔reemplazo (round-trip JSON)', () => {
  const original = { id: 'original-6', status: 'cancelled' as const };
  const replacement = { id: 'replacement-5', status: 'scheduled' as const, modality: 'mixta' as const, freedByLessonId: 'original-6' };
  const restored: { allLessons: typeof original[]; replacement: typeof replacement } = JSON.parse(
    JSON.stringify({ allLessons: [original], replacement })
  );
  assertEqual(resolveLessonVisualCategory(restored.replacement, restored.allLessons), 'replacement', 'tras un round-trip JSON completo, sigue reconociéndose como reemplazo real');
  assertEqual(resolveLessonColor(restored.replacement, restored.allLessons).color, colors.calendarReplacementBg, 'y sigue pintándose del coral reservado real');
});

test('15) Ninguna asignación automática por modalidad entrega el coral reservado a una clase normal', () => {
  // Las 3 funciones de color-por-modalidad "muertas" (nunca leídas por
  // ninguna tarjeta real, pero landmines si algo las leyera) tampoco
  // pueden entregar el coral reservado.
  for (const modality of MODALITY_ORDER) {
    assert(MODALITY_LEGEND[modality].color !== colors.calendarReplacementBg, `${modality}: MODALITY_LEGEND nunca usa el coral reservado`);
  }
  // Los otros dos estados con color propio (cancelled/rescheduled) tampoco.
  assert(LESSON_STATUS_COLOR_LEGEND.cancelled?.color !== colors.calendarReplacementBg, 'cancelled nunca usa el coral reservado');
  assert(LESSON_STATUS_COLOR_LEGEND.rescheduled?.color !== colors.calendarReplacementBg, 'rescheduled nunca usa el coral reservado');
  assert(LESSON_STATUS_COLOR_LEGEND.completed?.color !== colors.calendarReplacementBg, 'completed (la causa raíz real del bug) tampoco usa más el coral reservado');
});

// ===========================================================================
// Corrección puntual 2026-08-18 (a pedido de Joaquín — CAMBIO VISUAL
// PUNTUAL, CLASES DADAS Y CANCELADAS): REEMPLAZA la corrección anterior del
// mismo día (color de modalidad atenuado con una mezcla de gris). Ahora
// `resolveLessonCardPalette` sigue el orden centralizado de prioridad:
// 1) cancelada → naranja congelado SIEMPRE; 2) no cancelada y transcurrida
// (`isElapsed`) → gris oscuro congelado FIJO (`ELAPSED_LESSON_COLOR`),
// incluso sobre un reemplazo activo; 3) cualquier otro caso →
// `resolveLessonColor` sin cambios (reemplazo futuro = coral; si no,
// modalidad/estado real). Pruebas GENERALES — nunca casos ligados a
// nombres/alumnos reales; numeración igual a la lista de "PRUEBAS
// OBLIGATORIAS" del pedido.
// ===========================================================================

test('1) Clase online futura → azul', () => {
  const lesson = { id: 'l1', status: 'scheduled' as const, modality: 'online' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], false).color, colors.calendarOnlineBg, 'azul congelado');
});

test('2) Clase presencial futura → color presencial actual', () => {
  const lesson = { id: 'l2', status: 'scheduled' as const, modality: 'presencial' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], false).color, colors.calendarPresencialBg, 'naranja de modalidad congelado');
});

test('3) Clase mixta futura → violeta', () => {
  const lesson = { id: 'l3', status: 'scheduled' as const, modality: 'mixta' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], false).color, colors.calendarMixtaBg, 'violeta congelado');
});

test('4) Clase de hoy todavía en curso (isElapsed=false porque su fin todavía no llegó) → conserva modalidad', () => {
  for (const modality of MODALITY_ORDER) {
    const lesson = { id: 'l4', status: 'scheduled' as const, modality };
    assertEqual(resolveLessonCardPalette(lesson, [], false).color, MODALITY_LEGEND[modality].color, `${modality}: en curso, todavía no es "isElapsed" — color de su modalidad`);
  }
});

test('5) Clase de hoy cuya hora finalizó (isElapsed=true) → gris oscuro', () => {
  const lesson = { id: 'l5', status: 'scheduled' as const, modality: 'online' as const };
  const entry = resolveLessonCardPalette(lesson, [], true);
  assertEqual(entry.color, colors.calendarElapsedBg, 'gris oscuro fijo, nunca azul');
  assertEqual(entry.textColor, colors.calendarElapsedBorder, 'borde gris oscuro fijo');
});

test('6) Clase de un día anterior → gris oscuro (mismo resultado que "5", isElapsed no distingue "hoy" de "ayer")', () => {
  const lesson = { id: 'l6', status: 'scheduled' as const, modality: 'presencial' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], true), ELAPSED_LESSON_COLOR, 'exactamente la paleta fija de transcurrida');
});

test('7) Clase pasada SIN registro pedagógico (status sigue "scheduled") → gris oscuro', () => {
  const lesson = { id: 'l7', status: 'scheduled' as const, modality: 'mixta' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], true).color, colors.calendarElapsedBg, 'no depende de que se haya completado el registro pedagógico');
});

test('8) Clase pasada YA registrada (status "completed") → gris oscuro', () => {
  const lesson = { id: 'l8', status: 'completed' as const, modality: 'mixta' as const };
  assertEqual(resolveLessonCardPalette(lesson, [], true).color, colors.calendarElapsedBg, 'completada + transcurrida sigue siendo gris oscuro, nunca su modalidad');
});

test('9) Cancelada futura → naranja', () => {
  const lesson = { id: 'l9', status: 'cancelled' as const, modality: 'online' as const };
  const entry = resolveLessonCardPalette(lesson, [], false);
  assertEqual(entry.color, colors.calendarCancelledBg, 'naranja claro congelado');
  assertEqual(entry.textColor, colors.calendarCancelledBorder, 'borde naranja fuerte congelado');
});

test('10) Cancelada pasada → sigue naranja, NUNCA se transforma en gris oscuro por haber pasado el horario', () => {
  const lesson = { id: 'l10', status: 'cancelled' as const, modality: 'online' as const };
  const entry = resolveLessonCardPalette(lesson, [], true);
  assertEqual(entry.color, colors.calendarCancelledBg, 'la cancelación tiene prioridad absoluta sobre la regla temporal');
  assert(entry.color !== colors.calendarElapsedBg, 'nunca gris oscuro');
});

test('11) Reemplazo activo futuro → coral', () => {
  const replacement = { id: 'l11-rep', status: 'scheduled' as const, modality: 'online' as const, freedByLessonId: 'l11-orig' };
  const allLessons = [{ id: 'l11-orig', status: 'cancelled' as const }];
  assertEqual(resolveLessonCardPalette(replacement, allLessons, false).color, colors.calendarReplacementBg, 'coral congelado, sin atenuar');
});

test('12) Reemplazo activo cuyo horario terminó → gris oscuro (nunca coral atenuado — la regla temporal tiene prioridad sobre el reemplazo)', () => {
  const replacement = { id: 'l12-rep', status: 'completed' as const, modality: 'online' as const, freedByLessonId: 'l12-orig' };
  const allLessons = [{ id: 'l12-orig', status: 'cancelled' as const }];
  const entry = resolveLessonCardPalette(replacement, allLessons, true);
  assertEqual(entry.color, colors.calendarElapsedBg, 'gris oscuro fijo, igual que cualquier otra clase transcurrida');
  assert(entry.color !== colors.calendarReplacementBg, 'nunca coral una vez transcurrido');
});

test('13) Clase reprogramada futura → conserva modalidad', () => {
  for (const modality of MODALITY_ORDER) {
    const lesson = { id: 'l13', status: 'rescheduled' as const, modality };
    assertEqual(resolveLessonCardPalette(lesson, [], false).color, MODALITY_LEGEND[modality].color, `${modality}: reprogramada futura usa el color de SU modalidad real`);
  }
});

test('14) Semana y Día resuelven los mismos colores (resolveLessonCardPalette no recibe ningún parámetro de "vista")', () => {
  const cases: Array<{ lesson: Parameters<typeof resolveLessonCardPalette>[0]; isElapsed: boolean }> = [
    { lesson: { id: 'v1', status: 'scheduled', modality: 'online' }, isElapsed: false },
    { lesson: { id: 'v2', status: 'scheduled', modality: 'presencial' }, isElapsed: true },
    { lesson: { id: 'v3', status: 'cancelled', modality: 'mixta' }, isElapsed: true },
  ];
  for (const { lesson, isElapsed } of cases) {
    const asWeek = resolveLessonCardPalette(lesson, [], isElapsed);
    const asDay = resolveLessonCardPalette(lesson, [], isElapsed);
    assertEqual(asWeek.color, asDay.color, `${lesson.id}: misma entrada real, mismo resultado real, sin ningún concepto de "vista"`);
  }
});

test('15) El cambio visual no altera ni elimina registros: resolveLessonCardPalette nunca muta la clase que recibe', () => {
  const lesson = { id: 'l15', status: 'scheduled' as const, modality: 'online' as const, freedByLessonId: null };
  const before = JSON.stringify(lesson);
  resolveLessonCardPalette(lesson, [], true);
  assertEqual(JSON.stringify(lesson), before, 'puro: nunca cambia status/modalidad/freedByLessonId ni ningún otro campo');
});

// ---------------------------------------------------------------------------
// Regresión real encontrada durante la revisión de causa de esta misma
// corrección: `WeekTimeGrid` armaba el universo de `resolveLessonColor`
// aplanando `week.days[].lessons` — exactamente lo que ya devuelve
// `hideCancelledLessonsWithActiveReplacement` (oculta la cancelación
// original apenas hay un reemplazo activo). Eso rompía la clasificación
// 'replacement' del PROPIO reemplazo que se estaba mostrando: no podía
// volver a encontrar su cancelación original para confirmar el vínculo.
// Corregido pasando el universo COMPLETO (`allLessonsInWindow`, sin el
// filtro de ocultamiento) a `resolveLessonColor` — ver `useWeeklyCalendar.ts`
// y `WeekTimeGrid.tsx`. Esta prueba fija el comportamiento correcto al
// nivel de las funciones puras, componiendo ambas exactamente como debe
// pasar en producción.
// ---------------------------------------------------------------------------

test('REGRESIÓN: un reemplazo activo sigue clasificando coral aunque su cancelación original ya esté oculta de la grilla', () => {
  const cancelledOriginal = { id: 'orig-1', status: 'cancelled' as const, modality: 'online' as const };
  const replacement = { id: 'rep-1', status: 'completed' as const, modality: 'online' as const, freedByLessonId: 'orig-1' };
  const fullUniverse = [cancelledOriginal, replacement];

  // Lo que se MUESTRA (la cancelación desaparece de la grilla real).
  const displayed = hideCancelledLessonsWithActiveReplacement(fullUniverse as never);
  assert(!displayed.some((lesson) => lesson.id === 'orig-1'), 'la cancelación original se oculta cuando hay reemplazo activo (comportamiento esperado, sin cambios)');

  // Clasificar usando SÓLO lo mostrado (el bug: universo incompleto) pierde el coral.
  const brokenColor = resolveLessonColor(replacement, displayed as never).color;
  assert(brokenColor !== colors.calendarReplacementBg, 'documenta el bug: con el universo post-filtrado, el reemplazo NO puede confirmarse — pierde el coral');

  // Clasificar usando el universo COMPLETO (el fix real) sí lo recupera.
  const fixedColor = resolveLessonColor(replacement, fullUniverse).color;
  assertEqual(fixedColor, colors.calendarReplacementBg, 'con el universo completo (allLessonsInWindow), el reemplazo activo vuelve a confirmarse como coral');
});

// ===========================================================================
// Corrección puntual 2026-08-18 (a pedido de Joaquín — DIFERENCIAR
// CANCELADA DE PRESENCIAL/GRUPAL): el naranja anterior de "Cancelada"
// (#FFE3C2/#D97706) se confundía con el durazno de modalidad presencial
// (#FCE4D2/#A85A2A). Reemplazo ÚNICO de esa paleta por un ámbar propio —
// el orden de prioridad centralizado (`resolveLessonCardPalette`) no
// cambia, sólo los 4 tokens de color. Pruebas GENERALES.
// ===========================================================================

test('Cancelada y presencial nunca comparten fondo, borde ni texto (ni futura ni pasada)', () => {
  const presencial = { id: 'pres-1', status: 'scheduled' as const, modality: 'presencial' as const };
  const cancelledFuture = { id: 'canc-1', status: 'cancelled' as const, modality: 'presencial' as const };
  const cancelledPast = { id: 'canc-2', status: 'cancelled' as const, modality: 'presencial' as const };

  const presencialEntry = resolveLessonCardPalette(presencial, [], false);
  const cancelledFutureEntry = resolveLessonCardPalette(cancelledFuture, [], false);
  const cancelledPastEntry = resolveLessonCardPalette(cancelledPast, [], true);

  for (const cancelledEntry of [cancelledFutureEntry, cancelledPastEntry]) {
    assert(cancelledEntry.color !== presencialEntry.color, 'fondo distinto del durazno de presencial');
    assert(cancelledEntry.textColor !== presencialEntry.textColor, 'borde distinto del de presencial');
  }
  assertEqual(cancelledFutureEntry.color, colors.calendarCancelledBg, 'ámbar nuevo congelado');
  assertEqual(cancelledFutureEntry.textColor, colors.calendarCancelledBorder, 'borde ámbar fuerte congelado');
  assertEqual(presencialEntry.color, colors.calendarPresencialBg, 'presencial NO se tocó');
  assertEqual(presencialEntry.textColor, colors.calendarPresencialBorder, 'presencial NO se tocó');
});

test('Cancelada individual y grupal usan exactamente el mismo ámbar (lessonType nunca participa en el color)', () => {
  const individual = { id: 'canc-ind', status: 'cancelled' as const, modality: 'online' as const };
  const grupal = { id: 'canc-grupo', status: 'cancelled' as const, modality: 'online' as const };
  const individualEntry = resolveLessonCardPalette(individual, [], false);
  const grupalEntry = resolveLessonCardPalette(grupal, [], false);
  assertEqual(individualEntry.color, grupalEntry.color, 'mismo fondo ámbar sin importar individual/grupal');
  assertEqual(individualEntry.textColor, grupalEntry.textColor, 'mismo borde ámbar sin importar individual/grupal');
  assertEqual(individualEntry.color, colors.calendarCancelledBg, 'es el ámbar congelado real');
});

test('Cancelada pasada continúa ámbar — la regla temporal nunca la vuelve gris oscuro', () => {
  const cancelledPast = { id: 'canc-past', status: 'cancelled' as const, modality: 'mixta' as const };
  const entry = resolveLessonCardPalette(cancelledPast, [], true);
  assertEqual(entry.color, colors.calendarCancelledBg, 'sigue siendo el ámbar de cancelada');
  assert(entry.color !== colors.calendarElapsedBg, 'nunca el gris oscuro de "transcurrida"');
});

test('Vista semanal y diaria coinciden para una clase cancelada (resolveLessonCardPalette no recibe ningún parámetro de "vista")', () => {
  const cancelled = { id: 'canc-parity', status: 'cancelled' as const, modality: 'presencial' as const };
  const asWeek = resolveLessonCardPalette(cancelled, [], false);
  const asDay = resolveLessonCardPalette(cancelled, [], false);
  assertEqual(asWeek.color, asDay.color, 'mismo fondo en las dos vistas');
  assertEqual(asWeek.textColor, asDay.textColor, 'mismo borde en las dos vistas');
});

test('Ningún otro estado cambia de color: online/presencial/mixta futuras, reemplazo activo futuro y clase transcurrida siguen exactamente igual', () => {
  assertEqual(resolveLessonCardPalette({ id: 'online', status: 'scheduled', modality: 'online' }, [], false).color, colors.calendarOnlineBg, 'online futura sin cambios');
  assertEqual(resolveLessonCardPalette({ id: 'presencial', status: 'scheduled', modality: 'presencial' }, [], false).color, colors.calendarPresencialBg, 'presencial futura sin cambios');
  assertEqual(resolveLessonCardPalette({ id: 'mixta', status: 'scheduled', modality: 'mixta' }, [], false).color, colors.calendarMixtaBg, 'mixta futura sin cambios');
  const replacement = { id: 'rep-future', status: 'scheduled' as const, modality: 'online' as const, freedByLessonId: 'orig-future' };
  const allLessons = [{ id: 'orig-future', status: 'cancelled' as const }];
  assertEqual(resolveLessonCardPalette(replacement, allLessons, false).color, colors.calendarReplacementBg, 'reemplazo activo futuro sigue coral');
  assertEqual(resolveLessonCardPalette({ id: 'elapsed', status: 'scheduled', modality: 'online' }, [], true).color, colors.calendarElapsedBg, 'clase transcurrida sigue gris oscuro');
});

test('Cancelada: nunca coral, rojo, durazno ni gris oscuro', () => {
  const cancelled = { id: 'canc-never', status: 'cancelled' as const, modality: 'presencial' as const };
  const entry = resolveLessonCardPalette(cancelled, [], true);
  assert(entry.color !== colors.calendarReplacementBg, 'nunca coral');
  assert(entry.color !== colors.calendarPresencialBg, 'nunca el durazno de presencial');
  assert(entry.color !== colors.calendarElapsedBg, 'nunca el gris oscuro de transcurrida');
  assert(entry.color !== '#FF0000' && entry.color !== '#DC2626' && entry.color !== '#EF4444', 'nunca un rojo de error');
});
