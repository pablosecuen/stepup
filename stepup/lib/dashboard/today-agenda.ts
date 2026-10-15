import { instantDateKey } from "../calendar/civil-calendar.ts";
import { classifyLessonTiming, type LessonTimingStatus } from "../calendar/next-class.ts";
import { visibleCalendarItems, type CalendarViewItem } from "../calendar/occurrences.ts";

/**
 * Agenda COMPLETA del día para «Clases de hoy» (Inicio): todas las clases del día civil de Argentina, de la primera a la última,
 * en orden cronológico y sin ningún límite. Parte de lo que el calendario ya compuso para el día (una sola consulta acotada al
 * día, sin una consulta por clase) y conserva su regla de agenda válida (`visibleCalendarItems`): una clase cancelada se muestra
 * como cancelada, salvo que un reemplazo activo ocupe su lugar (entonces se ve sólo el reemplazo), igual que en el Calendario.
 * Nunca mezcla clases de otro día: el día se decide por la fecha civil del INICIO de cada clase en la zona de Argentina.
 */
export interface TodayAgendaEntry {
  item: CalendarViewItem;
  /** Relación con el reloj (antes, en curso o ya terminó), sin mirar el estado: el estado de la clase se dice aparte. */
  timing: Exclude<LessonTimingStatus, "excluded">;
}

function compareAgenda(a: CalendarViewItem, b: CalendarViewItem): number {
  const startA = new Date(a.start).getTime();
  const startB = new Date(b.start).getTime();
  if (startA !== startB) return startA - startB;
  const endA = new Date(a.end).getTime();
  const endB = new Date(b.end).getTime();
  if (endA !== endB) return endA - endB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildTodayAgenda(items: readonly CalendarViewItem[], now: Date, todayDateKey: string): TodayAgendaEntry[] {
  const all = [...items];
  return visibleCalendarItems(all)
    .filter((item) => instantDateKey(item.start) === todayDateKey)
    .sort(compareAgenda)
    .map((item) => ({ item, timing: classifyLessonTiming({ start: item.start, end: item.end }, now) as TodayAgendaEntry["timing"] }));
}
