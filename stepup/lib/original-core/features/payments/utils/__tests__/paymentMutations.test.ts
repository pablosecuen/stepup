// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentMutations.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAdjustment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { hasMonthlyCharge, hasPerClassCharge } from '../paymentIdempotency.ts';
import { allocatePayment, buildAdjustment, buildMonthlyCharge, buildPaymentAllocations, buildPerClassCharge, recordPayment, replacePayment, voidAdjustment, voidCharge, voidPayment } from '../paymentMutations.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function sampleCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    studentId: 's1',
    type: 'mensual',
    originalAmount: 10000,
    currency: 'ARS',
    dueDate: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z',
    billingPeriod: '2026-07',
    voidedAt: null,
    voidReason: null,
    ...overrides,
  };
}

function samplePayment(overrides: Partial<Payment> = {}): Payment {
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

test('crear dos veces la misma obligación mensual (mismo alumno y período) lanza en vez de duplicar', () => {
  const first = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-07',
    dueDate: '2026-07-01',
    originalAmount: 10000,
    createdAt: '2026-07-01T00:00:00.000Z',
    existingCharges: [],
  });
  assert(hasMonthlyCharge('s1', '2026-07', [first]), 'queda registrada con la clave determinística');

  let rejected = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-07',
      dueDate: '2026-07-01',
      originalAmount: 10000,
      createdAt: '2026-07-02T00:00:00.000Z',
      existingCharges: [first],
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se genera un segundo cargo para el mismo alumno y mes');
});

test('crear dos veces la misma obligación por clase (mismo alumno y savedLessonId) lanza en vez de duplicar', () => {
  const first = buildPerClassCharge({
    studentId: 's1',
    savedLessonId: 'lesson-1',
    dueDate: '2026-07-11',
    originalAmount: 9500,
    createdAt: '2026-07-11T00:00:00.000Z',
    existingCharges: [],
  });
  assert(hasPerClassCharge('s1', 'lesson-1', [first]), 'queda registrada con la clave determinística');

  let rejected = false;
  try {
    buildPerClassCharge({
      studentId: 's1',
      savedLessonId: 'lesson-1',
      dueDate: '2026-07-11',
      originalAmount: 9500,
      createdAt: '2026-07-12T00:00:00.000Z',
      existingCharges: [first],
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se genera un segundo cargo para la misma clase');
});

test('distintos alumnos o distintos períodos/clases sí generan cargos distintos', () => {
  const charges: PaymentCharge[] = [
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-07',
      dueDate: '2026-07-01',
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    }),
  ];
  const otherStudent = buildMonthlyCharge({
    studentId: 's2',
    billingPeriod: '2026-07',
    dueDate: '2026-07-01',
    originalAmount: 8000,
    createdAt: '2026-07-01T00:00:00.000Z',
    existingCharges: charges,
  });
  const otherPeriod = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-08',
    dueDate: '2026-08-01',
    originalAmount: 10000,
    createdAt: '2026-08-01T00:00:00.000Z',
    existingCharges: [...charges, otherStudent],
  });
  assert(otherStudent.id !== charges[0].id, 'otro alumno: id distinto');
  assert(otherPeriod.id !== charges[0].id, 'otro período: id distinto');
});

test('recordPayment acepta paidAt anterior a recordedAt (carga retroactiva)', () => {
  const p = recordPayment({
    id: 'payment-1',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-20T00:00:00.000Z',
    todayDateKey: '2026-07-20',
  });
  assertEqual(p.paidAt, '2026-07-05', 'conserva la fecha real de pago');
  assertEqual(p.recordedAt, '2026-07-20T00:00:00.000Z', 'conserva el momento de carga, posterior');
});

