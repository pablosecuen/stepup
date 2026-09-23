import { toDateKey } from "../payments/dates.ts";
import { dateKeyInRange, type DateRange } from "./period.ts";

/**
 * Puerto de `buildAnnualActivitySummary`/`buildModalitySummary` (móvil,
 * `annualActivitySummary.ts`) — horas dictadas/canceladas/reprogramadas y
 * distribución por modalidad. Una clase GRUPAL cuenta una sola vez (por
 * registro, nunca por alumno/participante) — el registro que se pasa acá
 * ya es "uno por clase dictada", nunca "uno por alumno de la clase", así
 * que esto se cumple automáticamente por construcción del input (mismo
 * criterio documentado en el móvil, `annualActivitySummary.ts:12-13`).
 *
 * Diferencia real documentada respecto del móvil: el modelo web no porta
 * el outcome `alumno_ausente` (el propio móvil ya lo había retirado del
 * selector real de resultado en una ronda previa de Fase 4 — nunca fue
 * parte del alcance real a portar) — la categoría de cancelación
 * equivalente simplemente no existe acá tampoco.
 */
export interface RegistrationForAnnualActivity {
  countsAsClass: boolean;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  outcome: string;
  modality: string | null;
  calendarLessonId: string | null;
  id: string;
}

function durationMinutes(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
}

function inRange(registration: RegistrationForAnnualActivity, range: DateRange): boolean {
  const anchor = registration.scheduledStartAt ?? registration.actualStartedAt;
  if (!anchor) return false;
  return dateKeyInRange(toDateKey(anchor), range.rangeStart, range.rangeEnd);
}

export interface CancelledBreakdown {
  conAviso: number;
  tardia: number;
  profesoraAusente: number;
  feriado: number;
}

export interface AnnualActivitySummary {
  heldClassesCount: number;
  heldMinutes: number;
  rescheduledReservationsCount: number;
  rescheduledMinutes: number;
  rescheduledChangeCount: number;
  cancelledMinutesByReason: CancelledBreakdown;
  cancelledCountByReason: CancelledBreakdown;
}

export function buildAnnualActivitySummary(registrations: readonly RegistrationForAnnualActivity[], range: DateRange): AnnualActivitySummary {
  const inRangeRegistrations = registrations.filter((r) => inRange(r, range));

  const held = inRangeRegistrations.filter((r) => r.countsAsClass);
  const heldMinutes = held.reduce((sum, r) => sum + (durationMinutes(r.actualStartedAt, r.actualEndedAt) || durationMinutes(r.scheduledStartAt, r.scheduledEndAt)), 0);

  const rescheduled = inRangeRegistrations.filter((r) => r.outcome === "reprogramada");
  const reservationMinutes = new Map<string, number>();
  rescheduled.forEach((r) => {
    const key = r.calendarLessonId ?? r.id;
    if (!reservationMinutes.has(key)) {
      reservationMinutes.set(key, durationMinutes(r.scheduledStartAt, r.scheduledEndAt));
    }
  });

  const cancelled = inRangeRegistrations.filter((r) => !r.countsAsClass && r.outcome !== "reprogramada");
  const cancelledMinutesByReason: CancelledBreakdown = { conAviso: 0, tardia: 0, profesoraAusente: 0, feriado: 0 };
  const cancelledCountByReason: CancelledBreakdown = { conAviso: 0, tardia: 0, profesoraAusente: 0, feriado: 0 };
  cancelled.forEach((r) => {
    const minutes = durationMinutes(r.scheduledStartAt, r.scheduledEndAt);
    if (r.outcome === "cancelada_con_aviso") {
      cancelledMinutesByReason.conAviso += minutes;
      cancelledCountByReason.conAviso += 1;
    } else if (r.outcome === "cancelada_tarde") {
      cancelledMinutesByReason.tardia += minutes;
      cancelledCountByReason.tardia += 1;
    } else if (r.outcome === "profesora_ausente") {
      cancelledMinutesByReason.profesoraAusente += minutes;
      cancelledCountByReason.profesoraAusente += 1;
    } else if (r.outcome === "feriado") {
      cancelledMinutesByReason.feriado += minutes;
      cancelledCountByReason.feriado += 1;
    }
  });

  return {
    heldClassesCount: held.length,
    heldMinutes,
    rescheduledReservationsCount: reservationMinutes.size,
    rescheduledMinutes: [...reservationMinutes.values()].reduce((sum, m) => sum + m, 0),
    rescheduledChangeCount: rescheduled.length,
    cancelledMinutesByReason,
    cancelledCountByReason,
  };
}

export interface ModalitySummary {
  presencial: number;
  online: number;
  mixta: number;
}

/** Distribución por HORAS realmente dictadas (`countsAsClass`), nunca por cantidad de tarjetas. */
export function buildModalitySummary(registrations: readonly RegistrationForAnnualActivity[], range: DateRange): ModalitySummary {
  const result: ModalitySummary = { presencial: 0, online: 0, mixta: 0 };
  registrations
    .filter((r) => inRange(r, range) && r.countsAsClass)
    .forEach((r) => {
      const minutes = durationMinutes(r.actualStartedAt, r.actualEndedAt) || durationMinutes(r.scheduledStartAt, r.scheduledEndAt);
      if (r.modality === "presencial") result.presencial += minutes;
      else if (r.modality === "online") result.online += minutes;
      else if (r.modality === "mixta") result.mixta += minutes;
    });
  return result;
}
