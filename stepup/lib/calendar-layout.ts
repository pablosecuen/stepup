import type { CalendarFixtureLesson } from "./calendar-fixtures";

// Estructura de grilla — mismo criterio que WeekTimeGrid.tsx en móvil:
// semana lunes->domingo, eje de horas 08:00-21:00, franjas de 60 minutos.
export const START_HOUR = 8;
export const END_HOUR = 22; // exclusivo: se muestran las horas 08..21
export const HOUR_HEIGHT_PX = 64;
export const TIME_COLUMN_WIDTH_PX = 48;
export const DAY_COLUMN_MIN_WIDTH_PX = 128;
// Piso de alto de tarjeta — suficiente para título en hasta 3 renglones +
// horario, para que nunca haga falta cortar texto (nunca "..."). Igual que
// móvil, el alto real crece si el contenido lo necesita (ver LessonCard:
// se aplica como minHeight, no como height fijo).
export const LESSON_CARD_MIN_HEIGHT_PX = 56;

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
  leftPercent: number;
  widthPercent: number;
}

/**
 * Distribución de columnas por superposición horaria — mismo criterio que
 * `computeLessonColumnLayout` en móvil: una clase que se solapa con otra(s)
 * comparte el ancho de la columna con ellas; una clase sin superposición
 * ocupa el ancho completo.
 */
export function layoutDayLessons(weekStart: Date, lessons: CalendarFixtureLesson[]): PositionedLesson[] {
  const withTimes = lessons
    .map((lesson) => ({
      lesson,
      start: resolveLessonStart(weekStart, lesson),
      end: resolveLessonEnd(weekStart, lesson),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const columnEndTimes: number[] = [];
  const assigned: Array<{ lesson: CalendarFixtureLesson; start: Date; end: Date; column: number }> = [];

  withTimes.forEach(({ lesson, start, end }) => {
    let column = columnEndTimes.findIndex((endTime) => endTime <= start.getTime());
    if (column === -1) {
      column = columnEndTimes.length;
      columnEndTimes.push(end.getTime());
    } else {
      columnEndTimes[column] = end.getTime();
    }
    assigned.push({ lesson, start, end, column });
  });

  return assigned.map(({ lesson, start, end, column }) => {
    // Máximo de columnas concurrentes en el instante de inicio de esta clase.
    const concurrent = assigned.filter((other) => other.start < end && other.end > start).length;
    const columnCount = Math.max(concurrent, column + 1);
    const minutesFromStart = (start.getHours() - START_HOUR) * 60 + start.getMinutes();
    const top = Math.max(0, (minutesFromStart / 60) * HOUR_HEIGHT_PX);
    const height = Math.max(LESSON_CARD_MIN_HEIGHT_PX, (lesson.durationMinutes / 60) * HOUR_HEIGHT_PX - 2);
    const widthPercent = 100 / columnCount;
    return { lesson, top, height, leftPercent: column * widthPercent, widthPercent };
  });
}

export function currentTimeTop(now: Date): number | null {
  const minutesFromStart = (now.getHours() - START_HOUR) * 60 + now.getMinutes();
  if (now.getHours() < START_HOUR || now.getHours() >= END_HOUR) return null;
  return (minutesFromStart / 60) * HOUR_HEIGHT_PX;
}
