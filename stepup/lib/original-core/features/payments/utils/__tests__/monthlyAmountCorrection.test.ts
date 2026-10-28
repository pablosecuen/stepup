// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/monthlyAmountCorrection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../../types/index.ts';
import { planMonthlyAmountChange } from '../monthlyAmountCorrection.ts';
import { buildMonthlyChargeId } from '../paymentIdempotency.ts';
import { buildPaymentAllocations, recordPayment } from '../paymentMutations.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { createPaymentsStoreController, emptyPaymentsState, type PaymentsPersistenceAdapter } from '../../hooks/paymentsStore.ts';
import { asyncTest, assert, assertEqual, assertThrows, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
// flujo financiero mensual): `planMonthlyAmountChange` reemplaza a
// `planMonthlyAmountCorrection` — agrega vigencia ("este mes" / "próximo
// mes") y dos protecciones que antes NO existían: nunca reescribe un
// período ya saldado (rechaza, ver PARTE 2.D) y nunca reduce el importe por
// debajo de lo ya asignado (rechaza, ver PARTE 2.C — antes esto generaba
// "saldo a favor" en silencio, el bug real que motivó esta corrección más
// amplia).
// ---------------------------------------------------------------------------

function makeCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: buildMonthlyChargeId('rocio', '2026-07'),
    studentId: 'rocio',
    type: 'mensual',
    originalAmount: 1008000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    calendarLessonId: null,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

const EVALUATION_DATE = '2026-07-05'; // dentro de los primeros 10 días: etapa on_time, sin recargo.

function stateFor(charge: PaymentCharge, paidAmount: number, evaluationDate = EVALUATION_DATE) {
  if (paidAmount <= 0) {
    return calculateChargeState({ charge, allocations: [], payments: [], adjustments: [], evaluationDate });
  }
  const payment = recordPayment({
    id: 'payment_1',
    studentId: charge.studentId,
    amount: paidAmount,
    method: 'efectivo',
    paidAt: '2026-07-03',
    recordedAt: '2026-07-03T12:00:00.000Z',
    todayDateKey: '2026-07-05',
  });
  const allocations = buildPaymentAllocations(payment, [{ id: 'alloc_1', chargeId: charge.id, amount: paidAmount }]);
  return calculateChargeState({
    charge,
    allocations,
    payments: [payment],
    adjustments: [],
    evaluationDate,
  });
}

// ---------------------------------------------------------------------------
// Validaciones básicas
// ---------------------------------------------------------------------------

test('planMonthlyAmountChange rechaza un studentId vacío', () => {
  assertThrows(
    () =>
      planMonthlyAmountChange({
        studentId: '',
        currentBillingPeriod: '2026-07',
        newAmount: 100800,
        effectiveFrom: 'this_month',
        existingCharges: [],
        existingCharge: null,
        currentChargeState: null,
        createdAt: '2026-07-05T00:00:00.000Z',
      }),
    /alumno válido/,
    'necesita un alumno'
  );
});

test('planMonthlyAmountChange rechaza un billingPeriod con formato inválido', () => {
  assertThrows(
    () =>
      planMonthlyAmountChange({
        studentId: 'rocio',
        currentBillingPeriod: '2026-13',
        newAmount: 100800,
        effectiveFrom: 'this_month',
        existingCharges: [],
        existingCharge: null,
        currentChargeState: null,
        createdAt: '2026-07-05T00:00:00.000Z',
      }),
    /período facturado/,
    'mes fuera de rango (13)'
  );
});

test('planMonthlyAmountChange rechaza importes cero, negativos, decimales o no numéricos', () => {
  const base = {
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    effectiveFrom: 'this_month' as const,
    existingCharges: [] as PaymentCharge[],
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-07-05T00:00:00.000Z',
  };
  assertThrows(() => planMonthlyAmountChange({ ...base, newAmount: 0 }), /entero positivo/, 'cero');
  assertThrows(() => planMonthlyAmountChange({ ...base, newAmount: -100800 }), /entero positivo/, 'negativo');
  assertThrows(() => planMonthlyAmountChange({ ...base, newAmount: 100800.5 }), /entero positivo/, 'decimal');
  assertThrows(() => planMonthlyAmountChange({ ...base, newAmount: NaN }), /entero positivo/, 'NaN');
  assertThrows(() => planMonthlyAmountChange({ ...base, newAmount: Infinity }), /entero positivo/, 'Infinity');
});

// ---------------------------------------------------------------------------
// "Aplicar desde este mes" — sin cargo vigente todavía
// ---------------------------------------------------------------------------

// Corrección 2026-08-10 (a pedido de Joaquín — REGRESIÓN CRÍTICA: la cuota
// nueva no actualizaba el cargo abierto): ANTES, sin cargo vigente
// todavía, "este mes" sólo actualizaba el importe efectivo del plan y
// dejaba que el próximo ciclo automático de generación mensual creara el
// cargo — mientras tanto, "Registrar pago" no tenía ningún cargo del
// período actual con el importe nuevo. Ahora se crea el cargo EN EL ACTO.
test('sin cargo mensual vigente para el período, vigencia "este mes": se CREA el cargo en el acto, con el importe nuevo', () => {
  const otherCharge = makeCharge({ id: buildMonthlyChargeId('otro_alumno', '2026-07'), studentId: 'otro_alumno' });
  const existingCharges = [otherCharge];
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges,
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeUpdated, true, 'GAP REAL corregido: el store de pagos SÍ cambia — se crea el cargo del período');
  assertEqual(plan.chargeCreated, true, 'el cargo no existía antes de esta llamada: se marca como recién creado');
  assertEqual(plan.previousChargeAmount, null, 'sin importe anterior: nunca existió un cargo previo');
  assertEqual(plan.updatedCharges.length, 2, 'el cargo de otro alumno se conserva + el nuevo cargo de Rocío');
  assert(plan.updatedCharges.includes(otherCharge), 'el cargo de otro alumno ni siquiera cambia de referencia');
  const created = plan.updatedCharges.find((charge) => charge.studentId === 'rocio');
  assert(created !== undefined, 'el cargo nuevo de Rocío aparece en updatedCharges');
  assertEqual(created?.id, buildMonthlyChargeId('rocio', '2026-07'), 'usa el mismo id determinístico de siempre');
  assertEqual(created?.originalAmount, 100800, 'el cargo nace directamente con el importe nuevo');
  assertEqual(created?.type, 'mensual', 'es una obligación mensual real, no un cargo por clase');
  assertEqual(created?.billingPeriod, '2026-07', 'del período correcto');
  assertEqual(plan.planPatch.amount, 100800, 'el importe efectivo del plan también se actualiza');
});

