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
