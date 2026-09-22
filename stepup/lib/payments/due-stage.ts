import type { PaymentChargeType, PaymentDueStage } from "./types.ts";
import { daysBetweenDateKeys, toDateKey } from "./dates.ts";

/**
 * Escalera de días fija — espeja `DEFAULT_SURCHARGE_TIER_VALUES` (móvil).
 * TeacherFlow Web NUNCA implementa recargos automáticos (decisión de
 * negocio confirmada, commit móvil `94ce7be`): estos umbrales alimentan
 * ÚNICAMENTE la etapa VISUAL de vencimiento (semáforo), nunca un cálculo de
 * dinero — ver `calculateSurchargeAmount` más abajo, que siempre devuelve 0.
 * No configurable desde la web: no existe (ni debe crearse) ninguna tabla,
 * repositorio, acción ni UI de `surcharge_settings` en esta fase.
 */
const DUE_STAGE_TIER = {
  graceDay: 10,
  secondLateDay: 19,
  lastLateDay: 27,
};

/**
 * Mensual/entrenamiento: la etapa depende de en qué día del mes cae la fecha
 * de evaluación, contado desde `dueDate` — 1-10 on_time, 11-18 first_late,
 * 19-26 second_late, 27+ last_late (umbrales fijos, ver DUE_STAGE_TIER).
 */
export function determineMonthlyDueStage(dueDate: string, evaluationDate: string): PaymentDueStage {
  const daysElapsed = daysBetweenDateKeys(toDateKey(dueDate), toDateKey(evaluationDate)) + 1;
  if (daysElapsed <= DUE_STAGE_TIER.graceDay) return "on_time";
  if (daysElapsed < DUE_STAGE_TIER.secondLateDay) return "first_late";
  if (daysElapsed < DUE_STAGE_TIER.lastLateDay) return "second_late";
  return "last_late";
}

/**
 * Por clase: vence el día de la clase. En término (atraso <= 0) on_time; 1-7
 * días first_late; 8-15 second_late; 16+ last_late. Umbrales propios, no
 * configurables — mismo criterio que el móvil.
 */
export function determinePerClassDueStage(dueDate: string, evaluationDate: string): PaymentDueStage {
  const daysLate = daysBetweenDateKeys(toDateKey(dueDate), toDateKey(evaluationDate));
  if (daysLate <= 0) return "on_time";
  if (daysLate <= 7) return "first_late";
  if (daysLate <= 15) return "second_late";
  return "last_late";
}

/**
 * Única función real que decide la etapa de cualquier cargo. `'entrenamiento'`
 * comparte EXACTAMENTE el camino de `'mensual'` (corrección móvil
 * 2026-09-14) — nunca cae en el criterio de clase suelta.
 */
export function determineDueStage(
  chargeType: PaymentChargeType,
  dueDate: string,
  evaluationDate: string,
): PaymentDueStage {
  switch (chargeType) {
    case "mensual":
    case "entrenamiento":
    case "paquete":
      return determineMonthlyDueStage(dueDate, evaluationDate);
    case "quincenal":
    case "semanal":
    case "por_clase":
    default:
      return determinePerClassDueStage(dueDate, evaluationDate);
  }
}

/**
 * Único punto de todo el proyecto donde se "calcula" dinero de recargo —
 * devuelve SIEMPRE 0. TeacherFlow no usa recargos, intereses ni
 * penalizaciones monetarias automáticas (decisión de negocio confirmada).
 * Los parámetros se conservan sólo por simetría con el resto de las firmas
 * de este archivo — nunca se leen.
 */
export function calculateSurchargeAmount(_originalAmount: number, _stage: PaymentDueStage): number {
  return 0;
}

export type MonthlyDueDateUrgency = "pendiente_en_termino" | "vence_pronto" | "vence_hoy" | "mes_vencido";

/** Ventana de aviso previo — 3 días corridos antes del vencimiento efectivo. */
export const DUE_SOON_WINDOW_DAYS = 3;

export interface MonthlyDueDateStatus {
  urgency: MonthlyDueDateUrgency;
  daysUntilDue: number;
  daysOverdue: number;
}

/**
 * Concepto separado de `determineMonthlyDueStage`: mide si una mensualidad
 * está "en término" respecto de SU PROPIA fecha de vencimiento real, sólo
 * para decidir si necesita atención/aviso — nunca cuánto recargo
 * corresponde (que siempre es 0).
 */
export function resolveMonthlyDueDateUrgency(dueDate: string, evaluationDate: string): MonthlyDueDateStatus {
  const daysUntilDue = daysBetweenDateKeys(toDateKey(evaluationDate), toDateKey(dueDate));
  if (daysUntilDue > DUE_SOON_WINDOW_DAYS) {
    return { urgency: "pendiente_en_termino", daysUntilDue, daysOverdue: 0 };
  }
  if (daysUntilDue > 0) {
    return { urgency: "vence_pronto", daysUntilDue, daysOverdue: 0 };
  }
  if (daysUntilDue === 0) {
    return { urgency: "vence_hoy", daysUntilDue: 0, daysOverdue: 0 };
  }
  return { urgency: "mes_vencido", daysUntilDue: 0, daysOverdue: -daysUntilDue };
}

/**
 * Única fuente que decide si un cargo "necesita atención por estar vencido"
 * para presentación (Centro de cobros, ficha del alumno) — nunca para
 * calcular recargo (que no existe). Mensual/entrenamiento usan
 * `resolveMonthlyDueDateUrgency`; el resto conserva `stage !== 'on_time'`.
 */
export function isChargeOverdueForDisplay(
  chargeType: PaymentChargeType,
  dueDate: string,
  stage: PaymentDueStage,
  evaluationDate: string,
): boolean {
  if (chargeType === "mensual" || chargeType === "entrenamiento") {
    return resolveMonthlyDueDateUrgency(dueDate, evaluationDate).urgency === "mes_vencido";
  }
  return stage !== "on_time";
}
