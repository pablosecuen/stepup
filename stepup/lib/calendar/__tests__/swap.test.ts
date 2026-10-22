import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeWeeks, planSeriesSwap, type SwapRule } from "../swap.ts";
import { findFutureRecurrenceConflicts, occurrencesAsCandidates } from "../future-conflicts.ts";
import type { RecurrenceWeek } from "../types.ts";

const BA = "America/Argentina/Buenos_Aires";
const NOW = "2026-10-22T15:00:00.000Z";
const TODAY = "2026-10-22";
const week = (weekday: number, hour: number, minute = 0): RecurrenceWeek[] => [{ weekIndex: 0, sessions: [{ weekday, hour, minute, durationMinutes: 60 }] }];

function rule(id: string, weeks: RecurrenceWeek[], overrides: Partial<SwapRule> = {}): SwapRule {
  return { recurrenceId: id, status: "active", endDate: null, timezone: BA, supersedesRecurrenceId: null, effectiveFromDate: null, startDate: "2026-09-28", weeks, participantIds: [`${id}-alumno`], primaryStudentId: `${id}-alumno`, ...overrides };
}

const BIANCA = rule("bianca", week(4, 19));
const MARIA = rule("maria", week(4, 20));

test("intercambio: cada serie recibe el patrón de la otra (alumnos y fin no se mueven) y se corta el tramo que cubre la fecha", () => {
  const plan = planSeriesSwap([BIANCA, MARIA], "bianca", "maria", "2026-10-22", TODAY, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.deepEqual(plan.a.newWeeks, MARIA.weeks);
  assert.deepEqual(plan.b.newWeeks, BIANCA.weeks);
  assert.equal(plan.a.target.recurrenceId, "bianca");
  assert.equal(plan.b.target.recurrenceId, "maria");
  assert.deepEqual([plan.a.superseded, plan.b.superseded], [[], []]);
  assert.equal(plan.a.successorEndDate, null);
});

test("intercambio: dos series con el mismo horario, la misma serie dos veces, fecha pasada o serie terminada se rechazan con un mensaje claro", () => {
  const same = planSeriesSwap([BIANCA, rule("igual", week(4, 19))], "bianca", "igual", "2026-10-23", TODAY, NOW);
  assert.ok(!same.ok && /mismo horario/.test(same.error));
  const twice = planSeriesSwap([BIANCA, MARIA], "bianca", "bianca", "2026-10-23", TODAY, NOW);
  assert.ok(!twice.ok && /dos series distintas/.test(twice.error));
  const past = planSeriesSwap([BIANCA, MARIA], "bianca", "maria", "2026-10-21", TODAY, NOW);
  assert.ok(!past.ok && /fecha pasada/.test(past.error));
  const ended = planSeriesSwap([BIANCA, { ...MARIA, status: "ended" as const, endDate: "2026-10-01" }], "bianca", "maria", "2026-10-23", TODAY, NOW);
  assert.ok(!ended.ok && /terminó/.test(ended.error));
  const paused = planSeriesSwap([BIANCA, { ...MARIA, status: "paused" as const }], "bianca", "maria", "2026-10-23", TODAY, NOW);
  assert.ok(!paused.ok && /pausada/.test(paused.error));
  const noDate = planSeriesSwap([BIANCA, MARIA], "bianca", "maria", "", TODAY, NOW);
  assert.ok(!noDate.ok);
});

test("intercambio con un cambio ya programado en una de las series (tramo posterior): el patrón que recibe es el vigente en la fecha y el posterior se informa para reemplazarlo", () => {
  // María tiene viernes 19 hasta el 22/11 y, desde el 23/11, un cambio ya programado a viernes 21.
  const mariaOld = rule("maria-old", week(4, 19), { endDate: "2026-11-22" });
  const mariaNew = rule("maria-new", week(4, 21), { supersedesRecurrenceId: "maria-old", effectiveFromDate: "2026-11-23", startDate: "2026-11-23" });
  const otra = rule("otra", week(4, 20));
  const plan = planSeriesSwap([mariaOld, mariaNew, otra], "maria-new", "otra", "2026-10-23", TODAY, NOW);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.a.target.recurrenceId, "maria-old", "se corta el tramo que cubre la fecha");
  assert.deepEqual(plan.a.superseded.map((r) => r.recurrenceId), ["maria-new"], "el cambio programado del 23/11 queda a la vista (se reemplaza)");
  assert.deepEqual(plan.b.newWeeks, week(4, 19), "la otra serie recibe el patrón vigente en esa fecha (viernes 19), no el programado");
  assert.deepEqual(plan.a.newWeeks, week(4, 20));
  assert.equal(plan.a.successorEndDate, mariaNew.endDate, "la sucesora hereda el fin de la serie vigente que reemplaza");
});

