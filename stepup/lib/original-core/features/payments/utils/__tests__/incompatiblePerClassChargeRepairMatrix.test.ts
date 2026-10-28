// Puerto VERBATIM del original (`src/features/payments/utils/__tests__/incompatiblePerClassChargeRepairMatrix.test.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-08-10 (a pedido de Joaquín — ERROR FINANCIERO: estados
 * contradictorios "Agosto pendiente" + "Pago vencido"): matriz general
 * obligatoria — 150 alumnos ficticios (10 arquetipos fijos + 140
 * pseudoaleatorios, semilla fija) combinando mensual/por clase, cambios de
 * plan, varios meses, pagos parciales/completos, cargos con y sin
 * asignaciones, y altas antes/durante/después del margen de vencimiento.
 * Corre la reparación general (`planIncompatiblePerClassChargeRepair`)
 * sobre el conjunto completo y verifica, por cada alumno, las invariantes
 * pedidas — nunca depende de ningún alumno/importe/fecha concreto.
 *
 * Identidad ficticia aislada: `qa-fin-matrix-*`, sólo en memoria durante
 * esta corrida — nunca las cuentas reales de Joaquín ni Lara Gómez Sand.
 */
import type { Payment, PaymentAllocation, PaymentCharge, PaymentsRepositoryState } from '../../types/index.ts';
import type { StudentBillingPlan, StudentStatus } from '../../../student-profile/types/index.ts';
import { analyzeFinancialConsistency, planIncompatiblePerClassChargeRepair } from '../financialReconciliation.ts';
import { billingPeriodOfDateKey } from '../paymentDates.ts';
import { summarizeOverdueDebt } from '../monthlyPeriodStatus.ts';
import { buildStudentPaymentsSummary } from '../studentPaymentsSummary.ts';
import { assert, assertEqual, test } from '../../../calendar/utils/__tests__/testHarness.ts';

