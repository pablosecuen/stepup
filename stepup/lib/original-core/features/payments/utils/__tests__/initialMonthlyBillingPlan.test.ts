// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/initialMonthlyBillingPlan.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentsRepositoryState } from '../../types/index.ts';
import { planEnsureMonthlyChargeSituation } from '../initialMonthlyBillingPlan.ts';
import { calculateChargeState } from '../paymentCalculations.ts';
import { calculateChargeScore } from '../paymentScoring.ts';
import { buildMonthlyCharge, replacePayment } from '../paymentMutations.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

test('1. Alumno cargado el 26/07 con julio ya pagado: crea la obligación y el pago, queda saldada', () => {
  // Corrección 2026-08-02 (a pedido de Joaquín — alta financiera de
  // alumnos nuevos): "el alta de un alumno y la carga de su situación
  // inicial no representan necesariamente la fecha real en la que pagó" —
  // ya no se pide ni se respeta una fecha de pago explícita para 'paid'.
  // La profesora carga la ficha el 26/07 (retroactivo, `createdAt`/
  // `todayDateKey`); `paidAt` (aunque se pase "hoy", 26/07) siempre queda
  // clamped a `charge.dueDate` (día 1 del período) — nunca puede quedar
  // "vencida" por la fecha de alta.
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    dueDay: 1, // este caso verifica el clamp contra el vencimiento; el día es incidental.
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_1',
    allocationId: 'payment_s1_1_alloc_1',
    state: emptyState(),
  });

  assert(result.chargeToCreate !== null, 'crea la obligación del mes actual');
  assert(result.payment !== null, 'crea el pago');
  assert(result.allocation !== null, 'crea la asignación');
  assertEqual(result.billingPeriodStart, '2026-07', 'el período de inicio es el mes actual');
  assertEqual(result.payment!.amount, 20000, 'el pago es por el importe mensual completo');
  assertEqual(
    result.payment!.paidAt,
    '2026-07-01',
    'paidAt nunca queda posterior al vencimiento (día 1) — nunca la fecha tardía de alta/carga'
  );
  assertEqual(result.payment!.source, 'initial_student_setup', 'el pago queda marcado como situación inicial declarada');

  const state: PaymentsRepositoryState = {
    charges: [result.chargeToCreate!],
    payments: [result.payment!],
    allocations: [result.allocation!],
    adjustments: [],
  };
  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: state.allocations,
    payments: state.payments,
    adjustments: state.adjustments,
    evaluationDate: '2026-07-26',
  });
  assertEqual(chargeState.balance, 0, 'la obligación queda saldada por completo');
  assertEqual(chargeState.stage, 'on_time', 'pagada en término, sin recargo');
});

test('PRUEBA OBLIGATORIA 1: alumno creado el último día del mes (31/07) con la opción predeterminada (starts_next_month) — sin deuda, sin recargo, factura desde el mes siguiente', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_ultimo_dia',
    situation: 'starts_next_month',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-31',
    method: 'efectivo',
    todayDateKey: '2026-07-31',
    createdAt: '2026-07-31T23:00:00.000Z',
    recordedAt: '2026-07-31T23:00:00.000Z',
    chargeId: 'charge_mensual_s_ultimo_dia_2026-07',
    paymentId: 'payment_s_ultimo_dia_1',
    allocationId: 'payment_s_ultimo_dia_1_alloc_1',
    state: emptyState(),
  });
  assertEqual(result.chargeToCreate, null, 'no crea ninguna obligación del mes actual, ni con deuda ni sin ella');
  assertEqual(result.payment, null, 'no crea ningún pago');
  assertEqual(result.allocation, null, 'no crea ninguna asignación');
  assertEqual(result.billingPeriodStart, '2026-08', 'la facturación arranca el mes siguiente');
});

