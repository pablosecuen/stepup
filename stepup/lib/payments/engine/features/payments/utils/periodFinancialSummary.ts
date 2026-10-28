// Puerto VERBATIM del original (`src/features/payments/utils/periodFinancialSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Resumen financiero de un PERÍODO ARBITRARIO (Fase "Analíticas financieras,
 * demanda y resumen anual", a pedido de Joaquín) — generaliza
 * `buildHomeFinancialSummary.ts` (que sólo cubre "el mes actual") a
 * cualquier rango de fechas, para poder alimentar el selector de período
 * de Resumen financiero (mes / últimos 3 / últimos 6 / año actual / año
 * anterior / rango personalizado) con una única implementación.
 *
 * Reutiliza exactamente el mismo motor puro que ya existe
 * (`calculateChargeState`) — nunca reimplementa el cálculo de recargo,
 * etapa de vencimiento ni saldo. Nunca lee `paymentStatus` heredado.
 *
 * Definiciones (coherentes con `buildHomeFinancialSummary`):
 *  - Generado: suma de `originalAmount` de cargos ACTIVOS (no anulados)
 *    cuya fecha de vencimiento (`dueDate`) cae dentro del rango — "el valor
 *    de las obligaciones que corresponden a este período", sin importar
 *    cuándo se paguen.
 *  - Cobrado: suma de asignaciones (`PaymentAllocation`) hacia cargos
 *    activos, provenientes de pagos activos cuya fecha REAL (`paidAt`) cae
 *    dentro del rango — dinero efectivamente recibido en el rango, sin
 *    importar a qué período pertenezca la obligación que salda. Un pago
 *    parcial repartido entre varias obligaciones nunca se cuenta dos veces
 *    (se suma por asignación, no por el total del pago).
 *  - Pendiente / Vencido: saldo positivo de los cargos del rango (mismo
 *    filtro que "Generado"), separado según su etapa vigente a
 *    `evaluationDate` — "en término" vs cualquier etapa posterior.
 * Por diseño, Generado no es necesariamente igual a Cobrado + Pendiente +
 * Vencido: "Cobrado" es de base caja (por `paidAt`) y las otras tres son de
 * base devengado (por `dueDate`) — mismo criterio mixto que ya usaba
 * `buildHomeFinancialSummary`, sólo generalizado a un rango.
 */
import type { PaymentCharge, PaymentsRepositoryState } from '../types/index.ts';
import { calculateChargeState } from './paymentCalculations.ts';
import { addDaysToDateKey, billingPeriodOfDateKey, daysBetweenDateKeys, toDateKey } from './paymentDates.ts';
import { isChargeOverdueForDisplay } from './paymentDueStage.ts';
import type { SurchargeSettings } from './surchargeSettings.ts';

export interface PeriodFinancialSummary {
  rangeStart: string;
  rangeEnd: string;
  generated: number;
  collected: number;
  pending: number;
  overdue: number;
  /** Cantidad de cargos activos cuyo vencimiento cae en el rango (para mostrar "sobre N obligaciones"). */
  chargeCount: number;
}

function dateKeyInRange(dateKey: string, rangeStart: string, rangeEnd: string): boolean {
  return daysBetweenDateKeys(rangeStart, dateKey) >= 0 && daysBetweenDateKeys(dateKey, rangeEnd) >= 0;
}

export function buildPeriodFinancialSummary(input: {
  state: PaymentsRepositoryState;
  rangeStart: string;
  rangeEnd: string;
  evaluationDate: string;
  /** Configuración REAL de recargos vigente — sin esto, "Pendiente"/"Vencido" se calculaban como si los recargos siempre estuvieran activados. */
  surchargeSettings?: SurchargeSettings;
}): PeriodFinancialSummary {
  const { state, rangeStart, rangeEnd, evaluationDate, surchargeSettings } = input;
  if (daysBetweenDateKeys(rangeStart, rangeEnd) < 0) {
    throw new RangeError('rangeEnd no puede ser anterior a rangeStart.');
  }

  const activeCharges = state.charges.filter((charge) => charge.voidedAt === null);
  const chargesInRange = activeCharges.filter((charge) => dateKeyInRange(charge.dueDate, rangeStart, rangeEnd));
  const chargeIdsInRange = new Set(chargesInRange.map((charge) => charge.id));

  const generated = chargesInRange.reduce((sum, charge) => sum + charge.originalAmount, 0);

  const activeChargeIds = new Set(activeCharges.map((charge) => charge.id));
  const paymentById = new Map(state.payments.map((payment) => [payment.id, payment]));
  let collected = 0;
  state.allocations.forEach((allocation) => {
    if (!activeChargeIds.has(allocation.chargeId)) return;
    const payment = paymentById.get(allocation.paymentId);
    if (!payment || payment.voidedAt !== null) return;
    if (!dateKeyInRange(toDateKey(payment.paidAt), rangeStart, rangeEnd)) return;
    collected += allocation.amount;
  });

  let pending = 0;
  let overdue = 0;
  chargesInRange.forEach((charge) => {
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
    // Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO:
    // mensualidades "Mes vencido" al comenzar el mes): mismo criterio que
    // `buildHomeFinancialSummary.ts` — para 'mensual' se usa el vencimiento
    // real (`isChargeOverdueForDisplay`), nunca la etapa de recargo a secas.
    if (!isChargeOverdueForDisplay(charge.type, charge.dueDate, chargeState.stage, evaluationDate)) {
      pending += positiveBalance;
    } else {
      overdue += positiveBalance;
    }
  });

  return {
    rangeStart,
    rangeEnd,
    generated,
    collected,
    pending,
    overdue,
    chargeCount: chargeIdsInRange.size,
  };
}

