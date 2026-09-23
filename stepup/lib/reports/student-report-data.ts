import { calculateAverageGrade, normalizeSkillGradeValue } from "../lessons/grades.ts";
import { SKILLS, SKILL_LABEL, type Skill } from "../lessons/skills.ts";

/**
 * Puerto de `buildStudentReportData` (móvil, `reportes/utils/`) — construye
 * exclusivamente con datos reales de clases YA REGISTRADAS y finalizadas
 * (`countsAsClass && status === 'completed'`) del alumno, dentro del
 * período de meses seleccionados. Nunca incluye notas internas
 * (`individualObservation` NUNCA se lee acá — es la nota privada de la
 * profesora, equivalente real de `internalNotes` del móvil), nunca datos
 * financieros (`billedAmount` nunca se lee), nunca información de otros
 * alumnos (cada registro ya viene filtrado a un solo `studentId` por el
 * repositorio, antes de llegar acá). Pura.
 *
 * Diferencia real documentada respecto del móvil: no existe un campo de
 * "temas vistos" (`topicsSeen`) en el modelo de datos web — Fase 4 nunca
 * portó ese campo del registro pedagógico (no forma parte de
 * `lesson_registration_evaluations`/`lesson_registrations` reales) — se
 * omite acá en vez de inventarlo. "Puntualidad" usa el campo real
 * `lateMinutes` de la asistencia (`status: 'tarde'`), equivalente al
 * `studentArrival` del móvil pero con nombre/forma propios del esquema web.
 */
export interface RegistrationForStudentReport {
  registrationId: string;
  dateKey: string; // YYYY-MM-DD real de la clase
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  actualStartedAt: string | null;
  actualEndedAt: string | null;
  homeworkDescription: string | null; // tarea común del registro
  attendance: { status: "presente" | "ausente" | "tarde" | "ausente_aviso" | "sin_registrar"; lateMinutes: number | null } | null;
  evaluation: {
    generalGrade: number | null;
    skillGrades: Record<string, number>;
    strengths: string[];
    areasToImprove: string[];
    individualHomeworkDescription: string | null;
  } | null;
}

export interface StudentReportSkillNote {
  skill: Skill;
  label: string;
  averageGrade: number | null;
}

export interface StudentReportLessonDetail {
  dateKey: string;
  attended: boolean;
  attendanceStatus: string | null;
  generalGrade: number | null;
  durationMinutes: number;
}

export interface StudentReportAttendanceSummary {
  classesHeld: number;
  classesAttended: number;
  classesAbsent: number;
  ratePercent: number | null; // null si classesHeld === 0
}

export interface StudentReportPunctualitySummary {
  classesWithAttendanceData: number;
  onTimeCount: number;
  lateCount: number;
  averageLateMinutes: number | null; // sólo sobre las tardanzas reales, null si no hubo ninguna
}

export interface StudentReportData {
  classesHeld: number;
  hoursTaught: number;
  skillNotes: StudentReportSkillNote[];
  generalAverageGrade: number | null;
  strengths: string[];
  areasToImprove: string[];
  homeworkAssigned: string[];
  attendance: StudentReportAttendanceSummary;
  punctuality: StudentReportPunctualitySummary;
  lessonDetails: StudentReportLessonDetail[];
}

function durationMinutes(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0;
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
}

export function buildStudentReportData(registrations: readonly RegistrationForStudentReport[]): StudentReportData {
  const classesHeld = registrations.length;

  const hoursTaught =
    registrations.reduce((sum, r) => sum + (durationMinutes(r.actualStartedAt, r.actualEndedAt) || durationMinutes(r.scheduledStartAt, r.scheduledEndAt)), 0) / 60;

  const skillNotes: StudentReportSkillNote[] = SKILLS.map((skill) => {
    const grades = registrations.map((r) => normalizeSkillGradeValue(r.evaluation?.skillGrades[skill] ?? null));
    return { skill, label: SKILL_LABEL[skill], averageGrade: calculateAverageGrade(grades) };
  });

  const generalAverageGrade = calculateAverageGrade(registrations.map((r) => r.evaluation?.generalGrade ?? null));

  const strengths = [...new Set(registrations.flatMap((r) => r.evaluation?.strengths ?? []).filter((s) => s.trim() !== ""))];
  const areasToImprove = [...new Set(registrations.flatMap((r) => r.evaluation?.areasToImprove ?? []).filter((s) => s.trim() !== ""))];

  const homeworkAssigned = [
    ...new Set(
      registrations.flatMap((r) => [r.homeworkDescription, r.evaluation?.individualHomeworkDescription ?? null]).filter((h): h is string => !!h && h.trim() !== "")
    ),
  ];

  const attended = registrations.filter((r) => r.attendance?.status === "presente" || r.attendance?.status === "tarde");
  const absent = registrations.filter((r) => r.attendance?.status === "ausente" || r.attendance?.status === "ausente_aviso");
  const attendance: StudentReportAttendanceSummary = {
    classesHeld,
    classesAttended: attended.length,
    classesAbsent: absent.length,
    ratePercent: classesHeld > 0 ? Math.round((attended.length / classesHeld) * 1000) / 10 : null,
  };

  const withAttendanceData = registrations.filter((r) => r.attendance && r.attendance.status !== "sin_registrar");
  const lateOnes = withAttendanceData.filter((r) => r.attendance?.status === "tarde");
  const lateMinutesValues = lateOnes.map((r) => r.attendance?.lateMinutes).filter((m): m is number => m != null && m > 0);
  const punctuality: StudentReportPunctualitySummary = {
    classesWithAttendanceData: withAttendanceData.length,
    onTimeCount: withAttendanceData.filter((r) => r.attendance?.status === "presente").length,
    lateCount: lateOnes.length,
    averageLateMinutes: lateMinutesValues.length > 0 ? Math.round((lateMinutesValues.reduce((s, m) => s + m, 0) / lateMinutesValues.length) * 10) / 10 : null,
  };

  const lessonDetails: StudentReportLessonDetail[] = registrations
    .map((r) => ({
      dateKey: r.dateKey,
      attended: r.attendance?.status === "presente" || r.attendance?.status === "tarde",
      attendanceStatus: r.attendance?.status ?? null,
      generalGrade: r.evaluation?.generalGrade ?? null,
      durationMinutes: durationMinutes(r.actualStartedAt, r.actualEndedAt) || durationMinutes(r.scheduledStartAt, r.scheduledEndAt),
    }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));

  return { classesHeld, hoursTaught: Math.round(hoursTaught * 10) / 10, skillNotes, generalAverageGrade, strengths, areasToImprove, homeworkAssigned, attendance, punctuality, lessonDetails };
}
