// Puerto VERBATIM del original (`src/features/payments/hooks/useAnnualBudgetPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { useEffect, useMemo, useReducer, useState } from '../../../shims/react.ts';
import { ARGENTINA_TIME_ZONE, localDateKeyInTimeZone, nextBillingPeriod } from '../utils/paymentDates.ts';
import { buildMonthlyCollectedSeries } from '../utils/monthlyCollectedSeries.ts';
import { buildAnnualBudgetPlan, type AnnualBudgetPlan } from '../utils/annualBudgetProjection.ts';
import { getPaymentsSnapshot, subscribePayments } from './paymentsStore.ts';
import { useBudgetDistribution } from './useBudgetDistribution.ts';

const HISTORY_LOOKBACK_MONTHS = 3;

export interface UseAnnualBudgetPlanResult {
  year: string;
  setYear: (year: string) => void;
  availableYears: string[];
  plan: AnnualBudgetPlan;
  evaluationDate: string;
}

/**
 * Fase financiera — gráfico de 12 meses: arma el período de períodos a leer
 * (los 12 meses del año elegido + hasta 3 meses ANTERIORES al mes actual
 * real, para poder promediar la proyección aunque el año elegido recién
 * empiece) y delega el cálculo completo a `buildAnnualBudgetPlan` — nunca
 * reimplementa la clasificación real/actual/proyectado acá.
 */
export function useAnnualBudgetPlan(): UseAnnualBudgetPlanResult {
  const [tick, notifyChanged] = useReducer((count: number) => count + 1, 0);
  useEffect(() => subscribePayments(notifyChanged), []);

  const { distribution } = useBudgetDistribution();

  const evaluationDate = useMemo(() => localDateKeyInTimeZone(new Date(), ARGENTINA_TIME_ZONE), [tick]);
  const currentYear = evaluationDate.slice(0, 4);
  const [year, setYear] = useState(currentYear);

  return useMemo(() => {
    const state = getPaymentsSnapshot();

    const availableYearsSet = new Set<string>([currentYear]);
    state.payments.forEach((payment) => {
      if (payment.voidedAt === null) availableYearsSet.add(payment.paidAt.slice(0, 4));
    });
    const availableYears = Array.from(availableYearsSet).sort((first, second) => Number(second) - Number(first));

    const periodsToRead: string[] = [];
    let period = `${year}-01`;
    for (let i = 0; i < 12; i++) {
      periodsToRead.push(period);
      period = nextBillingPeriod(period);
    }
    let historyCursor = evaluationDate.slice(0, 7);
    for (let i = 0; i < HISTORY_LOOKBACK_MONTHS; i++) {
      const [y, m] = historyCursor.split('-').map(Number);
      const totalMonths = y * 12 + (m - 1) - 1;
      historyCursor = `${Math.floor(totalMonths / 12)}-${String((totalMonths % 12) + 1).padStart(2, '0')}`;
      if (!periodsToRead.includes(historyCursor)) periodsToRead.push(historyCursor);
    }

    const monthlyCollectedByPeriod = buildMonthlyCollectedSeries(state, periodsToRead);
    const plan = buildAnnualBudgetPlan({ year, evaluationDate, distribution, monthlyCollectedByPeriod });

    return { year, setYear, availableYears, plan, evaluationDate };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, year, distribution, evaluationDate, currentYear]);
}