// ---------------------------------------------------------------------------
// Rangos predefinidos del selector de período (sección 1/9 del pedido).
// ---------------------------------------------------------------------------

export type FinancialPeriodPreset =
  | 'current_month'
  | 'last_3_months'
  | 'last_6_months'
  | 'current_year'
  | 'previous_year';

export interface FinancialPeriodRange {
  rangeStart: string;
  rangeEnd: string;
  label: string;
}

function monthRange(period: string): { start: string; end: string } {
  const start = `${period}-01`;
  const [year, month] = period.split('-').map(Number);
  const nextMonthTotal = year * 12 + (month - 1) + 1;
  const nextYear = Math.floor(nextMonthTotal / 12);
  const nextMonth = (nextMonthTotal % 12) + 1;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, end: addDaysToDateKey(nextMonthStart, -1) };
}

function shiftPeriod(period: string, monthsBack: number): string {
  const [year, month] = period.split('-').map(Number);
  const total = year * 12 + (month - 1) - monthsBack;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = (total % 12) + 1;
  return `${shiftedYear}-${String(shiftedMonth).padStart(2, '0')}`;
}

/**
 * Resuelve un preset del selector de período a un rango de fechas concreto.
 * "Últimos N meses" incluye el mes actual como el más reciente de los N.
 * Pura — sólo depende de `evaluationDate`.
 */
export function resolveFinancialPeriodRange(
  preset: FinancialPeriodPreset,
  evaluationDate: string
): FinancialPeriodRange {
  const currentPeriod = billingPeriodOfDateKey(evaluationDate);
  const currentYear = Number(currentPeriod.split('-')[0]);

  switch (preset) {
    case 'current_month': {
      const { start, end } = monthRange(currentPeriod);
      return { rangeStart: start, rangeEnd: end, label: 'Este mes' };
    }
    case 'last_3_months': {
      const startPeriod = shiftPeriod(currentPeriod, 2);
      return {
        rangeStart: monthRange(startPeriod).start,
        rangeEnd: monthRange(currentPeriod).end,
        label: 'Últimos 3 meses',
      };
    }
    case 'last_6_months': {
      const startPeriod = shiftPeriod(currentPeriod, 5);
      return {
        rangeStart: monthRange(startPeriod).start,
        rangeEnd: monthRange(currentPeriod).end,
        label: 'Últimos 6 meses',
      };
    }
    case 'current_year':
      return { rangeStart: `${currentYear}-01-01`, rangeEnd: `${currentYear}-12-31`, label: `Año ${currentYear}` };
    case 'previous_year':
      return {
        rangeStart: `${currentYear - 1}-01-01`,
        rangeEnd: `${currentYear - 1}-12-31`,
        label: `Año ${currentYear - 1}`,
      };
    default: {
      const exhaustiveCheck: never = preset;
      throw new Error(`Preset de período desconocido: ${String(exhaustiveCheck)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Comparación con el período anterior (sección 9 del pedido) — nunca
// divide por cero: si el período anterior fue $0, no hay porcentaje.
// ---------------------------------------------------------------------------

export interface PeriodComparison {
  current: number;
  previous: number;
  /** `null` cuando `previous` es 0 — no hay base para calcular un porcentaje real. */
  percentChange: number | null;
}

export function comparePeriodValues(current: number, previous: number): PeriodComparison {
  if (previous === 0) return { current, previous, percentChange: null };
  const percentChange = ((current - previous) / previous) * 100;
  return {
    current,
    previous,
    percentChange: Number.isFinite(percentChange) ? percentChange : null,
  };
}

/** Rango del mismo tamaño, inmediatamente anterior a `[rangeStart, rangeEnd]` — para "vs. período anterior". */
export function previousComparableRange(rangeStart: string, rangeEnd: string): { rangeStart: string; rangeEnd: string } {
  const lengthDays = daysBetweenDateKeys(rangeStart, rangeEnd);
  const previousEnd = addDaysToDateKey(rangeStart, -1);
  const previousStart = addDaysToDateKey(previousEnd, -lengthDays);
  return { rangeStart: previousStart, rangeEnd: previousEnd };
}

// Reexport de utilidades usadas por otros módulos analíticos, para que un
// único import alcance en la mayoría de los casos.
export type { PaymentCharge };
