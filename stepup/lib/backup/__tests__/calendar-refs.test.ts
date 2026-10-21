import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CalendarRefResolver, registrationMarkers, sanitizeOccurrenceKey } from "../calendar-refs.ts";
import { adaptMobileBackup } from "../mobile-adapter.ts";
import { compareTransfer, type DestinationDump } from "../transfer-compare.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";

/**
 * Correspondencia entre el id virtual de una ocurrencia de serie y la clase materializada (`calendar_<estado>_<clave>`), con casos ANONIMIZADOS.
 * Regla de la app original: calendarRecurrenceMutations.ts (`buildCompletedCalendarLesson`, cancelaciones, reprogramaciones, restauraciones).
 */

const S1 = "2026-08-10T13:00:00.000Z";
const key = (n: number) => `recurrence_${n}_zzz_w1_c0_d2_t540_s0`;
const virtual = (n: number) => `calendar_${sanitizeOccurrenceKey(key(n))}`;
const lesson = (n: number, prefix: string, extra: Record<string, unknown> = {}) => ({
  id: `calendar_${prefix}_${sanitizeOccurrenceKey(key(n))}`,
  studentId: "stu-A",
  start: S1,
  end: "2026-08-10T14:00:00.000Z",
  status: prefix === "cancelled" ? "cancelled" : "completed",
  recurrenceId: `recurrence_${n}_zzz`,
  recurrenceOccurrenceKey: key(n),
  notes: `Registro pedagógico: reg-${n}`,
  ...extra,
});
const registration = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `reg-${n}`,
  calendarLessonId: virtual(n),
  calendarRegistration: { lessonId: virtual(n), start: S1, studentId: "stu-A", recurrenceOccurrenceKey: key(n), recurrenceId: `recurrence_${n}_zzz` },
  ...extra,
});

test("la clave de ocurrencia se sanea como en la app y las marcas «Registro pedagógico» se leen", () => {
  assert.equal(sanitizeOccurrenceKey("recurrence:abc:wk 1/2"), "recurrence_abc_wk_1_2");
  assert.deepEqual(registrationMarkers("Nota\nRegistro pedagógico: lesson_1\nRegistro pedagógico: lesson_2"), ["lesson_1", "lesson_2"]);
  assert.deepEqual(registrationMarkers(undefined), []);
});

test("completada y cancelada: el registro se enlaza con la clase materializada de la MISMA ocurrencia", () => {
  const refs = new CalendarRefResolver([lesson(1, "completed"), lesson(2, "cancelled")], [registration(1), registration(2)]);
  assert.deepEqual(refs.forRegistration("reg-1"), { kind: "resolved", id: lesson(1, "completed").id, evidence: ["clave de ocurrencia", "inicio", "alumno", "nota «Registro pedagógico»"] });
  const second = refs.forRegistration("reg-2");
  assert.equal(second.kind === "resolved" && second.id, lesson(2, "cancelled").id);
});

test("el id virtual puede tener un sufijo distinto de la clave: manda la clave de ocurrencia del registro", () => {
  const reg = registration(3, { calendarLessonId: "calendar_recurrence_otro_sufijo", calendarRegistration: { lessonId: "calendar_recurrence_otro_sufijo", start: S1, studentId: "stu-A", recurrenceOccurrenceKey: key(3) } });
  const refs = new CalendarRefResolver([lesson(3, "completed")], [reg]);
  assert.equal(refs.forRegistration("reg-3").kind, "resolved");
});

test("si el id ya existe no se toca (exacto) y sin referencia no hay nada que resolver", () => {
  const refs = new CalendarRefResolver([lesson(1, "completed")], [registration(1, { calendarLessonId: lesson(1, "completed").id }), { id: "reg-free" }]);
  assert.deepEqual(refs.forRegistration("reg-1"), { kind: "exact", id: lesson(1, "completed").id });
  assert.deepEqual(refs.forRegistration("reg-free"), { kind: "none" });
});

test("sin evidencia NO se inventa nada: sin clase candidata, inicio distinto, otro alumno o nota de otro registro quedan sin resolver", () => {
  const refs = new CalendarRefResolver(
    [lesson(5, "completed", { start: "2026-08-11T13:00:00.000Z" }), lesson(6, "completed", { studentId: "stu-B" }), lesson(7, "completed", { notes: "Registro pedagógico: reg-otro" })],
    [registration(4), registration(5), registration(6), registration(7)],
  );
  assert.deepEqual(refs.forRegistration("reg-4"), { kind: "unresolved", reason: "no_candidate" });
  assert.deepEqual(refs.forRegistration("reg-5"), { kind: "unresolved", reason: "mismatch" });
  assert.deepEqual(refs.forRegistration("reg-6"), { kind: "unresolved", reason: "mismatch" });
  assert.deepEqual(refs.forRegistration("reg-7"), { kind: "unresolved", reason: "contradicted" });
  assert.equal(CalendarRefResolver.target(refs.forRegistration("reg-4"), virtual(4)), virtual(4), "el id original se conserva tal cual");
});

