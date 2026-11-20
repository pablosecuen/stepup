import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lineageRootId, selectFinishedRecurrenceSeries, selectManageableRecurrenceSeries } from "../lineage.ts";
import { toRecurrenceRuleRecord } from "../../repositories/recurrence-rules-mapping.ts";
import type { RecurrenceRuleRow } from "../../db/database.types.ts";
import type { RecurrenceWeek } from "../types.ts";

/**
 * Pantalla Series: el contador, las tarjetas y «Finalizadas» salen de la MISMA regla y se prueban sobre una lista de más de 25 series que mezcla todos los casos reales
 * (sin fecha, fecha futura, hoy, pasada, pausadas, inicio futuro, varios días, ciclos, cambios programados, eliminadas, independientes del mismo alumno, entrenamientos).
 */
const NOW = "2026-11-19T15:00:00.000Z"; // jueves 19/11/2026, 12:00 en Buenos Aires
const TZ = "America/Argentina/Buenos_Aires";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sessionsOf = (...slots: [number, number][]) => slots.map(([weekday, hour]) => ({ weekday, hour, minute: 0, durationMinutes: 60 }));

interface Spec {
  id: string;
  start?: string;
  end?: string | null;
  seriesEnd?: string | null;
  status?: "active" | "paused" | "ended";
  supersedes?: string | null;
  effective?: string | null;
  cycle?: 1 | 2 | 3 | 4;
  days?: number;
  student?: string;
  parts?: string[];
  kind?: "class" | "training";
}

function rule(spec: Spec) {
  const cycle = spec.cycle ?? 1;
  const weeks: RecurrenceWeek[] = Array.from({ length: cycle }, (_, index) => ({ weekIndex: index, sessions: sessionsOf(...Array.from({ length: spec.days ?? 1 }, (_, day) => [day, 9 + index] as [number, number])) }));
  const row = {
    id: spec.id, owner_id: "o", legacy_mobile_id: null, primary_student_id: spec.student ?? "s-" + spec.id, rule_type: "weekly", cycle_length_weeks: cycle, weeks, modality: "online", timezone: TZ,
    start_date: spec.start ?? "2026-08-03", end_date: spec.end ?? null, series_end_date: spec.seriesEnd ?? null, status: spec.status ?? "active", supersedes_recurrence_id: spec.supersedes ?? null,
    superseded_by_recurrence_id: null, effective_from_date: spec.effective ?? null, class_title: null, activity_kind: spec.kind ?? "class", training_billing_agreement_id: null, operation_id: null, created_at: "", updated_at: "",
  } as unknown as RecurrenceRuleRow;
  const record = toRecurrenceRuleRecord(row, spec.parts ?? [spec.student ?? "s-" + spec.id]);
  return { ...record, recurrenceId: record.id };
}

