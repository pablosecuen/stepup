// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/buildHomeFinancialSummary.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import { allocatePayment, recordPayment } from '../paymentMutations.ts';
import { buildHomeFinancialSummary } from '../buildHomeFinancialSummary.ts';
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

test('sin datos: todo en cero, sin alumnos ni recordatorios', () => {
  const summary = buildHomeFinancialSummary({ state: emptyState(), evaluationDate: '2026-07-15' });
  assertEqual(summary.monthlyCollected, 0, 'sin cobros');
  assertEqual(summary.pendingOnTimeBalance, 0, 'sin pendiente');
  assertEqual(summary.overdueBalance, 0, 'sin vencido');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 0, 'sin alumnos que pagaron');
  assertEqual(summary.uniqueStudentsWithDebt, 0, 'sin alumnos con deuda');
  assertEqual(summary.overdueStudents.length, 0, 'sin recordatorios');
});

// ---------------------------------------------------------------------------
// Cálculo mensual: usa paidAt (fecha real), nunca recordedAt ni createdAt
// ---------------------------------------------------------------------------

test('cálculo mensual: sólo cuenta pagos cuyo paidAt real cae en el mes actual', () => {
  const state: PaymentsRepositoryState = {
    charges: [
      charge({ id: 'charge-junio', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06' }),
      charge({ id: 'charge-julio', studentId: 's2', dueDate: '2026-07-01', billingPeriod: '2026-07' }),
    ],
    payments: [
      payment({ id: 'payment-junio', studentId: 's1', amount: 10000, paidAt: '2026-06-20', recordedAt: '2026-06-20T12:00:00.000Z' }),
      // cargado en julio pero pagado en junio: cuenta para junio, no para julio
      payment({ id: 'payment-retroactivo', studentId: 's2', amount: 5000, paidAt: '2026-06-25', recordedAt: '2026-07-10T12:00:00.000Z' }),
      payment({ id: 'payment-julio', studentId: 's2', amount: 5000, paidAt: '2026-07-05', recordedAt: '2026-07-05T12:00:00.000Z' }),
    ],
    allocations: [
      allocation({ id: 'alloc-junio', paymentId: 'payment-junio', chargeId: 'charge-junio', studentId: 's1', amount: 10000 }),
      allocation({ id: 'alloc-retroactivo', paymentId: 'payment-retroactivo', chargeId: 'charge-julio', studentId: 's2', amount: 5000 }),
      allocation({ id: 'alloc-julio', paymentId: 'payment-julio', chargeId: 'charge-julio', studentId: 's2', amount: 5000 }),
    ],
    adjustments: [],
  };

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20' });
  assertEqual(summary.monthlyCollected, 5000, 'sólo el pago cuyo paidAt real es de julio');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 1, 'sólo s2 pagó algo con fecha real de julio');
});

// ---------------------------------------------------------------------------
// Pagos parciales: se reflejan por el monto realmente asignado
// ---------------------------------------------------------------------------

test('pagos parciales: el cobrado del mes usa el importe de la asignación, no el total del cargo', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-1', studentId: 's1', originalAmount: 10000, dueDate: '2026-07-10' })],
    payments: [payment({ id: 'payment-1', studentId: 's1', amount: 4000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 4000 })],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-10' });
  assertEqual(summary.monthlyCollected, 4000, 'sólo lo efectivamente pagado, no el total del cargo');
  assertEqual(summary.pendingOnTimeBalance, 6000, 'el resto queda pendiente (en término, 10/07 todavía no vence)');
  assertEqual(summary.overdueBalance, 0, 'nada vencido todavía');
});

test('un pago dividido entre dos cargos suma exactamente lo asignado a cada uno', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-a', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 6000 }),
      charge({ id: 'charge-b', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 9000 }),
    ],
    payments: [payment({ id: 'payment-1', studentId: 's1', amount: 10000, paidAt: '2026-07-05' })],
    allocations: [
      allocation({ id: 'alloc-a', paymentId: 'payment-1', chargeId: 'charge-a', studentId: 's1', amount: 6000 }),
      allocation({ id: 'alloc-b', paymentId: 'payment-1', chargeId: 'charge-b', studentId: 's1', amount: 4000 }),
    ],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-10' });
  assertEqual(summary.monthlyCollected, 10000, 'ambas asignaciones del mismo pago suman al mes');
});

