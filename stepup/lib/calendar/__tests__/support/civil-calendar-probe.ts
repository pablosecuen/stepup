/**
 * Sonda para `civil-calendar-cross-timezone.test.ts`: se ejecuta como proceso
 * hijo con distintos `TZ` (el servidor de Vercel corre en UTC; el navegador de
 * la profesora, en America/Argentina/Buenos_Aires) y vuelca como JSON TODO lo
 * que el Calendario renderiza o navega para un instante fijo. Si servidor y
 * cliente produjeran algo distinto, React reportaría hydration mismatch
 * (error #418) y la grilla mostraría los días corridos.
 *
 * Modos `legacy-server` / `legacy-client`: reproducen a propósito la lógica
 * ANTERIOR (Date creado con `new Date(año, mes, día)` en el servidor, cruzando
 * la frontera como instante ISO, y releído con getters locales en el cliente)
 * para demostrar que la prueba SÍ detecta el defecto original.
 */
import { formatCivilDayLabel, formatCivilDayLabelShort, formatWeekRangeLabel, instantTimeLabel, resolveCalendarWindow, dayOfMonth, weekdayIndexMondayFirst, todayDateKey } from "../../civil-calendar.ts";
import { addDaysToDateKey } from "../../timezone.ts";
import { groupItemsByDayKey, layoutDayItems, currentTimeTop, WEEKDAY_SHORT } from "../../layout.ts";
import type { CalendarViewItem } from "../../occurrences.ts";

const NOW_ISO = process.argv[3] ?? "2026-10-03T20:07:00.000Z"; // sábado 3/oct/2026 17:07 en Buenos Aires
const mode = process.argv[2] ?? "current";

function item(id: string, startIso: string, minutes: number): CalendarViewItem {
  return {
    id,
    recurrenceId: null,
    occurrenceKey: null,
    materializedLessonId: id,
    isMaterialized: true,
    studentId: "s",
    participantIds: [],
    studentName: "PRUEBA",
    level: "A1",
    lessonType: "individual",
    title: null,
    start: startIso,
    end: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
    modality: "online",
    status: "scheduled",
    activityKind: "class",
    isRecurring: false,
    freedByLessonId: null,
    notes: null,
  } as CalendarViewItem;
}

// Instantes frontera (hora de Buenos Aires = UTC-3): lunes 08:00, sábado 20:59, sábado 21:00 (ya es domingo en UTC), domingo 23:30.
const ITEMS = [
  item("lun-0800", "2026-09-28T11:00:00.000Z", 60),
  item("sab-2059", "2026-10-03T23:59:00.000Z", 30),
  item("sab-2100", "2026-10-04T00:00:00.000Z", 60),
  item("dom-2330", "2026-10-05T02:30:00.000Z", 30),
];

const now = new Date(NOW_ISO);

if (mode === "legacy-client") {
  // Cliente: recibe los instantes ISO que serializó el servidor y los lee con getters locales (grid/toolbar anteriores).
  const wire: string[] = JSON.parse(process.argv[4] ?? "[]");
  const client = wire.map((iso) => new Date(iso));
  console.log(JSON.stringify({ dayKeys: client.map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`) }));
} else if (mode === "legacy-server") {
  // Servidor: lógica anterior de page.tsx, tal cual.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const today = new Date(num("year"), num("month") - 1, num("day"));
  const jsDay = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() + (jsDay === 0 ? -6 : 1 - jsDay));
  weekStart.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  // Lo que cruza servidor→navegador: instantes ISO.
  console.log(JSON.stringify({ wire: days.map((d) => d.toISOString()) }));
} else {
  const params = { week: undefined, day: undefined, view: undefined };
  const win = resolveCalendarWindow(params, now);
  const byDay = groupItemsByDayKey(ITEMS);
  const out = {
    window: win,
    weekLabel: formatWeekRangeLabel(win.weekStartKey),
    dayLabel: formatCivilDayLabel(win.todayKey),
    dayLabelShort: formatCivilDayLabelShort(win.todayKey),
    header: win.dayKeys.map((key) => ({ key, weekday: WEEKDAY_SHORT[weekdayIndexMondayFirst(key)], dom: dayOfMonth(key), today: todayDateKey(now) === key })),
    columns: win.dayKeys.map((key) => ({
      key,
      cards: layoutDayItems(byDay.get(key) ?? []).map((p) => ({ id: p.item.id, top: p.top, height: p.height, time: instantTimeLabel(p.item.start) })),
    })),
    nowLineTop: currentTimeTop(now),
    hrefs: { previous: win.previousKey, next: win.nextKey, nextOfNext: addDaysToDateKey(win.nextKey, 7) },
    dayViewWindow: resolveCalendarWindow({ view: "day", day: "2026-10-04" }, now),
  };
  console.log(JSON.stringify(out));
}
// Zona real del proceso: la prueba comprueba que `TZ` realmente tomó efecto.
console.error(JSON.stringify({ offsetMinutes: new Date(NOW_ISO).getTimezoneOffset() }));
