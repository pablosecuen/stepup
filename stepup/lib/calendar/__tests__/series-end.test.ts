import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveRuleEnd, isValidDateKey, lastClassOfLineage, lastPlannedClass, lessonOccupiesSlot, minDateKey, planSeriesEndImpact, validateSeriesEndInput, weeksKey, type LessonForSeriesEnd } from "../series-end.ts";
import { lineageMemberIds, selectManageableRecurrenceSeries, type RuleForLineage } from "../lineage.ts";
import { toRecurrenceRuleRecord } from "../../repositories/recurrence-rules-mapping.ts";
import { instantDateKey, instantTimeLabel } from "../civil-calendar.ts";
import { generateOccurrences } from "../recurrence-engine.ts";
import type { RecurrenceRuleRow } from "../../db/database.types.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

const TZ = "America/Argentina/Buenos_Aires";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const week = (...sessions: [number, number][]): RecurrenceWeek => ({ weekIndex: 0, sessions: sessions.map(([weekday, hour]) => ({ weekday, hour, minute: 0, durationMinutes: 60 })) });
const label = (cls: { start: string } | null) => (cls ? `${instantDateKey(cls.start)} ${instantTimeLabel(cls.start)}` : null);

test("fechas civiles: sólo existen las reales y vacía es «sin fecha de finalización»", () => {
  for (const ok of ["2026-12-31", "2028-02-29", "2026-01-01"]) assert.equal(isValidDateKey(ok), true, ok);
  for (const bad of ["2026-02-31", "2026-13-01", "2026-1-1", "26-01-01", "", "2026-12-31T00:00:00Z"]) assert.equal(isValidDateKey(bad), false, bad);
  assert.equal(validateSeriesEndInput("", "2026-12-01"), null);
  assert.equal(validateSeriesEndInput("2026-12-01", "2026-12-01"), null, "el mismo día del inicio del tramo es válido (inclusiva)");
  assert.match(validateSeriesEndInput("2026-11-30", "2026-12-01") ?? "", /no puede ser anterior al inicio del tramo/);
  assert.match(validateSeriesEndInput("2026-02-31", "2026-01-01") ?? "", /no es válida/);
  assert.equal(minDateKey(null, "2026-12-01"), "2026-12-01");
  assert.equal(minDateKey("2026-12-01", null), "2026-12-01");
  assert.equal(minDateKey("2026-12-02", "2026-12-01"), "2026-12-01");
  assert.equal(minDateKey(null, null), null);
});

test("fin efectivo = el menor entre el fin propio y la fecha de la serie; un tramo que empieza después queda finalizado sin tocar su fila", () => {
  const base = { startDate: "2026-11-23", effectiveFromDate: "2026-11-23", status: "active" as const };
  assert.deepEqual(deriveRuleEnd({ ...base, endDate: null, seriesEndDate: null }), { endDate: null, status: "active" });
  assert.deepEqual(deriveRuleEnd({ ...base, endDate: null, seriesEndDate: "2026-12-31" }), { endDate: "2026-12-31", status: "active" });
  assert.deepEqual(deriveRuleEnd({ ...base, endDate: "2026-12-10", seriesEndDate: "2026-12-31" }), { endDate: "2026-12-10", status: "active" }, "el corte propio manda si es anterior");
  assert.deepEqual(deriveRuleEnd({ ...base, endDate: "2027-01-31", seriesEndDate: "2026-12-31" }), { endDate: "2026-12-31", status: "active" });
  // Cambio programado que empezaría después de la fecha de finalización: no genera nada.
  // El fin que se expone nunca queda antes del inicio de la fila: los motores de series lo rechazan (aun para una serie finalizada) y rompían la agenda.
  assert.deepEqual(deriveRuleEnd({ startDate: "2026-12-21", effectiveFromDate: "2026-12-21", endDate: null, seriesEndDate: "2026-12-10", status: "active" }), { endDate: "2026-12-21", status: "ended" });
  // Sucesora cuyo lunes de arranque es anterior al límite pero cuya fecha efectiva es posterior.
  assert.equal(deriveRuleEnd({ startDate: "2026-12-14", effectiveFromDate: "2026-12-17", endDate: null, seriesEndDate: "2026-12-15", status: "active" }).status, "ended");
  assert.equal(deriveRuleEnd({ startDate: "2026-12-14", effectiveFromDate: "2026-12-17", endDate: null, seriesEndDate: "2026-12-17", status: "active" }).status, "active", "el día del límite todavía pertenece a la serie");
  assert.equal(deriveRuleEnd({ ...base, endDate: null, seriesEndDate: "2026-12-31", status: "paused" }).status, "paused", "una pausada sigue pausada");
});

