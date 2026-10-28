// Puerto VERBATIM del original (`src/features/payments/utils/firstPeriodDueDate.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { FirstMonthProrationDecision } from '../types/index.ts';
import { DEFAULT_MONTHLY_DUE_DAY } from '../../student-profile/utils/studentBillingPlan.ts';
import { firstDayOfBillingPeriod, lastDayOfBillingPeriod, resolveMonthlyDueDate } from './paymentDates.ts';

/**
 * Corrección 2026-10-04 (a pedido de Joaquín — CENTRO DE COBROS: cuotas de
 * entrenamiento del primer período aparecían "Mes vencido" apenas pasaba la
 * fecha de incorporación): ÚNICA fuente del vencimiento del PRIMER período de
 * una obligación mensual proporcional (primer mes proporcional de clases y
 * primer período de una cuota de entrenamiento).
 *
 *   dueDate = max(fecha de incorporación / primera clase, primer vencimiento
 *   global del período ajustado a día hábil)
 *
 * Antes el vencimiento era SIEMPRE la fecha de incorporación: una cuota que
 * empezaba el 02/10 vencía el 02/10 — días antes del vencimiento global
 * (12/10, el día 10 corrido al lunes hábil) y por eso aparecía "vencida" sin
 * haber llegado a la fecha en la que vence todo el resto. Pero tampoco puede
 * volver a ser el día 10 a secas: una incorporación el 19/09 con el día 10 ya
 * pasado vencería antes de la primera clase (el defecto que corrigió el commit
 * `2ae2994`). El máximo cubre las dos cosas: nunca antes de incorporarse,
 * nunca antes del vencimiento global.
 *
 * La fecha de incorporación se recorta al propio período (nunca fuera de él,
 * mismo criterio que `buildMonthlyCharge`/`buildTrainingCharge`). Pura.
 */
export function resolveFirstPeriodDueDate(billingPeriod: string, joinDate: string): string {
  const periodStart = firstDayOfBillingPeriod(billingPeriod);
  const periodEnd = `${billingPeriod}-${String(lastDayOfBillingPeriod(billingPeriod)).padStart(2, '0')}`;
  const clampedJoinDate = joinDate < periodStart ? periodStart : joinDate > periodEnd ? periodEnd : joinDate;
  const globalDueDate = resolveMonthlyDueDate(billingPeriod, DEFAULT_MONTHLY_DUE_DAY);
  return clampedJoinDate > globalDueDate ? clampedJoinDate : globalDueDate;
}

/**
 * Fecha efectiva de incorporación por `chargeId`, tomada de las decisiones de
 * primer mes proporcional (`FirstMonthProrationDecision`). Sólo cuentan las
 * decisiones con cargo real (`chargeId !== null`: `'no_charge'` nunca tiene);
 * si un mismo cargo tiene varias (el historial nunca se sobrescribe), vale la
 * confirmada más recientemente — la misma que dejó el cargo como está. Pura.
 */
export function buildFirstPeriodJoinDateByChargeId(
  decisions: readonly Pick<FirstMonthProrationDecision, 'chargeId' | 'effectiveJoinDate' | 'confirmedAt'>[]
): Map<string, string> {
  const latest = new Map<string, Pick<FirstMonthProrationDecision, 'chargeId' | 'effectiveJoinDate' | 'confirmedAt'>>();
  decisions.forEach((decision) => {
    if (!decision.chargeId) return;
    const current = latest.get(decision.chargeId);
    if (!current || decision.confirmedAt >= current.confirmedAt) latest.set(decision.chargeId, decision);
  });
  return new Map(Array.from(latest.entries()).map(([chargeId, decision]) => [chargeId, decision.effectiveJoinDate]));
}
