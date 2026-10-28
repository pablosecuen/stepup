// Puerto VERBATIM del original (`src/features/dashboard/utils/annualActivitySummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Resumen anual de actividad y modalidad (Fase "Analíticas financieras,
 * demanda y resumen anual", a pedido de Joaquín) — secciones 5 y 6 del
 * pedido. Ambas se calculan a partir de la MISMA fuente (`SavedLesson[]`,
 * el registro pedagógico real), así que se combinan en un único módulo
 * para no recorrer la lista dos veces ni duplicar el filtro "clase
 * dictada". Pura — no muta `lessons`.
 *
 * Horas dictadas: `actualDurationMinutes` si existe (seguimiento en
 * vivo), si no `scheduledDurationMinutes` — SÓLO clases con
 * `eventType: 'clase_dictada'` (incluye 'feriado' con `holidayException`,
 * vía el mismo `isClassHeld` que ya usa el resto de la app). Una clase
 * compartida cuenta una sola vez (por registro, no por alumno).
 *
 * Horas reprogramadas: cada reprogramación deja un `SavedLesson` con
 * `eventType: 'reprogramada'` en la ocurrencia ORIGINAL (nunca cuenta como
 * dictada — la clase que sí se dio queda en un registro nuevo con
 * `eventType: 'clase_dictada'` y `rescheduledFromLessonId`), así que sumar
 * "dictada" + "reprogramada" nunca duplica la misma clase. Si una misma
 * reserva se reprogramó más de una vez, las horas se cuentan UNA sola vez
 * por reserva (agrupando por `calendarReservationKey` o, si falta, por
 * `id`) para no inflar el total — pero la CANTIDAD de cambios sí cuenta
 * cada evento.
 *
 * Horas canceladas: `cancelada_con_aviso`, `cancelada_tarde`,
 * `profesora_ausente`, `alumno_ausente` (no pedido explícitamente por el
 * enunciado, pero es claramente "no dictada" — se agrega al desglose para
 * no perder el dato, documentado en la entrega) y `feriado` SIN
 * `holidayException` (feriado real, no se dictó). Usa siempre
 * `scheduledDurationMinutes` (la clase no se dictó, no hay duración real).
 *
 * Modalidad: mismas clases "dictadas" que arriba, horas por
 * `form.modality` — nunca sólo cantidad de tarjetas.
 */
import type { SavedLesson } from '../../new-class/types/index.ts';
import { isClassHeld } from '../../new-class/utils/validation.ts';

function lessonDurationMinutes(lesson: SavedLesson): number {
  return lesson.form.actualDurationMinutes ?? lesson.form.scheduledDurationMinutes;
}

function inRange(dateKey: string, rangeStart: string, rangeEnd: string): boolean {
  return dateKey >= rangeStart && dateKey <= rangeEnd;
}

export type CancellationCategory =
  | 'con_aviso'
  | 'cancelacion_tardia'
  | 'profesora_ausente'
  | 'alumno_ausente'
  | 'feriado';

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

export function buildAnnualActivitySummary(input: {
  lessons: readonly SavedLesson[];
  rangeStart: string;
  rangeEnd: string;
}): AnnualActivitySummary {
  const { lessons, rangeStart, rangeEnd } = input;
  const inRangeLessons = lessons.filter((lesson) => inRange(lesson.form.date, rangeStart, rangeEnd));

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
    const { form } = lesson;
    if (isClassHeld(form)) {
      heldHours += lessonDurationMinutes(lesson) / 60;
      heldLessonCount += 1;
      return;
    }

    const scheduledHours = form.scheduledDurationMinutes / 60;

    if (form.eventType === 'reprogramada') {
      const groupKey = lesson.calendarReservationKey ?? lesson.id;
      rescheduledEntries.push({ groupKey, minutes: form.scheduledDurationMinutes });
      return;
    }

    if (form.eventType === 'cancelada_con_aviso') {
      cancelledByCategory.con_aviso.hours += scheduledHours;
      cancelledByCategory.con_aviso.count += 1;
    } else if (form.eventType === 'cancelada_tarde') {
      cancelledByCategory.cancelacion_tardia.hours += scheduledHours;
      cancelledByCategory.cancelacion_tardia.count += 1;
    } else if (form.eventType === 'profesora_ausente') {
      cancelledByCategory.profesora_ausente.hours += scheduledHours;
      cancelledByCategory.profesora_ausente.count += 1;
    } else if (form.eventType === 'alumno_ausente') {
      cancelledByCategory.alumno_ausente.hours += scheduledHours;
      cancelledByCategory.alumno_ausente.count += 1;
    } else if (form.eventType === 'feriado') {
      // holidayException ya se filtró arriba (cuenta como dictada) — acá sólo llega el feriado real.
      cancelledByCategory.feriado.hours += scheduledHours;
      cancelledByCategory.feriado.count += 1;
    }
  });

  const rescheduledChangeCount = rescheduledEntries.length;
  const minutesByGroup = new Map<string, number>();
  rescheduledEntries.forEach((entry) => {
    if (!minutesByGroup.has(entry.groupKey)) {
      minutesByGroup.set(entry.groupKey, entry.minutes);
    }
  });
  const rescheduledHours = Array.from(minutesByGroup.values()).reduce((sum, minutes) => sum + minutes, 0) / 60;

  const cancelledHours = Object.values(cancelledByCategory).reduce((sum, entry) => sum + entry.hours, 0);

  return {
    rangeStart,
    rangeEnd,
    heldHours,
    heldLessonCount,
    rescheduledHours,
    rescheduledChangeCount,
    cancelledHours,
    cancelledByCategory,
  };
}

// ---------------------------------------------------------------------------
// Modalidad más utilizada (sección 6).
// ---------------------------------------------------------------------------

export type ModalityCategory = 'presencial' | 'online' | 'mixta';

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
  /** Más de una modalidad si empatan en el máximo — nunca se elige arbitrariamente una. */
  mostUsed: ModalityCategory[];
}

export function buildModalitySummary(input: {
  lessons: readonly SavedLesson[];
  rangeStart: string;
  rangeEnd: string;
}): ModalitySummary {
  const { lessons, rangeStart, rangeEnd } = input;

  const hoursByModality: Record<ModalityCategory, number> = { presencial: 0, online: 0, mixta: 0 };
  const countByModality: Record<ModalityCategory, number> = { presencial: 0, online: 0, mixta: 0 };

  lessons
    .filter((lesson) => inRange(lesson.form.date, rangeStart, rangeEnd))
    .filter((lesson) => isClassHeld(lesson.form))
    .forEach((lesson) => {
      const modality = lesson.form.modality as ModalityCategory;
      if (!(modality in hoursByModality)) return;
      hoursByModality[modality] += lessonDurationMinutes(lesson) / 60;
      countByModality[modality] += 1;
    });

  const totalHours = hoursByModality.presencial + hoursByModality.online + hoursByModality.mixta;

  const breakdown: ModalityBreakdownEntry[] = (['online', 'presencial', 'mixta'] as ModalityCategory[]).map(
    (modality) => ({
      modality,
      hours: hoursByModality[modality],
      lessonCount: countByModality[modality],
      percent: totalHours > 0 ? (hoursByModality[modality] / totalHours) * 100 : 0,
    })
  );

  const maxHours = Math.max(0, ...breakdown.map((entry) => entry.hours));
  const mostUsed = maxHours > 0 ? breakdown.filter((entry) => entry.hours === maxHours).map((entry) => entry.modality) : [];

  return { rangeStart, rangeEnd, breakdown, mostUsed };
}
