import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { isOperativeAgendaItem, occupiesAgendaSlot, resolveAgendaItems } from "../agenda.ts";
import { buildCalendarViewForRange, isActiveReplacement, visibleCalendarItems, type CalendarViewItem, type MaterializedLessonForMerge } from "../occurrences.ts";
import { applyReplacementVisibility } from "../replacement-visibility.ts";
import { layoutDayItems } from "../layout.ts";
import { simultaneousGroups } from "../simultaneous-groups.ts";
import { buildTodayAgenda } from "../../dashboard/today-agenda.ts";
import { buildPendingLessons } from "../../lessons/pending.ts";
import { selectCurrentOrNextOccurrence } from "../next-class.ts";
import { daySlots } from "../parity.ts";
import { toConflictCandidates } from "../conflict-candidates.ts";
import { findCalendarConflicts } from "../../calendar-conflicts.ts";
import type { RecurrenceRuleForEngine } from "../types.ts";

const item = (id: string, patch: Partial<CalendarViewItem> = {}): CalendarViewItem => ({
  id, recurrenceId: null, occurrenceKey: null, materializedLessonId: id, isMaterialized: true, studentId: id, participantIds: [id], studentName: id, level: "A1", lessonType: "individual", title: null,
  start: "2026-11-16T19:00:00.000Z", end: "2026-11-16T20:00:00.000Z", modality: "presencial", status: "scheduled", activityKind: "class", isRecurring: false, freedByLessonId: null, notes: null, ...patch,
});

test("la regla: cancelada, origen liberado y reemplazada salen de la agenda; programada, reprogramada (destino) y dictada permanecen", () => {
  assert.equal(isOperativeAgendaItem(item("a")), true);
  assert.equal(isOperativeAgendaItem(item("b", { status: "rescheduled" })), true, "el destino de una reprogramación es una clase vigente");
  assert.equal(isOperativeAgendaItem(item("c", { status: "completed" })), true);
  assert.equal(isOperativeAgendaItem(item("d", { status: "cancelled" })), false);
  assert.equal(isOperativeAgendaItem(item("e", { occupiesSlot: false })), false);
  assert.equal(isOperativeAgendaItem(item("f", { hiddenByReplacement: true })), false);
  assert.equal(occupiesAgendaSlot, isOperativeAgendaItem, "una sola regla para dibujar, contar y ocupar horario");
  assert.deepEqual(resolveAgendaItems([item("a"), item("d", { status: "cancelled" }), item("e", { occupiesSlot: false })]).map((i) => i.id), ["a"]);
  const all = [item("a"), item("d", { status: "cancelled" })];
  resolveAgendaItems(all);
  assert.equal(all.length, 2, "no modifica ni borra la lista completa (historia)");
});

// El caso de la captura: una clase CANCELADA (que fue una clase movida: fila real, sin clave de ocurrencia) y, en el mismo horario, una ocurrencia VIRTUAL vigente de otra serie.
const LUCY_RULE: RecurrenceRuleForEngine = {
  recurrenceId: "rule-lucy", studentId: "lucy", participantIds: ["lucy"], cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 16, minute: 0, durationMinutes: 60 }] }],
  modality: "presencial", timezone: "America/Argentina/Buenos_Aires", startDate: "2026-11-09", endDate: null, status: "active", classTitle: null, activityKind: "class",
};
const PILAR: MaterializedLessonForMerge = {
  id: "pilar", recurrenceId: "rule-pilar", recurrenceOccurrenceKey: null, primaryStudentId: "pilar", studentName: "Pilar", level: "A1", lessonType: "individual", startAt: "2026-11-16T19:00:00.000Z", endAt: "2026-11-16T20:00:00.000Z",
  modality: "presencial", status: "cancelled", recurrenceOriginalStart: "2026-11-09T17:00:00.000Z", isRecurring: true, classTitle: null, activityKind: "class", freedByLessonId: null, notes: null, participantIds: ["pilar"],
};
const CAPTURE_RANGE = { rangeStart: new Date("2026-11-16T03:00:00Z"), rangeEnd: new Date("2026-11-23T02:59:59Z") };

