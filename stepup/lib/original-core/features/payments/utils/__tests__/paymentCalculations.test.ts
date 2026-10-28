// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentCalculations.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAdjustment, PaymentAllocation, PaymentCharge } from '../../types/index.ts';
import { applyPartialPaymentsByDate, calculateChargeState, calculatePaidAmountForCharge, calculatePaymentSummary, calculateSafeAllocationCapacity, determineSettledDate, recalculateAllChargeStates } from '../paymentCalculations.ts';
import { recordPayment } from '../paymentMutations.ts';
import { calculateChargeScore } from '../paymentScoring.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function monthlyCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 10000,
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

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-1',
    studentId: 's1',
    amount: 10000,
    currency: 'ARS',
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function allocation(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: 'alloc-1',
    paymentId: 'payment-1',
    chargeId: 'charge-1',
    studentId: 's1',
    amount: 10000,
    ...overrides,
  };
}

test('calculatePaidAmountForCharge suma sólo asignaciones cuyo pago no está anulado', () => {
  const payments = [payment({ id: 'p1' }), payment({ id: 'p2', voidedAt: '2026-07-06T00:00:00.000Z', voidReason: 'error de carga' })];
  const allocations = [
    allocation({ id: 'a1', paymentId: 'p1', amount: 4000 }),
    allocation({ id: 'a2', paymentId: 'p2', amount: 6000 }),
  ];
  const paid = calculatePaidAmountForCharge('charge-1', allocations, payments);
  assertEqual(paid, 4000, 'ignora la asignación del pago anulado');
});

test('calculatePaymentSummary calcula total, pagado y saldo', () => {
  const summary = calculatePaymentSummary(11000, 4000);
  assertEqual(summary.totalDue, 11000, 'total');
  assertEqual(summary.paidAmount, 4000, 'pagado');
  assertEqual(summary.balance, 7000, 'saldo');
});

test('un pago completo el mismo día salda la obligación en término', () => {
  const charge = monthlyCharge();
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-07-05' })],
    adjustments: [],
    evaluationDate: '2026-07-05',
  });
  assertEqual(state.settledAt, '2026-07-05', 'queda saldada el día del pago');
  assertEqual(state.stage, 'on_time', 'etapa en término');
  assertEqual(state.balance, 0, 'sin saldo pendiente');
});

test('múltiples pagos parciales: la fecha de saldado depende del recargo vigente en cada aporte', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  // Primer pago día 12 (first_late, requiere 11000) por 6000: no alcanza.
  // Segundo pago día 20 (second_late, requiere 11500) por 5500: 6000+5500=11500, alcanza justo ese día.
  const datedAllocations = [
    { amount: 6000, paidAt: '2026-07-12' },
    { amount: 5500, paidAt: '2026-07-20' },
  ];
  const settledAt = applyPartialPaymentsByDate(charge, datedAllocations, false);
  assertEqual(settledAt, '2026-07-20', 'se salda el día en que el acumulado alcanza el requerido de esa fecha');
});

test('múltiples pagos parciales: si el acumulado nunca alcanza el requerido, no queda saldada', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const datedAllocations = [
    { amount: 3000, paidAt: '2026-07-05' },
    { amount: 3000, paidAt: '2026-07-15' },
  ];
  const settledAt = applyPartialPaymentsByDate(charge, datedAllocations, false);
  assertEqual(settledAt, null, 'sigue sin saldarse');
});

test('un pago registrado tarde pero con paidAt en término salda la obligación en término', () => {
  const charge = monthlyCharge({ dueDate: '2026-07-01' });
  const latePayment = payment({
    paidAt: '2026-07-03', // en término
    recordedAt: '2026-07-25T00:00:00.000Z', // la profesora lo cargó mucho después
  });
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [latePayment],
    adjustments: [],
    evaluationDate: '2026-07-25',
  });
  assertEqual(state.settledAt, '2026-07-03', 'el vencimiento y el saldado usan paidAt, no recordedAt');
  // Una obligación saldada congela su etapa en la fecha de saldado, nunca
  // en la fecha de evaluación: aunque se la consulte 22 días después, sigue
  // "en término" porque así quedó saldada.
  assertEqual(state.stage, 'on_time', 'la etapa queda congelada en la fecha de saldado, no en la de evaluación');
  assertEqual(state.balance, 0, 'una obligación saldada en término no genera deuda por evaluarse después');
});

// ---------------------------------------------------------------------------
// Congelamiento al saldar: una obligación pagada por completo nunca vuelve
// a generar deuda nueva, sin importar cuándo se la consulte después.
// Reproduce el error crítico reportado: $10.000 pagados el 09/07 (en
// término) evaluados el 20/07 devolvían totalDue 11500/balance 1500/etapa
// second_late — como si la deuda hubiera seguido creciendo tras saldarse.
// ---------------------------------------------------------------------------