test('sin cargo vigente, vigencia "este mes": crear el cargo es idempotente — correrlo dos veces nunca duplica', () => {
  const first = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: [],
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(first.updatedCharges.length, 1, 'primera corrida: un único cargo creado');

  // Reabrir la pantalla y volver a aplicar el MISMO importe sobre el
  // resultado ya persistido: ahora SÍ existe, así que cae en la rama de
  // "actualizar in place" — nunca crea un segundo cargo para el mismo período.
  const chargeState = stateFor(first.updatedCharges[0], 0);
  const second = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: first.updatedCharges,
    existingCharge: first.updatedCharges[0],
    currentChargeState: chargeState,
    createdAt: '2026-07-05T00:10:00.000Z',
  });
  assertEqual(second.chargeCreated, false, 'la segunda vez ya existe: se actualiza in place, nunca se crea otro');
  assertEqual(second.updatedCharges.length, 1, 'sigue habiendo un único cargo tras la segunda corrida');
});

test('un cargo anulado de un período DISTINTO nunca se confunde con el vigente: igual se crea el del período actual', () => {
  // El cargo anulado es de junio, no de julio — nunca colisiona con el id
  // determinístico del cargo de julio que se va a crear. (Un cargo anulado
  // con el MISMO id que el que haría falta crear es un caso aparte, fuera
  // de esta corrección: `buildMonthlyChargeId` es intencionalmente
  // determinístico por (alumno, período) en todo el dominio de pagos — ver
  // `chargeAlreadyExists`, la misma regla que ya usa la generación
  // automática — y nunca revive un cargo anulado bajo ningún flujo.)
  const voidedJune = makeCharge({
    id: buildMonthlyChargeId('rocio', '2026-06'),
    billingPeriod: '2026-06',
    dueDate: '2026-06-01',
    voidedAt: '2026-06-02T00:00:00.000Z',
    voidReason: 'error de carga',
  });
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: [voidedJune],
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeCreated, true, 'julio no tiene cargo vigente: se crea uno nuevo');
  assert(
    plan.updatedCharges.find((charge) => charge.id === voidedJune.id)?.originalAmount === 1008000,
    'el cargo anulado de junio queda intacto, nunca se le cambia el importe ni se revive'
  );
  const julyCharge = plan.updatedCharges.find((charge) => charge.billingPeriod === '2026-07');
  assertEqual(julyCharge?.originalAmount, 100800, 'el cargo nuevo de julio nace con el importe corregido');
});

