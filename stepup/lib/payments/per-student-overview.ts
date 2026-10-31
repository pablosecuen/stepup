import { resolveEffectiveMonthlyAmount, resolveStudentBillingPlan, type StudentBillingPlan } from "./billing-plan.ts";
import { matchesStudentSearch } from "../students/search.ts";
import type { PaymentAllocationRecord, PaymentChargeRecord, PaymentRecord, TrainingBillingAgreementRecord } from "../repositories/payments-mapping.ts";

/**
 * «Cobros › Por alumno» (29/10/2026): una vista de CONSULTA que compara, para cada alumno activo, qué tarifa vigente tiene, cuándo pagó por última vez y cuánto
 * saldo tiene pendiente. Puro: no lee ni escribe nada, sólo combina los registros que ya existen.
 *
 * Tres cosas distintas que nunca se mezclan:
 *  - TARIFA VIGENTE: sale del plan del alumno (o del acuerdo de entrenamiento), jamás del importe de un pago;
 *  - PAGO: el último pago no anulado y su importe (o la parte asignada a ese concepto);
 *  - SALDO PENDIENTE: la suma de lo que falta de cada cobro no anulado (importe − asignaciones de pagos no anulados), como en el Centro de cobros.
 *
 * Cada alumno tiene uno o más CONCEPTOS (su plan, uno por acuerdo de entrenamiento y, si cobró con otro plan antes, ese plan anterior). El pago de un concepto es
 * el último cuya asignación cae sobre un cobro de ese concepto; un pago sin ninguna asignación se informa aparte, sin inventarle concepto.
 */

export type PlanFilterKey = "per_class" | "weekly" | "biweekly" | "monthly" | "class_package" | "complimentary" | "training";
export type RatePeriod = "clase" | "semana" | "quincena" | "mes" | "paquete";

/** Orden fijo de las periodicidades: los importes sólo se comparan dentro de la misma. */
export const RATE_PERIOD_ORDER: readonly RatePeriod[] = ["clase", "semana", "quincena", "mes", "paquete"];

export interface ConceptRate {
  amount: number;
  period: RatePeriod;
  /** Sólo paquetes: cantidad de clases incluidas. */
  includedClasses?: number;
}

export interface ConceptPayment {
  paymentId: string;
  /** Fecha de pago tal como está guardada (ordena igual que en la ficha). */
  paidAt: string;
  /** Importe asignado a este concepto (si el pago se repartió, sólo su parte). */
  amount: number;
  /** Importe total del pago registrado. */
  paymentAmount: number;
  /** Pago DECLARADO al dar de alta al alumno / marcar el mes como pagado: no es un ingreso observado. */
  declared: boolean;
}

export interface UnassignedPayment {
  paymentId: string;
  paidAt: string;
  amount: number;
  declared: boolean;
}

export type ConceptKind = "plan" | "previous_plan" | "training";

/**
 * Estado de las obligaciones EXIGIBLES de un concepto (cobros no anulados cuyo vencimiento ya llegó): «due» si queda algo por pagar de ellas (un pago parcial sigue pendiente),
 * «settled» si hay obligaciones exigibles y todas están saldadas, y «neutral» si no hay ninguna (sin cobros generados o sólo cobros futuros): nunca un «pagado» sin obligaciones.
 */
export type ObligationStatus = "settled" | "due" | "neutral";

export interface PerStudentConcept {
  key: string;
  kind: ConceptKind;
  /** Para filtrar por plan; `null` en un plan anterior (ya no rige). */
  planKey: PlanFilterKey | null;
  /** «Mensual», «Por clase», «Paquete de 8 clases», «Entrenamiento», «Plan anterior (por clase)»… */
  label: string;
  /** Entrenamiento: nombre de la serie, si los cobros lo guardan. */
  seriesName: string | null;
  /** Tarifa vigente; `null` si no hay (sin cargo, plan anterior o entrenamiento sin acuerdo vinculado). */
  rate: ConceptRate | null;
  /** Cambio de monto ya programado («desde el próximo mes»). */
  upcomingRate: { amount: number; effectiveFrom: string } | null;
  lastPayment: ConceptPayment | null;
  pendingBalance: number;
  openCharges: number;
  /** Cuánto falta de las obligaciones ya exigibles (no se muestra: sólo decide el estado). */
  dueBalance: number;
  obligation: ObligationStatus;
}

