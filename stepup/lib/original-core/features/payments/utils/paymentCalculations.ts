// Puerto VERBATIM del original (`src/features/payments/utils/paymentCalculations.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  ChargeComputedState,
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
} from '../types/index.ts';
import { billingPeriodOfDateKey, daysBetweenDateKeys, toDateKey } from './paymentDates.ts';
import { calculateSurchargeAmount, determineDueStage } from './paymentDueStage.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
 * configurables) + corrección 2026-08-12 (a pedido de Joaquín — BUG: al
 * desactivar recargos, una deuda abierta de un mes ANTERIOR seguía
 * mostrando el recargo viejo): resuelve la configuración vigente para el
 * período de `referenceDate` — nunca el período propio del cargo
 * (`charge.dueDate`/`billingPeriod`). Quien llama decide qué fecha pasar:
 *   - una obligación SALDADA usa `settledAt` (congelado para siempre — ver
 *     `calculateChargeState`): "nunca aplicar retroactivamente a un período
 *     ya cerrado" sigue cumpliéndose, porque saldada = cerrada.
 *   - una obligación ABIERTA (no saldada) usa la fecha de evaluación de HOY
 *     (o, dentro de una simulación de saldado, la fecha de cada
 *     asignación/punto de control) — nunca su propio `billingPeriod` de
 *     origen. Una deuda de junio que sigue sin pagar en agosto no es
 *     "código cerrado": es la misma obligación viva hoy, así que refleja la
 *     configuración vigente HOY, tal como pide el pedido ("todos los saldos
 *     abiertos deben quedar calculados exclusivamente con el monto base" —
 *     sin importar de qué mes sea la deuda).
 */
function resolveTierValuesAt(referenceDate: string, surchargeSettings: SurchargeSettings | undefined) {
  return resolveEffectiveSurchargeTierValues(
    surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
    billingPeriodOfDateKey(referenceDate)
  );
}

/** true si existe al menos un ajuste no anulado para ese cargo. */
export function isSurchargeWaivedForCharge(chargeId: string, adjustments: PaymentAdjustment[]): boolean {
  return adjustments.some((adjustment) => adjustment.chargeId === chargeId && adjustment.voidedAt === null);
}

/**
 * Suma de asignaciones vigentes (no anuladas, y cuyo pago tampoco esté
 * anulado) para un cargo puntual. Pura — no modifica `allocations` ni
 * `payments`.
 */
export function calculatePaidAmountForCharge(
  chargeId: string,
  allocations: PaymentAllocation[],
  payments: Payment[]
): number {
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));
  return allocations
    .filter((allocation) => allocation.chargeId === chargeId)
    .filter((allocation) => {
      const payment = paymentsById.get(allocation.paymentId);
      return payment !== undefined && payment.voidedAt === null;
    })
    .reduce((sum, allocation) => sum + allocation.amount, 0);
}

/** total adeudado, pagado y saldo — saldo puede ser negativo si hay sobrepago. */
export function calculatePaymentSummary(
  totalDue: number,
  paidAmount: number
): { totalDue: number; paidAmount: number; balance: number } {
  return { totalDue, paidAmount, balance: totalDue - paidAmount };
}

export interface DatedAllocationAmount {
  amount: number;
  paidAt: string;
}

export interface ChargeSettlementSimulation {
  /** Fecha en la que el acumulado alcanzó por primera vez el monto correspondiente, o `null` si nunca se saldó. */
  settledAt: string | null;
  /**
   * Cuánto excede el acumulado al monto requerido en el momento del
   * saldado (0 si se saldó exacto, o si nunca se saldó). Un valor mayor a
   * cero significa que, de las asignaciones simuladas, alguna dejó más
   * dinero del necesario para saldar la obligación — el dominio todavía no
   * admite saldo a favor, así que esto es lo que usa `allocatePayment` para
   * rechazar una asignación en vez de dejarlo pasar en silencio.
   */
  excessAtSettlement: number;
}

