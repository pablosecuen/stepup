import type { CalendarFixtureLesson } from "./calendar-fixtures";

// Estructura de grilla — mismo criterio que WeekTimeGrid.tsx en móvil:
// semana lunes->domingo, eje de horas 08:00-21:00, franjas de 60 minutos.
export const START_HOUR = 8;
export const END_HOUR = 22; // exclusivo: se muestran las horas 08..21
export const HOUR_HEIGHT_PX = 80;
export const TIME_COLUMN_WIDTH_PX = 48;
// Ancho mínimo de columna diaria — cada actividad ocupa SIEMPRE el 100% de
// esta columna (corrección 2026-09-10: se eliminó el diseño anterior de
// carriles paralelos, que partía el ancho a la mitad y cortaba nombres
// palabra por palabra). En teléfono/tablet este mínimo se mantiene vía
// scroll horizontal dentro del calendario, nunca comprimiendo el texto.
export const DAY_COLUMN_MIN_WIDTH_PX = 168;
// Separación visual entre una tarjeta y la siguiente del mismo día.
const CARD_GAP_PX = 6;
// Piso de alto — sólo para clases muy cortas; nunca se usa para "inflar"
// una tarjeta más allá del hueco real hasta la próxima actividad (ver
// layoutDayLessons: el alto siempre queda acotado por ese hueco, así una
// tarjeta nunca invade a la que sigue).
const MIN_CARD_HEIGHT_PX = 46;

export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

export const WEEKDAY_SHORT = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];

/** Lunes de la semana que contiene `date` — mismo criterio que startOfWeek() en móvil. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=domingo..6=sábado
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  const startLabel = weekStart.toLocaleDateString("es-AR", { day: "2-digit" });
  const endLabel = weekEnd.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: sameMonth ? undefined : "short",
  });
  const monthYearLabel = weekEnd.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  return `${startLabel} - ${endLabel} de ${monthYearLabel}`;
}

/** Instante real (Date) de una clase ficticia, ubicada en la semana mostrada. */
export function resolveLessonStart(weekStart: Date, lesson: CalendarFixtureLesson): Date {
  const day = addDays(weekStart, lesson.dayOffset);
  day.setHours(lesson.startHour, lesson.startMinute, 0, 0);
  return day;
}

export function resolveLessonEnd(weekStart: Date, lesson: CalendarFixtureLesson): Date {
  return new Date(resolveLessonStart(weekStart, lesson).getTime() + lesson.durationMinutes * 60_000);
}

/** true si una clase de reemplazo tiene, en esta misma semana, la clase cancelada que dice liberar. */
export function isActiveReplacement(lesson: CalendarFixtureLesson, all: CalendarFixtureLesson[]): boolean {
  if (!lesson.freedByLessonId) return false;
  const original = all.find((l) => l.id === lesson.freedByLessonId);
  return !!original && original.status === "cancelled" && lesson.status !== "cancelled";
}

function hasActiveReplacementForCancelledSlot(lesson: CalendarFixtureLesson, all: CalendarFixtureLesson[]): boolean {
  return all.some((other) => other.freedByLessonId === lesson.id && other.status !== "cancelled");
}

/**
 * Qué tarjetas se dibujan en la grilla — misma regla EXACTA que
 * `hideCancelledLessonsWithActiveReplacement` en móvil
 * (`src/features/calendar/utils/cancelledSlotReuse.ts`): nunca dos tarjetas
 * relacionadas en el mismo horario.
 *   - Una clase cancelada que es en sí misma un reemplazo -> se oculta.
 *   - Una clase cancelada con un reemplazo activo apuntándole -> se oculta
 *     (se muestra sólo el reemplazo, a tamaño completo).
 * Ocultar nunca borra el dato: `CALENDAR_FIXTURE_LESSONS` completo se sigue
 * usando para resolver colores (p. ej. el coral del reemplazo necesita ver
 * la cancelada original, aunque esa cancelada no se dibuje).
 */
export function visibleWeekLessons(all: CalendarFixtureLesson[]): CalendarFixtureLesson[] {
  return all.filter((lesson) => {
    if (lesson.freedByLessonId && lesson.status === "cancelled") return false;
    if (lesson.status === "cancelled" && hasActiveReplacementForCancelledSlot(lesson, all)) return false;
    return true;
  });
}

export interface PositionedLesson {
  lesson: CalendarFixtureLesson;
  top: number;
  height: number;
}

function minutesFromDayStart(date: Date): number {
  return (date.getHours() - START_HOUR) * 60 + date.getMinutes();
}

/**
 * Posición vertical de cada tarjeta de un día — SIEMPRE a ancho completo
 * de la columna (corrección 2026-09-10: se eliminó el diseño anterior de
 * carriles paralelos por superposición; ver findSchedulingConflict en
 * calendar-conflicts.ts, que reemplaza esa lógica como validación pura
 * para una futura creación/edición real de clases).
 *
 * Asume que `lessons` no se superponen en el tiempo — eso se garantiza con
 * datos de fixture que no se cruzan. El alto de cada tarjeta nunca excede
 * el hueco real hasta el inicio de la próxima clase del día (o el final de
 * la grilla si es la última), para que una tarjeta nunca invada a la
 * siguiente aunque su contenido sea largo.
 */
export function layoutDayLessons(weekStart: Date, lessons: CalendarFixtureLesson[]): PositionedLesson[] {
  const withTimes = lessons
    .map((lesson) => ({
      lesson,
      start: resolveLessonStart(weekStart, lesson),
      end: resolveLessonEnd(weekStart, lesson),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const gridBottomPx = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;

  return withTimes.map(({ lesson, start }, index) => {
    const top = Math.max(0, (minutesFromDayStart(start) / 60) * HOUR_HEIGHT_PX);
    const naturalHeight = (lesson.durationMinutes / 60) * HOUR_HEIGHT_PX - CARD_GAP_PX;

    const next = withTimes[index + 1];
    const nextTopPx = next ? (minutesFromDayStart(next.start) / 60) * HOUR_HEIGHT_PX : gridBottomPx;
    const availableToNextPx = Math.max(0, nextTopPx - top - CARD_GAP_PX);

    // El hueco disponible siempre gana: nunca se invade la próxima tarjeta,
    // aunque eso implique quedar por debajo del piso mínimo (caso límite,
    // no esperado con los datos de fixture actuales, que dejan huecos
    // generosos entre actividades consecutivas).
    const height = Math.min(availableToNextPx, Math.max(MIN_CARD_HEIGHT_PX, naturalHeight));

    return { lesson, top, height };
  });
}

export function currentTimeTop(now: Date): number | null {
  const minutesFromStart = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  if (now.getHours() < START_HOUR || now.getHours() >= END_HOUR) return null;
  return (minutesFromStart / 60) * HOUR_HEIGHT_PX;
}