test("el caso de la captura (lunes 16:00): la cancelada deja de dibujarse y de contarse; Lucy es la única clase vigente, con UN carril y sin numeración de simultáneas", () => {
  const all = buildCalendarViewForRange({ ...CAPTURE_RANGE, rules: [LUCY_RULE], exceptions: [], lessons: [PILAR], students: new Map([["lucy", { name: "Lucy", levels: ["A1"] }]]) });
  const monday = all.filter((i) => i.start === "2026-11-16T19:00:00.000Z");
  assert.deepEqual(monday.map((i) => [i.studentName, i.status]).sort(), [["Lucy", "scheduled"], ["Pilar", "cancelled"]], "la vista completa conserva ambas (historia)");
  // ANTES: la regla anterior dejaba las dos y las repartía en dos carriles.
  const legacy = all.filter((i) => !(i.occupiesSlot === false || i.hiddenByReplacement) && !(i.freedByLessonId && i.status === "cancelled") && !(i.status === "cancelled" && all.some((o) => o.freedByLessonId === i.id && o.status !== "cancelled")));
  assert.deepEqual(layoutDayItems(legacy).map((p) => p.laneCount), [2, 2], "el defecto: dos carriles por una clase que ya no existe");
  // DESPUÉS.
  const agenda = visibleCalendarItems(all);
  const placed = layoutDayItems(agenda);
  assert.deepEqual(placed.map((p) => [p.item.studentName, p.laneCount]), [["Lucy", 1]]);
  assert.deepEqual(simultaneousGroups("2026-11-16", placed, (i) => i.studentName), [], "sin grupo ni numeración de simultáneas");
  assert.equal(all.length, agenda.length + 1, "el historial conserva la cancelada");
});

test("dos clases realmente vigentes al mismo horario siguen siendo dos (simultáneas legítimas): dos carriles y un grupo; al cancelar una, queda una", () => {
  const two = [item("x"), item("y")];
  assert.deepEqual(layoutDayItems(resolveAgendaItems(two)).map((p) => p.laneCount), [2, 2]);
  assert.equal(simultaneousGroups("2026-11-16", layoutDayItems(resolveAgendaItems(two)), (i) => i.studentName).length, 1);
  const afterCancel = [item("x"), item("y", { status: "cancelled" })];
  assert.deepEqual(layoutDayItems(resolveAgendaItems(afterCancel)).map((p) => p.laneCount), [1]);
  assert.equal(simultaneousGroups("2026-11-16", layoutDayItems(resolveAgendaItems(afterCancel)), (i) => i.studentName).length, 0);
});

test("un reemplazo vigente: la cancelada original no se dibuja pero el reemplazo se sigue reconociendo (color coral) con la lista completa", () => {
  const original = item("orig", { status: "cancelled" });
  const replacement = item("repl", { freedByLessonId: "orig", studentName: "Lucy" });
  const all = [original, replacement];
  assert.deepEqual(visibleCalendarItems(all).map((i) => i.id), ["repl"]);
  assert.equal(isActiveReplacement(replacement, all), true);
  assert.equal(isActiveReplacement(replacement, visibleCalendarItems(all)), false, "por eso las pantallas resuelven el color con la lista completa y dibujan la agenda");
});

test("reprogramar: el origen liberado no ocupa horario, no cuenta ni genera carril; sólo existe el destino; una cadena A→B→C deja sólo C", () => {
  const a = item("a", { status: "rescheduled" });
  const b = item("b", { status: "rescheduled", start: "2026-11-17T19:00:00.000Z", end: "2026-11-17T20:00:00.000Z" });
  const c = item("c", { status: "rescheduled", start: "2026-11-18T19:00:00.000Z", end: "2026-11-18T20:00:00.000Z" });
  const links = { lessons: [{ originalLessonId: "a", replacementLessonId: "b", kind: "moved" as const, replacementActive: true }, { originalLessonId: "b", replacementLessonId: "c", kind: "moved" as const, replacementActive: true }], series: [] };
  const all = applyReplacementVisibility([a, b, c], links);
  assert.deepEqual(resolveAgendaItems(all).map((i) => i.id), ["c"]);
  assert.deepEqual(all.filter((i) => !occupiesAgendaSlot(i)).map((i) => i.id), ["a", "b"]);
});

test("Inicio (agenda del día y próxima clase), pendientes de registro y búsqueda de horarios libres parten de la misma regla", () => {
  const live = item("live");
  const cancelled = item("cancelled", { status: "cancelled" });
  const released = item("released", { status: "rescheduled", occupiesSlot: false });
  const replaced = item("replaced", { hiddenByReplacement: true, occupiesSlot: false });
  const all = [live, cancelled, released, replaced];
  const now = new Date("2026-11-16T12:00:00.000Z");
  assert.deepEqual(buildTodayAgenda(all, now, "2026-11-16").map((e) => e.item.id), ["live"]);
  assert.equal(selectCurrentOrNextOccurrence(all, now)?.occurrence.id, "live");
  assert.deepEqual(buildPendingLessons({ calendarItems: all, now: new Date("2026-11-17T00:00:00Z"), registrations: [] }).map((p) => p.item.id), ["live"]);
  const availability = { schemaVersion: 1 as const, timezone: "America/Argentina/Buenos_Aires", weeklyBlocks: [], exceptions: [] };
  const slot = (items: CalendarViewItem[]) => daySlots("2026-11-16", 60, items, availability).find((s) => s.time === "16:00")!;
  assert.equal(slot([cancelled, released, replaced]).available, true, "sólo retiradas: el horario está libre");
  assert.equal(slot([live, cancelled]).available, false, "una clase vigente sí ocupa");
  const candidates = toConflictCandidates([cancelled, released, replaced, live]);
  assert.deepEqual(candidates.map((c) => c.id), ["live"], "los choques sólo se calculan contra la agenda operativa");
  assert.equal(findCalendarConflicts("2026-11-16T19:00:00.000Z", "2026-11-16T20:00:00.000Z", toConflictCandidates([cancelled, released, replaced])).length, 0);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Guarda estructural: nadie reimplementa a mano «no cancelada y ocupa horario»; todo pasa por `agenda.ts`.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(".", path).split(sep).join("/"));
  }
  return out;
}