test('PRUEBA OBLIGATORIA 2: alumno creado el último día del mes (31/07) con "Este mes ya está pago" — saldo cero, sin recargo, sin mora, scoring no penalizado', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_ultimo_dia_pago',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    dueDay: 1, // este caso verifica el clamp contra el vencimiento; el día es incidental.
    paidAt: '2026-07-31',
    method: 'efectivo',
    todayDateKey: '2026-07-31',
    createdAt: '2026-07-31T23:00:00.000Z',
    recordedAt: '2026-07-31T23:00:00.000Z',
    chargeId: 'charge_mensual_s_ultimo_dia_pago_2026-07',
    paymentId: 'payment_s_ultimo_dia_pago_1',
    allocationId: 'payment_s_ultimo_dia_pago_1_alloc_1',
    state: emptyState(),
  });

  assertEqual(
    result.payment!.paidAt,
    '2026-07-01',
    'paidAt clamped al día 1 del período — nunca el 31/07, que sería "last_late" bajo el motor real'
  );

  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: [result.allocation!],
    payments: [result.payment!],
    adjustments: [],
    evaluationDate: '2026-07-31',
  });
  assertEqual(chargeState.balance, 0, 'saldo cero, incluso evaluado el mismo 31/07 en que se dio de alta');
  assertEqual(chargeState.surchargeAmount, 0, 'sin recargo');
  assertEqual(chargeState.stage, 'on_time', 'nunca "moroso": queda en término');

  const score = calculateChargeScore(result.chargeToCreate!, chargeState);
  assertEqual(score, 100, 'scoring no penalizado: 100 (on_time), nunca 25 (last_late) como con el bug original');
});

test('PRUEBA OBLIGATORIA 3: alumno creado el día 1 del mes con "Este mes ya está pago"', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_dia_1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-01',
    method: 'efectivo',
    todayDateKey: '2026-07-01',
    createdAt: '2026-07-01T09:00:00.000Z',
    recordedAt: '2026-07-01T09:00:00.000Z',
    chargeId: 'charge_mensual_s_dia_1_2026-07',
    paymentId: 'payment_s_dia_1_1',
    allocationId: 'payment_s_dia_1_1_alloc_1',
    state: emptyState(),
  });
  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: [result.allocation!],
    payments: [result.payment!],
    adjustments: [],
    evaluationDate: '2026-07-01',
  });
  assertEqual(chargeState.balance, 0, 'saldo cero desde el día 1');
  assertEqual(chargeState.stage, 'on_time', 'en término');
});

test('PRUEBA OBLIGATORIA 4: alumno creado después del vencimiento con "Este mes está pendiente" aplica las reglas normales (SÍ puede quedar vencido)', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_pendiente_tarde',
    situation: 'pending',
    amount: 20000,
    billingPeriod: '2026-07',
    dueDay: 1, // este caso verifica la etapa exacta de mora; el día es incidental.
    paidAt: '2026-07-29',
    method: 'efectivo',
    todayDateKey: '2026-07-29',
    createdAt: '2026-07-29T15:00:00.000Z',
    recordedAt: '2026-07-29T15:00:00.000Z',
    chargeId: 'charge_mensual_s_pendiente_tarde_2026-07',
    paymentId: 'payment_s_pendiente_tarde_1',
    allocationId: 'payment_s_pendiente_tarde_1_alloc_1',
    state: emptyState(),
  });
  assert(result.chargeToCreate !== null, 'crea la obligación del mes actual');
  assertEqual(result.payment, null, 'nunca crea un pago ficticio para "pendiente"');

  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: [],
    payments: [],
    adjustments: [],
    evaluationDate: '2026-07-29',
  });
  assert(chargeState.balance > 0, 'sin pago, hay deuda real');
  assertEqual(chargeState.stage, 'last_late', 'aplica las reglas normales de vencimiento — SÍ puede quedar vencida, a diferencia de "paid"');
});