test("describeWeeks: el patrón en pocas palabras", () => {
  assert.equal(describeWeeks(week(4, 19)), "vie 19:00");
  assert.equal(describeWeeks([{ weekIndex: 0, sessions: [{ weekday: 0, hour: 9, minute: 5, durationMinutes: 60 }, { weekday: 2, hour: 18, minute: 0, durationMinutes: 60 }] }]), "lun 09:05 · mié 18:00");
  assert.equal(describeWeeks([{ weekIndex: 0, sessions: [] }]), "Sin horario");
});

test("el resultado del intercambio se valida contra terceras clases y entre sí, sin ignorar nada: el choque de HOY entre las dos no cuenta, el final sí", () => {
  const engine = (id: string, weeks: RecurrenceWeek[]) => ({ recurrenceId: id, studentId: id, participantIds: [id], cycleLengthWeeks: 1, weeks, modality: "online" as const, timezone: BA, startDate: "2026-10-19", endDate: null, status: "active" as const, classTitle: null, activityKind: "class" as const });
  const availability = { schemaVersion: 1 as const, timezone: BA, weeklyBlocks: [], exceptions: [] };
  const rangeStart = new Date("2026-10-22T03:00:00.000Z");
  const rangeEnd = new Date("2026-12-22T00:00:00.000Z");
  // Intercambio sano (viernes 19 ↔ viernes 20): ninguna choca con la otra.
  const a = engine("a", week(4, 20));
  const b = engine("b", week(4, 19));
  const run = (successor: ReturnType<typeof engine>, other: ReturnType<typeof engine>, extra = [] as ReturnType<typeof occurrencesAsCandidates>) =>
    findFutureRecurrenceConflicts({ successor, effectiveDate: "2026-10-23", todayDate: TODAY, candidates: [...extra, ...occurrencesAsCandidates(other, rangeStart, rangeEnd, "otra")], availability });
  assert.deepEqual(run(a, b), []);
  assert.deepEqual(run(b, a), []);
  // Una TERCERA serie los viernes a las 20 hace chocar a la que pasa a las 20: el intercambio se rechaza.
  const tercera = occurrencesAsCandidates(engine("tercera", week(4, 20)), rangeStart, rangeEnd, "Tercera");
  const withThird = run(a, b, tercera);
  assert.ok(withThird.length > 0 && withThird.every((c) => c.with === "Tercera"));
  // Si las series que cambian quedaran a la misma hora entre sí (patrones que se pisan), también se detecta.
  const pisan = run(engine("x", week(4, 19)), engine("y", week(4, 19, 30)));
  assert.ok(pisan.length > 0);
});

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

test("migración: el intercambio y el corte con finalización van en UNA transacción (security invoker, sin ignorar errores) y no se tocan las funciones ya aplicadas", () => {
  const sql = read("supabase/migrations/20261022500000_swap_recurrence_patterns.sql");
  assert.match(sql, /create or replace function public\.swap_recurrence_patterns\(p_payload jsonb\)\s+returns jsonb\s+language plpgsql\s+security invoker\s+set search_path = ''/);
  assert.match(sql, /create or replace function public\.split_recurrence_ending_segments\(p_payload jsonb\)/);
  assert.equal([...sql.matchAll(/public\.split_recurrence_this_and_future\(/g)].length, 2, "sólo se reutiliza el corte existente");
  assert.match(sql, /jsonb_array_length\(v_operations\) <> 2/);
  assert.match(sql, /misma fecha/);
  assert.doesNotMatch(sql, /exception\s+when/i, "ningún error se traga: cualquier fallo revierte todo");
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\bdrop\s+/i);
  for (const signature of ["swap_recurrence_patterns(jsonb)", "split_recurrence_ending_segments(jsonb)"]) {
    assert.ok(sql.includes(`revoke execute on function public.${signature} from anon;`));
    assert.ok(sql.includes(`grant execute on function public.${signature} to authenticated;`));
  }
});