test("REGRESIÓN: un cambio programado que queda después de la fecha de finalización no rompe la agenda (el motor no lo rechaza ni genera clases)", () => {
  const row = { id: "c", owner_id: "o", legacy_mobile_id: null, primary_student_id: "s", rule_type: "weekly", cycle_length_weeks: 1, weeks: [week([4, 14])], modality: "online", timezone: TZ, start_date: "2027-01-04", end_date: null, series_end_date: "2026-12-20", status: "active", supersedes_recurrence_id: "b", superseded_by_recurrence_id: null, effective_from_date: "2027-01-07", class_title: null, activity_kind: "class", training_billing_agreement_id: null, operation_id: null, created_at: "", updated_at: "" } as unknown as RecurrenceRuleRow;
  const record = toRecurrenceRuleRecord(row, ["s"]);
  assert.equal(record.status, "ended");
  assert.equal(record.dbStatus, "active", "la fila no se toca");
  assert.ok(record.endDate !== null && record.endDate >= record.startDate, "el fin expuesto nunca es anterior al inicio");
  const engineRule = { recurrenceId: record.id, studentId: "s", participantIds: ["s"], cycleLengthWeeks: 1, weeks: record.weeks, modality: record.modality, timezone: record.timezone, startDate: record.startDate, endDate: record.endDate, status: record.status, classTitle: null, activityKind: record.activityKind } as RecurrenceRuleForEngine;
  assert.deepEqual(generateOccurrences(engineRule, new Date("2026-12-01T00:00:00Z"), new Date("2027-03-01T00:00:00Z")), []);
  // Aunque un llamador pase el fin sin recortar, una serie finalizada no se valida ni genera nada.
  assert.deepEqual(generateOccurrences({ ...engineRule, endDate: "2026-12-20" }, new Date("2026-12-01T00:00:00Z"), new Date("2027-03-01T00:00:00Z")), []);
});

test("el mapeo conserva el fin propio y la fecha de la serie por separado (lo que se copia a una sucesora nunca es el efectivo)", () => {
  const row = { id: "r1", owner_id: "o", legacy_mobile_id: null, primary_student_id: "s", rule_type: "weekly", cycle_length_weeks: 1, weeks: [], modality: "online", timezone: TZ, start_date: "2026-11-23", end_date: "2027-01-31", series_end_date: "2026-12-31", status: "active", supersedes_recurrence_id: null, superseded_by_recurrence_id: null, effective_from_date: null, class_title: null, activity_kind: "class", training_billing_agreement_id: null, operation_id: null, created_at: "", updated_at: "" } as RecurrenceRuleRow;
  const record = toRecurrenceRuleRecord(row, ["s"]);
  assert.equal(record.endDate, "2026-12-31", "efectivo: lo que usa el motor y el linaje");
  assert.equal(record.rawEndDate, "2027-01-31", "propio: lo que se persiste en una sucesora");
  assert.equal(record.seriesEndDate, "2026-12-31");
  const legacy = toRecurrenceRuleRecord({ ...row, series_end_date: undefined } as unknown as RecurrenceRuleRow, []);
  assert.equal(legacy.seriesEndDate, null);
  assert.equal(legacy.endDate, "2027-01-31", "una fila anterior a la migración sigue igual");
});

