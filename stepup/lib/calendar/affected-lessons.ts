import { formatCivilDayLabelShort } from "./civil-calendar.ts";
import { getLocalDateKey } from "./timezone.ts";

/**
 * Qué clases YA decididas de una serie quedan afectadas cuando un cambio «desde una fecha» la reemplaza: una clase reprogramada se
 * reemplaza por el nuevo patrón (como en la app original) y una cancelada queda registrada como cancelada. Se muestran antes de confirmar:
 * un cambio posterior a la fecha nunca descarta en silencio lo que la profesora ya movió o canceló.
 */
export interface LessonForAffected {
  status: "scheduled" | "completed" | "cancelled" | "rescheduled";
  startAt: string;
  /** Horario original de la ocurrencia cuando la clase fue reprogramada. */
  recurrenceOriginalStart: string | null;
}

export interface AffectedLessons {
  /** «viernes, 13 de noviembre 18:00 → sábado, 14 de noviembre 10:00»: se reemplazan por el nuevo patrón. */
  rescheduled: string[];
  /** «viernes, 6 de noviembre 18:00»: siguen registradas como canceladas. */
  cancelled: string[];
}

function whenLabel(iso: string, timeZone: string): string {
  const time = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return `${formatCivilDayLabelShort(getLocalDateKey(iso, timeZone))} ${time}`;
}

export function affectedFutureLessons(lessons: readonly LessonForAffected[], effectiveDate: string, timeZone: string): AffectedLessons {
  const rescheduled: { sort: number; text: string }[] = [];
  const cancelled: { sort: number; text: string }[] = [];
  for (const lesson of lessons) {
    if (lesson.status === "completed") continue;
    const logicalStart = lesson.recurrenceOriginalStart ?? lesson.startAt;
    if (getLocalDateKey(logicalStart, timeZone) < effectiveDate) continue;
    const sort = new Date(logicalStart).getTime();
    if (lesson.status === "cancelled") {
      cancelled.push({ sort, text: whenLabel(logicalStart, timeZone) });
      continue;
    }
    const moved = lesson.recurrenceOriginalStart && new Date(lesson.recurrenceOriginalStart).getTime() !== new Date(lesson.startAt).getTime();
    if (moved) rescheduled.push({ sort, text: `${whenLabel(logicalStart, timeZone)} → ${whenLabel(lesson.startAt, timeZone)}` });
  }
  const ordered = (list: { sort: number; text: string }[]) => list.sort((a, b) => a.sort - b.sort).map((item) => item.text);
  return { rescheduled: ordered(rescheduled), cancelled: ordered(cancelled) };
}
