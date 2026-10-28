// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/calendarActivityKind.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): pruebas de
 * la fuente única de verdad de `activityKind` — normalización histórica,
 * etiqueta visible, admisión de tareas pendientes y textos del flujo de
 * registro. Ningún otro archivo debe comparar `activityKind` contra strings
 * a mano — todo pasa por acá.
 */
import { activityKindCompactLabel, activityKindLabel, activityKindRegistrationCopy, activityKindSupportsHomework, normalizeActivityKind } from '../calendarActivityKind.ts';
import { assertEqual, test } from './testHarness.ts';

test('normalizeActivityKind: "training" se conserva tal cual', () => {
  assertEqual(normalizeActivityKind('training'), 'training', 'training pasa sin cambios');
});

test('normalizeActivityKind: "class" se conserva tal cual', () => {
  assertEqual(normalizeActivityKind('class'), 'class', 'class pasa sin cambios');
});

test('normalizeActivityKind: ausente (serie/registro histórico anterior a esta fase) normaliza a "class" — nunca una migración destructiva', () => {
  assertEqual(normalizeActivityKind(undefined), 'class', 'undefined -> class');
  assertEqual(normalizeActivityKind(null), 'class', 'null -> class');
});

test('normalizeActivityKind: cualquier valor no reconocido normaliza a "class" — nunca lanza, nunca rechaza el dato', () => {
  assertEqual(normalizeActivityKind('otra-cosa'), 'class', 'valor desconocido -> class, defensivo');
});

test('activityKindLabel: textos exactos "Clase"/"Entrenamiento"', () => {
  assertEqual(activityKindLabel('class'), 'Clase', 'clase');
  assertEqual(activityKindLabel('training'), 'Entrenamiento', 'entrenamiento');
  assertEqual(activityKindLabel(undefined), 'Clase', 'ausente se etiqueta como clase');
});

test('activityKindCompactLabel: "Clase"/"Entren." para espacios chicos (pastillas/badges)', () => {
  assertEqual(activityKindCompactLabel('class'), 'Clase', 'clase compacta');
  assertEqual(activityKindCompactLabel('training'), 'Entren.', 'entrenamiento compacto');
});

test('activityKindSupportsHomework: sólo "class" admite el sistema de tareas — un entrenamiento nunca', () => {
  assertEqual(activityKindSupportsHomework('class'), true, 'clase admite tareas');
  assertEqual(activityKindSupportsHomework('training'), false, 'entrenamiento nunca admite tareas');
  assertEqual(activityKindSupportsHomework(undefined), true, 'ausente (histórico) admite tareas, igual que siempre');
});

test('activityKindRegistrationCopy: textos adaptados de "Registrar clase"/"Resultado de la clase"/"Contenido pedagógico" para clase', () => {
  const copy = activityKindRegistrationCopy('class');
  assertEqual(copy.registerAction, 'Registrar clase', 'acción de registro');
  assertEqual(copy.outcomeFieldLabel, 'Resultado de la clase', 'etiqueta de resultado');
  assertEqual(copy.contentSectionTitle, 'Contenido pedagógico', 'título de contenido');
});

test('activityKindRegistrationCopy: textos adaptados de "Registrar entrenamiento"/"Resultado del entrenamiento"/"Contenido del entrenamiento" para entrenamiento', () => {
  const copy = activityKindRegistrationCopy('training');
  assertEqual(copy.registerAction, 'Registrar entrenamiento', 'acción de registro');
  assertEqual(copy.outcomeFieldLabel, 'Resultado del entrenamiento', 'etiqueta de resultado');
  assertEqual(copy.contentSectionTitle, 'Contenido del entrenamiento', 'título de contenido');
});
