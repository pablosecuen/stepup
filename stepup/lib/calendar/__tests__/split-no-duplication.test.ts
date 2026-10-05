import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarViewForRange } from "../occurrences.ts";
import { buildExcludedOccurrenceKeys, planRecurrenceSplit } from "../split.ts";
import { getLocalDateKey } from "../timezone.ts";
import { listLineagePredecessors } from "../lineage.ts";
import type { RecurrenceRuleForEngine, RecurrenceWeek } from "../types.ts";

/**
 * Después de `effective_from` de un split "esta y las siguientes", SÓLO la sucesora puede generar clases: la serie original
 * debe terminar el día anterior. Caso real (QA, 2026-10-04): la original quedó sin fin (defecto original_patch.endDate) y el
 * Calendario mostraba el lunes viejo Y el martes nuevo cada semana desde el 12/10.
 */
const BA = "America/Argentina/Buenos_Aires";
const MONDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }];
const TUESDAY_18: RecurrenceWeek[] = [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 18, minute: 0, durationMinutes: 60 }] }];

function engineRule(overrides: Partial<RecurrenceRuleForEngine> & { recurrenceId: string; startDate: string; weeks: RecurrenceWeek[] }): RecurrenceRuleForEngine {
  return {
    studentId: "s1",
    participantIds: ["s1"],
    cycleLengthWeeks: 1,
    modality: "presencial",
    timezone: BA,
    endDate: null,
    status: "active",
    classTitle: null,
    activityKind: "class",
    ...overrides,
  };
}

/** Simula el efecto del RPC sobre las dos reglas: la original recibe el patch del plan, la sucesora arranca donde dice el plan. */
function splitRules(input: { originalStartDate: string; effectiveDate: string; todayDate: string; applyEndDate: boolean }) {
  const plan = planRecurrenceSplit({ originalRecurrenceId: "r1", originalStartDate: input.originalStartDate, originalEndDate: null, effectiveDate: input.effectiveDate, todayDate: input.todayDate });
  const original = engineRule({ recurrenceId: "r1", startDate: input.originalStartDate, weeks: MONDAY_18, status: plan.originalPatch.status, endDate: input.applyEndDate ? plan.originalPatch.endDate : null });
  const successor = engineRule({ recurrenceId: "r3", startDate: plan.successorStartDate, weeks: TUESDAY_18 });
  const excluded = buildExcludedOccurrenceKeys({
    successorRecurrenceId: "r3",
    successorStartDate: plan.successorStartDate,
    effectiveDate: input.effectiveDate,
    cycleLengthWeeks: 1,
    weeks: TUESDAY_18,
    modality: "presencial",
    timezone: BA,
    classTitle: null,
    activityKind: "class",
  });
  return { plan, original, successor, excluded };
}

function view(rules: RecurrenceRuleForEngine[], excluded: string[], from: string, to: string) {
  return buildCalendarViewForRange({
    rangeStart: new Date(`${from}T03:00:00Z`),
    rangeEnd: new Date(`${to}T02:59:59Z`),
    rules,
    exceptions: excluded.map((occurrenceKey) => ({ recurrenceId: "r3", occurrenceKey, type: "excluded" as const, replacementLessonId: null })),
    lessons: [],
  });
}

/** Días (clave civil) en que la ORIGINAL todavía genera una clase a partir de la fecha efectiva — debe ser vacío. */
function originalOccurrencesFrom(items: ReturnType<typeof view>, effectiveDate: string): string[] {
  return items.filter((item) => item.recurrenceId === "r1").map((item) => getLocalDateKey(item.start, BA)).filter((day) => day >= effectiveDate);
}

test("caso real (R1 lunes → R3 martes desde 12/10): con el fin aplicado la original llega al lunes 05/10 y NO genera nada desde el 12/10", () => {
  const { plan, original, successor, excluded } = splitRules({ originalStartDate: "2026-09-28", effectiveDate: "2026-10-12", todayDate: "2026-10-04", applyEndDate: true });
  assert.deepEqual(plan.originalPatch, { status: "active", endDate: "2026-10-11" });
  const items = view([original, successor], excluded, "2026-09-28", "2026-10-25");
  const byRule = (id: string) => items.filter((item) => item.recurrenceId === id).map((item) => getLocalDateKey(item.start, BA));
  assert.deepEqual(byRule("r1"), ["2026-09-28", "2026-10-05"], "la original: lunes 28/09 y 05/10 — legítimos, anteriores a la fecha efectiva");
  assert.deepEqual(byRule("r3"), ["2026-10-13", "2026-10-20"], "la sucesora: martes desde el 13/10");
  assert.deepEqual(originalOccurrencesFrom(items, "2026-10-12"), []);
});