test('PRUEBA OBLIGATORIA 5: el pago inicial se asigna únicamente al cargo del mes — nunca se reparte hacia otras obligaciones', () => {
  const otherCharge = planEnsureMonthlyChargeSituation({
    studentId: 's_reparto',
    situation: 'pending',
    amount: 20000,
    billingPeriod: '2026-06',
    paidAt: '2026-06-15',
    method: 'efectivo',
    todayDateKey: '2026-06-15',
    createdAt: '2026-06-15T09:00:00.000Z',
    recordedAt: '2026-06-15T09:00:00.000Z',
    chargeId: 'charge_mensual_s_reparto_2026-06',
    paymentId: 'payment_s_reparto_prev',
    allocationId: 'payment_s_reparto_prev_alloc_1',
    state: emptyState(),
  }).chargeToCreate!;

  const state: PaymentsRepositoryState = { charges: [otherCharge], payments: [], allocations: [], adjustments: [] };

  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_reparto',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-15',
    method: 'efectivo',
    todayDateKey: '2026-07-15',
    createdAt: '2026-07-15T09:00:00.000Z',
    recordedAt: '2026-07-15T09:00:00.000Z',
    chargeId: 'charge_mensual_s_reparto_2026-07',
    paymentId: 'payment_s_reparto_1',
    allocationId: 'payment_s_reparto_1_alloc_1',
    state,
  });

  assertEqual(result.allocation!.chargeId, result.chargeToCreate!.id, 'la única asignación creada apunta al cargo del mes actual');
  const juneState = calculateChargeState({
    charge: otherCharge,
    allocations: [result.allocation!],
    payments: [result.payment!],
    adjustments: [],
    evaluationDate: '2026-07-15',
  });
  assertEqual(juneState.paidAmount, 0, 'la obligación de junio, sin relación, no recibió ni un peso del pago de julio');
});

test('PRUEBA OBLIGATORIA 15: zona horaria America/Argentina/Buenos_Aires en el cambio de mes — un instante ya "agosto" en UTC pero todavía "julio" en AR no adelanta la clamp al vencimiento equivocado', () => {
  // 2026-07-31T23:30:00-03:00 (Buenos Aires, último minuto de julio) es
  // 2026-08-01T02:30:00.000Z en UTC — si el clamp usara la fecha UTC en
  // vez del billingPeriod ya resuelto en horario local, el dueDate
  // esperado sería el de agosto, no el de julio.
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's_huso',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07', // ya resuelto en horario de Buenos Aires por el llamador real
    dueDay: 1, // este caso verifica el huso horario del período, no el día de vencimiento.
    paidAt: '2026-07-31',
    method: 'efectivo',
    todayDateKey: '2026-07-31',
    createdAt: '2026-08-01T02:30:00.000Z', // mismo instante, ya "agosto" en UTC
    recordedAt: '2026-08-01T02:30:00.000Z',
    chargeId: 'charge_mensual_s_huso_2026-07',
    paymentId: 'payment_s_huso_1',
    allocationId: 'payment_s_huso_1_alloc_1',
    state: emptyState(),
  });
  assertEqual(result.chargeToCreate!.dueDate, '2026-07-01', 'el vencimiento sigue siendo julio, el período ya resuelto en horario de Buenos Aires');
  assertEqual(result.payment!.paidAt, '2026-07-01', 'el clamp usa el dueDate de julio, nunca se corre a agosto por el instante UTC');
});

test('2. El 31/07 el alumno sigue "Al día" (evaluado más tarde en el mismo mes, sin recargo)', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-03',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_1',
    allocationId: 'payment_s1_1_alloc_1',
    state: emptyState(),
  });

  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: [result.allocation!],
    payments: [result.payment!],
    adjustments: [],
    evaluationDate: '2026-07-31',
  });
  assertEqual(chargeState.balance, 0, 'sigue saldada al evaluar el 31/07');
  assertEqual(chargeState.stage, 'on_time', 'sigue en término, nunca se le suma recargo por estar saldada');
});

test('6. Pago anticipado: pagar el mismo día del vencimiento (día 1) no genera ningún recargo', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-08',
    paidAt: '2026-08-01',
    method: 'transferencia',
    todayDateKey: '2026-08-01',
    createdAt: '2026-08-01T09:00:00.000Z',
    recordedAt: '2026-08-01T09:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-08',
    paymentId: 'payment_s1_2',
    allocationId: 'payment_s1_2_alloc_1',
    state: emptyState(),
  });
  const chargeState = calculateChargeState({
    charge: result.chargeToCreate!,
    allocations: [result.allocation!],
    payments: [result.payment!],
    adjustments: [],
    evaluationDate: '2026-08-01',
  });
  assertEqual(chargeState.surchargeAmount, 0, 'sin recargo: pagó exactamente el día del vencimiento');
  assertEqual(chargeState.balance, 0, 'queda saldada de inmediato');
});

