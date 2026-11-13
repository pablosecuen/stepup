import type { CalendarViewItem } from "./occurrences.ts";

/**
 * AGENDA OPERATIVA — la única regla que decide qué clases cuentan como una clase vigente del calendario.
 *
 * `loadCalendarViewForRange` / `composeCalendarView` devuelven TODO lo que existe en el rango (clases reales, ocurrencias generadas por las series y las filas que quedaron como historia:
 * canceladas, orígenes de una reprogramación, clases reemplazadas). Esa lista completa conserva los vínculos y sirve para el historial y para resolver relaciones (p. ej. el color de un
 * reemplazo), pero NADA que dibuje, cuente, numere, reserve o valide horarios debe partir de ella directamente: debe partir de lo que esta regla deja.
 *
 * Una clase pertenece a la agenda operativa si NO es:
 *  - cancelada (`status: "cancelled"`): desaparece de la agenda y libera su horario; su fila, su registro, sus cobros y su historial siguen intactos;
 *  - el origen liberado de una reprogramación o una clase reemplazada (`occupiesSlot: false` / `hiddenByReplacement`): sólo ocupa su destino / sólo queda la sustituta.
 * Una clase dictada (`completed`) nunca se marca como reemplazada (`applyReplacementVisibility` la conserva: es evidencia histórica) y, mientras no esté cancelada, sigue en la agenda.
 *
 * Nada de esto se decide por coincidencia de fecha, hora o nombre: las relaciones salen de vínculos e identidades explícitas (ver `replacement-visibility.ts`).
 */
export type AgendaCandidate = Pick<CalendarViewItem, "status"> & Partial<Pick<CalendarViewItem, "occupiesSlot" | "hiddenByReplacement">>;

export function isOperativeAgendaItem(item: AgendaCandidate): boolean {
  if (item.status === "cancelled") return false;
  if (item.occupiesSlot === false || item.hiddenByReplacement) return false;
  return true;
}

/** ¿Esta clase ocupa su horario? (alias semántico de `isOperativeAgendaItem` para disponibilidad y choques). */
export const occupiesAgendaSlot = isOperativeAgendaItem;

/** Lo que queda de una lista de clases tras aplicar la agenda operativa. Se aplica ANTES de calcular carriles, simultáneas, contadores o choques; nunca después. */
export function resolveAgendaItems<T extends AgendaCandidate>(all: readonly T[]): T[] {
  return all.filter(isOperativeAgendaItem);
}
