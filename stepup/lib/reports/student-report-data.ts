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
 * Temas vistos (`topicsSeen`) y evidencias (fotos/PDF adjuntos): salen del contenido pedagógico de cada clase (`topics` con estado «visto» y los adjuntos vigentes), igual que en el móvil. Un adjunto
 * sin alumno es común a toda la clase; uno de un alumno sólo entra al reporte de ESE alumno. "Puntualidad" usa el campo real
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
  /** Textos de los temas marcados «visto» en esa clase. Si falta (datos anteriores), no hay temas. */
  topicsSeen?: string[];
  /** Adjuntos vigentes y disponibles que pueden ir al reporte de este alumno (comunes a la clase o suyos). */
  attachments?: { attachmentId: string; kind: "pdf" | "image"; name: string; caption: string | null }[];
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

export interface StudentReportEvidenceCandidate {
  attachmentId: string;
  registrationId: string;
  dateKey: string;
  kind: "pdf" | "image";
  name: string;
  caption: string | null;
}

export interface StudentReportLessonDetail {
  dateKey: string;
  /** Temas vistos en la clase. Ausente en reportes anteriores. */
  topicsSeen?: string[];
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
  /** Temas vistos en el período, sin repetir. Ausente en reportes anteriores. */
  topicsSeen?: string[];
  /** Fotos y PDF que la profesora puede elegir para el reporte (nunca se incluyen sin elegirlos). Ausente en reportes anteriores. */
  evidenceCandidates?: StudentReportEvidenceCandidate[];
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

  const topicsSeen = [...new Set(registrations.flatMap((r) => r.topicsSeen ?? []).map((t) => t.trim()).filter((t) => t !== ""))];
  const evidenceCandidates: StudentReportEvidenceCandidate[] = registrations
    .flatMap((r) => (r.attachments ?? []).map((a) => ({ attachmentId: a.attachmentId, registrationId: r.registrationId, dateKey: r.dateKey, kind: a.kind, name: a.name, caption: a.caption })))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : a.name < b.name ? -1 : 1));

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
      topicsSeen: [...new Set((r.topicsSeen ?? []).map((t) => t.trim()).filter((t) => t !== ""))],
      attended: r.attendance?.status === "presente" || r.attendance?.status === "tarde",
      attendanceStatus: r.attendance?.status ?? null,
      generalGrade: r.evaluation?.generalGrade ?? null,
      durationMinutes: durationMinutes(r.actualStartedAt, r.actualEndedAt) || durationMinutes(r.scheduledStartAt, r.scheduledEndAt),
    }))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));

  return { topicsSeen, evidenceCandidates, classesHeld, hoursTaught: Math.round(hoursTaught * 10) / 10, skillNotes, generalAverageGrade, strengths, areasToImprove, homeworkAssigned, attendance, punctuality, lessonDetails };
}