test("el defecto original (end_date perdido): la original sigue activa y duplica el patrón nuevo cada semana — lo que detecta el invariante", () => {
  const { original, successor, excluded } = splitRules({ originalStartDate: "2026-09-28", effectiveDate: "2026-10-12", todayDate: "2026-10-04", applyEndDate: false });
  const items = view([original, successor], excluded, "2026-09-28", "2026-10-25");
  assert.deepEqual(originalOccurrencesFrom(items, "2026-10-12"), ["2026-10-12", "2026-10-19"], "lunes viejos DESPUÉS de la fecha efectiva: la duplicación observada en el Calendario real");
});

test("invariante sobre varias fechas efectivas (lunes, a mitad de semana, fin de mes): la original nunca genera desde la fecha efectiva y la sucesora no pisa lo anterior", () => {
  for (const effectiveDate of ["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-31", "2026-11-02"]) {
    const { plan, original, successor, excluded } = splitRules({ originalStartDate: "2026-09-28", effectiveDate, todayDate: "2026-10-04", applyEndDate: true });
    assert.equal(plan.originalPatch.endDate, new Date(Date.parse(`${effectiveDate}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), `fin = día anterior a ${effectiveDate}`);
    const items = view([original, successor], excluded, "2026-09-28", "2026-12-06");
    assert.deepEqual(originalOccurrencesFrom(items, effectiveDate), [], `la original no genera desde ${effectiveDate}`);
    const successorDays = items.filter((item) => item.recurrenceId === "r3").map((item) => getLocalDateKey(item.start, BA));
    assert.ok(successorDays.every((day) => day >= effectiveDate), `la sucesora no genera antes de ${effectiveDate}: ${successorDays.join(",")}`);
    assert.ok(successorDays.length > 0, "y sí genera después");
  }
});

test("cambiar desde el propio inicio de la serie cierra la original (status ended): tampoco genera nada", () => {
  const { plan, original, successor, excluded } = splitRules({ originalStartDate: "2026-10-12", effectiveDate: "2026-10-12", todayDate: "2026-10-04", applyEndDate: true });
  assert.equal(plan.originalPatch.status, "ended");
  const items = view([original, successor], excluded, "2026-10-05", "2026-11-01");
  assert.deepEqual(originalOccurrencesFrom(items, "2026-10-12"), []);
  assert.deepEqual(items.filter((item) => item.recurrenceId === "r1"), []);
});

test("listLineagePredecessors: la pantalla Series lista el tramo anterior vigente (hasta 11/10) junto a la sucesora — ninguno se oculta", () => {
  const NOW = "2026-10-04T18:00:00.000Z";
  const base = { timezone: BA, supersedesRecurrenceId: null, effectiveFromDate: null, status: "active" as const, endDate: null };
  const first = { ...base, recurrenceId: "r1", endDate: "2026-10-11" };
  const successor = { ...base, recurrenceId: "r3", supersedesRecurrenceId: "r1", effectiveFromDate: "2026-10-12" };
  assert.deepEqual(listLineagePredecessors([first, successor], successor, NOW).map((rule) => rule.recurrenceId), ["r1"]);
  // Un tramo ya terminado es historia: no se lista.
  const past = { ...first, endDate: "2026-09-30" };
  assert.deepEqual(listLineagePredecessors([past, successor], successor, NOW), []);
  assert.deepEqual(listLineagePredecessors([{ ...first, status: "ended" as const }, successor], successor, NOW), []);
  // Cadena de dos splits: el más cercano primero; sin ciclos aunque los datos estén mal.
  const second = { ...base, recurrenceId: "r2", supersedesRecurrenceId: "r1", effectiveFromDate: "2026-10-12", endDate: "2026-10-18" };
  const third = { ...base, recurrenceId: "r3", supersedesRecurrenceId: "r2", effectiveFromDate: "2026-10-19" };
  assert.deepEqual(listLineagePredecessors([first, second, third], third, NOW).map((rule) => rule.recurrenceId), ["r2", "r1"]);
  const loopA = { ...base, recurrenceId: "a", supersedesRecurrenceId: "b" };
  const loopB = { ...base, recurrenceId: "b", supersedesRecurrenceId: "a" };
  assert.deepEqual(listLineagePredecessors([loopA, loopB], loopA, NOW).map((rule) => rule.recurrenceId), ["b"]);
  // Sin predecesora: nada.
  assert.deepEqual(listLineagePredecessors([first], first, NOW), []);
});
