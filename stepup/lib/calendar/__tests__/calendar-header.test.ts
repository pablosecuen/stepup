import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { calendarAnchorKey, calendarHeaderNav } from "../header.ts";
import { formatCivilMonthYear } from "../../format/date-format.ts";
import { addDaysToDateKey } from "../timezone.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("formatCivilMonthYear: mes y año en español y minúscula; clave inválida → texto de reemplazo", () => {
  assert.equal(formatCivilMonthYear("2026-10-14"), "octubre 2026");
  assert.equal(formatCivilMonthYear("2026-01-01"), "enero 2026");
  assert.equal(formatCivilMonthYear("2026-12-31"), "diciembre 2026");
  assert.equal(formatCivilMonthYear("2027-09-30"), "septiembre 2027");
  for (const bad of [null, undefined, "", "2026-13-01", "2026-10", "14/10/2026", "2026-10-32"]) assert.equal(formatCivilMonthYear(bad), "—", String(bad));
  assert.equal(formatCivilMonthYear("nada", "sin fecha"), "sin fecha");
  for (let month = 1; month <= 12; month++) {
    const label = formatCivilMonthYear(`2026-${String(month).padStart(2, "0")}-15`);
    assert.equal(label, label.toLowerCase(), "siempre en minúscula");
    assert.match(label, /^[a-zé]+ 2026$/);
  }
});