// ---------------------------------------------------------------------------
// Anulados: nunca cuentan
// ---------------------------------------------------------------------------

test('un pago anulado no cuenta como cobrado, aunque su asignación siga en el array', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-1', studentId: 's1', originalAmount: 10000 })],
    payments: [
      payment({
        id: 'payment-1',
        studentId: 's1',
        amount: 10000,
        paidAt: '2026-07-05',
        voidedAt: '2026-07-06T00:00:00.000Z',
        voidReason: 'error de carga',
      }),
    ],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 10000 })],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-10' });
  assertEqual(summary.monthlyCollected, 0, 'un pago anulado no cuenta como cobrado');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 0, 'tampoco cuenta al alumno');
});

test('un cargo anulado no genera pendiente, vencido, ni cuenta al alumno como con deuda o habiendo pagado', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({
        id: 'charge-anulado',
        studentId: 's1',
        originalAmount: 10000,
        voidedAt: '2026-07-02T00:00:00.000Z',
        voidReason: 'clase cancelada',
      }),
    ],
    payments: [payment({ id: 'payment-1', studentId: 's1', amount: 3000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-anulado', studentId: 's1', amount: 3000 })],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-25' });
  assertEqual(summary.monthlyCollected, 0, 'la asignación a un cargo anulado no cuenta como cobrado');
  assertEqual(summary.pendingOnTimeBalance, 0, 'sin pendiente');
  assertEqual(summary.overdueBalance, 0, 'sin vencido');
  assertEqual(summary.uniqueStudentsWithDebt, 0, 'sin alumnos con deuda');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 0, 'sin alumnos que pagaron');
});

// ---------------------------------------------------------------------------
// Alumnos únicos, no cantidad de pagos/obligaciones
// ---------------------------------------------------------------------------

test('alumnos únicos que pagaron: dos pagos del mismo alumno en el mes cuentan una sola vez', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-a', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 5000 }),
      charge({ id: 'charge-b', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 5000 }),
    ],
    payments: [
      payment({ id: 'payment-1', studentId: 's1', amount: 5000, paidAt: '2026-07-03' }),
      payment({ id: 'payment-2', studentId: 's1', amount: 5000, paidAt: '2026-07-10' }),
    ],
    allocations: [
      allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-a', studentId: 's1', amount: 5000 }),
      allocation({ id: 'alloc-2', paymentId: 'payment-2', chargeId: 'charge-b', studentId: 's1', amount: 5000 }),
    ],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-15' });
  assertEqual(summary.monthlyCollected, 10000, 'la suma sí cuenta ambos pagos');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 1, 'pero el alumno único es uno solo, no dos pagos');
});

test('alumnos únicos con deuda: varias obligaciones vencidas del mismo alumno cuentan una sola vez', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-a', studentId: 's1', dueDate: '2026-05-01', billingPeriod: '2026-05', originalAmount: 5000 }),
      charge({ id: 'charge-b', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 5000 }),
    ],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-15' });
  assertEqual(summary.uniqueStudentsWithDebt, 1, 'un único alumno, aunque tenga dos obligaciones vencidas');
  assertEqual(summary.overdueStudents.length, 1, 'un único recordatorio, no uno por obligación');
});

test('no mezcla las obligaciones y pagos de distintos alumnos', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-s1', studentId: 's1', dueDate: '2026-05-01', billingPeriod: '2026-05', originalAmount: 5000 }),
      charge({ id: 'charge-s2', studentId: 's2', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 8000 }),
    ],
    payments: [payment({ id: 'payment-s2', studentId: 's2', amount: 8000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'alloc-s2', paymentId: 'payment-s2', chargeId: 'charge-s2', studentId: 's2', amount: 8000 })],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-10' });
  assertEqual(summary.uniqueStudentsWithDebt, 1, 'sólo s1 tiene deuda');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 1, 'sólo s2 pagó');
  assertEqual(summary.overdueStudents[0].studentId, 's1', 's1 es quien debe');
});

