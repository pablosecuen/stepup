import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Inicio (rediseño): resumen editorial sin tarjetas, franja de «Próxima clase», «Tu día» como línea de tiempo y pendientes a la derecha. Cableado (la medición real se hace en el navegador). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEW = code("components/dashboard/home-view.tsx");
const PLANNER = code("components/dashboard/day-planner.tsx");
const LOADER = code("lib/dashboard/load-home-data.ts");

test("resumen del día: indicadores editoriales pequeños, sin tarjetas, con nombre, valor y destino", () => {
  const figure = VIEW.slice(VIEW.indexOf("function Figure("), VIEW.indexOf("function PanelHeader("));
  assert.doesNotMatch(figure, /shadow-card|shadow-subtle|rounded-xl|bg-surface|border-\[1\.5px\]/, "sin caja ni sombra: cifra y palabra");
  assert.match(figure, /font-display text-\[34px\]/, "cifra editorial en serifa");
  assert.match(VIEW, /<section aria-label="Resumen del día"[^>]*className=\{`\$\{ENTER\} mt-5 flex items-stretch divide-x divide-border border-y border-border py-3`\}>/, "una fila con separadores finos, sin tarjetas");
  assert.match(VIEW, /<Figure value=\{todayCount\}/);
  assert.match(VIEW, /<Figure value=\{pending\.length\}[^>]*href="\/registro"/);
  assert.match(VIEW, /<Figure value=\{remindersCount\}[^>]*href="\/recordatorios"/);
  assert.match(figure, /min-h-11/, "objetivo táctil de 44 px");
  assert.match(figure, /focus-visible:ring-2/, "foco visible");
});

test("próxima clase: franja compacta de ≈ 112 px con hora, nombre, modalidad y «Ver detalle», sin imágenes ni decoración", () => {
  assert.match(PLANNER, /min-h-\[112px\] w-full/, "franja compacta, no un panel enorme");
  assert.match(PLANNER, /bg-side/, "fondo oscuro de la identidad");
  assert.match(PLANNER, /Próxima clase/);
  assert.match(PLANNER, /formatInstantTime\(next\.item\.start\)/, "hora");
  assert.match(PLANNER, /agendaLessonLabel\(next\.item\)/, "alumno o título");
  assert.match(PLANNER, /MODALITY_LABEL\[next\.item\.modality\]/, "modalidad");
  assert.match(PLANNER, /Ver detalle/);
  assert.match(PLANNER, /RealLessonDetailModal/, "abre el detalle existente");
  // estado vacío breve y útil
  assert.match(PLANNER, /No hay clases agendadas para hoy\./);
  assert.match(PLANNER, /No tenés más clases hoy\./);
  assert.match(PLANNER, /href="\/calendario"/);
});