/**
 * Simula la aplicación cronológica de los pagos parciales de un cargo:
 * recorre las asignaciones ordenadas por `paidAt` (nunca por el orden en
 * que se cargaron: una asignación retroactiva con `paidAt` anterior a otra
 * ya registrada debe insertarse en su lugar cronológico, no al final) y en
 * cada paso vuelve a calcular cuánto se necesita ESE día (el recargo crece
 * con el tiempo, así que el monto requerido no es fijo). Pura — no muta
 * `datedAllocations`.
 */
export function simulateChargeSettlement(
  charge: Pick<PaymentCharge, 'type' | 'originalAmount' | 'dueDate'>,
  datedAllocations: DatedAllocationAmount[],
  isSurchargeWaived: boolean,
  surchargeSettings?: SurchargeSettings
): ChargeSettlementSimulation {
  // Comparación lexicográfica: válida para date keys YYYY-MM-DD (coincide
  // con el orden cronológico). `daysBetweenDateKeys(a, b)` no sirve acá
  // directamente como compareFn: representa "días de a hacia b", que es el
  // signo opuesto al que espera `Array.prototype.sort` para orden ascendente.
  const sorted = [...datedAllocations].sort((a, b) => (a.paidAt < b.paidAt ? -1 : a.paidAt > b.paidAt ? 1 : 0));
  let cumulative = 0;
  for (const allocation of sorted) {
    cumulative += allocation.amount;
    // La configuración vigente EN LA FECHA de esta asignación puntual —
    // nunca una única resolución global para toda la simulación: si la
    // profesora desactivó los recargos entre dos pagos parciales, lo
    // requerido en cada punto de control debe reflejar lo que regía ESE día.
    const tierValues = resolveTierValuesAt(allocation.paidAt, surchargeSettings);
    const requiredTotal = isSurchargeWaived
      ? charge.originalAmount
      : charge.originalAmount +
        calculateSurchargeAmount(
          charge.originalAmount,
          determineDueStage(charge.type, charge.dueDate, allocation.paidAt, tierValues),
          tierValues
        );
    if (cumulative >= requiredTotal) {
      return { settledAt: allocation.paidAt, excessAtSettlement: cumulative - requiredTotal };
    }
  }
  return { settledAt: null, excessAtSettlement: 0 };
}

/**
 * Atajo sobre `simulateChargeSettlement` para quien sólo necesita la fecha
 * de saldado (la mayoría de los llamadores). Pura — no muta `datedAllocations`.
 */
export function applyPartialPaymentsByDate(
  charge: Pick<PaymentCharge, 'type' | 'originalAmount' | 'dueDate'>,
  datedAllocations: DatedAllocationAmount[],
  isSurchargeWaived: boolean,
  surchargeSettings?: SurchargeSettings
): string | null {
  return simulateChargeSettlement(charge, datedAllocations, isSurchargeWaived, surchargeSettings).settledAt;
}

/**
 * Cuánto se puede agregar de forma segura a un cargo en `proposedDate`, sin
 * generar jamás un excedente — considerando TODAS las asignaciones ya
 * registradas, tanto anteriores COMO POSTERIORES a `proposedDate` (una
 * carga retroactiva se inserta en su lugar cronológico real, no al final).
 *
 * Si el cargo ya está saldado usando sólo las asignaciones existentes,
 * la capacidad es 0 (no se admiten asignaciones nuevas sobre algo ya
 * saldado). Si no, la capacidad es el mínimo, sobre cada fecha de "punto de
 * control" (la propia `proposedDate` y la de cada asignación existente que
 * caiga en esa fecha o después), de "lo requerido en esa fecha menos lo ya
 * acumulado hasta esa fecha" — el requerido crece con el recargo, así que
 * el punto más restrictivo puede estar en el futuro (una asignación
 * posterior ya registrada), no necesariamente en `proposedDate` misma.
 *
 * Ejemplo real: cargo de $10.000 (vence 1/7); ya existe una asignación de
 * $6.000 con `paidAt` 20/07 (second_late, requiere $11.500). Insertar
 * $5.000 con `paidAt` 05/07 (on_time, requiere $10.000): la capacidad en
 * 05/07 por sí sola sería $10.000, pero en 20/07 (punto de control
 * posterior) el acumulado sería 6.000 + X y el requerido 11.500 → capacidad
 * ahí es 5.500. El mínimo es 5.500: los $5.000 se aceptan completos y
 * quedan $500 pendientes — nunca se rechaza un pago retroactivo válido sólo
 * por compararlo contra el requerido de su propia fecha.
 *
 * Pura — no muta `existingDatedAllocations`.
 */
