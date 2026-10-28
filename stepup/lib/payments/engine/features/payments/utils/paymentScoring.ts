// Puerto VERBATIM del original (`src/features/payments/utils/paymentScoring.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { ChargeComputedState, PaymentCharge, PaymentDueStage, ScoreCategory, StudentScoringResult } from '../types/index.ts';
import { determineDueStage } from './paymentDueStage.ts';
import { billingPeriodOfDateKey } from './paymentDates.ts';
import { DEFAULT_SURCHARGE_SETTINGS, resolveEffectiveSurchargeTierValues, type SurchargeSettings } from './surchargeSettings.ts';

const SCORE_BY_SETTLEMENT_STAGE: Record<PaymentDueStage, number> = {
  on_time: 100,
  first_late: 75,
  second_late: 50,
  last_late: 25,
};

/**
 * Puntuación de una obligación individual:
 *  - `null` si todavía no venció y no está saldada: no es una obligación
 *    "resuelta" y no debe perjudicar (ni beneficiar) el scoring;
 *  - `0` si ya venció y sigue sin saldarse (deuda vencida);
 *  - 100/75/50/25 según la etapa de vencimiento en la que quedó saldada
 *    (`chargeState.settledAt`), nunca según la etapa actual. La etapa de
 *    saldado se deriva acá mismo (no hay que precalcularla afuera) para
 *    evitar pasar un valor inconsistente con `settledAt`.
 * Pura — no muta `charge` ni `chargeState`.
 */
export function calculateChargeScore(
  charge: Pick<PaymentCharge, 'type' | 'dueDate'>,
  chargeState: ChargeComputedState,
  surchargeSettings?: SurchargeSettings
): number | null {
  // Corrección 2026-08-11 (a pedido de Joaquín — recargos automáticos
  // configurables): "la falta de recargos no elimina el seguimiento de
  // puntualidad: conservar... scoring" — la ETAPA de vencimiento se sigue
  // calculando siempre con los umbrales de días configurados (aunque estén
  // desactivados los recargos monetarios, que sólo afectan `calculateSurchargeAmount`),
  // así que el puntaje de puntualidad nunca deja de reflejar qué tan tarde
  // pagó realmente el alumno.
  //
  // Corrección 2026-08-12: se resuelve por `chargeState.settledAt` (la
  // fecha REAL en que se saldó), nunca por `charge.dueDate` — mismo
  // criterio de congelamiento que `calculateChargeState`. Este bloque sólo
  // corre cuando ya está saldada, así que `settledAt` siempre existe acá.
  if (chargeState.settledAt !== null) {
    const tierValues = resolveEffectiveSurchargeTierValues(
      surchargeSettings ?? DEFAULT_SURCHARGE_SETTINGS,
      billingPeriodOfDateKey(chargeState.settledAt)
    );
    const settledStage = determineDueStage(charge.type, charge.dueDate, chargeState.settledAt, tierValues);
    return SCORE_BY_SETTLEMENT_STAGE[settledStage];
  }
  if (chargeState.isNotYetDue) return null;
  return 0;
}

/** Categoría según el promedio de scoring. */
export function categorizeScore(score: number): ScoreCategory {
  if (score >= 90) return 'excelente';
  if (score >= 75) return 'buena';
  if (score >= 50) return 'irregular';
  return 'riesgo_de_deuda';
}

/**
 * Promedia las obligaciones "resueltas" (score no nulo). Con menos de tres,
 * el historial se considera insuficiente y no se informa un número.
 * Pura — no muta `chargeScores`.
 */
export function calculateStudentScoring(chargeScores: Array<number | null>): StudentScoringResult {
  const resolved = chargeScores.filter((value): value is number => value !== null);
  if (resolved.length < 3) {
    return { score: null, resolvedChargeCount: resolved.length, category: 'historial_insuficiente' };
  }
  const average = resolved.reduce((sum, value) => sum + value, 0) / resolved.length;
  return { score: average, resolvedChargeCount: resolved.length, category: categorizeScore(average) };
}

export interface ScoredChargeForStreak {
  dueDate: string; // YYYY-MM-DD
  score: number | null;
}

/**
 * Cuenta la racha de obligaciones vencidas y sin saldar (score === 0) más
 * reciente, mirando hacia atrás desde la obligación con vencimiento más
 * tardío. Las obligaciones todavía no vencidas (score null) se saltean sin
 * cortar la racha; cualquier score positivo la corta. Pura — no muta
 * `charges`.
 */
export function detectConsecutiveDebtStreak(charges: ScoredChargeForStreak[]): number {
  const sorted = [...charges].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0));
  let streak = 0;
  for (const charge of sorted) {
    if (charge.score === 0) {
      streak += 1;
      continue;
    }
    if (charge.score === null) continue;
    break;
  }
  return streak;
}