// ---------------------------------------------------------------------------
// "Aplicar desde este mes" — cargo impago existente, corrección real
// ---------------------------------------------------------------------------

test('cambio de $1.008.000 a $100.800 sobre el cargo mensual vigente sin pagos', () => {
  const charge = makeCharge();
  const state = stateFor(charge, 0);
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: [charge],
    existingCharge: charge,
    currentChargeState: state,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeUpdated, true, 'el cargo de julio existía y se actualizó');
  assertEqual(plan.previousChargeAmount, 1008000, 'conserva el importe anterior para la auditoría');
  assertEqual(plan.newAmount, 100800, 'el importe nuevo es exactamente el corregido');
  assertEqual(plan.chargeId, charge.id, 'usa el id determinístico real, nunca uno inventado');
  assertEqual(plan.updatedCharges.length, 1, 'sigue habiendo un único cargo, nunca dos');
  assertEqual(plan.updatedCharges[0].originalAmount, 100800, 'el cargo queda con el importe corregido');
  assertEqual(plan.planPatch.amount, 100800, 'el plan queda con el importe efectivo nuevo');
  assertEqual(plan.planPatch.pendingAmount, undefined, 'sin ningún cambio pendiente para más adelante');
});

test('el cargo se modifica in situ (mismo id, misma posición) — nunca se crea uno nuevo', () => {
  const untouched = makeCharge({ id: buildMonthlyChargeId('otro_alumno', '2026-07'), studentId: 'otro_alumno' });
  const charge = makeCharge();
  const existingCharges = [untouched, charge];
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges,
    existingCharge: charge,
    currentChargeState: stateFor(charge, 0),
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.updatedCharges.length, 2, 'sigue habiendo exactamente dos cargos en total, ninguno nuevo');
  assert(plan.updatedCharges[0] === untouched, 'el cargo de otro alumno ni siquiera cambia de referencia');
  assertEqual(plan.updatedCharges[1].id, charge.id, 'el cargo corregido conserva su id original');
  assertEqual(plan.updatedCharges[1].originalAmount, 100800, 'sólo cambió el importe');
});

test('planMonthlyAmountChange nunca muta el array recibido (pura)', () => {
  const charge = makeCharge();
  const existingCharges = [charge];
  const snapshotJson = JSON.stringify(existingCharges);
  planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges,
    existingCharge: charge,
    currentChargeState: stateFor(charge, 0),
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(JSON.stringify(existingCharges), snapshotJson, 'el array original queda intacto');
  assertEqual(charge.originalAmount, 1008000, 'el objeto de cargo original tampoco se mutó');
});

test('aplicar la misma corrección dos veces seguidas nunca duplica el cargo (reabrir la pantalla)', () => {
  const charge = makeCharge();
  const firstPlan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: [charge],
    existingCharge: charge,
    currentChargeState: stateFor(charge, 0),
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  const correctedCharge = firstPlan.updatedCharges[0];
  const secondPlan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 100800,
    effectiveFrom: 'this_month',
    existingCharges: firstPlan.updatedCharges,
    existingCharge: correctedCharge,
    currentChargeState: stateFor(correctedCharge, 0),
    createdAt: '2026-07-05T00:10:00.000Z',
  });
  assertEqual(secondPlan.updatedCharges.length, 1, 'sigue habiendo un único cargo tras corregir dos veces seguidas');
  assertEqual(secondPlan.previousChargeAmount, 100800, 'la segunda corrección ve el importe ya corregido como "anterior"');
});

