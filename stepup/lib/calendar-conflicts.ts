// Validación pura de solapamiento horario — preparada para la futura
// creación/edición real de clases (todavía sin formulario de guardado; esa
// fase no está autorizada). No se usa hoy en la UI: la grilla semanal sólo
// consume datos de fixture ya no superpuestos. Sin dependencias de React ni
// de Next — funciones puras, fáciles de testear y de reutilizar tal cual
// cuando exista un flujo real de agenda.

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ScheduledRange extends TimeRange {
  id: string;
}

/**
 * true si dos rangos horarios se solapan. Dos clases que terminan/empiezan
 * exactamente en el mismo instante (back-to-back) NO se consideran
 * solapadas — mismo criterio que un sweep de intervalos semiabiertos
 * [start, end).
 */
export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Primer conflicto real de horario entre `candidate` y las clases
 * existentes — devuelve el id de la clase con la que se solapa, o `null`
 * si no hay ninguno. Pensada para que un futuro formulario de
 * creación/edición la llame antes de guardar y bloquee el solapamiento.
 */
export function findSchedulingConflict(candidate: TimeRange, existing: ScheduledRange[]): string | null {
  const conflict = existing.find((range) => rangesOverlap(candidate, range));
  return conflict ? conflict.id : null;
}
