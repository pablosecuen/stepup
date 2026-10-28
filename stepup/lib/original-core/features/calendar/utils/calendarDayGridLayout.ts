// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDayGridLayout.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { AvailabilityException, CalendarLesson, TeacherAvailability } from '../types/index.ts';
import { getDateKeyJsDay, getLocalDateKey, getLocalTimeKey } from './calendarTimezone.ts';
import { jsDayToAppWeekday } from './calendarWeekday.ts';
import { EXCEPTION_REASON_LABELS, WEEKLY_REASON_LABELS } from './teacherAvailabilityEngine.ts';

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — endurecer contra huso
 * horario, tras el BUG de la clase de las 08:00): zona horaria canónica
 * única de Calendario — TeacherFlow es de uso exclusivo en Argentina, sin
 * selector de huso para la profesora. Las funciones de esta grilla la usan
 * por defecto en vez de leer `Date.getHours()`/`getMinutes()` del
 * dispositivo directamente — así, aunque el reloj/huso del sistema
 * operativo esté mal configurado (viaje, cambio de zona automático
 * fallido, etc.), la posición de una clase en la grilla siempre se calcula
 * contra la hora real de Buenos Aires, la misma que usó
 * `localDateTimeToInstantIso` para construir `lesson.start`.
 */
export const CALENDAR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Matemática pura de la grilla horaria de Calendario (Semana y Día) —
 * extraída de `WeekTimeGrid.tsx` (corrección visual 2026-07-22, a pedido
 * de Joaquín — "CALENDARIO, VISTA DIARIA MÁS COMPACTA") para poder
 * probarla directamente: las suites de pruebas de este proyecto compilan
 * sin JSX, así que la lógica pura no puede vivir dentro de un `.tsx`. El
 * componente (`WeekTimeGrid.tsx`) importa todo de acá — una sola
 * implementación, nunca dos.
 */

export const START_HOUR = 8;
export const END_HOUR = 22;

/**
 * Alto mínimo de una hora en Vista SEMANA — sin cambios por esta
 * corrección. Vista Día usa su propia escala compacta, ver
 * `computeCompactDayHourHeight` más abajo.
 */
export const BASE_HOUR_HEIGHT = 50;
export const TIME_COLUMN_WIDTH = 38;

export const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, index) => START_HOUR + index
);

/**
 * Corrección visual 2026-07-22: en Vista día, `BASE_HOUR_HEIGHT` (50,
 * pensado para Semana) nunca podía bajar de 50px/hora porque el alto de
 * hora se calculaba con `Math.max(BASE_HOUR_HEIGHT, ...)` — con 14 filas
 * (08 a 21) eso fuerza al menos 700px de contenido, más que la zona útil
 * real de un teléfono, y el rango visible terminaba cortado en ~18:00 en
 * vez de ~21:00. Vista Semana sigue usando exactamente la misma fórmula
 * de siempre — estas constantes y esta función sólo se usan cuando
 * `displayMode === 'day'`.
 *
 * Objetivo: que 08:00–21:00 (`DAY_TARGET_VISIBLE_HOURS` horas) quepan en
 * el alto medido de verdad del área de scroll (`scrollAreaHeight`, medido
 * por el propio componente vía `onLayout` — nunca un valor fijo "a
 * ciegas"). `DAY_MIN_HOUR_HEIGHT` evita filas ilegibles en un teléfono
 * muy chico; `DAY_MAX_HOUR_HEIGHT` evita filas gigantes en tablet — ahí,
 * al no poder crecer más, sobra espacio real y por lo tanto se termina
 * viendo MÁS rango horario sin scroll, no menos (exactamente lo pedido
 * para tablet: "no estirar exageradamente... mostrar más rango
 * horario"). Pura — nunca lee ni muta nada fuera de su propio argumento.
 */
export const DAY_MIN_HOUR_HEIGHT = 34;
export const DAY_MAX_HOUR_HEIGHT = 56;
export const DAY_TARGET_VISIBLE_HOURS = END_HOUR - START_HOUR - 1; // 08:00–21:00 = 13 horas

export function computeCompactDayHourHeight(scrollAreaHeight: number): number {
  if (scrollAreaHeight <= 0) return DAY_MIN_HOUR_HEIGHT;
  const fitHeight = scrollAreaHeight / DAY_TARGET_VISIBLE_HOURS;
  return Math.min(DAY_MAX_HOUR_HEIGHT, Math.max(DAY_MIN_HOUR_HEIGHT, fitHeight));
}

/**
 * Alto visual mínimo de una fila de clase en Vista día — antes forzado a
 * 60px sin importar la duración real (una clase de 30 minutos se veía
 * igual de alta que una de 60). Baja a un piso apenas legible para dos
 * líneas de texto: sólo actúa como piso en clases muy cortas con la
 * escala más compacta — el resto sigue siendo estrictamente proporcional
 * a la duración real. El área táctil se compensa aparte con `hitSlop` en
 * `CalendarLessonCard`, nunca agrandando la tarjeta visualmente.
 */
export const DAY_LESSON_MIN_HEIGHT = 30;
/** Debajo de este alto, la fila se considera "muy corta": prioriza hora + nombre, la modalidad queda sólo con ícono. */
export const DAY_ROW_COMPACT_THRESHOLD = 44;

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — "MODALIDAD VISIBLE EN
 * VISTA DIARIA"): ancho de columna por debajo del cual la palabra de la
 * modalidad se abrevia ("Pres.") — único caso real de columna angosta en
 * Vista día es una clase que comparte horario con otra(s) (superposición,
 * `computeLessonColumnLayout`). El ancho normal de una sola clase (sin
 * superposición) siempre está muy por encima de este umbral.
 */