test("una clase materializada no puede ser el destino de dos registros ni de uno resuelto y otro directo", () => {
  const twoClaim = new CalendarRefResolver([lesson(8, "completed", { notes: "" })], [registration(8), { ...registration(8), id: "reg-8b" }]);
  assert.deepEqual(twoClaim.forRegistration("reg-8"), { kind: "unresolved", reason: "ambiguous" });
  assert.deepEqual(twoClaim.forRegistration("reg-8b"), { kind: "unresolved", reason: "ambiguous" });
  const directToo = new CalendarRefResolver([lesson(9, "completed", { notes: "" })], [registration(9), { id: "reg-direct", calendarLessonId: lesson(9, "completed").id }]);
  assert.deepEqual(directToo.forRegistration("reg-9"), { kind: "unresolved", reason: "ambiguous" });
  assert.equal(directToo.forRegistration("reg-direct").kind, "exact");
});

test("dos clases materializadas posibles (completada y cancelada): sólo la que nombra al registro desempata; sin nota, ambigua", () => {
  const withNote = new CalendarRefResolver([lesson(10, "completed"), lesson(10, "cancelled", { notes: "" })], [registration(10)]);
  const resolved = withNote.forRegistration("reg-10");
  assert.equal(resolved.kind === "resolved" && resolved.id, lesson(10, "completed").id);
  const noNote = new CalendarRefResolver([lesson(11, "completed", { notes: "" }), lesson(11, "cancelled", { notes: "" })], [registration(11)]);
  assert.deepEqual(noNote.forRegistration("reg-11"), { kind: "unresolved", reason: "ambiguous" });
});

test("cobros por clase: el id virtual se resuelve sólo con una candidata consistente y sin contradecir al registro", () => {
  const refs = new CalendarRefResolver([lesson(12, "completed"), lesson(13, "completed")], [registration(12), registration(13)]);
  const ok = refs.forCharge(virtual(12), "reg-12");
  assert.equal(ok.kind === "resolved" && ok.id, lesson(12, "completed").id);
  assert.deepEqual(refs.forCharge(virtual(12), "reg-13"), { kind: "unresolved", reason: "contradicted" });
  assert.deepEqual(refs.forCharge(virtual(99)), { kind: "unresolved", reason: "no_candidate" });
  assert.deepEqual(refs.forCharge("lesson-suelta-1"), { kind: "unresolved", reason: "no_candidate" });
  assert.deepEqual(refs.forCharge(null), { kind: "none" });
  assert.equal(refs.forCharge(lesson(12, "completed").id).kind, "exact");
});

// ── Con el respaldo sintético completo: adaptador y comparador ───────────────────────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dirname, "..", "..", "..");
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "lib", "backup", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as DestinationDump;

/** Reproduce lo que hace la app: la clase `cal-1` (con clave de ocurrencia) pasa a ser `calendar_completed_<clave>` y el registro conserva el id virtual. */
function withMaterializedCal1() {
  const doc = buildMobileBackup() as Record<string, any>;
  const cal = doc.calendarLessons.find((c: any) => c.id === "cal-1");
  const virtualId = `calendar_${sanitizeOccurrenceKey(cal.recurrenceOccurrenceKey)}`;
  const materializedId = `calendar_completed_${sanitizeOccurrenceKey(cal.recurrenceOccurrenceKey)}`;
  cal.id = materializedId;
  cal.notes = [cal.notes, "Registro pedagógico: les-1"].filter(Boolean).join("\n");
  const reg = doc.pedagogicalLessons.find((l: any) => l.id === "les-1");
  reg.calendarLessonId = virtualId;
  reg.calendarRegistration = { ...(reg.calendarRegistration ?? {}), lessonId: virtualId, recurrenceOccurrenceKey: cal.recurrenceOccurrenceKey };
  for (const e of doc.recurrenceExceptions ?? []) if (e.replacementLessonId === "cal-1") e.replacementLessonId = materializedId;
  for (const c of doc.calendarLessons) if (c.freedByLessonId === "cal-1") c.freedByLessonId = materializedId;
  for (const c of doc.paymentCharges ?? []) if (c.calendarLessonId === "cal-1") c.calendarLessonId = materializedId;
  return { doc, virtualId, materializedId };
}

