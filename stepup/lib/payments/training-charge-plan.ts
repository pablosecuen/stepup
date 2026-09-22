import { applyExceptionsToOccurrences, generateOccurrences } from "../calendar/recurrence-engine.ts";
import { getLocalDateKey } from "../calendar/timezone.ts";
import type { CalendarLessonForEngine, RecurrenceExceptionForEngine, RecurrenceRuleForEngine } from "../calendar/types.ts";
import { computeProportionalAmount } from "./proration.ts";

/**
 * Cuenta ocurrencias REALES (nunca canceladas/reprogramadas/excluidas) de
 * una serie dentro de `[rangeStartDateKey, rangeEndDateKey]` (inclusive,
 * fechas locales de la zona de la regla) — equivalente funcional de
 * `countRuleOccurrencesInRange` (móvil), reutilizando el MISMO motor de
 * recurrencia ya portado en Fase 3 (`generateOccurrences`/
 * `applyExceptionsToOccurrences`) en vez de reimplementarlo. El rango de
 * instantes que se le pasa al motor se ensancha 1 día a cada lado (nunca
 * angosto) para no recortar una ocurrencia por el desfasaje de huso horario
 * entre UTC y la zona real de la serie — el filtro definitivo es por FECHA
 * LOCAL ya resuelta (`getLocalDateKey`), no por el instante crudo.
 */
export function countRuleOccurrencesInRange(input: {
  rule: RecurrenceRuleForEngine;
  exceptions: RecurrenceExceptionForEngine[];
  existingLessons: CalendarLessonForEngine[];
  rangeStartDateKey: string;
  rangeEndDateKey: string;
}): number {
  if (input.rangeStartDateKey > input.rangeEndDateKey) return 0;
  const paddedStart = new Date(`${input.rangeStartDateKey}T00:00:00Z`);
  paddedStart.setUTCDate(paddedStart.getUTCDate() - 1);
  const paddedEnd = new Date(`${input.rangeEndDateKey}T00:00:00Z`);
  paddedEnd.setUTCDate(paddedEnd.getUTCDate() + 2);

  const generated = generateOccurrences(input.rule, paddedStart, paddedEnd);
  const withExceptions = applyExceptionsToOccurrences(generated, input.exceptions, input.existingLessons);

  return withExceptions.filter((occurrence) => {
    if (occurrence.materializationStatus === "cancelled" || occurrence.materializationStatus === "rescheduled") return false;
    const localDate = getLocalDateKey(occurrence.start, input.rule.timezone);
    return localDate >= input.rangeStartDateKey && localDate <= input.rangeEndDateKey;
  }).length;
}

export interface CalendarLessonWithRosterForEngine extends CalendarLessonForEngine {
  startAt: string; // ISO instant
  participantIds: string[];
}

/**
 * Puerto real de `resolveEarliestParticipantOccurrenceDateInRange` (móvil,
 * `calendarOccurrenceCounting.ts`) — ÚNICA fuente real de "fecha efectiva de
 * incorporación" de un participante a una serie de entrenamiento. El móvil
 * NUNCA persiste esta fecha como campo propio (ni `joinedAt`, ni
 * `effectiveFromDate` por participante — verificado real contra el código
 * móvil: no existe tal campo) — la recalcula EN VIVO, cada vez, a partir de
 * dos fuentes reales de calendario (nunca de un timestamp técnico de
 * inserción de fila, como `created_at`):
 *   1) Clases YA MATERIALIZADAS (hechos pasados persistidos) donde el
 *      alumno está en el roster real — cuentan SIEMPRE, sin importar el
 *      estado ACTUAL de la regla (aunque hoy esté pausada/finalizada).
 *   2) Ocurrencias VIRTUALES generadas por el motor — sólo existen si la
 *      regla está `'active'` (`generateOccurrences` ya lo garantiza
 *      internamente, nunca hace falta un chequeo aparte acá).
 * Devuelve la fecha (date key local, zona real de la regla) de la ocurrencia
 * MÁS TEMPRANA de cualquiera de las dos fuentes dentro del rango — `null` si
 * no hay ninguna. Como esta fecha SIEMPRE sale de una ocurrencia real (nunca
 * un timestamp arbitrario), el período que resulte de ella SIEMPRE tiene al
 * menos 1 clase real (`classesRemaining >= 1` estructuralmente) — nunca
 * puede dar un primer cargo de $0 por "ya no quedaban ocurrencias".
 */
export function resolveEarliestParticipantOccurrenceDateInRange(input: {
  rule: RecurrenceRuleForEngine;
  studentId: string;
  exceptions: RecurrenceExceptionForEngine[];
  existingLessons: CalendarLessonWithRosterForEngine[];
  rangeStartDateKey: string;
  rangeEndDateKey: string;
}): string | null {
  let earliest: string | null = null;

  // 1) Clases materializadas reales — cuentan siempre, pasado real congelado.
  //    Defensa en profundidad: aunque el llamador pase lecciones de otra regla del
  //    mismo linaje por error, acá se descartan — nunca una ocurrencia de otra regla
  //    puede atribuirse a ésta.
  for (const lesson of input.existingLessons) {
    if (lesson.recurrenceId !== input.rule.recurrenceId) continue;
    if (!lesson.participantIds.includes(input.studentId)) continue;
    const localDate = getLocalDateKey(lesson.startAt, input.rule.timezone);
    if (localDate < input.rangeStartDateKey || localDate > input.rangeEndDateKey) continue;
    if (earliest === null || localDate < earliest) earliest = localDate;
  }

  // 2) Ocurrencias virtuales — sólo si la regla está activa (lo garantiza el motor).
  if (input.rangeStartDateKey <= input.rangeEndDateKey) {
    const paddedStart = new Date(`${input.rangeStartDateKey}T00:00:00Z`);
    paddedStart.setUTCDate(paddedStart.getUTCDate() - 1);
    const paddedEnd = new Date(`${input.rangeEndDateKey}T00:00:00Z`);
    paddedEnd.setUTCDate(paddedEnd.getUTCDate() + 2);

    const generated = generateOccurrences(input.rule, paddedStart, paddedEnd);
    const withExceptions = applyExceptionsToOccurrences(generated, input.exceptions, input.existingLessons);

    for (const occurrence of withExceptions) {
      if (occurrence.materializationStatus === "cancelled" || occurrence.materializationStatus === "rescheduled") continue;
      if (!occurrence.participantIds.includes(input.studentId)) continue;
      const localDate = getLocalDateKey(occurrence.start, input.rule.timezone);
      if (localDate < input.rangeStartDateKey || localDate > input.rangeEndDateKey) continue;
      if (earliest === null || localDate < earliest) earliest = localDate;
    }
  }

  return earliest;
}