test('recordPayment rechaza paidAt futuro', () => {
  let rejected = false;
  try {
    recordPayment({
      id: 'payment-1',
      studentId: 's1',
      amount: 10000,
      method: 'efectivo',
      paidAt: '2026-07-25',
      recordedAt: '2026-07-20T00:00:00.000Z',
      todayDateKey: '2026-07-20', // "hoy" es anterior a paidAt
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no permite registrar un pago con fecha futura');
});

test('recordPayment acepta paidAt igual a hoy (límite)', () => {
  const p = recordPayment({
    id: 'payment-1',
    studentId: 's1',
    amount: 5000,
    method: 'transferencia',
    paidAt: '2026-07-20',
    recordedAt: '2026-07-20T18:00:00.000Z',
    todayDateKey: '2026-07-20',
  });
  assertEqual(p.paidAt, '2026-07-20', 'pagar el mismo día es válido');
});

test('anulación y reemplazo: el pago original permanece en el historial, íntegro y anulado', () => {
  const original = recordPayment({
    id: 'payment-1',
    studentId: 's1',
    amount: 9000, // importe cargado por error
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-05T12:00:00.000Z',
    todayDateKey: '2026-07-05',
  });
  const correction = recordPayment({
    id: 'payment-2',
    studentId: 's1',
    amount: 10000, // importe correcto
    method: 'efectivo',
    paidAt: '2026-07-05',
    recordedAt: '2026-07-06T09:00:00.000Z',
    todayDateKey: '2026-07-06',
  });

  const result = replacePayment(
    [original],
    'payment-1',
    'Importe cargado por error, se corrige',
    '2026-07-06T09:00:00.000Z',
    correction
  );

  assertEqual(result.payments.length, 2, 'no se borra: quedan los dos registros');
  const voided = result.payments.find((p) => p.id === 'payment-1')!;
  assertEqual(voided.voidedAt, '2026-07-06T09:00:00.000Z', 'el original queda anulado');
  assertEqual(voided.voidReason, 'Importe cargado por error, se corrige', 'con motivo');
  assertEqual(voided.amount, 9000, 'el importe original del historial no se reescribe');
  assertEqual(result.newPayment.replacesPaymentId, 'payment-1', 'el nuevo pago referencia al que reemplaza');
});

test('voidPayment nunca elimina el registro, sólo lo marca anulado', () => {
  const payments = [
    recordPayment({
      id: 'payment-1',
      studentId: 's1',
      amount: 5000,
      method: 'otro',
      paidAt: '2026-07-05',
      recordedAt: '2026-07-05T00:00:00.000Z',
      todayDateKey: '2026-07-05',
    }),
  ];
  const result = voidPayment(payments, 'payment-1', 'Duplicado', '2026-07-06T00:00:00.000Z');
  assertEqual(result.length, 1, 'el registro sigue existiendo');
  assertEqual(result[0].voidedAt, '2026-07-06T00:00:00.000Z', 'queda anulado');
  assertEqual(payments[0].voidedAt, null, 'no muta el array original');
});

test('buildAdjustment crea una condonación con motivo obligatorio', () => {
  const adjustment = buildAdjustment({
    id: 'adj-1',
    chargeId: 'charge-1',
    studentId: 's1',
    reason: 'Situación familiar difícil, se condona el recargo',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  assertEqual(adjustment.voidedAt, null, 'nace vigente');

  let rejected = false;
  try {
    buildAdjustment({
      id: 'adj-2',
      chargeId: 'charge-1',
      studentId: 's1',
      reason: '   ',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'exige un motivo real, no vacío');
});

test('voidAdjustment revierte la condonación dejando historial, con fecha y motivo', () => {
  const adjustment = buildAdjustment({
    id: 'adj-1',
    chargeId: 'charge-1',
    studentId: 's1',
    reason: 'Condonación de prueba',
    createdAt: '2026-07-20T00:00:00.000Z',
  });
  const result = voidAdjustment([adjustment], 'adj-1', 'Cargada por error', '2026-07-21T00:00:00.000Z');
  assertEqual(result[0].voidedAt, '2026-07-21T00:00:00.000Z', 'queda anulada con fecha');
  assertEqual(result[0].voidReason, 'Cargada por error', 'y con motivo');
  assertEqual(adjustment.voidedAt, null, 'no muta el objeto original');
});

test('buildPaymentAllocations reparte un pago entre varias obligaciones sin superar el total', () => {
  const payment = { id: 'payment-1', studentId: 's1', amount: 15000 };
  const allocations = buildPaymentAllocations(payment, [
    { id: 'a1', chargeId: 'charge-1', amount: 10000 },
    { id: 'a2', chargeId: 'charge-2', amount: 5000 },
  ]);
  assertEqual(allocations.length, 2, 'una asignación por obligación');
  assertEqual(
    allocations.reduce((sum, a) => sum + a.amount, 0),
    15000,
    'la suma coincide con el pago'
  );
});

test('buildPaymentAllocations rechaza repartir más de lo que se pagó', () => {
  const payment = { id: 'payment-1', studentId: 's1', amount: 10000 };
  let rejected = false;
  try {
    buildPaymentAllocations(payment, [
      { id: 'a1', chargeId: 'charge-1', amount: 6000 },
      { id: 'a2', chargeId: 'charge-2', amount: 6000 },
    ]);
  } catch {
    rejected = true;
  }
  assert(rejected, 'la suma de asignaciones no puede superar el importe del pago');
});

test('buildPaymentAllocations rechaza NaN e Infinity (antes se colaban porque NaN <= 0 es false)', () => {
  const payment = { id: 'payment-1', studentId: 's1', amount: 10000 };

  let rejectedNaN = false;
  try {
    buildPaymentAllocations(payment, [{ id: 'a1', chargeId: 'charge-1', amount: NaN }]);
  } catch {
    rejectedNaN = true;
  }
  assert(rejectedNaN, 'un importe NaN debe rechazarse, nunca terminar serializado como null');

  let rejectedInfinite = false;
  try {
    buildPaymentAllocations(payment, [{ id: 'a1', chargeId: 'charge-1', amount: Infinity }]);
  } catch {
    rejectedInfinite = true;
  }
  assert(rejectedInfinite, 'un importe Infinity debe rechazarse');
});

test('buildPaymentAllocations rechaza importes cero o negativos', () => {
  const payment = { id: 'payment-1', studentId: 's1', amount: 10000 };
  let rejectedZero = false;
  try {
    buildPaymentAllocations(payment, [{ id: 'a1', chargeId: 'charge-1', amount: 0 }]);
  } catch {
    rejectedZero = true;
  }
  assert(rejectedZero, 'rechaza importe cero');

  let rejectedNegative = false;
  try {
    buildPaymentAllocations(payment, [{ id: 'a1', chargeId: 'charge-1', amount: -500 }]);
  } catch {
    rejectedNegative = true;
  }
  assert(rejectedNegative, 'rechaza importe negativo');
});

test('buildPaymentAllocations rechaza un importe de pago no positivo o no finito', () => {
  let rejectedZeroPayment = false;
  try {
    buildPaymentAllocations({ id: 'payment-1', studentId: 's1', amount: 0 }, [
      { id: 'a1', chargeId: 'charge-1', amount: 100 },
    ]);
  } catch {
    rejectedZeroPayment = true;
  }
  assert(rejectedZeroPayment, 'un pago de importe cero no se puede repartir');

  let rejectedNaNPayment = false;
  try {
    buildPaymentAllocations({ id: 'payment-1', studentId: 's1', amount: NaN }, [
      { id: 'a1', chargeId: 'charge-1', amount: 100 },
    ]);
  } catch {
    rejectedNaNPayment = true;
  }
  assert(rejectedNaNPayment, 'un pago con importe NaN no se puede repartir');
});

test('buildPaymentAllocations rechaza ids vacíos (del pago, de la asignación o del cargo)', () => {
  let rejectedPaymentId = false;
  try {
    buildPaymentAllocations({ id: '', studentId: 's1', amount: 10000 }, [
      { id: 'a1', chargeId: 'charge-1', amount: 1000 },
    ]);
  } catch {
    rejectedPaymentId = true;
  }
  assert(rejectedPaymentId, 'rechaza id de pago vacío');

  let rejectedAllocationId = false;
  try {
    buildPaymentAllocations({ id: 'payment-1', studentId: 's1', amount: 10000 }, [
      { id: '   ', chargeId: 'charge-1', amount: 1000 },
    ]);
  } catch {
    rejectedAllocationId = true;
  }
  assert(rejectedAllocationId, 'rechaza id de asignación vacío');

  let rejectedChargeId = false;
  try {
    buildPaymentAllocations({ id: 'payment-1', studentId: 's1', amount: 10000 }, [
      { id: 'a1', chargeId: '', amount: 1000 },
    ]);
  } catch {
    rejectedChargeId = true;
  }
  assert(rejectedChargeId, 'rechaza chargeId vacío');
});

test('buildPaymentAllocations rechaza ids de asignación duplicados', () => {
  const payment = { id: 'payment-1', studentId: 's1', amount: 10000 };
  let rejected = false;
  try {
    buildPaymentAllocations(payment, [
      { id: 'a1', chargeId: 'charge-1', amount: 3000 },
      { id: 'a1', chargeId: 'charge-2', amount: 3000 }, // mismo id que el anterior
    ]);
  } catch {
    rejected = true;
  }
  assert(rejected, 'no puede haber dos asignaciones con el mismo id');
});

// ---------------------------------------------------------------------------
// Validaciones de cargos
// ---------------------------------------------------------------------------

test('buildMonthlyCharge rechaza billingPeriod con formato inválido', () => {
  let rejected = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026/07',
      dueDate: '2026-07-01',
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'billingPeriod debe tener el formato YYYY-MM');
});

test('buildMonthlyCharge rechaza meses imposibles (00 y 13), acepta los límites 01 y 12', () => {
  let rejected00 = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-00',
      dueDate: '2026-00-01',
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejected00 = true;
  }
  assert(rejected00, 'mes 00 no existe');

  let rejected13 = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-13',
      dueDate: '2026-13-01',
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejected13 = true;
  }
  assert(rejected13, 'mes 13 no existe');

  const january = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-01',
    dueDate: '2026-01-01',
    originalAmount: 10000,
    createdAt: '2026-01-01T00:00:00.000Z',
    existingCharges: [],
  });
  assertEqual(january.billingPeriod, '2026-01', 'enero (límite inferior) se acepta');

  const december = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-12',
    dueDate: '2026-12-01',
    originalAmount: 10000,
    createdAt: '2026-12-01T00:00:00.000Z',
    existingCharges: [january],
  });
  assertEqual(december.billingPeriod, '2026-12', 'diciembre (límite superior) se acepta');
});