// ---------------------------------------------------------------------------
// PRNG determinista local (mulberry32) — misma familia que
// `monthlyAmountMatrix.test.ts` (payments), reimplementada acá localmente
// por el mismo motivo: no cruzar el límite de compilación entre proyectos
// de prueba.
// ---------------------------------------------------------------------------
type Rng = () => number;
function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function mulberry32(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randInt(rng: Rng, minInclusive: number, maxInclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}
function pick<T>(rng: Rng, options: readonly T[]): T {
  return options[randInt(rng, 0, options.length - 1)];
}

const MATRIX_SEED = 810100;
const EVALUATION_DATE = '2026-08-10';
const CURRENT_PERIOD = billingPeriodOfDateKey(EVALUATION_DATE);

interface SyntheticStudent {
  id: string;
  status: StudentStatus;
  plan: StudentBillingPlan;
  charges: PaymentCharge[];
  payments: Payment[];
  allocations: PaymentAllocation[];
}

function buildMonthlyCharge(studentId: string, billingPeriod: string, amount: number): PaymentCharge {
  return {
    id: `charge_mensual_${studentId}_${billingPeriod}`,
    studentId,
    type: 'mensual',
    originalAmount: amount,
    currency: 'ARS',
    dueDate: `${billingPeriod}-01`,
    createdAt: `${billingPeriod}-01T09:00:00.000Z`,
    billingPeriod,
    voidedAt: null,
    voidReason: null,
  };
}

function buildPerClassCharge(studentId: string, lessonId: string, dueDate: string, amount: number): PaymentCharge {
  return {
    id: `charge_por_clase_${studentId}_${lessonId}`,
    studentId,
    type: 'por_clase',
    originalAmount: amount,
    currency: 'ARS',
    dueDate,
    createdAt: `${dueDate}T09:00:00.000Z`,
    savedLessonId: lessonId,
    voidedAt: null,
    voidReason: null,
  };
}

function addMonthsToPeriod(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

function buildFullPayment(studentId: string, chargeId: string, amount: number, index: number): { payment: Payment; allocation: PaymentAllocation } {
  const paymentId = `payment_${chargeId}_${index}`;
  return {
    payment: {
      id: paymentId,
      studentId,
      amount,
      currency: 'ARS',
      method: 'efectivo',
      paidAt: '2026-08-01',
      recordedAt: '2026-08-01T09:00:00.000Z',
      voidedAt: null,
      voidReason: null,
    },
    allocation: { id: `alloc_${chargeId}_${index}`, paymentId, chargeId, studentId, amount },
  };
}

/**
 * Genera un alumno ficticio con una combinación determinista/aleatoria de
 * plan vigente, meses con cargos por clase (relativos al período actual:
 * negativo = pasado, 0 = actual, positivo = futuro) y estado de pago de
 * cada uno. `archetype`, cuando se pasa, fuerza una combinación puntual
 * (los 10 casos fijos obligatorios); si no, todo sale del PRNG.
 */
function buildStudent(
  index: number,
  rng: Rng,
  archetype?: {
    plan: StudentBillingPlan;
    perClassMonthOffsets: Array<{ offset: number; paid: 'none' | 'partial' | 'full' }>;
    withMonthlyCharge: boolean;
    status?: StudentStatus;
  }
): SyntheticStudent {
  const id = `qa-fin-matrix-s${index}`;
  const plan: StudentBillingPlan = archetype
    ? archetype.plan
    : pick(rng, [
        { type: 'monthly', amount: randInt(rng, 10000, 300000), dueDay: 1 } as StudentBillingPlan,
        { type: 'per_class', amount: randInt(rng, 3000, 20000) } as StudentBillingPlan,
      ]);
  const status: StudentStatus = archetype?.status ?? (rng() < 0.1 ? 'inactivo' : 'activo');

  const perClassMonthOffsets =
    archetype?.perClassMonthOffsets ??
    Array.from({ length: randInt(rng, 0, 3) }, () => ({
      offset: randInt(rng, -3, 2),
      paid: pick(rng, ['none', 'partial', 'full'] as const),
    }));

  const charges: PaymentCharge[] = [];
  const payments: Payment[] = [];
  const allocations: PaymentAllocation[] = [];

  perClassMonthOffsets.forEach((entry, lessonIndex) => {
    const period = addMonthsToPeriod(CURRENT_PERIOD, entry.offset);
    const dueDate = `${period}-${String(randInt(rng, 1, 27)).padStart(2, '0')}`;
    const amount = randInt(rng, 3000, 25000);
    const lessonId = `lesson${lessonIndex}`;
    const charge = buildPerClassCharge(id, lessonId, dueDate, amount);
    charges.push(charge);

    if (entry.paid === 'full') {
      const { payment, allocation } = buildFullPayment(id, charge.id, amount, lessonIndex);
      payments.push(payment);
      allocations.push(allocation);
    } else if (entry.paid === 'partial') {
      const partialAmount = Math.max(1, Math.floor(amount / 2));
      const { payment, allocation } = buildFullPayment(id, charge.id, partialAmount, lessonIndex);
      payments.push(payment);
      allocations.push(allocation);
    }
  });

  const withMonthlyCharge = archetype?.withMonthlyCharge ?? rng() < 0.6;
  if (withMonthlyCharge && plan.type === 'monthly') {
    charges.push(buildMonthlyCharge(id, CURRENT_PERIOD, plan.amount));
  }

  return { id, status, plan, charges, payments, allocations };
}

// ---------------------------------------------------------------------------
// 10 arquetipos fijos obligatorios (cada combinación pedida explícitamente,
// nunca dejada sólo al azar).
// ---------------------------------------------------------------------------
const FIXED_ARCHETYPES: Array<Parameters<typeof buildStudent>[2]> = [
  // 1. Mensual sin ninguna deuda.
  { plan: { type: 'monthly', amount: 50000, dueDay: 1 }, perClassMonthOffsets: [], withMonthlyCharge: true },
  // 2. Mensual con deuda histórica legítima (mes pasado, por clase, sin pagos).
  { plan: { type: 'monthly', amount: 50000, dueDay: 1 }, perClassMonthOffsets: [{ offset: -2, paid: 'none' }], withMonthlyCharge: true },
  // 3. Por clase legítimo, vigente, sin deuda.
  { plan: { type: 'per_class', amount: 9000 }, perClassMonthOffsets: [], withMonthlyCharge: false },
  // 4. Cambio de plan: por_clase -> mensual, residual del período ACTUAL sin pagos (EL CASO REPORTADO).
  { plan: { type: 'monthly', amount: 185000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 0, paid: 'none' }], withMonthlyCharge: true },
  // 5. Cargo residual del período actual CON pago total: nunca se anula.
  { plan: { type: 'monthly', amount: 60000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 0, paid: 'full' }], withMonthlyCharge: true },
  // 6. Cargo residual del período actual CON pago parcial: nunca se anula.
  { plan: { type: 'monthly', amount: 60000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 0, paid: 'partial' }], withMonthlyCharge: true },
  // 7. Cargo residual de un período FUTURO (mensual ya vigente hoy): también se anula.
  { plan: { type: 'monthly', amount: 45000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 1, paid: 'none' }], withMonthlyCharge: true },
  // 8. Mezcla: una deuda histórica legítima (mes pasado) + un residual actual sin pagos.
  {
    plan: { type: 'monthly', amount: 70000, dueDay: 1 },
    perClassMonthOffsets: [
      { offset: -3, paid: 'none' },
      { offset: 0, paid: 'none' },
    ],
    withMonthlyCharge: true,
  },
  // 9. Alumno inactivo con un residual del período actual: nunca se toca automáticamente.
  { plan: { type: 'monthly', amount: 55000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 0, paid: 'none' }], withMonthlyCharge: true, status: 'inactivo' },
  // 10. Alumno pausado con un residual del período actual: nunca se toca automáticamente.
  { plan: { type: 'monthly', amount: 55000, dueDay: 1 }, perClassMonthOffsets: [{ offset: 0, paid: 'none' }], withMonthlyCharge: true, status: 'pausado' },
];

