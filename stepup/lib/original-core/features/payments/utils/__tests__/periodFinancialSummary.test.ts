// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/periodFinancialSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { buildPeriodFinancialSummary, comparePeriodValues, previousComparableRange, resolveFinancialPeriodRange } from '../periodFinancialSummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function charge(overrides: Partial<PaymentCharge> & { id: string; studentId: string }): PaymentCharge {
  return {
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

function payment(overrides: Partial<Payment> & { id: string; studentId: string }): Payment {
  return {
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

function allocation(
  overrides: Partial<PaymentAllocation> & { id: string; paymentId: string; chargeId: string; studentId: string }
): PaymentAllocation {
  return { amount: 10000, ...overrides };
}

// ---------------------------------------------------------------------------
// Generado / Cobrado / Pendiente / Vencido — ejemplo del pedido (§2)
// ---------------------------------------------------------------------------

test('generado: suma originalAmount de cargos activos cuyo dueDate cae en el rango', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 300000 }),
      charge({ id: 'c2', studentId: 's2', dueDate: '2026-07-15', originalAmount: 200000 }),
      charge({ id: 'c3', studentId: 's3', dueDate: '2026-06-30', originalAmount: 999999 }),
    ],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assertEqual(summary.generated, 500000, 'sólo los cargos con vencimiento en julio');
  assertEqual(summary.chargeCount, 2, 'dos cargos en el rango');
});

test('cobrado: suma asignaciones de pagos cuyo paidAt real cae en el rango, no el dueDate del cargo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 100000 })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 100000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 100000 })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assertEqual(summary.collected, 100000, 'el pago se cuenta en julio (paidAt), aunque el cargo sea de junio');
  assertEqual(summary.generated, 0, 'ningún cargo vence en julio');
});

test('pendiente vs vencido: separa el saldo de cargos del rango según su etapa vigente', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c-vencida', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 }),
      charge({ id: 'c-en-termino', studentId: 's2', dueDate: '2026-07-25', originalAmount: 5000 }),
    ],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assert(summary.overdue > 0, 'la vencida (venció el 1/7, evaluado el 20/7) aporta a vencido');
  assertEqual(summary.pending, 5000, 'la que todavía no vence (25/7) aporta a pendiente');
});

test('pago parcial: pendiente refleja el saldo real, no el monto original', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-25', originalAmount: 10000 })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 4000, paidAt: '2026-07-10' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 4000 })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-15',
  });
  assertEqual(summary.generated, 10000, 'generado es el monto completo de la obligación');
  assertEqual(summary.collected, 4000, 'cobrado es sólo lo efectivamente pagado');
  assertEqual(summary.pending, 6000, 'pendiente es el saldo real restante');
});

test('pago retroactivo: paidAt anterior al rango no cuenta como cobrado del rango', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 })],
    payments: [payment({ id: 'p1', studentId: 's1', amount: 10000, paidAt: '2026-06-15' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 10000 })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assertEqual(summary.collected, 0, 'el pago real fue en junio, no cuenta para julio');
});

test('cargo anulado: nunca cuenta como generado ni como pendiente/vencido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000, voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'error' }),
    ],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assertEqual(summary.generated, 0, 'cargo anulado no genera');
  assertEqual(summary.pending, 0, 'cargo anulado no pendiente');
  assertEqual(summary.overdue, 0, 'cargo anulado no vencido');
  assertEqual(summary.chargeCount, 0, 'cargo anulado no cuenta');
});

test('pago anulado: su asignación no cuenta como cobrado aunque siga en el array', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 })],
    payments: [
      payment({ id: 'p1', studentId: 's1', amount: 10000, paidAt: '2026-07-05', voidedAt: '2026-07-06T00:00:00.000Z', voidReason: 'error' }),
    ],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'c1', studentId: 's1', amount: 10000 })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-20',
  });
  assertEqual(summary.collected, 0, 'pago anulado nunca cuenta como cobrado');
});

test('alumno mensual: un único cargo mensual del período nunca se duplica por clase dictada', () => {
  // El motor de cargos ya garantiza un único PaymentCharge mensual por alumno/período —
  // acá se verifica que el analítico no vuelve a contar el mismo cargo dos veces.
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c-mensual', studentId: 's1', type: 'mensual', dueDate: '2026-07-01', originalAmount: 40000 })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-05',
  });
  assertEqual(summary.generated, 40000, 'un único monto, sin importar cuántas clases tuvo el alumno ese mes');
  assertEqual(summary.chargeCount, 1, 'un único cargo');
});

