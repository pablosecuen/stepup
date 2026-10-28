// Puerto VERBATIM del original (`src/features/payments/utils/periodicChargeGenerationPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge } from '../types/index.ts';
import { hasPeriodicCharge } from './paymentIdempotency.ts';
import { buildPeriodicCharge } from './paymentMutations.ts';

/**
 * Corrección 2026-07-19 (a pedido de Joaquín — clases pendientes y centro
 * de cobros): generalización de `monthlyChargeGenerationPlan.ts` para
 * `'semanal'`/`'quincenal'` — mismo criterio de idempotencia (alumno,
 * período), mismo tratamiento de precio inválido (se omite, nunca cargo en
 * 0). No toca `monthlyChargeGenerationPlan.ts` (ya probado, sin necesidad
 * de tocarlo).
 *
 * `periodKey`/`dueDate` van POR CANDIDATO (no uno solo para todo el lote)
 * porque en `'semanal'` cada alumno puede tener un `dueWeekday` distinto —
 * misma semana ISO (`periodKey` coincide), pero la fecha de vencimiento
 * dentro de esa semana varía por alumno.
 */
export interface PeriodicChargeCandidateStudent {
  studentId: string;
  amount: number;
  periodKey: string;
  dueDate: string; // YYYY-MM-DD
}

export type PeriodicChargeSkipReason = 'importe_invalido';

export interface PeriodicChargeSkipped {
  studentId: string;
  reason: PeriodicChargeSkipReason;
}

export interface PeriodicChargeGenerationPlan {
  toCreate: PaymentCharge[];
  skipped: PeriodicChargeSkipped[];
}

export function planPeriodicChargeGeneration(input: {
  kind: 'semanal' | 'quincenal';
  candidates: PeriodicChargeCandidateStudent[];
  existingCharges: PaymentCharge[];
  createdAt: string; // ISO
}): PeriodicChargeGenerationPlan {
  const toCreate: PaymentCharge[] = [];
  const skipped: PeriodicChargeSkipped[] = [];

  input.candidates.forEach((student) => {
    if (!Number.isFinite(student.amount) || student.amount <= 0) {
      skipped.push({ studentId: student.studentId, reason: 'importe_invalido' });
      return;
    }

    const chargesSoFar = [...input.existingCharges, ...toCreate];
    if (hasPeriodicCharge(input.kind, student.studentId, student.periodKey, chargesSoFar)) {
      return; // ya existe (persistido o ya planificado en esta misma corrida): idempotente, no es un error
    }

    toCreate.push(
      buildPeriodicCharge({
        kind: input.kind,
        studentId: student.studentId,
        periodKey: student.periodKey,
        dueDate: student.dueDate,
        originalAmount: student.amount,
        createdAt: input.createdAt,
        existingCharges: chargesSoFar,
      })
    );
  });

  return { toCreate, skipped };
}
