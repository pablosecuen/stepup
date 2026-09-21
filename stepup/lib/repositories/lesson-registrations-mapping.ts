import type {
  ActivityKind,
  LessonRegistrationAttendanceRow,
  LessonRegistrationEvaluationRow,
  LessonRegistrationHomeworkReviewRow,
  LessonRegistrationRow,
  LessonRegistrationStatus,
  LessonRegistrationStudentRow,
} from "../db/database.types";
import type { AttendanceStatus } from "../lessons/attendance";
import type { ParticipantRegistrationStatus } from "../lessons/group-progress";
import type { HomeworkReviewOutcome } from "../lessons/homework";

/**
 * Lógica PURA del repositorio de registros de clases — separada de
 * `lesson-registrations.ts` (I/O real) para poder probarse con
 * `node --test` sin Supabase/Next, mismo patrón que `students-mapping.ts`.
 */

export interface LessonRegistrationRecord {
  id: string;
  calendarLessonId: string | null;
  activityKind: ActivityKind;
  countsAsClass: boolean;
  status: LessonRegistrationStatus;
  homeworkDescription: string | null;
  homeworkDueDate: string | null;
  billedAmount: number | null;
  scheduledStartAt: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toLessonRegistrationRecord(row: LessonRegistrationRow): LessonRegistrationRecord {
  return {
    id: row.id,
    calendarLessonId: row.calendar_lesson_id,
    activityKind: row.activity_kind,
    countsAsClass: row.counts_as_class,
    status: row.status,
    homeworkDescription: row.homework_description,
    homeworkDueDate: row.homework_due_date,
    billedAmount: row.billed_amount,
    scheduledStartAt: row.scheduled_start_at,
    actualStartedAt: row.actual_started_at,
    actualEndedAt: row.actual_ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LessonRegistrationStudentRecord {
  studentId: string;
  participantStatus: ParticipantRegistrationStatus;
}

export function toLessonRegistrationStudentRecord(row: LessonRegistrationStudentRow): LessonRegistrationStudentRecord {
  return { studentId: row.student_id, participantStatus: row.participant_status };
}

export interface LessonRegistrationAttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  lateMinutes: number | null;
}

export function toLessonRegistrationAttendanceRecord(row: LessonRegistrationAttendanceRow): LessonRegistrationAttendanceRecord {
  return { studentId: row.student_id, status: row.status, lateMinutes: row.late_minutes };
}

export interface LessonRegistrationEvaluationRecord {
  studentId: string;
  generalGrade: number | null;
  skillGrades: Record<string, number>;
  strengths: string[];
  areasToImprove: string[];
  individualObservation: string | null;
  individualHomeworkDescription: string | null;
  individualHomeworkDueDate: string | null;
  billedAmount: number | null;
}

export function toLessonRegistrationEvaluationRecord(row: LessonRegistrationEvaluationRow): LessonRegistrationEvaluationRecord {
  return {
    studentId: row.student_id,
    generalGrade: row.general_grade,
    skillGrades: row.skill_grades,
    strengths: row.strengths,
    areasToImprove: row.areas_to_improve,
    individualObservation: row.individual_observation,
    individualHomeworkDescription: row.individual_homework_description,
    individualHomeworkDueDate: row.individual_homework_due_date,
    billedAmount: row.billed_amount,
  };
}

export interface LessonRegistrationHomeworkReviewRecord {
  studentId: string;
  taskId: string;
  outcome: HomeworkReviewOutcome;
  reviewedAt: string;
}

export function toLessonRegistrationHomeworkReviewRecord(row: LessonRegistrationHomeworkReviewRow): LessonRegistrationHomeworkReviewRecord {
  return { studentId: row.student_id, taskId: row.task_id, outcome: row.outcome, reviewedAt: row.reviewed_at };
}

/** Vista compuesta real de un registro — encabezado + roster + hijas, agrupadas por alumno para renderizar directo. */
export interface LessonRegistrationDetail {
  registration: LessonRegistrationRecord;
  participants: LessonRegistrationStudentRecord[];
  attendanceByStudentId: Record<string, LessonRegistrationAttendanceRecord>;
  evaluationByStudentId: Record<string, LessonRegistrationEvaluationRecord>;
  homeworkReviewsByStudentId: Record<string, LessonRegistrationHomeworkReviewRecord[]>;
}

export function buildLessonRegistrationDetail(params: {
  registration: LessonRegistrationRecord;
  participants: LessonRegistrationStudentRecord[];
  attendance: LessonRegistrationAttendanceRecord[];
  evaluations: LessonRegistrationEvaluationRecord[];
  homeworkReviews: LessonRegistrationHomeworkReviewRecord[];
}): LessonRegistrationDetail {
  const attendanceByStudentId: Record<string, LessonRegistrationAttendanceRecord> = {};
  params.attendance.forEach((a) => {
    attendanceByStudentId[a.studentId] = a;
  });
  const evaluationByStudentId: Record<string, LessonRegistrationEvaluationRecord> = {};
  params.evaluations.forEach((e) => {
    evaluationByStudentId[e.studentId] = e;
  });
  const homeworkReviewsByStudentId: Record<string, LessonRegistrationHomeworkReviewRecord[]> = {};
  params.homeworkReviews.forEach((h) => {
    const list = homeworkReviewsByStudentId[h.studentId] ?? [];
    list.push(h);
    homeworkReviewsByStudentId[h.studentId] = list;
  });
  return {
    registration: params.registration,
    participants: params.participants,
    attendanceByStudentId,
    evaluationByStudentId,
    homeworkReviewsByStudentId,
  };
}
