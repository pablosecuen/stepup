// Puerto VERBATIM del original (`src/features/payments/utils/trainingBilling.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { TrainingBillingAgreement } from '../types/index.ts';
import { isValidBillingPeriod, nextBillingPeriod } from './paymentDates.ts';

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): motor puro de la CONFIGURACIÓN financiera de una serie de
 * entrenamiento (`TrainingBillingAgreement`) — nunca decide candidatos ni
 * genera `PaymentCharge`, eso vive en `trainingChargeGenerationPlan.ts`.
 * Nunca lee ni escribe ningún store.
 */

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * ÚNICA función que decide la cuota mensual EFECTIVA de un acuerdo para un
 * período puntual — mismo criterio que `resolveEffectiveMonthlyAmount`
 * (`student-profile/utils/studentBillingPlan.ts`): un cambio de precio deja
 * `monthlyFee` con el valor VIEJO a propósito hasta que el período facturado
 * alcance `pendingMonthlyFeeEffectiveFrom`. Nunca leer `agreement.monthlyFee`
 * directo para decidir el importe de un período.
 */
export function resolveEffectiveTrainingMonthlyFee(agreement: TrainingBillingAgreement, billingPeriod: string): number {
  if (
    agreement.pendingMonthlyFee !== undefined &&
    agreement.pendingMonthlyFeeEffectiveFrom !== undefined &&
    billingPeriod >= agreement.pendingMonthlyFeeEffectiveFrom
  ) {
    return agreement.pendingMonthlyFee;
  }
  return agreement.monthlyFee;
}

/**
 * Crea la configuración inicial de un acuerdo nuevo — al crear una serie de
 * entrenamiento, al convertir una serie existente, o al configurar la cuota
 * de una serie histórica sin configuración previa. `startPeriod` nunca es
 * anterior al período pedido por el llamador (cada camino de alta decide su
 * propio `startPeriod` según sus propias reglas de "nunca deuda
 * retroactiva" — ver `NewCalendarLessonSheet.tsx`/`CalendarTabScreen.tsx`/
 * la pantalla de configuración de series históricas).
 */
export function buildTrainingBillingAgreement(input: {
  id: string;
  monthlyFee: number;
  startPeriod: string;
  createdAt: string;
}): TrainingBillingAgreement {
  if (!input.id || !input.id.trim()) {
    throw new Error('El acuerdo de cobro necesita una identidad válida.');
  }
  if (!isPositiveFiniteNumber(input.monthlyFee)) {
    throw new RangeError('La cuota mensual del entrenamiento debe ser un número positivo.');
  }
  if (!isValidBillingPeriod(input.startPeriod)) {
    throw new RangeError('El período de inicio debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  return {
    id: input.id,
    monthlyFee: input.monthlyFee,
    startPeriod: input.startPeriod,
    createdAt: input.createdAt,
  };
}

/**
 * Corrección 2026-09-13: cambiar el precio de un acuerdo NUNCA toca
 * `PaymentCharge` alguno — "los cargos ya generados o pagados quedan
 * intactos" es incondicional, nunca depende de si ya existe un cargo para
 * el período actual (a diferencia de `planMonthlyAmountChange`, que sí
 * puede actualizar in place el cargo del mes en curso). El nuevo precio
 * siempre queda pendiente desde el PRÓXIMO período — nunca antes.
 *
 * Corrección 2026-09-14 (a pedido de Joaquín — revisión estructural,
 * "SEGUNDO CAMBIO DE PRECIO"): antes de programar el cambio nuevo, PROMUEVE
 * a `monthlyFee` el importe REALMENTE vigente en `currentBillingPeriod`
 * (`resolveEffectiveTrainingMonthlyFee`, la misma función que ya resuelve
 * "qué precio rige en un período dado" en todo el resto del dominio) — nunca
 * un historial paralelo. Sin esto, programar un SEGUNDO cambio (mientras el
 * primero ya estaba vigente pero todavía no se había "confirmado" en
 * `monthlyFee`) pisaba `pendingMonthlyFeeEffectiveFrom` con la fecha del
 * cambio nuevo, y cualquier período ENTRE el primer cambio ya vigente y el
 * segundo programado volvía a resolver el precio ORIGINAL (anterior al
 * primer cambio) en vez del que realmente regía. Ejemplo real corregido:
 * septiembre $10.000; octubre pasa a $15.000; en noviembre se programa
 * $20.000 para diciembre — noviembre debe seguir viendo $15.000 (nunca
 * $10.000), y esto es exactamente lo que garantiza la promoción acá.
 */
export function planTrainingMonthlyFeeChange(input: {
  agreement: TrainingBillingAgreement;
  newMonthlyFee: number;
  currentBillingPeriod: string; // YYYY-MM, hoy (AR)
}): TrainingBillingAgreement {
  if (!isPositiveFiniteNumber(input.newMonthlyFee)) {
    throw new RangeError('La cuota mensual del entrenamiento debe ser un número positivo.');
  }
  if (!isValidBillingPeriod(input.currentBillingPeriod)) {
    throw new RangeError('El período facturado debe tener el formato YYYY-MM con un mes entre 01 y 12.');
  }
  const promotedMonthlyFee = resolveEffectiveTrainingMonthlyFee(input.agreement, input.currentBillingPeriod);
  return {
    ...input.agreement,
    monthlyFee: promotedMonthlyFee,
    pendingMonthlyFee: input.newMonthlyFee,
    pendingMonthlyFeeEffectiveFrom: nextBillingPeriod(input.currentBillingPeriod),
  };
}
