// Puerto VERBATIM del original (`src/features/student-profile/utils/studentBillingPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { MonthlyBillingPlan, StudentBillingPlan, StudentProfile } from '../types/index.ts';

/**
 * Corrección 2026-09-02 (a pedido de Joaquín — ERROR FINANCIERO: mensualidad
 * generada con vencimiento el día 1 en vez del día real configurado): el
 * vencimiento real de la profesora es el día 10 — nunca se aplicó antes
 * porque `dueDay` existía en el tipo y en la UI de edición del plan, pero
 * ninguna generación de cargo lo leía (`firstDayOfBillingPeriod` hardcodeaba
 * el día 1). El default para un perfil viejo sin `billingPlan` explícito
 * pasa de 1 a 10 — ÚNICA fuente de este default, consumida por toda
 * generación/consulta de vencimiento mensual real (`resolveMonthlyDueDate`,
 * `monthlyChargeGenerationPlan.ts`, `monthlyPeriodStatus.ts`). Los cargos YA
 * generados con el día 1 viejo se corrigen aparte, con una reparación
 * idempotente (`planMonthlyDueDateRepair`) — este cambio de default sólo
 * afecta cargos NUEVOS y vistas previas ("todavía no generado").
 */
export const DEFAULT_MONTHLY_DUE_DAY = 10;

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): ÚNICA vía canónica para leer el plan de cobro de un alumno.
 * Nunca lee `billingType` directamente fuera de acá (salvo la migración
 * misma). Un perfil viejo sin `billingPlan` explícito nunca se migra
 * escribiendo nada — se deriva en memoria (mensual: `dueDay` por defecto,
 * ver `DEFAULT_MONTHLY_DUE_DAY`; por_clase: cargo por clase). Sólo cuando la
 * profesora edita el plan desde el perfil se persiste `billingPlan`
 * explícito — ver `docs de la Parte B`.
 */
export function resolveStudentBillingPlan(
  profile: Pick<StudentProfile, 'billingPlan' | 'billingType' | 'price'>
): StudentBillingPlan {
  if (profile.billingPlan) return profile.billingPlan;
  if (profile.billingType === 'mensual') {
    return { type: 'monthly', amount: profile.price, dueDay: DEFAULT_MONTHLY_DUE_DAY };
  }
  return { type: 'per_class', amount: profile.price };
}

/**
 * Corrección 2026-08-05 (a pedido de Joaquín — corregir definitivamente el
 * flujo financiero mensual): ÚNICA función que sabe resolver cuánto vale la
 * mensualidad de un `billingPeriod` puntual. Nunca leer `plan.amount`
 * directo para decidir el importe de un período — un cambio "aplicado desde
 * el próximo mes" deja `amount` con el valor VIEJO a propósito (para no
 * alterar el período actual ni ninguno anterior) y guarda el nuevo importe
 * en `pendingAmount`/`pendingAmountEffectiveFrom` hasta que el período
 * facturado alcance esa vigencia. Comparar dos `billingPeriod` ('YYYY-MM')
 * con `>=` ya da el orden cronológico correcto (mismo ancho fijo). Pura.
 */
export function resolveEffectiveMonthlyAmount(plan: MonthlyBillingPlan, billingPeriod: string): number {
  if (
    plan.pendingAmount !== undefined &&
    plan.pendingAmountEffectiveFrom !== undefined &&
    billingPeriod >= plan.pendingAmountEffectiveFrom
  ) {
    return plan.pendingAmount;
  }
  return plan.amount;
}

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — BUG P1: la tarjeta "Pendiente
 * en término" mostraba el precio viejo por clase mientras "Marcar mes actual
 * como pagado" ya proponía el importe mensual nuevo correcto): ÚNICA función
 * que debe usarse para mostrar "cuánto paga este alumno ahora", para
 * cualquier tipo de plan. Nunca leer `profile.price` ni `plan.amount`
 * directo para presentar un importe en pantalla — `price` es sólo el precio
 * histórico de referencia (ver `StudentProfile.price`) y `plan.amount`, en un
 * plan mensual, puede estar retrasado a propósito por un cambio "desde el
 * próximo mes" (`resolveEffectiveMonthlyAmount`). Un plan sin cargo (`'complimentary'`)
 * no tiene importe: devuelve 0, para que el llamador decida no mostrar ningún monto.
 */