test("última clase prevista: la fecha es inclusiva y civil (una clase de las 21:00 del último día pertenece a la serie, sin saltos por UTC)", () => {
  const weeks = [week([4, 19])]; // viernes 19:00
  const input = { weeks, startDate: "2026-11-30", timezone: TZ, fromDate: "2026-12-01" };
  assert.equal(label(lastPlannedClass({ ...input, endDate: "2026-12-18" })), "2026-12-18 19:00", "fecha exacta de una clase");
  assert.equal(label(lastPlannedClass({ ...input, endDate: "2026-12-17" })), "2026-12-11 19:00", "fecha entre dos clases");
  assert.equal(label(lastPlannedClass({ ...input, endDate: "2026-12-19" })), "2026-12-18 19:00");
  assert.equal(lastPlannedClass({ ...input, endDate: "2026-12-03" }), null, "antes de la primera clase: ninguna");
  // 21:00 de Buenos Aires = 00:00Z del día siguiente: sigue siendo el día de la serie.
  const tarde = lastPlannedClass({ weeks: [week([4, 21])], startDate: "2026-11-30", timezone: TZ, fromDate: "2026-12-01", endDate: "2026-12-18" });
  assert.equal(tarde?.start, "2026-12-19T00:00:00.000Z");
  assert.equal(label(tarde), "2026-12-18 21:00");
});

test("última clase prevista: cruce de mes y de año, varios días y ciclos", () => {
  const friday = [week([4, 19])];
  assert.equal(label(lastPlannedClass({ weeks: friday, startDate: "2026-12-21", timezone: TZ, fromDate: "2026-12-21", endDate: "2026-12-31" })), "2026-12-25 19:00", "fin de año: el 31/12 no hay viernes, la última es el 25/12");
  assert.equal(label(lastPlannedClass({ weeks: friday, startDate: "2026-12-21", timezone: TZ, fromDate: "2026-12-21", endDate: "2027-01-01" })), "2027-01-01 19:00", "cruza el año y la fecha exacta es inclusiva");
  assert.equal(label(lastPlannedClass({ weeks: friday, startDate: "2026-12-28", timezone: TZ, fromDate: "2026-12-28", endDate: "2027-02-28" })), "2027-02-26 19:00", "cruza mes y año; febrero de 2027 tiene 28 días");
  const multi = [week([0, 18], [3, 20])]; // lunes 18 y jueves 20
  assert.equal(label(lastPlannedClass({ weeks: multi, startDate: "2026-11-30", timezone: TZ, fromDate: "2026-11-30", endDate: "2026-12-09" })), "2026-12-07 18:00", "varios días: el jueves 10/12 queda fuera");
  assert.equal(label(lastPlannedClass({ weeks: multi, startDate: "2026-11-30", timezone: TZ, fromDate: "2026-11-30", endDate: "2026-12-10" })), "2026-12-10 20:00");
  // Ciclo de 2 semanas (clase sólo la semana 0): 23/11, 07/12, 21/12…
  const cycle: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 10, minute: 0, durationMinutes: 60 }] }, { weekIndex: 1, sessions: [] }];
  assert.equal(label(lastPlannedClass({ weeks: cycle, startDate: "2026-11-23", timezone: TZ, fromDate: "2026-11-23", endDate: "2026-12-20" })), "2026-12-07 10:00", "ciclo de 2 semanas: el lunes 14/12 es de la semana vacía");
  assert.equal(label(lastPlannedClass({ weeks: cycle, startDate: "2026-11-23", timezone: TZ, fromDate: "2026-11-23", endDate: "2026-12-21" })), "2026-12-21 10:00");
  assert.equal(lastPlannedClass({ weeks: friday, startDate: "2026-12-21", timezone: TZ, fromDate: "2026-12-30", endDate: "2026-12-29" }), null, "fecha anterior al inicio: ninguna");
});

