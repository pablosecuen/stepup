/**
 * Puerto de `student-profile/types/index.ts` (unión `StudentBillingPlan`) y
 * `studentBillingPlan.ts` (móvil). El tipo completo se conserva por
 * fidelidad con `students.billing_plan` (jsonb, ya modelado desde Fase 1),
 * pero esta fase sólo GENERA cargos para `'per_class'`/`'monthly'` — los
 * otros tres (`weekly`, `biweekly`, `class_package`) no están en el alcance
 * pedido (no figuran en la lista de motores a portar) y quedan pendientes,
 * documentados en WEB_PARITY_PLAN.md. `'complimentary'` nunca genera
 * obligaciones, en ningún tipo de cargo.
 */
export interface PerClassBillingPlan {
  type: "per_class";
  amount: number;
}

export interface WeeklyBillingPlan {
  type: "weekly";
  amount: number;
  dueWeekday: number;
}

export interface BiweeklyBillingPlan {
  type: "biweekly";
  amount: number;
  anchorDate: string;
}

export interface MonthlyBillingPlan {
  type: "monthly";
  amount: number;
  dueDay: number;
  startPeriod?: string;
  /** Vigencia diferida de un cambio de monto ("aplicar desde el próximo mes"). Ver `resolveEffectiveMonthlyAmount`. */
  pendingAmount?: number;
  pendingAmountEffectiveFrom?: string; // YYYY-MM
}

export interface ClassPackageBillingPlan {
  type: "class_package";
  amount: number;
  includedClasses: number;
  validFrom: string;
  validUntil?: string;
}

export interface ComplimentaryBillingPlan {
  type: "complimentary";
}

export type StudentBillingPlan =
  | PerClassBillingPlan
  | WeeklyBillingPlan
  | BiweeklyBillingPlan
  | MonthlyBillingPlan
  | ClassPackageBillingPlan
  | ComplimentaryBillingPlan;

export const DEFAULT_MONTHLY_DUE_DAY = 10;

/**
 * Única vía canónica para leer el plan de cobro de un alumno. Un alumno sin
 * `billingPlan` explícito nunca se migra escribiendo nada — se deriva en
 * memoria a partir del campo legado `billingType`/`price` (mensual: dueDay
 * por defecto 10; por_clase: cargo por clase).
 */
export function resolveStudentBillingPlan(student: {
  billingPlan: StudentBillingPlan | null;
  billingType: "por_clase" | "mensual";
  price: number;
}): StudentBillingPlan {
  if (student.billingPlan) return student.billingPlan;
  if (student.billingType === "mensual") {
    return { type: "monthly", amount: student.price, dueDay: DEFAULT_MONTHLY_DUE_DAY };
  }
  return { type: "per_class", amount: student.price };
}

/**
 * Única función que sabe resolver cuánto vale la mensualidad de un período
 * puntual. Nunca leer `plan.amount` directo para decidir el importe de un
 * período: un cambio "aplicado desde el próximo mes" deja `amount` con el
 * valor viejo a propósito y guarda el nuevo en `pendingAmount`/
 * `pendingAmountEffectiveFrom` hasta que el período facturado alcance esa
 * vigencia. Comparar dos `billingPeriod` ('YYYY-MM') con `>=` ya da el orden
 * cronológico correcto (mismo ancho fijo).
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