test('9. Alumno que comienza a pagar el mes siguiente: no genera deuda en el mes actual', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'starts_next_month',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_3',
    allocationId: 'payment_s1_3_alloc_1',
    state: emptyState(),
  });
  assertEqual(result.chargeToCreate, null, 'no crea ninguna obligación del mes actual');
  assertEqual(result.payment, null, 'no crea ningún pago');
  assertEqual(result.allocation, null, 'no crea ninguna asignación');
  assertEqual(result.billingPeriodStart, '2026-08', 'guarda agosto como primer período a facturar');
});

test('"Este mes está pendiente" crea sólo la obligación, sin pagos ficticios', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'pending',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_4',
    allocationId: 'payment_s1_4_alloc_1',
    state: emptyState(),
  });
  assert(result.chargeToCreate !== null, 'crea la obligación del mes actual');
  assertEqual(result.payment, null, 'nunca crea un pago ficticio');
  assertEqual(result.allocation, null, 'nunca crea una asignación ficticia');
  assertEqual(result.billingPeriodStart, '2026-07', 'el período de inicio es el mes actual');
});

test('idempotencia: reutiliza la obligación ya existente en vez de crear una segunda', () => {
  const existingCharge = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'pending',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-01T09:00:00.000Z',
    recordedAt: '2026-07-01T09:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_5',
    allocationId: 'payment_s1_5_alloc_1',
    state: emptyState(),
  }).chargeToCreate!;

  const state: PaymentsRepositoryState = { charges: [existingCharge], payments: [], allocations: [], adjustments: [] };

  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_6',
    allocationId: 'payment_s1_6_alloc_1',
    state,
  });
  assertEqual(result.chargeToCreate, null, 'no crea una segunda obligación: reutiliza la existente');
  assertEqual(result.allocation!.chargeId, existingCharge.id, 'la asignación apunta a la obligación ya existente');
});

test('marcar como pagado dos veces la misma obligación se rechaza (nunca duplica el pago)', () => {
  const first = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-07',
    paidAt: '2026-07-26',
    method: 'efectivo',
    todayDateKey: '2026-07-26',
    createdAt: '2026-07-26T15:00:00.000Z',
    recordedAt: '2026-07-26T15:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-07',
    paymentId: 'payment_s1_7',
    allocationId: 'payment_s1_7_alloc_1',
    state: emptyState(),
  });
  const state: PaymentsRepositoryState = {
    charges: [first.chargeToCreate!],
    payments: [first.payment!],
    allocations: [first.allocation!],
    adjustments: [],
  };

  let threw = false;
  try {
    planEnsureMonthlyChargeSituation({
      studentId: 's1',
      situation: 'paid',
      amount: 20000,
      billingPeriod: '2026-07',
      paidAt: '2026-07-27',
      method: 'efectivo',
      todayDateKey: '2026-07-27',
      createdAt: '2026-07-27T15:00:00.000Z',
      recordedAt: '2026-07-27T15:00:00.000Z',
      chargeId: 'charge_mensual_s1_2026-07',
      paymentId: 'payment_s1_8',
      allocationId: 'payment_s1_8_alloc_1',
      state,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'la segunda marca como pagado se rechaza (la obligación ya está saldada)');
});

test('11. Corrección de un pago retroactivo: anular y reemplazar deja la obligación saldada, con historial completo', () => {
  const initial = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 20000,
    billingPeriod: '2026-08',
    paidAt: '2026-08-03', // fecha cargada con un error
    method: 'efectivo',
    todayDateKey: '2026-08-05',
    createdAt: '2026-08-05T10:00:00.000Z',
    recordedAt: '2026-08-05T10:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-08',
    paymentId: 'payment_s1_9',
    allocationId: 'payment_s1_9_alloc_1',
    state: emptyState(),
  });

  // `replacePayment` ya anula el pago original internamente — nunca hay que
  // anularlo antes a mano (eso lanzaría "El pago ya está anulado").
  const correctedPayment = {
    ...initial.payment!,
    id: 'payment_s1_9_corregido',
    paidAt: '2026-08-01',
  };
  const { payments: paymentsAfterReplace, newPayment } = replacePayment(
    [initial.payment!],
    initial.payment!.id,
    'Fecha real de pago cargada mal: era el 01/08, no el 03/08',
    '2026-08-05T11:00:00.000Z',
    correctedPayment
  );

  assertEqual(paymentsAfterReplace.length, 2, 'el pago original queda en el historial, íntegro y anulado');
  assert(paymentsAfterReplace[0].voidedAt !== null, 'el pago original quedó anulado');
  assertEqual(newPayment.paidAt, '2026-08-01', 'el pago nuevo tiene la fecha real correcta');
  assertEqual(newPayment.replacesPaymentId, initial.payment!.id, 'el pago nuevo referencia al que reemplaza');
});

