import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRemindersCenterSummary } from "../reminders-center.ts";
import type { EmptyClassItem } from "../../calendar/empty-classes.ts";
import type { PendingLessonItem } from "../../lessons/pending.ts";
import type { CollectionsCenterEntry } from "../../payments/collections-center.ts";

const TODAY = "2026-09-22";

function emptyItem(overrides: Partial<EmptyClassItem> = {}): EmptyClassItem {
  return { kind: "series", key: "series_r1", title: "Serie recurrente sin alumnos", startIso: "2026-09-23T13:00:00.000Z", ...overrides };
}

function pendingLesson(overrides: Partial<PendingLessonItem["item"]> = {}): PendingLessonItem {
  return {
    item: {
      id: "l1",
      recurrenceId: null,
      occurrenceKey: null,
      materializedLessonId: "l1",
      isMaterialized: true,
      studentId: "s1",
      participantIds: ["s1"],
      studentName: "Alumno Uno",
      level: "",
      lessonType: "individual",
      title: null,
      start: "2026-09-22T13:00:00.000Z",
      end: "2026-09-22T14:00:00.000Z",
      modality: "online",
      status: "scheduled",
      activityKind: "class",
      isRecurring: false,
      freedByLessonId: null,
      notes: null,
      ...overrides,
    },
    registrationState: "not_started",
    registrationId: null,
    completedParticipants: 0,
    totalParticipants: 1,
  };
}

function chargeEntry(overrides: Partial<CollectionsCenterEntry> = {}): CollectionsCenterEntry {
  return {
    chargeId: "c1",
    studentId: "s1",
    studentName: "Alumno Uno",
    chargeType: "mensual",
    dueDate: "2026-09-22",
    originalAmount: 50000,
    paidAmount: 0,
    balance: 50000,
    isOverdue: false,
    urgency: "vence_hoy",
    ...overrides,
  };
}

test("buildRemindersCenterSummary: una categoría sin ítems nunca aparece", () => {
  const summary = buildRemindersCenterSummary({ emptyClassItems: [], pendingLessons: [], collectionEntries: [], todayDateKey: TODAY });
  assert.deepEqual(summary, { totalCount: 0, categories: [] });
});

test("buildRemindersCenterSummary: cuenta clases sin alumnos", () => {
  const summary = buildRemindersCenterSummary({ emptyClassItems: [emptyItem()], pendingLessons: [], collectionEntries: [], todayDateKey: TODAY });
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.categories[0].kind, "clases_sin_alumnos");
});

test("buildRemindersCenterSummary: clase grupal pendiente muestra el conteo de alumnos en el título", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [pendingLesson({ participantIds: ["s1", "s2"] })],
    collectionEntries: [],
    todayDateKey: TODAY,
  });
  assert.equal(summary.categories[0].items[0].title, "Clase grupal · 2 alumnos");
});

test("buildRemindersCenterSummary: separa pagos por vencer (vence_hoy) de vencidos", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [chargeEntry({ urgency: "vence_hoy" }), chargeEntry({ chargeId: "c2", urgency: "mes_vencido" })],
    todayDateKey: TODAY,
  });
  const kinds = summary.categories.map((c) => c.kind);
  assert.ok(kinds.includes("pagos_por_vencer"));
  assert.ok(kinds.includes("pagos_vencidos"));
  assert.equal(summary.categories.find((c) => c.kind === "pagos_por_vencer")?.items.length, 1);
  assert.equal(summary.categories.find((c) => c.kind === "pagos_vencidos")?.items.length, 1);
});

test("buildRemindersCenterSummary: un cargo pendiente_en_termino (recién generado, lejos de vencer) nunca aparece", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [chargeEntry({ urgency: "pendiente_en_termino" })],
    todayDateKey: TODAY,
  });
  assert.deepEqual(summary, { totalCount: 0, categories: [] });
});

test("buildRemindersCenterSummary: totalCount suma las 4 categorías reales", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [emptyItem()],
    pendingLessons: [pendingLesson()],
    collectionEntries: [chargeEntry({ urgency: "vence_hoy" }), chargeEntry({ chargeId: "c2", urgency: "mes_vencido" })],
    todayDateKey: TODAY,
  });
  assert.equal(summary.totalCount, 4);
  assert.equal(summary.categories.length, 4);
});