// Corrección (a pedido de Joaquín — primer mes proporcional al agregar un
// alumno a una serie): antes se exigía EXACTAMENTE el día 1 del período —
// ahora acepta cualquier día real DENTRO del propio período (el cargo del
// primer mes proporcional de un alumno incorporado a mitad de mes necesita
// vencer en su fecha real de incorporación, no en el día 1, para que el
// motor de recargos nunca lo trate como moroso retroactivo). Sigue
// rechazando cualquier fecha FUERA del período — sólo se amplió el rango
// permitido, nunca se eliminó la validación.
test('buildMonthlyCharge acepta un vencimiento que NO es el día 1, siempre que caiga dentro del propio período', () => {
  const charge = buildMonthlyCharge({
    studentId: 's1',
    billingPeriod: '2026-07',
    dueDate: '2026-07-15', // mitad del período, no el día 1
    originalAmount: 10000,
    createdAt: '2026-07-01T00:00:00.000Z',
    existingCharges: [],
  });
  assertEqual(charge.dueDate, '2026-07-15', 'conserva el vencimiento real dentro del período, sin forzarlo al día 1');
});

test('buildMonthlyCharge rechaza un vencimiento FUERA del propio período facturado', () => {
  let rejectedBefore = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-07',
      dueDate: '2026-06-30', // un día antes del período
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedBefore = true;
  }
  assert(rejectedBefore, 'una fecha anterior al período se rechaza');

  let rejectedAfter = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-07',
      dueDate: '2026-08-01', // un día después del período
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedAfter = true;
  }
  assert(rejectedAfter, 'una fecha posterior al período también se rechaza');
});