export interface PerStudentRow {
  studentId: string;
  name: string;
  concepts: PerStudentConcept[];
  /** Fecha del último pago real (no anulado) del alumno, tenga o no asignación: es la fecha principal de la fila y ordena por fecha de pago. */
  latestPaidAt: string | null;
  /** Pagos vigentes sin ninguna asignación a un cobro, del más reciente al más antiguo. */
  unassignedPayments: UnassignedPayment[];
  pendingBalance: number;
}

export interface PerStudentInput {
  students: ReadonlyArray<{ id: string; name: string; status: string; billingPlan: unknown; billingType: "por_clase" | "mensual"; price: number }>;
  charges: readonly PaymentChargeRecord[];
  payments: readonly PaymentRecord[];
  allocations: readonly PaymentAllocationRecord[];
  agreements: readonly TrainingBillingAgreementRecord[];
  /** «AAAA-MM» del mes actual (decide qué importe pendiente ya rige). */
  currentPeriod: string;
  /** «AAAA-MM-DD» de hoy: una obligación es exigible si su vencimiento es de hoy o anterior. */
  todayDateKey: string;
}

const PLAN_CHARGE_TYPE = { per_class: "por_clase", weekly: "semanal", biweekly: "quincenal", monthly: "mensual", class_package: "paquete" } as const;
const CHARGE_PLAN_KEY: Record<string, PlanFilterKey> = { por_clase: "per_class", semanal: "weekly", quincenal: "biweekly", mensual: "monthly", paquete: "class_package" };
const PLAN_NAME: Record<PlanFilterKey, string> = { per_class: "por clase", weekly: "semanal", biweekly: "quincenal", monthly: "mensual", class_package: "paquete", complimentary: "sin cargo", training: "entrenamiento" };

const byPaidAtDesc = (a: { paidAt: string; recordedAt?: string; id?: string }, b: { paidAt: string; recordedAt?: string; id?: string }): number => {
  if (a.paidAt !== b.paidAt) return a.paidAt < b.paidAt ? 1 : -1;
  const recordedA = a.recordedAt ?? "";
  const recordedB = b.recordedAt ?? "";
  if (recordedA !== recordedB) return recordedA < recordedB ? 1 : -1;
  return (a.id ?? "") < (b.id ?? "") ? 1 : -1;
};

function planLabel(plan: StudentBillingPlan): string {
  switch (plan.type) {
    case "per_class":
      return "Por clase";
    case "weekly":
      return "Semanal";
    case "biweekly":
      return "Quincenal";
    case "monthly":
      return "Mensual";
    case "class_package":
      return `Paquete de ${plan.includedClasses} ${plan.includedClasses === 1 ? "clase" : "clases"}`;
    case "complimentary":
      return "Sin cargo";
  }
}

function planRate(plan: StudentBillingPlan, currentPeriod: string): { rate: ConceptRate | null; upcoming: PerStudentConcept["upcomingRate"] } {
  switch (plan.type) {
    case "per_class":
      return { rate: { amount: plan.amount, period: "clase" }, upcoming: null };
    case "weekly":
      return { rate: { amount: plan.amount, period: "semana" }, upcoming: null };
    case "biweekly":
      return { rate: { amount: plan.amount, period: "quincena" }, upcoming: null };
    case "monthly": {
      const upcoming = plan.pendingAmount !== undefined && plan.pendingAmountEffectiveFrom && plan.pendingAmountEffectiveFrom > currentPeriod ? { amount: plan.pendingAmount, effectiveFrom: plan.pendingAmountEffectiveFrom } : null;
      return { rate: { amount: resolveEffectiveMonthlyAmount(plan, currentPeriod), period: "mes" }, upcoming };
    }
    case "class_package":
      return { rate: { amount: plan.amount, period: "paquete", includedClasses: plan.includedClasses }, upcoming: null };
    case "complimentary":
      return { rate: null, upcoming: null };
  }
}

