/** Five whole, equal days fit beside the hour rail; the remaining days stay scrollable. */
export function mobileFiveDayTracks(areaWidthPx: number, timeColumnPx: number, dayCount: number) {
  const count = Math.max(1, Math.trunc(dayCount));
  const width = Math.max(0, areaWidthPx - timeColumnPx) / Math.min(5, count);
  return { trackPx: Array.from({ length: count }, () => width), totalPx: timeColumnPx + count * width, expanded: count > 5 };
}

export function mobileDayHeading(dayIndex: number, day: number): string {
  return `${["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][dayIndex]} ${day}`;
}
