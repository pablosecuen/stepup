import type { StudentReportData } from "./student-report-data.ts";

/**
 * Puerto de `buildDeterministicReportNarrative` (móvil) — texto DETERMINÍSTICO
 * armado sólo con plantillas condicionales sobre los datos reales ya
 * calculados + las 4 notas manuales de la profesora. Nunca llama a
 * ninguna IA ni servicio externo — funciona sin conexión y sin costo. Es
 * sólo un punto de partida: la profesora lo edita libremente antes de
 * generar el PDF (la UI nunca envía este texto crudo, siempre lo editable
 * por el usuario). Pura.
 */
export interface StudentReportTeacherNotes {
  generalComment: string;
  behaviorAndParticipation: string;
  nextObjectives: string;
  recommendations: string;
}

export function buildDeterministicReportNarrative(data: StudentReportData, notes: StudentReportTeacherNotes): string {
  const paragraphs: string[] = [];

  if (data.classesHeld === 0) {
    paragraphs.push("No se registraron clases dictadas en el período seleccionado.");
  } else {
    const classWord = data.classesHeld === 1 ? "clase" : "clases";
    paragraphs.push(
      `Durante el período se dictaron ${data.classesHeld} ${classWord}, totalizando ${data.hoursTaught} hora${data.hoursTaught === 1 ? "" : "s"} reales de trabajo.` +
        (data.attendance.ratePercent !== null ? ` La asistencia registrada fue del ${data.attendance.ratePercent}%.` : "")
    );

    if (data.generalAverageGrade !== null) {
      paragraphs.push(`El promedio general del período fue ${data.generalAverageGrade}.`);
    }

    const gradedSkills = data.skillNotes.filter((s) => s.averageGrade !== null);
    if (gradedSkills.length > 0) {
      paragraphs.push(`Por habilidad: ${gradedSkills.map((s) => `${s.label} ${s.averageGrade}`).join(", ")}.`);
    }

    if (data.strengths.length > 0) {
      paragraphs.push(`Fortalezas observadas: ${data.strengths.join(", ")}.`);
    }

    if (data.areasToImprove.length > 0) {
      paragraphs.push(`Aspectos a mejorar: ${data.areasToImprove.join(", ")}.`);
    }

    if (data.homeworkAssigned.length > 0) {
      paragraphs.push(`Tareas asignadas durante el período: ${data.homeworkAssigned.join("; ")}.`);
    }
  }

  if (notes.generalComment.trim()) paragraphs.push(notes.generalComment.trim());
  if (notes.behaviorAndParticipation.trim()) paragraphs.push(`Comportamiento y participación: ${notes.behaviorAndParticipation.trim()}`);
  if (notes.nextObjectives.trim()) paragraphs.push(`Próximos objetivos: ${notes.nextObjectives.trim()}`);
  if (notes.recommendations.trim()) paragraphs.push(`Recomendaciones: ${notes.recommendations.trim()}`);

  return paragraphs.join("\n\n");
}