function buildAllStudents(): SyntheticStudent[] {
  const rng = createRng(MATRIX_SEED);
  const fixed = FIXED_ARCHETYPES.map((archetype, index) => buildStudent(index, rng, archetype));
  const random = Array.from({ length: 140 }, (_, i) => buildStudent(FIXED_ARCHETYPES.length + i, rng));
  return [...fixed, ...random];
}

function buildState(syntheticStudents: SyntheticStudent[]): PaymentsRepositoryState {
  return {
    charges: syntheticStudents.flatMap((s) => s.charges),
    payments: syntheticStudents.flatMap((s) => s.payments),
    allocations: syntheticStudents.flatMap((s) => s.allocations),
    adjustments: [],
  };
}

test('matriz general (150 alumnos ficticios, semilla fija): invariantes de la reparación de cargos por clase incompatibles', () => {
  const syntheticStudents = buildAllStudents();
  assert(syntheticStudents.length === 150, 'exactamente 150 alumnos ficticios en la matriz');

  const state = buildState(syntheticStudents);
  const studentsForResolve = syntheticStudents.map((s) => ({ id: s.id, status: s.status }));
  const planById = new Map(syntheticStudents.map((s) => [s.id, s.plan]));
  const resolvePlan = (studentId: string) => planById.get(studentId) ?? null;

  const totalChargesBefore = state.charges.length;

  const plan = planIncompatiblePerClassChargeRepair({
    state,
    students: studentsForResolve,
    resolvePlan,
    evaluationDate: EVALUATION_DATE,
    voidedAt: `${EVALUATION_DATE}T12:00:00.000Z`,
  });

  // 3. Ningún cargo legítimo por clase se elimina / 12. sin duplicados: la
  // cantidad TOTAL de cargos nunca cambia — sólo se anula, nunca se crea
  // ni se borra ninguno.
  assertEqual(plan.updatedCharges.length, totalChargesBefore, 'reparar nunca crea ni borra cargos, sólo anula los incompatibles');

  const voidedIds = new Set(plan.actions.map((a) => a.voidedChargeId));
  const updatedById = new Map(plan.updatedCharges.map((c) => [c.id, c]));

  syntheticStudents.forEach((student) => {
    const isMonthly = student.plan.type === 'monthly';
    student.charges
      .filter((c) => c.type === 'por_clase')
      .forEach((charge) => {
        const period = billingPeriodOfDateKey(charge.dueDate);
        const isCurrentOrFuture = period >= CURRENT_PERIOD;
        const paidAmount = student.allocations
          .filter((a) => a.chargeId === charge.id)
          .reduce((sum, a) => sum + a.amount, 0);
        const wasVoided = voidedIds.has(charge.id);

        // 1. Sólo se anulan obligaciones realmente incompatibles: alumno
        // ACTIVO + plan mensual + período actual/futuro + sin ningún pago.
        const shouldBeVoided =
          student.status === 'activo' && isMonthly && isCurrentOrFuture && paidAmount === 0;

        assertEqual(
          wasVoided,
          shouldBeVoided,
          `${student.id}/${charge.id}: se anuló=${wasVoided}, debía anularse=${shouldBeVoided} ` +
            `(status=${student.status}, plan=${student.plan.type}, período=${period}, actual=${CURRENT_PERIOD}, pagado=${paidAmount})`
        );

        // 2. Ningún cargo legítimo (histórico, con pagos, alumno inactivo,
        // o plan realmente por_clase) queda anulado.
        if (!shouldBeVoided) {
          assertEqual(updatedById.get(charge.id)?.voidedAt, null, `${student.id}/${charge.id}: debía permanecer intacto`);
        }

        // Un cargo CON pagos reales nunca se anula, sin excepción.
        if (paidAmount > 0) {
          assertEqual(updatedById.get(charge.id)?.voidedAt, null, `${student.id}/${charge.id}: tiene pagos reales, nunca se anula`);
        }
      });

    // Los pagos y asignaciones de CUALQUIER alumno nunca se tocan.
    student.payments.forEach((p) => {
      assertEqual(p.voidedAt, null, `${student.id}: la reparación nunca debe anular un pago`);
    });
  });

  // 9. Idempotencia: correrla de nuevo sobre el resultado no encuentra nada más.
  const secondPass = planIncompatiblePerClassChargeRepair({
    state: { ...state, charges: plan.updatedCharges },
    students: studentsForResolve,
    resolvePlan,
    evaluationDate: EVALUATION_DATE,
    voidedAt: `${EVALUATION_DATE}T12:05:00.000Z`,
  });
  assertEqual(secondPass.actions.length, 0, 'segunda corrida sobre el resultado: nada más que reparar');
  assertEqual(secondPass.updatedCharges.length, plan.updatedCharges.length, 'segunda corrida: mismo total de cargos');

  // 6/7. Todo badge vencido identifica su período/obligación; no quedan
  // estados contradictorios sin explicación — para cada alumno mensual
  // ACTIVO, tras reparar, jamás debe quedar un cargo por clase del período
  // actual/futuro vencido Y SIN NINGÚN PAGO (la contradicción reportada,
  // "Agosto pendiente" + "Pago vencido" del mismo período por un cargo sin
  // ninguna actividad real, deja de ser posible). Un cargo con pagos
  // reales SÍ puede seguir mostrándose vencido a propósito — eso es
  // historial real, nunca se lo anula (needsReview) — pero ya lleva su
  // etiqueta específica ("Clase del DD/MM vencida"), nunca el genérico.
  syntheticStudents
    .filter((student) => student.status === 'activo' && student.plan.type === 'monthly')
    .forEach((student) => {
      const summary = buildStudentPaymentsSummary({
        studentId: student.id,
        state: { ...state, charges: plan.updatedCharges },
        evaluationDate: EVALUATION_DATE,
      });
      const debt = summarizeOverdueDebt({ charges: summary.charges, chargeStates: summary.chargeStates });
      const overdueUnpaidPerClassCurrentOrFuture = summary.charges.some((charge, idx) => {
        if (charge.type !== 'por_clase') return false;
        if (billingPeriodOfDateKey(charge.dueDate) < CURRENT_PERIOD) return false;
        const state = summary.chargeStates[idx];
        return state.balance > 0 && state.stage !== 'on_time' && state.paidAmount === 0;
      });
      assert(
        !overdueUnpaidPerClassCurrentOrFuture,
        `${student.id}: no debe quedar un cargo por clase SIN PAGOS del período actual/futuro vencido tras la reparación (debt=${debt.label})`
      );
    });

  // El análisis de sólo lectura, corrido DESPUÉS de reparar, nunca vuelve a
  // encontrar el mismo hallazgo (coherencia entre el detector y el reparador).
  const reportAfter = analyzeFinancialConsistency({
    state: { ...state, charges: plan.updatedCharges },
    students: studentsForResolve,
    resolvePlan,
    evaluationDate: EVALUATION_DATE,
  });
  const remainingIncompatible = reportAfter.findings.filter(
    (f) => f.category === 'per_class_charge_incompatible_with_monthly_plan'
  );
  // Sólo pueden quedar los que ya estaban en needsReview (tenían pagos
  // reales) — nunca uno sin pagos, porque ésos ya se anularon arriba.
  assertEqual(
    remainingIncompatible.length,
    plan.needsReview.length,
    'tras reparar, sólo siguen "incompatibles" los que ya estaban en needsReview (tenían pagos reales)'
  );
});