test('buildMonthlyCharge rechaza importe original no positivo o alumno vacío', () => {
  let rejectedAmount = false;
  try {
    buildMonthlyCharge({
      studentId: 's1',
      billingPeriod: '2026-07',
      dueDate: '2026-07-01',
      originalAmount: 0,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedAmount = true;
  }
  assert(rejectedAmount, 'rechaza importe original no positivo');

  let rejectedStudent = false;
  try {
    buildMonthlyCharge({
      studentId: '   ',
      billingPeriod: '2026-07',
      dueDate: '2026-07-01',
      originalAmount: 10000,
      createdAt: '2026-07-01T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedStudent = true;
  }
  assert(rejectedStudent, 'rechaza un alumno vacío');
});

test('buildPerClassCharge rechaza savedLessonId vacío y dueDate inválida', () => {
  let rejectedLesson = false;
  try {
    buildPerClassCharge({
      studentId: 's1',
      savedLessonId: '   ',
      dueDate: '2026-07-11',
      originalAmount: 9500,
      createdAt: '2026-07-11T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedLesson = true;
  }
  assert(rejectedLesson, 'un cargo por clase necesita savedLessonId');

  let rejectedDate = false;
  try {
    buildPerClassCharge({
      studentId: 's1',
      savedLessonId: 'lesson-1',
      dueDate: '2026-13-40',
      originalAmount: 9500,
      createdAt: '2026-07-11T00:00:00.000Z',
      existingCharges: [],
    });
  } catch {
    rejectedDate = true;
  }
  assert(rejectedDate, 'rechaza una fecha de vencimiento inválida');
});

test('voidCharge anula un cargo vigente y rechaza anular uno inexistente, ya anulado, o sin motivo', () => {
  const charge = sampleCharge();
  const result = voidCharge([charge], 'charge-1', 'Error de carga', '2026-07-10T00:00:00.000Z');
  assertEqual(result[0].voidedAt, '2026-07-10T00:00:00.000Z', 'queda anulado');
  assertEqual(charge.voidedAt, null, 'no muta el original');

  let rejectedMissing = false;
  try {
    voidCharge([charge], 'charge-inexistente', 'motivo', '2026-07-10T00:00:00.000Z');
  } catch {
    rejectedMissing = true;
  }
  assert(rejectedMissing, 'no se puede anular un cargo que no existe');

  let rejectedTwice = false;
  try {
    voidCharge(result, 'charge-1', 'motivo', '2026-07-11T00:00:00.000Z');
  } catch {
    rejectedTwice = true;
  }
  assert(rejectedTwice, 'no se puede anular un cargo ya anulado');

  let rejectedNoReason = false;
  try {
    voidCharge([charge], 'charge-1', '   ', '2026-07-10T00:00:00.000Z');
  } catch {
    rejectedNoReason = true;
  }
  assert(rejectedNoReason, 'la anulación necesita un motivo real');
});

// ---------------------------------------------------------------------------
// Validaciones adicionales de pagos
// ---------------------------------------------------------------------------

test('recordPayment rechaza paidAt posterior a recordedAt', () => {
  let rejected = false;
  try {
    recordPayment({
      id: 'payment-1',
      studentId: 's1',
      amount: 10000,
      method: 'efectivo',
      paidAt: '2026-07-10', // posterior al momento en que se cargó
      recordedAt: '2026-07-05T00:00:00.000Z',
      todayDateKey: '2026-07-20',
    });
  } catch {
    rejected = true;
  }
  assert(rejected, 'paidAt no puede ser posterior a recordedAt');
});

test('recordPayment rechaza método inválido e importe no positivo', () => {
  let rejectedMethod = false;
  try {
    recordPayment({
      id: 'payment-1',
      studentId: 's1',
      amount: 10000,
      method: 'tarjeta' as never,
      paidAt: '2026-07-05',
      recordedAt: '2026-07-05T00:00:00.000Z',
      todayDateKey: '2026-07-20',
    });
  } catch {
    rejectedMethod = true;
  }
  assert(rejectedMethod, 'rechaza un medio de pago no permitido');

  let rejectedAmount = false;
  try {
    recordPayment({
      id: 'payment-1',
      studentId: 's1',
      amount: 0,
      method: 'efectivo',
      paidAt: '2026-07-05',
      recordedAt: '2026-07-05T00:00:00.000Z',
      todayDateKey: '2026-07-20',
    });
  } catch {
    rejectedAmount = true;
  }
  assert(rejectedAmount, 'rechaza un importe no positivo');
});

test('voidPayment rechaza anular un pago inexistente, ya anulado o sin motivo', () => {
  const payment = samplePayment();

  let rejectedMissing = false;
  try {
    voidPayment([payment], 'payment-inexistente', 'motivo', '2026-07-06T00:00:00.000Z');
  } catch {
    rejectedMissing = true;
  }
  assert(rejectedMissing, 'no se puede anular un pago que no existe');

  const voided = voidPayment([payment], 'payment-1', 'motivo', '2026-07-06T00:00:00.000Z');
  let rejectedTwice = false;
  try {
    voidPayment(voided, 'payment-1', 'otro motivo', '2026-07-07T00:00:00.000Z');
  } catch {
    rejectedTwice = true;
  }
  assert(rejectedTwice, 'no se puede anular un pago ya anulado');

  let rejectedNoReason = false;
  try {
    voidPayment([payment], 'payment-1', '', '2026-07-06T00:00:00.000Z');
  } catch {
    rejectedNoReason = true;
  }
  assert(rejectedNoReason, 'la anulación necesita un motivo real');
});

test('replacePayment rechaza reemplazo entre alumnos distintos', () => {
  const original = samplePayment({ id: 'payment-1', studentId: 's1' });
  const crossStudentReplacement = samplePayment({ id: 'payment-2', studentId: 's2' });

  let rejected = false;
  try {
    replacePayment([original], 'payment-1', 'Corrección', '2026-07-06T00:00:00.000Z', crossStudentReplacement);
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede reemplazar el pago de un alumno con el de otro alumno');
});

test('replacePayment rechaza reemplazar un pago inexistente o con un id duplicado', () => {
  const original = samplePayment({ id: 'payment-1', studentId: 's1' });

  let rejectedMissing = false;
  try {
    replacePayment(
      [original],
      'payment-inexistente',
      'Corrección',
      '2026-07-06T00:00:00.000Z',
      samplePayment({ id: 'payment-2', studentId: 's1' })
    );
  } catch {
    rejectedMissing = true;
  }
  assert(rejectedMissing, 'no se puede reemplazar un pago que no existe');

  let rejectedDuplicateId = false;
  try {
    replacePayment(
      [original],
      'payment-1',
      'Corrección',
      '2026-07-06T00:00:00.000Z',
      samplePayment({ id: 'payment-1', studentId: 's1' }) // mismo id que el que reemplaza
    );
  } catch {
    rejectedDuplicateId = true;
  }
  assert(rejectedDuplicateId, 'el pago nuevo necesita un id distinto del que reemplaza');
});

// ---------------------------------------------------------------------------
// Condonaciones — validaciones adicionales
// ---------------------------------------------------------------------------

test('buildAdjustment rechaza campos vacíos o createdAt inválido', () => {
  const scenarios: Array<() => void> = [
    () =>
      buildAdjustment({
        id: '',
        chargeId: 'charge-1',
        studentId: 's1',
        reason: 'motivo válido',
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
    () =>
      buildAdjustment({
        id: 'adj-1',
        chargeId: '',
        studentId: 's1',
        reason: 'motivo válido',
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
    () =>
      buildAdjustment({
        id: 'adj-1',
        chargeId: 'charge-1',
        studentId: '',
        reason: 'motivo válido',
        createdAt: '2026-07-20T00:00:00.000Z',
      }),
    () =>
      buildAdjustment({
        id: 'adj-1',
        chargeId: 'charge-1',
        studentId: 's1',
        reason: 'motivo válido',
        createdAt: 'no-es-una-fecha',
      }),
  ];
  scenarios.forEach((run, index) => {
    let rejected = false;
    try {
      run();
    } catch {
      rejected = true;
    }
    assert(rejected, `escenario ${index} debe rechazarse`);
  });
});

test('voidAdjustment rechaza anular una condonación inexistente o ya anulada', () => {
  const adjustment: PaymentAdjustment = buildAdjustment({
    id: 'adj-1',
    chargeId: 'charge-1',
    studentId: 's1',
    reason: 'motivo',
    createdAt: '2026-07-20T00:00:00.000Z',
  });

  let rejectedMissing = false;
  try {
    voidAdjustment([adjustment], 'adj-inexistente', 'motivo', '2026-07-21T00:00:00.000Z');
  } catch {
    rejectedMissing = true;
  }
  assert(rejectedMissing, 'no se puede anular una condonación que no existe');

  const voided = voidAdjustment([adjustment], 'adj-1', 'motivo', '2026-07-21T00:00:00.000Z');
  let rejectedTwice = false;
  try {
    voidAdjustment(voided, 'adj-1', 'otro motivo', '2026-07-22T00:00:00.000Z');
  } catch {
    rejectedTwice = true;
  }
  assert(rejectedTwice, 'no se puede anular una condonación ya anulada');
});

// ---------------------------------------------------------------------------
// allocatePayment — operación segura de asignación contra el estado completo
// ---------------------------------------------------------------------------

test('allocatePayment crea la asignación cuando todo es válido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ originalAmount: 10000 })],
    payments: [samplePayment({ amount: 10000 })],
  };
  const allocation = allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 10000, state });
  assertEqual(allocation.studentId, 's1', 'toma el alumno del pago');
  assertEqual(allocation.amount, 10000, 'conserva el importe');
});

test('allocatePayment rechaza referenciar un pago o un cargo inexistente', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge()],
    payments: [samplePayment()],
  };

  let rejectedPayment = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-inexistente', chargeId: 'charge-1', amount: 1000, state });
  } catch {
    rejectedPayment = true;
  }
  assert(rejectedPayment, 'rechaza un pago que no existe');

  let rejectedCharge = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-inexistente', amount: 1000, state });
  } catch {
    rejectedCharge = true;
  }
  assert(rejectedCharge, 'rechaza un cargo que no existe');
});

test('allocatePayment rechaza asignar un pago anulado', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge()],
    payments: [samplePayment({ voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'error' })],
  };
  let rejected = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 1000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede asignar un pago anulado');
});