export const DAY_ROW_NARROW_COLUMN_WIDTH = 220;

export function isNarrowLessonColumn(columnWidthPx: number): boolean {
  return columnWidthPx < DAY_ROW_NARROW_COLUMN_WIDTH;
}

/**
 * Corrección 2026-08-07 — endurecida contra huso horario: antes leía
 * `new Date(dateIso).getHours()/.getMinutes()`, es decir, la hora del
 * DISPOSITIVO que ejecuta la app — nunca explícitamente Buenos Aires.
 * Coincide con la hora real casi siempre (el dispositivo suele estar
 * configurado en Argentina), pero nunca lo garantiza. Ahora resuelve la
 * hora/minuto reales en `timeZone` (Buenos Aires por defecto) con el mismo
 * mecanismo (`Intl.DateTimeFormat` vía `getLocalTimeKey`) que ya usa
 * `localDateTimeToInstantIso` para CREAR `lesson.start` — lectura y
 * escritura pasan por la misma zona, nunca pueden divergir.
 */
export function getMinutesSinceStartOfDay(dateIso: string, timeZone: string = CALENDAR_TIME_ZONE): number {
  const [hourText, minuteText] = getLocalTimeKey(dateIso, timeZone).split(':');
  return (Number(hourText) - START_HOUR) * 60 + Number(minuteText);
}

export function getLessonDurationMinutes(lesson: CalendarLesson): number {
  const start = new Date(lesson.start).getTime();
  const end = new Date(lesson.end).getTime();
  return Math.max(30, Math.round((end - start) / 60_000));
}

export function isToday(dateIso: string, timeZone: string = CALENDAR_TIME_ZONE): boolean {
  return getLocalDateKey(dateIso, timeZone) === getLocalDateKey(new Date().toISOString(), timeZone);
}

/**
 * Corrección puntual 2026-08-18 (a pedido de Joaquín — CAMBIO VISUAL
 * PUNTUAL, CLASES DADAS Y CANCELADAS): usa la hora de FINALIZACIÓN, no la
 * de inicio — antes una clase todavía EN CURSO (ya empezó, no terminó)
 * contaba como "pasada". Inclusive (`<=`): el instante exacto en que
 * termina ya cuenta como transcurrida. Único consumidor real: el color de
 * la tarjeta (`resolveLessonCardPalette`, vía el prop `isPast` de
 * `CalendarLessonCard`) — nunca cambia `status` ni ningún otro dato.
 */
export function isPastLesson(lesson: CalendarLesson): boolean {
  return new Date(lesson.end).getTime() <= Date.now();
}

export function getCurrentTimeTop(hourHeight: number, timeZone: string = CALENDAR_TIME_ZONE): number | null {
  const [hourText, minuteText] = getLocalTimeKey(new Date().toISOString(), timeZone).split(':');
  const hour = Number(hourText);
  if (hour < START_HOUR || hour >= END_HOUR) {
    return null;
  }
  const minutes = (hour - START_HOUR) * 60 + Number(minuteText);
  return (minutes / 60) * hourHeight;
}

export interface AvailabilityOverlay {
  id: string;
  startMinute: number;
  endMinute: number;
  label: string;
}

function timeToMinute(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

// Corrección 2026-07-16 (a pedido de Joaquín): la disponibilidad admite
// crear feriados/licencias/otro además de vacaciones — el overlay de la
// grilla debe anunciar cuál es, nunca un genérico "No disponible" para
// algo con motivo real. Reutiliza el mismo mapeo que ya usa
// `evaluateAvailability` (nunca dos fuentes de verdad para el mismo
// texto), sólo con "Tus vacaciones" en vez de "Vacaciones" para que la
// grilla siga sonando personal.
const EXCEPTION_REASON_LABEL: Record<AvailabilityException['reason'], string> = {
  ...EXCEPTION_REASON_LABELS,
  vacation: 'Tus vacaciones',
};

export function availabilityOverlaysForDay(
  dateIso: string,
  availability?: TeacherAvailability
): AvailabilityOverlay[] {
  if (!availability) return [];
  const dateKey = getLocalDateKey(dateIso, availability.timezone);
  const weekday = jsDayToAppWeekday(getDateKeyJsDay(dateKey));
  // Corrección visual 2026-07-22 (a pedido de Joaquín — "MODALIDAD VISIBLE
  // + INFORMACIÓN"): antes esta etiqueta tenía su propio texto ("Trabajo",
  // sin caso para "personal") en vez de reutilizar `WEEKLY_REASON_LABELS`
  // ("Otro trabajo", "Compromiso personal") — dos leyendas distintas para
  // lo mismo. Ahora reutiliza la misma fuente que ya usa `evaluateAvailability`.
  const weekly = availability.weeklyBlocks
    .filter((block) => block.weekday === weekday)
    .map((block) => ({
      id: block.id,
      startMinute: timeToMinute(block.startTime),
      endMinute: timeToMinute(block.endTime),
      label: block.note?.trim() || WEEKLY_REASON_LABELS[block.reason],
    }));
  const exceptions = availability.exceptions
    .filter(
      (exception) =>
        exception.type !== 'available_extra' &&
        dateKey >= exception.date &&
        dateKey <= (exception.endDate ?? exception.date)
    )
    .map((exception) => ({
      id: exception.id,
      startMinute:
        exception.type === 'unavailable_full_day'
          ? START_HOUR * 60
          : timeToMinute(exception.startTime ?? '00:00'),
      endMinute:
        exception.type === 'unavailable_full_day'
          ? END_HOUR * 60
          : timeToMinute(exception.endTime ?? '23:59'),
      label: exception.note?.trim() || EXCEPTION_REASON_LABEL[exception.reason],
    }));
  return [...weekly, ...exceptions];
}
