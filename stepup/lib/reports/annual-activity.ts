import { isClassHeld, lessonMinutes, type RegisteredLessonFacts } from "./registered-lessons.ts";
import type { DateRange } from "./period.ts";

/**
 * Puerto exacto de `buildAnnualActivitySummary`/`buildModalitySummary` (móvil, `annualActivitySummary.ts`). Ambas salen del MISMO registro pedagógico de clases y de las MISMAS reglas que la app:
 *
 * - Horas dictadas: duración real si existe, si no la programada; sólo clases cuyo RESULTADO es «clase dictada» (o feriado con excepción manual). Una clase compartida cuenta una sola vez.
 * - Horas reprogramadas: duración de la ocurrencia que se movió, una sola vez por reserva aunque se haya reprogramado varias veces (la cantidad de cambios sí cuenta cada evento). La clase que sí
 *   se dio queda en otro registro «dictada», así que nunca se duplica.
 * - Horas canceladas: cancelación con aviso, tardía, profesora ausente, alumno ausente y feriado sin excepción, con la duración programada.
 * - Modalidad: las mismas clases «dictadas», en horas (nunca por cantidad de tarjetas).
 *
 * El rango se aplica a la fecha civil de la clase (Argentina), igual que `form.date` de la app.
 */
export type CancellationCategory = "con_aviso" | "cancelacion_tardia" | "profesora_ausente" | "alumno_ausente" | "feriado";

export interface AnnualActivitySummary {
  rangeStart: string;
  rangeEnd: string;
  heldHours: number;
  heldLessonCount: number;
  rescheduledHours: number;
  /** Cantidad total de eventos de reprogramación (puede ser mayor que la cantidad de reservas afectadas). */
  rescheduledChangeCount: number;
  cancelledHours: number;
  cancelledByCategory: Record<CancellationCategory, { hours: number; count: number }>;
}

function inRange(dateKey: string, range: DateRange): boolean {
  return dateKey >= range.rangeStart && dateKey <= range.rangeEnd;
}

export function buildAnnualActivitySummary(lessons: readonly RegisteredLessonFacts[], range: DateRange): AnnualActivitySummary {
  const inRangeLessons = lessons.filter((lesson) => inRange(lesson.dateKey, range));

  let heldHours = 0;
  let heldLessonCount = 0;
  const cancelledByCategory: Record<CancellationCategory, { hours: number; count: number }> = {
    con_aviso: { hours: 0, count: 0 },
    cancelacion_tardia: { hours: 0, count: 0 },
    profesora_ausente: { hours: 0, count: 0 },
    alumno_ausente: { hours: 0, count: 0 },
    feriado: { hours: 0, count: 0 },
  };
  const rescheduledEntries: Array<{ groupKey: string; minutes: number }> = [];

  inRangeLessons.forEach((lesson) => {
    if (isClassHeld(lesson)) {
      heldHours += lessonMinutes(lesson) / 60;
      heldLessonCount += 1;
      return;
    }
    const scheduledHours = lesson.scheduledDurationMinutes / 60;

    if (lesson.eventType === "reprogramada") {
      rescheduledEntries.push({ groupKey: lesson.calendarLessonId ?? lesson.occurrenceKey ?? lesson.id, minutes: lesson.scheduledDurationMinutes });
      return;
    }
    const category: CancellationCategory | null =
      lesson.eventType === "cancelada_con_aviso"
        ? "con_aviso"
        : lesson.eventType === "cancelada_tarde"
          ? "cancelacion_tardia"
          : lesson.eventType === "profesora_ausente"
            ? "profesora_ausente"
            : lesson.eventType === "alumno_ausente"
              ? "alumno_ausente"
              : lesson.eventType === "feriado"
                ? "feriado" // la excepción manual ya se contó arriba como dictada: acá sólo llega el feriado real.
                : null;
    if (category) {
      cancelledByCategory[category].hours += scheduledHours;
      cancelledByCategory[category].count += 1;
    }
  });

  const minutesByGroup = new Map<string, number>();
  rescheduledEntries.forEach((entry) => {
    if (!minutesByGroup.has(entry.groupKey)) minutesByGroup.set(entry.groupKey, entry.minutes);
  });
  const rescheduledHours = Array.from(minutesByGroup.values()).reduce((sum, minutes) => sum + minutes, 0) / 60;
  const cancelledHours = Object.values(cancelledByCategory).reduce((sum, entry) => sum + entry.hours, 0);

  return { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd, heldHours, heldLessonCount, rescheduledHours, rescheduledChangeCount: rescheduledEntries.length, cancelledHours, cancelledByCategory };
}

export type ModalityCategory = "presencial" | "online" | "mixta";

export interface ModalityBreakdownEntry {
  modality: ModalityCategory;
  hours: number;
  lessonCount: number;
  percent: number;
}

export interface ModalitySummary {
  rangeStart: string;
  rangeEnd: string;
  breakdown: ModalityBreakdownEntry[];
  /** Más de una modalidad si empatan en el máximo — nunca se elige una arbitrariamente. */
  mostUsed: ModalityCategory[];
}

export function buildModalitySummary(lessons: readonly RegisteredLessonFacts[], range: DateRange): ModalitySummary {
  const hoursByModality: Record<ModalityCategory, number> = { presencial: 0, online: 0, mixta: 0 };
  const countByModality: Record<ModalityCategory, number> = { presencial: 0, online: 0, mixta: 0 };

  lessons
    .filter((lesson) => inRange(lesson.dateKey, range) && isClassHeld(lesson))
    .forEach((lesson) => {
      const modality = lesson.modality as ModalityCategory;
      if (!(modality in hoursByModality)) return;
      hoursByModality[modality] += lessonMinutes(lesson) / 60;
      countByModality[modality] += 1;
    });

  const totalHours = hoursByModality.presencial + hoursByModality.online + hoursByModality.mixta;
  const breakdown: ModalityBreakdownEntry[] = (["online", "presencial", "mixta"] as ModalityCategory[]).map((modality) => ({
    modality,
    hours: hoursByModality[modality],
    lessonCount: countByModality[modality],
    percent: totalHours > 0 ? (hoursByModality[modality] / totalHours) * 100 : 0,
  }));
  const maxHours = Math.max(0, ...breakdown.map((entry) => entry.hours));
  const mostUsed = maxHours > 0 ? breakdown.filter((entry) => entry.hours === maxHours).map((entry) => entry.modality) : [];

  return { rangeStart: range.rangeStart, rangeEnd: range.rangeEnd, breakdown, mostUsed };
}