test('allocatePayment rechaza asignar contra un cargo anulado', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'error' })],
    payments: [samplePayment()],
  };
  let rejected = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 1000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se puede asignar contra un cargo anulado');
});

test('allocatePayment rechaza alumnos distintos entre pago y cargo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ studentId: 's2' })],
    payments: [samplePayment({ studentId: 's1' })],
  };
  let rejected = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 1000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'el pago y el cargo pertenecen a alumnos distintos');
});

test('allocatePayment rechaza un id duplicado y una asignación duplicada entre el mismo pago y cargo', () => {
  const existingAllocation: PaymentAllocation = {
    id: 'alloc-existing',
    paymentId: 'payment-1',
    chargeId: 'charge-1',
    studentId: 's1',
    amount: 1000,
  };
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ originalAmount: 10000 })],
    payments: [samplePayment({ amount: 10000 })],
    allocations: [existingAllocation],
  };

  let rejectedDuplicateId = false;
  try {
    allocatePayment({ id: 'alloc-existing', paymentId: 'payment-1', chargeId: 'charge-1', amount: 500, state });
  } catch {
    rejectedDuplicateId = true;
  }
  assert(rejectedDuplicateId, 'rechaza un id de asignación ya usado');

  let rejectedDuplicatePair = false;
  try {
    allocatePayment({ id: 'alloc-new', paymentId: 'payment-1', chargeId: 'charge-1', amount: 500, state });
  } catch {
    rejectedDuplicatePair = true;
  }
  assert(rejectedDuplicatePair, 'rechaza una segunda asignación entre el mismo pago y el mismo cargo');
});