// ---------------------------------------------------------------------------
// Diferenciar pendiente en término de deuda vencida
// ---------------------------------------------------------------------------

test('diferencia el saldo pendiente todavía en término del saldo realmente vencido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      // vence el 1/7, evaluado el 22/7 -> second_late (vencido)
      charge({ id: 'charge-vencida', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 }),
      // vence el 1/8, evaluado el 22/7 -> todavía no vence (en término)
      charge({ id: 'charge-en-termino', studentId: 's2', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 5000 }),
    ],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-22' });
  assertEqual(summary.overdueBalance, 10000, 'la vencida, sin recargo automático');
  assertEqual(summary.pendingOnTimeBalance, 5000, 'la que todavía no vence, sin recargo');
  assertEqual(summary.uniqueStudentsWithDebt, 2, 'ambos alumnos tienen saldo pendiente, sea cual sea la categoría');
  assertEqual(summary.overdueStudents.length, 1, 'sólo el que está realmente vencido genera recordatorio');
  assertEqual(summary.overdueStudents[0].studentId, 's1', 'el alumno vencido');
});

test('overdueStudents ordena por mayor deuda primero', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-s1', studentId: 's1', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 5000 }),
      charge({ id: 'charge-s2', studentId: 's2', dueDate: '2026-06-01', billingPeriod: '2026-06', originalAmount: 20000 }),
    ],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-15' });
  assertEqual(summary.overdueStudents.length, 2, 'ambos vencidos');
  assertEqual(summary.overdueStudents[0].studentId, 's2', 'el de mayor deuda primero');
  assert(summary.overdueStudents[0].overdueAmount > summary.overdueStudents[1].overdueAmount, 'orden descendente');
});

// ---------------------------------------------------------------------------
// Actualización después de pagar
// ---------------------------------------------------------------------------

test('actualización después de pagar: registrar un pago reduce lo vencido y suma a lo cobrado del mes', () => {
  const before: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-1', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 })],
  };
  const evaluationDate = '2026-07-22'; // second_late (mora real), pero sin recargos automáticos: requiere 10.000

  const summaryBefore = buildHomeFinancialSummary({ state: before, evaluationDate });
  assertEqual(summaryBefore.overdueBalance, 10000, 'antes de pagar: todo vencido, sin recargo');
  assertEqual(summaryBefore.monthlyCollected, 0, 'antes de pagar: nada cobrado');
  assertEqual(summaryBefore.uniqueStudentsWithDebt, 1, 'antes de pagar: un alumno con deuda');

  const newPayment = recordPayment({
    id: 'payment-1',
    studentId: 's1',
    amount: 10000,
    method: 'efectivo',
    paidAt: evaluationDate,
    recordedAt: `${evaluationDate}T12:00:00.000Z`,
    todayDateKey: evaluationDate,
  });
  const withPayment: PaymentsRepositoryState = { ...before, payments: [...before.payments, newPayment] };
  const newAllocation = allocatePayment({
    id: 'alloc-1',
    paymentId: newPayment.id,
    chargeId: 'charge-1',
    amount: 10000,
    state: withPayment,
  });
  const after: PaymentsRepositoryState = { ...withPayment, allocations: [...withPayment.allocations, newAllocation] };

  const summaryAfter = buildHomeFinancialSummary({ state: after, evaluationDate });
  assertEqual(summaryAfter.overdueBalance, 0, 'después de pagar: nada vencido');
  assertEqual(summaryAfter.monthlyCollected, 10000, 'después de pagar: se refleja lo cobrado');
  assertEqual(summaryAfter.uniqueStudentsWithDebt, 0, 'después de pagar: sin alumnos con deuda');
  assertEqual(summaryAfter.overdueStudents.length, 0, 'después de pagar: sin recordatorios para este alumno');
});

