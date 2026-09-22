import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeCollectionsUrgency } from "../collections-urgency.ts";
import type { CollectionsCenterEntry } from "../collections-center.ts";

function entry(overrides: Partial<CollectionsCenterEntry> = {}): CollectionsCenterEntry {
  return {
    chargeId: "c1",
    studentId: "s1",
    studentName: "Alumno",
    chargeType: "mensual",
    dueDate: "2026-09-22",
    originalAmount: 50000,
    paidAmount: 0,
    balance: 50000,
    isOverdue: false,
    urgency: "pendiente_en_termino",
    ...overrides,
  };
}

const TODAY = "2026-09-22";

test("summarizeCollectionsUrgency: mensual vence_hoy cuenta en dueToday", () => {
  const summary = summarizeCollectionsUrgency([entry({ urgency: "vence_hoy" })], TODAY);
  assert.deepEqual(summary, { dueToday: 1, overdueCount: 0 });
});

test("summarizeCollectionsUrgency: mensual mes_vencido cuenta en overdueCount", () => {
  const summary = summarizeCollectionsUrgency([entry({ urgency: "mes_vencido" })], TODAY);
  assert.deepEqual(summary, { dueToday: 0, overdueCount: 1 });
});

test("summarizeCollectionsUrgency: mensual pendiente_en_termino/vence_pronto no cuentan en ninguna de las dos", () => {
  const summary = summarizeCollectionsUrgency([entry({ urgency: "pendiente_en_termino" }), entry({ urgency: "vence_pronto" })], TODAY);
  assert.deepEqual(summary, { dueToday: 0, overdueCount: 0 });
});

test("summarizeCollectionsUrgency: por_clase (urgency null) vencido cuenta en overdueCount", () => {
  const summary = summarizeCollectionsUrgency([entry({ chargeType: "por_clase", urgency: null, isOverdue: true, dueDate: "2026-09-15" })], TODAY);
  assert.deepEqual(summary, { dueToday: 0, overdueCount: 1 });
});

test("summarizeCollectionsUrgency: por_clase (urgency null) venciendo hoy, todavía no vencido, cuenta en dueToday", () => {
  const summary = summarizeCollectionsUrgency([entry({ chargeType: "por_clase", urgency: null, isOverdue: false, dueDate: TODAY })], TODAY);
  assert.deepEqual(summary, { dueToday: 1, overdueCount: 0 });
});

test("summarizeCollectionsUrgency: por_clase (urgency null) todavía no vencido y no vence hoy no cuenta en ninguna", () => {
  const summary = summarizeCollectionsUrgency([entry({ chargeType: "por_clase", urgency: null, isOverdue: false, dueDate: "2026-09-30" })], TODAY);
  assert.deepEqual(summary, { dueToday: 0, overdueCount: 0 });
});

test("summarizeCollectionsUrgency: sin entradas -> ceros", () => {
  assert.deepEqual(summarizeCollectionsUrgency([], TODAY), { dueToday: 0, overdueCount: 0 });
});

test("summarizeCollectionsUrgency: combinación real de varias entradas", () => {
  const summary = summarizeCollectionsUrgency(
    [
      entry({ urgency: "vence_hoy" }),
      entry({ urgency: "mes_vencido" }),
      entry({ urgency: "mes_vencido" }),
      entry({ chargeType: "por_clase", urgency: null, isOverdue: true, dueDate: "2026-09-10" }),
      entry({ urgency: "pendiente_en_termino" }),
    ],
    TODAY
  );
  assert.deepEqual(summary, { dueToday: 1, overdueCount: 3 });
});
