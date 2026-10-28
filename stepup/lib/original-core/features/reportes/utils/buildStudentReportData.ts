// Puerto VERBATIM del original (`src/features/reportes/utils/buildStudentReportData.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { SavedLesson, Skill } from '../../new-class/types/index.ts';
import { resolveAttachmentKind } from '../../new-class/utils/attachmentKind.ts';
import { buildPunctualitySummary, type PunctualityScoreEntry } from '../../new-class/utils/punctualityStats.ts';
import type {
  StudentReportData,
  StudentReportEvidenceCandidate,
  StudentReportLessonDetail,
  StudentReportPeriod,
  StudentReportPunctualitySummary,
  StudentReportSkillNote,
} from '../types/index.ts';

/**
 * Función pura — recibe las clases ya guardadas (`getSavedLessons()` en el
 * llamador real) y arma el resumen objetivo del período. Nunca lee stores
 * directamente, para poder probarla sin infraestructura de AsyncStorage.
 */
const SKILL_LABEL: Record<Skill, string> = {
  speaking: 'Habla',
  listening: 'Escucha',
  reading: 'Lectura',
  writing: 'Escritura',
  grammar: 'Gramática',
  vocabulary: 'Vocabulario',
  pronunciation: 'Pronunciación',
  participation: 'Participación',
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function isLessonInPeriod(lesson: SavedLesson, studentId: string, period: StudentReportPeriod): boolean {
  return (
    lesson.form.studentIds.includes(studentId) &&
    lesson.form.date >= period.startDate &&
    lesson.form.date <= period.endDate
  );
}

export function buildStudentReportData(input: {
  studentId: string;
  studentName: string;
  period: StudentReportPeriod;
  allLessons: SavedLesson[];
}): StudentReportData {
  const { studentId, studentName, period, allLessons } = input;
  const lessons = allLessons.filter((lesson) => isLessonInPeriod(lesson, studentId, period));

  const topicsSeen = Array.from(
    new Set(
      lessons.flatMap((lesson) =>
        lesson.form.topics.filter((topic) => topic.status === 'visto').map((topic) => topic.text)
      )
    )
  );

  const evaluations = lessons
    .flatMap((lesson) => lesson.form.evaluations)
    .filter((evaluation) => evaluation.studentId === studentId);

  const skillGradesBySkill = new Map<Skill, number[]>();
  for (const evaluation of evaluations) {
    for (const [skill, grade] of Object.entries(evaluation.skillGrades) as Array<[Skill, number | undefined]>) {
      // Corrección P0 2026-08-19 (a pedido de Joaquín — "NOTAS POR ÁREA
      // ASIGNA 5 ACCIDENTALMENTE"): 0 nunca es una nota real (ver
      // SkillGradeChips.tsx) — se excluye igual que null/undefined, tanto
      // para una nota nueva como para cualquier cero heredado de datos
      // anteriores.
      if (grade == null || grade === 0) continue;
      const current = skillGradesBySkill.get(skill) ?? [];
      current.push(grade);
      skillGradesBySkill.set(skill, current);
    }
  }
  const skillNotes: StudentReportSkillNote[] = Array.from(skillGradesBySkill.entries()).map(([skill, grades]) => ({
    skill,
    label: SKILL_LABEL[skill],
    averageGrade: round1(grades.reduce((sum, grade) => sum + grade, 0) / grades.length),
  }));

  const generalGrades = evaluations.map((evaluation) => evaluation.generalGrade).filter((grade): grade is number => grade != null);
  const generalAverageGrade =
    generalGrades.length > 0 ? round1(generalGrades.reduce((sum, grade) => sum + grade, 0) / generalGrades.length) : null;

  const strengths = Array.from(new Set(evaluations.flatMap((evaluation) => evaluation.strengths)));
  const areasToImprove = Array.from(new Set(evaluations.flatMap((evaluation) => evaluation.areasToImprove)));

  const homeworkAssigned = Array.from(
    new Set(lessons.map((lesson) => lesson.form.homeworkDescription.trim()).filter((text) => text.length > 0))
  );

  const heldLessons = lessons.filter((lesson) => lesson.countsAsClass);
  const isAttended = (lesson: SavedLesson) =>
    lesson.form.attendance.some((entry) => entry.studentId === studentId && entry.present);
  const attendedLessons = heldLessons.filter(isAttended);
  const classesHeld = heldLessons.length;
  const classesAttended = attendedLessons.length;
  const classesAbsent = classesHeld - classesAttended;

  const hoursTaught = round1(
    heldLessons.reduce((sum, lesson) => {
      const minutes = lesson.form.actualDurationMinutes ?? lesson.form.scheduledDurationMinutes;
      return sum + minutes / 60;
    }, 0)
  );

  const lessonDetails: StudentReportLessonDetail[] = heldLessons
    .map((lesson) => {
      const evaluation = lesson.form.evaluations.find((entry) => entry.studentId === studentId);
      const detail: StudentReportLessonDetail = {
        lessonId: lesson.id,
        date: lesson.form.date,
        present: isAttended(lesson),
        topicsSeen: lesson.form.topics.filter((topic) => topic.status === 'visto').map((topic) => topic.text),
        generalGrade: evaluation?.generalGrade ?? null,
        durationMinutes: lesson.form.actualDurationMinutes ?? lesson.form.scheduledDurationMinutes,
      };
      return detail;
    })
    .sort((first, second) => first.date.localeCompare(second.date));

  // Corrección 2026-07-21 (a pedido de Joaquín — clase como contenedor,
  // privacidad §19): un adjunto SIN studentId es común a toda la clase
  // (comportamiento histórico); un adjunto CON studentId sólo pertenece al
  // reporte de ese alumno puntual, nunca al de otro participante de la
  // misma clase compartida.
  const evidenceCandidates: StudentReportEvidenceCandidate[] = lessons.flatMap((lesson) =>
    lesson.form.activityAttachments
      .filter((attachment) => attachment.studentId === undefined || attachment.studentId === studentId)
      .map((attachment) => ({
        lessonId: lesson.id,
        lessonDate: lesson.form.date,
        attachmentId: attachment.id,
        kind: resolveAttachmentKind(attachment),
        name: attachment.name,
        uri: attachment.uri,
        caption: attachment.caption,
      }))
  );

  // Corrección 2026-07-18 (a pedido de Joaquín, tercera ronda): "Puntualidad
  // y asistencia" — siempre se calcula (barato), sólo aparece en el PDF si
  // la profesora activa la sección. `heldLessons` ya excluye canceladas y
  // ya está acotada al período pedido, así que nunca hace falta marcar
  // isCancelled/isFuture acá.
  const punctualityEntries: PunctualityScoreEntry[] = heldLessons.map((lesson) => ({
    date: lesson.form.date,
    arrival: lesson.studentArrival ?? null,
    isCancelled: false,
    isFuture: false,
  }));
  const punctualitySummary = buildPunctualitySummary(punctualityEntries);
  const punctualityAndAttendance: StudentReportPunctualitySummary = {
    evaluatedClasses: punctualitySummary.evaluatedClasses,
    onTimeOrGracePercent: punctualitySummary.onTimeOrGracePercent,
    averageLateMinutes: punctualitySummary.averageLateMinutes,
    lateArrivalsCount: punctualitySummary.lateArrivalsCount,
    absencesCount: classesAbsent,
  };

  return {
    studentId,
    studentName,
    period,
    topicsSeen,
    skillNotes,
    generalAverageGrade,
    strengths,
    areasToImprove,
    homeworkAssigned,
    attendance: {
      classesHeld,
      classesAttended,
      classesAbsent,
      ratePercent: classesHeld > 0 ? round1((classesAttended / classesHeld) * 100) : null,
    },
    hoursTaught,
    lessonDetails,
    evidenceCandidates,
    punctualityAndAttendance,
  };
}
