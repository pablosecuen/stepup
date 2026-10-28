// Puerto VERBATIM del original (`src/features/payments/utils/buildHomeFinancialSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentsRepositoryState } from '../types/index.ts';
import type { StudentStatus } from '../../student-profile/types/index.ts';
import { calculateChargeState } from './paymentCalculations.ts';
import { billingPeriodOfDateKey, toDateKey } from './paymentDates.ts';
import { isChargeOverdueForDisplay } from './paymentDueStage.ts';
import { isStudentEligibleForCollectionsDisplay } from './studentCollectionEligibility.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';

export interface HomeOverdueStudent {
  studentId: string;
  overdueAmount: number;
}

export interface HomeFinancialSummary {
  /** Dinero efectivamente cobrado (pagos vigentes, por su fecha real `paidAt`) durante el mes actual. */
  monthlyCollected: number;
  /** Saldo pendiente que todavía está en término (etapa "en término", no vencido), de CUALQUIER período. */
  pendingOnTimeBalance: number;
  /** Saldo realmente vencido (cualquier etapa posterior a "en término"), de CUALQUIER período. */
  overdueBalance: number;
  /** Alumnos únicos con al menos un pago vigente cuya fecha real cae en el mes actual — nunca la cantidad de pagos. */
  uniqueStudentsPaidThisMonth: number;
  /** Alumnos únicos con saldo pendiente (en término o vencido) mayor a cero. */
  uniqueStudentsWithDebt: number;
  /**
   * Alumnos con saldo VENCIDO, para armar recordatorios — ordenados por
   * mayor deuda primero. Nunca incluye nombres: el dominio de pagos no los
   * conoce (Fase Pagos 4B.3, "no leer paymentStatus heredado" — tampoco se
   * lee ninguna otra colección ajena al motor de pagos).
   */
  overdueStudents: HomeOverdueStudent[];
  /**
   * Corrección 2026-07-26 (a pedido de Joaquín — ciclo mensual de cobros):
   * "Generado este mes" — suma de `originalAmount` de cargos activos cuyo
   * `dueDate` cae en el mes actual (mismo criterio que `generated` en
   * `buildPeriodFinancialSummary`, acotado siempre al mes actual).
   */
  currentMonthGenerated: number;
  /**
   * "Pendiente este mes" — saldo positivo (en término + vencido) de los
   * cargos activos cuyo `dueDate` cae en el mes actual. Nunca mezcla deuda
   * de meses anteriores: eso vive en `priorPeriodsDebtBalance`.
   * @deprecated Usar `currentMonthPendingOnTimeBalance` + `currentMonthOverdueBalance`
   * por separado (corrección 2026-08-10, a pedido de Joaquín — "Pendiente
   * en término" y "Vencido" deben ser categorías excluyentes también dentro
   * del mes actual). Se conserva por compatibilidad de tipo, siempre igual
   * a la suma de esas dos.
   */
  currentMonthPendingBalance: number;
  /** "Pendiente en término este mes" — saldo del mes actual cuyo vencimiento todavía no pasó. Mutuamente excluyente con `currentMonthOverdueBalance`. */
  currentMonthPendingOnTimeBalance: number;
  /** "Vencido este mes" — saldo del mes actual cuyo vencimiento ya pasó. Mutuamente excluyente con `currentMonthPendingOnTimeBalance`. */
  currentMonthOverdueBalance: number;
  /**
   * "Deuda de meses anteriores" — saldo positivo de cargos activos cuyo
   * `dueDate` es ANTERIOR al mes actual. Un pago del mes anterior nunca
   * salda automáticamente el período nuevo (las asignaciones siguen
   * apuntando al cargo real que corresponda) — este número es sólo lo que
   * de verdad sigue sin cubrirse de períodos ya cerrados.
   */
  priorPeriodsDebtBalance: number;
}

/**
 * Resumen financiero del Home (Fase Pagos 4B.3): calculado exclusivamente a
 * partir de `PaymentsRepositoryState` con el motor puro ya existente
 * (`calculateChargeState`) — nunca lee `paymentStatus` heredado de
 * `Student`/`StudentProfile`, ni ninguna otra fuente. No persiste nada: se
 * recalcula por completo en cada llamada a partir de las cuatro colecciones
 * de pagos, igual que `buildStudentPaymentsSummary`.
 *
 * "Cobrado este mes" se agrupa por `Payment.paidAt` (la fecha real en que
 * el alumno pagó), nunca por `recordedAt` — un pago cargado hoy pero pagado
 * el mes pasado suma al mes en que realmente se cobró, no a este. Usa las
 * asignaciones (`PaymentAllocation`), no el importe bruto del pago, así un
 * pago parcial repartido entre obligaciones se refleja exactamente por lo
 * que se asignó a cargos vigentes — nunca por el total del pago si una
 * parte fue a un cargo anulado.
 *
 * "Pendiente en término" y "vencido" son categorías mutuamente excluyentes
 * (nunca se solapan): cada obligación con saldo positivo aporta a una sola,
 * según su etapa vigente a `evaluationDate`.
 *
 * Cargos y pagos anulados se ignoran por completo en todos los cálculos.
 * Pura — no muta `state`.
 *
 * Corrección 2026-09-11 (a pedido de Joaquín — ALUMNOS INACTIVOS EN EL
 * CIRCUITO DE COBROS): un cargo cuyo alumno NO está `'activo'` nunca aporta
 * a ninguna señal OPERATIVA de este resumen — "pendiente en término",
 * "vencido" (de cualquier período) ni `overdueStudents` — misma regla única
 * que el resto del dominio (`isStudentEligibleForCollectionsDisplay`).
 * Deliberadamente NO afecta `monthlyCollected`/`uniqueStudentsPaidThisMonth`
 * ni `currentMonthGenerated`: esos son hechos contables ya ocurridos (dinero
 * que ya se cobró, obligaciones que ya se generaron), no una alerta de cobro
 * vigente — un alumno que pagó este mes y luego pasó a inactivo sigue
 * habiendo pagado, de verdad, este mes. La deuda real tampoco se toca; sólo
 * deja de representarse como una alerta operativa vigente en el Home
 * mientras el alumno esté pausado/inactivo/archivado. `studentStatusById` es
 * opcional (default: cualquier alumno se trata como `'activo'`, el
 * comportamiento previo) — el llamador real (`useHomeFinancialSummary`)
 * siempre construye el mapa completo desde el store de alumnos.
 */
