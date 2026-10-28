// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/studentListPaymentProjection.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentListItem } from '../../../students/types/index.ts';
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan } from '../../../student-profile/types/index.ts';
import { projectStudentListPaymentStatus } from '../studentListPaymentProjection.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

function emptyState(): PaymentsRepositoryState {
  return { charges: [], payments: [], allocations: [], adjustments: [] };
}

function student(overrides: Partial<StudentListItem> & { id: string }): StudentListItem {
  return {
    name: `Alumno ${overrides.id}`,
    levels: ['B1'],
    modality: 'presencial',
    status: 'activo',
    nextClassAt: null,
    paymentStatus: 'verde',
    averageGrade: 8,
    classesThisMonth: 1,
    lastPaymentAt: null,
    isFeatured: false,
    isNew: false,
    hasOverduePayment: false,
    hasPendingReport: false,
    hasPendingHomework: false,
    ...overrides,
  };
}

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

test('sin obligaciones: paymentStatus verde', () => {
  const students = [student({ id: 's1', paymentStatus: 'rojo' })]; // el heredado dice rojo, pero no hay deuda real
  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-07-20');
  assertEqual(projected[0].paymentStatus, 'verde', 'sin obligaciones no hay deuda: verde, ignorando el campo heredado');
  assertEqual(projected[0].hasOverduePayment, false, 'sin vencido');
});

test('deuda en cualquier etapa de mora proyecta rojo: sin recargos automáticos, el semáforo colapsa amarillo/naranja/rojo en un único rojo', () => {
  const students = [student({ id: 's1' })];

  const firstLate = projectStudentListPaymentStatus(
    students,
    { ...emptyState(), charges: [charge({ dueDate: '2026-07-01' })] },
    '2026-07-15' // first_late (mora real)
  );
  assertEqual(firstLate[0].paymentStatus, 'rojo', 'primer vencimiento colapsa a rojo, nunca amarillo, sin recargos automáticos');

  const secondLate = projectStudentListPaymentStatus(
    students,
    { ...emptyState(), charges: [charge({ dueDate: '2026-07-01' })] },
    '2026-07-22' // second_late (mora real)
  );
  assertEqual(secondLate[0].paymentStatus, 'rojo', 'segundo vencimiento colapsa a rojo, nunca naranja, sin recargos automáticos');

  const lastLate = projectStudentListPaymentStatus(
    students,
    { ...emptyState(), charges: [charge({ dueDate: '2026-07-01' })] },
    '2026-07-30' // last_late
  );
  assertEqual(lastLate[0].paymentStatus, 'rojo', 'último vencimiento');
  assertEqual(lastLate[0].hasOverduePayment, true, 'con deuda vencida, hasOverduePayment true');
});

test('varias obligaciones: prevalece la peor situación', () => {
  const students = [student({ id: 's1' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c1', dueDate: '2026-07-01', billingPeriod: '2026-07' }), // en término
      charge({ id: 'c2', dueDate: '2026-06-01', billingPeriod: '2026-06' }), // mucho más vencida
    ],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-01');
  assertEqual(projected[0].paymentStatus, 'rojo', 'la obligación de junio, mucho más vencida, domina el semáforo');
});

test('registrar un pago actualiza la proyección de verde/rojo', () => {
  const students = [student({ id: 's1' })];
  const stateWithDebt: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ dueDate: '2026-07-01' })],
  };
  const before = projectStudentListPaymentStatus(students, stateWithDebt, '2026-07-30');
  assertEqual(before[0].paymentStatus, 'rojo', 'antes de pagar: en mora');

  const stateAfterPayment: PaymentsRepositoryState = {
    ...stateWithDebt,
    payments: [payment({ paidAt: '2026-07-05' })],
    allocations: [allocation()],
  };
  const after = projectStudentListPaymentStatus(students, stateAfterPayment, '2026-07-30');
  assertEqual(after[0].paymentStatus, 'verde', 'después de pagar, sin deuda: verde');
});

test('anular un pago revierte la proyección de vuelta a deuda', () => {
  const students = [student({ id: 's1' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ dueDate: '2026-07-01' })],
    payments: [payment({ paidAt: '2026-07-05', voidedAt: '2026-07-06T00:00:00.000Z', voidReason: 'error' })],
    allocations: [allocation()],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30');
  assertEqual(projected[0].paymentStatus, 'rojo', 'el pago anulado no cuenta: la deuda sigue vigente');
});

