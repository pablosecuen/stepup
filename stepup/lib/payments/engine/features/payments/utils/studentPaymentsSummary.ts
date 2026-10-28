// Puerto VERBATIM del original (`src/features/payments/utils/studentPaymentsSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { calculateChargeState } from './paymentCalculations.ts';
import { calculateChargeScore, calculateStudentScoring, detectConsecutiveDebtStreak } from './paymentScoring.ts';
import { deriveWorstTrafficLight, type PaymentTrafficLight } from './paymentTrafficLight.ts';
import { billingPeriodOfDateKey } from './paymentDates.ts';
import { isChargeOverdueForDisplay } from './paymentDueStage.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';
import type {
  ChargeComputedState,
  Payment,
  PaymentCharge,
  PaymentsRepositoryState,
  StudentScoringResult,
} from '../types/index.ts';

export interface StudentPaymentsSummary {
  /** Obligaciones vigentes (no anuladas) del alumno, ordenadas por vencimiento ascendente. */
  charges: PaymentCharge[];
  /** Estado calculado de cada obligación, mismo orden e índice que `charges`. */
  chargeStates: ChargeComputedState[];
  /** Suma de `originalAmount` de las obligaciones todavía no saldadas (sin recargo). */
  totalOriginal: number;
  /** Suma de `totalDue` (con recargo vigente) de las obligaciones todavía no saldadas. */
  totalWithSurcharge: number;
  /** Suma de `paidAmount` de TODAS las obligaciones vigentes (saldadas o no). */
  totalPaid: number;
  /** Suma del saldo positivo de todas las obligaciones vigentes: lo que falta cubrir en total. */
  pendingBalance: number;
  /** Igual que `pendingBalance`, pero sólo de las obligaciones realmente vencidas (ver `isChargeOverdueForDisplay`). */
  overdueBalance: number;
  /** Pagos no anulados del alumno. */
  activePayments: Payment[];
  /** Pagos anulados del alumno, mostrados por separado (nunca se borran). */
  voidedPayments: Payment[];
  scoring: StudentScoringResult;
  debtStreak: number;
  /** Semáforo visual: la peor situación entre todas las obligaciones vigentes. */
  trafficLight: PaymentTrafficLight;
}

/**
 * Arma el resumen financiero completo de UN alumno a partir del estado
 * financiero completo y una fecha de evaluación — la pieza central que usa
 * `useStudentPayments`. Separada del hook a propósito para poder probarla
 * sin React (este harness de pruebas no puede renderizar hooks). Nunca
 * persiste nada: todo se recalcula siempre a partir de las cuatro
 * colecciones del motor puro. Pura — no muta `state`.
 */
export function buildStudentPaymentsSummary(input: {
  studentId: string;
  state: PaymentsRepositoryState;
  evaluationDate: string;
  /** Corrección 2026-08-11 (recargos automáticos configurables): opcional, default = comportamiento actual. Ver `calculateChargeState`. */
  surchargeSettings?: SurchargeSettings;
}): StudentPaymentsSummary {
  const { studentId, state, evaluationDate, surchargeSettings } = input;

  const charges = state.charges
    .filter((charge) => charge.studentId === studentId && charge.voidedAt === null)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));

  const chargeStates = charges.map((charge) =>
    calculateChargeState({
      charge,
      allocations: state.allocations,
      payments: state.payments,
      adjustments: state.adjustments,
      evaluationDate,
      surchargeSettings,
    })
  );

  let totalOriginal = 0;
  let totalWithSurcharge = 0;
  let totalPaid = 0;
  let pendingBalance = 0;
  let overdueBalance = 0;

  chargeStates.forEach((chargeState, index) => {
    totalPaid += chargeState.paidAmount;
    const positiveBalance = Math.max(chargeState.balance, 0);
    if (positiveBalance > 0) {
      totalOriginal += chargeState.originalAmount;
      totalWithSurcharge += chargeState.totalDue;
      pendingBalance += positiveBalance;
      // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
      // mensualidades "Mes vencido" al comenzar el mes): "vencido" para una
      // mensualidad ya no se decide con la etapa de RECARGO (`chargeState.stage`)
      // sino con el vencimiento real (`isChargeOverdueForDisplay`, única
      // fuente) — el resto de los tipos conserva el criterio de siempre.
      const charge = charges[index];
      if (isChargeOverdueForDisplay(charge.type, charge.dueDate, chargeState.stage, evaluationDate)) {
        overdueBalance += positiveBalance;
      }
    }
  });

  const activePayments = state.payments.filter((payment) => payment.studentId === studentId && payment.voidedAt === null);
  const voidedPayments = state.payments.filter((payment) => payment.studentId === studentId && payment.voidedAt !== null);

  const chargeScores = charges.map((charge, index) => calculateChargeScore(charge, chargeStates[index], surchargeSettings));
  const scoring = calculateStudentScoring(chargeScores);
  const debtStreak = detectConsecutiveDebtStreak(
    charges.map((charge, index) => ({ dueDate: charge.dueDate, score: chargeScores[index] }))
  );
  // El semáforo colapsa a verde/rojo (sin amarillo/naranja intermedios)
  // cuando los recargos están desactivados HOY — es un indicador visual
  // grueso, no la fuente de verdad del saldo (eso ya es 100% correcto por
  // cargo vía `calculateChargeState`, resuelto por el período real de cada
  // obligación más arriba).
  const surchargeEnabledNow = resolveEffectiveSurchargeTierValues(
    surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
    billingPeriodOfDateKey(evaluationDate)
  ).enabled;
  const trafficLight = deriveWorstTrafficLight(chargeStates, !surchargeEnabledNow);

  return {
    charges,
    chargeStates,
    totalOriginal,
    totalWithSurcharge,
    totalPaid,
    pendingBalance,
    overdueBalance,
    activePayments,
    voidedPayments,
    scoring,
    debtStreak,
    trafficLight,
  };
}