export function buildHomeFinancialSummary(input: {
  state: PaymentsRepositoryState;
  /** Date key YYYY-MM-DD, ya resuelto en huso horario de Buenos Aires. */
  evaluationDate: string;
  /** Corrección 2026-08-11 (recargos automáticos configurables): opcional, default = comportamiento actual. Ver `calculateChargeState`. */
  surchargeSettings?: SurchargeSettings;
  /** Estado ACTUAL de cada alumno, por id — ver comentario de arriba. */
  studentStatusById?: ReadonlyMap<string, StudentStatus>;
}): HomeFinancialSummary {
  const { state, evaluationDate, surchargeSettings, studentStatusById } = input;
  const currentMonth = billingPeriodOfDateKey(evaluationDate);
  const isEligible = (studentId: string) => isStudentEligibleForCollectionsDisplay(studentStatusById?.get(studentId) ?? 'activo');

  const activeCharges = state.charges.filter((charge) => charge.voidedAt === null);
  const activeChargeIds = new Set(activeCharges.map((charge) => charge.id));
  const paymentById = new Map(state.payments.map((payment) => [payment.id, payment]));

  let monthlyCollected = 0;
  const studentsPaidThisMonth = new Set<string>();
  state.allocations.forEach((allocation) => {
    if (!activeChargeIds.has(allocation.chargeId)) return;
    const payment = paymentById.get(allocation.paymentId);
    if (!payment || payment.voidedAt !== null) return;
    if (billingPeriodOfDateKey(toDateKey(payment.paidAt)) !== currentMonth) return;
    monthlyCollected += allocation.amount;
    studentsPaidThisMonth.add(allocation.studentId);
  });

  let pendingOnTimeBalance = 0;
  let overdueBalance = 0;
  let currentMonthGenerated = 0;
  let currentMonthPendingBalance = 0;
  let currentMonthPendingOnTimeBalance = 0;
  let currentMonthOverdueBalance = 0;
  let priorPeriodsDebtBalance = 0;
  const studentsWithDebt = new Set<string>();
  const overdueAmountByStudent = new Map<string, number>();

  activeCharges.forEach((charge) => {
    const chargeMonth = billingPeriodOfDateKey(charge.dueDate);
    if (chargeMonth === currentMonth) {
      currentMonthGenerated += charge.originalAmount;
    }

    const chargeState = calculateChargeState({
      charge,
      allocations: state.allocations,
      payments: state.payments,
      adjustments: state.adjustments,
      evaluationDate,
      surchargeSettings,
    });
    const positiveBalance = Math.max(chargeState.balance, 0);
    if (positiveBalance <= 0) return;
    // Corrección 2026-09-11: a partir de acá, todo lo que sigue es una
    // señal de cobro OPERATIVA vigente (saldo pendiente/vencido) — nunca se
    // le atribuye a un alumno que no está `'activo'` hoy.
    if (!isEligible(charge.studentId)) return;

    if (chargeMonth === currentMonth) {
      currentMonthPendingBalance += positiveBalance;
    } else if (chargeMonth < currentMonth) {
      priorPeriodsDebtBalance += positiveBalance;
    }

    studentsWithDebt.add(charge.studentId);
    // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
    // mensualidades "Mes vencido" al comenzar el mes): para 'mensual', "en
    // término" vs "vencido" ya no se decide con la etapa de recargo
    // (`chargeState.stage`) sino con el vencimiento real
    // (`isChargeOverdueForDisplay`, única fuente) — el resto de los tipos
    // conserva el criterio de siempre.
    if (!isChargeOverdueForDisplay(charge.type, charge.dueDate, chargeState.stage, evaluationDate)) {
      pendingOnTimeBalance += positiveBalance;
      if (chargeMonth === currentMonth) currentMonthPendingOnTimeBalance += positiveBalance;
    } else {
      overdueBalance += positiveBalance;
      if (chargeMonth === currentMonth) currentMonthOverdueBalance += positiveBalance;
      overdueAmountByStudent.set(
        charge.studentId,
        (overdueAmountByStudent.get(charge.studentId) ?? 0) + positiveBalance
      );
    }
  });

  const overdueStudents = Array.from(overdueAmountByStudent.entries())
    .map(([studentId, overdueAmount]) => ({ studentId, overdueAmount }))
    .sort((a, b) => {
      if (b.overdueAmount !== a.overdueAmount) return b.overdueAmount - a.overdueAmount;
      return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
    });

  return {
    monthlyCollected,
    pendingOnTimeBalance,
    overdueBalance,
    uniqueStudentsPaidThisMonth: studentsPaidThisMonth.size,
    uniqueStudentsWithDebt: studentsWithDebt.size,
    overdueStudents,
    currentMonthGenerated,
    currentMonthPendingBalance,
    currentMonthPendingOnTimeBalance,
    currentMonthOverdueBalance,
    priorPeriodsDebtBalance,
  };
}
