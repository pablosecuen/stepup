// Puerto VERBATIM del original (`src/features/payments/utils/buildClassPaymentPromptQueue.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { PaymentCharge, PaymentsRepositoryState } from '../types/index.ts';
import type { StudentBillingLookup } from './perClassChargeGenerationPlan.ts';
import { resolveStudentBillingPlan, billingPlanAsksPerClass } from '../../student-profile/utils/studentBillingPlan.ts';
import { buildDatedAllocationsForCharge } from './paymentCalculations.ts';
import { buildPerClassChargeId } from './paymentIdempotency.ts';

export interface ClassPaymentPromptItem {
  studentId: string;
  studentName: string;
  chargeId: string;
  charge: PaymentCharge;
}

/**
 * Decide a qué alumnos de una clase recién guardada hay que preguntarles
 * "¿cómo quedó el pago?" (Fase Pagos 4B.2). Un alumno entra a la cola sólo
 * si se cumplen TODAS estas condiciones:
 *  - factura `por_clase` (nunca a un alumno mensual — regla 1).
 *  - existe un cargo vigente para esta clase puntual (`chargeId` determinístico
 *    por alumno+clase) — si no existe (clase no facturable, precio inválido,
 *    o la reconciliación financiera falló), no hay nada que preguntar: la
 *    clase ya guardada no se ve afectada.
 *  - ese cargo TODAVÍA no tiene ninguna asignación vigente — si ya tiene una
 *    (de una pregunta anterior ya respondida, por ejemplo al reabrir una
 *    clase ya procesada), no se vuelve a preguntar ni se arriesga a
 *    duplicar un pago (regla 9).
 *
 * Pura — no muta `state` ni ningún parámetro recibido.
 */
export function buildClassPaymentPromptQueue(input: {
  studentIds: string[];
  savedLessonId: string;
  studentNames: Record<string, string>;
  getProfile: (studentId: string) => StudentBillingLookup | null;
  state: PaymentsRepositoryState;
}): ClassPaymentPromptItem[] {
  return input.studentIds.flatMap((studentId): ClassPaymentPromptItem[] => {
    const profile = input.getProfile(studentId);
    if (!profile || !billingPlanAsksPerClass(resolveStudentBillingPlan(profile))) return [];

    const chargeId = buildPerClassChargeId(studentId, input.savedLessonId);
    const charge = input.state.charges.find((item) => item.id === chargeId && item.voidedAt === null);
    if (!charge) return [];

    const existingAllocations = buildDatedAllocationsForCharge(chargeId, input.state.allocations, input.state.payments);
    if (existingAllocations.length > 0) return [];

    return [
      {
        studentId,
        studentName: input.studentNames[studentId] ?? studentId,
        chargeId,
        charge,
      },
    ];
  });
}