// ---------------------------------------------------------------------------
// PARTE 2.B — pago parcial: el saldo se recalcula contra el monto corregido
// ---------------------------------------------------------------------------

test('pago parcial previo — tras corregir el importe hacia arriba, el saldo se recalcula contra el monto corregido', () => {
  const original = makeCharge({ originalAmount: 185000, dueDate: '2026-07-01' });
  const stateBefore = stateFor(original, 50000);
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 192000,
    effectiveFrom: 'this_month',
    existingCharges: [original],
    existingCharge: original,
    currentChargeState: stateBefore,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  const corrected = plan.updatedCharges[0];

  const state = stateFor(corrected, 50000);
  assertEqual(state.originalAmount, 192000, 'el estado calculado usa el importe ya corregido');
  assertEqual(state.paidAmount, 50000, 'el pago real registrado se mantiene intacto');
  assertEqual(state.balance, 142000, 'saldo pendiente contra el monto corregido: 192.000 - 50.000');
});

// ---------------------------------------------------------------------------
// PARTE 2.D — cargo completamente pagado: "este mes" se rechaza
// ---------------------------------------------------------------------------

test('cargo del mes ya saldado por completo: "aplicar desde este mes" se rechaza, nunca reescribe un período cerrado', () => {
  const original = makeCharge({ originalAmount: 185000, dueDate: '2026-07-01' });
  const settledState = stateFor(original, 185000);
  assertEqual(settledState.balance, 0, 'el cargo está saldado exacto antes de intentar el cambio');

  assertThrows(
    () =>
      planMonthlyAmountChange({
        studentId: 'rocio',
        currentBillingPeriod: '2026-07',
        newAmount: 192000,
        effectiveFrom: 'this_month',
        existingCharges: [original],
        existingCharge: original,
        currentChargeState: settledState,
        createdAt: '2026-07-05T00:00:00.000Z',
      }),
    /ya está pagado/,
    'un mes cerrado nunca se reescribe silenciosamente'
  );
});

// ---------------------------------------------------------------------------
// PARTE 2.C — reducir por debajo de lo ya pagado: "este mes" se rechaza
// (antes esto generaba saldo a favor en silencio — el bug real corregido)
// ---------------------------------------------------------------------------

test('reducir el importe por debajo de lo ya asignado: "aplicar desde este mes" se rechaza, nunca genera saldo a favor', () => {
  const original = makeCharge({ originalAmount: 192000, dueDate: '2026-07-01' });
  const partialState = stateFor(original, 150000);
  assert(partialState.balance > 0, 'todavía queda saldo pendiente, el cargo no está cerrado');

  assertThrows(
    () =>
      planMonthlyAmountChange({
        studentId: 'rocio',
        currentBillingPeriod: '2026-07',
        newAmount: 140000, // menor a los 150.000 ya asignados
        effectiveFrom: 'this_month',
        existingCharges: [original],
        existingCharge: original,
        currentChargeState: partialState,
        createdAt: '2026-07-05T00:00:00.000Z',
      }),
    /no puede ser menor a lo ya pagado/,
    'nunca se acepta un importe menor a lo ya asignado en el mismo mes'
  );
});

test('reducir el importe exactamente a lo ya asignado sí se acepta (saldo final $0, nunca negativo)', () => {
  const original = makeCharge({ originalAmount: 192000, dueDate: '2026-07-01' });
  const partialState = stateFor(original, 150000);
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 150000,
    effectiveFrom: 'this_month',
    existingCharges: [original],
    existingCharge: original,
    currentChargeState: partialState,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeUpdated, true, 'el importe igual a lo pagado sí se acepta');
  const corrected = plan.updatedCharges[0];
  const state = stateFor(corrected, 150000);
  assertEqual(state.balance, 0, 'queda saldado exacto, nunca negativo');
});

// ---------------------------------------------------------------------------
// "Aplicar desde el próximo mes" — nunca toca el cargo actual
// ---------------------------------------------------------------------------

