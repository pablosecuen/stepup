// Puerto VERBATIM del original (`src/features/calendar/utils/calendarTimeSlots.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
/**
 * Corrección 2026-07-20 (a pedido de Joaquín — disponibilidad en Nueva
 * clase): helpers puros de `RescheduleTimeSlotGrid.tsx`, movidos acá tal
 * cual (mismo comportamiento, cero cambios de lógica) para poder probarlos
 * directamente desde `test:recurrence` — esa suite compila con un
 * `tsconfig` sin JSX, así que no puede importar nada de un archivo `.tsx`.
 * Sigue habiendo una única implementación: `RescheduleTimeSlotGrid.tsx`
 * (usado por Reprogramar y por Nueva clase) importa estas mismas
 * funciones, nunca las reimplementa.
 */
export const TIME_SLOT_START_HOUR = 8;
export const TIME_SLOT_END_HOUR = 22;

export interface OccupiedRange {
  startMinute: number;
  endMinute: number;
  label: string;
}

export function buildTimeSlots(): Array<{ hour: number; minute: number }> {
  return Array.from({ length: (TIME_SLOT_END_HOUR - TIME_SLOT_START_HOUR) * 2 }, (_, index) => {
    const totalMinutes = TIME_SLOT_START_HOUR * 60 + index * 30;
    return { hour: Math.floor(totalMinutes / 60), minute: totalMinutes % 60 };
  });
}

export function slotOverlapsAnyRange(
  slotStartMinute: number,
  durationMinutes: number,
  ranges: OccupiedRange[]
): OccupiedRange | null {
  const slotEndMinute = slotStartMinute + durationMinutes;
  return (
    ranges.find(
      (range) => slotStartMinute < range.endMinute && slotEndMinute > range.startMinute
    ) ?? null
  );
}
