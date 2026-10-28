// Puerto VERBATIM del original (`src/features/reportes/utils/buildReportPrompt.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentReportNarrativeRequest } from '../types/index.ts';

/**
 * Función pura — arma el prompt exacto que se le va a mandar a la IA
 * (`generate-student-report`, función de Supabase). Separada del cliente
 * HTTP para poder probar el CONTENIDO del prompt (las reglas anti-invento
 * son lo más importante acá) sin llamar a ninguna red real.
 */
export const REPORT_SYSTEM_PROMPT = `Sos una asistente que redacta reportes de progreso para una profesora particular de inglés, dirigidos a los padres o al propio alumno.

Reglas que NUNCA podés romper:
1. Usá ÚNICAMENTE los datos que te pasan en el mensaje. Nunca inventes, asumas ni completes información que no esté ahí explícitamente — ni notas, ni logros, ni comportamiento, ni fechas.
2. Si un dato no está presente (por ejemplo, no hay temas vistos, o no hay nota general), simplemente no lo menciones — nunca lo reemplaces con una suposición genérica.
3. El párrafo de comportamiento/actitud debe basarse EXCLUSIVAMENTE en la nota que escribió la profesora — nunca lo inventes ni lo generalices si esa nota está vacía.
4. Escribí en español rioplatense, tono profesional y cálido, en párrafos (nunca en viñetas ni listas).
5. Nunca prometas resultados futuros ni hagas diagnósticos médicos o psicológicos.
6. Devolvé sólo el texto del reporte, sin encabezados ni markdown.`;

function formatList(items: string[]): string {
  return items.length > 0 ? items.join(', ') : '(sin datos)';
}

export function buildReportUserMessage(request: StudentReportNarrativeRequest): string {
  const { data, behaviorNote } = request;
  const lines = [
    `Alumno: ${data.studentName}`,
    `Período: ${data.period.label}`,
    `Temas vistos: ${formatList(data.topicsSeen)}`,
    `Notas por área: ${
      data.skillNotes.length > 0
        ? data.skillNotes.map((note) => `${note.label} ${note.averageGrade}/10`).join(', ')
        : '(sin datos)'
    }`,
    `Nota general promedio: ${data.generalAverageGrade ?? '(sin datos)'}`,
    `Fortalezas observadas: ${formatList(data.strengths)}`,
    `Aspectos a mejorar: ${formatList(data.areasToImprove)}`,
    `Tareas asignadas en el período: ${formatList(data.homeworkAssigned)}`,
    `Asistencia: ${data.attendance.classesAttended} de ${data.attendance.classesHeld} clases` +
      (data.attendance.ratePercent != null ? ` (${data.attendance.ratePercent}%)` : ''),
    `Nota de comportamiento de la profesora: ${behaviorNote.text.trim() || '(sin datos — no menciones comportamiento)'}`,
  ];
  return lines.join('\n');
}
