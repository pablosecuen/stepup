// Puerto VERBATIM del original (`src/features/payments/utils/studentPaymentHistory.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge, PaymentsRepositoryState, StudentScoringResult } from '../types/index.ts';
import { billingPeriodOfDateKey, lastNBillingPeriods } from './paymentDates.ts';
import { calculateChargeScore } from './paymentScoring.ts';
import { CATEGORY_SEVERITY_RANK, categorizeChargeState, type StudentMonthlyPaymentCategory } from './paymentStats.ts';
import { buildStudentPaymentsSummary } from './studentPaymentsSummary.ts';

export interface StudentMonthlyHistoryEntry {
  period: string; // YYYY-MM
  /** `null` = el alumno no tenía ninguna obligación vencida ese mes (no participa, nunca es "deuda"). */
  category: StudentMonthlyPaymentCategory | null;
  /** Suma de `totalDue` (importe + recargo vigente) de las obligaciones que vencían ese mes. */
  totalDue: number;
  /** Suma de lo efectivamente pagado (asignaciones vigentes) de esas mismas obligaciones. */
  totalPaid: number;
}

export interface StudentPaymentHistory {
  /** Últimos `monthsToShow` meses, orden cronológico ascendente (el más viejo primero). */
  months: StudentMonthlyHistoryEntry[];
  scoring: StudentScoringResult;
  /** Obligaciones resueltas saldadas en término (score 100). */
  onTimeCount: number;
  /** Obligaciones resueltas fuera de término: saldadas tarde (score 25/50/75) o vencidas sin saldar (score 0). */
  lateCount: number;
  /** Saldo pendiente total del alumno a `evaluationDate` (en término + vencido). */
  currentDebt: number;
  /**
   * Racha de MESES consecutivos con deuda, mirando hacia atrás desde el mes
   * más reciente de `months`. A diferencia del `debtStreak` de
   * `buildStudentPaymentsSummary` (que cuenta obligaciones, no meses), acá
   * un alumno "por_clase" con varias obligaciones en el mismo mes con deuda
   * sigue sumando un único mes a la racha. Los meses sin ninguna obligación
   * vencida no cortan ni suman la racha (se saltean, igual que las
   * obligaciones todavía no vencidas en el cálculo por obligación).
   */
  monthlyDebtStreak: number;
}

/**
 * Historial mensual de pagos de UN alumno (Fase Pagos 4C.1, pestaña Cobros
 * del perfil): reutiliza `buildStudentPaymentsSummary` (mismo motor que ya
 * usa el resto de Cobros) para las obligaciones, sus estados calculados,
 * el scoring y el saldo pendiente — y le agrega la agrupación mensual sobre
 * los últimos `monthsToShow` meses (12 por defecto), usando el mismo
 * criterio de "peor categoría del mes" que el resumen general
 * (`categorizeChargeState`/`CATEGORY_SEVERITY_RANK` de `paymentStats.ts`).
 *
 * Como todo se recalcula desde cero a partir de `PaymentCharge`/`Payment`/
 * `PaymentAllocation`/`PaymentAdjustment` en cada llamada (nunca se
 * incrementa un historial guardado), un pago retroactivo que cambia
 * `settledAt` de una obligación pasada corrige automáticamente su categoría
 * en el mes correspondiente la próxima vez que se llama a esta función.
 * Nunca lee `paymentStatus` heredado. Nunca persiste nada. Pura — no muta
 * `input.state`.
 */
export function buildStudentPaymentHistory(input: {
  studentId: string;
  state: PaymentsRepositoryState;
  evaluationDate: string;
  monthsToShow?: number;
}): StudentPaymentHistory {
  const monthsToShow = input.monthsToShow ?? 12;
  const summary = buildStudentPaymentsSummary({
    studentId: input.studentId,
    state: input.state,
    evaluationDate: input.evaluationDate,
  });

  const chargeStateById = new Map(summary.chargeStates.map((chargeState) => [chargeState.chargeId, chargeState]));
  const chargesByPeriod = new Map<string, PaymentCharge[]>();
  summary.charges.forEach((charge) => {
    const period = billingPeriodOfDateKey(charge.dueDate);
    const bucket = chargesByPeriod.get(period);
    if (bucket) {
      bucket.push(charge);
    } else {
      chargesByPeriod.set(period, [charge]);
    }
  });

  const months: StudentMonthlyHistoryEntry[] = lastNBillingPeriods(input.evaluationDate, monthsToShow).map(
    (period) => {
      const chargesInPeriod = chargesByPeriod.get(period) ?? [];
      let worst: StudentMonthlyPaymentCategory | null = null;
      let totalDue = 0;
      let totalPaid = 0;
      chargesInPeriod.forEach((charge) => {
        const chargeState = chargeStateById.get(charge.id);
        if (!chargeState) return;
        totalDue += chargeState.totalDue;
        totalPaid += chargeState.paidAmount;
        const category = categorizeChargeState(charge, chargeState);
        if (category === null) return;
        if (worst === null || CATEGORY_SEVERITY_RANK[category] < CATEGORY_SEVERITY_RANK[worst]) {
          worst = category;
        }
      });
      return { period, category: worst, totalDue, totalPaid };
    }
  );

  let onTimeCount = 0;
  let lateCount = 0;
  summary.charges.forEach((charge) => {
    const chargeState = chargeStateById.get(charge.id);
    if (!chargeState) return;
    const score = calculateChargeScore(charge, chargeState);
    if (score === null) return;
    if (score === 100) {
      onTimeCount += 1;
    } else {
      lateCount += 1;
    }
  });

  let monthlyDebtStreak = 0;
  for (let i = months.length - 1; i >= 0; i--) {
    const category = months[i].category;
    if (category === 'mantiene_deuda') {
      monthlyDebtStreak += 1;
      continue;
    }
    if (category === null) continue;
    break;
  }

  return {
    months,
    scoring: summary.scoring,
    onTimeCount,
    lateCount,
    currentDebt: summary.pendingBalance,
    monthlyDebtStreak,
  };
}