test('bug reproducido: una mensualidad pagada en término el 09/07 no genera deuda al evaluarla el 20/07', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000, paymentId: 'payment-1' })],
    payments: [payment({ id: 'payment-1', amount: 10000, paidAt: '2026-07-09' })],
    adjustments: [],
    evaluationDate: '2026-07-20',
  });
  assertEqual(state.settledAt, '2026-07-09', 'se saldó el 9 de julio, en término (día 9 del ciclo)');
  assertEqual(state.stage, 'on_time', 'la etapa congelada es la del día de saldado, no del día de evaluación');
  assertEqual(state.totalDue, 10000, 'el total adeudado queda congelado sin recargo, no crece con el tiempo');
  assertEqual(state.paidAmount, 10000, 'lo pagado no cambia');
  assertEqual(state.balance, 0, 'el saldo nunca vuelve a ser deuda tras saldarse');
});

test('congelamiento al saldar: pago completo en cada etapa mantiene esa etapa evaluada meses después (sin recargo, en ninguna etapa)', () => {
  const scenarios: Array<{ paidAt: string; expectedStage: 'on_time' | 'first_late' | 'second_late' | 'last_late' }> = [
    { paidAt: '2026-07-05', expectedStage: 'on_time' },
    { paidAt: '2026-07-15', expectedStage: 'first_late' },
    { paidAt: '2026-07-22', expectedStage: 'second_late' },
    { paidAt: '2026-07-30', expectedStage: 'last_late' },
  ];

  scenarios.forEach(({ paidAt, expectedStage }) => {
    const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
    // Sin recargos automáticos, el importe requerido para saldar es siempre
    // el importe original, sin importar en qué etapa de mora se pague.
    const requiredAmount = 10000;

    const stateAtPayment = calculateChargeState({
      charge,
      allocations: [allocation({ amount: requiredAmount })],
      payments: [payment({ amount: requiredAmount, paidAt })],
      adjustments: [],
      evaluationDate: paidAt,
    });
    assertEqual(stateAtPayment.stage, expectedStage, `queda saldada en ${expectedStage} al momento del pago`);
    assertEqual(stateAtPayment.balance, 0, `sin saldo pendiente en ${expectedStage}`);

    // Consultarla meses después debe dar exactamente el mismo resultado.
    const stateMonthsLater = calculateChargeState({
      charge,
      allocations: [allocation({ amount: requiredAmount })],
      payments: [payment({ amount: requiredAmount, paidAt })],
      adjustments: [],
      evaluationDate: '2026-11-30',
    });
    assertEqual(stateMonthsLater.stage, expectedStage, `sigue en ${expectedStage} meses después`);
    assertEqual(stateMonthsLater.totalDue, stateAtPayment.totalDue, 'el total adeudado no cambia con el tiempo');
    assertEqual(stateMonthsLater.balance, 0, `nunca genera deuda nueva en ${expectedStage}`);
  });
});

test('pago retroactivo corrige deuda y scoring: cargarlo tarde con paidAt en término salda y sube el score', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });

  // Antes de registrar el pago (la profesora se olvidó de cargarlo): al
  // 25/07 la obligación figura como deuda vencida sin saldar, score 0.
  const stateBeforeRecording = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-25',
  });
  assertEqual(stateBeforeRecording.settledAt, null, 'sin el pago cargado, no hay saldado');
  assertEqual(
    calculateChargeScore(charge, stateBeforeRecording),
    0,
    'antes del registro retroactivo: deuda vencida sin saldar'
  );

  // La profesora recuerda que el alumno pagó el 5/7 (en término) y lo carga
  // recién el 25/07 — carga retroactiva válida (paidAt <= recordedAt/hoy).
  const retroactivePayment = recordPayment({
    id: 'payment-retro',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-25T10:00:00.000Z',
    todayDateKey: '2026-07-25',
  });

  const stateAfterRecording = calculateChargeState({
    charge,
    allocations: [allocation({ paymentId: 'payment-retro', amount: 10000 })],
    payments: [retroactivePayment],
    adjustments: [],
    evaluationDate: '2026-07-25', // misma fecha de evaluación que antes
  });
  assertEqual(stateAfterRecording.settledAt, '2026-07-05', 'ahora queda saldada en la fecha real de pago');
  assertEqual(stateAfterRecording.balance, 0, 'la carga retroactiva corrige la deuda: ya no hay saldo pendiente');
  assertEqual(
    calculateChargeScore(charge, stateAfterRecording),
    100,
    'el scoring usa la fecha real de pago: pasa de deuda (0) a en término (100)'
  );
});