test('"aplicar desde el próximo mes": el cargo del mes actual NUNCA se toca, aunque exista y esté impago', () => {
  const charge = makeCharge({ originalAmount: 185000 });
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 192000,
    effectiveFrom: 'next_month',
    existingCharges: [charge],
    existingCharge: charge,
    currentChargeState: stateFor(charge, 0),
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeUpdated, false, 'el cargo de julio no se toca');
  assertEqual(plan.updatedCharges[0].originalAmount, 185000, 'julio conserva su importe original, intacto');
  assertEqual(plan.planPatch.amount, undefined, 'el importe efectivo actual no cambia');
  assertEqual(plan.planPatch.pendingAmount, 192000, 'el nuevo importe queda anotado como pendiente');
  assertEqual(plan.planPatch.pendingAmountEffectiveFrom, '2026-08', 'entra en vigencia el mes siguiente');
});

test('"aplicar desde el próximo mes" también funciona sin cargo actual (nada que tocar)', () => {
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-07',
    newAmount: 192000,
    effectiveFrom: 'next_month',
    existingCharges: [],
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-07-05T00:00:00.000Z',
  });
  assertEqual(plan.chargeUpdated, false, 'sin cargo, nada que actualizar en el store de pagos');
  assertEqual(plan.planPatch.pendingAmountEffectiveFrom, '2026-08', 'igual queda anotado el cambio pendiente');
});

test('"aplicar desde el próximo mes" cruza diciembre → enero correctamente', () => {
  const plan = planMonthlyAmountChange({
    studentId: 'rocio',
    currentBillingPeriod: '2026-12',
    newAmount: 200000,
    effectiveFrom: 'next_month',
    existingCharges: [],
    existingCharge: null,
    currentChargeState: null,
    createdAt: '2026-12-05T00:00:00.000Z',
  });
  assertEqual(plan.planPatch.pendingAmountEffectiveFrom, '2027-01', 'cruza de año correctamente');
});

// ---------------------------------------------------------------------------
// Persistencia después de re-hidratar el store
// ---------------------------------------------------------------------------

function makeFakeAdapter() {
  const store = { persisted: emptyPaymentsState() };
  const adapter: PaymentsPersistenceAdapter = {
    readAll: async () => store.persisted,
    writeAll: async (state) => {
      store.persisted = state;
    },
  };
  return { adapter, store };
}

asyncTest('el importe corregido persiste después de re-hidratar el store (cerrar y volver a abrir)', async () => {
  const { adapter, store } = makeFakeAdapter();
  const firstOpen = createPaymentsStoreController(adapter);
  await firstOpen.hydrate();
  await firstOpen.applyMutation((current) => ({ ...current, charges: [makeCharge()] }));

  await firstOpen.applyMutation((current) => {
    const charge = current.charges[0];
    const plan = planMonthlyAmountChange({
      studentId: 'rocio',
      currentBillingPeriod: '2026-07',
      newAmount: 100800,
      effectiveFrom: 'this_month',
      existingCharges: current.charges,
      existingCharge: charge,
      currentChargeState: calculateChargeState({
        charge,
        allocations: [],
        payments: [],
        adjustments: [],
        evaluationDate: '2026-07-05',
      }),
      createdAt: '2026-07-05T00:00:00.000Z',
    });
    return { ...current, charges: plan.updatedCharges };
  });

  assertEqual(store.persisted.charges[0].originalAmount, 100800, 'quedó persistido con el importe corregido');

  // Simula "cerrar y volver a abrir la app": un controlador nuevo, mismo adaptador real.
  const secondOpen = createPaymentsStoreController(adapter);
  const rehydrated = await secondOpen.hydrate();
  assertEqual(rehydrated.charges.length, 1, 'sigue habiendo un único cargo tras re-hidratar');
  assertEqual(rehydrated.charges[0].originalAmount, 100800, 'el importe corregido sobrevive a la re-hidratación');
  assertEqual(rehydrated.charges[0].id, buildMonthlyChargeId('rocio', '2026-07'), 'mismo id de siempre, nunca uno nuevo');
});
