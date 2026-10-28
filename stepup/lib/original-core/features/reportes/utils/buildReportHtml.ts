// Puerto VERBATIM del original (`src/features/reportes/utils/buildReportHtml.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type { StudentReportBuildOptions, StudentReportData } from '../types/index.ts';

/**
 * Función pura — arma el HTML que `expo-print` convierte a PDF. El texto
 * narrativo (`narrativeText`) ya viene redactado (borrador determinístico
 * editado a mano por la profesora) — esta función sólo le da formato, nunca
 * genera ni valida contenido de negocio.
 *
 * Corrección 2026-07-18 (a pedido de Joaquín): admite dos secciones
 * opcionales controladas por `options` — detalle clase por clase y
 * evidencias (fotos/PDF) seleccionadas a mano por la profesora, nunca
 * preseleccionadas. Nunca incluye `internalNotes`, teléfono, WhatsApp ni
 * ningún dato financiero — esos campos no forman parte de `StudentReportData`.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function paragraphsHtml(narrativeText: string): string {
  return narrativeText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
}

function formatDayMonthYear(dateKey: string): string {
  const [year, month, day] = dateKey.split('-');
  if (!year || !month || !day) return escapeHtml(dateKey);
  return `${day}/${month}/${year}`;
}

function classDetailHtml(data: StudentReportData): string {
  if (data.lessonDetails.length === 0) return '';
  const rows = data.lessonDetails
    .map(
      (detail) => `<tr>
        <td>${formatDayMonthYear(detail.date)}</td>
        <td>${detail.present ? 'Presente' : 'Ausente'}</td>
        <td>${escapeHtml(detail.topicsSeen.join(', '))}</td>
        <td>${detail.generalGrade ?? '-'}</td>
      </tr>`
    )
    .join('\n');
  return `
  <h2>Detalle clase por clase</h2>
  <table class="detail-table">
    <thead><tr><th>Fecha</th><th>Asistencia</th><th>Temas</th><th>Nota</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function evidenceHtml(data: StudentReportData, selectedEvidenceIds: string[]): string {
  const selected = data.evidenceCandidates.filter((candidate) => selectedEvidenceIds.includes(candidate.attachmentId));
  if (selected.length === 0) return '';

  const items = selected
    .map((candidate) => {
      if (candidate.kind === 'image') {
        return `<div class="evidence-item">
          <img src="${escapeHtml(candidate.uri)}" class="evidence-image" />
          ${candidate.caption ? `<p class="evidence-caption">${escapeHtml(candidate.caption)}</p>` : ''}
        </div>`;
      }
      return `<div class="evidence-item evidence-pdf">
        <p>${escapeHtml(candidate.name)} — ${formatDayMonthYear(candidate.lessonDate)}</p>
      </div>`;
    })
    .join('\n');

  return `
  <h2>Evidencias y materiales</h2>
  <div class="evidence-grid">${items}</div>`;
}

/**
 * "Puntualidad y asistencia" — sólo si la profesora la activó. Nunca
 * incluye información financiera, el puntaje de pagos, notas internas ni
 * motivos privados no seleccionados.
 *
 * Corrección 2026-07-18 (a pedido de Joaquín, cuarta ronda): si nunca se
 * usó el seguimiento en vivo en el período (0 clases evaluadas), nunca
 * muestra la tabla con ceros — mostrar una tabla con "0" en "Llegadas
 * tarde" se leería como "el alumno nunca llegó tarde", una afirmación que
 * en realidad no se puede sostener con cero datos reales. En ese caso
 * muestra, como máximo, una única frase.
 */
function punctualityAndAttendanceHtml(data: StudentReportData): string {
  const summary = data.punctualityAndAttendance;
  if (!summary) return '';
  if (summary.evaluatedClasses === 0) {
    return `
  <h2>Puntualidad y asistencia</h2>
  <p>No hay registros suficientes de puntualidad.</p>`;
  }
  return `
  <h2>Puntualidad y asistencia</h2>
  <table class="detail-table">
    <tbody>
      <tr><td>Clases evaluadas</td><td>${summary.evaluatedClasses}</td></tr>
      <tr><td>Dentro de tolerancia</td><td>${summary.onTimeOrGracePercent !== null ? `${summary.onTimeOrGracePercent}%` : '—'}</td></tr>
      <tr><td>Demora promedio</td><td>${summary.averageLateMinutes !== null ? `${summary.averageLateMinutes} min` : '—'}</td></tr>
      <tr><td>Llegadas tarde</td><td>${summary.lateArrivalsCount}</td></tr>
      <tr><td>Ausencias</td><td>${summary.absencesCount}</td></tr>
    </tbody>
  </table>`;
}

export function buildReportHtml(
  data: StudentReportData,
  narrativeText: string,
  options?: StudentReportBuildOptions
): string {
  const includeClassDetail = options?.includeClassDetail ?? false;
  const selectedEvidenceIds = options?.selectedEvidenceIds ?? [];
  const includePunctualitySummary = options?.includePunctualitySummary ?? false;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #1C1C1E; padding: 32px; line-height: 1.5; }
  h1 { font-size: 20px; text-decoration: underline; margin-bottom: 4px; }
  h2 { font-size: 16px; margin-top: 24px; margin-bottom: 8px; }
  .period { font-size: 13px; color: #6E6E73; margin-bottom: 24px; }
  p { font-size: 14px; margin-bottom: 16px; text-align: justify; }
  .detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .detail-table th, .detail-table td { border: 1px solid #D0D0D5; padding: 6px 8px; text-align: left; }
  .evidence-grid { display: flex; flex-wrap: wrap; gap: 12px; }
  .evidence-item { width: 140px; font-size: 11px; }
  .evidence-image { width: 140px; height: 140px; object-fit: cover; border-radius: 6px; }
  .evidence-caption { margin: 4px 0 0; font-size: 11px; }
  .evidence-pdf { border: 1px solid #D0D0D5; border-radius: 6px; padding: 8px; }
</style>
</head>
<body>
  <h1>${escapeHtml(data.studentName)}</h1>
  <div class="period">${escapeHtml(data.period.label)}</div>
  ${paragraphsHtml(narrativeText)}
  ${includeClassDetail ? classDetailHtml(data) : ''}
  ${includePunctualitySummary ? punctualityAndAttendanceHtml(data) : ''}
  ${evidenceHtml(data, selectedEvidenceIds)}
</body>
</html>`;
}
