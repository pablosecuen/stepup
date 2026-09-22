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

export function buildCollectionsCenterEntries(input: {
  charges: readonly (PaymentChargeLike & { studentId: string })[];
  allocations: readonly PaymentAllocationLike[];
  students: readonly { id: string; name: string; status: "activo" | "pausado" | "inactivo" | "archivado" }[];
  todayDateKey: string;
}): CollectionsCenterEntry[] {
  const studentById = new Map(input.students.map((s) => [s.id, s]));

  const entries: CollectionsCenterEntry[] = [];
  for (const charge of input.charges) {
    if (charge.voidedAt !== null) continue;
    const student = studentById.get(charge.studentId);
    if (!student || student.status !== "activo") continue; // no elegible para la vista (nunca borra la deuda real).

    const paidAmount = calculatePaidAmountForCharge(charge.id, input.allocations);
    const balance = calculateChargeBalance(charge, paidAmount);
    if (balance.isFullyPaid) continue;

    const stage = determineDueStage(charge.chargeType, charge.dueDate, input.todayDateKey);
    const isOverdue = isChargeOverdueForDisplay(charge.chargeType, charge.dueDate, stage, input.todayDateKey);
    const urgency =
      charge.chargeType === "mensual" || charge.chargeType === "entrenamiento"
        ? resolveMonthlyDueDateUrgency(charge.dueDate, input.todayDateKey).urgency
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

  return entries.sort((a, b) => {
    const rankA = URGENCY_RANK[a.urgency ?? "on_time"] ?? 3;
    const rankB = URGENCY_RANK[b.urgency ?? "on_time"] ?? 3;
    if (rankA !== rankB) return rankA - rankB;
    return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  });
}

export { calculateAssignableForCharge };
