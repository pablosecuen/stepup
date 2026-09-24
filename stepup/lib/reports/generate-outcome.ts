import type { StudentReportTeacherNotes } from "./narrative.ts";

/**
 * Lógica PURA sobre qué le corresponde informar a la usuaria después de
 * `generateStudentReportAction`, a partir de la fila REALMENTE persistida
 * (`record`) — nunca del formulario local. `wasCreated=false` significa
 * que `createReportRecord` convergió en una fila YA existente (mismo
 * `operation_id`, idempotencia real) en lugar de crear una nueva.
 *
 * `staleClaim` sólo es true cuando la fila reutilizada YA estaba completa
 * (tiene PDF) Y el pedido actual NO es semánticamente el mismo que el que
 * generó esa fila — comparando TODO el contenido real del pedido (meses
 * normalizados, narrativa, las 4 notas de la profesora, y los dos
 * toggles), nunca sólo los meses: dos pedidos con los mismos meses pero
 * texto/opciones distintas NO son el mismo pedido, y devolver la fila
 * vieja en silencio sería mostrar contenido que la usuaria nunca
 * confirmó. Un claim reutilizado que TODAVÍA está en curso (sin PDF)
 * nunca se marca como obsoleto, sea cual sea el contenido — sigue siendo
 * la misma operación en curso, no una equivocación.
 *
 * El fingerprint nunca incluye valores inestables (hora de generación,
 * ids) — sólo los campos que la usuaria controla y que definen "es el
 * mismo pedido".
 */
export interface GenerateRequestContent {
  selectedMonths: readonly string[];
  narrativeText: string;
  teacherNotes: StudentReportTeacherNotes;
  includeClassDetail: boolean;
  includePunctualitySummary: boolean;
}

export interface CanonicalReportRecordFields extends GenerateRequestContent {
  pdfPath: string | null;
}

export interface GenerateReportOutcome {
  reused: boolean;
  staleClaim: boolean;
  warning: string | null;
}

export const STALE_CLAIM_WARNING = 'Este intento corresponde a un reporte ya generado; elegí "Crear otro reporte" para iniciar uno nuevo.';

/** Huella determinística del CONTENIDO real de un pedido — nunca de metadatos inestables como la hora. */
export function computeGenerateRequestFingerprint(content: GenerateRequestContent): string {
  return JSON.stringify({
    selectedMonths: [...content.selectedMonths].sort(),
    narrativeText: content.narrativeText,
    teacherNotes: {
      generalComment: content.teacherNotes.generalComment,
      behaviorAndParticipation: content.teacherNotes.behaviorAndParticipation,
      nextObjectives: content.teacherNotes.nextObjectives,
      recommendations: content.teacherNotes.recommendations,
    },
    includeClassDetail: content.includeClassDetail,
    includePunctualitySummary: content.includePunctualitySummary,
  });
}

/** Dos pedidos son el mismo únicamente si TODO su contenido semántico coincide — el fingerprint ya normaliza los meses, así que compararlo alcanza. */
export function isSameRequestContent(a: GenerateRequestContent, b: GenerateRequestContent): boolean {
  return computeGenerateRequestFingerprint(a) === computeGenerateRequestFingerprint(b);
}

export function evaluateGenerateReportOutcome(record: CanonicalReportRecordFields, request: GenerateRequestContent, wasCreated: boolean): GenerateReportOutcome {
  const reused = !wasCreated;
  const staleClaim = reused && record.pdfPath !== null && !isSameRequestContent(record, request);
  return { reused, staleClaim, warning: staleClaim ? STALE_CLAIM_WARNING : null };
}
