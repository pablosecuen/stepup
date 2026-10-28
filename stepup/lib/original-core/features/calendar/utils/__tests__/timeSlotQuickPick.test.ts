// Puerto VERBATIM del original (`src/features/calendar/utils/__tests__/timeSlotQuickPick.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { buildQuickPickOptions, decideTapAction, formatTimeSlotLabel, INITIAL_TAP_TRACKER_STATE, TIME_SLOT_DOUBLE_TAP_WINDOW_MS, type TapTrackerState } from '../timeSlotQuickPick.ts';
import { assert, assertEqual, test } from './testHarness.ts';

// ---------------------------------------------------------------------------
// Corrección 2026-07-31 (a pedido de Joaquín — horarios de 15 minutos):
// motor puro compartido por RescheduleTimeSlotGrid.tsx y RecurrenceOptions.tsx
// (vía useTimeSlotQuickPick) para long-press/doble-tap. Escenarios 1-4 del
// pedido.
// ---------------------------------------------------------------------------

test('formatTimeSlotLabel rellena hora y minuto a dos dígitos', () => {
  assertEqual(formatTimeSlotLabel(11, 0), '11:00', 'hora con minuto en punto');
  assertEqual(formatTimeSlotLabel(9, 5), '09:05', 'hora y minuto de un solo dígito');
  assertEqual(formatTimeSlotLabel(18, 0), '18:00', 'ejemplo del pedido: 18:00');
});

test('buildQuickPickOptions: mantener presionado 11:00 muestra [11:00, 11:15]', () => {
  const [original, bumped] = buildQuickPickOptions(11, 0);
  assertEqual(original.hour, 11, 'hora original sin cambios');
  assertEqual(original.minute, 0, 'minuto original sin cambios');
  assertEqual(bumped.hour, 11, 'segunda opción misma hora');
  assertEqual(bumped.minute, 15, 'segunda opción +15 minutos: 11:15');
});

test('escenario 4: mantener presionado 11:30 muestra [11:30, 11:45]', () => {
  const [original, bumped] = buildQuickPickOptions(11, 30);
  assertEqual(formatTimeSlotLabel(original.hour, original.minute), '11:30', 'hora original');
  assertEqual(formatTimeSlotLabel(bumped.hour, bumped.minute), '11:45', 'hora original + 15');
});

test('buildQuickPickOptions: mantener presionado 18:00 muestra [18:00, 18:15]', () => {
  const [original, bumped] = buildQuickPickOptions(18, 0);
  assertEqual(formatTimeSlotLabel(original.hour, original.minute), '18:00', 'hora original');
  assertEqual(formatTimeSlotLabel(bumped.hour, bumped.minute), '18:15', 'hora original + 15');
});

test('buildQuickPickOptions nunca redondea: 11:15 no se convierte ni en 11:00 ni en 11:30', () => {
  const [original] = buildQuickPickOptions(11, 15);
  assertEqual(original.minute, 15, 'la hora original de la opción se conserva exacta');
});

test('buildQuickPickOptions normaliza el cambio de hora (ej. 21:50 + 15 = 22:05)', () => {
  const [, bumped] = buildQuickPickOptions(21, 50);
  assertEqual(bumped.hour, 22, 'pasa a la hora siguiente');
  assertEqual(bumped.minute, 5, 'minuto normalizado, nunca 65');
});

// ---------------------------------------------------------------------------
// Escenario 1: toque normal — decideTapAction sin toque previo siempre
// resuelve a 'select', de inmediato (nunca espera a un segundo toque).
// ---------------------------------------------------------------------------

test('escenario 1: toque normal en 11:00 sin toque previo selecciona de inmediato', () => {
  const decision = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  assertEqual(decision.kind, 'select', 'primer toque siempre selecciona, nunca espera');
  assertEqual(decision.state.lastSlot?.hour, 11, 'registra el horario tocado');
  assertEqual(decision.state.lastTapAt, 1_000, 'registra el instante del toque');
});

