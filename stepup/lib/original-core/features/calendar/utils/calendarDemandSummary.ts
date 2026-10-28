// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDemandSummary.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Demanda semanal y horaria (Fase "Analíticas financieras, demanda y
 * resumen anual", a pedido de Joaquín). Pura — recibe la lista de
 * `CalendarLesson` YA resuelta (materializadas + virtuales generadas por
 * `useWeeklyCalendar`, exactamente lo mismo que usa el resto del
 * Calendario) y un rango de fechas; nunca genera reservas nuevas ni muta
 * la lista recibida.
 *
 * Incluye: clases dictadas (`status: 'completed'`) y clases futuras
 * confirmadas (`status: 'scheduled'`) dentro del rango.
 * Excluye: canceladas (`status: 'cancelled'`), reprogramaciones antiguas
 * reemplazadas (nunca aparecen en la lista resuelta: al reprogramar, la
 * ocurrencia original se reemplaza por la nueva en el mismo `id`/clave, no
 * coexisten — ver `calendarRecurrenceMutations.ts`), y clases "Sin
 * alumnos" cuyo horario ya pasó y nunca se usó (pasadas + sin
 * participantes). Una clase "Sin alumnos" FUTURA sigue ocupando el
 * horario en la agenda, así que sí cuenta.
 * Feriados/vacaciones no son `CalendarLesson` — no hay nada que excluir
 * acá; esa exclusión ya la hace `useTeacherAvailability`/`evaluateAvailability`
 * en otras pantallas, este módulo sólo mide reservas reales.
 * Una clase compartida (varios `participants`) se cuenta UNA sola vez como
 * ocupación de agenda — nunca una vez por participante.
 */
import { getDateKeyJsDay, getLocalDateKey } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';
import type { AppWeekday, CalendarLesson } from '../types/index.ts';

const SLOT_MINUTES = 30;
const MINUTES_PER_DAY = 24 * 60;
const SLOT_COUNT_PER_DAY = MINUTES_PER_DAY / SLOT_MINUTES;

export interface DemandByWeekday {
  weekday: AppWeekday;
  occupiedHours: number;
  lessonCount: number;
  percentOfWeeklyDemand: number;
}

export interface DemandSlot {
  hour: number;
  minute: number;
  occupiedHours: number;
  lessonCount: number;
}

export interface CalendarDemandSummary {
  rangeStart: string;
  rangeEnd: string;
  byWeekday: DemandByWeekday[]; // 7 entradas, lunes(0) a domingo(6)
  /** Día(s) más demandados — puede haber más de uno en caso de empate. */
  topWeekdays: DemandByWeekday[];
  bySlot: DemandSlot[]; // sólo los intervalos de 30 min con alguna ocupación
  /** Horario(s) más demandados — puede haber más de tres en caso de empate en el 3er lugar. */
  topSlots: DemandSlot[];
}

function isRelevantLesson(
  lesson: CalendarLesson,
  rangeStart: string,
  rangeEnd: string,
  timeZone: string,
  evaluationInstant: string
): boolean {
  if (lesson.status === 'cancelled') return false;
  if (lesson.status !== 'scheduled' && lesson.status !== 'completed') return false;

  const startDateKey = getLocalDateKey(lesson.start, timeZone);
  if (startDateKey < rangeStart || startDateKey > rangeEnd) return false;

  const isEmpty = lesson.studentId === '' && lesson.participants.length === 0;
  const isPast = new Date(lesson.end).getTime() < new Date(evaluationInstant).getTime();
  if (isEmpty && isPast) return false;

  return true;
}

function slotIndexOfMinutes(minutesFromMidnight: number): number {
  return Math.floor(minutesFromMidnight / SLOT_MINUTES);
}

