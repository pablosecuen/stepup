import { toDateKey } from "../payments/dates.ts";
import { dateKeyInRange, type DateRange } from "./period.ts";

/**
 * Puerto SIMPLIFICADO de `buildProgrammedHourlyRateSummary` (móvil,
 * `programmedHourlyRateSummary.ts`) — "valor programado de la hora" usando
 * TODA la agenda del período (nunca sólo lo cobrado), fiel al criterio
 * real: el denominador (horas) sale del calendario completo, nunca de
 * `payment_charges`/`payments`.
 *
 * Diferencia real documentada respecto del móvil (por la complejidad de
 * portar exactamente el prorrateo de `resolveEffectiveBillingAmount` del
 * móvil, que reconstruye el monto esperado de una ocurrencia todavía sin
 * registrar comparando checkpoints de fecha contra el plan vigente de cada
 * alumno): el NUMERADOR (ingreso atribuido) acá se limita a clases YA
 * REGISTRADAS con `billedAmount` real — nunca inventa un monto estimado
 * para una ocurrencia futura/sin registrar. Como consecuencia estructural
 * (no un caso especial agregado a mano), mientras el período tenga
 * ocurrencias todavía sin registrar, el valor-hora resultante queda
 * subestimado respecto del que mostraría el móvil — por eso `isEstimate`
 * se marca `true` en ese caso (además de cuando el rango todavía no
 * cerró), para dejarlo explícito en la UI y no presentar un número
 * definitivo que en realidad es parcial.
 *
 * Una clase cancelada tardíamente pero cobrada (`outcome: 'cancelada_tarde'`)
 * queda excluida a propósito — es un cargo por penalidad, no una hora de
 * trabajo docente (mismo criterio real del móvil).
 */
export interface OccurrenceForHourlyRate {
  scheduledStartAt: string;
  scheduledEndAt: string;
  isCancelled: boolean;
  isRegisteredHeld: boolean;
  billedAmount: number | null;
}

export interface ProgrammedHourlyRateSummary {
  totalProgrammedMinutes: number;
  totalProgrammedHours: number;
  totalRevenueAttributed: number;
  generalRatePerHour: number | null;
  isEstimate: boolean;
}

function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
}

export function buildProgrammedHourlyRateSummary(occurrences: readonly OccurrenceForHourlyRate[], range: DateRange, evaluationDate: string): ProgrammedHourlyRateSummary {
  const inRange = occurrences.filter((o) => !o.isCancelled && dateKeyInRange(toDateKey(o.scheduledStartAt), range.rangeStart, range.rangeEnd));

  const totalProgrammedMinutes = inRange.reduce((sum, o) => sum + durationMinutes(o.scheduledStartAt, o.scheduledEndAt), 0);
  const totalRevenueAttributed = inRange.reduce((sum, o) => sum + (o.isRegisteredHeld ? (o.billedAmount ?? 0) : 0), 0);
  const totalProgrammedHours = totalProgrammedMinutes / 60;
  const generalRatePerHour = totalProgrammedHours > 0 ? totalRevenueAttributed / totalProgrammedHours : null;

  const hasUnregisteredOccurrence = inRange.some((o) => !o.isRegisteredHeld);
  const isEstimate = hasUnregisteredOccurrence || dateKeyInRange(evaluationDate, range.rangeStart, range.rangeEnd) || evaluationDate < range.rangeEnd;

  return { totalProgrammedMinutes, totalProgrammedHours, totalRevenueAttributed, generalRatePerHour, isEstimate };
}