function buildList() {
  const specs: Spec[] = [
    // — vigentes —
    { id: "v-sin-fecha" },
    { id: "v-fecha-futura", seriesEnd: "2026-12-31" },
    { id: "v-fecha-hoy", seriesEnd: "2026-11-19" }, // hoy cuenta: la última clase puede ser hoy
    { id: "v-pausada", status: "paused" },
    { id: "v-inicio-futuro", start: "2026-12-07" },
    { id: "v-varios-dias", days: 3 },
    { id: "v-ciclo-2", cycle: 2 },
    { id: "v-ciclo-4", cycle: 4, days: 2 },
    { id: "v-entrenamiento", kind: "training", parts: ["a", "b", "c"], student: "a" },
    { id: "v-individual", parts: ["solo"], student: "solo" },
    // dos series INDEPENDIENTES del mismo alumno: dos tarjetas
    { id: "v-mismo-alumno-1", student: "mismo", parts: ["mismo"] },
    { id: "v-mismo-alumno-2", student: "mismo", parts: ["mismo"], days: 2 },
    // cambio programado a futuro: UNA sola tarjeta (el último tramo), con su tramo anterior
    { id: "v-cambio-futuro-a", end: "2026-11-30", seriesEnd: "2026-12-20" },
    { id: "v-cambio-futuro-b", start: "2026-11-23", supersedes: "v-cambio-futuro-a", effective: "2026-12-01", seriesEnd: "2026-12-20" },
    // split ya vigente
    { id: "v-split-a", end: "2026-11-10" },
    { id: "v-split-b", start: "2026-11-09", supersedes: "v-split-a", effective: "2026-11-11" },
    // cambio programado que queda DESPUÉS de la fecha de finalización: el tramo vigente sigue como una tarjeta
    { id: "v-despues-limite-a", end: "2026-12-10", seriesEnd: "2026-12-20" },
    { id: "v-despues-limite-b", start: "2027-01-04", supersedes: "v-despues-limite-a", effective: "2027-01-07", seriesEnd: "2026-12-20" },
    // — finalizadas (llegaron a su fecha) —
    { id: "f-ayer", seriesEnd: "2026-11-18" },
    { id: "f-hace-semanas", seriesEnd: "2026-10-02", days: 2 },
    { id: "f-pausada", seriesEnd: "2026-11-01", status: "paused" },
    { id: "f-entrenamiento", seriesEnd: "2026-11-10", kind: "training", parts: ["x", "y"], student: "x" },
    { id: "f-con-tramos-a", end: "2026-10-18", seriesEnd: "2026-11-15" },
    { id: "f-con-tramos-b", start: "2026-10-12", supersedes: "f-con-tramos-a", effective: "2026-10-19", seriesEnd: "2026-11-15" },
    // limite alcanzado y un cambio programado que nunca llegó a regir: la tarjeta es el tramo que corrió
    { id: "f-nunca-rigio-a", end: "2026-11-30", seriesEnd: "2026-11-12" },
    { id: "f-nunca-rigio-b", start: "2026-12-07", supersedes: "f-nunca-rigio-a", effective: "2026-12-10", seriesEnd: "2026-11-12" },
    // — ni vigentes ni finalizadas —
    { id: "x-eliminada-estado", status: "ended" },
    { id: "x-eliminada-corte-con-limite-futuro", end: "2026-11-10", seriesEnd: "2026-12-31" }, // se eliminó antes de que llegara el límite
    { id: "x-eliminada-corte-con-limite-pasado", end: "2026-11-05", seriesEnd: "2026-11-12" },
    { id: "x-fin-propio-pasado", end: "2026-09-02" }, // sin fecha de la serie: no se puede distinguir de una eliminada
  ];
  // Relleno: 12 series más, para pasar de 25 vigentes.
  for (let index = 0; index < 12; index += 1) specs.push({ id: `v-relleno-${index}`, start: `2026-0${8 + (index % 3)}-03` });
  return specs.map(rule);
}

const idsOf = (list: { id: string }[]) => list.map((item) => item.id).sort();

test("«Vigentes»: una tarjeta por serie lógica; el contador es exactamente la cantidad de tarjetas", () => {
  const rules = buildList();
  const manageable = selectManageableRecurrenceSeries(rules, NOW);
  assert.ok(manageable.length >= 25, `la lista de prueba tiene al menos 25 vigentes (${manageable.length})`);
  // Cada tarjeta es de un linaje distinto: ningún tramo repetido ni dos tarjetas de la misma serie.
  const roots = manageable.map((card) => lineageRootId(rules, card.id));
  assert.equal(new Set(roots).size, manageable.length, "ninguna serie aparece dos veces");
  const present = idsOf(manageable);
  for (const expected of ["v-sin-fecha", "v-fecha-futura", "v-fecha-hoy", "v-pausada", "v-inicio-futuro", "v-varios-dias", "v-ciclo-2", "v-ciclo-4", "v-entrenamiento", "v-individual", "v-mismo-alumno-1", "v-mismo-alumno-2"]) {
    assert.ok(present.includes(expected), `${expected} figura`);
  }
  // Una fecha de finalización FUTURA o la de HOY no oculta la serie.
  assert.ok(present.includes("v-fecha-futura") && present.includes("v-fecha-hoy"));
  // Cambios programados: una sola tarjeta por linaje, la del último tramo.
  assert.ok(present.includes("v-cambio-futuro-b") && !present.includes("v-cambio-futuro-a"));
  assert.ok(present.includes("v-split-b") && !present.includes("v-split-a"));
  // Un cambio que queda después de la fecha de finalización no hace desaparecer la serie.
  assert.ok(present.includes("v-despues-limite-a") && !present.includes("v-despues-limite-b"), "se muestra el tramo vigente");
  // Dos series independientes del mismo alumno permanecen separadas.
  assert.ok(present.includes("v-mismo-alumno-1") && present.includes("v-mismo-alumno-2"));
  // Las eliminadas y las finalizadas no cuentan como vigentes.
  for (const hidden of ["x-eliminada-estado", "x-eliminada-corte-con-limite-futuro", "x-eliminada-corte-con-limite-pasado", "x-fin-propio-pasado", "f-ayer", "f-hace-semanas", "f-pausada", "f-entrenamiento", "f-con-tramos-b", "f-nunca-rigio-a"]) {
    assert.ok(!present.includes(hidden), `${hidden} no es vigente`);
  }
});