test('una obligación saldada con sobrepago muestra crédito, nunca deuda', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10500 })],
    payments: [payment({ amount: 10500, paidAt: '2026-07-05' })],
    adjustments: [],
    evaluationDate: '2026-08-15',
  });
  assertEqual(state.settledAt, '2026-07-05', 'se saldó el día del pago');
  assertEqual(state.balance, -500, 'el sobrepago se refleja como crédito (negativo), nunca como deuda positiva');
});

test('la condonación de recargo hace que el total requerido sea siempre el importe original', () => {
  const charge = monthlyCharge({ originalAmount: 10000 });
  const adjustment: PaymentAdjustment = {
    id: 'adj-1',
    chargeId: 'charge-1',
    studentId: 's1',
    reason: 'Cliente de mucha confianza',
    createdAt: '2026-07-20T00:00:00.000Z',
    voidedAt: null,
    voidReason: null,
  };
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-07-29' })], // muy tarde, sería last_late
    adjustments: [adjustment],
    evaluationDate: '2026-07-29',
  });
  assertEqual(state.isSurchargeWaived, true, 'refleja la condonación activa');
  assertEqual(state.surchargeAmount, 0, 'sin recargo pese a la fecha');
  assertEqual(state.totalDue, 10000, 'el total requerido es el importe original');
  assertEqual(state.settledAt, '2026-07-29', 'se salda con el importe original, sin recargo');
});

test('una condonación anulada deja de contar como condonación activa — pero el recargo sigue en $0 de todas formas (nunca hay uno que "recuperar")', () => {
  const charge = monthlyCharge({ originalAmount: 10000 });
  const voidedAdjustment: PaymentAdjustment = {
    id: 'adj-1',
    chargeId: 'charge-1',
    studentId: 's1',
    reason: 'Condonación de prueba',
    createdAt: '2026-07-05T00:00:00.000Z',
    voidedAt: '2026-07-06T00:00:00.000Z',
    voidReason: 'Cargada por error',
  };
  const state = calculateChargeState({
    charge,
    allocations: [allocation({ amount: 10000 })],
    payments: [payment({ amount: 10000, paidAt: '2026-07-29' })],
    adjustments: [voidedAdjustment],
    evaluationDate: '2026-07-29',
  });
  assertEqual(state.isSurchargeWaived, false, 'la condonación anulada no cuenta como activa (bandera independiente del dinero)');
  assertEqual(state.surchargeAmount, 0, 'nunca hay recargo que "recuperar" — la regla central es incondicional');
});

test('una obligación cuyo vencimiento todavía no llegó se marca isNotYetDue', () => {
  const charge = monthlyCharge({ dueDate: '2026-08-01' });
  const state = calculateChargeState({
    charge,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-15',
  });
  assertEqual(state.isNotYetDue, true, 'todavía no vence');
  assertEqual(state.settledAt, null, 'no está saldada');
});

test('recalculateAllChargeStates ignora los cargos anulados', () => {
  const charges = [monthlyCharge({ id: 'a' }), monthlyCharge({ id: 'b', voidedAt: '2026-07-01T00:00:00.000Z', voidReason: 'duplicado' })];
  const states = recalculateAllChargeStates({
    charges,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-10',
  });
  assertEqual(states.length, 1, 'sólo el cargo vigente');
  assertEqual(states[0].chargeId, 'a', 'es el cargo correcto');
});

test('el motor de cálculo no muta ninguna de las colecciones recibidas', () => {
  const charge = monthlyCharge();
  const allocations = [allocation()];
  const payments = [payment()];
  const adjustments: PaymentAdjustment[] = [];
  const chargeSnapshot = JSON.stringify(charge);
  const allocationsSnapshot = JSON.stringify(allocations);
  const paymentsSnapshot = JSON.stringify(payments);

  calculateChargeState({ charge, allocations, payments, adjustments, evaluationDate: '2026-07-10' });
  determineSettledDate(charge, allocations, payments, adjustments);
  calculatePaidAmountForCharge(charge.id, allocations, payments);

  assertEqual(JSON.stringify(charge), chargeSnapshot, 'charge no cambia');
  assertEqual(JSON.stringify(allocations), allocationsSnapshot, 'allocations no cambia');
  assertEqual(JSON.stringify(payments), paymentsSnapshot, 'payments no cambia');
});

// ---------------------------------------------------------------------------
// calculateSafeAllocationCapacity — caso reportado por Codex: un pago
// retroactivo insertado cronológicamente ANTES de una asignación posterior
// ya registrada debe evaluarse contra TODOS los puntos de control (la
// propia fecha y las de asignaciones posteriores), no sólo contra el
// requerido de su propia fecha.
// ---------------------------------------------------------------------------

