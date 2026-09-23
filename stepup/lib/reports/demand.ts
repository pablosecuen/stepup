/**
 * Puerto de `buildCalendarDemandSummary` (móvil, `calendarDemandSummary.ts`)
 * — SIEMPRE últimos 90 días (`DEMAND_LOOKBACK_DAYS`), no configurable por
 * el usuario (el móvil no tiene selector de rango para esta tarjeta). Una
 * clase GRUPAL cuenta una sola vez (nunca por participante) — el input ya
 * es "una ocurrencia", no "una por alumno". Pura.
 */
export const DEMAND_LOOKBACK_DAYS = 90;
const SLOT_MINUTES = 30;

export interface OccurrenceForDemand {
  startAt: string; // ISO instant
  timeZone: string;
}

export interface DemandSlot {
  weekday: number; // 0=domingo..6=sábado (mismo criterio que Date.getUTCDay tras convertir a zona real)
  slotStartMinuteOfDay: number; // minutos desde medianoche, múltiplo de 30
  count: number;
}

export interface CalendarDemandSummary {
  totalOccurrences: number;
  topWeekdays: number[]; // empates soportados
  topSlots: { weekday: number; slotStartMinuteOfDay: number }[]; // empates soportados
  slotCounts: DemandSlot[];
}

function localWeekdayAndMinuteOfDay(instantIso: string, timeZone: string): { weekday: number; minuteOfDay: number } {
  const date = new Date(instantIso);
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const parts = new Map(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.get("weekday") ?? "Sun"] ?? 0;
  const minuteOfDay = Number(parts.get("hour")) * 60 + Number(parts.get("minute"));
  return { weekday, minuteOfDay };
}

export function buildCalendarDemandSummary(occurrences: readonly OccurrenceForDemand[]): CalendarDemandSummary {
  const counts = new Map<string, DemandSlot>();
  const weekdayTotals = new Map<number, number>();

  occurrences.forEach((occurrence) => {
    const { weekday, minuteOfDay } = localWeekdayAndMinuteOfDay(occurrence.startAt, occurrence.timeZone);
    const slotStartMinuteOfDay = Math.floor(minuteOfDay / SLOT_MINUTES) * SLOT_MINUTES;
    const key = `${weekday}:${slotStartMinuteOfDay}`;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { weekday, slotStartMinuteOfDay, count: 1 });
    weekdayTotals.set(weekday, (weekdayTotals.get(weekday) ?? 0) + 1);
  });

  const slotCounts = [...counts.values()].sort((a, b) => (a.weekday - b.weekday) || (a.slotStartMinuteOfDay - b.slotStartMinuteOfDay));

  const maxWeekdayCount = Math.max(0, ...weekdayTotals.values());
  const topWeekdays = maxWeekdayCount > 0 ? [...weekdayTotals.entries()].filter(([, count]) => count === maxWeekdayCount).map(([weekday]) => weekday).sort((a, b) => a - b) : [];

  const maxSlotCount = Math.max(0, ...slotCounts.map((s) => s.count));
  const topSlots =
    maxSlotCount > 0
      ? slotCounts.filter((s) => s.count === maxSlotCount).map((s) => ({ weekday: s.weekday, slotStartMinuteOfDay: s.slotStartMinuteOfDay }))
      : [];

  return { totalOccurrences: occurrences.length, topWeekdays, topSlots, slotCounts };
}
