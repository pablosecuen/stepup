// Puerto VERBATIM del original (`src/features/payments/services/trainingFirstPeriodRepairService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { CalendarLesson, RecurrenceException, RecurrenceRule } from '../../calendar/types/index.ts';
import type { TeacherAvailability } from '../../calendar/types/teacherAvailability.ts';
import type { MonthlyAmountCorrectionEntry, PaymentsRepositoryState, TrainingBillingAgreement } from '../types/index.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../../calendar/hooks/calendarStore.ts';
import { getTeacherAvailability, hydrateTeacherAvailability } from '../../calendar/hooks/teacherAvailabilityStore.ts';
import { hydrateTrainingBillingAgreements } from '../hooks/trainingBillingAgreementsStore.ts';
import { applyPaymentsMutation, getPaymentsSnapshot, hydratePaymentsStore, type PaymentsStoreController } from '../hooks/paymentsStore.ts';
import { appendMonthlyAmountCorrectionEntry, loadMonthlyAmountCorrectionLog } from '../hooks/monthlyAmountCorrectionLogStore.ts';
import { planTrainingFirstPeriodChargeRepair } from '../utils/trainingChargeGenerationPlan.ts';
import { formatDateKeyDMY } from '../utils/paymentFormat.ts';

/**
 * Corrección 2026-09-17 (a pedido de Joaquín — PRIMER MES PROPORCIONAL DE
 * ENTRENAMIENTOS: cargos ya generados con la regla vieja "si tuvo al menos
 * una ocurrencia, cuota completa" quedan con el importe y el vencimiento
 * equivocados — el caso real reportado es una serie que empieza a mitad de
 * mes): orquesta la reparación pura (`planTrainingFirstPeriodChargeRepair`)
 * contra el store real de pagos — mismo patrón que
 * `firstMonthProrationRepairService.ts`, corre en el arranque/vuelta a
 * primer plano de la app, idempotente y silenciosa (nunca bloquea el
 * arranque). Nunca toca un cargo con pagos/asignaciones reales — esos casos
 * quedan reportados en `needsManualReview` para que la profesora los
 * corrija con trazabilidad (mismo criterio que "Modificar monto mensual").
 *
 * Reutiliza el registro de auditoría YA EXISTENTE de correcciones de monto
 * mensual (`MonthlyAmountCorrectionEntry`/`monthlyAmountCorrectionLogStore.ts`,
 * ya incluido en el respaldo — ver `MONTHLY_AMOUNT_CORRECTION_LOG_BACKUP_KEY`
 * en `backupKeys.ts`) en vez de crear un registro nuevo: su forma (alumno,
 * período, importe anterior/nuevo, motivo) ya describe exactamente esta
 * corrección — nunca un segundo mecanismo de auditoría paralelo.
 *
 * Todas las dependencias reales (store de pagos, calendario, acuerdos,
 * registro de auditoría) son inyectables — mismo patrón que
 * `EnsureFirstMonthProrationDeps` (`firstMonthProrationService.ts`) — para
 * poder probar la orquestación completa con datos en memoria, sin tocar
 * AsyncStorage real.
 */
export type TrainingFirstPeriodRepairStoreDeps = Pick<PaymentsStoreController, 'hydrate' | 'applyMutation'>;

const defaultStoreDeps: TrainingFirstPeriodRepairStoreDeps = {
  hydrate: hydratePaymentsStore,
  applyMutation: applyPaymentsMutation,
};

export interface TrainingFirstPeriodRepairDeps {
  storeDeps?: TrainingFirstPeriodRepairStoreDeps;
  getSnapshot?: () => Pick<PaymentsRepositoryState, 'charges' | 'allocations'>;
  loadRules?: () => Promise<RecurrenceRule[] | null>;
  loadLessons?: () => Promise<CalendarLesson[] | null>;
  loadExceptions?: () => Promise<RecurrenceException[] | null>;
  hydrateAvailability?: () => Promise<TeacherAvailability | null>;
  getAvailability?: () => TeacherAvailability | null;
  loadAgreements?: () => Promise<TrainingBillingAgreement[]>;
  appendAuditEntry?: (entry: MonthlyAmountCorrectionEntry) => Promise<void>;
  /** Corrección 2026-10-04: lectura del registro de auditoría, para no repetir la misma evidencia en cada arranque. */
  loadAuditLog?: () => Promise<MonthlyAmountCorrectionEntry[]>;
}

const defaultDeps: Required<TrainingFirstPeriodRepairDeps> = {
  storeDeps: defaultStoreDeps,
  getSnapshot: getPaymentsSnapshot,
  loadRules: loadRecurrenceRules,
  loadLessons: loadCalendarLessons,
  loadExceptions: loadRecurrenceExceptions,
  hydrateAvailability: hydrateTeacherAvailability,
  getAvailability: getTeacherAvailability,
  loadAgreements: hydrateTrainingBillingAgreements,
  appendAuditEntry: appendMonthlyAmountCorrectionEntry,
  loadAuditLog: loadMonthlyAmountCorrectionLog,
};

export interface TrainingFirstPeriodRepairSummary {
  /** Cargos identificados como primer período con un importe/vencimiento que ya no coincide con la regla canónica. */
  candidatesFound: number;
  /** Corregidos con éxito sobre el mismo cargo estable (sin pagos/asignaciones). */
  repaired: number;
  /** Con pagos/asignaciones reales — nunca tocados en silencio, quedan para revisión manual. */
  needsManualReview: number;
  /** Corrección 2026-10-04: sin fecha de incorporación comprobable — quedan byte-idénticos, con evidencia para revisión. */
  unverifiable: number;
}

