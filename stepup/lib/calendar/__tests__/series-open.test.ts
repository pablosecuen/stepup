import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findManageableForRule, lineageRootId, listPredecessorsRunningFrom, type RuleForLineage } from "../lineage.ts";
import { parseSeriesId, seriesBackTarget, seriesDetailHref } from "../series-return.ts";
import { resolveParticipantNames } from "../occurrences.ts";

const NOW = "2026-10-22T15:00:00.000Z";
const BA = "America/Argentina/Buenos_Aires";

function rule(id: string, overrides: Partial<RuleForLineage> = {}): RuleForLineage {
  return { recurrenceId: id, status: "active", endDate: null, timezone: BA, supersedesRecurrenceId: null, effectiveFromDate: null, ...overrides };
}

// Linaje real de la serie compartida: «viernes 19:00» hasta el 22/11 y su sucesora desde el 23/11.
const ORIGINAL = rule("original", { endDate: "2026-11-22" });
const SUCCESSOR = rule("sucesora", { supersedesRecurrenceId: "original", effectiveFromDate: "2026-11-23" });
const UNRELATED = rule("otra");

test("la serie exacta de una clase de un tramo anterior se resuelve a la serie vigente de SU linaje, nunca a otra", () => {
  const rules = [ORIGINAL, SUCCESSOR, UNRELATED];
  assert.equal(lineageRootId(rules, "sucesora"), "original");
  assert.equal(findManageableForRule(rules, "original", NOW)?.recurrenceId, "sucesora", "la clase del tramo anterior abre la vigente");
  assert.equal(findManageableForRule(rules, "sucesora", NOW)?.recurrenceId, "sucesora");
  assert.equal(findManageableForRule(rules, "otra", NOW)?.recurrenceId, "otra", "una serie independiente nunca se mezcla con otro linaje");
});

test("un linaje que ya terminó no tiene serie vigente que administrar", () => {
  const ended = [rule("vieja", { status: "ended", endDate: "2026-09-01" })];
  assert.equal(findManageableForRule(ended, "vieja", NOW), null);
  const pastEnd = [rule("vencida", { status: "active", endDate: "2026-10-01" })];
  assert.equal(findManageableForRule(pastEnd, "vencida", NOW), null, "con fecha de fin pasada tampoco");
});

test("un ciclo o un antecesor desconocido en el linaje no cuelga la resolución", () => {
  const a = rule("a", { supersedesRecurrenceId: "b" });
  const b = rule("b", { supersedesRecurrenceId: "a" });
  assert.ok(["a", "b"].includes(lineageRootId([a, b], "a")));
  assert.equal(lineageRootId([rule("x", { supersedesRecurrenceId: "no-existe" })], "x"), "x");
});

test("un cambio de alumnos desde una fecha alcanza también al tramo anterior que sigue generando clases desde esa fecha", () => {
  const rules = [ORIGINAL, SUCCESSOR];
  assert.deepEqual(listPredecessorsRunningFrom(rules, "sucesora", "2026-10-23").map((r) => r.recurrenceId), ["original"], "el tramo anterior llega hasta el 22/11: hay que cambiarlo también");
  assert.deepEqual(listPredecessorsRunningFrom(rules, "sucesora", "2026-11-23"), [], "desde el 23/11 el tramo anterior ya terminó: no se toca");
  assert.deepEqual(listPredecessorsRunningFrom([rule("original", { status: "ended", endDate: "2026-11-22" }), SUCCESSOR], "sucesora", "2026-10-23"), [], "un tramo finalizado nunca se modifica");
  assert.deepEqual(listPredecessorsRunningFrom([UNRELATED], "otra", "2026-10-23"), []);
});

test("seriesDetailHref usa el id real y conserva la semana o el día de origen; nunca acepta un destino ajeno", () => {
  const id = "fa050782-e3a1-4754-871b-24ccde89b57f";
  assert.equal(seriesDetailHref(id, "/calendario?week=2026-10-19"), `/calendario/series/${id}?volver=${encodeURIComponent("/calendario?week=2026-10-19")}`);
  assert.equal(seriesDetailHref(id, "/calendario?view=day&day=2026-10-23"), `/calendario/series/${id}?volver=${encodeURIComponent("/calendario?view=day&day=2026-10-23")}`);
  assert.equal(seriesDetailHref(id, null), `/calendario/series/${id}`);
  assert.equal(seriesDetailHref(id, "https://malo.example/calendario"), `/calendario/series/${id}`);
  assert.equal(seriesDetailHref(id, "//malo.example"), `/calendario/series/${id}`);
  assert.equal(seriesBackTarget("/calendario?week=2026-10-19"), "/calendario?week=2026-10-19");
  assert.equal(seriesBackTarget("/alumnos"), "/calendario");
  assert.equal(seriesBackTarget(undefined), "/calendario");
});

test("parseSeriesId sólo acepta un uuid", () => {
  assert.equal(parseSeriesId("FA050782-E3A1-4754-871B-24CCDE89B57F"), "fa050782-e3a1-4754-871b-24ccde89b57f");
  for (const bad of ["", "1", "../series", "fa050782", "fa050782-e3a1-4754-871b-24ccde89b57f; drop", undefined, 7]) assert.equal(parseSeriesId(bad), null);
});

