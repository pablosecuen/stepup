import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Inicio: franja de indicadores compacta, «Clases de hoy» completa como contenido principal y Cobros/Recordatorios debajo. Cableado (la medición real se hace en el navegador). */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEW = code("components/dashboard/home-view.tsx");
const AGENDA = code("components/dashboard/today-agenda.tsx");
const LOADER = code("lib/dashboard/load-home-data.ts");

test("indicadores compactos: sin las clases tipográficas del diseño grande, sombra sutil, iconos chicos y los tres en una fila", () => {
  const kpi = VIEW.slice(VIEW.indexOf("function Kpi("), VIEW.indexOf("export function HomeView"));
  assert.doesNotMatch(kpi, /text-\[30px\]|text-\[40px\]|nav:text-\[40px\]|nav:py-4|nav:px-\[18px\]|mt-1\.5 block/, "ninguna clase del diseño grande anterior");
  assert.match(kpi, /min-\[480px\]:text-\[28px\]/, "cifra de 28 px (antes 40)");
  assert.match(kpi, /text-\[22px\]/, "y 22 px en móvil (antes 30)");
  assert.match(kpi, /h-3\.5 w-3\.5/, "iconos de 14 px (antes 16)");
  assert.match(kpi, /shadow-subtle/, "sombra más sutil");
  assert.doesNotMatch(kpi, /shadow-card/);
  assert.match(kpi, /min-\[480px\]:py-3/, "relleno vertical compacto");
  assert.match(VIEW, /<section aria-label="Resumen del día" className="mt-5 grid grid-cols-1 gap-2 min-\[480px\]:grid-cols-3 nav:gap-3\.5">/, "tres en una fila desde 480 px; filas de 44 px en móvil");
  assert.match(kpi, /min-h-11/, "objetivos de 44 px");
  // los tres conservan nombre, valor y destino
  for (const label of ["Clases de hoy", "Por registrar", "Recordatorios"]) assert.ok(VIEW.includes(`label="${label}"`), label);
  assert.match(VIEW, /value=\{todayCount\}/);
  assert.match(VIEW, /value=\{data\.pendingLessons\.length\}[\s\S]*href="\/registro"/);
  assert.match(VIEW, /value=\{remindersCount\}[\s\S]*href="\/recordatorios"/);
  assert.match(kpi, /focus-visible:ring-2/, "foco visible en los interactivos");
});

