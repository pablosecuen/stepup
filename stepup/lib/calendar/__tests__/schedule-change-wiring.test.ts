import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** «Cambiar horario» (02/11/2026): cableado — dónde se ofrece, qué valida el servidor y qué ya no se permite. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

test("«Cambiar horario» se ofrece desde el detalle de la clase y desde su serie, aparte del intercambio atómico", () => {
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  assert.match(modal, /<ChangeSchedulePanel/);
  assert.match(modal, /Reprogramar<span/, "botón visible en el detalle");
  assert.match(modal, /initialScope="single"\s+singleClassOnly/, "desde el detalle sólo cambia esta clase");
  assert.doesNotMatch(modal, /Reprogramar esta clase|Ver vista previa/, "el flujo viejo de fecha/hora sueltas ya no existe");
  const series = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(series, /key: "change", label: "Cambiar horario", onSelect: openChange/);
  assert.match(series, /upcomingSeriesOccurrencesAction\(ruleId\)/);
  assert.match(series, /Intercambiar horarios/, "el intercambio sigue siendo una acción separada");
  assert.match(series, /<SeriesSwapPanel/);
});

test("el panel distingue «Solo esta clase» de «Esta y las siguientes», muestra el destino y cancelar no guarda nada", () => {
  const panel = read("components/calendar/change-schedule-panel.tsx");
  assert.match(panel, /Solo esta clase/);
  assert.match(panel, /const isSeries = !!occurrence\.recurrenceId && !singleClassOnly/);
  assert.match(panel, /const scope = singleClassOnly \? "single" : selectedScope/);
  assert.match(panel, /Esta y las siguientes/);
  assert.match(panel, /Quedará así/);
  assert.match(panel, /la duración no cambia/);
  assert.match(panel, /disabled=\{!changed \|\| pending\}/, "sin un horario distinto no se puede confirmar");
  assert.match(panel, /onClick=\{onCancel\}/);
  assert.match(panel, /const \[pick, setPick\] = useState\(\{ date: originalDate, time: originalTime \}\)/, "abre con la fecha y hora actuales");
  assert.match(panel, /selectableUnavailable=\{scope === "single"\}/, "con una serie nunca se elige un horario ocupado o bloqueado");
  assert.match(panel, /guardNetwork\(\(\) => changeSeriesSlotAction/);
  assert.match(panel, /guardNetwork\(\(\) => rescheduleWithAvailabilityAction/);
});

test("el servidor recalcula el patrón y valida siempre: ningún «guardar igual» para un cambio de día u hora", () => {
  const action = read("lib/actions/schedule-change.ts");
  assert.match(action, /planSeriesSlotMove\(/, "el patrón se calcula en el servidor, nunca viene del navegador");
  assert.doesNotMatch(action, /allowOverlap/);
  assert.match(action, /formData\.set\("keepPattern", "true"\)/);
  const calendar = read("lib/actions/calendar.ts");
  assert.match(calendar, /const allowOverlap = readString\(formData, "allowOverlap"\) === "true" && keepPattern && !!durationPatch && !weeksPatch;/, "«guardar igual» sólo existe para cambiar la duración");
  assert.match(calendar, /checkFuturePatternConflicts\(ctx, \{ original: currentRule, replacedRuleIds/, "se comprueban las ocurrencias futuras, no un día aislado");
  assert.match(calendar, /candidates = toConflictCandidates\(items, \{ excludeRecurrenceIds: input\.replacedRuleIds/, "se excluye sólo lo que la operación reemplaza");
  const series = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.doesNotMatch(series, /Guardar igual \(queda superpuesto\)|guardalo igual|allowOverlap/);
  const single = read("lib/actions/reschedule-parity.ts");
  assert.match(single, /i\.id!==item\.id&&i\.status!=='cancelled'&&i\.occupiesSlot!==false&&i\.start<end&&i\.end>start/, "la propia clase no cuenta, las demás sí, con la duración completa");
});

test("los controles financieros cerrados se ajustan a su contenido (ni ancho completo ni mínimos) y el desplegado conserva su espacio", () => {
  for (const [file, open] of [["components/finance/annual-projection.tsx", "open:w-full"], ["components/finance/savings-goal-form.tsx", "open:w-full open:max-w-3xl"], ["components/finance/collected-evolution-chart.tsx", "open:w-full open:max-w-[620px]"]]) {
    const text = read(file);
    const details = text.match(/<details className="([^"]+)"/)?.[1] ?? "";
    assert.match(details, /\bw-fit\b/, `${file}: cerrado se ajusta al contenido`);
    assert.match(details, /\bmax-w-full\b/, `${file}: nunca desborda en móvil`);
    assert.ok(details.includes(open), `${file}: abierto conserva su espacio`);
    assert.doesNotMatch(details.replace(open, ""), /(^|\s)(w-full|min-w-|max-w-3xl|max-w-\[620px\])/, `${file}: sin ancho completo ni mínimos cuando está cerrado`);
    assert.match(text, /<summary[^>]*className="[^"]*min-h-11/, `${file}: área táctil mínima de 44 px`);
  }
  assert.doesNotMatch(read("components/finance/savings-goal-form.tsx"), /className="ml-auto">⌄/, "el chevron ya no empuja el control a lo ancho");
});
