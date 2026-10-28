// Puerto VERBATIM del original (`src/features/calendar/utils/calendarDayIso.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-18 (bug reportado en dispositivo: crash "Fecha local
 * inválida" al avanzar de semana en vista Día, agenda vacía al seleccionar
 * un día, indicador de selección ausente, y "volver a Semana" saltando a la
 * semana actual en vez de conservar la que se estaba viendo). Causa real:
 * `week.days[].date` (useWeeklyCalendar.ts) es un ISO completo
 * (`date.toISOString()` de la medianoche local de ese día), pero
 * CalendarTabScreen mezclaba ese ISO con las utilidades de `dateKey` puro
 * (`YYYY-MM-DD`) de calendarTimezone.ts — que rechazan un ISO completo.
 * Estas dos funciones mantienen cualquier fecha de la vista Día SIEMPRE en
 * el mismo formato que `week.days[].date`, para que las comparaciones
 * `day.date === selectedDate` (WeekTimeGrid, CalendarViewModeControl) nunca
 * fallen y la navegación nunca reviente.
 */
export function localMidnightIso(date: Date): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

export function shiftDayIso(dayIso: string, amount: number): string {
  const date = new Date(dayIso);
  if (Number.isNaN(date.getTime())) return localMidnightIso(new Date());
  date.setDate(date.getDate() + amount);
  return date.toISOString();
}
