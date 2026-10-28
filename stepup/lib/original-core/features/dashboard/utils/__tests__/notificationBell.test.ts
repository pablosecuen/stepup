// Puerto VERBATIM del original (`src/features/dashboard/utils/__tests__/notificationBell.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';
import { formatNotificationBadgeLabel, notificationBellAccessibilityLabel } from '../notificationBell.ts';

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "LA CAMPANA NO APARECE EN
 * HOME"): pruebas puras de la lógica de la insignia (ítems 3, 4, 5, 6 de la
 * lista de 13 obligatorias). Los ítems que dependen del árbol de
 * componentes real (Home la renderiza, sobrevive a la hidratación, navega a
 * Recordatorios, etc.) viven en notificationBellConnected.test.ts, que lee
 * los .tsx reales como texto.
 */

test('3: con contador cero, no hay etiqueta de insignia (nunca se muestra)', () => {
  assertEqual(formatNotificationBadgeLabel(0), null, 'contador 0 -> sin insignia');
});

test('3b: un contador negativo (nunca debería ocurrir, pero por las dudas) tampoco muestra insignia', () => {
  assertEqual(formatNotificationBadgeLabel(-1), null, 'nunca debe mostrar un número negativo');
});

test('4: con un recordatorio pendiente, la insignia muestra exactamente "1"', () => {
  assertEqual(formatNotificationBadgeLabel(1), '1', 'contador 1 -> insignia "1"');
});

test('5: con varios recordatorios, la insignia muestra el número exacto', () => {
  assertEqual(formatNotificationBadgeLabel(5), '5', 'contador 5 -> insignia "5"');
  assertEqual(formatNotificationBadgeLabel(42), '42', 'contador 42 -> insignia "42"');
  assertEqual(formatNotificationBadgeLabel(99), '99', 'el límite exacto de 2 cifras se muestra tal cual, no "99+"');
});

test('6: con más de 99 recordatorios, la insignia muestra "99+"', () => {
  assertEqual(formatNotificationBadgeLabel(100), '99+', 'contador 100 -> insignia "99+"');
  assertEqual(formatNotificationBadgeLabel(250), '99+', 'contador 250 -> insignia "99+"');
});

test('12: la etiqueta accesible siempre menciona el estado real del contador', () => {
  assertEqual(notificationBellAccessibilityLabel(0), 'Notificaciones, sin recordatorios pendientes', 'contador 0');
  assertEqual(notificationBellAccessibilityLabel(1), 'Notificaciones, 1 recordatorio pendiente', 'contador 1 (singular)');
  assertEqual(notificationBellAccessibilityLabel(2), 'Notificaciones, 2 recordatorios pendientes', 'contador 2 (plural)');
  assertEqual(notificationBellAccessibilityLabel(150), 'Notificaciones, 150 recordatorios pendientes', 'la etiqueta accesible dice el número real, aunque la insignia visual lo recorte a "99+"');
});

test('la etiqueta accesible nunca queda vacía para ningún contador', () => {
  for (const count of [0, 1, 2, 10, 99, 100, 999]) {
    assert(notificationBellAccessibilityLabel(count).length > 0, `contador ${count}: la etiqueta accesible no puede ser un string vacío`);
  }
});
