import type { CalendarViewItem } from "../calendar/occurrences.ts";

/** Nombre con el que Inicio muestra una clase: su título, «Clase grupal · N alumnos» o el alumno (nunca vacío). */
export function agendaLessonLabel(item: CalendarViewItem): string {
  if (item.title?.trim()) return item.title.trim();
  if (item.participantIds.length > 1) return `Clase grupal · ${item.participantIds.length} alumnos`;
  return item.studentName || "Sin alumnos";
}
