// Puerto VERBATIM del original (`src/features/payments/services/firstMonthProrationReviewService.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { getStudentProfile } from '../../student-profile/hooks/useStudentProfile.ts';
import { resolveStudentBillingPlan, resolveEffectiveMonthlyAmount } from '../../student-profile/utils/studentBillingPlan.ts';
import { getPaymentsSnapshot } from '../hooks/paymentsStore.ts';
import { buildMonthlyChargeId } from '../utils/paymentIdempotency.ts';
import { billingPeriodOfDateKey } from '../utils/paymentDates.ts';
import { planFirstMonthProration, resolveEffectiveFirstMonthJoinDate, type FirstMonthProrationSuggestion } from '../utils/firstMonthProration.ts';
import { loadCalendarLessons, loadRecurrenceExceptions, loadRecurrenceRules } from '../../calendar/hooks/calendarStore.ts';
import { getTeacherAvailability } from '../../calendar/hooks/teacherAvailabilityStore.ts';
import { collectActiveSeriesForStudent } from '../../calendar/utils/firstMonthProrationCandidates.ts';

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional, sección "Datos
 * existentes"): NUNCA recalcula masivamente a alumnos anteriores — esto
 * sólo evalúa a UN alumno puntual, bajo pedido explícito de la profesora
 * (botón "Revisar primer mes proporcional" en Cobros), y sólo aplica algo
 * si ella confirma el panel real (`confirmFirstMonthProration`). Candidato
 * real únicamente si las condiciones se cumplen a la vez: plan mensual, al
 * menos una serie recurrente activa donde participe, cargo del período
 * calculado sin ningún pago ni asignación, y todavía sin historial mensual
 * anterior (nunca "revisa" a un alumno que ya tuvo actividad mensual real
 * antes — eso no es su primer mes).
 *
 * CORRECCIÓN P0 DEFINITIVA (a pedido de Joaquín — primer mes proporcional
 * automático): la fecha efectiva ya NO usa `profile.dateJoined` (fecha de
 * alta del alumno en la app, que puede no coincidir con el día real de su
 * primera clase) — usa `resolveEffectiveFirstMonthJoinDate`, la misma
 * regla central que la detección automática y la reparación, basada en el
 * inicio real de sus series activas.
 */
export async function findFirstMonthProrationReviewCandidate(
  studentId: string
): Promise<FirstMonthProrationSuggestion | null> {
  const profile = getStudentProfile(studentId);
  if (!profile || profile.status !== 'activo') return null;

  const plan = resolveStudentBillingPlan(profile);
  if (plan.type !== 'monthly') return null;

  const [recurrenceRules, lessons, exceptions] = await Promise.all([
    loadRecurrenceRules(),
    loadCalendarLessons(),
    loadRecurrenceExceptions(),
  ]);
  const activeSeries = collectActiveSeriesForStudent(studentId, recurrenceRules ?? []);
  if (activeSeries.length === 0) return null; // "serie recurrente" — sin ninguna activa, no hay nada que revisar acá.

  const effectiveJoinDate = resolveEffectiveFirstMonthJoinDate({
    activeSeries,
  });
  if (!effectiveJoinDate) return null;
  const billingPeriod = billingPeriodOfDateKey(effectiveJoinDate);

  const paymentsSnapshot = getPaymentsSnapshot();
  const hasPriorMonthlyHistory = paymentsSnapshot.charges.some(
    (charge) =>
      charge.studentId === studentId &&
      charge.type === 'mensual' &&
      charge.voidedAt === null &&
      !!charge.billingPeriod &&
      charge.billingPeriod < billingPeriod
  );
  if (hasPriorMonthlyHistory) return null; // ya tuvo actividad mensual real antes: no es su primer mes.

  const chargeId = buildMonthlyChargeId(studentId, billingPeriod);
  const existingCharge = paymentsSnapshot.charges.find((charge) => charge.id === chargeId && charge.voidedAt === null);
  if (existingCharge) {
    const hasMovements = paymentsSnapshot.allocations.some((allocation) => allocation.chargeId === chargeId);
    if (hasMovements) return null; // ya tiene pagos/asignaciones: nunca se ofrece recalcular en silencio acá.
  }

  const monthlyAmount = resolveEffectiveMonthlyAmount(plan, billingPeriod);
  return planFirstMonthProration({
    studentId,
    monthlyAmount,
    effectiveJoinDate,
    activeSeries,
    exceptions: exceptions ?? [],
    existingLessons: lessons ?? [],
    availability: getTeacherAvailability(),
  });
}