test('lastPaymentAt refleja el pago vigente más reciente e ignora los anulados', () => {
  const students = [student({ id: 's1' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ originalAmount: 30000 })],
    payments: [
      payment({ id: 'p1', amount: 5000, paidAt: '2026-07-02' }),
      payment({ id: 'p2', amount: 5000, paidAt: '2026-07-10' }),
      payment({ id: 'p3', amount: 5000, paidAt: '2026-07-20', voidedAt: '2026-07-21T00:00:00.000Z', voidReason: 'error' }), // el más reciente, pero anulado
    ],
    allocations: [
      allocation({ id: 'a1', paymentId: 'p1', amount: 5000 }),
      allocation({ id: 'a2', paymentId: 'p2', amount: 5000 }),
      allocation({ id: 'a3', paymentId: 'p3', amount: 5000 }),
    ],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-25');
  assertEqual(projected[0].lastPaymentAt, '2026-07-10', 'ignora el pago anulado del 20/07: usa el vigente más reciente (10/07)');
});

test('sin pagos vigentes, lastPaymentAt queda en null', () => {
  const students = [student({ id: 's1', lastPaymentAt: '2020-01-01' })]; // valor heredado viejo
  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-07-20');
  assertEqual(projected[0].lastPaymentAt, null, 'sin pagos vigentes, se proyecta null, no el valor heredado');
});