export function buildCalendarDemandSummary(input: {
  lessons: readonly CalendarLesson[];
  rangeStart: string;
  rangeEnd: string;
  timeZone: string;
  /** ISO — "ahora", para decidir si una clase "Sin alumnos" ya pasó. */
  evaluationInstant: string;
}): CalendarDemandSummary {
  const { lessons, rangeStart, rangeEnd, timeZone, evaluationInstant } = input;

  const relevant = lessons.filter((lesson) =>
    isRelevantLesson(lesson, rangeStart, rangeEnd, timeZone, evaluationInstant)
  );

  const weekdayMinutes = new Map<AppWeekday, number>();
  const weekdayLessonCount = new Map<AppWeekday, number>();
  const slotMinutes = new Map<number, number>();
  const slotLessonCount = new Map<number, number>();

  relevant.forEach((lesson) => {
    const startInstant = new Date(lesson.start).getTime();
    const endInstant = new Date(lesson.end).getTime();
    const durationMinutes = Math.max(0, Math.round((endInstant - startInstant) / 60_000));
    if (durationMinutes === 0) return;

    const dateKey = getLocalDateKey(lesson.start, timeZone);
    const weekday = jsDayToAppWeekday(getDateKeyJsDay(dateKey));
    weekdayMinutes.set(weekday, (weekdayMinutes.get(weekday) ?? 0) + durationMinutes);
    weekdayLessonCount.set(weekday, (weekdayLessonCount.get(weekday) ?? 0) + 1);

    // Distribuye la duración de la clase entre los intervalos de 30 min que toca.
    const startMinuteOfDay = (() => {
      const [hourStr, minuteStr] = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date(lesson.start))
        .split(':');
      return Number(hourStr) * 60 + Number(minuteStr);
    })();

    const firstSlot = slotIndexOfMinutes(startMinuteOfDay);
    let minutesRemaining = durationMinutes;
    let currentSlot = firstSlot;
    let minutesIntoCurrentSlot = startMinuteOfDay - currentSlot * SLOT_MINUTES;
    const touchedSlots = new Set<number>();

    while (minutesRemaining > 0 && currentSlot < SLOT_COUNT_PER_DAY) {
      const minutesInThisSlot = Math.min(SLOT_MINUTES - minutesIntoCurrentSlot, minutesRemaining);
      slotMinutes.set(currentSlot, (slotMinutes.get(currentSlot) ?? 0) + minutesInThisSlot);
      touchedSlots.add(currentSlot);
      minutesRemaining -= minutesInThisSlot;
      minutesIntoCurrentSlot = 0;
      currentSlot += 1;
    }
    touchedSlots.forEach((slot) => {
      slotLessonCount.set(slot, (slotLessonCount.get(slot) ?? 0) + 1);
    });
  });

  const totalWeeklyMinutes = Array.from(weekdayMinutes.values()).reduce((sum, minutes) => sum + minutes, 0);

  const byWeekday: DemandByWeekday[] = ([0, 1, 2, 3, 4, 5, 6] as AppWeekday[]).map((weekday) => {
    const minutes = weekdayMinutes.get(weekday) ?? 0;
    return {
      weekday,
      occupiedHours: minutes / 60,
      lessonCount: weekdayLessonCount.get(weekday) ?? 0,
      percentOfWeeklyDemand: totalWeeklyMinutes > 0 ? (minutes / totalWeeklyMinutes) * 100 : 0,
    };
  });

  const maxWeekdayMinutes = Math.max(0, ...byWeekday.map((entry) => entry.occupiedHours * 60));
  const topWeekdays =
    maxWeekdayMinutes > 0 ? byWeekday.filter((entry) => entry.occupiedHours * 60 === maxWeekdayMinutes) : [];

  const bySlot: DemandSlot[] = Array.from(slotMinutes.entries())
    .map(([slotIndex, minutes]) => ({
      hour: Math.floor((slotIndex * SLOT_MINUTES) / 60),
      minute: (slotIndex * SLOT_MINUTES) % 60,
      occupiedHours: minutes / 60,
      lessonCount: slotLessonCount.get(slotIndex) ?? 0,
    }))
    .sort((a, b) => (a.hour !== b.hour ? a.hour - b.hour : a.minute - b.minute));

  const sortedByDemand = [...bySlot].sort((a, b) => b.occupiedHours - a.occupiedHours);
  const thirdPlaceHours = sortedByDemand[2]?.occupiedHours ?? -1;
  const topSlots = sortedByDemand.filter((slot) => slot.occupiedHours >= thirdPlaceHours && slot.occupiedHours > 0);

  return { rangeStart, rangeEnd, byWeekday, topWeekdays, bySlot, topSlots };
}
