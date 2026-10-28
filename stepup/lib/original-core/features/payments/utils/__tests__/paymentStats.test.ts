// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/paymentStats.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, PaymentCharge } from '../../types/index.ts';
import { buildLastNMonthsUniqueStudentStats, buildMonthlyPaymentStats, buildMonthlyUniqueStudentPaymentStats } from '../paymentStats.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function charge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
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

function state(chargeId: string, overrides: Partial<ChargeComputedState> = {}): ChargeComputedState {
  return {
    chargeId,
    studentId: 's1',
    originalAmount: 10000,
    surchargeAmount: 0,
    totalDue: 10000,
    paidAmount: 0,
    balance: 10000,
    stage: 'on_time',
    settledAt: null,
    isSurchargeWaived: false,
    isNotYetDue: false,
    ...overrides,
  };
}

test('agrega correctamente por el mes de vencimiento de cada cargo', () => {
  const charges = [
    charge({ id: 'c1', dueDate: '2026-07-01', billingPeriod: '2026-07', originalAmount: 10000 }),
    charge({ id: 'c2', dueDate: '2026-07-11', billingPeriod: '2026-07', originalAmount: 9500, type: 'por_clase' }),
    charge({ id: 'c3', dueDate: '2026-08-01', billingPeriod: '2026-08', originalAmount: 12000 }),
  ];
  const states = [
    state('c1', { totalDue: 10000, paidAmount: 10000, balance: 0, settledAt: '2026-07-05' }),
    state('c2', { totalDue: 10450, paidAmount: 5000, balance: 5450 }),
    state('c3', { totalDue: 12000, paidAmount: 0, balance: 12000 }),
  ];

  const stats = buildMonthlyPaymentStats(charges, states);

  assertEqual(stats.length, 2, 'dos meses distintos');
  const july = stats.find((s) => s.period === '2026-07')!;
  assertEqual(july.totalCharged, 19500, 'suma de importes originales de julio');
  assertEqual(july.totalCollected, 15000, 'suma de lo cobrado en julio');
  assertEqual(july.totalOutstanding, 5450, 'saldo pendiente de julio');
  assertEqual(july.chargeCount, 2, 'dos cargos en julio');
  assertEqual(july.paidChargeCount, 1, 'un solo cargo saldado en julio');

  const august = stats.find((s) => s.period === '2026-08')!;
  assertEqual(august.totalCharged, 12000, 'agosto sólo tiene un cargo');
  assertEqual(august.paidChargeCount, 0, 'ninguno saldado todavía');
});

test('ignora cargos anulados', () => {
  const charges = [
    charge({ id: 'c1', originalAmount: 10000 }),
    charge({ id: 'c2', originalAmount: 5000, voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'duplicado' }),
  ];
  const states = [state('c1', { totalDue: 10000, paidAmount: 0, balance: 10000 })];
  const stats = buildMonthlyPaymentStats(charges, states);
  assertEqual(stats[0].chargeCount, 1, 'el cargo anulado no se cuenta');
  assertEqual(stats[0].totalCharged, 10000, 'tampoco suma su importe');
});

test('no muta charges ni states recibidos', () => {
  const charges = [charge()];
  const states = [state('charge-1')];
  const chargesSnapshot = JSON.stringify(charges);
  const statesSnapshot = JSON.stringify(states);
  buildMonthlyPaymentStats(charges, states);
  assertEqual(JSON.stringify(charges), chargesSnapshot, 'charges no cambia');
  assertEqual(JSON.stringify(states), statesSnapshot, 'states no cambia');
});

// ---------------------------------------------------------------------------
// buildMonthlyUniqueStudentPaymentStats — estadísticas por ALUMNO ÚNICO
// (para el gráfico general), no por obligación.
// ---------------------------------------------------------------------------