test("el mes del encabezado sale de la fecha ancla: el día visible en Día, el jueves de la semana en Semana (el mes con más días de esa semana)", () => {
  // semana 12–18 oct 2026
  assert.equal(calendarAnchorKey("week", "2026-10-12", "2026-10-14"), "2026-10-15");
  assert.equal(calendarAnchorKey("day", "2026-10-12", "2026-10-14"), "2026-10-14");
  assert.equal(calendarHeaderNav("week", "2026-10-12", "2026-10-14").monthLabel, "octubre 2026");
  assert.equal(calendarHeaderNav("day", "2026-10-12", "2026-10-14").monthLabel, "octubre 2026");
  // semana que cruza de mes: 28 sept – 4 oct (4 días de octubre) y 26 oct – 1 nov (6 de octubre)
  assert.equal(calendarHeaderNav("week", "2026-09-28", "2026-09-28").monthLabel, "octubre 2026");
  assert.equal(calendarHeaderNav("week", "2026-10-26", "2026-10-26").monthLabel, "octubre 2026");
  // 31 ago – 6 sept (6 de septiembre), 29 dic 2025 – 4 ene 2026 (4 de enero: cruza de año)
  assert.equal(calendarHeaderNav("week", "2026-08-31", "2026-08-31").monthLabel, "septiembre 2026");
  assert.equal(calendarHeaderNav("week", "2025-12-29", "2025-12-29").monthLabel, "enero 2026");
  // en Día el mes es el del propio día aunque la semana de referencia sea otra
  assert.equal(calendarHeaderNav("day", "2026-09-28", "2026-09-30").monthLabel, "septiembre 2026");
  assert.equal(calendarHeaderNav("day", "2026-09-28", "2026-10-01").monthLabel, "octubre 2026");
  // el jueves es siempre el mes mayoritario: se verifica a lo largo de un año completo de semanas
  for (let offset = 0; offset < 53; offset++) {
    const monday = addDaysToDateKey("2026-01-05", offset * 7);
    const counts = new Map<string, number>();
    for (let d = 0; d < 7; d++) {
      const month = addDaysToDateKey(monday, d).slice(0, 7);
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(calendarAnchorKey("week", monday, monday).slice(0, 7), majority, `semana de ${monday}`);
  }
});

test("nombres accesibles de las flechas según la vista: Semana anterior/siguiente y Día anterior/siguiente", () => {
  const week = calendarHeaderNav("week", "2026-10-12", "2026-10-14");
  assert.equal(week.previousLabel, "Semana anterior");
  assert.equal(week.nextLabel, "Semana siguiente");
  const day = calendarHeaderNav("day", "2026-10-12", "2026-10-14");
  assert.equal(day.previousLabel, "Día anterior");
  assert.equal(day.nextLabel, "Día siguiente");
});

test("barra de navegación: sólo flecha · mes y año · flecha; sin «Hoy» ni el rango de la semana; botones de 44 px; las fechas de los enlaces no cambian", () => {
  const toolbar = code("components/calendar/real-calendar-toolbar.tsx");
  assert.doesNotMatch(toolbar, /Hoy|todayHref|Ir a hoy/, "sin botón «Hoy»");
  assert.doesNotMatch(toolbar, /formatCivilWeek|formatCivilDayLabel|formatCivilDayRange/, "sin rango repetido (ya lo dicen las columnas)");
  assert.match(toolbar, /aria-label=\{previousLabel\}/);
  assert.match(toolbar, /aria-label=\{nextLabel\}/);
  assert.match(toolbar, /h-11 w-11/, "44 px");
  assert.match(toolbar, /\{monthLabel\}/);
  assert.match(toolbar, /addDaysToDateKey\(weekStartKey, -7\)/);
  assert.match(toolbar, /addDaysToDateKey\(weekStartKey, 7\)/);
  assert.match(toolbar, /addDaysToDateKey\(dayKey, -1\)/);
  assert.match(toolbar, /addDaysToDateKey\(dayKey, 1\)/);
  assert.doesNotMatch(toolbar, /first-letter:uppercase|uppercase/, "el mes va en minúscula");
  assert.doesNotMatch(toolbar, /<input|type="date"|DatePicker/i, "sin selector de fecha nuevo");
  // la URL la arma la página como antes
  const page = code("app/(app)/calendario/page.tsx");
  assert.match(page, /if \(nextView === "week" && overrides\.week\) query\.set\("week", overrides\.week\);/);
  assert.match(page, /if \(nextView === "day" && overrides\.day\) query\.set\("day", overrides\.day\);/);
});

test("encabezado: título reducido y, debajo, Series, Disponibilidad y Clases por registrar; la navegación del mes arriba a la derecha", () => {
  const view = code("components/calendar/calendar-view.tsx");
  assert.match(view, /<PageTitle compact>Calendario<\/PageTitle>/);
  const links = ["/calendario/series", "/calendario/disponibilidad", "/registro"].map((href) => view.indexOf(`href="${href}"`));
  assert.ok(links.every((index) => index > 0) && links[0] < links[1] && links[1] < links[2], "los tres accesos, en orden");
  assert.ok(view.indexOf("<PageTitle") < links[0], "los accesos van debajo del título");
  assert.ok(links[2] < view.indexOf("<RealCalendarToolbar"), "la navegación del mes va a la derecha del bloque izquierdo");
  assert.match(view, /nav:h-dvh/, "en escritorio la pantalla mide 100dvh: la página no se desplaza");
  const header = code("components/ui/page-header.tsx");
  assert.match(header, /PAGE_TITLE_COMPACT_CLASS =\s+"[^"]*text-\[28px\][^"]*nav:text-\[30px\]"/);
  assert.ok(Number(/PAGE_TITLE_CLASS =\s+"[^"]*nav:text-\[(\d+)px\]"/.exec(header)?.[1]) > 30, "el título normal sigue igual");
});

test("fila de controles: Densidad · Semana/Día · Nueva clase en tres columnas, con Semana/Día realmente centrado y Nueva clase como acción principal", () => {
  const workspace = code("components/calendar/calendar-workspace.tsx");
  assert.match(workspace, /nav:grid-cols-\[1fr_auto_1fr\]/, "dos columnas laterales iguales: el centro queda centrado respecto del contenido");
  const order = ["<CalendarDensityPicker", "<CalendarViewSwitch", "<PrivateButtonLink"].map((tag) => workspace.indexOf(tag));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], "izquierda, centro, derecha");
  assert.match(workspace, /nav:justify-self-start[\s\S]*<CalendarDensityPicker/);
  assert.match(workspace, /nav:justify-self-center[\s\S]*<CalendarViewSwitch/);
  assert.match(workspace, /nav:justify-self-end[\s\S]*<PrivateButtonLink href=\{newClassHref\} variant="accent"/);
  assert.match(workspace, /Nueva clase/);
  assert.match(code("components/calendar/calendar-view.tsx"), /newClassHref="\/calendario\/nueva"/, "misma ruta de Nueva clase");
  assert.match(workspace, /<RealCalendarGrid dayKeys=\{dayKeys\} items=\{items\} density=\{density\} \/>/, "la grilla comienza inmediatamente debajo");
  assert.match(workspace, /readStoredCalendarDensity\(storage\)/);
  assert.match(workspace, /writeStoredCalendarDensity\(window\.localStorage, next\)/);
  assert.match(workspace, /useState<CalendarDensityKey>\(DEFAULT_CALENDAR_DENSITY\)/, "mismo valor por defecto en servidor y navegador");
  const switcher = code("components/calendar/calendar-view-switch.tsx");
  assert.match(switcher, /aria-current=\{isWeek \? "true" : undefined\}/);
  assert.match(switcher, /aria-current=\{!isWeek \? "true" : undefined\}/);
  assert.match(switcher, /Semana[\s\S]*Día/);
  assert.match(switcher, /min-h-11/);
});

