// Puerto VERBATIM del original (`src/features/payments/utils/perClassChargeGenerationPlan.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson } from '../../new-class/types/index.ts';
import type { PaymentCharge } from '../types/index.ts';
import type { StudentBillingPlan } from '../../student-profile/types/index.ts';
import { resolveStudentBillingPlan, billingPlanAsksPerClass } from '../../student-profile/utils/studentBillingPlan.ts';
import { hasPerClassCharge } from './paymentIdempotency.ts';
import { buildPerClassCharge } from './paymentMutations.ts';

/**
 * Lo mínimo que hace falta saber de un alumno para decidir si le
 * corresponde un cargo por clase. Corrección 2026-07-19 (a pedido de
 * Joaquín — clases pendientes y centro de cobros): ahora resuelve por
 * `StudentBillingPlan` (vía `resolveStudentBillingPlan`), no por el
 * `billingType` binario crudo — un alumno semanal/quincenal/paquete/sin
 * cobro NUNCA genera un cargo por clase individual, exactamente igual que
 * un alumno mensual (su cobro es una obligación por período, no por clase).
 */
export interface StudentBillingLookup {
  billingType: 'mensual' | 'por_clase';
  billingPlan?: StudentBillingPlan;
  price: number;
}

export type PerClassChargeSkipReason =
  | 'alumno_mensual'
  | 'sin_perfil'
  | 'importe_cero'
  | 'grupal_sin_desglose';

export interface PerClassChargeSkipped {
  savedLessonId: string;
  studentId: string;
  reason: PerClassChargeSkipReason;
}

export interface PerClassChargePlan {
  toCreate: PaymentCharge[];
  skipped: PerClassChargeSkipped[];
}

/**
 * Resuelve cuánto le corresponde pagar a CADA alumno de una clase. Nunca
 * inventa una división: si es grupal (más de un alumno) y el registro es
 * anterior a Fase 4B.1 (sin `billedAmountByStudent`), no hay forma segura
 * de saber cuánto le tocaba a cada uno — se reporta para revisión manual
 * en vez de dividir el total en partes iguales. Un registro individual (un
 * solo alumno) puede usar `billedAmount` como compatibilidad aunque le
 * falte el desglose.
 */
function resolveAmountPerStudent(
  lesson: Pick<SavedLesson, 'billedAmount' | 'billedAmountByStudent' | 'form'>
): { amounts: Record<string, number> } | { needsManualReview: true } {
  // No facturable: importe 0 para todos, siempre sin ambigüedad — esto es
  // una decisión de negocio explícita (`isBillable: false`), no un caso de
  // "falta el desglose" que amerite revisión manual.
  if (!lesson.form.isBillable) {
    const amounts: Record<string, number> = {};
    lesson.form.studentIds.forEach((studentId) => {
      amounts[studentId] = 0;
    });
    return { amounts };
  }
  if (lesson.billedAmountByStudent) {
    return { amounts: lesson.billedAmountByStudent };
  }
  if (lesson.form.studentIds.length === 1) {
    const [studentId] = lesson.form.studentIds;
    return { amounts: { [studentId]: lesson.billedAmount ?? 0 } };
  }
  return { needsManualReview: true };
}

/**
 * Decide qué obligaciones "por clase" faltan crear para UNA clase guardada,
 * dado el estado financiero actual. Sólo aplica a alumnos con
 * `billingType: 'por_clase'` (un alumno mensual nunca genera un cargo por
 * clase individual — su cobro es la mensualidad). Nunca crea un cargo en
 * cero. Idempotente por construcción vía `buildPerClassChargeId`. Pura —
 * no muta `lesson` ni `existingCharges`.
 */
export function planPerClassChargesForLesson(input: {
  lesson: SavedLesson;
  getProfile: (studentId: string) => StudentBillingLookup | null;
  existingCharges: PaymentCharge[];
  createdAt: string;
}): PerClassChargePlan {
  const { lesson, getProfile, createdAt } = input;
  const toCreate: PaymentCharge[] = [];
  const skipped: PerClassChargeSkipped[] = [];

  const resolved = resolveAmountPerStudent(lesson);

  lesson.form.studentIds.forEach((studentId) => {
    const profile = getProfile(studentId);
    if (!profile) {
      skipped.push({ savedLessonId: lesson.id, studentId, reason: 'sin_perfil' });
      return;
    }
    if (!billingPlanAsksPerClass(resolveStudentBillingPlan(profile))) {
      skipped.push({ savedLessonId: lesson.id, studentId, reason: 'alumno_mensual' });
      return;
    }
    if ('needsManualReview' in resolved) {
      skipped.push({ savedLessonId: lesson.id, studentId, reason: 'grupal_sin_desglose' });
      return;
    }

    const amount = resolved.amounts[studentId] ?? 0;
    if (!Number.isFinite(amount) || amount <= 0) {
      skipped.push({ savedLessonId: lesson.id, studentId, reason: 'importe_cero' });
      return;
    }

    const chargesSoFar = [...input.existingCharges, ...toCreate];
    if (hasPerClassCharge(studentId, lesson.id, chargesSoFar)) {
      return; // ya existe (persistido o ya planificado en esta misma corrida): idempotente
    }

    toCreate.push(
      buildPerClassCharge({
        studentId,
        savedLessonId: lesson.id,
        dueDate: lesson.form.date,
        originalAmount: amount,
        createdAt,
        existingCharges: chargesSoFar,
        calendarLessonId: lesson.calendarLessonId ?? null,
      })
    );
  });

  return { toCreate, skipped };
}

/**
 * Igual que `planPerClassChargesForLesson`, pero para VARIAS clases —
 * usada tanto por la reconciliación al iniciar la app (barre todas las
 * clases guardadas) como, potencialmente, por lotes puntuales. Acumula los
 * cargos ya planificados de una clase a la siguiente para que la
 * idempotencia funcione dentro de la misma corrida. Pura.
 */
export function planPerClassChargesForLessons(input: {
  lessons: SavedLesson[];
  getProfile: (studentId: string) => StudentBillingLookup | null;
  existingCharges: PaymentCharge[];
  createdAt: string;
}): PerClassChargePlan {
  const toCreate: PaymentCharge[] = [];
  const skipped: PerClassChargeSkipped[] = [];

  input.lessons.forEach((lesson) => {
    const result = planPerClassChargesForLesson({
      lesson,
      getProfile: input.getProfile,
      existingCharges: [...input.existingCharges, ...toCreate],
      createdAt: input.createdAt,
    });
    toCreate.push(...result.toCreate);
    skipped.push(...result.skipped);
  });

  return { toCreate, skipped };
}
