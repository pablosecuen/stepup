/** Geometry from the original mobile calendar's calendarDayGridLayout/WeekTimeGrid. */
export function mobileCalendarHourFit(availablePx: number, dayCount: number): { hourHeightPx: number; overflows: boolean } {
  const available = Number.isFinite(availablePx) ? Math.max(0, availablePx) : 0;
  const hourHeightPx = dayCount > 1
    ? Math.max(50, available / 14)
    : Math.min(56, Math.max(34, available / 13));
  return { hourHeightPx, overflows: hourHeightPx * 14 > available };
}
