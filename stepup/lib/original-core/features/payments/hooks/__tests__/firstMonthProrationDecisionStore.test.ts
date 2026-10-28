// Puerto VERBATIM del original (`src/features/payments/hooks/__tests__/firstMonthProrationDecisionStore.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): pruebas del
 * parseo puro de `firstMonthProrationDecisionStore.ts` — mismo patrón que
 * `monthlyAmountCorrectionLogStore.test.ts` (nunca invoca AsyncStorage real
 * directamente). Cubre caso QA 21 ("cerrar y reabrir conserva la decisión")
 * vía un round-trip JSON.stringify/parse, que es exactamente lo que hace
 * `saveFirstMonthProrationDecisionLog`/`loadFirstMonthProrationDecisionLog`.
 */
import type { FirstMonthProrationDecision } from '../../types/index.ts';
import { findFirstMonthProrationDecision, getFirstMonthProrationDecisionsSnapshot, isFirstMonthProrationDecisionsCacheHydrated, parsePersistedFirstMonthProrationDecisionLog, replaceFirstMonthProrationDecisionsCacheForTests, resetFirstMonthProrationDecisionsCacheForTests, subscribeFirstMonthProrationDecisions } from '../firstMonthProrationDecisionStore.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

const validDecision: FirstMonthProrationDecision = {
  id: 'firstmonth_qa_s1_2026-08_1000',
  studentId: 'qa_s1',
  billingPeriod: '2026-08',
  effectiveJoinDate: '2026-08-18',
  criterion: 'proportional',
  classesRemaining: 2,
  classesPerFullPeriod: 4,
  permanentMonthlyAmount: 80000,
  chargedAmount: 40000,
  chargeId: 'charge_mensual_qa_s1_2026-08',
  createdAt: '2026-08-18T12:00:00.000Z',
  confirmedAt: '2026-08-18T12:00:05.000Z',
};

test('parsePersistedFirstMonthProrationDecisionLog: clave inexistente (null) da lista vacía', () => {
  assertEqual(parsePersistedFirstMonthProrationDecisionLog(null).length, 0, 'instalación nueva, nunca decidió nada todavía');
});

test('parsePersistedFirstMonthProrationDecisionLog: JSON corrupto da lista vacía, nunca lanza', () => {
  assertEqual(parsePersistedFirstMonthProrationDecisionLog('{esto no es JSON').length, 0, 'best-effort: nunca bloquea nada');
});

test('21) Cerrar y reabrir: round-trip JSON.stringify/parse conserva la decisión completa, campo por campo', () => {
  const persisted = JSON.stringify([validDecision]);
  const restored = parsePersistedFirstMonthProrationDecisionLog(persisted);
  assertEqual(restored.length, 1, 'la decisión sobrevive el round-trip');
  assertEqual(restored[0].criterion, 'proportional', 'criterio conservado');
  assertEqual(restored[0].effectiveJoinDate, '2026-08-18', 'fecha efectiva de incorporación conservada');
  assertEqual(restored[0].classesRemaining, 2, 'clases restantes usadas en el cálculo conservadas');
  assertEqual(restored[0].classesPerFullPeriod, 4, 'clases habituales del período completo conservadas');
  assertEqual(restored[0].permanentMonthlyAmount, 80000, 'cuota mensual permanente conservada');
  assertEqual(restored[0].chargedAmount, 40000, 'importe excepcional del primer período conservado');
  assertEqual(restored[0].chargeId, 'charge_mensual_qa_s1_2026-08', 'referencia al cargo real conservada');
  assertEqual(restored[0].confirmedAt, '2026-08-18T12:00:05.000Z', 'fecha de confirmación conservada');
});

test('parsePersistedFirstMonthProrationDecisionLog: acepta "no_charge" con chargeId null', () => {
  const noChargeDecision: FirstMonthProrationDecision = { ...validDecision, criterion: 'no_charge', chargedAmount: 0, chargeId: null };
  const restored = parsePersistedFirstMonthProrationDecisionLog(JSON.stringify([noChargeDecision]));
  assertEqual(restored.length, 1, 'una decisión "no_charge" (sin cargo real) también es válida');
  assertEqual(restored[0].chargeId, null, 'chargeId nulo se conserva tal cual');
});

test('parsePersistedFirstMonthProrationDecisionLog: descarta un criterio fuera del enum de 4 valores', () => {
  const invalid = { ...validDecision, criterion: 'inventado' };
  assertEqual(parsePersistedFirstMonthProrationDecisionLog(JSON.stringify([invalid])).length, 0, 'criterio desconocido se descarta');
});

test('parsePersistedFirstMonthProrationDecisionLog: descarta entradas individuales corruptas sin invalidar el resto', () => {
  const corrupted = { id: 'sin-los-demas-campos' };
  const result = parsePersistedFirstMonthProrationDecisionLog(JSON.stringify([validDecision, corrupted]));
  assertEqual(result.length, 1, 'sólo sobrevive la entrada válida');
  assertEqual(result[0].id, validDecision.id, 'es la entrada correcta la que sobrevive');
});