function trainingRate(agreement: TrainingBillingAgreementRecord | undefined, currentPeriod: string): { rate: ConceptRate | null; upcoming: PerStudentConcept["upcomingRate"] } {
  if (!agreement) return { rate: null, upcoming: null };
  const from = agreement.pendingMonthlyFeeEffectiveFrom?.slice(0, 7) ?? null;
  const hasPending = agreement.pendingMonthlyFee !== null && from !== null;
  if (hasPending && from <= currentPeriod) return { rate: { amount: agreement.pendingMonthlyFee as number, period: "mes" }, upcoming: null };
  return { rate: { amount: agreement.monthlyFee, period: "mes" }, upcoming: hasPending ? { amount: agreement.pendingMonthlyFee as number, effectiveFrom: from as string } : null };
}

function conceptKeyOfCharge(charge: PaymentChargeRecord): string {
  if (charge.chargeType === "entrenamiento") return charge.trainingBillingAgreementId ? `training:${charge.trainingBillingAgreementId}` : "training:sin-acuerdo";
  return `plan:${charge.chargeType}`;
}

/** Una fila por alumno ACTIVO (los pausados, inactivos y archivados no figuran), en el orden alfabético de siempre. */
export function buildPerStudentRows(input: PerStudentInput): PerStudentRow[] {
  const paymentsById = new Map(input.payments.map((payment) => [payment.id, payment]));
  const chargesById = new Map(input.charges.map((charge) => [charge.id, charge]));
  const agreementsById = new Map(input.agreements.map((agreement) => [agreement.id, agreement]));

  // Asignaciones vigentes (pago no anulado), por pago y por cobro.
  const allocationsByPayment = new Map<string, PaymentAllocationRecord[]>();
  const paidByCharge = new Map<string, number>();
  for (const allocation of input.allocations) {
    const payment = paymentsById.get(allocation.paymentId);
    if (!payment || payment.voidedAt !== null || !(allocation.amount > 0)) continue;
    const list = allocationsByPayment.get(allocation.paymentId) ?? [];
    list.push(allocation);
    allocationsByPayment.set(allocation.paymentId, list);
    paidByCharge.set(allocation.chargeId, (paidByCharge.get(allocation.chargeId) ?? 0) + allocation.amount);
  }

  const chargesByStudent = new Map<string, PaymentChargeRecord[]>();
  for (const charge of input.charges) {
    const list = chargesByStudent.get(charge.studentId) ?? [];
    list.push(charge);
    chargesByStudent.set(charge.studentId, list);
  }
  const paymentsByStudent = new Map<string, PaymentRecord[]>();
  for (const payment of input.payments) {
    if (payment.voidedAt !== null) continue;
    const list = paymentsByStudent.get(payment.studentId) ?? [];
    list.push(payment);
    paymentsByStudent.set(payment.studentId, list);
  }

  const rows: PerStudentRow[] = [];
  for (const student of input.students) {
    if (student.status !== "activo") continue;
    const plan = resolveStudentBillingPlan({ billingPlan: student.billingPlan as StudentBillingPlan | null, billingType: student.billingType, price: student.price });
    const charges = chargesByStudent.get(student.id) ?? [];
    const payments = [...(paymentsByStudent.get(student.id) ?? [])].sort(byPaidAtDesc);

    const planKey: PlanFilterKey = plan.type;
    const planConceptKey = plan.type === "complimentary" ? "plan:complimentary" : `plan:${PLAN_CHARGE_TYPE[plan.type]}`;
    const concepts = new Map<string, PerStudentConcept>();
    const { rate, upcoming } = planRate(plan, input.currentPeriod);
    concepts.set(planConceptKey, { key: planConceptKey, kind: "plan", planKey, label: planLabel(plan), seriesName: null, rate, upcomingRate: upcoming, lastPayment: null, pendingBalance: 0, openCharges: 0, dueBalance: 0, obligation: "neutral" });

    const conceptOfCharge = new Map<string, string>();
    for (const charge of charges) {
      const key = conceptKeyOfCharge(charge);
      conceptOfCharge.set(charge.id, key);
      if (concepts.has(key)) {
        const existing = concepts.get(key);
        if (existing && existing.kind === "training" && charge.trainingSeriesName && !existing.seriesName) existing.seriesName = charge.trainingSeriesName;
        continue;
      }
      if (charge.chargeType === "entrenamiento") {
        const { rate: fee, upcoming: nextFee } = trainingRate(charge.trainingBillingAgreementId ? agreementsById.get(charge.trainingBillingAgreementId) : undefined, input.currentPeriod);
        concepts.set(key, { key, kind: "training", planKey: "training", label: "Entrenamiento", seriesName: charge.trainingSeriesName, rate: fee, upcomingRate: nextFee, lastPayment: null, pendingBalance: 0, openCharges: 0, dueBalance: 0, obligation: "neutral" });
      } else {
        const previousKey = CHARGE_PLAN_KEY[charge.chargeType];
        concepts.set(key, { key, kind: "previous_plan", planKey: null, label: `Plan anterior (${previousKey ? PLAN_NAME[previousKey] : charge.chargeType})`, seriesName: null, rate: null, upcomingRate: null, lastPayment: null, pendingBalance: 0, openCharges: 0, dueBalance: 0, obligation: "neutral" });
      }
    }

    // Saldo pendiente por concepto: lo que falta de cada cobro NO anulado.
    let pendingBalance = 0;
    const exigibleCharges = new Map<string, number>();
    for (const charge of charges) {
      if (charge.voidedAt !== null) continue;
      const exigible = charge.dueDate <= input.todayDateKey;
      if (exigible) exigibleCharges.set(conceptOfCharge.get(charge.id) ?? "", (exigibleCharges.get(conceptOfCharge.get(charge.id) ?? "") ?? 0) + 1);
      const balance = Math.max(0, charge.originalAmount - (paidByCharge.get(charge.id) ?? 0));
      if (balance <= 0) continue;
      const concept = concepts.get(conceptOfCharge.get(charge.id) ?? "");
      if (!concept) continue;
      concept.pendingBalance += balance;
      concept.openCharges += 1;
      if (exigible) concept.dueBalance += balance;
      pendingBalance += balance;
    }
    for (const concept of concepts.values()) concept.obligation = concept.dueBalance > 0 ? "due" : (exigibleCharges.get(concept.key) ?? 0) > 0 ? "settled" : "neutral";

    // Último pago de cada concepto (sólo por asignaciones) y pagos sin asignación.
    const unassignedPayments: UnassignedPayment[] = [];
    for (const payment of payments) {
      const allocations = allocationsByPayment.get(payment.id) ?? [];
      const declared = payment.source === "initial_student_setup";
      const perConcept = new Map<string, number>();
      for (const allocation of allocations) {
        const key = conceptOfCharge.get(allocation.chargeId) ?? (chargesById.get(allocation.chargeId) ? conceptKeyOfCharge(chargesById.get(allocation.chargeId) as PaymentChargeRecord) : null);
        if (!key) continue;
        perConcept.set(key, (perConcept.get(key) ?? 0) + allocation.amount);
      }
      if (perConcept.size === 0) {
        unassignedPayments.push({ paymentId: payment.id, paidAt: payment.paidAt, amount: payment.amount, declared });
        continue;
      }
      for (const [key, amount] of perConcept) {
        const concept = concepts.get(key);
        if (concept && concept.lastPayment === null) concept.lastPayment = { paymentId: payment.id, paidAt: payment.paidAt, amount, paymentAmount: payment.amount, declared };
      }
    }

    // Un plan anterior sólo se muestra si tiene algo que decir (un pago o un saldo): si no, sería ruido.
    const visible = [...concepts.values()].filter((concept) => concept.kind !== "previous_plan" || concept.lastPayment !== null || concept.pendingBalance > 0);
    const ordered = visible.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "plan" ? -1 : b.kind === "plan" ? 1 : a.kind === "training" ? -1 : 1));
    rows.push({ studentId: student.id, name: student.name, concepts: ordered, latestPaidAt: payments[0]?.paidAt ?? null, unassignedPayments, pendingBalance });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || (a.studentId < b.studentId ? -1 : 1));
}