export function resolveEffectiveBillingAmount(plan: StudentBillingPlan, billingPeriod: string): number {
  if (plan.type === 'complimentary') return 0;
  if (plan.type === 'monthly') return resolveEffectiveMonthlyAmount(plan, billingPeriod);
  return plan.amount;
}

/** true si este plan puede generar la pregunta financiera clase por clase ("Cobro de esta clase"). */
export function billingPlanAsksPerClass(plan: StudentBillingPlan): boolean {
  return plan.type === 'per_class';
}

/** true si este plan nunca debe generar cargos ni afectar el scoring. */
export function isComplimentaryPlan(plan: StudentBillingPlan): boolean {
  return plan.type === 'complimentary';
}

// ---------------------------------------------------------------------------
// Corrección 2026-09-03 (a pedido de Joaquín — ERROR FINANCIERO: algunos
// alumnos "Vencido", otros "Pendiente", el 03/09/2026): la corrección
// anterior (2026-09-02) hizo que la generación de cargos SÍ respetara
// `MonthlyBillingPlan.dueDay` — pero dos fuentes seguían escribiendo
// `dueDay: 1` como default TÉCNICO (nunca una elección real de la
// profesora) en el plan ya PERSISTIDO del alumno. En esa ronda se normalizó
// sólo `dueDay === 1`, preservando cualquier otro valor (2-28) como si fuera
// una elección legítima de la profesora, alumno por alumno.
//
// Corrección P0 2026-09-05 (VALIDACIÓN FÍSICA FALLIDA — VENCIMIENTOS
// INCONSISTENTES, regla definitiva confirmada por la profesora): esa
// preservación era la causa de la inconsistencia real observada el
// 05/09/2026 (un alumno mostraba "Vence hoy" cuando ningún mensual de
// septiembre debía vencer todavía). **No existen vencimientos mensuales
// distintos por alumno** — todos los planes mensuales comparten una única
// fecha ordinaria, `DEFAULT_MONTHLY_DUE_DAY` (día 10, con ajuste a día hábil
// si cae fin de semana). Ningún `dueDay` persistido distinto de
// `DEFAULT_MONTHLY_DUE_DAY` — sea 1, 2-9, u 11-28 — representa una excepción
// válida para esta profesora: todos se normalizan por igual. Esto reemplaza
// por completo la decisión anterior de preservar 2-28.
// ---------------------------------------------------------------------------

export interface MonthlyBillingPlanDueDayNormalizationAction {
  studentId: string;
  previousDueDay: number;
  newDueDay: number;
}

/**
 * Pura: dado un plan de cobro ya resuelto (`profile.billingPlan` explícito
 * únicamente — nunca se llama con un plan derivado, que ya nace en el
 * vencimiento global), dice si necesita normalizarse. Nunca toca
 * `amount`/`pendingAmount`/`pendingAmountEffectiveFrom`/`startPeriod`: sólo
 * `dueDay`. Cualquier `dueDay` distinto de `DEFAULT_MONTHLY_DUE_DAY` se
 * normaliza — no hay vencimiento individual válido para un plan mensual.
 */
export function planMonthlyBillingPlanDueDayNormalization(input: {
  studentId: string;
  billingPlan: StudentBillingPlan | undefined;
}): { action: MonthlyBillingPlanDueDayNormalizationAction; normalizedPlan: MonthlyBillingPlan } | null {
  const { billingPlan } = input;
  if (!billingPlan || billingPlan.type !== 'monthly') return null;
  if (billingPlan.dueDay === DEFAULT_MONTHLY_DUE_DAY) return null;
  return {
    action: { studentId: input.studentId, previousDueDay: billingPlan.dueDay, newDueDay: DEFAULT_MONTHLY_DUE_DAY },
    normalizedPlan: { ...billingPlan, dueDay: DEFAULT_MONTHLY_DUE_DAY },
  };
}
