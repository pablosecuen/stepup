import { test } from "node:test";
import assert from "node:assert/strict";
import { CalendarRefResolver, sanitizeOccurrenceKey } from "../calendar-refs.ts";
import { adaptMobileBackup } from "../mobile-adapter.ts";
import { buildOriginIncidents } from "../origin-incidents.ts";
import { buildMobileBackup } from "../__fixtures__/mobile-real-shape.ts";

/** Referencias a clases del calendario que YA colgaban en el origen: nada se descarta, nada se inventa, todo se declara. Datos ANONIMIZADOS. */

const S1 = "2026-08-10T13:00:00.000Z";
const KEY = "recurrence_1_zzz_w1_c0_d2_t540_s0";
const VIRTUAL = `calendar_${sanitizeOccurrenceKey(KEY)}`;

/** `cal-1` de la fixture pasa a llamarse como lo hace la app al materializarla; `les-1` conserva el id virtual. */
function docWithOccurrence(options: { removeMaterialized: boolean }) {
  const doc = buildMobileBackup() as Record<string, any>;
  const cal = doc.calendarLessons.find((c: any) => c.id === "cal-1");
  cal.id = `calendar_completed_${sanitizeOccurrenceKey(cal.recurrenceOccurrenceKey)}`;
  cal.notes = "Registro pedagógico: les-1";
  const reg = doc.pedagogicalLessons.find((l: any) => l.id === "les-1");
  const virtual = `calendar_${sanitizeOccurrenceKey(cal.recurrenceOccurrenceKey)}`;
  reg.calendarLessonId = virtual;
  reg.calendarRegistration = { ...(reg.calendarRegistration ?? {}), lessonId: virtual, recurrenceOccurrenceKey: cal.recurrenceOccurrenceKey };
  for (const c of doc.paymentCharges ?? []) if (c.calendarLessonId === "cal-1") c.calendarLessonId = cal.id;
  for (const c of doc.calendarLessons) if (c.freedByLessonId === "cal-1") c.freedByLessonId = cal.id;
  for (const e of doc.recurrenceExceptions ?? []) if (e.replacementLessonId === "cal-1") e.replacementLessonId = cal.id;
  if (options.removeMaterialized) doc.calendarLessons = doc.calendarLessons.filter((c: any) => c.id !== cal.id);
  return { doc, virtual };
}

test("registrationTarget: sin clase en el origen → sin enlace; con clase candidata pero evidencia que no coincide → se deja el id original (la importación se detiene a la vista)", () => {
  const lesson = (start: string) => ({ id: `calendar_completed_${sanitizeOccurrenceKey(KEY)}`, studentId: "stu-A", start, recurrenceOccurrenceKey: KEY, notes: "" });
  const registration = (id: string, key: string) => ({ id, calendarLessonId: `calendar_${sanitizeOccurrenceKey(key)}`, calendarRegistration: { start: S1, studentId: "stu-A", recurrenceOccurrenceKey: key } });
  const refs = new CalendarRefResolver([lesson("2026-08-11T13:00:00.000Z")], [registration("reg-missing", "otra_clave_w2"), registration("reg-mismatch", KEY)]);
  assert.equal(refs.registrationTarget("reg-missing", "calendar_otra_clave_w2"), null);
  assert.equal(refs.registrationTarget("reg-mismatch", VIRTUAL), VIRTUAL);
});

test("adaptador: un registro cuya clase no existe en el respaldo se importa SIN clase de calendario, con todo su contenido y la referencia original, y no se omite", () => {
  const baseline = adaptMobileBackup(buildMobileBackup());
  const { doc, virtual } = docWithOccurrence({ removeMaterialized: true });
  const result = adaptMobileBackup(doc);
  const adapted = (result.payload.pedagogicalLessons as any[]).find((l) => l.id === "les-1");
  assert.equal(adapted.calendarLessonId, null);
  assert.equal(adapted.sourceExtras.calendarLessonIdAtOrigin, virtual);
  assert.equal(adapted.sourceExtras.calendarLessonMissingAtOrigin, true);
  assert.equal(adapted.sourceExtras.calendarRegistration.lessonId, virtual, "la referencia original completa sigue guardada");
  assert.equal(result.report.omitted.some((o) => o.collection === "pedagogicalLessons"), false, "no se descarta ningún registro");
  const strip = (r: any) => {
    const { calendarLessonId: _a, sourceExtras: { calendarLessonIdAtOrigin: _b, calendarLessonMissingAtOrigin: _c, calendarRegistration: _d, ...extras }, ...rest } = r;
    return { rest, extras };
  };
  assert.deepEqual(strip(adapted), strip((baseline.payload.pedagogicalLessons as any[]).find((l) => l.id === "les-1")), "alumno, fecha, contenido, asistencia y demás campos intactos");
  assert.equal(result.report.conversions.find((c) => c.code === "calendar_lesson_missing_at_origin_kept_unlinked")?.count, 1);
  const incidents = buildOriginIncidents(doc, new CalendarRefResolver(doc.calendarLessons, doc.pedagogicalLessons));
  const mine = incidents.filter((i) => i.entity === "pedagogicalLessons");
  assert.deepEqual(mine.map((i) => [i.rowId, i.field, i.originalReference, i.kind]), [["les-1", "calendarLessonId", virtual, "referencia_inexistente_en_origen"]]);
});

test("referencias colgantes de «clase que liberó», reemplazos y cobros se declaran aparte (id de la fila y campo)", () => {
  const doc = buildMobileBackup() as Record<string, any>;
  doc.calendarLessons[0].freedByLessonId = "calendar_cancelled_recurrence_inexistente";
  doc.recurrenceExceptions = [...(doc.recurrenceExceptions ?? []), { recurrenceId: "rec-x", occurrenceKey: "rec-x:w1", type: "rescheduled", replacementLessonId: "calendar_rescheduled_recurrence_inexistente", createdAt: "2026-08-01T10:00:00.000Z" }];
  doc.paymentCharges[1].calendarLessonId = "calendar_recurrence_inexistente_w1";
  const found = buildOriginIncidents(doc, new CalendarRefResolver(doc.calendarLessons, doc.pedagogicalLessons));
  assert.deepEqual(found.map((d) => `${d.entity}:${d.field}`).sort(), ["calendarLessons:freedByLessonId", "paymentCharges:calendarLessonId", "recurrenceExceptions:replacementLessonId"]);
});

test("un cobro por clase sin clase en el origen se importa sin ese enlace y se declara; el resto del cobro no cambia", () => {
  const baseline = adaptMobileBackup(buildMobileBackup());
  const doc = buildMobileBackup() as Record<string, any>;
  doc.paymentCharges[1].calendarLessonId = "calendar_recurrence_inexistente_w1";
  const result = adaptMobileBackup(doc);
  const charge = (result.payload.paymentCharges as any[])[1];
  assert.equal(charge.calendarLessonId, null);
  const before = (baseline.payload.paymentCharges as any[])[1];
  assert.deepEqual({ ...charge, calendarLessonId: null }, { ...before, calendarLessonId: null });
  assert.equal(result.report.conversions.find((c) => c.code === "calendar_lesson_missing_at_origin" && c.collection === "paymentCharges")?.count, 1);
});