export type PerStudentSort = "nombre" | "nombre_desc" | "tarifa_asc" | "tarifa_desc" | "pago_reciente" | "pago_antiguo";
export const PER_STUDENT_SORTS: readonly PerStudentSort[] = ["nombre", "nombre_desc", "tarifa_asc", "tarifa_desc", "pago_reciente", "pago_antiguo"];
export const PER_STUDENT_PLAN_FILTERS: readonly ("todos" | PlanFilterKey)[] = ["todos", "per_class", "weekly", "biweekly", "monthly", "class_package", "training", "complimentary"];

export interface PerStudentQuery {
  text: string;
  plan: "todos" | PlanFilterKey;
  sort: PerStudentSort;
}

/** Conceptos que rigen hoy (no planes anteriores) y, si hay filtro, sólo los de ese plan. */
function activeConcepts(row: PerStudentRow, plan: PerStudentQuery["plan"]): PerStudentConcept[] {
  return row.concepts.filter((concept) => concept.kind !== "previous_plan" && (plan === "todos" || concept.planKey === plan));
}

/** La tarifa con la que se ordena una fila: la del primer concepto vigente (del plan filtrado, si lo hay) que tenga tarifa. */
export function rowSortRate(row: PerStudentRow, plan: PerStudentQuery["plan"]): ConceptRate | null {
  return activeConcepts(row, plan).find((concept) => concept.rate !== null)?.rate ?? null;
}