test('no muta el estado recibido', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge-1', studentId: 's1', originalAmount: 10000 })],
    payments: [payment({ id: 'payment-1', studentId: 's1', amount: 4000, paidAt: '2026-07-05' })],
    allocations: [allocation({ id: 'alloc-1', paymentId: 'payment-1', chargeId: 'charge-1', studentId: 's1', amount: 4000 })],
  };
  const snapshot = JSON.stringify(state);
  buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20' });
  assertEqual(JSON.stringify(state), snapshot, 'el estado original no cambia');
});

// ---------------------------------------------------------------------------
// Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
// separar "este mes" de "deuda de meses anteriores".
// ---------------------------------------------------------------------------

test('campos nuevos también arrancan en cero sin datos', () => {
  const summary = buildHomeFinancialSummary({ state: emptyState(), evaluationDate: '2026-07-15' });
  assertEqual(summary.currentMonthGenerated, 0, 'sin generado');
  assertEqual(summary.currentMonthPendingBalance, 0, 'sin pendiente del mes');
  assertEqual(summary.priorPeriodsDebtBalance, 0, 'sin deuda anterior');
});

test('8. Deuda de julio que continúa en agosto: aparece separada de lo pendiente de agosto', () => {
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'charge-julio', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 20000 }),
      charge({ id: 'charge-agosto', studentId: 's1', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 20000 }),
    ],
  };
  // Evaluado ya en agosto: julio quedó sin pagar (deuda anterior, última
  // etapa de mora, pero sin recargo automático), agosto recién empieza
  // (pendiente del mes, sin recargo tampoco).
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-08-03' });
  assertEqual(summary.priorPeriodsDebtBalance, 20000, 'la deuda de julio, sin recargo, se cuenta como deuda de meses anteriores');
  assertEqual(summary.currentMonthPendingBalance, 20000, 'lo de agosto se cuenta como pendiente del mes actual, sin mezclar julio');
  assertEqual(summary.currentMonthGenerated, 20000, '"generado este mes" sólo cuenta agosto, nunca julio');
});