test("«Clases de hoy» es el contenido principal: la agenda completa del día, sin límite ni «Ver todas», con estado vacío compacto", () => {
  const agendaSection = VIEW.slice(VIEW.indexOf('aria-labelledby="clases-de-hoy"'), VIEW.indexOf("{(showCollections || showReminders)"));
  assert.match(agendaSection, /<TodayAgenda entries=\{data\.todayAgenda\} allItems=\{data\.todayAllItems\} nowIso=\{data\.nowIso\}/);
  assert.doesNotMatch(agendaSection + AGENDA, /\.slice\(|MAX_VISIBLE|Ver todas|overflow-y-auto|max-h-|line-clamp/, "sin recortes ni scroll interno: la sección crece con el día");
  assert.match(agendaSection, /No hay clases agendadas para hoy\./);
  assert.match(agendaSection, /max-w-\[540px\] rounded-md border-2 border-dashed/, "estado vacío compacto, no una caja enorme");
  assert.doesNotMatch(agendaSection, /EmptyState|py-9/);
  // los datos salen de lo ya cargado para el día: una sola lectura acotada, sin consultas por clase
  assert.match(LOADER, /const todayAgenda = buildTodayAgenda\(todayItems, now, todayDateKey\);/);
  assert.equal((LOADER.match(/listCalendarLessonsInRange\(/g) ?? []).length, 3, "las mismas tres lecturas de rango de siempre (hoy, horizonte y 90 días): ninguna más");
  assert.match(LOADER, /listCalendarLessonsInRange\(ctx, dayStart\.toISOString\(\), dayEndExclusive\.toISOString\(\)\)/, "hoy: UNA consulta acotada al día civil de Argentina");
  const agendaBuilder = code("lib/dashboard/today-agenda.ts");
  assert.doesNotMatch(agendaBuilder, /await|ctx\.|supabase|fetch\(|async /, "función pura sobre lo ya cargado: sin N+1");
  assert.match(agendaBuilder, /instantDateKey\(item\.start\) === todayDateKey/, "el día civil de Argentina decide qué entra");
  assert.match(agendaBuilder, /visibleCalendarItems\(all\)/, "la agenda válida del Calendario");
});

test("cada fila es interactiva (el botón ocupa toda la fila), con foco visible y abre el detalle existente de la clase", () => {
  assert.match(AGENDA, /<button\s+type="button"\s+onClick=\{\(\) => setSelected\(item\)\}/);
  assert.match(AGENDA, /aria-haspopup="dialog"/);
  assert.match(AGENDA, /grid min-h-14 w-full/, "toda la fila (≥ 56 px de alto)");
  assert.match(AGENDA, /focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/, "foco visible");
  assert.match(AGENDA, /<RealLessonDetailModal item=\{selected\} canReuseSlot=\{getCancelledSlotReuseDecision\(selected, allItems, now\)\.eligible\} onClose=\{\(\) => setSelected\(null\)\} \/>/, "el mismo detalle del Calendario");
  assert.match(AGENDA, /sr-only">hasta </, "la hora de fin se lee «hasta»");
  // información mostrada: hora inicio-fin, alumno o título, modalidad y estado REAL
  assert.match(AGENDA, /formatInstantTime\(item\.start\)/);
  assert.match(AGENDA, /formatInstantTime\(item\.end\)/);
  assert.match(AGENDA, /agendaLessonLabel\(item\)/);
  assert.match(AGENDA, /MODALITY_LABEL\[item\.modality\]/);
  for (const state of ["STATUS_LABELS.cancelled", "STATUS_LABELS.rescheduled", "STATUS_LABELS.completed", '"En curso"', '"Sigue"', '"Pasada"']) assert.ok(AGENDA.includes(state), `estado ${state}`);
  assert.match(AGENDA, /line-through/, "la cancelada se tacha además de decirlo con texto");
  assert.doesNotMatch(AGENDA, /Math\.random|Faltó|Ausente|Pagada|Pagó/, "ningún estado inventado");
});

test("escritorio: columna principal con Clases de hoy y, debajo, Cobros y Recordatorios lado a lado; Clases por registrar a la derecha", () => {
  assert.match(VIEW, /nav:grid-cols-\[minmax\(0,1\.55fr\)_minmax\(0,1fr\)\]/, "columna izquierda más ancha");
  const left = VIEW.indexOf('aria-labelledby="clases-de-hoy"');
  const right = VIEW.indexOf('title="Clases por registrar"');
  assert.ok(left > 0 && right > left);
  const leftColumn = VIEW.slice(left, right);
  const rightColumn = VIEW.slice(right);
  assert.ok(leftColumn.indexOf('aria-labelledby="clases-de-hoy"') < leftColumn.indexOf('href="/cobros"'), "Clases de hoy antes que Cobros");
  assert.ok(leftColumn.indexOf('href="/cobros"') < leftColumn.indexOf('aria-labelledby="recordatorios-resumen"'), "Cobros y luego Recordatorios");
  assert.match(leftColumn, /grid grid-cols-1 items-start gap-5 xl:grid-cols-2/, "dos tarjetas lado a lado cuando entran");
  assert.match(rightColumn, /title="Clases por registrar"/);
  assert.doesNotMatch(rightColumn, /href="\/cobros"|recordatorios-resumen/, "Cobros y Recordatorios ya no van abajo de la columna derecha");
  // Cobros: los valores reales y «Ver»; sin nombres ni importes
  assert.match(leftColumn, /collectionsUrgency\.dueToday\} vence/);
  assert.match(leftColumn, /collectionsUrgency\.overdueCount\} vencido/);
  assert.doesNotMatch(VIEW, /collectionEntries|formatMoney|balanceCents|\.amount/, "ningún nombre ni importe de cobros en Inicio");
  // Recordatorios: el total, el resumen real por categoría y «Ver»
  assert.match(leftColumn, /<Badge>\{remindersCount\}<\/Badge>/);
  assert.match(leftColumn, /data\.remindersSummary\.categories\.map/);
  assert.match(leftColumn, /<Link href="\/recordatorios" className=\{linkClass\(\)\}>\s*Ver/);
});

test("móvil: el orden del documento es indicadores → Clases de hoy → Cobros → Recordatorios → Clases por registrar", () => {
  const order = ['aria-label="Resumen del día"', 'aria-labelledby="clases-de-hoy"', 'href="/cobros"', 'aria-labelledby="recordatorios-resumen"', 'title="Clases por registrar"'].map((needle) => VIEW.indexOf(needle));
  assert.ok(order.every((i) => i > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "una sola columna: el mismo orden del DOM");
  assert.match(VIEW, /mt-5 grid grid-cols-1 items-start gap-5/, "una columna por defecto (sin columnas comprimidas)");
});

test("preserva lo ya aprobado en Inicio: campana, un solo h1, accesos y primeros pasos", () => {
  assert.equal((VIEW.match(/<h1/g) ?? []).length, 1);
  assert.match(VIEW, /href="\/recordatorios"[\s\S]{0,200}h-11 w-11/, "la campana de 44 px");
  assert.match(VIEW, /\{onboarding && <FirstSteps/);
  assert.match(VIEW, /className=\{PAGE_WIDTH\.wide\}/);
  assert.doesNotMatch(VIEW, /Cerrar sesión|SignOutButton/, "Cerrar sesión lo pone el shell en su fila");
});