test("guarda: sólo agenda.ts decide quién ocupa horario; ningún archivo combina a mano `status !== cancelled` con `occupiesSlot`", () => {
  const offenders = [...walk("lib"), ...walk("app"), ...walk("components")].filter((file) => {
    if (["lib/calendar/agenda.ts"].includes(file) || file.startsWith("lib/original-core/") || file.startsWith("lib/payments/engine/")) return false;
    const source = readFileSync(join(ROOT, file), "utf8");
    return /status\s*!==\s*['"]cancelled['"]\s*&&\s*[\w.]*occupiesSlot\s*!==\s*false/.test(source) || /occupiesSlot\s*!==\s*false\s*&&\s*[\w.]*status\s*!==\s*['"]cancelled['"]/.test(source);
  });
  assert.deepEqual(offenders, [], "usar `occupiesAgendaSlot` / `resolveAgendaItems` de lib/calendar/agenda.ts");
});

test("guarda: lo que dibuja la grilla, la agenda de Inicio y los contadores parte de la agenda operativa (nunca de la lista completa)", () => {
  const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
  assert.match(read("components/calendar/real-calendar-grid.tsx"), /const visible = visibleCalendarItems\(items\);/);
  assert.match(read("components/calendar/real-calendar-grid.tsx"), /layoutDayItems\(itemsByDayKey\.get\(dayKey\)/);
  assert.match(read("components/calendar/real-calendar-grid.tsx"), /const itemsByDayKey = groupItemsByDayKey\(visible\);/, "los carriles se calculan sobre lo visible, nunca se esconde con CSS lo ya contado");
  assert.match(read("lib/dashboard/today-agenda.ts"), /visibleCalendarItems\(all\)/);
  assert.match(read("lib/dashboard/load-home-data.ts"), /const todayLessons = resolveAgendaItems\(todayItems\);/);
  assert.match(read("lib/dashboard/load-home-data.ts"), /const weekItems = resolveAgendaItems\(composeCalendarView\(/);
  assert.match(read("lib/lessons/pending.ts"), /item\.occupiesSlot === false \|\| item\.hiddenByReplacement/);
  assert.match(read("lib/dashboard/load-financial-overview.ts"), /const periodItems = resolveAgendaItems\(composeCalendarView\(/, "lo programado no cuenta canceladas ni orígenes reprogramados");
  assert.match(read("lib/dashboard/load-financial-overview.ts"), /const demandItems = resolveAgendaItems\(composeCalendarView\(/);
  assert.doesNotMatch(read("lib/calendar/occurrences.ts"), /hasActiveReplacementForCancelledSlot/, "la regla anterior (cancelada visible salvo con reemplazo) ya no existe");
});

test("tras cancelar, la acción devuelve el id y revalida todo lo que cuenta clases; el detalle ofrece (una vez) reemplazar o deshacer, y sólo si el horario es futuro", () => {
  const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
  const action = read("lib/actions/calendar.ts");
  assert.match(action, /Promise<FormState & \{ cancelledLessonId\?: string \}>/);
  assert.match(action, /for \(const path of \["\/calendario", "\/inicio", "\/registro", "\/recordatorios", "\/alumnos"\]\) revalidatePath\(path\);\s*return \{ cancelledLessonId \};/);
  const modal = read("components/calendar/real-lesson-detail-modal.tsx");
  assert.match(modal, /if \(result\.cancelledLessonId\) \{\s*setConfirmingCancel\(false\);\s*setCancelledLessonId\(result\.cancelledLessonId\);/);
  assert.match(modal, /step === "cancelled" && cancelledLessonId/);
  assert.match(modal, /\{isFutureSlot && \(\s*<PrivateButtonLink\s*href=\{`\/calendario\/nueva\?freedByLessonId=\$\{cancelledLessonId\}/, "reemplazar sólo si el horario liberado es futuro");
  assert.match(modal, /restoreOccurrenceAction\(\{ lessonId: cancelledLessonId, confirmOverlap \}\)/);
});
