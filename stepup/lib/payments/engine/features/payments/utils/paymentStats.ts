// Puerto VERBATIM del original (`src/features/payments/utils/paymentStats.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, MonthlyPaymentStats, PaymentCharge } from '../types/index.ts';
import { billingPeriodOfDateKey, lastNBillingPeriods } from './paymentDates.ts';
import { determineDueStage } from './paymentDueStage.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';

/**
 * Agrupa por el mes de `dueDate` de cada cargo (mes facturado, no mes en
 * que se cobró): "cuánto se facturó/cobró/quedó pendiente de lo que vencía
 * en este mes". Pura — no muta `charges` ni `states`.
 */
export function buildMonthlyPaymentStats(
  charges: PaymentCharge[],
  states: ChargeComputedState[]
): MonthlyPaymentStats[] {
  const stateByChargeId = new Map(states.map((state) => [state.chargeId, state]));
  const byPeriod = new Map<string, MonthlyPaymentStats>();

  charges
    .filter((charge) => charge.voidedAt === null)
    .forEach((charge) => {
      const state = stateByChargeId.get(charge.id);
      if (!state) return;
      const period = billingPeriodOfDateKey(charge.dueDate);
      const current =
        byPeriod.get(period) ??
        ({
          period,
          totalCharged: 0,
          totalCollected: 0,
          totalOutstanding: 0,
          chargeCount: 0,
          paidChargeCount: 0,
        } satisfies MonthlyPaymentStats);

      byPeriod.set(period, {
        period,
        totalCharged: current.totalCharged + charge.originalAmount,
        totalCollected: current.totalCollected + state.paidAmount,
        totalOutstanding: current.totalOutstanding + Math.max(state.balance, 0),
        chargeCount: current.chargeCount + 1,
        paidChargeCount: current.paidChargeCount + (state.settledAt !== null ? 1 : 0),
      });
    });

  return Array.from(byPeriod.values()).sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Estadísticas mensuales por ALUMNO ÚNICO (para el gráfico general): a
// diferencia de `buildMonthlyPaymentStats` (que cuenta obligaciones), acá se
// cuenta cada alumno una única vez por mes, usando su peor situación entre
// todas las obligaciones que le vencieron ese mes — así un alumno "por
// clase" con varias obligaciones en el mismo período no se cuenta varias
// veces ni se le "perdona" la peor de ellas.
// ---------------------------------------------------------------------------

export type StudentMonthlyPaymentCategory =
  | 'en_termino'
  | 'primer_vencimiento'
  | 'segundo_vencimiento'
  | 'ultimo_vencimiento'
  | 'mantiene_deuda';

/**
 * Orden de severidad: 0 es la peor situación posible (deuda), 4 la mejor
 * (en término). Exportado para que el historial mensual POR ALUMNO (Fase
 * Pagos 4C.1, `studentPaymentHistory.ts`) pueda reutilizar el mismo criterio
 * de "peor categoría del mes" que ya usa esta agregación general, en vez de
 * duplicar el orden de severidad.
 */
export const CATEGORY_SEVERITY_RANK: Record<StudentMonthlyPaymentCategory, number> = {
  mantiene_deuda: 0,
  ultimo_vencimiento: 1,
  segundo_vencimiento: 2,
  primer_vencimiento: 3,
  en_termino: 4,
};

export interface MonthlyUniqueStudentPaymentStats {
  period: string; // YYYY-MM
  studentsOnTime: number;
  studentsFirstLate: number;
  studentsSecondLate: number;
  studentsLastLate: number;
  studentsInDebt: number;
  /** students*Count deben sumar exactamente este total. */
  totalUniqueStudentsEvaluated: number;
}

/**
 * Categoriza una obligación individual ya vencida. `null` si todavía no
 * venció (`isNotYetDue`): una obligación futura no debe perjudicar ni
 * beneficiar la clasificación del alumno ese mes, así que no participa. La
 * etapa de una obligación saldada se deriva de `settledAt` (nunca de la
 * etapa "actual" congelada o no) para que coincida exactamente con
 * `calculateChargeScore`. Exportada para reutilizarse desde el historial
 * mensual por alumno (Fase Pagos 4C.1).
 */
export function categorizeChargeState(
  charge: Pick<PaymentCharge, 'type' | 'dueDate'>,
  state: ChargeComputedState,
  surchargeSettings?: SurchargeSettings
): StudentMonthlyPaymentCategory | null {
  if (state.isNotYetDue) return null;
  if (state.settledAt === null) return 'mantiene_deuda';
  // Corrección 2026-08-12: se resuelve por `state.settledAt` (la fecha REAL
  // de saldado), nunca por `charge.dueDate` — mismo criterio de
  // congelamiento que `calculateChargeState`/`calculateChargeScore`.
  const tierValues = resolveEffectiveSurchargeTierValues(
    surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
    billingPeriodOfDateKey(state.settledAt)
  );
  switch (determineDueStage(charge.type, charge.dueDate, state.settledAt, tierValues)) {
    case 'on_time':
      return 'en_termino';
    case 'first_late':
      return 'primer_vencimiento';
    case 'second_late':
      return 'segundo_vencimiento';
    case 'last_late':
    default:
      return 'ultimo_vencimiento';
  }
}

/**
 * Agrupa por el mes de vencimiento de cada cargo (igual criterio que
 * `buildMonthlyPaymentStats`), pero clasifica ALUMNOS únicos, no
 * obligaciones: cada alumno aparece una sola vez por mes, en la categoría
 * de su obligación en peor situación ese mes. Pura — no muta `charges` ni
 * `states`.
 */
export function buildMonthlyUniqueStudentPaymentStats(
  charges: PaymentCharge[],
  states: ChargeComputedState[],
  surchargeSettings?: SurchargeSettings
): MonthlyUniqueStudentPaymentStats[] {
  const stateByChargeId = new Map(states.map((state) => [state.chargeId, state]));
  const worstCategoryByPeriodAndStudent = new Map<string, Map<string, StudentMonthlyPaymentCategory>>();

  charges
    .filter((charge) => charge.voidedAt === null)
    .forEach((charge) => {
      const state = stateByChargeId.get(charge.id);
      if (!state) return;
      const category = categorizeChargeState(charge, state, surchargeSettings);
      if (category === null) return;

      const period = billingPeriodOfDateKey(charge.dueDate);
      let byStudent = worstCategoryByPeriodAndStudent.get(period);
      if (!byStudent) {
        byStudent = new Map<string, StudentMonthlyPaymentCategory>();
        worstCategoryByPeriodAndStudent.set(period, byStudent);
      }
      const current = byStudent.get(charge.studentId);
      if (current === undefined || CATEGORY_SEVERITY_RANK[category] < CATEGORY_SEVERITY_RANK[current]) {
        byStudent.set(charge.studentId, category);
      }
    });

  return Array.from(worstCategoryByPeriodAndStudent.entries())
    .map(([period, byStudent]) => {
      const counts: Record<StudentMonthlyPaymentCategory, number> = {
        en_termino: 0,
        primer_vencimiento: 0,
        segundo_vencimiento: 0,
        ultimo_vencimiento: 0,
        mantiene_deuda: 0,
      };
      byStudent.forEach((category) => {
        counts[category] += 1;
      });
      return {
        period,
        studentsOnTime: counts.en_termino,
        studentsFirstLate: counts.primer_vencimiento,
        studentsSecondLate: counts.segundo_vencimiento,
        studentsLastLate: counts.ultimo_vencimiento,
        studentsInDebt: counts.mantiene_deuda,
        totalUniqueStudentsEvaluated: byStudent.size,
      };
    })
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}

/**
 * Igual que `buildMonthlyUniqueStudentPaymentStats`, pero siempre devuelve
 * exactamente `monthsToShow` períodos consecutivos terminando en el mes de
 * `evaluationDate` (Fase Pagos 4C.1, gráfico "Resumen general"): los meses
 * sin ninguna obligación evaluada se completan en cero, en vez de
 * desaparecer del gráfico — así el eje de meses del gráfico de barras
 * siempre es continuo. Pura — no muta `charges` ni `states`.
 */
export function buildLastNMonthsUniqueStudentStats(
  charges: PaymentCharge[],
  states: ChargeComputedState[],
  evaluationDate: string,
  monthsToShow = 12,
  surchargeSettings?: SurchargeSettings
): MonthlyUniqueStudentPaymentStats[] {
  const statsByPeriod = new Map(
    buildMonthlyUniqueStudentPaymentStats(charges, states, surchargeSettings).map((stats) => [stats.period, stats])
  );
  return lastNBillingPeriods(evaluationDate, monthsToShow).map(
    (period) =>
      statsByPeriod.get(period) ?? {
        period,
        studentsOnTime: 0,
        studentsFirstLate: 0,
        studentsSecondLate: 0,
        studentsLastLate: 0,
        studentsInDebt: 0,
        totalUniqueStudentsEvaluated: 0,
      }
  );
}