test('estadísticas de alumnos únicos: la suma de categorías coincide con el total evaluado, sin contar obligaciones no vencidas', () => {
  const charges = [
    charge({ id: 'c-s1', studentId: 's1', dueDate: '2026-07-01' }), // se salda en término
    charge({ id: 'c-s2', studentId: 's2', dueDate: '2026-07-01' }), // se salda en primer vencimiento
    charge({ id: 'c-s3', studentId: 's3', dueDate: '2026-07-01' }), // deuda: vencida, sin saldar
    charge({ id: 'c-s4', studentId: 's4', dueDate: '2026-07-01' }), // todavía no vence
  ];
  const states = [
    state('c-s1', { studentId: 's1', settledAt: '2026-07-05', isNotYetDue: false }),
    state('c-s2', { studentId: 's2', settledAt: '2026-07-15', isNotYetDue: false }),
    state('c-s3', { studentId: 's3', settledAt: null, isNotYetDue: false }),
    state('c-s4', { studentId: 's4', settledAt: null, isNotYetDue: true }),
  ];

  const stats = buildMonthlyUniqueStudentPaymentStats(charges, states);
  assertEqual(stats.length, 1, 'un solo mes');
  const july = stats[0];

  assertEqual(july.studentsOnTime, 1, 's1 en término');
  assertEqual(july.studentsFirstLate, 1, 's2 en primer vencimiento');
  assertEqual(july.studentsSecondLate, 0, 'nadie en segundo vencimiento');
  assertEqual(july.studentsLastLate, 0, 'nadie en último vencimiento');
  assertEqual(july.studentsInDebt, 1, 's3 mantiene deuda');
  assertEqual(july.totalUniqueStudentsEvaluated, 3, 's4 no participa: su obligación todavía no vence');
  assertEqual(
    july.studentsOnTime + july.studentsFirstLate + july.studentsSecondLate + july.studentsLastLate + july.studentsInDebt,
    july.totalUniqueStudentsEvaluated,
    'la suma de las cinco categorías es exactamente el total de alumnos únicos evaluados'
  );
});

test('un alumno con varias clases (por_clase) en el mismo mes se cuenta una sola vez, usando su peor situación', () => {
  const charges = [
    charge({ id: 'c-clase-1', studentId: 's1', type: 'por_clase', dueDate: '2026-07-03' }), // saldada en término
    charge({ id: 'c-clase-2', studentId: 's1', type: 'por_clase', dueDate: '2026-07-20' }), // vencida, sin saldar: deuda
  ];
  const states = [
    state('c-clase-1', { studentId: 's1', settledAt: '2026-07-03', isNotYetDue: false }),
    state('c-clase-2', { studentId: 's1', settledAt: null, isNotYetDue: false }),
  ];

  const stats = buildMonthlyUniqueStudentPaymentStats(charges, states);
  assertEqual(stats.length, 1, 'un solo mes');
  const july = stats[0];
  assertEqual(july.totalUniqueStudentsEvaluated, 1, 's1 se cuenta una sola vez aunque tenga dos obligaciones');
  assertEqual(july.studentsInDebt, 1, 'la peor situación (deuda) es la que prevalece');
  assertEqual(july.studentsOnTime, 0, 'no se cuenta también como "en término" por la otra clase saldada');
});

