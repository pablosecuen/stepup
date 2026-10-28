// Puerto VERBATIM del original (`src/features/calendar/utils/calendarWeekday.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { AppWeekday } from '../types/index.ts';

export function jsDayToAppWeekday(jsDay: number): AppWeekday {
  if (!Number.isInteger(jsDay) || jsDay < 0 || jsDay > 6) {
    throw new RangeError('jsDay debe estar entre 0 y 6.');
  }

  return (jsDay === 0 ? 6 : jsDay - 1) as AppWeekday;
}

export function appWeekdayToJsDay(appDay: AppWeekday): number {
  if (!Number.isInteger(appDay) || appDay < 0 || appDay > 6) {
    throw new RangeError('appDay debe estar entre 0 y 6.');
  }

  return appDay === 6 ? 0 : appDay + 1;
}
