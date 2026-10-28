import { parseMoneyInput } from "../format/money-input.ts";
import { isValidDateKey } from "./dates.ts";
import { DEFAULT_MONTHLY_DUE_DAY, type StudentBillingPlan } from "./billing-plan.ts";
import { formatMoney } from "../format/number-format.ts";
import { formatCivilDate } from "../format/date-format.ts";

export type BillingPlanType = StudentBillingPlan["type"];

export const PLAN_TYPE_OPTIONS: Array<{ value: BillingPlanType; label: string; description: string }> = [
  { value: "per_class", label: "Por clase", description: "Se pregunta el cobro al registrar cada clase" },
  { value: "weekly", label: "Semanal", description: "Una obligación por semana, cubre todas sus clases" },
  { value: "biweekly", label: "Quincenal", description: "Una obligación cada 14 días, cubre todas sus clases" },
  { value: "monthly", label: "Mensual", description: "Una obligación por mes, cubre todas sus clases" },
  { value: "class_package", label: "Paquete de clases", description: "Compra clases por adelantado, se consumen créditos" },
  { value: "complimentary", label: "Sin cargo", description: "Nunca genera cobros ni preguntas financieras" },
];

export const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

export interface BillingPlanFormValues {
  type: BillingPlanType;
  amountText: string;
  dueWeekday: number;
  anchorDate: string;
  includedClassesText: string;
  validFrom: string;
  validUntil: string;
}

/** Valores iniciales del formulario para un tipo: conserva lo que el plan actual ya tenía (importe, día, referencia, paquete). Puerto de `defaultsForType` (móvil). */
export function initialPlanFormValues(type: BillingPlanType, current: StudentBillingPlan, todayKey: string, amountText: string): BillingPlanFormValues {
  return {
    type,
    amountText,
    dueWeekday: current.type === "weekly" ? current.dueWeekday : 1,
    anchorDate: current.type === "biweekly" ? current.anchorDate : todayKey,
    includedClassesText: current.type === "class_package" ? String(current.includedClasses) : "8",
    validFrom: current.type === "class_package" ? current.validFrom : todayKey,
    validUntil: current.type === "class_package" ? (current.validUntil ?? "") : "",
  };
}

export type BuiltPlan = { plan: StudentBillingPlan } | { error: string };

/**
 * Valida el formulario y arma el plan. Mismas reglas y mensajes que `EditBillingPlanSheet` (móvil): importe exacto y > 0, paquete con clases enteras > 0 y fechas válidas
 * (fin no anterior al inicio), el vencimiento mensual es único (día 10, nunca editable) y el monto de un plan que YA era mensual NO se cambia por acá.
 */
export function buildPlanFromForm(values: BillingPlanFormValues, currentPlan: StudentBillingPlan): BuiltPlan {
  if (values.type === "complimentary") return { plan: { type: "complimentary" } };
  const parsed = parseMoneyInput(values.amountText);
  if ("error" in parsed) return { error: parsed.error };
  const amount = parsed.amount;
  if (!(amount > 0)) return { error: "El importe tiene que ser mayor a cero." };
  switch (values.type) {
    case "per_class":
      return { plan: { type: "per_class", amount } };
    case "weekly":
      return { plan: { type: "weekly", amount, dueWeekday: values.dueWeekday } };
    case "biweekly":
      if (!isValidDateKey(values.anchorDate)) return { error: "Elegí una fecha de referencia válida." };
      return { plan: { type: "biweekly", amount, anchorDate: values.anchorDate } };
    case "monthly":
      if (currentPlan.type === "monthly" && amount !== currentPlan.amount) {
        return { error: "Para cambiar el monto mensual, usá «Modificar monto mensual»: corrige el cargo del mes junto con el plan, sin dejarlos desincronizados." };
      }
      return { plan: { type: "monthly", amount, dueDay: DEFAULT_MONTHLY_DUE_DAY } };
    case "class_package": {
      const includedClasses = Number(values.includedClassesText);
      if (!Number.isInteger(includedClasses) || includedClasses <= 0) return { error: "La cantidad de clases incluidas debe ser un entero mayor a cero." };
      if (!isValidDateKey(values.validFrom)) return { error: "Elegí una fecha de inicio válida." };
      const until = values.validUntil.trim();
      if (until && !isValidDateKey(until)) return { error: "La fecha de fin no es válida (o dejala vacía)." };
      if (until && until < values.validFrom) return { error: "La fecha de fin no puede ser anterior al inicio." };
      return { plan: { type: "class_package", amount, includedClasses, validFrom: values.validFrom, ...(until ? { validUntil: until } : {}) } };
    }
  }
}