test('un pago de agosto nunca reduce la deuda de julio (cada cargo es independiente)', () => {
  const julyCharge = charge({ id: 'charge-julio', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 20000 });
  const augustCharge = charge({ id: 'charge-agosto', studentId: 's1', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 20000 });
  const augustPayment = payment({ id: 'payment-agosto', studentId: 's1', amount: 20000, paidAt: '2026-08-01', recordedAt: '2026-08-01T09:00:00.000Z' });
  const augustAllocation = allocation({ id: 'alloc-agosto', paymentId: augustPayment.id, chargeId: augustCharge.id, studentId: 's1', amount: 20000 });
  const state: PaymentsRepositoryState = {
    charges: [julyCharge, augustCharge],
    payments: [augustPayment],
    allocations: [augustAllocation],
    adjustments: [],
  };
  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-08-05' });
  assertEqual(summary.priorPeriodsDebtBalance, 20000, 'julio sigue debiéndose por completo (sin recargo), sin verse afectado por el pago de agosto');
  assertEqual(summary.currentMonthPendingBalance, 0, 'agosto quedó saldado por su propio pago');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
// CIRCUITO DE COBROS): un cargo de un alumno que no está `'activo'` nunca
// aporta a ninguna alerta operativa del Home (vencido/pendiente/
// `overdueStudents`) — pero SÍ sigue contando en los hechos contables ya
// ocurridos (`monthlyCollected`, `currentMonthGenerated`), que nunca dependen
// del estado actual. Identidad ficticia: `qa-inactivo-*`.
// ---------------------------------------------------------------------------

test('alumno inactivo con mensualidad vencida: no aporta a overdueBalance ni a overdueStudents (nunca dispara alertas/badges)', () => {
  const c = charge({ id: 'c-inactivo', studentId: 'qa-inactivo-1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'inactivo'>([['qa-inactivo-1', 'inactivo']]);

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20', studentStatusById });
  assertEqual(summary.overdueBalance, 0, 'un alumno inactivo nunca aporta a la deuda vencida operativa del Home');
  assertEqual(summary.overdueStudents.length, 0, 'nunca aparece en la lista de recordatorios de deuda vencida');
  assertEqual(summary.uniqueStudentsWithDebt, 0, 'tampoco cuenta como "alumno con deuda" para el resumen');
  assertEqual(summary.priorPeriodsDebtBalance, 0, 'ni como deuda de meses anteriores');
});

test('mismo alumno, activo: SÍ aporta con normalidad (control de que el gate depende del estado, no del cargo)', () => {
  const c = charge({ id: 'c-activo', studentId: 'qa-inactivo-activo', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'activo'>([['qa-inactivo-activo', 'activo']]);

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20', studentStatusById });
  assertEqual(summary.overdueBalance > 0, true, 'un alumno activo con mensualidad vencida sí aporta a la deuda vencida del Home');
  assertEqual(summary.overdueStudents.length, 1, 'aparece en la lista de recordatorios');
});

test('alumno inactivo que pagó este mes ANTES de darse de baja: el pago real sigue contando en "cobrado este mes" (hecho contable, no una alerta)', () => {
  const c = charge({ id: 'c-pagado', studentId: 'qa-inactivo-2', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const p = payment({ id: 'pago-1', studentId: 'qa-inactivo-2', amount: 10000, paidAt: '2026-07-03', recordedAt: '2026-07-03T09:00:00.000Z' });
  const a = allocation({ id: 'alloc-1', paymentId: 'pago-1', chargeId: 'c-pagado', studentId: 'qa-inactivo-2', amount: 10000 });
  const state: PaymentsRepositoryState = { charges: [c], payments: [p], allocations: [a], adjustments: [] };
  const studentStatusById = new Map<string, 'inactivo'>([['qa-inactivo-2', 'inactivo']]);

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20', studentStatusById });
  assertEqual(summary.monthlyCollected, 10000, 'el dinero ya cobrado es un hecho real: sigue contando aunque el alumno ahora esté inactivo');
  assertEqual(summary.uniqueStudentsPaidThisMonth, 1, 'también sigue contando como "alumno que pagó este mes"');
  assertEqual(summary.overdueBalance, 0, 'el cargo está saldado: de todas formas no habría nada vencido');
});

test('cargo de un alumno inactivo generado este mes: "generado este mes" sigue siendo un hecho contable, no se filtra', () => {
  const c = charge({ id: 'c-generado', studentId: 'qa-inactivo-3', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };
  const studentStatusById = new Map<string, 'inactivo'>([['qa-inactivo-3', 'inactivo']]);

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-05', studentStatusById });
  assertEqual(summary.currentMonthGenerated, 10000, '"generado este mes" es un hecho contable, no una alerta de cobro: no se filtra por estado');
  assertEqual(summary.overdueBalance, 0, 'todavía no venció: de todas formas no aportaría a lo vencido');
});

test('alumnos pausado y archivado: mismo criterio que inactivo, nunca aportan a las alertas operativas', () => {
  const paused = charge({ id: 'c-pausado', studentId: 'qa-inactivo-pausado', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const archived = charge({ id: 'c-archivado', studentId: 'qa-inactivo-archivado', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [paused, archived] };
  const studentStatusById = new Map<string, 'pausado' | 'archivado'>([
    ['qa-inactivo-pausado', 'pausado'],
    ['qa-inactivo-archivado', 'archivado'],
  ]);

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20', studentStatusById });
  assertEqual(summary.overdueBalance, 0, 'pausado y archivado se tratan igual que inactivo: nunca aportan a lo vencido');
  assertEqual(summary.overdueStudents.length, 0, 'ninguno de los dos aparece en recordatorios');
});

test('sin studentStatusById (llamador que todavía no lo provee): comportamiento previo sin cambios', () => {
  const c = charge({ id: 'c-sin-mapa', studentId: 'qa-inactivo-sin-mapa', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 });
  const state: PaymentsRepositoryState = { ...emptyState(), charges: [c] };

  const summary = buildHomeFinancialSummary({ state, evaluationDate: '2026-07-20' });
  assertEqual(summary.overdueBalance > 0, true, 'sin mapa de estados, cualquier alumno se trata como activo (compatibilidad hacia atrás)');
});