export async function runTrainingFirstPeriodChargeRepair(
  now: Date = new Date(),
  deps: TrainingFirstPeriodRepairDeps = {}
): Promise<TrainingFirstPeriodRepairSummary> {
  const resolved: Required<TrainingFirstPeriodRepairDeps> = { ...defaultDeps, ...deps };

  const [rules, lessons, exceptions] = await Promise.all([
    resolved.loadRules(),
    resolved.loadLessons(),
    resolved.loadExceptions(),
    resolved.hydrateAvailability(),
  ]);
  const availability = resolved.getAvailability();
  const agreements = await resolved.loadAgreements();

  await resolved.storeDeps.hydrate();
  const snapshot = resolved.getSnapshot();

  const plan = planTrainingFirstPeriodChargeRepair({
    charges: snapshot.charges,
    allocations: snapshot.allocations,
    agreements,
    rules: rules ?? [],
    exceptions: exceptions ?? [],
    existingLessons: lessons ?? [],
    availability,
  });

  let repaired = 0;
  for (const fix of plan.toFix) {
    let actuallyUpdated = false;
    await resolved.storeDeps.applyMutation((current) => {
      const charge = current.charges.find((item) => item.id === fix.chargeId && item.voidedAt === null);
      if (!charge) return current; // el cargo desapareció/se anuló entre el cálculo y esta mutación: nunca se inventa.
      const hasMovements = current.allocations.some((allocation) => allocation.chargeId === fix.chargeId);
      if (hasMovements) return current; // apareció un pago justo ahora: nunca se toca en silencio.
      if (charge.originalAmount === fix.correctedAmount && charge.dueDate === fix.correctedDueDate) return current; // ya corregido (repetición idempotente).

      actuallyUpdated = true;
      return {
        ...current,
        charges: current.charges.map((item) =>
          item.id === fix.chargeId ? { ...item, originalAmount: fix.correctedAmount, dueDate: fix.correctedDueDate } : item
        ),
      };
    });
    if (!actuallyUpdated) continue;

    repaired += 1;
    const entry: MonthlyAmountCorrectionEntry = {
      id: `training_first_period_repair_${fix.chargeId}_${now.getTime()}`,
      studentId: fix.studentId,
      billingPeriod: fix.billingPeriod,
      previousAmount: fix.previousAmount,
      newAmount: fix.correctedAmount,
      changedAt: now.toISOString(),
      reason:
        fix.previousAmount === fix.correctedAmount
          ? `Reparación estructural: primer período de entrenamiento — vencimiento corregido de ${formatDateKeyDMY(fix.previousDueDate)} a ${formatDateKeyDMY(fix.correctedDueDate)} (importe sin cambios).`
          : `Reparación estructural: primer mes proporcional de entrenamiento (regla canónica de ocurrencias) — vencimiento corregido de ${fix.previousDueDate} a ${fix.correctedDueDate}.`,
    };
    try {
      await resolved.appendAuditEntry(entry);
    } catch (auditError) {
      // Best-effort: la corrección financiera real (cargo corregido) ya se
      // aplicó y persistió con éxito — perder sólo la entrada de auditoría
      // no amerita deshacer una corrección correcta.
      console.error('No se pudo guardar el registro de auditoría de la reparación de primer mes de entrenamiento', auditError);
    }
  }

  // Evidencia segura para revisión (sólo ids, importes y fechas — nunca nombres): una sola entrada por cargo, nunca se
  // repite en cada arranque. Best-effort, igual que el resto de la auditoría.
  try {
    const knownIds = new Set((await resolved.loadAuditLog()).map((entry) => entry.id));
    const amountOf = new Map(snapshot.charges.map((charge) => [charge.id, charge.originalAmount]));
    const evidence: Array<{ chargeId: string; studentId: string; billingPeriod: string; reason: string }> = [
      ...plan.needsReview.map((item) => ({
        chargeId: item.chargeId,
        studentId: item.studentId,
        billingPeriod: item.billingPeriod,
        reason: `Revisión pendiente: el primer período de entrenamiento tiene pagos o asignaciones; se conservó el vencimiento ${formatDateKeyDMY(item.previousDueDate)} (la regla daría ${formatDateKeyDMY(item.correctedDueDate)}).`,
      })),
      ...plan.unverifiable.map((item) => ({
        chargeId: item.chargeId,
        studentId: item.studentId,
        billingPeriod: item.billingPeriod,
        reason: `Revisión pendiente: no se pudo comprobar la fecha de incorporación del primer período de entrenamiento; se conservó el vencimiento ${formatDateKeyDMY(item.currentDueDate)} (el vencimiento global sería ${formatDateKeyDMY(item.globalDueDate)}).`,
      })),
    ];
    for (const item of evidence) {
      const id = `training_first_period_review_${item.chargeId}`;
      if (knownIds.has(id)) continue;
      const amount = amountOf.get(item.chargeId) ?? 0;
      await resolved.appendAuditEntry({ id, studentId: item.studentId, billingPeriod: item.billingPeriod, previousAmount: amount, newAmount: amount, changedAt: now.toISOString(), reason: item.reason });
    }
  } catch (auditError) {
    console.error('No se pudo guardar la evidencia de revisión de la reparación de primer mes de entrenamiento', auditError);
  }

  return {
    candidatesFound: plan.toFix.length + plan.needsReview.length,
    repaired,
    needsManualReview: plan.needsReview.length,
    unverifiable: plan.unverifiable.length,
  };
}