/**
 * Busca sobre la lista COMPLETA (con el mismo motor de búsqueda que Alumnos), filtra por plan y ordena. Las tarifas se comparan sólo dentro de la misma periodicidad:
 * se agrupan por periodicidad (clase, semana, quincena, mes, paquete) y recién dentro de cada grupo se ordena por importe; los alumnos sin tarifa van al final. Los
 * alumnos sin pagos van siempre al final al ordenar por fecha de pago.
 */
export function queryPerStudentRows(rows: readonly PerStudentRow[], query: PerStudentQuery): PerStudentRow[] {
  const text = query.text.trim();
  let result = rows.filter((row) => (text === "" || matchesStudentSearch(row.name, text)) && (query.plan === "todos" || activeConcepts(row, query.plan).length > 0));
  const byName = (a: PerStudentRow, b: PerStudentRow) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }) || (a.studentId < b.studentId ? -1 : 1);
  result = [...result];
  switch (query.sort) {
    case "nombre":
      return result.sort(byName);
    case "nombre_desc":
      return result.sort((a, b) => byName(b, a));
    case "tarifa_asc":
    case "tarifa_desc": {
      const sign = query.sort === "tarifa_asc" ? 1 : -1;
      return result.sort((a, b) => {
        const rateA = rowSortRate(a, query.plan);
        const rateB = rowSortRate(b, query.plan);
        if (!rateA || !rateB) return rateA ? -1 : rateB ? 1 : byName(a, b);
        const periodA = RATE_PERIOD_ORDER.indexOf(rateA.period);
        const periodB = RATE_PERIOD_ORDER.indexOf(rateB.period);
        if (periodA !== periodB) return periodA - periodB;
        return sign * (rateA.amount - rateB.amount) || byName(a, b);
      });
    }
    case "pago_reciente":
    case "pago_antiguo": {
      const sign = query.sort === "pago_reciente" ? -1 : 1;
      return result.sort((a, b) => {
        if (!a.latestPaidAt || !b.latestPaidAt) return a.latestPaidAt ? -1 : b.latestPaidAt ? 1 : byName(a, b);
        if (a.latestPaidAt === b.latestPaidAt) return byName(a, b);
        return sign * (a.latestPaidAt < b.latestPaidAt ? -1 : 1);
      });
    }
  }
}

export function ratePeriodLabel(rate: ConceptRate): string {
  switch (rate.period) {
    case "clase":
      return "por clase";
    case "semana":
      return "por semana";
    case "quincena":
      return "por quincena";
    case "mes":
      return "por mes";
    case "paquete":
      return rate.includedClasses ? `por paquete de ${rate.includedClasses} ${rate.includedClasses === 1 ? "clase" : "clases"}` : "por paquete";
  }
}

export const PLAN_FILTER_LABEL: Record<"todos" | PlanFilterKey, string> = {
  todos: "Todos",
  per_class: "Por clase",
  weekly: "Semanal",
  biweekly: "Quincenal",
  monthly: "Mensual",
  class_package: "Paquete",
  training: "Entrenamiento",
  complimentary: "Sin cargo",
};