test("«Finalizadas»: las series que llegaron a su fecha, una por linaje, sin mezclarlas con las vigentes ni con las eliminadas", () => {
  const rules = buildList();
  const finished = selectFinishedRecurrenceSeries(rules, NOW);
  assert.deepEqual(idsOf(finished), ["f-ayer", "f-con-tramos-b", "f-entrenamiento", "f-hace-semanas", "f-nunca-rigio-a", "f-pausada"]);
  // La tarjeta de «f-nunca-rigio» es el tramo que corrió, no el cambio que nunca llegó a regir.
  assert.ok(!idsOf(finished).includes("f-nunca-rigio-b"));
  // Ninguna serie está a la vez en Vigentes y en Finalizadas.
  const vigentes = new Set(selectManageableRecurrenceSeries(rules, NOW).map((card) => lineageRootId(rules, card.id)));
  for (const card of finished) assert.ok(!vigentes.has(lineageRootId(rules, card.id)), `${card.id} sólo está en Finalizadas`);
  // Eliminadas (por estado o por corte anterior a la fecha) y fin propio sin fecha de serie: no se listan.
  const hidden = ["x-eliminada-estado", "x-eliminada-corte-con-limite-futuro", "x-eliminada-corte-con-limite-pasado", "x-fin-propio-pasado"];
  for (const id of hidden) assert.ok(!idsOf(finished).includes(id), `${id} no es una serie finalizada`);
});

test("cuenta completa: toda serie lógica está en Vigentes, en Finalizadas o es una eliminada/finalizada sin fecha de serie (nada se pierde ni se repite)", () => {
  const rules = buildList();
  const rootOf = (id: string) => lineageRootId(rules, id);
  const allRoots = new Set(rules.map((item) => rootOf(item.id)));
  const vigentes = new Set(selectManageableRecurrenceSeries(rules, NOW).map((card) => rootOf(card.id)));
  const finished = new Set(selectFinishedRecurrenceSeries(rules, NOW).map((card) => rootOf(card.id)));
  const apart = [...allRoots].filter((root) => !vigentes.has(root) && !finished.has(root)).sort();
  assert.deepEqual(apart, ["x-eliminada-corte-con-limite-futuro", "x-eliminada-corte-con-limite-pasado", "x-eliminada-estado", "x-fin-propio-pasado"]);
  assert.equal(vigentes.size + finished.size + apart.length, allRoots.size);
  assert.ok(allRoots.size < rules.length, "hay más reglas (tramos) que series lógicas: contar reglas daría un número distinto");
});

test("una serie finalizada vuelve a Vigentes cuando se le fija una fecha futura (o se le quita) y deja de estar en Finalizadas", () => {
  const before = buildList();
  assert.ok(selectFinishedRecurrenceSeries(before, NOW).some((card) => card.id === "f-ayer"));
  const after = before.map((item) => (item.id === "f-ayer" ? rule({ id: "f-ayer", seriesEnd: "2026-12-15" }) : item));
  assert.ok(selectManageableRecurrenceSeries(after, NOW).some((card) => card.id === "f-ayer"));
  assert.ok(!selectFinishedRecurrenceSeries(after, NOW).some((card) => card.id === "f-ayer"));
  const removed = before.map((item) => (item.id === "f-ayer" ? rule({ id: "f-ayer", seriesEnd: null }) : item));
  assert.ok(selectManageableRecurrenceSeries(removed, NOW).some((card) => card.id === "f-ayer"));
});