test('allocatePayment rechaza cuando la suma histórica de asignaciones supera el importe del pago', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ id: 'charge-1' }), sampleCharge({ id: 'charge-2', originalAmount: 10000 })],
    payments: [samplePayment({ amount: 10000 })],
    allocations: [
      { id: 'alloc-existing', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 8000 },
    ],
  };
  let rejected = false;
  try {
    // 8000 ya asignados + 5000 nuevos = 13000, supera el pago de 10000.
    allocatePayment({ id: 'alloc-new', paymentId: 'payment-1', chargeId: 'charge-2', amount: 5000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'las asignaciones acumuladas no pueden superar el importe del pago');
});

test('allocatePayment rechaza sobreasignar más de lo necesario para saldar el cargo en la fecha del pago', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    // Vence el 1/7; pagado el 5/7 (día 5, en término: requiere sólo 10000).
    charges: [sampleCharge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [samplePayment({ amount: 15000, paidAt: '2026-07-05' })],
  };
  let rejected = false;
  try {
    // 12000 supera los 10000 requeridos en término: no se admite saldo a favor.
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 12000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'no se admite asignar más de lo necesario para saldar la obligación en la fecha del pago');
});

test('allocatePayment rechaza importes no positivos o no finitos', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge()],
    payments: [samplePayment()],
  };
  let rejectedZero = false;
  try {
    allocatePayment({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', amount: 0, state });
  } catch {
    rejectedZero = true;
  }
  assert(rejectedZero, 'rechaza importe cero');

  let rejectedInfinite = false;
  try {
    allocatePayment({ id: 'alloc-2', paymentId: 'payment-1', chargeId: 'charge-1', amount: Infinity, state });
  } catch {
    rejectedInfinite = true;
  }
  assert(rejectedInfinite, 'rechaza importe infinito');
});

