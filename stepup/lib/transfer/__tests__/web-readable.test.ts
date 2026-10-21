import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMobileBackup } from "../../backup/__fixtures__/mobile-real-shape.ts";
import type { DestinationDump } from "../../backup/transfer-compare.ts";
import { toStudentRecord } from "../../repositories/students-mapping.ts";
import { toPaymentChargeRecord, toPaymentRecord, toPaymentAllocationRecord } from "../../repositories/payments-mapping.ts";
import { toLessonRegistrationRecord, toLessonRegistrationStudentRecord, toLessonRegistrationAttendanceRecord, toLessonRegistrationEvaluationRecord } from "../../repositories/lesson-registrations-mapping.ts";
import { toCalendarLessonRecord } from "../../repositories/calendar-lessons-mapping.ts";
import { toRecurrenceRuleRecord } from "../../repositories/recurrence-rules-mapping.ts";
import { toReportRecord, toReportRecordSummary } from "../../repositories/reports-mapping.ts";
import { toLessonContent } from "../../repositories/lesson-content-mapping.ts";
import { toStatusHistoryRecord, toLevelHistoryRecord, toPriceHistoryRecord } from "../../repositories/student-history-mapping.ts";

/**
 * «¿Se puede consultar en la web lo que se trasladó?» — las funciones que la web usa para LEER cada fila (los mismos mapeadores de los repositorios) aplicadas a lo que la
 * base deja después del traslado (volcado de referencia sintético): no fallan, y devuelven lo que el origen tenía.
 */
type Row = Record<string, unknown>;
const dump = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "backup", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as DestinationDump;
const source = buildMobileBackup();
const byLegacy = (table: string, legacy: string) => dump[table].find((r) => r.legacy_mobile_id === legacy) as Row;
const as = <T>(row: unknown) => row as T;

test("alumnos: cada fila se lee con los datos del origen (nombre, contacto, plan de cobro, fechas)", () => {
  for (const row of dump.students) assert.doesNotThrow(() => toStudentRecord(as(row)));
  const one = toStudentRecord(as(byLegacy("students", "stu-1")));
  assert.equal(one.name, "ZQ Alumna Uno");
  assert.equal(one.phone, "+54 9 11 5550-0001");
  assert.equal(one.notes, "ZQ nota privada de la alumna uno");
  assert.equal(one.dateJoined, "2026-03-02");
  assert.equal(dump.students.length, (source.students as unknown[]).length);
});

test("cobros, pagos y asignaciones: se leen con sus importes, vencimientos y vínculos exactos", () => {
  const charges = dump.payment_charges.map((r) => toPaymentChargeRecord(as(r)));
  const totalOrigin = (source.paymentCharges as Array<{ originalAmount: number }>).reduce((n, c) => n + c.originalAmount, 0);
  assert.ok(Math.abs(charges.reduce((n, c) => n + Number(c.originalAmount), 0) - totalOrigin) < 1e-6, "la suma de importes de cobros coincide con el origen");
  const payments = dump.payments.map((r) => toPaymentRecord(as(r)));
  const paidOrigin = (source.payments as Array<{ amount: number }>).reduce((n, p) => n + p.amount, 0);
  assert.ok(Math.abs(payments.reduce((n, p) => n + Number(p.amount), 0) - paidOrigin) < 1e-6);
  const allocations = dump.payment_allocations.map((r) => toPaymentAllocationRecord(as(r)));
  assert.equal(allocations.length, (source.paymentAllocations as unknown[]).length);
  const charge1 = toPaymentChargeRecord(as(byLegacy("payment_charges", "chg-1")));
  assert.equal(charge1.dueDate, "2026-10-10");
  assert.equal(charge1.billingPeriod, "2026-10");
});