test("el límite alcanzado no depende del reloj de otra zona: el día civil de la cuenta decide (19/11 02:00 UTC todavía es 18/11 en Buenos Aires)", () => {
  const rules = [rule({ id: "borde", seriesEnd: "2026-11-18" })];
  // 19/11 02:00 UTC = 18/11 23:00 en Buenos Aires: la serie todavía es vigente.
  assert.equal(selectManageableRecurrenceSeries(rules, "2026-11-19T02:00:00.000Z").length, 1);
  assert.equal(selectFinishedRecurrenceSeries(rules, "2026-11-19T02:00:00.000Z").length, 0);
  // 19/11 04:00 UTC = 19/11 01:00 en Buenos Aires: llegó a su fecha.
  assert.equal(selectManageableRecurrenceSeries(rules, "2026-11-19T04:00:00.000Z").length, 0);
  assert.equal(selectFinishedRecurrenceSeries(rules, "2026-11-19T04:00:00.000Z").length, 1);
});

test("cableado: un único desplazamiento (el de la página), contador = tarjetas, «Finalizadas» aparte, sin scroll interno ni botón «Ir a la última serie»", () => {
  const view = read("components/calendar/series-list-view.tsx");
  assert.doesNotMatch(view, /max-h-\[|overflow-y-auto|overflow-y-scroll/, "la lista no tiene scroll propio");
  assert.doesNotMatch(view, /ScrollToLastSeries|Ir a la última serie/, "con un solo scroll no hace falta saltar a la última");
  assert.match(view, /\{manageable\.map\(\(rule\) => \(/, "las tarjetas salen de la misma lista que cuenta el contador");
  assert.match(view, /manageable\.length, "serie vigente", "series vigentes"|plural\(manageable\.length/, "el contador es manageable.length");
  assert.match(view, /selectFinishedRecurrenceSeries\(rulesForLineage, nowIso\)/);
  assert.match(view, /aria-label="Estado de las series"/);
  assert.match(view, /aria-current=\{active \? "page" : undefined\}/, "la pestaña activa se dice con texto/atributo, no sólo con color");
  assert.match(view, /estado=finalizadas/);
  assert.match(view, /<FinishedSeriesDate /);
  const skeleton = read("components/nav/screen-skeleton.tsx");
  assert.doesNotMatch(skeleton.slice(skeleton.indexOf("function SeriesBody"), skeleton.indexOf("function DisponibilidadBody")), /max-h-\[70vh\]|overflow-hidden/, "el esqueleto es igual a la lista real");
  const page = read("app/(app)/calendario/series/page.tsx");
  assert.match(page, /parseSeriesListFilter\(query\.estado\)/);
  const detail = read("app/(app)/calendario/series/[id]/page.tsx");
  assert.match(detail, /selectFinishedRecurrenceSeries\(rulesForLineage, nowIso\)/, "una serie finalizada abierta desde una clase también permite cambiar su fecha");
  const finishedUi = read("app/(app)/calendario/series/finished-series-date.tsx");
  assert.match(finishedUi, /editFutureRecurrenceAction/, "mismo circuito que «Administrar serie»");
  assert.match(finishedUi, /previewSeriesEndAction/, "con la misma vista previa");
  assert.match(finishedUi, /if \(!canSave \|\| nextEnd === null \|\| inFlight\.current\) return;/, "sin doble envío ni guardado sin elegir");
  assert.match(finishedUi, /useState<Choice \| null>\(null\)/, "ninguna opción elegida de antemano: abrir no reactiva nada");
  assert.match(finishedUi, /router\.push\(`\/calendario\/series\?reactivada=\$\{ruleId\}`\)/, "al guardar se abre Vigentes con la serie resaltada");
  assert.match(view, /reactivated\?\.id === rule\.id/, "la serie que volvió se resalta");
  assert.match(page, /reactivatedId = reactivatedParam && \/\^\[0-9a-f\]/, "el id de la dirección sólo se acepta con forma de UUID");
});