// Corrección 2026-09-16 (a pedido de Joaquín — decisión de negocio
// confirmada: "TeacherFlow no usa recargos, intereses ni penalizaciones
// monetarias automáticas"): estos 3 casos originales probaban la mecánica
// de "punto de control posterior" contra un requerido QUE INCLUÍA recargo
// (11.500 = 10.000 + 15% second_late el 20/07). Sin recargos automáticos,
// el requerido en CUALQUIER checkpoint es siempre el importe original
// (10.000) — la mecánica de puntos de control sigue funcionando igual
// (sigue siendo el mínimo entre todos los checkpoints), sólo cambian los
// números porque ya no hay recargo que sumar.

test('caso exacto reportado: $5.000 el 05/07 insertados antes de $6.000 ya registrados el 20/07 — la capacidad sigue limitada por el punto de control posterior, ahora sin recargo', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existing = [{ amount: 6000, paidAt: '2026-07-20' }]; // sin recargo: el requerido sigue siendo 10.000
  const capacity = calculateSafeAllocationCapacity(charge, existing, '2026-07-05', false);
  assertEqual(capacity, 4000, 'capacidad en 05/07 = requerido (10.000) - lo ya acumulado al 20/07 (6.000)');
  assert(4000 <= capacity, 'un aporte de hasta $4.000 entra dentro de la capacidad: se acepta completo');
});

test('con el importe máximo seguro ($4.000), la deuda resultante es exactamente $0 (sin recargo, el requerido es sólo el importe original)', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const simulation = calculateChargeState({
    charge,
    allocations: [
      { id: 'a1', paymentId: 'p1', chargeId: 'charge-1', studentId: 's1', amount: 6000 },
      { id: 'a2', paymentId: 'p2', chargeId: 'charge-1', studentId: 's1', amount: 4000 },
    ],
    payments: [
      payment({ id: 'p1', amount: 6000, paidAt: '2026-07-20' }),
      payment({ id: 'p2', amount: 4000, paidAt: '2026-07-05' }),
    ],
    adjustments: [],
    evaluationDate: '2026-07-20',
  });
  assertEqual(simulation.settledAt, '2026-07-20', 'se salda exactamente con estos dos aportes, sin recargo que cubrir');
  assertEqual(simulation.balance, 0, 'sin saldo pendiente');
});

test('rechaza sólo un excedente real: superar la capacidad segura por 2.000 se detecta como excedente', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existing = [{ amount: 6000, paidAt: '2026-07-20' }];
  const capacity = calculateSafeAllocationCapacity(charge, existing, '2026-07-05', false);
  assertEqual(capacity, 4000, 'capacidad máxima segura, sin recargo');
  assert(6000 > capacity, 'proponer 6000 (2.000 de más) supera la capacidad calculada');
});

test('el orden físico del array de asignaciones existentes no cambia el resultado', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existingInOrder = [
    { amount: 6000, paidAt: '2026-07-20' },
    { amount: 1000, paidAt: '2026-07-10' },
  ];
  const existingReversed = [...existingInOrder].reverse();
  const capacityInOrder = calculateSafeAllocationCapacity(charge, existingInOrder, '2026-07-05', false);
  const capacityReversed = calculateSafeAllocationCapacity(charge, existingReversed, '2026-07-05', false);
  assertEqual(capacityInOrder, capacityReversed, 'el resultado es idéntico sin importar el orden del array recibido');
});

test('calculateSafeAllocationCapacity: sin asignaciones existentes, la capacidad es el importe requerido en la fecha propuesta', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const capacity = calculateSafeAllocationCapacity(charge, [], '2026-07-05', false);
  assertEqual(capacity, 10000, 'sin nada previo, la capacidad es el total en término');
});

test('calculateSafeAllocationCapacity: una obligación ya saldada tiene capacidad cero', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existing = [{ amount: 10000, paidAt: '2026-07-05' }]; // salda exacto en término
  const capacity = calculateSafeAllocationCapacity(charge, existing, '2026-07-10', false);
  assertEqual(capacity, 0, 'ya saldada: no admite asignaciones nuevas, sin importar la fecha propuesta');
});

test('calculateSafeAllocationCapacity respeta la condonación de recargo (isSurchargeWaived)', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existing = [{ amount: 4000, paidAt: '2026-07-05' }];
  const capacityWaived = calculateSafeAllocationCapacity(charge, existing, '2026-07-25', true);
  assertEqual(capacityWaived, 6000, 'con condonación, el requerido sigue siendo el importe original sin recargo');
});

test('calculateSafeAllocationCapacity no muta existingDatedAllocations', () => {
  const charge = monthlyCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const existing = [{ amount: 6000, paidAt: '2026-07-20' }];
  const snapshot = JSON.stringify(existing);
  calculateSafeAllocationCapacity(charge, existing, '2026-07-05', false);
  assertEqual(JSON.stringify(existing), snapshot, 'existingDatedAllocations no cambia');
});