// ---------------------------------------------------------------------------
// allocatePayment — asignaciones retroactivas fuera de orden (bug reportado
// por Codex): la validación debe simular TODAS las asignaciones vigentes en
// orden cronológico por `paidAt`, no comparar sólo contra el requerido en la
// fecha del nuevo pago ni depender del orden en que se cargaron.
// ---------------------------------------------------------------------------

test('allocatePayment acepta un pago retroactivo cargado después de otro con fecha posterior (caso exacto reportado, sin recargo)', () => {
  // Cargo mensual $10.000, vence 1/7. Ya existe una asignación de $6.000
  // con paidAt 20/07. Ahora se registra un pago retroactivo con paidAt
  // 05/07. Sin recargos automáticos, el requerido en CUALQUIER fecha es
  // siempre $10.000 — así que lo máximo que puede aceptarse en 05/07, sin
  // exceder lo requerido al 20/07 (punto de control posterior), es
  // 10.000 - 6.000 = $4.000.
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      samplePayment({ id: 'payment-late', amount: 6000, paidAt: '2026-07-20' }),
      samplePayment({ id: 'payment-retro', amount: 4000, paidAt: '2026-07-05' }),
    ],
    allocations: [
      { id: 'alloc-late', paymentId: 'payment-late', chargeId: 'charge-1', studentId: 's1', amount: 6000 },
    ],
  };

  const allocation = allocatePayment({
    id: 'alloc-retro',
    paymentId: 'payment-retro',
    chargeId: 'charge-1',
    amount: 4000,
    state,
  });
  assertEqual(allocation.amount, 4000, 'la asignación retroactiva se acepta, respetando el punto de control posterior');
});