test('un toque sobre otro horario distinto también selecciona de inmediato (no interpreta doble toque entre horarios distintos)', () => {
  const afterFirstTap = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  const decision = decideTapAction(afterFirstTap.state, { hour: 11, minute: 30 }, 1_050);
  assertEqual(decision.kind, 'select', 'horario distinto: toque normal, no doble toque');
});

test('un segundo toque sobre el MISMO horario, pero fuera de la ventana, también selecciona de inmediato', () => {
  const afterFirstTap = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  const decision = decideTapAction(
    afterFirstTap.state,
    { hour: 11, minute: 0 },
    1_000 + TIME_SLOT_DOUBLE_TAP_WINDOW_MS + 1
  );
  assertEqual(decision.kind, 'select', 'fuera de la ventana de doble toque, es un toque normal más');
});

// ---------------------------------------------------------------------------
// Escenario 3: doble toque sin doble ejecución — el segundo toque dentro de
// la ventana, sobre el MISMO horario, abre el selector rápido en vez de
// disparar una segunda selección normal.
// ---------------------------------------------------------------------------

test('escenario 3a: doble toque rápido sobre el mismo horario abre el selector rápido, no dispara una segunda selección', () => {
  const afterFirstTap = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  assertEqual(afterFirstTap.kind, 'select', 'el primer toque sí selecciona (comportamiento normal intacto)');
  const decision = decideTapAction(afterFirstTap.state, { hour: 11, minute: 0 }, 1_000 + TIME_SLOT_DOUBLE_TAP_WINDOW_MS);
  assertEqual(decision.kind, 'open_quick_pick', 'el segundo toque, dentro de la ventana, abre el selector — nunca selecciona de nuevo');
});

test('escenario 3b: tras abrir el selector rápido por doble toque, el rastreador queda limpio (un tercer toque no reabre nada viejo)', () => {
  const afterFirstTap = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  const afterSecondTap = decideTapAction(afterFirstTap.state, { hour: 11, minute: 0 }, 1_100);
  assertEqual(afterSecondTap.state.lastSlot, null, 'el estado se reinicia tras abrir el selector');
  assertEqual(afterSecondTap.state.lastTapAt, null, 'sin instante pendiente');
  const thirdTap = decideTapAction(afterSecondTap.state, { hour: 11, minute: 0 }, 1_150);
  assertEqual(thirdTap.kind, 'select', 'un tercer toque, ya sin rastro del doble toque anterior, vuelve a ser un toque normal');
});

test('un doble toque muy separado en el tiempo (justo en el borde de la ventana) todavía cuenta como doble toque', () => {
  const afterFirstTap = decideTapAction(INITIAL_TAP_TRACKER_STATE, { hour: 11, minute: 0 }, 1_000);
  const decision = decideTapAction(afterFirstTap.state, { hour: 11, minute: 0 }, 1_000 + TIME_SLOT_DOUBLE_TAP_WINDOW_MS);
  assertEqual(decision.kind, 'open_quick_pick', 'el límite exacto de la ventana todavía cuenta como doble toque (<=)');
});

test('decideTapAction nunca muta el estado recibido (pura)', () => {
  const state: TapTrackerState = { lastSlot: { hour: 11, minute: 0 }, lastTapAt: 1_000 };
  const snapshot = JSON.stringify(state);
  decideTapAction(state, { hour: 11, minute: 0 }, 1_100);
  assertEqual(JSON.stringify(state), snapshot, 'el estado original queda intacto');
});

test('escenario 2 (a nivel de motor): mantener presionado siempre abre el selector, independientemente del rastreador de toques', () => {
  // La pulsación prolongada, en el hook real, ignora decideTapAction por
  // completo (ver useTimeSlotQuickPick.registerLongPress) — acá se verifica
  // que buildQuickPickOptions da exactamente [11:00, 11:15], que es lo que
  // ese long-press termina mostrando.
  const options = buildQuickPickOptions(11, 0);
  assert(options.length === 2, 'exactamente dos opciones, nunca una lista larga');
  assertEqual(formatTimeSlotLabel(options[0].hour, options[0].minute), '11:00', 'primera opción: hora original');
  assertEqual(formatTimeSlotLabel(options[1].hour, options[1].minute), '11:15', 'segunda opción: hora original + 15');
});