test("última clase de la SERIE ENTERA: cada tramo genera sólo en su período; un cambio programado más adelante no cuenta antes de empezar", () => {
  const thursday: RecurrenceWeek[] = [week([3, 17])]; // jueves 17:00
  const friday: RecurrenceWeek[] = [week([4, 14])]; // viernes 14:00
  const segments = [
    { weeks: thursday, startDate: "2026-09-07", effectiveFromDate: "2026-09-07", rawEndDate: "2027-01-06", timezone: TZ, dbStatus: "active" as const },
    { weeks: friday, startDate: "2027-01-04", effectiveFromDate: "2027-01-07", rawEndDate: null, timezone: TZ, dbStatus: "active" as const },
  ];
  assert.equal(label(lastClassOfLineage(segments, "2026-11-18", "2026-12-20")), "2026-12-17 17:00", "antes del cambio programado manda el tramo que rige hoy");
  assert.equal(label(lastClassOfLineage(segments, "2026-11-18", "2027-01-15")), "2027-01-15 14:00", "después, el del cambio programado");
  assert.equal(label(lastClassOfLineage(segments, "2026-11-18", "2027-01-07")), "2026-12-31 17:00", "el día 07/01 el tramo anterior ya terminó (06/01) y el nuevo todavía no tiene clase");
  assert.equal(label(lastClassOfLineage(segments, "2026-11-18", "2027-01-06")), "2026-12-31 17:00");
  assert.equal(lastClassOfLineage([{ ...segments[0], dbStatus: "ended" }], "2026-11-18", "2026-12-20"), null, "un tramo cerrado por estado no genera clases");
  assert.equal(lastClassOfLineage(segments, "2026-11-18", "2026-11-18"), null, "hoy no hay clase");
});

