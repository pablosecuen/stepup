import { addDaysToDateKey, getDateKeyJsDay } from "./timezone.ts";

/**
 * Puerto VERBATIM de `calendarWeekday.ts` (móvil) — lunes=0 ... domingo=6
 * ("AppWeekday"), distinto de `Date.getDay()`/`getUTCDay()` de JS
 * (domingo=0). Nunca mezclar ambas convenciones sin pasar por acá.
 */
export type AppWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function jsDayToAppWeekday(jsDay: number): AppWeekday {
  if (!Number.isInteger(jsDay) || jsDay < 0 || jsDay > 6) {
    throw new RangeError("jsDay debe estar entre 0 y 6.");
  }
  return (jsDay === 0 ? 6 : jsDay - 1) as AppWeekday;
}

export function appWeekdayToJsDay(appDay: AppWeekday): number {
  if (!Number.isInteger(appDay) || appDay < 0 || appDay > 6) {
    throw new RangeError("appDay debe estar entre 0 y 6.");
  }
  return appDay === 6 ? 0 : appDay + 1;
}

/**
 * El lunes local (fecha civil, `Date.UTC` puro sobre los componentes
 * año/mes/día — nunca la zona horaria del proceso Node) de la semana que
 * contiene `dateKey`. Única fuente real de esta normalización — antes
 * duplicada de forma idéntica en `lib/calendar/split.ts` y
 * `lib/actions/calendar.ts` (mismo cálculo, dos lugares, riesgo real de que
 * una futura edición tocara uno y no el otro). `recurrence_rules.start_date`
 * SIEMPRE debe ser un lunes (invariante exigida por `assertRecurrenceRule`
 * en `recurrence-engine.ts`, ya que `weeks[].sessions[].weekday` cuenta
 * relativo al lunes de cada semana del ciclo) — esta función es la que
 * convierte cualquier fecha civil elegida por la profesora en ese ancla,
 * SIN alterar en qué día real cae la primera clase: `generateOccurrences`
 * arranca a buscar sesiones reales desde `startDate` en adelante, así que
 * la primera ocurrencia real generada sigue cayendo exactamente en
 * `dateKey` (o después, si `dateKey` no coincide con ninguno de los días
 * de sesión configurados) — nunca antes.
 */
export function mondayOfWeekContaining(dateKey: string): string {
  const appWeekday = jsDayToAppWeekday(getDateKeyJsDay(dateKey));
  return addDaysToDateKey(dateKey, -appWeekday);
}