test("cableado: el intercambio valida el resultado final en el servidor, sin opción de ignorar, y «editar futuras» no finaliza cambios futuros en silencio", () => {
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /export async function previewSeriesSwapAction/);
  assert.match(actions, /export async function swapSeriesAction/);
  const swapBlock = actions.slice(actions.indexOf("async function prepareSeriesSwap"), actions.indexOf("// Disponibilidad"));
  assert.doesNotMatch(swapBlock, /allowOverlap/, "el intercambio no tiene «guardar igual»");
  assert.match(swapBlock, /thirdParties = toConflictCandidates\(items, \{ excludeRecurrenceIds: replacedIds, hiddenStudentIds \}\)/);
  assert.match(swapBlock, /await swapRecurrencePatterns\(ctx, \[sideInput\(a\), sideInput\(b\)\]\)/);
  assert.match(actions, /readString\(formData, "confirmReplace"\) !== "true"/);
  assert.match(actions, /describeReplacements\(segment\.superseded, affected\)/);
  assert.match(actions, /endRuleIds: segment\.superseded\.map\(\(rule\) => rule\.id\),/);
  assert.doesNotMatch(actions, /await setRecurrenceRuleStatus\(ctx, replaced\.id, "ended"\)/, "la finalización de los tramos ya no es una llamada aparte");
  const repo = read("lib/repositories/recurrence-split.ts");
  assert.match(repo, /rpc\("swap_recurrence_patterns", \{ p_payload: \{ operations \} \}\)/);
  assert.match(repo, /split_recurrence_ending_segments/);
  const panel = read("components/calendar/series-swap-panel.tsx");
  assert.match(panel, /Confirmar intercambio/);
  assert.match(panel, /Ver vista previa/);
  assert.match(read("components/calendar/series-list-view.tsx"), /<SeriesSwapPanel options=\{swapOptions\}/);
  assert.match(read("app/(app)/calendario/series/[id]/page.tsx"), /<SeriesSwapPanel options=\{swapOptions\} fixedId=\{head\.id\}/);
});

test("clases ya decididas que un cambio desde una fecha afecta: las reprogramadas se reemplazan y las canceladas siguen registradas; las completadas y las anteriores a la fecha no cuentan", async () => {
  const { affectedFutureLessons } = await import("../affected-lessons.ts");
  const lessons = [
    { status: "cancelled" as const, startAt: "2026-11-06T21:00:00.000Z", recurrenceOriginalStart: "2026-11-06T21:00:00.000Z" },
    { status: "scheduled" as const, startAt: "2026-11-14T13:00:00.000Z", recurrenceOriginalStart: "2026-11-13T21:00:00.000Z" },
    { status: "completed" as const, startAt: "2026-11-20T21:00:00.000Z", recurrenceOriginalStart: "2026-11-20T21:00:00.000Z" },
    { status: "cancelled" as const, startAt: "2026-10-30T21:00:00.000Z", recurrenceOriginalStart: null },
    { status: "scheduled" as const, startAt: "2026-11-27T21:00:00.000Z", recurrenceOriginalStart: "2026-11-27T21:00:00.000Z" },
  ];
  const result = affectedFutureLessons(lessons, "2026-11-04", BA);
  assert.deepEqual(result.cancelled, ["viernes, 6 de noviembre 18:00"]);
  assert.deepEqual(result.rescheduled, ["viernes, 13 de noviembre 18:00 → sábado, 14 de noviembre 10:00"]);
  assert.deepEqual(affectedFutureLessons(lessons, "2026-12-01", BA), { rescheduled: [], cancelled: [] });
});

test("cableado: lo reprogramado y lo cancelado que afecta un cambio se muestra y se confirma antes de guardar (edición y intercambio)", () => {
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /\(segment\.superseded\.length > 0 \|\| affected\.rescheduled\.length > 0\) && readString\(formData, "confirmReplace"\) !== "true"/);
  assert.match(actions, /return \{ error: describeReplacements\(segment\.superseded, affected\), replaces: true \}/);
  assert.match(actions, /rescheduledReplaced: affected\.rescheduled,/);
  assert.match(read("components/calendar/series-swap-panel.tsx"), /estas clases reprogramadas/);
});
