import { calculateAssignableForCharge, calculatePaidAmountForCharge, calculateChargeBalance } from "./charge-balance.ts";
import { determineDueStage, isChargeOverdueForDisplay, resolveMonthlyDueDateUrgency, type MonthlyDueDateUrgency } from "./due-stage.ts";
import type { PaymentAllocationLike, PaymentChargeLike } from "./types.ts";

/**
 * Puerto de `buildCollectionsCenterEntries`/`useCollectionsCenter.ts`
 * (móvil): arma las tarjetas reales del Centro de cobros a partir de datos
 * ya persistidos — nunca `FIXTURE_CHARGES`. Recalcula todo desde cero cada
 * vez que se llama (nunca cachea estado propio), igual criterio que el
 * hook móvil. Excluye alumnos no-`activo` de la vista (decisión de
 * REPRESENTACIÓN — su deuda real sigue existiendo, sólo no ocupa lugar acá)
 * y cualquier cargo ya saldado o anulado.
 */
export interface CollectionsCenterEntry {
  chargeId: string;
  studentId: string;
  studentName: string;
  chargeType: PaymentChargeLike["chargeType"];
  dueDate: string;
  originalAmount: number;
  paidAmount: number;
  balance: number;
  isOverdue: boolean;
  urgency: MonthlyDueDateUrgency | null; // sólo mensual/entrenamiento tienen urgencia de vencimiento real
}

const URGENCY_RANK: Record<string, number> = {
  mes_vencido: 0,
  last_late: 0,
  vence_hoy: 1,
  second_late: 1,
  vence_pronto: 2,
  first_late: 2,
  pendiente_en_termino: 3,
  on_time: 3,
};

type CollectionsStudent = { id: string; name: string; status: "activo" | "pausado" | "inactivo" | "archivado" };

/**
 * Núcleo único: arma las tarjetas a partir de cargos y de "cuánto lleva pagado" de cada uno. `paidOf` se llama sólo para
 * los cargos elegibles (vigentes, de alumnos activos). Lo usan las dos entradas públicas de abajo, así que ambas producen
 * exactamente las mismas tarjetas, en el mismo orden.
 */
function buildEntries(
  charges: readonly (PaymentChargeLike & { studentId: string })[],
  paidOf: (charge: PaymentChargeLike & { studentId: string }) => number,
  students: readonly CollectionsStudent[],
  todayDateKey: string,
): CollectionsCenterEntry[] {
  const studentById = new Map(students.map((s) => [s.id, s]));

  const entries: CollectionsCenterEntry[] = [];
  for (const charge of charges) {
    if (charge.voidedAt !== null) continue;
    const student = studentById.get(charge.studentId);
    if (!student || student.status !== "activo") continue; // no elegible para la vista (nunca borra la deuda real).

    const paidAmount = paidOf(charge);
    const balance = calculateChargeBalance(charge, paidAmount);
    if (balance.isFullyPaid) continue;

    const stage = determineDueStage(charge.chargeType, charge.dueDate, todayDateKey);
    const isOverdue = isChargeOverdueForDisplay(charge.chargeType, charge.dueDate, stage, todayDateKey);
    const urgency =
      charge.chargeType === "mensual" || charge.chargeType === "entrenamiento"
        ? resolveMonthlyDueDateUrgency(charge.dueDate, todayDateKey).urgency
        : null;

    entries.push({
      chargeId: charge.id,
      studentId: charge.studentId,
      studentName: student.name,
      chargeType: charge.chargeType,
      dueDate: charge.dueDate,
      originalAmount: charge.originalAmount,
      paidAmount,
      balance: balance.balance,
      isOverdue,
      urgency,
    });
  }

  // Desempate DETERMINISTA (R2): mismo rango y mismo vencimiento (p. ej. todas las mensualidades del día 10) → orden de la lista de
  // alumnos recibida (la web la lee por nombre), que es el orden en que `ensure_monthly_charges` las creó; después, el id.
  // Antes el desempate dependía del orden físico de lectura de la base.
  const studentOrder = new Map(students.map((student, index) => [student.id, index]));
  return entries.sort((a, b) => {
    const rankA = URGENCY_RANK[a.urgency ?? "on_time"] ?? 3;
    const rankB = URGENCY_RANK[b.urgency ?? "on_time"] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    const orderA = studentOrder.get(a.studentId) ?? 0;
    const orderB = studentOrder.get(b.studentId) ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return a.chargeId < b.chargeId ? -1 : a.chargeId > b.chargeId ? 1 : 0;
  });
}

export function buildCollectionsCenterEntries(input: {
  charges: readonly (PaymentChargeLike & { studentId: string })[];
  allocations: readonly PaymentAllocationLike[];
  students: readonly CollectionsStudent[];
  todayDateKey: string;
}): CollectionsCenterEntry[] {
  return buildEntries(input.charges, (charge) => calculatePaidAmountForCharge(charge.id, input.allocations), input.students, input.todayDateKey);
}

/** Un cargo vigente con lo ya pagado (asignaciones de pagos no anulados), tal como lo devuelve `list_open_charge_balances`. */
export interface ChargeWithPaidAmount {
  charge: PaymentChargeLike & { studentId: string };
  paidAmount: number;
}

/**
 * Mismas tarjetas que `buildCollectionsCenterEntries`, pero a partir de los saldos ya calculados en la base (R2): evita
 * descargar toda la historia de cargos, asignaciones y pagos sólo para saber qué se debe. Un cargo sin saldo se descarta
 * igual que antes (`isFullyPaid`), así que pasar de más no cambia el resultado.
 */
export function buildCollectionsCenterEntriesFromBalances(input: {
  balances: readonly ChargeWithPaidAmount[];
  students: readonly CollectionsStudent[];
  todayDateKey: string;
}): CollectionsCenterEntry[] {
  const paidByChargeId = new Map(input.balances.map((b) => [b.charge.id, b.paidAmount]));
  return buildEntries(
    input.balances.map((b) => b.charge),
    (charge) => paidByChargeId.get(charge.id) ?? 0,
    input.students,
    input.todayDateKey,
  );
}

export { calculateAssignableForCharge };