test("sin imágenes, fotografías ni decoración en Inicio", () => {
  for (const source of [VIEW, PLANNER]) assert.doesNotMatch(source, /next\/image|<img\b|<Image\b|background-image|bg-\[url|backgroundImage|\.(jpg|jpeg|png|webp|svg)\b/i);
});

test("«Tu día»: línea de tiempo con todas las clases del día, sin límite ni recortes, simultáneas agrupadas y marca «Ahora»", () => {
  assert.match(PLANNER, /<section aria-labelledby="tu-dia"/);
  assert.match(PLANNER, /<ol data-today-agenda/);
  assert.match(PLANNER, /\{entries\.length > 0 && \(\s*<section aria-labelledby="tu-dia"/, "sin clases, la franja de arriba es el único estado vacío");
  assert.doesNotMatch(PLANNER, /\.slice\(|MAX_VISIBLE|Ver todas|overflow-y-auto|max-h-|line-clamp|truncate/, "sin recortes ni scroll interno");
  assert.match(PLANNER, /function groupByStart/, "simultáneas");
  assert.match(PLANNER, /a la misma hora/, "las simultáneas se dicen con texto");
  assert.match(PLANNER, /function NowMarker/);
  assert.match(PLANNER, /firstOpenIndex/, "«Ahora» antes de la primera clase no terminada");
  for (const state of ["STATUS_LABELS.cancelled", "STATUS_LABELS.rescheduled", "STATUS_LABELS.completed", '"En curso"', '"Sigue"', '"Pasada"']) assert.ok(PLANNER.includes(state), `estado ${state}`);
  assert.match(PLANNER, /line-through/, "la cancelada se tacha además de decirlo con texto");
  assert.doesNotMatch(PLANNER, /Math\.random|Faltó|Ausente|Pagada|Pagó/, "ningún estado inventado");
  // los datos salen de lo ya cargado: una sola lectura acotada al día, sin consultas por clase
  assert.match(LOADER, /const todayAgenda = buildTodayAgenda\(todayItems, now, todayDateKey\);/);
  assert.equal((LOADER.match(/listCalendarLessonsInRange\(/g) ?? []).length, 3, "las mismas tres lecturas de rango de siempre: ninguna más");
  const builder = code("lib/dashboard/today-agenda.ts");
  assert.doesNotMatch(builder, /await|ctx\.|supabase|fetch\(|async /, "función pura sobre lo ya cargado: sin N+1");
  assert.match(builder, /instantDateKey\(item\.start\) === todayDateKey/, "el día civil de Argentina decide qué entra");
});

test("cada fila de «Tu día» es un botón nativo de toda la fila (≥ 56 px), con foco visible; un doble clic no duplica nada", () => {
  assert.match(PLANNER, /<button\s+type="button"\s+onClick=\{\(\) => setSelected\(item\)\}/);
  assert.match(PLANNER, /grid min-h-14 w-full/);
  assert.match(PLANNER, /focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/);
  // abrir es idempotente: sólo fija la clase elegida (no crea, no escribe, no navega)
  assert.match(PLANNER, /useState<CalendarViewItem \| null>\(null\)/);
  assert.doesNotMatch(PLANNER, /fetch\(|supabase|\.rpc\(|router\.(push|refresh)/);
  assert.match(PLANNER, /canReuseSlot=\{getCancelledSlotReuseDecision\(selected, allItems, now\)\.eligible\}/, "el mismo detalle del Calendario");
});

test("escritorio: «Tu día» a la izquierda y, a la derecha, Clases por registrar → Recordatorios → Cobros de hoy", () => {
  assert.match(VIEW, /nav:grid-cols-\[minmax\(0,1\.7fr\)_minmax\(0,1fr\)\]/);
  const planner = VIEW.indexOf("<DayPlanner");
  const pending = VIEW.indexOf('aria-labelledby="por-registrar"');
  const reminders = VIEW.indexOf('aria-labelledby="recordatorios-resumen"');
  const collections = VIEW.indexOf('aria-labelledby="cobros-hoy"');
  assert.ok(planner > 0 && pending > planner && reminders > pending && collections > reminders, "mismo orden en escritorio y en móvil");
  assert.match(VIEW, /urgency\.dueToday/);
  assert.match(VIEW, /urgency\.overdueCount/);
  assert.match(VIEW, /<Link href="\/cobros"/, "enlace a Cobros");
  assert.doesNotMatch(VIEW, /collectionEntries|formatMoney|balanceCents|\.amount/, "ningún nombre ni importe de cobros en Inicio");
});

test("móvil: una sola columna, con los pendientes debajo de «Tu día»", () => {
  assert.match(VIEW, /mt-5 grid grid-cols-1 items-start gap-5/);
  assert.doesNotMatch(VIEW, /[\s"'`:]order-/, "el orden visual es el del documento");
});

test("movimiento discreto: entrada suave escalonada de 320 ms y hover, sin animaciones constantes, respetando prefers-reduced-motion", () => {
  const tailwind = read("tailwind.config.ts");
  assert.match(tailwind, /"tf-rise": "tf-rise 320ms cubic-bezier\(0\.22, 1, 0\.36, 1\) both"/);
  assert.match(VIEW, /ENTER = "motion-safe:animate-tf-rise"/, "la entrada sólo si el usuario no pidió menos movimiento");
  assert.match(PLANNER, /ENTER = "motion-safe:animate-tf-rise"/);
  const css = read("app/globals.css");
  const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
  assert.match(reduced, /animation-delay: 0s !important/);
  assert.doesNotMatch(VIEW + PLANNER, /animate-(pulse|spin|bounce|ping)|infinite/, "ninguna animación constante");
  for (const source of [VIEW, PLANNER]) {
    for (const duration of source.match(/duration-(\d+)/g) ?? []) assert.ok(Number(duration.slice(9)) >= 200 && Number(duration.slice(9)) <= 350, duration);
  }
});

test("preserva lo ya aprobado en Inicio: campana, un solo h1, «Nueva clase», primeros pasos y amplitud", () => {
  assert.equal((VIEW.match(/<h1/g) ?? []).length, 1);
  assert.match(VIEW, /href="\/recordatorios"[\s\S]{0,300}h-11 w-11/, "la campana de 44 px");
  assert.match(VIEW, /<PrivateButtonLink href="\/calendario\/nueva"/);
  assert.match(VIEW, /\{onboarding && <FirstSteps/);
  assert.match(VIEW, /className=\{`\$\{PAGE_WIDTH\.wide\}`\}/);
  assert.doesNotMatch(VIEW, /Cerrar sesión|SignOutButton/, "Cerrar sesión lo pone el shell en su fila");
});