test("resolveParticipantNames: todos los alumnos de la clase, el principal primero, sin repetir y sólo los conocidos", () => {
  const students = new Map([
    ["a", { name: "Ana" }],
    ["b", { name: "Beto" }],
    ["c", { name: "Carla" }],
  ]);
  assert.deepEqual(resolveParticipantNames("b", ["a", "b", "c"], students), ["Beto", "Ana", "Carla"]);
  assert.deepEqual(resolveParticipantNames("a", ["a", "a", "zzz"], students), ["Ana"]);
  assert.deepEqual(resolveParticipantNames(null, ["c", "a"], students), ["Carla", "Ana"]);
  assert.deepEqual(resolveParticipantNames(null, [], students), []);
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("cableado: «Administrar esta serie» abre la serie exacta por su id (no el listado) y el detalle muestra a todos los alumnos", () => {
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  assert.match(modal, /href=\{seriesDetailHref\(item\.recurrenceId, calendarPath\)\}/);
  assert.doesNotMatch(modal, /href="\/calendario\/series"/, "ya no manda al listado general");
  assert.match(modal, /aria-label="Otros alumnos de la clase"/);
  const page = read("app/(app)/calendario/series/[id]/page.tsx");
  assert.match(page, /parseSeriesId\(rawId\)/);
  assert.match(page, /findManageableForRule\(/);
  assert.match(page, /<SeriesCard /);
  assert.match(page, /href="\/calendario\/series"[\s\S]{0,80}Ver todas las series/, "el listado general sigue disponible como acceso independiente");
  assert.match(read("components/calendar/series-list-view.tsx"), /<SeriesCard rule=\{rule\}/, "la lista usa la MISMA tarjeta: mismos alumnos, horario y acciones");
});

test("cableado: la fecha efectiva de los formularios de series arranca en HOY (hora civil de la cuenta), se escribe en palabras y valida el nuevo horario antes de guardar", () => {
  const form = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(form, /useMemo\(\(\) => todayInArgentina\(\), \[\]\)/);
  assert.equal([...form.matchAll(/value=\{(?:futureDate|participantsDate)\}/g)].length, 2, "los dos campos de fecha son controlados y arrancan en hoy");
  assert.match(form, /Primera clase con el nuevo horario/);
  // Sin `action={…}`: React 19 reinicia el formulario al terminar la acción y las casillas de los días volvían al patrón anterior.
  assert.doesNotMatch(form, /<form action=/);
  assert.equal(form.split("<form onSubmit={(event) => submitWithoutReset(event, ").length - 1, 2);
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /checkFuturePatternConflicts\(ctx, \{ original: currentRule/);
  assert.match(actions, /listPredecessorsRunningFrom\(/);
  // Un intercambio de horarios entre dos series no puede quedar bloqueado una contra la otra: el choque se avisa y se puede aceptar a propósito.
  assert.match(actions, /readString\(formData, "allowOverlap"\) === "true"/);
  assert.match(actions, /return \{ error: conflictMessage, conflict: true \}/);
  assert.match(form, /Guardar igual \(queda superpuesto\)/);
  assert.match(form, /formData\.set\("allowOverlap", "true"\)/);
  // La validación corre ANTES de escribir.
  assert.ok(actions.indexOf("checkFuturePatternConflicts(ctx, { original: currentRule") < actions.indexOf("await splitRecurrenceThisAndFuture(ctx"), "valida antes de guardar");
});

// El caso real: «viernes 19:00» (arranca el 28/9, termina el 22/11) y su sucesora «viernes 20:00» que quedó mal fechada desde el 23/11.
const TRAMO_19 = { ...rule("tramo19", { endDate: "2026-11-22" }), startDate: "2026-09-28" };
const TRAMO_20 = { ...rule("tramo20", { supersedesRecurrenceId: "tramo19", effectiveFromDate: "2026-11-23" }), startDate: "2026-11-23" };

test("editar «desde hoy» una serie cuya vigente arranca más adelante corta el tramo que cubre hoy y reemplaza a la vigente (antes se rechazaba)", async () => {
  const { resolveEditableSegment } = await import("../lineage.ts");
  const rules = [TRAMO_19, TRAMO_20];
  const fromToday = resolveEditableSegment(rules, "tramo20", "2026-10-22");
  assert.equal(fromToday?.target.recurrenceId, "tramo19");
  assert.deepEqual(fromToday?.superseded.map((r) => r.recurrenceId), ["tramo20"]);
  const fromHeadStart = resolveEditableSegment(rules, "tramo20", "2026-11-23");
  assert.equal(fromHeadStart?.target.recurrenceId, "tramo20");
  assert.deepEqual(fromHeadStart?.superseded, []);
  assert.equal(resolveEditableSegment(rules, "tramo20", "2026-09-01"), null, "antes de que empiece la serie no hay tramo que la cubra");
  assert.equal(resolveEditableSegment([{ ...TRAMO_19, status: "ended" as const }, TRAMO_20], "tramo20", "2026-10-22"), null, "un tramo finalizado no se corta");
  assert.equal(resolveEditableSegment(rules, "no-existe", "2026-10-22"), null);
});

test("cableado: «Editar futuras» corta el tramo que cubre la fecha, hereda el fin de la vigente y finaliza los tramos posteriores", () => {
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /resolveEditableSegment\(allRules, originalRecurrenceId, effectiveDate\)/);
  assert.match(actions, /originalRecurrenceId: target\.id,/);
  assert.match(actions, /successorEndDate,\n      \/\/ [^\n]*\n      endRuleIds: segment\.superseded\.map\(\(rule\) => rule\.id\),/);
  assert.match(read("lib/repositories/recurrence-split.ts"), /if \(input\.successorEndDate !== undefined\) plan\.successorEndDate = input\.successorEndDate;/);
});
