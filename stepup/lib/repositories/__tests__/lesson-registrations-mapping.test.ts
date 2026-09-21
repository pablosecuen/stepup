import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toLessonRegistrationRecord,
  toLessonRegistrationStudentRecord,
  buildLessonRegistrationDetail,
} from "../lesson-registrations-mapping.ts";
import type { LessonRegistrationRow, LessonRegistrationStudentRow } from "../../db/database.types.ts";

function registrationRow(overrides: Partial<LessonRegistrationRow> = {}): LessonRegistrationRow {
  return {
    id: "reg_1",
    owner_id: "owner_1",
    legacy_mobile_id: null,
    calendar_lesson_id: "cl_1",
    activity_kind: "class",
    counts_as_class: true,
    status: "in_progress",
    homework_description: null,
    homework_due_date: null,
    billed_amount: null,
    scheduled_start_at: "2026-09-20T21:00:00.000Z",
    actual_started_at: null,
    actual_ended_at: null,
    created_at: "2026-09-20T21:00:00.000Z",
    updated_at: "2026-09-20T21:00:00.000Z",
    ...overrides,
  };
}

test("toLessonRegistrationRecord: mapea cada columna snake_case a su campo camelCase real", () => {
  const record = toLessonRegistrationRecord(registrationRow({ status: "completed", counts_as_class: false }));
  assert.equal(record.status, "completed");
  assert.equal(record.countsAsClass, false);
  assert.equal(record.calendarLessonId, "cl_1");
});

test("toLessonRegistrationStudentRecord: conserva participant_status tal cual", () => {
  const row: LessonRegistrationStudentRow = { id: "x", owner_id: "o", lesson_registration_id: "reg_1", student_id: "st_1", participant_status: "omitted" };
  assert.equal(toLessonRegistrationStudentRecord(row).participantStatus, "omitted");
});

test("buildLessonRegistrationDetail: agrupa asistencia/evaluación/tareas por alumno real", () => {
  const detail = buildLessonRegistrationDetail({
    registration: toLessonRegistrationRecord(registrationRow()),
    participants: [
      { studentId: "st_1", participantStatus: "completed" },
      { studentId: "st_2", participantStatus: "pending" },
    ],
    attendance: [{ studentId: "st_1", status: "presente", lateMinutes: null }],
    evaluations: [{ studentId: "st_1", generalGrade: 9, skillGrades: {}, strengths: [], areasToImprove: [], individualObservation: null, individualHomeworkDescription: null, individualHomeworkDueDate: null, billedAmount: null }],
    homeworkReviews: [
      { studentId: "st_1", taskId: "common:reg_old", outcome: "realizada", reviewedAt: "2026-09-20T21:00:00.000Z" },
      { studentId: "st_1", taskId: "individual:reg_old:st_1", outcome: "parcial", reviewedAt: "2026-09-20T21:00:00.000Z" },
    ],
  });

  assert.equal(detail.attendanceByStudentId.st_1.status, "presente");
  assert.equal(detail.attendanceByStudentId.st_2, undefined, "st_2 nunca mezcla datos de st_1");
  assert.equal(detail.evaluationByStudentId.st_1.generalGrade, 9);
  assert.equal(detail.homeworkReviewsByStudentId.st_1.length, 2);
});