test("patrón: la clave canónica ignora el orden de claves y de sesiones", () => {
  const first: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 3, hour: 20, minute: 0, durationMinutes: 60 }, { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];
  const second = JSON.parse(`[{"sessions":[{"durationMinutes":60,"minute":0,"hour":18,"weekday":0},{"durationMinutes":60,"minute":0,"hour":20,"weekday":3}],"weekIndex":0}]`) as RecurrenceWeek[];
  assert.equal(weeksKey(first), weeksKey(second));
  assert.notEqual(weeksKey(first), weeksKey([{ weekIndex: 0, sessions: [{ weekday: 3, hour: 20, minute: 0, durationMinutes: 45 }, { weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }]));
});

const lesson = (overrides: Partial<LessonForSeriesEnd> & { id: string; startAt: string }): LessonForSeriesEnd => ({ status: "scheduled", occupiesSlot: true, rescheduled: false, cancelledBySeriesLimit: false, hasRegistration: false, hasCharge: false, ...overrides });

test("impacto de la fecha de finalización: sólo lo posterior (por su fecha REAL), sin registro ni cobro; lo reprogramado que cruza se informa", () => {
  const lessons = [
    lesson({ id: "antes", startAt: "2026-12-04T12:00:00.000Z" }),
    lesson({ id: "dia-del-limite", startAt: "2026-12-10T23:30:00.000Z" }), // 20:30 hora de la cuenta del último día: todavía pertenece
    lesson({ id: "despues", startAt: "2026-12-11T12:00:00.000Z" }),
    lesson({ id: "reprogramada", status: "rescheduled", rescheduled: true, startAt: "2026-12-15T12:00:00.000Z" }),
    lesson({ id: "manual", status: "cancelled", startAt: "2026-12-18T12:00:00.000Z" }),
    lesson({ id: "dictada", status: "completed", startAt: "2026-10-09T12:00:00.000Z" }),
    lesson({ id: "origen", status: "rescheduled", occupiesSlot: false, startAt: "2026-12-12T12:00:00.000Z" }),
  ];
  const impact = planSeriesEndImpact(lessons, "2026-12-10", TZ);
  assert.deepEqual(impact.toCancel.map((item) => item.id), ["despues", "reprogramada"]);
  assert.equal(impact.toCancel[1].rescheduled, true, "la reprogramada que cruza el límite se muestra como tal");
  assert.deepEqual(impact.blocked, []);
  assert.deepEqual(impact.toRestore, [], "una cancelación manual nunca se restaura");
  // Medianoche local: 23:30 UTC del 10/12 es el 10/12 en la cuenta (no el 11).
  assert.ok(!impact.toCancel.some((item) => item.id === "dia-del-limite"));
});

test("impacto: una clase posterior con registro o cobro BLOQUEA (no se resuelve con las reglas existentes); quitar el límite sólo restaura lo que canceló un límite", () => {
  const lessons = [
    lesson({ id: "con-registro", startAt: "2026-12-11T12:00:00.000Z", hasRegistration: true }),
    lesson({ id: "con-cobro", status: "completed", startAt: "2026-12-18T12:00:00.000Z", hasCharge: true }),
    lesson({ id: "libre", startAt: "2026-12-25T12:00:00.000Z" }),
    lesson({ id: "por-limite", status: "cancelled", cancelledBySeriesLimit: true, startAt: "2026-12-25T12:00:00.000Z" }),
    lesson({ id: "por-limite-reprogramada", status: "cancelled", cancelledBySeriesLimit: true, rescheduled: true, startAt: "2026-12-15T12:00:00.000Z" }),
    lesson({ id: "manual", status: "cancelled", startAt: "2026-12-20T12:00:00.000Z" }),
  ];
  const withLimit = planSeriesEndImpact(lessons, "2026-12-10", TZ);
  assert.deepEqual(withLimit.blocked.map((item) => item.id), ["con-registro", "con-cobro"]);
  assert.deepEqual(withLimit.toCancel.map((item) => item.id), ["libre"]);
  const extended = planSeriesEndImpact(lessons, "2026-12-16", TZ);
  assert.deepEqual(extended.toRestore.map((item) => item.id), ["por-limite-reprogramada"], "extender: vuelve sólo la que ahora queda dentro");
  const removed = planSeriesEndImpact(lessons, null, TZ);
  assert.deepEqual(removed.toRestore.map((item) => item.id).sort(), ["por-limite", "por-limite-reprogramada"]);
  assert.deepEqual(removed.toCancel, []);
  assert.deepEqual(removed.blocked, []);
});

test("agenda operativa de una clase real: cancelada, origen liberado y ocurrencia movida no ocupan", () => {
  const base = { id: "l1", recurrenceId: "r1", recurrenceOccurrenceKey: "k1", recurrenceOriginalStart: "2026-12-02T12:00:00.000Z" };
  assert.equal(lessonOccupiesSlot({ ...base, status: "scheduled" }, []), true);
  assert.equal(lessonOccupiesSlot({ ...base, status: "completed" }, []), true);
  assert.equal(lessonOccupiesSlot({ ...base, status: "cancelled" }, []), false);
  assert.equal(lessonOccupiesSlot({ ...base, status: "rescheduled", recurrenceOccurrenceKey: null }, []), true, "destino de una reprogramación");
  assert.equal(lessonOccupiesSlot({ ...base, status: "rescheduled", recurrenceId: null, recurrenceOccurrenceKey: null, recurrenceOriginalStart: null }, []), false, "origen de una clase suelta reprogramada");
  assert.equal(lessonOccupiesSlot({ ...base, status: "scheduled" }, [{ recurrenceId: "r1", occurrenceKey: "k1", type: "rescheduled", replacementLessonId: "otra" }]), false, "la ocurrencia ya se movió a otra clase");
  assert.equal(lessonOccupiesSlot({ ...base, status: "scheduled" }, [{ recurrenceId: "r1", occurrenceKey: "k1", type: "rescheduled", replacementLessonId: "l1" }]), true);
});

test("linaje: los tramos de UNA serie (anteriores, vigente, cambios programados) comparten la fecha; las series independientes del mismo alumno no", () => {
  const rule = (recurrenceId: string, supersedesRecurrenceId: string | null, extra: Partial<RuleForLineage> = {}): RuleForLineage => ({ recurrenceId, status: "active", endDate: null, timezone: TZ, supersedesRecurrenceId, effectiveFromDate: null, ...extra });
  const rules = [rule("a", null), rule("b", "a"), rule("c", "b"), rule("otra", null), rule("otra-b", "otra")];
  assert.deepEqual(lineageMemberIds(rules, "b").sort(), ["a", "b", "c"], "desde cualquier tramo se llega a todo el linaje");
  assert.deepEqual(lineageMemberIds(rules, "c").sort(), ["a", "b", "c"]);
  assert.deepEqual(lineageMemberIds(rules, "otra").sort(), ["otra", "otra-b"]);
  // Un ciclo corrupto no cuelga la pantalla.
  assert.equal(lineageMemberIds([rule("x", "y"), rule("y", "x")], "x").length, 2);
  // El cambio programado posterior al límite deja de ser vigente; la serie vigente pasa a ser el tramo anterior.
  const manageable = selectManageableRecurrenceSeries([rule("a", null, { endDate: "2026-12-10" }), rule("b", "a", { endDate: "2026-12-10", effectiveFromDate: "2026-11-23" }), rule("c", "b", { status: "ended", endDate: "2026-12-10", effectiveFromDate: "2026-12-21" })], "2026-11-30T12:00:00.000Z");
  assert.deepEqual(manageable.map((item) => item.recurrenceId), ["b"]);
});

test("cableado: el límite no se pierde en ningún flujo ni se reescribe el fin de los tramos", () => {
  const migration = read("supabase/migrations/20261118200000_extend_duration_and_series_end.sql");
  assert.match(migration, /create trigger inherit_series_end_date before insert on public\.recurrence_rules/, "una sucesora hereda el límite");
  assert.match(migration, /cancelled_by_series_limit/, "se distinguen las cancelaciones del límite de las independientes");
  assert.match(migration, /edit_recurrence_future_with_end/, "corte y límite en una sola transacción");
  assert.doesNotMatch(migration, /update public\.recurrence_rules set status = 'ended'/, "el límite no cierra tramos por estado");
  const actions = read("lib/actions/calendar.ts");
  assert.match(actions, /const successorEndDate = segment\.superseded\.length > 0 \? currentRule\.rawEndDate : target\.rawEndDate;/, "la sucesora hereda el fin PROPIO, no el efectivo");
  assert.match(actions, /weeksKey\(weeks\) === weeksKey\(target\.weeks\)/, "si sólo cambia la fecha no se crea un tramo nuevo");
  assert.match(actions, /endChanged && weeksKey\(weeks\) === weeksKey\(currentRule\.weeks\)/, "con un cambio programado más adelante, confirmar sólo la fecha no reemplaza el tramo que rige hoy");
  assert.ok(actions.indexOf("endChanged && weeksKey(weeks) === weeksKey(currentRule.weeks)") < actions.indexOf("const segment = resolveEditableSegment(allRules, originalRecurrenceId, effectiveDate);"), "se decide antes de exigir un tramo que rija en esa fecha (una serie que todavía no empezó también puede fijar su fecha)");
  assert.match(actions, /splitRecurrenceWithSeriesEnd\(ctx, \{ \.\.\.splitInput, seriesEnd:/);
  assert.match(read("lib/repositories/recurrence-split.ts"), /originalEndDate: original\.rawEndDate/);
  const ui = read("app/(app)/calendario/series/series-status-actions.tsx");
  assert.match(ui, /Fecha de finalización \(opcional\)/);
  assert.match(ui, /Sin fecha de finalización\./);
  assert.match(ui, /Última clase prevista:/);
  assert.match(ui, /min=\{futureDate\}/, "no admite una fecha anterior al inicio del tramo");
  assert.match(ui, /disabled=\{endBlocked\}/);
  assert.match(read("components/calendar/series-list-view.tsx"), /Hasta \{formatCivilDate\(rule\.endDate\)\}/);
  const form = read("app/(app)/calendario/nueva/new-lesson-form.tsx");
  assert.match(form, /Fecha de finalización \(opcional\)/);
  assert.doesNotMatch(form, /Fecha de fin \(opcional\)/);
});