test('paquete: el cargo de compra del paquete cuenta como generado una sola vez en su período', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c-paquete', studentId: 's1', type: 'paquete', dueDate: '2026-07-03', originalAmount: 50000, billingPeriod: undefined, packageId: 'pkg-1' })],
  };
  const summary = buildPeriodFinancialSummary({
    state,
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-05',
  });
  assertEqual(summary.generated, 50000, 'el paquete genera su monto completo una sola vez, en el mes de su vencimiento');
});

// ---------------------------------------------------------------------------
// Presets de período (§1/§9)
// ---------------------------------------------------------------------------

test('resolveFinancialPeriodRange: current_month resuelve el mes calendario completo', () => {
  const range = resolveFinancialPeriodRange('current_month', '2026-07-15');
  assertEqual(range.rangeStart, '2026-07-01', 'primer día del mes');
  assertEqual(range.rangeEnd, '2026-07-31', 'último día del mes');
});

test('resolveFinancialPeriodRange: last_3_months incluye el mes actual como el más reciente', () => {
  const range = resolveFinancialPeriodRange('last_3_months', '2026-07-15');
  assertEqual(range.rangeStart, '2026-05-01', 'arranca hace 2 meses');
  assertEqual(range.rangeEnd, '2026-07-31', 'termina en el mes actual');
});

test('resolveFinancialPeriodRange: cruza el límite de año correctamente', () => {
  const range = resolveFinancialPeriodRange('last_3_months', '2026-01-15');
  assertEqual(range.rangeStart, '2025-11-01', 'noviembre del año anterior');
  assertEqual(range.rangeEnd, '2026-01-31', 'enero del año actual');
});

test('resolveFinancialPeriodRange: current_year y previous_year', () => {
  const current = resolveFinancialPeriodRange('current_year', '2026-07-15');
  assertEqual(current.rangeStart, '2026-01-01', 'inicio del año actual');
  assertEqual(current.rangeEnd, '2026-12-31', 'fin del año actual');
  const previous = resolveFinancialPeriodRange('previous_year', '2026-07-15');
  assertEqual(previous.rangeStart, '2025-01-01', 'inicio del año anterior');
  assertEqual(previous.rangeEnd, '2025-12-31', 'fin del año anterior');
});

// ---------------------------------------------------------------------------
// Comparación con el período anterior (§9) — nunca divide por cero
// ---------------------------------------------------------------------------

test('comparePeriodValues: calcula el porcentaje cuando el período anterior no es cero', () => {
  const comparison = comparePeriodValues(560000, 500000);
  assertEqual(comparison.percentChange, 12, '+12% como en el ejemplo del pedido');
});

test('comparePeriodValues: nunca divide por cero — previous en 0 da percentChange null', () => {
  const comparison = comparePeriodValues(50000, 0);
  assertEqual(comparison.percentChange, null, 'sin base de comparación real, nunca Infinity/NaN');
  assert(Number.isFinite(comparison.current), 'current sigue siendo un número válido');
});

test('previousComparableRange: devuelve un rango del mismo tamaño inmediatamente anterior', () => {
  const previous = previousComparableRange('2026-07-01', '2026-07-31');
  assertEqual(previous.rangeStart, '2026-05-31', 'mismo tamaño (31 días) hacia atrás');
  assertEqual(previous.rangeEnd, '2026-06-30', 'termina justo antes del rango original');
});

// ---------------------------------------------------------------------------
// Seguridad: rangos vacíos, sin mutación
// ---------------------------------------------------------------------------

test('rango sin ningún cargo ni pago: todo en cero, sin errores', () => {
  const summary = buildPeriodFinancialSummary({
    state: emptyState(),
    rangeStart: '2026-07-01',
    rangeEnd: '2026-07-31',
    evaluationDate: '2026-07-15',
  });
  assertEqual(summary.generated, 0, 'sin cargos');
  assertEqual(summary.collected, 0, 'sin pagos');
  assertEqual(summary.pending, 0, 'sin pendiente');
  assertEqual(summary.overdue, 0, 'sin vencido');
});

test('rangeEnd anterior a rangeStart lanza un error explícito en vez de dar resultados incoherentes', () => {
  let threw = false;
  try {
    buildPeriodFinancialSummary({
      state: emptyState(),
      rangeStart: '2026-07-31',
      rangeEnd: '2026-07-01',
      evaluationDate: '2026-07-15',
    });
  } catch {
    threw = true;
  }
  assert(threw, 'rechaza un rango invertido en vez de calcular silenciosamente algo incorrecto');
});

test('no muta el estado recibido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01', originalAmount: 10000 })],
  };
  const snapshot = JSON.stringify(state);
  buildPeriodFinancialSummary({ state, rangeStart: '2026-07-01', rangeEnd: '2026-07-31', evaluationDate: '2026-07-15' });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});