test("clases registradas: estado, participantes, asistencia y evaluaciones se leen; el registro grupal a medio completar sigue «en curso»", () => {
  const regs = dump.lesson_registrations.map((r) => toLessonRegistrationRecord(as(r)));
  assert.equal(regs.length, (source.pedagogicalLessons as unknown[]).length);
  assert.equal(toLessonRegistrationRecord(as(byLegacy("lesson_registrations", "les-2"))).status, "in_progress");
  assert.equal(toLessonRegistrationRecord(as(byLegacy("lesson_registrations", "les-1"))).status, "completed");
  for (const r of dump.lesson_registration_students) assert.doesNotThrow(() => toLessonRegistrationStudentRecord(as(r)));
  for (const r of dump.lesson_registration_attendance) assert.doesNotThrow(() => toLessonRegistrationAttendanceRecord(as(r)));
  for (const r of dump.lesson_registration_evaluations) assert.doesNotThrow(() => toLessonRegistrationEvaluationRecord(as(r)));
  const completed = dump.lesson_registration_students.filter((r) => toLessonRegistrationStudentRecord(as(r)).participantStatus === "completed").length;
  assert.ok(completed >= 8, "los participantes de las clases finalizadas están «completados»");
});

test("contenido de la clase: temas, objetivos, notas, materiales y adjuntos llegan a lo que la pantalla muestra", () => {
  const row = byLegacy("lesson_registrations", "les-1");
  const attachments = dump.lesson_attachments.filter((a) => a.lesson_registration_id === row.id) as unknown as Parameters<typeof toLessonContent>[1];
  const materials = dump.material_library_items as unknown as Parameters<typeof toLessonContent>[2];
  const content = toLessonContent(row as Parameters<typeof toLessonContent>[0], attachments, materials);
  assert.ok(content);
  assert.deepEqual(content.topics.map((t) => [t.text, t.status]), [["ZQ tema visto uno", "visto"], ["ZQ tema planificado dos", "planificado"]]);
  assert.deepEqual(content.objectives, ["ZQ objetivo de la clase"]);
  assert.equal(content.internalNotes, "ZQ notas internas de la clase");
  assert.deepEqual(content.attachments.map((a) => [a.name, a.availability]), [["ZQ guia.pdf", "disponible"]]);
  assert.deepEqual(content.materials.map((m) => [m.name, m.availability]), [["ZQ Unidad 3 - verbos irregulares", "disponible"]]);
});

test("series y calendario: se leen con sus integrantes y sus vínculos", () => {
  const rules = dump.recurrence_rules.map((r) => toRecurrenceRuleRecord(as(r), (dump.recurrence_rule_participants.filter((p) => p.recurrence_rule_id === r.id) as Row[]).map((p) => String(p.student_id))));
  assert.equal(rules.length, (source.recurrenceRules as unknown[]).length);
  const lessons = dump.calendar_lessons.map((l) => toCalendarLessonRecord(as(l), (dump.calendar_lesson_participants.filter((p) => p.calendar_lesson_id === l.id) as Row[]).map((p) => String(p.student_id))));
  assert.equal(lessons.length, (source.calendarLessons as unknown[]).length);
  assert.ok(lessons.some((l) => l.recurrenceId !== null) && lessons.some((l) => l.freedByLessonId !== null));
});

test("reportes: el historial los lista y el detalle trae el snapshot para volver a generar el PDF; el PDF subido figura disponible", () => {
  for (const row of dump.report_records) {
    const summary = toReportRecordSummary(as(row));
    const detail = toReportRecord(as(row));
    assert.equal(summary.hasPdf, true);
    assert.equal(summary.title, "ZQ Reporte septiembre");
    assert.equal(detail.snapshot.studentName, "ZQ Alumna Uno");
    assert.equal(detail.snapshot.data.attendance.classesHeld, 8);
  }
});

test("historiales de la ficha del alumno: estados, niveles y precios se leen", () => {
  assert.equal(dump.student_status_history.map((r) => toStatusHistoryRecord(as(r))).length, 2);
  assert.equal(dump.student_level_history.map((r) => toLevelHistoryRecord(as(r))).length, 2);
  assert.equal(dump.student_price_history.map((r) => toPriceHistoryRecord(as(r))).length, 3);
});