export const PER_STUDENT_SORT_LABEL: Record<PerStudentSort, string> = {
  nombre: "Nombre (A a Z)",
  nombre_desc: "Nombre (Z a A)",
  tarifa_asc: "Tarifa: de menor a mayor",
  tarifa_desc: "Tarifa: de mayor a menor",
  pago_reciente: "Pago: más reciente primero",
  pago_antiguo: "Pago: más antiguo primero",
};

export function parsePerStudentQuery(params: { q?: string; plan?: string; orden?: string }): PerStudentQuery {
  const plan = PER_STUDENT_PLAN_FILTERS.find((candidate) => candidate === params.plan) ?? "todos";
  const sort = PER_STUDENT_SORTS.find((candidate) => candidate === params.orden) ?? "nombre";
  return { text: (params.q ?? "").slice(0, 80), plan, sort };
}

/** Los parámetros mínimos de la URL: sólo lo que se aparta de lo predeterminado. */
export function buildPerStudentHref(query: PerStudentQuery): string {
  const params = new URLSearchParams();
  if (query.text.trim() !== "") params.set("q", query.text.trim());
  if (query.plan !== "todos") params.set("plan", query.plan);
  if (query.sort !== "nombre") params.set("orden", query.sort);
  const search = params.toString();
  return search ? `/cobros/por-alumno?${search}` : "/cobros/por-alumno";
}

/** Unidad breve de la tarifa: «/ mes», «/ clase»… */
export function ratePeriodShort(rate: ConceptRate): string {
  return `/ ${rate.period}`;
}

/** Etiqueta breve de un concepto cuando el alumno tiene más de uno. Con dos acuerdos de entrenamiento se distingue por el nombre de la serie. */
export function conceptShortLabel(concept: PerStudentConcept, trainingCount: number): string {
  if (concept.kind === "training") return trainingCount > 1 && concept.seriesName ? `Entrenamiento · ${concept.seriesName}` : "Entrenamiento";
  if (concept.kind === "previous_plan") return "Plan anterior";
  switch (concept.planKey) {
    case "per_class":
      return "Clases";
    case "weekly":
      return "Semanal";
    case "biweekly":
      return "Quincenal";
    case "monthly":
      return "Mensual";
    case "class_package":
      return "Paquete";
    default:
      return "Sin cargo";
  }
}

/**
 * Qué muestra «Cobro» (una sola regla, igual para un alumno y para cada uno de sus conceptos, tenga uno o varios):
 *  - «debt»: hay saldo pendiente real (importe de los cobros no anulados menos las asignaciones de pagos no anulados, sumado sin duplicar) → ese total, en rojo;
 *  - «rate»: sin deuda, la tarifa vigente con su unidad; con tilde si lo exigible está saldado, neutra si no hay información suficiente;
 *  - «none»: sin tarifa («Sin cargo» o «—»).
 */
export type CobroDisplay =
  | { kind: "debt"; amount: number }
  | { kind: "rate"; rate: ConceptRate; status: "settled" | "neutral" }
  | { kind: "none"; label: "Sin cargo" | "—"; status: "settled" | "neutral" };

export function cobroDisplayForConcept(concept: PerStudentConcept): CobroDisplay {
  if (concept.pendingBalance > 0) return { kind: "debt", amount: concept.pendingBalance };
  const status = concept.obligation === "settled" ? "settled" : "neutral";
  if (concept.rate) return { kind: "rate", rate: concept.rate, status };
  return { kind: "none", label: concept.planKey === "complimentary" ? "Sin cargo" : "—", status };
}

/**
 * La fila principal: la deuda REAL total del alumno (suma de los saldos de todos sus cargos vigentes: nunca de tarifas, ni de distinta periodicidad) o, sin deuda, la tarifa del primer
 * concepto que la tiene (el plan antes que el entrenamiento) con el estado de ESE concepto: un tilde sólo si su propio cobro está saldado.
 */
export function cobroDisplayForRow(row: PerStudentRow): CobroDisplay {
  if (row.pendingBalance > 0) return { kind: "debt", amount: row.pendingBalance };
  const primary = row.concepts.find((concept) => concept.kind !== "previous_plan" && concept.rate !== null) ?? row.concepts[0];
  return primary ? cobroDisplayForConcept(primary) : { kind: "none", label: "—", status: "neutral" };
}
