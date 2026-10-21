/**
 * Recargos pagados del traslado: ¿lo cobrado de más sobre el importe base de un cobro es un RECARGO confirmado por la propia app, o un exceso «pendiente de clasificación»?
 *
 * Coincidir con un porcentaje NO alcanza. La evidencia es el cálculo de la propia app EN LA ÉPOCA del pago: este módulo porta, sin cambiarlo, el motor que regía hasta el 16/09/2026
 * (commit 94ce7be de la app, que lo desactivó): `determineDueStage` (etapas por días desde el vencimiento, umbrales de la configuración de recargos vigente para el período del pago),
 * `calculateSurchargeAmount` (importe base × porcentaje de la etapa, redondeado al entero, sólo con la configuración habilitada) y `simulateChargeSettlement` (las asignaciones se
 * aplican por fecha de pago y el cobro se salda cuando lo acumulado alcanza el importe base MÁS el recargo de ESE día). Una condonación vigente anula el recargo.
 *
 * Reglas de clasificación (nunca se inventa una causa):
 *   - `recargo_confirmado`: el motor de la app, con la configuración del respaldo, da exactamente el recargo que se cobró de más, en el día en que el cobro quedó saldado.
 *   - `pendiente_de_clasificacion`: hay un exceso y el motor NO lo explica (otra etapa, otro monto, configuración deshabilitada, condonado, nunca saldado…): se conserva el exceso tal cual
 *     con su evidencia (lo que el motor calcula en cada fecha) y sin atribuirle causa.
 * El exceso se atribuye a la(s) asignación(es) que lo producen: las asignaciones vigentes (pago no anulado) se ordenan por fecha de pago y la parte que supera el importe base queda en
 * la asignación que la cruza (y en las siguientes). Los importes de pagos, cobros y asignaciones NO se modifican: sólo se separa cuánto de cada asignación es base y cuánto exceso.
 *
 * Puro: sin acceso a datos externos ni reloj.
 */

type Obj = Record<string, unknown>;

export type DueStage = "on_time" | "first_late" | "second_late" | "last_late";