test('allocatePayment rechaza cuando insertar la asignación cronológicamente sí produce un excedente real', () => {
  // Existe una asignación de $8.000 el 05/07 (on_time, requiere 10000: no
  // alcanza). Se intenta agregar $4.000 el 06/07 (sigue on_time, requiere
  // 10000): acumulado 12000 supera los 10000 requeridos ese día por 2000.
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      samplePayment({ id: 'payment-a', amount: 8000, paidAt: '2026-07-05' }),
      samplePayment({ id: 'payment-b', amount: 4000, paidAt: '2026-07-06' }),
    ],
    allocations: [{ id: 'alloc-a', paymentId: 'payment-a', chargeId: 'charge-1', studentId: 's1', amount: 8000 }],
  };

  let rejected = false;
  try {
    allocatePayment({ id: 'alloc-b', paymentId: 'payment-b', chargeId: 'charge-1', amount: 4000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'el excedente real (2000 de más) se rechaza aunque la fecha del nuevo pago sea distinta');
});

test('allocatePayment rechaza cualquier asignación posterior a que el cargo ya quedó completamente saldado', () => {
  // El cargo ya se saldó con una asignación previa de $10.000 el 05/07.
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [sampleCharge({ originalAmount: 10000, dueDate: '2026-07-01' })],
    payments: [
      samplePayment({ id: 'payment-settled', amount: 10000, paidAt: '2026-07-05' }),
      samplePayment({ id: 'payment-extra', amount: 1000, paidAt: '2026-07-03' }), // incluso con paidAt ANTERIOR
    ],
    allocations: [
      { id: 'alloc-settled', paymentId: 'payment-settled', chargeId: 'charge-1', studentId: 's1', amount: 10000 },
    ],
  };

  let rejected = false;
  try {
    allocatePayment({ id: 'alloc-extra', paymentId: 'payment-extra', chargeId: 'charge-1', amount: 1000, state });
  } catch {
    rejected = true;
  }
  assert(rejected, 'una obligación ya saldada no admite más asignaciones, sin importar la fecha de la nueva');
});

test('allocatePayment: el resultado no depende del orden de las asignaciones existentes en el estado', () => {
  // Dos asignaciones existentes (día 5 y día 12, ninguna salda todavía) más
  // una nueva el día 20 que sí salda exacto (sin excedente, sin recargo: el
  // requerido es siempre $10.000). El resultado debe ser el mismo sin
  // importar en qué orden aparecen las existentes dentro de `state.allocations`.
  const chargeFixture = sampleCharge({ originalAmount: 10000, dueDate: '2026-07-01' });
  const paymentsFixture: Payment[] = [
    samplePayment({ id: 'payment-day5', amount: 3000, paidAt: '2026-07-05' }),
    samplePayment({ id: 'payment-day12', amount: 4000, paidAt: '2026-07-12' }),
    samplePayment({ id: 'payment-day20', amount: 3000, paidAt: '2026-07-20' }),
  ];
  const allocDay5: PaymentAllocation = {
    id: 'alloc-day5',
    paymentId: 'payment-day5',
    chargeId: 'charge-1',
    studentId: 's1',
    amount: 3000,
  };
  const allocDay12: PaymentAllocation = {
    id: 'alloc-day12',
    paymentId: 'payment-day12',
    chargeId: 'charge-1',
    studentId: 's1',
    amount: 4000,
  };

  const stateInOrder: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [chargeFixture],
    payments: paymentsFixture,
    allocations: [allocDay5, allocDay12],
  };
  const stateReversed: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [chargeFixture],
    payments: paymentsFixture,
    allocations: [allocDay12, allocDay5],
  };

  const resultInOrder = allocatePayment({
    id: 'alloc-day20',
    paymentId: 'payment-day20',
    chargeId: 'charge-1',
    amount: 3000,
    state: stateInOrder,
  });
  const resultReversed = allocatePayment({
    id: 'alloc-day20',
    paymentId: 'payment-day20',
    chargeId: 'charge-1',
    amount: 3000,
    state: stateReversed,
  });

  assertEqual(resultInOrder.amount, 3000, 'se acepta en el orden original');
  assertEqual(resultReversed.amount, 3000, 'se acepta igual con las asignaciones existentes en orden inverso');
});
