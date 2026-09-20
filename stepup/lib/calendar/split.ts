import { addDaysToDateKey, daysBetweenDateKeys, getDateKeyJsDay } from "./timezone.ts";
import { jsDayToAppWeekday } from "./weekday.ts";
import { generateOccurrences } from "./recurrence-engine.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "./types.ts";

/**
 * Puerto de `splitRecurrenceFromDate` (móvil,
 * `calendarRecurrenceSplit.ts`) — "esta clase y las siguientes": la regla
 * original se trunca (o se cierra, si el corte cae en su propio primer
 * día) y una sucesora nueva toma el patrón desde ahí. Misma validación,
 * mismo criterio de `startDate` (siempre el lunes de esa semana), mismas
 * excepciones `'excluded'` para las sesiones de la semana de arranque de
 * la sucesora que caen ANTES de la fecha efectiva.
 *
 * A diferencia del móvil (AsyncStorage, sin transacciones reales ni ids
 * auto-generados por la base), acá el id de la sucesora lo genera Postgres
 * al insertar — por eso esta función no lo inventa: calcula todo lo demás
 * de forma determinística y `buildExcludedOccurrenceKeys` se llama
 * DESPUÉS de conocer el id real, dentro de la misma transacción (RPC).
 *
 * Idempotencia: en el modelo relacional no hace falta un id determinístico
 * — la identidad de la operación es (`supersedes_recurrence_id`,
 * `effective_from_date`), una unicidad real que el RPC verifica ANTES de
 * insertar (si ya existe una sucesora con esa combinación, la devuelve tal
 * cual, nunca crea una segunda).
 */

function mondayOfWeekContaining(dateKey: string): string {
  const jsDay = getDateKeyJsDay(dateKey);
  const appWeekday = jsDayToAppWeekday(jsDay); // lunes=0..domingo=6
  return addDaysToDateKey(dateKey, -appWeekday);
}

export interface SplitRecurrenceInput {
  originalRecurrenceId: string;
  originalStartDate: string;
  originalEndDate: string | null;
  effectiveDate: string; // YYYY-MM-DD — desde cuándo rige el nuevo patrón
  todayDate: string; // YYYY-MM-DD — congelada por el llamador (asOfIso), nunca "ahora" recalculado acá
}

export interface SplitRecurrencePlan {
  /** Patch para la regla ORIGINAL — nunca se le inventa un endDate anterior a su propio startDate. */
  originalPatch: { status: "active" | "ended"; endDate: string | null };
  /** startDate/endDate reales de la sucesora — endDate hereda el de la original. */
  successorStartDate: string;
  successorEndDate: string | null;
  effectiveFromDate: string;
}

/** Valida y calcula el plan — lanza ante cualquier fecha inválida, igual que el móvil. */
export function planRecurrenceSplit(input: SplitRecurrenceInput): SplitRecurrencePlan {
  if (daysBetweenDateKeys(input.todayDate, input.effectiveDate) < 0) {
    throw new RangeError("No se puede cambiar la serie desde una fecha pasada.");
  }
  if (daysBetweenDateKeys(input.originalStartDate, input.effectiveDate) < 0) {
    throw new RangeError("La fecha efectiva es anterior al inicio de la serie original.");
  }
  if (input.originalEndDate && daysBetweenDateKeys(input.effectiveDate, input.originalEndDate) < 0) {
    throw new RangeError("La fecha efectiva está fuera de la serie original.");
  }

  const originalPatch: SplitRecurrencePlan["originalPatch"] =
    input.originalStartDate < input.effectiveDate
      ? { status: "active", endDate: addDaysToDateKey(input.effectiveDate, -1) }
      : { status: "ended", endDate: input.originalEndDate };

  return {
    originalPatch,
    successorStartDate: mondayOfWeekContaining(input.effectiveDate),
    successorEndDate: input.originalEndDate,
    effectiveFromDate: input.effectiveDate,
  };
}

/**
 * Una vez creada la sucesora (id real ya conocido), calcula qué sesiones de
 * SU PROPIA semana de arranque (siempre lunes) caen ANTES de la fecha
 * efectiva — esas sesiones nunca deben ocurrir, se excluyen con una
 * excepción `'excluded'` por cada una. Vacío si `effectiveDate` ya es el
 * lunes de arranque (nada que excluir).
 */
export function buildExcludedOccurrenceKeys(input: {
  successorRecurrenceId: string;
  successorStartDate: string;
  effectiveDate: string;
  cycleLengthWeeks: number;
  weeks: RecurrenceWeek[];
  modality: RecurrenceRuleForEngine["modality"];
  timezone: string;
  classTitle: string | null;
  activityKind: RecurrenceRuleForEngine["activityKind"];
}): string[] {
  if (input.successorStartDate === input.effectiveDate) return [];

  const hypotheticalRule: RecurrenceRuleForEngine = {
    recurrenceId: input.successorRecurrenceId,
    studentId: null,
    participantIds: [],
    cycleLengthWeeks: input.cycleLengthWeeks,
    weeks: input.weeks,
    modality: input.modality,
    timezone: input.timezone,
    startDate: input.successorStartDate,
    endDate: null,
    status: "active",
    classTitle: input.classTitle,
    activityKind: input.activityKind,
  };

  const rangeStart = new Date(`${input.successorStartDate}T00:00:00.000Z`);
  // effectiveDate exclusivo: la última medianoche ANTES de effectiveDate en UTC crudo
  // alcanza como límite superior generoso — generateOccurrences igual filtra por
  // rango+timezone real; acá sólo se necesita "antes del día efectivo".
  const rangeEndExclusive = new Date(`${input.effectiveDate}T00:00:00.000Z`);
  const preEffective = generateOccurrences(hypotheticalRule, rangeStart, new Date(rangeEndExclusive.getTime() - 1));
  return preEffective.map((occurrence) => occurrence.occurrenceKey);
}