export interface SurchargeTierValues {
  enabled: boolean;
  graceDay: number;
  firstLateDay: number;
  firstLatePercentage: number;
  secondLateDay: number;
  secondLatePercentage: number;
  lastLateDay: number;
  lastLatePercentage: number;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const cents = (v: number): number => Math.round(v * 100);

const DAY_MS = 86_400_000;
const dateKey = (v: string): string => v.slice(0, 10);
const daysBetween = (from: string, to: string): number => {
  const [fy, fm, fd] = dateKey(from).split("-").map(Number);
  const [ty, tm, td] = dateKey(to).split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
};

function readTier(value: unknown): SurchargeTierValues | null {
  if (!isObj(value)) return null;
  const fields = ["graceDay", "firstLateDay", "firstLatePercentage", "secondLateDay", "secondLatePercentage", "lastLateDay", "lastLatePercentage"] as const;
  const out: Record<string, number> = {};
  for (const f of fields) {
    const n = num(value[f]);
    if (n === null) return null;
    out[f] = n;
  }
  return { enabled: value.enabled === true, ...(out as Omit<SurchargeTierValues, "enabled">) };
}

/**
 * Configuración de recargos que regía para un período (`YYYY-MM`), como la persistía la app en la época de los pagos: el cambio pendiente rige desde su período de vigencia.
 * (La app actual además FUERZA `enabled: false`; esa normalización es posterior a los pagos y NO se aplica acá.)
 */
export function tierValuesFor(settings: unknown, billingPeriod: string): SurchargeTierValues | null {
  if (!isObj(settings)) return null;
  const current = readTier(settings.current);
  const pending = readTier(settings.pending);
  const from = str(settings.pendingEffectiveFrom);
  if (pending && from && billingPeriod >= from) return pending;
  return current;
}

/** `determineDueStage` de la app (mensual/entrenamiento/paquete por días desde el vencimiento; por clase/semanal; quincenal). */
export function dueStage(chargeType: string, dueDate: string, evaluationDate: string, tier: SurchargeTierValues): DueStage {
  if (chargeType === "mensual" || chargeType === "entrenamiento" || chargeType === "paquete") {
    const elapsed = daysBetween(dueDate, evaluationDate) + 1;
    if (elapsed <= tier.graceDay) return "on_time";
    if (elapsed < tier.secondLateDay) return "first_late";
    if (elapsed < tier.lastLateDay) return "second_late";
    return "last_late";
  }
  if (chargeType === "quincenal") {
    const elapsed = daysBetween(dueDate, evaluationDate) + 1;
    if (elapsed <= 5) return "on_time";
    if (elapsed <= 8) return "first_late";
    if (elapsed <= 12) return "second_late";
    return "last_late";
  }
  const late = daysBetween(dueDate, evaluationDate);
  if (late <= 0) return "on_time";
  if (late <= 7) return "first_late";
  if (late <= 15) return "second_late";
  return "last_late";
}

/** `calculateSurchargeAmount` de la app ANTERIOR al 16/09/2026: importe × porcentaje de la etapa, redondeado al entero; 0 si la configuración no está habilitada. */
export function historicalSurchargeAmount(originalAmount: number, stage: DueStage, tier: SurchargeTierValues): number {
  if (!tier.enabled) return 0;
  const pct = { on_time: 0, first_late: tier.firstLatePercentage, second_late: tier.secondLatePercentage, last_late: tier.lastLatePercentage }[stage];
  return Math.round(originalAmount * (pct / 100));
}

export type ExcessStatus = "recargo_confirmado" | "pendiente_de_clasificacion";

export interface ExcessAllocation {
  allocationId: string;
  paymentId: string;
  /** Parte de la asignación que supera el importe base (incluida en el monto de la asignación, que no se modifica). */
  excessAmount: number;
}

export interface ChargeExcess {
  chargeId: string;
  baseAmount: number;
  activeTotal: number;
  excessTotal: number;
  status: ExcessStatus;
  allocations: ExcessAllocation[];
  /** Qué calculó la app en cada fecha de pago y por qué se clasificó así. Sólo hechos: ninguna causa inventada. */
  evidence: Obj;
}

export interface ChargeInput {
  id: string;
  type: string;
  originalAmount: number;
  dueDate: string;
  billingPeriod: string | null;
  voidedAt: unknown;
}
export interface AllocationInput {
  id: string;
  chargeId: string;
  paymentId: string;
  amount: number;
}
export interface PaymentInput {
  id: string;
  paidAt: string;
  recordedAt: string | null;
  voidedAt: unknown;
}

/**
 * Para un cobro: ¿las asignaciones vigentes superan el importe base? Si no, `null`. Si sí, atribuye el exceso a las asignaciones que lo producen y lo clasifica con la evidencia del motor
 * de la app. `adjustments` son las condonaciones del cobro (una vigente anula el recargo).
 */
export function classifyChargeExcess(charge: ChargeInput, allocations: readonly AllocationInput[], payments: ReadonlyMap<string, PaymentInput>, hasActiveWaiver: boolean, settings: unknown): ChargeExcess | null {
  const base = cents(charge.originalAmount);
  const active = allocations
    .filter((a) => a.chargeId === charge.id && payments.get(a.paymentId) && payments.get(a.paymentId)?.voidedAt === null)
    .map((a) => ({ a, p: payments.get(a.paymentId) as PaymentInput }))
    .sort((x, y) => (dateKey(x.p.paidAt) < dateKey(y.p.paidAt) ? -1 : dateKey(x.p.paidAt) > dateKey(y.p.paidAt) ? 1 : (x.p.recordedAt ?? "") < (y.p.recordedAt ?? "") ? -1 : (x.p.recordedAt ?? "") > (y.p.recordedAt ?? "") ? 1 : x.a.id < y.a.id ? -1 : x.a.id > y.a.id ? 1 : 0));
  const total = active.reduce((s, { a }) => s + cents(a.amount), 0);
  if (total <= base) return null;

  // Atribución: lo que cada asignación aporta por encima del importe base (por orden cronológico).
  let cumulative = 0;
  const attributed: ExcessAllocation[] = [];
  for (const { a } of active) {
    const amount = cents(a.amount);
    const room = Math.max(0, base - cumulative);
    const over = amount - Math.min(amount, room);
    cumulative += amount;
    if (over > 0) attributed.push({ allocationId: a.id, paymentId: a.paymentId, excessAmount: over / 100 });
  }
  const excess = total - base;

  // Lo que el motor de la app calculó, en la fecha de cada asignación (simulateChargeSettlement).
  const perDate: Obj[] = [];
  let settledAt: string | null = null;
  let settledStage: DueStage | null = null;
  let settledSurcharge: number | null = null;
  let settledExcess = 0;
  let running = 0;
  let confirmedByEngine = false;
  let anyTier = false;
  for (const { a, p } of active) {
    running += cents(a.amount);
    const paidAt = dateKey(p.paidAt);
    const tier = tierValuesFor(settings, paidAt.slice(0, 7));
    if (!tier) {
      perDate.push({ paidAt, tier: "sin configuración de recargos en el respaldo" });
      continue;
    }
    anyTier = true;
    const stage = dueStage(charge.type, charge.dueDate, paidAt, tier);
    const surcharge = hasActiveWaiver ? 0 : cents(historicalSurchargeAmount(charge.originalAmount, stage, tier));
    perDate.push({ paidAt, stage, habilitado: tier.enabled, requeridoSobreBase: surcharge / 100, acumulado: running / 100 });
    if (settledAt === null && running >= base + surcharge) {
      settledAt = paidAt;
      settledStage = stage;
      settledSurcharge = surcharge;
      settledExcess = running - (base + surcharge);
    }
  }
  confirmedByEngine = settledAt !== null && settledExcess === 0 && settledSurcharge !== null && settledSurcharge > 0 && settledSurcharge === excess;

  const evidence: Obj = {
    motor: "cálculo de recargos de TeacherFlow hasta el 16/09/2026 (determineDueStage + calculateSurchargeAmount + simulateChargeSettlement)",
    excesoObservado: excess / 100,
    recargoCalculadoAlSaldar: settledSurcharge === null ? null : settledSurcharge / 100,
    saldadoEl: settledAt,
    etapaAlSaldar: settledStage,
    sobranteTrasElRecargo: settledAt === null ? null : settledExcess / 100,
    condonado: hasActiveWaiver,
    configuracionEncontrada: anyTier,
    porFecha: perDate,
    conclusion: confirmedByEngine ? "El exceso coincide exactamente con el recargo que TeacherFlow anterior calculaba el día en que el cobro quedó saldado." : "El cálculo de TeacherFlow anterior no explica el exceso; se conserva sin atribuirle una causa.",
  };
  return {
    chargeId: charge.id,
    baseAmount: base / 100,
    activeTotal: total / 100,
    excessTotal: excess / 100,
    status: confirmedByEngine ? "recargo_confirmado" : "pendiente_de_clasificacion",
    allocations: attributed,
    evidence,
  };
}

export interface AllocationExcess {
  chargeId: string;
  paymentId: string;
  excessAmount: number;
  status: ExcessStatus;
  evidence: Obj;
}

/**
 * Exceso de TODAS las asignaciones de un respaldo móvil (por id de asignación). Sólo hay entrada para las asignaciones que producen un exceso sobre el importe base de su cobro.
 * Lo comparten el adaptador (para importar) y el comparador (para saber qué debe haber en la web).
 */
export function classifyAllExcesses(doc: Obj): Map<string, AllocationExcess> {
  const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
  const payments = new Map<string, PaymentInput>();
  for (const p of arr(doc.payments)) {
    const id = str(p.id);
    if (id) payments.set(id, { id, paidAt: str(p.paidAt) ?? "", recordedAt: str(p.recordedAt), voidedAt: p.voidedAt ?? null });
  }
  const allocations: AllocationInput[] = [];
  for (const a of arr(doc.paymentAllocations)) {
    const id = str(a.id);
    const amount = num(a.amount);
    if (id && str(a.chargeId) && str(a.paymentId) && amount !== null) allocations.push({ id, chargeId: a.chargeId as string, paymentId: a.paymentId as string, amount });
  }
  const waived = new Set(arr(doc.paymentAdjustments).filter((a) => a.voidedAt === null || a.voidedAt === undefined).map((a) => str(a.chargeId)).filter((x): x is string => x !== null));
  const out = new Map<string, AllocationExcess>();
  for (const c of arr(doc.paymentCharges)) {
    const id = str(c.id);
    const original = num(c.originalAmount);
    const dueDate = str(c.dueDate);
    if (!id || original === null || !dueDate || c.voidedAt) continue;
    const result = classifyChargeExcess({ id, type: str(c.type) ?? str(c.chargeType) ?? "mensual", originalAmount: original, dueDate, billingPeriod: str(c.billingPeriod), voidedAt: c.voidedAt ?? null }, allocations, payments, waived.has(id), doc.surchargeSettings);
    if (!result) continue;
    for (const a of result.allocations) out.set(a.allocationId, { chargeId: id, paymentId: a.paymentId, excessAmount: a.excessAmount, status: result.status, evidence: result.evidence });
  }
  return out;
}
