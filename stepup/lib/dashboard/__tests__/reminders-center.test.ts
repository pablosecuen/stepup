import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRemindersCenterSummary } from "../reminders-center.ts";
import type { EmptyClassItem } from "../../calendar/empty-classes.ts";

/**
 * Decisión del 24/11/2026: Recordatorios ya NO repite lo que tiene su bloque propio. Quedan fuera las clases sin registrar («Clases por
 * registrar» de Inicio y Registro) y los pagos próximos a vencer o vencidos («Cobros de hoy», el aviso diario y Cobros). Sólo sobrevive la
 * categoría que no vive en otro lado: las clases sin alumnos.
 */
function emptyItem(overrides: Partial<EmptyClassItem> = {}): EmptyClassItem {
  return { kind: "series", key: "series_r1", title: "Serie recurrente sin alumnos", startIso: "2026-09-23T13:00:00.000Z", ...overrides };
}

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("buildRemindersCenterSummary: sin clases vacías no hay categorías ni total (nunca un contador en cero)", () => {
  assert.deepEqual(buildRemindersCenterSummary({ emptyClassItems: [] }), { totalCount: 0, categories: [] });
});

test("buildRemindersCenterSummary: cuenta únicamente las clases sin alumnos", () => {
  const summary = buildRemindersCenterSummary({ emptyClassItems: [emptyItem(), emptyItem({ key: "series_r2", title: "Otra serie sin alumnos" })] });
  assert.equal(summary.totalCount, 2);
  assert.deepEqual(summary.categories.map((category) => category.kind), ["clases_sin_alumnos"]);
  assert.equal(summary.categories[0].label, "Clases sin alumnos");
  assert.deepEqual(summary.categories[0].items.map((item) => item.title), ["Serie recurrente sin alumnos", "Otra serie sin alumnos"]);
});

test("la fuente de los recordatorios ya no conoce clases sin registrar ni pagos (ni por vencer ni vencidos)", () => {
  const source = read("lib/dashboard/reminders-center.ts");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /clases_sin_registrar|pagos_por_vencer|pagos_vencidos|pendingLessons|collectionEntries|isOverdue|Pagos próximos|Pagos vencidos|Clases sin registrar/);
  const icons = read("components/reminders/reminder-icons.ts");
  assert.doesNotMatch(icons, /clases_sin_registrar|pagos_por_vencer|BanknotesIcon|ClipboardDocumentCheckIcon/);
});

test("el cargador de Inicio arma los recordatorios sólo con las clases vacías", () => {
  const loader = read("lib/dashboard/load-home-data.ts");
  assert.match(loader, /buildRemindersCenterSummary\(\{ emptyClassItems: emptyClasses\.items \}\)/);
  // Lo demás se sigue cargando para su bloque propio.
  assert.match(loader, /pendingLessons,/);
  assert.match(loader, /collectionsUrgency,/);
  assert.match(loader, /collectionEntries,/);
});

test("cableado: una sola fuente para Inicio (insignia, cifra, tarjeta) y «Ver todo»; Cobros de hoy, el aviso diario y Clases por registrar se conservan", () => {
  const home = read("components/dashboard/home-view.tsx");
  assert.match(home, /const remindersCount = data\.remindersSummary\.totalCount;/, "Inicio cuenta con el total de la fuente");
  assert.match(home, /<DailyCollectionsNotice /, "el aviso financiero específico de Inicio se conserva");
  assert.match(home, /title="Cobros de hoy"[^>]*linkLabel="Ver cobros"/, "«Cobros de hoy» y «Ver cobros» se conservan");
  assert.match(home, /title="Clases por registrar"[^>]*linkLabel=\{`Ver todas/, "«Clases por registrar» y «Ver todas» se conservan");
  const page = read("app/(app)/recordatorios/page.tsx");
  assert.match(page, /summary = data\.remindersSummary;/, "«Ver todo» usa el mismo resumen");
  for (const file of ["components/dashboard/home-view.tsx", "components/reminders/reminders-view.tsx", "app/(app)/recordatorios/page.tsx", "components/reminders/reminder-icons.ts"]) {
    assert.doesNotMatch(read(file), /pagos_vencidos|pagos_por_vencer|clases_sin_registrar|isOverdue|collectionEntries\.filter/, `${file} no tiene su propio filtro de pagos ni de clases por registrar`);
  }
});

test("Inicio: sin recordatorios no se dibuja la tarjeta ni su espacio (ni «No hay recordatorios»); el esqueleto tampoco la reserva", () => {
  const home = read("components/dashboard/home-view.tsx");
  assert.match(home, /\{remindersCount > 0 && \(\s*<section aria-labelledby="recordatorios-resumen"/, "la tarjeta sólo existe con recordatorios");
  assert.doesNotMatch(home, /No hay recordatorios pendientes/, "ninguna tarjeta de relleno");
  assert.doesNotMatch(home, /remindersCount > 0 \|\| !onboarding/, "ya no se muestra vacía en el estado normal");
  const skeleton = read("components/nav/screen-skeleton.tsx");
  const inicio = skeleton.slice(skeleton.indexOf("function InicioBody()"), skeleton.indexOf("function AlumnosBody"));
  assert.doesNotMatch(inicio, /title="Recordatorios"/, "el esqueleto de Inicio no reserva una tarjeta de Recordatorios");
  assert.match(inicio, /title="Cobros de hoy"/);
  assert.match(inicio, /title="Clases por registrar"/);
});

test("la portada es coherente: su Inicio ilustrativo ya no muestra pagos próximos a vencer como recordatorio", () => {
  const floats = read("components/landing/floats.tsx");
  const reminder = floats.slice(floats.indexOf("export function FloatReminder"), floats.indexOf("export function FloatStudent"));
  assert.doesNotMatch(reminder, /pago|vence|vencer|registrar/i);
  assert.match(reminder, /Clases sin alumnos/);
  const screens = read("components/landing/screens.tsx");
  const inicio = screens.slice(screens.indexOf("export function ScreenInicio"), screens.indexOf("function stateTone"));
  assert.match(inicio, /label="recordatorio"/);
  assert.doesNotMatch(inicio, /label="recordatorios"/);
});