test("adaptador: el registro queda enlazado a la clase materializada, conserva el id original y todo lo demás idéntico; sin omisiones ni clases nuevas", () => {
  const baseline = adaptMobileBackup(buildMobileBackup());
  const { doc, virtualId, materializedId } = withMaterializedCal1();
  const result = adaptMobileBackup(doc);
  const adapt = (r: typeof result) => r.payload.pedagogicalLessons as any[];
  const reg = adapt(result).find((l) => l.id === "les-1");
  assert.equal(reg.calendarLessonId, materializedId);
  assert.equal(reg.sourceExtras.calendarLessonIdAtOrigin, virtualId);
  assert.equal(reg.sourceExtras.calendarRegistration.lessonId, virtualId, "la referencia original completa sigue guardada");
  const before = adapt(baseline).find((l) => l.id === "les-1");
  const strip = (r: any) => {
    const { calendarLessonId: _a, sourceExtras: { calendarLessonIdAtOrigin: _b, calendarRegistration: _c, ...extras }, ...rest } = r;
    return { rest, extras };
  };
  assert.deepEqual(strip(reg), strip(before), "alumno, fecha, contenido, asistencia, tareas y demás campos no cambian");
  assert.equal(result.report.omitted.length, baseline.report.omitted.length);
  assert.equal((result.payload.calendarLessons as unknown[]).length, (baseline.payload.calendarLessons as unknown[]).length, "no se agregan ni duplican clases");
  const conversion = result.report.conversions.find((c) => c.code === "calendar_lesson_linked_from_occurrence" && c.collection === "pedagogicalLessons");
  assert.equal(conversion?.count, 1);
});

test("adaptador: un registro SIN evidencia conserva su id original y no se descarta ni se le inventa clase", () => {
  const { doc } = withMaterializedCal1();
  const reg = (doc.pedagogicalLessons as any[]).find((l) => l.id === "les-1");
  reg.calendarRegistration = { ...reg.calendarRegistration, start: "2026-08-12T10:00:00.000Z" }; // el inicio ya no coincide
  const result = adaptMobileBackup(doc);
  const adapted = (result.payload.pedagogicalLessons as any[]).find((l) => l.id === "les-1");
  assert.equal(adapted.calendarLessonId, reg.calendarLessonId);
  assert.equal(adapted.sourceExtras.calendarLessonIdAtOrigin, undefined);
  assert.equal(result.report.omitted.some((o) => o.collection === "pedagogicalLessons"), false, "el adaptador no lo descarta: la importación lo informa como referencia sin resolver");
});

test("comparador: con la correspondencia inequívoca el cotejo sigue COMPLETO (y sin ella, la relación sería una diferencia)", () => {
  const { doc, materializedId } = withMaterializedCal1();
  const dump = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  const row = dump.calendar_lessons.find((r) => r.legacy_mobile_id === "cal-1") as Record<string, unknown>;
  row.legacy_mobile_id = materializedId;
  const registration = dump.lesson_registrations.find((r) => r.legacy_mobile_id === "les-1") as Record<string, unknown>;
  const extras = { ...((registration.source_extras as Record<string, unknown>) ?? {}) };
  extras.calendarRegistration = (doc.pedagogicalLessons as any[]).find((l) => l.id === "les-1").calendarRegistration;
  extras.calendarLessonIdAtOrigin = (doc.pedagogicalLessons as any[]).find((l) => l.id === "les-1").calendarLessonId;
  registration.source_extras = extras;
  const adaptation = adaptMobileBackup(doc);
  const result = compareTransfer(doc, dump, { adapterOmitted: adaptation.report.omitted });
  const relation = result.fields.filter((f) => /clase de calendario \(relación\)/.test(f.field) && f.mismatched > 0);
  assert.deepEqual(relation, [], "la relación con la clase materializada coincide");
});

test("comparador: si la web enlazara el registro con OTRA clase, el cotejo lo marca como diferencia", () => {
  const { doc, materializedId } = withMaterializedCal1();
  const dump = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  (dump.calendar_lessons.find((r) => r.legacy_mobile_id === "cal-1") as Record<string, unknown>).legacy_mobile_id = materializedId;
  const other = dump.calendar_lessons.find((r) => r.legacy_mobile_id === "cal-4") as Record<string, unknown>;
  (dump.lesson_registrations.find((r) => r.legacy_mobile_id === "les-1") as Record<string, unknown>).calendar_lesson_id = other.id;
  const result = compareTransfer(doc, dump, { adapterOmitted: adaptMobileBackup(doc).report.omitted });
  assert.equal(result.fields.filter((f) => /clase de calendario \(relación\)/.test(f.field) && f.mismatched > 0).length > 0, true);
});