// Corrección 2026-08-16 (a pedido de Joaquín — Fase 4/5, corrección
// integral post-simulación): `clampPaidAtToDueDate` distingue la
// declaración ambigua del alta ("situación del primer mes", clamp
// conservado por default) de una confirmación real de pago
// ("markCurrentMonthAsPaid", clamp desactivado explícitamente) — antes,
// AMBOS casos compartían el mismo clamp incondicional, así que un alumno
// genuinamente vencido marcado como pagado HOY quedaba registrado como "en
// término", sin el recargo que la vista previa ya mostraba.
// Nota: el clamp/recargo sólo importa cuando el cargo YA EXISTE (generado
// antes por la generación mensual automática) — si `planEnsureMonthlyChargeSituation`
// tuviera que CREAR el cargo en la misma llamada, el importe pagado es
// `input.amount` tal cual, sin cálculo de recargo (es una declaración, no
// una confirmación contra un cargo real). Por eso ambos tests parten de un
// cargo YA MATERIALIZADO, exactamente como en "Marcar mes actual como
// pagado" sobre un mes que la generación automática ya creó.
function stateWithExistingAugustCharge(): PaymentsRepositoryState {
  const charge = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 100000,
    createdAt: '2026-08-01T09:00:00.000Z',
    existingCharges: [],
  });
  return { charges: [charge], payments: [], allocations: [], adjustments: [] };
}

test('clampPaidAtToDueDate por defecto (undefined) conserva el comportamiento exacto de siempre: paidAt tardío se clampea al vencimiento, 0% recargo', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 100000,
    billingPeriod: '2026-08',
    paidAt: '2026-08-20', // "hoy", muy posterior al vencimiento
    method: 'efectivo',
    todayDateKey: '2026-08-20',
    createdAt: '2026-08-20T10:00:00.000Z',
    recordedAt: '2026-08-20T10:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-08',
    paymentId: 'payment_s1_clamp_default',
    allocationId: 'payment_s1_clamp_default_alloc_1',
    state: stateWithExistingAugustCharge(),
  });
  assertEqual(result.payment!.paidAt, '2026-08-01', 'sin el flag, sigue clampeando al día 1 (comportamiento del alta, sin cambios)');
  assertEqual(result.allocation!.amount, 100000, 'sin recargo: el alta nunca queda "vencida" por su propia fecha de carga');
});

test('clampPaidAtToDueDate: false — un alumno genuinamente vencido marcado como pagado HOY sí paga el recargo real (Fase 4/5)', () => {
  const result = planEnsureMonthlyChargeSituation({
    studentId: 's1',
    situation: 'paid',
    amount: 100000,
    billingPeriod: '2026-08',
    paidAt: '2026-08-20', // confirmación real de pago, genuinamente tarde
    clampPaidAtToDueDate: false,
    method: 'efectivo',
    todayDateKey: '2026-08-20',
    createdAt: '2026-08-20T10:00:00.000Z',
    recordedAt: '2026-08-20T10:00:00.000Z',
    chargeId: 'charge_mensual_s1_2026-08',
    paymentId: 'payment_s1_clamp_off',
    allocationId: 'payment_s1_clamp_off_alloc_1',
    state: stateWithExistingAugustCharge(),
  });
  assertEqual(result.payment!.paidAt, '2026-08-20', 'con el flag en false, paidAt es la fecha real, nunca clampeada');
  assertEqual(result.allocation!.amount, 100000, 'sin recargos automáticos, el importe exigido sigue siendo el importe base, aunque genuinamente esté vencido');
});
