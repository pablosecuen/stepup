import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("buildRemindersCenterSummary: sólo los pagos que vencen HOY son recordatorios; uno ya vencido no aparece", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [chargeEntry({ urgency: "vence_hoy" }), chargeEntry({ chargeId: "c2", urgency: "mes_vencido" })],
    todayDateKey: TODAY,
  });
  const kinds = summary.categories.map((c) => c.kind);
  assert.deepEqual(kinds, ["pagos_por_vencer"]);
  assert.equal(summary.categories.find((c) => c.kind === "pagos_por_vencer")?.items.length, 1);
  assert.equal(summary.totalCount, 1, "el vencido no se cuenta");
});

test("buildRemindersCenterSummary: SÓLO pagos vencidos (tres, de cualquier tipo) → sin recordatorios, sin categorías y total 0 (nada de insignia «3»)", () => {
  const overdue = (id: string, extra: Partial<Parameters<typeof chargeEntry>[0]> = {}) => chargeEntry({ chargeId: id, ...extra });
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [overdue("a", { urgency: "mes_vencido" }), overdue("b", { urgency: "mes_vencido" }), overdue("c", { chargeType: "por_clase", urgency: null, dueDate: "2026-09-10", isOverdue: true })],
    todayDateKey: TODAY,
  });
  assert.deepEqual(summary, { totalCount: 0, categories: [] });
});

test("buildRemindersCenterSummary: vencidos + recordatorios legítimos → el total cuenta únicamente los legítimos, con las mismas reglas de siempre", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [emptyItem()],
    pendingLessons: [pendingLesson()],
    collectionEntries: [chargeEntry({ chargeId: "v1", urgency: "mes_vencido" }), chargeEntry({ chargeId: "v2", urgency: "mes_vencido" }), chargeEntry({ chargeId: "v3", urgency: "mes_vencido" }), chargeEntry({ chargeId: "h", urgency: "vence_hoy" })],
    todayDateKey: TODAY,
  });
  assert.equal(summary.totalCount, 3, "1 sin alumnos + 1 sin registrar + 1 que vence hoy; los 3 vencidos no suman");
  assert.deepEqual(summary.categories.map((c) => c.kind), ["clases_sin_alumnos", "clases_sin_registrar", "pagos_por_vencer"]);
  assert.ok(!summary.categories.flatMap((c) => c.items).some((item) => item.id.startsWith("charge_v")), "ninguna fila de un vencido");
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

test("buildRemindersCenterSummary: totalCount suma las 3 categorías reales (el vencido no suma)", () => {
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [emptyItem()],
    pendingLessons: [pendingLesson()],
    collectionEntries: [chargeEntry({ urgency: "vence_hoy" }), chargeEntry({ chargeId: "c2", urgency: "mes_vencido" })],
    todayDateKey: TODAY,
  });
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.categories.length, 3);
});

test("buildRemindersCenterSummary: un cargo POR CLASE (sin urgencia) que vence hoy es «por vencer»; el ya vencido no es un recordatorio", () => {
  const perClass = (id: string, dueDate: string, isOverdue: boolean) => chargeEntry({ chargeId: id, chargeType: "por_clase", urgency: null, dueDate, isOverdue });
  const summary = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [perClass("a", "2026-09-15", true), perClass("b", "2026-09-16", true), perClass("c", TODAY, false), perClass("d", TODAY, false)],
    todayDateKey: TODAY,
  });
  assert.equal(summary.categories.find((c) => c.kind === "pagos_por_vencer")?.items.length, 2);
  assert.equal(summary.totalCount, 2, "los 2 ya vencidos no suman");
  // Al día siguiente los dos que vencían hoy ya están vencidos: dejan de ser recordatorios.
  const tomorrow = buildRemindersCenterSummary({
    emptyClassItems: [],
    pendingLessons: [],
    collectionEntries: [perClass("a", "2026-09-15", true), perClass("b", "2026-09-16", true), perClass("c", TODAY, true), perClass("d", TODAY, true)],
    todayDateKey: "2026-09-23",
  });
  assert.deepEqual(tomorrow, { totalCount: 0, categories: [] });
});

test("cableado: una sola fuente para Inicio (insignia, cifra, panel) y «Ver todo»; ninguna pantalla filtra por su cuenta ni conoce «Pagos vencidos»; Cobros y el aviso de Inicio siguen existiendo", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const source = read("lib/dashboard/reminders-center.ts");
  assert.doesNotMatch(source, /pagos_vencidos|Pagos vencidos/, "la categoría ya no existe");
  const home = read("components/dashboard/home-view.tsx");
  assert.match(home, /const remindersCount = data\.remindersSummary\.totalCount;/, "Inicio cuenta con el total de la fuente");
  assert.match(home, /<DailyCollectionsNotice /, "el aviso financiero específico de Inicio se conserva");
  const page = read("app/(app)/recordatorios/page.tsx");
  assert.match(page, /summary = data\.remindersSummary;/, "«Ver todo» usa el mismo resumen");
  for (const file of ["components/dashboard/home-view.tsx", "components/reminders/reminders-view.tsx", "app/(app)/recordatorios/page.tsx", "components/reminders/reminder-icons.ts"]) {
    assert.doesNotMatch(read(file), /pagos_vencidos|isOverdue|collectionEntries\.filter/, `${file} no tiene su propio filtro de pagos`);
  }
});