/** Texto de resumen del plan vigente para la pestaña Cobros: tipo + importe + datos propios del tipo. */
export function describePlan(plan: StudentBillingPlan): { title: string; lines: string[] } {
  switch (plan.type) {
    case "per_class":
      return { title: "Por clase", lines: [`${formatMoney(plan.amount)} por clase`] };
    case "weekly": {
      const day = WEEKDAY_OPTIONS.find((option) => option.value === plan.dueWeekday)?.label ?? "—";
      return { title: "Semanal", lines: [`${formatMoney(plan.amount)} por semana`, `Vence los ${day}`] };
    }
    case "biweekly":
      return { title: "Quincenal", lines: [`${formatMoney(plan.amount)} cada 14 días`, `Ciclo desde el ${formatCivilDate(plan.anchorDate)}`] };
    case "monthly": {
      const lines = [`${formatMoney(plan.amount)} por mes`, `Vence el día ${plan.dueDay ?? DEFAULT_MONTHLY_DUE_DAY} de cada mes`];
      if (plan.pendingAmount !== undefined && plan.pendingAmountEffectiveFrom) {
        const [year, month] = plan.pendingAmountEffectiveFrom.split("-");
        lines.push(`Desde ${month}/${year}: ${formatMoney(plan.pendingAmount)} por mes`);
      }
      return { title: "Mensual", lines };
    }
    case "class_package":
      return {
        title: "Paquete de clases",
        lines: [`${formatMoney(plan.amount)} por ${plan.includedClasses} clases`, plan.validUntil ? `Vigente del ${formatCivilDate(plan.validFrom)} al ${formatCivilDate(plan.validUntil)}` : `Vigente desde el ${formatCivilDate(plan.validFrom)}`],
      };
    case "complimentary":
      return { title: "Sin cargo", lines: ["No genera cobros ni preguntas financieras"] };
  }
}

const PLAN_CHARGE_TYPE: Partial<Record<BillingPlanType, string>> = { per_class: "por_clase", weekly: "semanal", biweekly: "quincenal", monthly: "mensual" };
const PLAN_CHARGE_TYPES = Object.values(PLAN_CHARGE_TYPE);

export interface PlanTransitionOverlap {
  count: number;
  total: number;
}

/**
 * Cobros vigentes del mes de OTRO tipo de plan que el nuevo plan no reemplaza (se conservan: un cambio de plan nunca borra ni reescribe cargos ni pagos). Si hay alguno, el nuevo plan
 * también generará el suyo para ese período y la profesora debe confirmarlo. Espejo exacto de la regla de `set_student_billing_plan` (que la exige en la base): sólo cuenta cobros por clase, semanales,
 * quincenales y mensuales no anulados con vencimiento en el mes; cambiar al mismo tipo de plan, o a «Paquete»/«Sin cargo», no es una transición.
 */
export function planTransitionOverlap(
  charges: Array<{ chargeType: string; originalAmount: number; dueDate: string; voidedAt: string | null }>,
  currentType: BillingPlanType,
  newType: BillingPlanType,
  currentPeriod: string,
): PlanTransitionOverlap {
  const newChargeType = PLAN_CHARGE_TYPE[newType];
  if (!newChargeType || newType === currentType) return { count: 0, total: 0 };
  const matching = charges.filter((charge) => !charge.voidedAt && PLAN_CHARGE_TYPES.includes(charge.chargeType) && charge.chargeType !== newChargeType && charge.dueDate.slice(0, 7) === currentPeriod);
  return { count: matching.length, total: matching.reduce((sum, charge) => sum + charge.originalAmount, 0) };
}
