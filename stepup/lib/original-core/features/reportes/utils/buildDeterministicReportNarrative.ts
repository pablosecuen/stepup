// Puerto VERBATIM del original (`src/features/reportes/utils/buildDeterministicReportNarrative.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentReportData, StudentReportTeacherNotes } from '../types/index.ts';

/**
 * Corrección 2026-07-18 (a pedido de Joaquín): borrador DETERMINÍSTICO del
 * reporte, en español, armado sólo con los datos reales ya calculados por
 * `buildStudentReportData` más las cuatro notas que la profesora escribe a
 * mano. Nunca llama a ninguna IA ni servicio externo — funciona sin
 * conexión y sin costo. Es sólo un PUNTO DE PARTIDA: la profesora lo edita
 * libremente en la vista previa antes de generar el PDF (misma idea que ya
 * tenía `narrativeText` en `buildReportHtml`, sólo que ahora el texto nace
 * acá en vez de en la función de Supabase, que sigue existiendo sin usarse).
 */
function formatPercent(value: number | null): string {
  if (value === null) return 'sin datos suficientes';
  return `${value}%`;
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

export function buildDeterministicReportNarrative(
  data: StudentReportData,
  notes: StudentReportTeacherNotes
): string {
  const paragraphs: string[] = [];

  if (data.attendance.classesHeld === 0) {
    paragraphs.push(
      `Durante ${data.period.label} no se registraron clases dictadas para ${data.studentName} en el sistema.`
    );
  } else {
    paragraphs.push(
      `Durante ${data.period.label}, ${data.studentName} tuvo ${data.attendance.classesHeld} ` +
        `${data.attendance.classesHeld === 1 ? 'clase registrada' : 'clases registradas'}, con ` +
        `${data.attendance.classesAttended} ${data.attendance.classesAttended === 1 ? 'asistencia' : 'asistencias'} y ` +
        `${data.attendance.classesAbsent} ${data.attendance.classesAbsent === 1 ? 'ausencia' : 'ausencias'} ` +
        `(${formatPercent(data.attendance.ratePercent)} de asistencia), sumando ${data.hoursTaught} horas reales de clase.`
    );
  }

  if (data.topicsSeen.length > 0) {
    paragraphs.push(`Los temas trabajados en el período fueron: ${joinList(data.topicsSeen)}.`);
  }

  if (data.generalAverageGrade !== null) {
    paragraphs.push(`El promedio general del período fue ${data.generalAverageGrade}/10.`);
  }

  if (data.skillNotes.length > 0) {
    const skillsText = data.skillNotes.map((note) => `${note.label}: ${note.averageGrade}/10`).join(', ');
    paragraphs.push(`El detalle por habilidad fue el siguiente — ${skillsText}.`);
  }

  if (data.strengths.length > 0) {
    paragraphs.push(`Entre las fortalezas observadas se destacan: ${joinList(data.strengths)}.`);
  }

  if (data.areasToImprove.length > 0) {
    paragraphs.push(`Los aspectos a seguir trabajando son: ${joinList(data.areasToImprove)}.`);
  }

  if (data.homeworkAssigned.length > 0) {
    paragraphs.push(`Las tareas asignadas durante el período incluyeron: ${joinList(data.homeworkAssigned)}.`);
  }

  if (notes.generalComment.trim().length > 0) {
    paragraphs.push(notes.generalComment.trim());
  }

  if (notes.behaviorAndParticipation.trim().length > 0) {
    paragraphs.push(`Comportamiento y participación: ${notes.behaviorAndParticipation.trim()}`);
  }

  if (notes.nextObjectives.trim().length > 0) {
    paragraphs.push(`Próximos objetivos: ${notes.nextObjectives.trim()}`);
  }

  if (notes.recommendations.trim().length > 0) {
    paragraphs.push(`Recomendaciones: ${notes.recommendations.trim()}`);
  }

  return paragraphs.join('\n\n');
}