test('parsePersistedFirstMonthProrationDecisionLog: conserva varias decisiones del mismo alumno (historial nunca se sobrescribe)', () => {
  const second: FirstMonthProrationDecision = {
    ...validDecision,
    id: 'firstmonth_qa_s1_2026-08_2000',
    criterion: 'full',
    chargedAmount: 80000,
    confirmedAt: '2026-08-19T09:00:00.000Z',
  };
  const result = parsePersistedFirstMonthProrationDecisionLog(JSON.stringify([validDecision, second]));
  assertEqual(result.length, 2, 'un recálculo agrega una entrada nueva, nunca reemplaza la anterior');
});

// --- findFirstMonthProrationDecision -----------------------------------------
test('findFirstMonthProrationDecision: sin ninguna decisión para ese (alumno, período), null', () => {
  assertEqual(findFirstMonthProrationDecision([validDecision], 'qa_otro', '2026-08'), null, 'otro alumno no coincide');
  assertEqual(findFirstMonthProrationDecision([validDecision], 'qa_s1', '2026-09'), null, 'otro período no coincide');
});

test('findFirstMonthProrationDecision: con varias decisiones del mismo período, devuelve la más reciente por confirmedAt', () => {
  const older = validDecision;
  const newer: FirstMonthProrationDecision = {
    ...validDecision,
    id: 'firstmonth_qa_s1_2026-08_2000',
    criterion: 'full',
    chargedAmount: 80000,
    confirmedAt: '2026-08-19T09:00:00.000Z',
  };
  const found = findFirstMonthProrationDecision([older, newer], 'qa_s1', '2026-08');
  assert(found !== null, 'encuentra una decisión');
  assertEqual(found?.id, newer.id, 'devuelve la confirmada más recientemente, nunca la primera al azar');
});

// ---------------------------------------------------------------------------
// Corrección 2026-08-27, tercera ronda (a pedido de Joaquín — HACER
// CORREGIBLE EL PRORRATEO HISTÓRICO MARCADO PARA REVISIÓN): caché sincrónico
// en memoria (mismo patrón hidratar/snapshot/suscribir que
// `paymentsStore.ts`/`studentStore.ts`) — nunca toca AsyncStorage real en
// estas pruebas, sólo `replaceFirstMonthProrationDecisionsCacheForTests`
// (equivalente a que `hydrateFirstMonthProrationDecisions()` ya hubiera
// resuelto con exactamente estas entradas).
// ---------------------------------------------------------------------------

test('caché: antes de poblarse, el snapshot es una lista vacía y "no hidratado"', () => {
  resetFirstMonthProrationDecisionsCacheForTests();
  assertEqual(getFirstMonthProrationDecisionsSnapshot().length, 0, 'instalación nueva / antes de hidratar: vacío, nunca inventa datos');
  assertEqual(isFirstMonthProrationDecisionsCacheHydrated(), false, 'todavía no hidratado');
});

test('caché: poblarlo deja el snapshot sincrónico exactamente igual a lo persistido', () => {
  resetFirstMonthProrationDecisionsCacheForTests();
  replaceFirstMonthProrationDecisionsCacheForTests([validDecision]);
  assertEqual(getFirstMonthProrationDecisionsSnapshot().length, 1, 'una decisión disponible sin ningún await');
  assertEqual(getFirstMonthProrationDecisionsSnapshot()[0].id, validDecision.id, 'exactamente la persistida');
  assertEqual(isFirstMonthProrationDecisionsCacheHydrated(), true, 'queda marcado como hidratado');
});

test('caché: notifica a los suscriptores cada vez que se puebla (misma reactividad que usan Centro de cobros/Cobros)', () => {
  resetFirstMonthProrationDecisionsCacheForTests();
  let notifications = 0;
  const unsubscribe = subscribeFirstMonthProrationDecisions(() => {
    notifications += 1;
  });
  replaceFirstMonthProrationDecisionsCacheForTests([validDecision]);
  assertEqual(notifications, 1, 'un cambio real dispara exactamente una notificación');
  unsubscribe();
  replaceFirstMonthProrationDecisionsCacheForTests([]);
  assertEqual(notifications, 1, 'después de desuscribirse, ya no recibe más notificaciones');
});

test('20/21) cierre y reapertura: el caché "en frío" (recién reiniciado) vuelve a reflejar exactamente lo persistido apenas se hidrata', () => {
  // Simula un reinicio real: se limpia el caché en memoria (como si la app
  // se hubiera cerrado) y luego se "hidrata" con lo que estaba guardado.
  resetFirstMonthProrationDecisionsCacheForTests();
  replaceFirstMonthProrationDecisionsCacheForTests([validDecision]);
  const beforeClose = getFirstMonthProrationDecisionsSnapshot();
  assertEqual(beforeClose.length, 1, 'antes de "cerrar"');

  resetFirstMonthProrationDecisionsCacheForTests(); // "cierre": caché en memoria se pierde
  assertEqual(getFirstMonthProrationDecisionsSnapshot().length, 0, 'recién reiniciado: todavía no hidrató nada');

  replaceFirstMonthProrationDecisionsCacheForTests([validDecision]); // "reapertura": hidrata desde lo persistido
  assertEqual(getFirstMonthProrationDecisionsSnapshot().length, 1, 'la reapertura recupera exactamente la decisión persistida');
  assertEqual(getFirstMonthProrationDecisionsSnapshot()[0].id, validDecision.id, 'misma decisión, sin pérdida ni duplicado');
});