test('no muta los StudentListItem recibidos ni el estado financiero', () => {
  const students = [student({ id: 's1' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge()],
    payments: [payment()],
    allocations: [allocation()],
  };
  const studentsSnapshot = JSON.stringify(students);
  const stateSnapshot = JSON.stringify(state);

  const projected = projectStudentListPaymentStatus(students, state, '2026-07-10');

  assertEqual(JSON.stringify(students), studentsSnapshot, 'students no cambia');
  assertEqual(JSON.stringify(state), stateSnapshot, 'el estado financiero no cambia');
  assert(projected !== students, 'devuelve un array nuevo, no el mismo por referencia');
  assert(projected[0] !== students[0], 'cada item proyectado es un objeto nuevo, no el mismo por referencia');
});

test('no mezcla obligaciones ni pagos de otros alumnos', () => {
  const students = [student({ id: 's1' }), student({ id: 's2' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 's1', dueDate: '2026-07-01' })],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30');
  const s1 = projected.find((s) => s.id === 's1')!;
  const s2 = projected.find((s) => s.id === 's2')!;
  assertEqual(s1.paymentStatus, 'rojo', 's1 tiene la deuda');
  assertEqual(s2.paymentStatus, 'verde', 's2 no tiene ninguna obligación: no se contamina con la deuda de s1');
});

// Corrección 2026-08-03 (a pedido de Joaquín — generación mensual y
// tarjetas de Alumnos): el 4° argumento `resolvePlan` es opcional con
// default `() => null` — los 9 tests de arriba, todos con 3 argumentos,
// siguen pasando sin cambios (backward-compatible). Estos tests nuevos
// cubren el comportamiento del 4° argumento en sí.

test('sin resolvePlan (3 argumentos, firma anterior): monthlyStatusLabel queda null', () => {
  const students = [student({ id: 's1' })];
  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-08-01');
  assertEqual(projected[0].monthlyStatusLabel, null, 'sin resolvePlan no hay estado mensual que calcular');
  assertEqual(projected[0].monthlyStatusColorKey, undefined, 'sin resolvePlan no se asigna color');
  assertEqual(projected[0].monthlyStatusBalance, 0, 'sin resolvePlan el saldo por defecto es 0');
});

test('resolvePlan que devuelve null para el alumno: mismo resultado que no pasar resolvePlan', () => {
  const students = [student({ id: 's1' })];
  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-08-01', () => null);
  assertEqual(projected[0].monthlyStatusLabel, null, 'plan null: no hay estado mensual');
});

const monthlyPlan: StudentBillingPlan = { type: 'monthly', amount: 20000, dueDay: 1 };

test('resolvePlan mensual sin cargo generado, día 1: monthlyStatusLabel "Agosto pendiente"', () => {
  const students = [student({ id: 's1' })];
  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-08-01', () => monthlyPlan);
  assertEqual(projected[0].monthlyStatusLabel, 'Agosto pendiente', 'día 1 en término, nunca "Al día"');
  assertEqual(projected[0].monthlyStatusColorKey, 'statusPendiente', 'color de pendiente en término');
  assertEqual(projected[0].monthlyStatusBalance, 0, 'sin recargo todavía');
});

test('resolvePlan mensual con mes pagado: monthlyStatusLabel "Agosto pagado", verde', () => {
  const students = [student({ id: 's1' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'charge_mensual_s1_2026-08', type: 'mensual', originalAmount: 20000, dueDate: '2026-08-01', billingPeriod: '2026-08' })],
    payments: [payment({ id: 'p1', amount: 20000, paidAt: '2026-08-03' })],
    allocations: [allocation({ id: 'a1', paymentId: 'p1', chargeId: 'charge_mensual_s1_2026-08', amount: 20000 })],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-08-03', () => monthlyPlan);
  assertEqual(projected[0].monthlyStatusLabel, 'Agosto pagado', 'saldo cero: pagado');
  assertEqual(projected[0].monthlyStatusColorKey, 'statusVerde', 'verde sólo con saldo cero real');
  assertEqual(projected[0].monthlyStatusBalance, 0, 'sin saldo pendiente');
});

test('resolvePlan distinto por alumno: cada uno recibe su propio estado mensual, sin mezclarse', () => {
  const students = [student({ id: 's1' }), student({ id: 's2' })];
  const perClassPlan: StudentBillingPlan = { type: 'per_class', amount: 5000 };
  const resolvePlan = (studentId: string): StudentBillingPlan | null =>
    studentId === 's1' ? monthlyPlan : perClassPlan;

  const projected = projectStudentListPaymentStatus(students, emptyState(), '2026-08-01', resolvePlan);
  const s1 = projected.find((s) => s.id === 's1')!;
  const s2 = projected.find((s) => s.id === 's2')!;
  assertEqual(s1.monthlyStatusLabel, 'Agosto pendiente', 's1 es mensual, en término');
  assertEqual(s2.monthlyStatusLabel, 'Por clase', 's2 no es mensual: muestra la descripción real de su plan');
});

// ---------------------------------------------------------------------------
// Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
// CIRCUITO DE COBROS): `hasOverduePayment`/`overdueDebtLabel` (el badge "Pago
// vencido" de `StudentBadges.tsx`) se calculaban SIN mirar el estado del
// alumno, así uno inactivo con una deuda vencida legítima seguía mostrando
// el badge de deuda vencida al lado del badge "Inactivo". Identidad
// ficticia: `qa-inactivo-*`.
// ---------------------------------------------------------------------------

test('alumno inactivo con deuda vencida: hasOverduePayment queda en false y overdueDebtLabel en null (nunca dispara el badge)', () => {
  const students = [student({ id: 'qa-inactivo-1', status: 'inactivo' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 'qa-inactivo-1', dueDate: '2026-07-01' })],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30'); // last_late
  assertEqual(projected[0].hasOverduePayment, false, 'un alumno inactivo nunca proyecta el badge de deuda vencida');
  assertEqual(projected[0].overdueDebtLabel, null, 'tampoco el texto específico ("Julio vencido")');
});

test('mismo alumno, activo: SÍ proyecta hasOverduePayment/overdueDebtLabel con normalidad (control)', () => {
  const students = [student({ id: 'qa-inactivo-activo', status: 'activo' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 'qa-inactivo-activo', dueDate: '2026-07-01' })],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30');
  assertEqual(projected[0].hasOverduePayment, true, 'activo con deuda vencida: badge normal');
  assertEqual(projected[0].overdueDebtLabel, 'Julio vencido', 'texto específico del período real');
});

test('alumno pausado y alumno archivado con deuda vencida: mismo criterio que inactivo, nunca proyectan el badge', () => {
  const students = [
    student({ id: 'qa-inactivo-pausado', status: 'pausado' }),
    student({ id: 'qa-inactivo-archivado', status: 'archivado' }),
  ];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [
      charge({ id: 'c-pausado', studentId: 'qa-inactivo-pausado', dueDate: '2026-07-01' }),
      charge({ id: 'c-archivado', studentId: 'qa-inactivo-archivado', dueDate: '2026-07-01' }),
    ],
  };
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30');
  projected.forEach((item) => {
    assertEqual(item.hasOverduePayment, false, `${item.id}: pausado/archivado nunca proyectan el badge de deuda vencida`);
    assertEqual(item.overdueDebtLabel, null, `${item.id}: tampoco el texto específico`);
  });
});

test('alumno inactivo con deuda legítima anterior a la baja: el cargo real no se toca, sólo deja de proyectarse como badge', () => {
  const students = [student({ id: 'qa-inactivo-historico', status: 'inactivo' })];
  const state: PaymentsRepositoryState = {
    ...emptyState(),
    charges: [charge({ id: 'c1', studentId: 'qa-inactivo-historico', dueDate: '2026-06-01', billingPeriod: '2026-06' })],
  };
  const stateSnapshot = JSON.stringify(state);
  const projected = projectStudentListPaymentStatus(students, state, '2026-07-30');
  assertEqual(projected[0].hasOverduePayment, false, 'inactivo: nunca aparece como badge operativo');
  assertEqual(JSON.stringify(state), stateSnapshot, 'el cargo real (la deuda legítima) nunca se modifica ni se anula acá');
});