test("selector de densidad: un control pequeño de 150–180 px, sin terracota, con nombre «Densidad del calendario», teclado completo y sólo en escritorio", () => {
  const picker = code("components/calendar/calendar-density-picker.tsx");
  assert.match(picker, /role="combobox"/);
  assert.match(picker, /aria-label="Densidad del calendario"/);
  assert.match(picker, /aria-haspopup="listbox"/);
  assert.match(picker, /aria-expanded=\{open\}/);
  assert.match(picker, /role="listbox"/);
  assert.match(picker, /role="option"/);
  assert.match(picker, /aria-selected=\{selected\}/);
  assert.match(picker, /aria-activedescendant/);
  assert.match(picker, /Densidad: \{calendarDensityLabel\(value\)\}/, "cerrado muestra sólo el valor actual");
  const widths = [...picker.matchAll(/w-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  assert.ok(widths.length >= 1 && widths.every((w) => w >= 150 && w <= 180), `ancho ${widths}`);
  assert.doesNotMatch(picker, /accent|terracota|bg-ink|bg-primary/, "bajo contraste visual: borde neutro, sin color de acción");
  assert.match(picker, /border-border/);
  assert.equal((picker.match(/min-h-11/g) ?? []).length >= 2, true, "el botón y las opciones miden 44 px");
  assert.match(picker, /hidden nav:block/, "oculto en móvil");
  assert.match(picker, /focus-visible:shadow-focus/, "foco visible");
  // teclado
  assert.match(picker, /event\.key === "Escape"/);
  assert.match(picker, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(picker, /moveActiveDensity\(index, event\.key as DensityPickerKey\)/);
  assert.match(picker, /event\.key === "Tab"/);
  assert.match(picker, /buttonRef\.current\?\.focus\(\)/, "el foco vuelve al botón");
  assert.match(picker, /document\.addEventListener\("pointerdown", closeOnOutsidePointer\)/);
  assert.doesNotMatch(picker, /animate|transition-(?:all|transform|opacity)|duration-/, "sin animaciones que reducir");
  assert.match(picker, /motion-reduce:transition-none/);
  // las tres opciones salen de la lista única
  assert.match(picker, /CALENDAR_DENSITIES\.map\(/);
});

test("móvil: la agenda por día no cambia y los controles se apilan sin comprimir tres columnas", () => {
  const workspace = code("components/calendar/calendar-workspace.tsx");
  assert.match(workspace, /className="grid gap-3 nav:grid-cols-\[1fr_auto_1fr\]/, "una columna en móvil");
  assert.match(workspace, /className="w-full nav:w-auto"/, "Nueva clase ocupa el ancho en móvil");
  const switcher = code("components/calendar/calendar-view-switch.tsx");
  assert.match(switcher, /w-full[\s\S]*nav:w-auto/);
  assert.match(switcher, /flex-1[\s\S]*nav:flex-none/);
  const toolbar = code("components/calendar/real-calendar-toolbar.tsx");
  assert.match(toolbar, /justify-between[\s\S]*nav:justify-end/, "en móvil la fila del mes ocupa el ancho; en escritorio va a la derecha");
  // el recorte de altura sólo existe en escritorio
  const view = code("components/calendar/calendar-view.tsx");
  assert.doesNotMatch(view.replace(/nav:h-dvh/g, ""), /\bh-dvh\b|\bh-screen\b/);
});
