import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planEndSeriesFromDate } from "../end-series.ts";
import { newLessonSlotHref, slotAriaLabel } from "../slot-link.ts";

type R = Parameters<typeof planEndSeriesFromDate>[0][number];
const rule = (id: string, overrides: Partial<R> = {}): R => ({ id, recurrenceId: id, status: "active", endDate: null, timezone: "America/Argentina/Buenos_Aires", supersedesRecurrenceId: null, effectiveFromDate: null, startDate: "2026-09-01", ...overrides });
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("«Esta y todas las series»: corta SÓLO la serie elegida y sus tramos que siguen vigentes; lo anterior se conserva y las demás series no se tocan", () => {
  const rules = [rule("a-viejo", { endDate: "2026-10-30", startDate: "2026-09-01" }), rule("a-vigente", { supersedesRecurrenceId: "a-viejo", startDate: "2026-10-31", effectiveFromDate: "2026-10-31" }), rule("otra-del-mismo-alumno"), rule("otra-de-otro")];
  const plan = planEndSeriesFromDate(rules, "a-vigente", "2026-10-24");
  assert.ok(plan);
  assert.deepEqual(plan.end, ["a-vigente"], "la vigente todavía no había empezado: se cierra por estado");
  assert.deepEqual(plan.truncate, [{ id: "a-viejo", endDate: "2026-10-23" }], "el tramo anterior que sigue corriendo termina el día anterior");
  const touched = [...plan.end, ...plan.truncate.map((cut) => cut.id)];
  assert.ok(!touched.includes("otra-del-mismo-alumno") && !touched.includes("otra-de-otro"), "ninguna otra serie de la cuenta");
});

test("una serie ya empezada se corta el día anterior (nunca se fabrica una fecha de fin anterior al inicio) y una ya terminada no se vuelve a quitar", () => {
  assert.deepEqual(planEndSeriesFromDate([rule("s")], "s", "2026-10-24"), { truncate: [{ id: "s", endDate: "2026-10-23" }], end: [] });
  assert.deepEqual(planEndSeriesFromDate([rule("s", { startDate: "2026-10-24" })], "s", "2026-10-24"), { truncate: [], end: ["s"] });
  assert.equal(planEndSeriesFromDate([rule("s", { status: "ended" })], "s", "2026-10-24"), null);
  assert.equal(planEndSeriesFromDate([rule("s")], "no-existe", "2026-10-24"), null);
});

test("un espacio libre abre «Nueva clase» en ese día y hora en punto, con la semana o el día de origen para volver (sólo rutas del Calendario)", () => {
  assert.equal(newLessonSlotHref({ dayKey: "2026-10-26", hour: 14, returnPath: "/calendario?view=week&day=2026-10-26" }), "/calendario/nueva?date=2026-10-26&hour=14&minute=0&volver=%2Fcalendario%3Fview%3Dweek%26day%3D2026-10-26");
  assert.equal(newLessonSlotHref({ dayKey: "2026-10-26", hour: 8 }), "/calendario/nueva?date=2026-10-26&hour=8&minute=0");
  assert.ok(!newLessonSlotHref({ dayKey: "2026-10-26", hour: 9, returnPath: "https://malo.example/x" }).includes("volver"), "nunca una dirección externa");
  assert.ok(!newLessonSlotHref({ dayKey: "2026-10-26", hour: 9, returnPath: "//malo.example" }).includes("volver"));
  assert.equal(slotAriaLabel("lun 26/10", 14), "Agregar clase el lun 26/10 a las 14:00");
});

test("cableado de Series: botón «Eliminar serie» con confirmación que dice el alcance; el intercambio vive dentro del mismo recuadro de acciones", () => {
  const actions = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(actions, /Eliminar serie\n/);
  assert.doesNotMatch(actions, /Esta y todas las series|Quitar esta serie/, "el nombre definitivo es «Eliminar serie»");
  assert.match(actions, /Se elimina de la agenda esta serie desde hoy, \{formatCivilDayLabel\(today\)\}, incluidas sus continuaciones futuras/);
  assert.doesNotMatch(actions, />\s*Finalizar\s*</);
  assert.match(actions, /endSeriesFromTodayAction\(ruleId\)/);
  assert.match(actions, /Sólo se elimina ESTA serie: las demás series de tu cuenta/);
  assert.match(actions, /Se conservan las clases ya dictadas o registradas, sus cobros, pagos y archivos adjuntos/);
  assert.match(actions, /<SeriesSwapPanel options=\{swapOptions\} fixedId=\{ruleId\}/);
  assert.match(actions, /Intercambiar horarios/);
  assert.doesNotMatch(read("components/calendar/series-list-view.tsx"), /<SeriesSwapPanel/);
  assert.doesNotMatch(read("app/(app)/calendario/series/[id]/page.tsx"), /<SeriesSwapPanel/);
  const action = read("lib/actions/calendar.ts");
  assert.match(action, /planEndSeriesFromDate\(rules, ruleId, todayDate\)/);
  const body = action.slice(action.indexOf("export async function endSeriesFromTodayAction"), action.indexOf("export interface EditFutureActionInput"));
  assert.doesNotMatch(body, /\.delete\(|setRecurrenceRuleStatus\(ctx, ruleId, "ended"\)/, "no borra nada ni termina toda la regla sin fecha");
  assert.match(body, /endRecurrenceSeriesFromDate\(ctx, \{ plan, effectiveDate: todayDate, timezone/, "corte + cierres + clases futuras en UNA sola operación (RPC)");
  assert.doesNotMatch(body, /cancelFutureUnregisteredLessonsOfRules/, "ya no hay una segunda escritura separada");
  const migration = read("supabase/migrations/20261024100000_end_recurrence_series_from_date.sql");
  assert.match(migration, /create or replace function public\.end_recurrence_series_from_date\(p_payload jsonb\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function public\.end_recurrence_series_from_date\(jsonb\) from public, anon;/);
});

test("cableado del Calendario: cada hora libre de la grilla es un botón debajo de las clases que abre Nueva clase y vuelve a la misma semana o día", () => {
  const grid = read("components/calendar/real-calendar-grid.tsx");
  assert.match(grid, /data-grid-slot=""/);
  assert.match(grid, /const returnPath = \`\$\{window\.location\.pathname\}\$\{window\.location\.search\}\`;\n\s+saveGridScroll\(returnPath, scrollerRef\.current\);\n\s+router\.push\(newLessonSlotHref\(\{ dayKey, hour, returnPath \}\)\);/);
  assert.ok(grid.indexOf("data-grid-slot") < grid.indexOf("{positioned.map((positionedItem) => {"), "los espacios van antes que las clases (quedan debajo)");
  assert.match(read("app/(app)/calendario/nueva/page.tsx"), /safeCalendarReturn\(params\.volver\) \?\? "\/calendario"/);
  const form = read("app/(app)/calendario/nueva/new-lesson-form.tsx");
  assert.match(form, /router\.push\(returnHref\)/);
  assert.match(form, /<PrivateButtonLink href=\{returnHref\} variant="ghost">/);
});