export interface TrainingFirstPeriodChargeInput {
  rule: RecurrenceRuleForEngine;
  exceptions: RecurrenceExceptionForEngine[];
  existingLessons: CalendarLessonForEngine[];
  /** YYYY-MM-DD — fecha real de inicio a facturar (start_period de la serie, o de incorporación del alumno). */
  effectiveJoinDate: string;
  monthlyFee: number;
}

export interface TrainingFirstPeriodChargeResult {
  billingPeriod: string;
  dueDate: string; // la propia fecha efectiva de incorporación — nunca el día 10.
  classesRemaining: number;
  classesPerFullPeriod: number;
  amount: number;
}

/**
 * Puerto de `computeTrainingFirstPeriodCharge` (móvil, commit `2ae2994`):
 * reutiliza EXACTAMENTE `computeProportionalAmount` (mismo motor que la
 * mensualidad de clases) — nunca una fórmula paralela. El vencimiento del
 * primer período es la propia fecha efectiva de incorporación, no el día
 * 10 (ese sólo aplica a partir del segundo período).
 */
export function computeTrainingFirstPeriodCharge(input: TrainingFirstPeriodChargeInput): TrainingFirstPeriodChargeResult {
  const billingPeriod = input.effectiveJoinDate.slice(0, 7);
  const periodStart = `${billingPeriod}-01`;
  const periodEndDay = new Date(Date.UTC(Number(billingPeriod.slice(0, 4)), Number(billingPeriod.slice(5, 7)), 0)).getUTCDate();
  const periodEnd = `${billingPeriod}-${String(periodEndDay).padStart(2, "0")}`;

  const classesRemaining = countRuleOccurrencesInRange({
    rule: input.rule,
    exceptions: input.exceptions,
    existingLessons: input.existingLessons,
    rangeStartDateKey: input.effectiveJoinDate > periodStart ? input.effectiveJoinDate : periodStart,
    rangeEndDateKey: periodEnd,
  });
  const classesPerFullPeriod = countRuleOccurrencesInRange({
    rule: input.rule,
    exceptions: input.exceptions,
    existingLessons: input.existingLessons,
    rangeStartDateKey: periodStart,
    rangeEndDateKey: periodEnd,
  });

  return {
    billingPeriod,
    dueDate: input.effectiveJoinDate,
    classesRemaining,
    classesPerFullPeriod,
    amount: computeProportionalAmount(input.monthlyFee, classesRemaining, classesPerFullPeriod),
  };
}

/**
 * Puerto de `resolveEffectiveMonthlyAmount` (móvil) aplicado a
 * `TrainingBillingAgreement` — ÚNICA función que resuelve cuánto vale la
 * cuota de un período puntual. Nunca lee `monthlyFee` directo para decidir
 * el importe de un período: un cambio "aplicado desde el próximo mes" deja
 * `monthlyFee` con el valor VIEJO a propósito (nunca lo muta) y guarda el
 * nuevo en `pendingMonthlyFee`/`pendingMonthlyFeeEffectiveFrom` hasta que el
 * período facturado alcance esa vigencia. Un cargo, una vez generado,
 * congela su `original_amount` para siempre — esta función nunca se vuelve
 * a llamar sobre un período ya facturado, así que un cambio posterior
 * jamás altera cargos históricos.
 */
export function resolveEffectiveTrainingFee(
  agreement: { monthlyFee: number; pendingMonthlyFee: number | null; pendingMonthlyFeeEffectiveFrom: string | null },
  billingPeriod: string,
): number {
  if (
    agreement.pendingMonthlyFee !== null &&
    agreement.pendingMonthlyFeeEffectiveFrom !== null &&
    billingPeriod >= agreement.pendingMonthlyFeeEffectiveFrom
  ) {
    return agreement.pendingMonthlyFee;
  }
  return agreement.monthlyFee;
}

/**
 * Regla de elegibilidad de entrenamiento — MÁS ESTRICTA que
 * `isStudentBillableForPeriod` (mensualidad de clases, que permite facturar
 * hasta el período de la baja inclusive). Para entrenamiento, el móvil usa
 * el estado ACTUAL del alumno, nunca la fecha de baja: un alumno inactivo
 * HOY nunca genera una cuota nueva, ni siquiera para el mes de su propia
 * baja. Un cargo ya generado mientras estaba activo nunca se toca
 * (`ensureTrainingCharges` nunca revisita períodos ya facturados). Una
 * reactivación vuelve a habilitar la candidatura de inmediato, en el
 * próximo período que se genere.
 */
export function isStudentEligibleForTrainingCharge(status: "activo" | "pausado" | "inactivo" | "archivado"): boolean {
  return status === "activo";
}