export function calculateSafeAllocationCapacity(
  charge: Pick<PaymentCharge, 'type' | 'originalAmount' | 'dueDate'>,
  existingDatedAllocations: DatedAllocationAmount[],
  proposedDate: string,
  isSurchargeWaived: boolean,
  surchargeSettings?: SurchargeSettings
): number {
  const alreadySettled = simulateChargeSettlement(charge, existingDatedAllocations, isSurchargeWaived, surchargeSettings);
  if (alreadySettled.settledAt !== null) return 0;

  const checkpointDates = new Set<string>([proposedDate]);
  existingDatedAllocations.forEach((allocation) => {
    if (allocation.paidAt >= proposedDate) checkpointDates.add(allocation.paidAt);
  });

  let maxSafeAmount = Infinity;
  checkpointDates.forEach((checkpointDate) => {
    const tierValues = resolveTierValuesAt(checkpointDate, surchargeSettings);
    const cumulativeAtOrBeforeCheckpoint = existingDatedAllocations
      .filter((allocation) => allocation.paidAt <= checkpointDate)
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    const requiredAtCheckpoint = isSurchargeWaived
      ? charge.originalAmount
      : charge.originalAmount +
        calculateSurchargeAmount(
          charge.originalAmount,
          determineDueStage(charge.type, charge.dueDate, checkpointDate, tierValues),
          tierValues
        );
    const capacityAtCheckpoint = requiredAtCheckpoint - cumulativeAtOrBeforeCheckpoint;
    maxSafeAmount = Math.min(maxSafeAmount, capacityAtCheckpoint);
  });

  return Math.max(0, maxSafeAmount);
}

/**
 * Reconstruye las asignaciones vigentes de un cargo (no anuladas, con pago
 * no anulado) como pares `{amount, paidAt}` listos para simular. Pura — no
 * muta `allocations` ni `payments`.
 */
export function buildDatedAllocationsForCharge(
  chargeId: string,
  allocations: PaymentAllocation[],
  payments: Payment[]
): DatedAllocationAmount[] {
  const paymentsById = new Map(payments.map((payment) => [payment.id, payment]));
  return allocations
    .filter((allocation) => allocation.chargeId === chargeId)
    .flatMap((allocation) => {
      const payment = paymentsById.get(allocation.paymentId);
      if (!payment || payment.voidedAt !== null) return [];
      return [{ amount: allocation.amount, paidAt: toDateKey(payment.paidAt) }];
    });
}

/**
 * Determina cuándo (si acaso) un cargo quedó completamente saldado,
 * incorporando condonación de recargo si corresponde. Pura.
 */
export function determineSettledDate(
  charge: PaymentCharge,
  allocations: PaymentAllocation[],
  payments: Payment[],
  adjustments: PaymentAdjustment[],
  surchargeSettings?: SurchargeSettings
): string | null {
  const datedAllocations = buildDatedAllocationsForCharge(charge.id, allocations, payments);
  const isWaived = isSurchargeWaivedForCharge(charge.id, adjustments);
  return applyPartialPaymentsByDate(charge, datedAllocations, isWaived, surchargeSettings);
}

