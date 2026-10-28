// Puerto VERBATIM del original (`src/features/calendar/utils/calendarMonthGrid.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import { jsDayToAppWeekday } from './calendarWeekday.ts';

/**
 * Corrección 2026-07-20 (a pedido de Joaquín — disponibilidad en Nueva
 * clase): helpers puros de `RescheduleMonthCalendar.tsx`, movidos acá tal
 * cual (mismo comportamiento, cero cambios de lógica) para poder probarlos
 * directamente desde `test:recurrence` — esa suite compila con un
 * `tsconfig` sin JSX, así que no puede importar nada de un archivo `.tsx`.
 * Sigue habiendo una única implementación: `RescheduleMonthCalendar.tsx`
 * (usado por Reprogramar y por Nueva clase) importa estas mismas
 * funciones, nunca las reimplementa.
 */
export function isSameDay(first: Date, second: Date): boolean {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function buildMonthWeeks(year: number, month: number): Array<Array<Date | null>> {
  const firstOfMonth = new Date(year, month, 1);
  const leadingBlanks = jsDayToAppWeekday(firstOfMonth.getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<Date | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => new Date(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: Array<Array<Date | null>> = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export function monthLabel(year: number, month: number): string {
  const formatted = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1)
  );
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}