test('la deuda tiene prioridad sobre las demás categorías, sin importar el orden de los cargos', () => {
  const baseCharges = [
    charge({ id: 'c-a', studentId: 's1', dueDate: '2026-07-01' }), // en término
    charge({ id: 'c-b', studentId: 's1', dueDate: '2026-07-01' }), // primer vencimiento
    charge({ id: 'c-c', studentId: 's1', dueDate: '2026-07-01' }), // deuda
  ];
  const baseStates = [
    state('c-a', { studentId: 's1', settledAt: '2026-07-05', isNotYetDue: false }),
    state('c-b', { studentId: 's1', settledAt: '2026-07-15', isNotYetDue: false }),
    state('c-c', { studentId: 's1', settledAt: null, isNotYetDue: false }),
  ];

  const inOriginalOrder = buildMonthlyUniqueStudentPaymentStats(baseCharges, baseStates);
  assertEqual(inOriginalOrder[0].studentsInDebt, 1, 'la deuda prevalece sobre en-término y primer-vencimiento');

  const reversedCharges = [...baseCharges].reverse();
  const reversedStates = [...baseStates].reverse();
  const inReversedOrder = buildMonthlyUniqueStudentPaymentStats(reversedCharges, reversedStates);
  assertEqual(inReversedOrder[0].studentsInDebt, 1, 'el resultado no depende del orden de los cargos');
  assert(
    inOriginalOrder[0].totalUniqueStudentsEvaluated === inReversedOrder[0].totalUniqueStudentsEvaluated,
    'el total de alumnos evaluados tampoco depende del orden'
  );
});

test('buildMonthlyUniqueStudentPaymentStats ignora cargos anulados y no muta charges ni states', () => {
  const charges = [
    charge({ id: 'c1', studentId: 's1' }),
    charge({ id: 'c2', studentId: 's2', voidedAt: '2026-07-02T00:00:00.000Z', voidReason: 'duplicado' }),
  ];
  const states = [
    state('c1', { studentId: 's1', settledAt: '2026-07-05', isNotYetDue: false }),
    state('c2', { studentId: 's2', settledAt: null, isNotYetDue: false }),
  ];
  const chargesSnapshot = JSON.stringify(charges);
  const statesSnapshot = JSON.stringify(states);

  const stats = buildMonthlyUniqueStudentPaymentStats(charges, states);
  assertEqual(stats[0].totalUniqueStudentsEvaluated, 1, 'el alumno del cargo anulado no participa');
  assertEqual(JSON.stringify(charges), chargesSnapshot, 'charges no cambia');
  assertEqual(JSON.stringify(states), statesSnapshot, 'states no cambia');
});

// ---------------------------------------------------------------------------
// buildLastNMonthsUniqueStudentStats — Fase Pagos 4C.1: siempre 12 meses
// consecutivos para el gráfico "Resumen general", con ceros en los huecos.
// ---------------------------------------------------------------------------

test('buildLastNMonthsUniqueStudentStats devuelve siempre 12 meses, incluso sin ninguna obligación', () => {
  const stats = buildLastNMonthsUniqueStudentStats([], [], '2026-07-15');
  assertEqual(stats.length, 12, 'doce meses siempre');
  assertEqual(stats[stats.length - 1].period, '2026-07', 'el último es julio');
  stats.forEach((month) => {
    assertEqual(month.totalUniqueStudentsEvaluated, 0, `${month.period} en cero`);
  });
});

test('buildLastNMonthsUniqueStudentStats rellena en cero los meses sin datos y conserva los que sí tienen', () => {
  const charges = [
    charge({ id: 'c-julio', studentId: 's1', dueDate: '2026-07-01', billingPeriod: '2026-07' }),
  ];
  const states = [state('c-julio', { studentId: 's1', settledAt: '2026-07-05', isNotYetDue: false })];

  const stats = buildLastNMonthsUniqueStudentStats(charges, states, '2026-07-20', 12);
  assertEqual(stats.length, 12, 'doce meses');
  const july = stats.find((month) => month.period === '2026-07')!;
  assertEqual(july.studentsOnTime, 1, 'julio tiene el dato real');
  const june = stats.find((month) => month.period === '2026-06')!;
  assertEqual(june.totalUniqueStudentsEvaluated, 0, 'junio, sin obligaciones, queda en cero');
});

test('buildLastNMonthsUniqueStudentStats respeta monthsToShow', () => {
  const stats = buildLastNMonthsUniqueStudentStats([], [], '2026-07-15', 3);
  assertEqual(stats.length, 3, 'tres meses');
  assertEqual(stats.map((m) => m.period).join(','), '2026-05,2026-06,2026-07', 'los tres últimos, en orden');
});