/**
 * Estado completo calculado de una obligación a una fecha de evaluación
 * dada. Nunca muta `charge`, `allocations`, `payments` ni `adjustments`.
 *
 * Congelamiento al saldar: una vez que `settledAt` no es null, la etapa, el
 * recargo y el total adeudado se calculan usando SIEMPRE `settledAt` — nunca
 * `evaluationDate`. Evaluar la misma obligación saldada meses después debe
 * dar exactamente el mismo resultado; el paso del tiempo posterior al
 * saldado no puede generar más recargo ni deuda nueva. El saldo de una
 * obligación saldada nunca es positivo: como mucho es cero, o negativo si
 * hubo sobrepago (crédito).
 */
export function calculateChargeState(input: {
  charge: PaymentCharge;
  allocations: PaymentAllocation[];
  payments: Payment[];
  adjustments: PaymentAdjustment[];
  evaluationDate: string;
  /**
   * Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
   * configurables): opcional, default `DEFAULT_SURCHARGE_SETTINGS` (el
   * comportamiento que ya regía antes de esta fase) — todo llamador
   * existente que no lo pase sigue calculando exactamente igual que
   * siempre. Los llamadores reales de UI (`buildStudentPaymentsSummary` y,
   * de ahí en más, todas las pantallas) leen la configuración vigente del
   * store nuevo y la pasan acá.
   */
  surchargeSettings?: SurchargeSettings;
}): ChargeComputedState {
  const { charge, allocations, payments, adjustments, evaluationDate, surchargeSettings } = input;
  const isWaived = isSurchargeWaivedForCharge(charge.id, adjustments);
  const settledAt = determineSettledDate(charge, allocations, payments, adjustments, surchargeSettings);
  const stageEvaluationDate = settledAt ?? evaluationDate;
  // Saldada: `tierValues` se congela con la fecha REAL de saldado (para
  // siempre, sin importar cuántas veces cambie la configuración después).
  // Abierta: se resuelve con HOY (`evaluationDate`), nunca con el período
  // original del cargo — así una deuda vieja sin pagar refleja la
  // configuración vigente en este mismo instante, igual que cualquier otra
  // obligación abierta.
  const tierValues = resolveTierValuesAt(stageEvaluationDate, surchargeSettings);
  const stage = determineDueStage(charge.type, charge.dueDate, stageEvaluationDate, tierValues);
  const surchargeAmount = isWaived ? 0 : calculateSurchargeAmount(charge.originalAmount, stage, tierValues);
  const totalDue = charge.originalAmount + surchargeAmount;
  const paidAmount = calculatePaidAmountForCharge(charge.id, allocations, payments);
  const balance =
    settledAt !== null
      ? Math.min(0, totalDue - paidAmount)
      : calculatePaymentSummary(totalDue, paidAmount).balance;
  const isNotYetDue = settledAt === null && daysBetweenDateKeys(evaluationDate, charge.dueDate) > 0;

  return {
    chargeId: charge.id,
    studentId: charge.studentId,
    originalAmount: charge.originalAmount,
    surchargeAmount,
    totalDue,
    paidAmount,
    balance,
    stage,
    settledAt,
    isSurchargeWaived: isWaived,
    isNotYetDue,
  };
}

/**
 * Recalcula el estado de todas las obligaciones no anuladas a partir de
 * cero, sin mutar ninguna de las colecciones recibidas. Es la función a
 * usar tras cualquier cambio (nuevo pago, anulación, condonación) para
 * obtener un snapshot consistente — nunca se actualiza incrementalmente un
 * estado guardado.
 */
export function recalculateAllChargeStates(input: {
  charges: PaymentCharge[];
  allocations: PaymentAllocation[];
  payments: Payment[];
  adjustments: PaymentAdjustment[];
  evaluationDate: string;
  surchargeSettings?: SurchargeSettings;
}): ChargeComputedState[] {
  return input.charges
    .filter((charge) => charge.voidedAt === null)
    .map((charge) =>
      calculateChargeState({
        charge,
        allocations: input.allocations,
        payments: input.payments,
        adjustments: input.adjustments,
        evaluationDate: input.evaluationDate,
        surchargeSettings: input.surchargeSettings,
      })
    );
}
