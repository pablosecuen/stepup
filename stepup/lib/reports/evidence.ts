import type { StudentReportEvidenceCandidate } from "./student-report-data.ts";

/**
 * Evidencias del reporte (fotos y PDF de las clases del período), como en la app anterior: la profesora ELIGE cuáles incluir; nunca se preseleccionan. PURO.
 * Lo que se puede elegir sale sólo de `data.evidenceCandidates` (adjuntos vigentes de las clases dictadas de ESE alumno en el período), así que un pedido no puede incluir un archivo ajeno.
 */
export const MAX_REPORT_EVIDENCE = 24;

export class ReportEvidenceError extends Error {}

/** Valida la selección contra los candidatos: sin repetidos, sin ids desconocidos y con tope. Devuelve el orden de los candidatos (por fecha). */
export function resolveSelectedEvidence(selectedIds: unknown, candidates: readonly StudentReportEvidenceCandidate[] | undefined): StudentReportEvidenceCandidate[] {
  if (selectedIds === undefined || selectedIds === null) return [];
  if (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== "string")) throw new ReportEvidenceError("La selección de evidencias no es válida.");
  const wanted = new Set(selectedIds as string[]);
  if (wanted.size === 0) return [];
  const byId = new Map((candidates ?? []).map((candidate) => [candidate.attachmentId, candidate]));
  for (const id of wanted) if (!byId.has(id)) throw new ReportEvidenceError("Una de las evidencias elegidas ya no está disponible. Volvé a elegirlas.");
  if (wanted.size > MAX_REPORT_EVIDENCE) throw new ReportEvidenceError(`Podés incluir hasta ${MAX_REPORT_EVIDENCE} evidencias por reporte.`);
  return (candidates ?? []).filter((candidate) => wanted.has(candidate.attachmentId));
}

/** Ids elegidos en un orden fijo, para compararlos entre pedidos. */
export function normalizeEvidenceIds(ids: readonly string[] | undefined): string[] {
  return [...new Set(ids ?? [])].sort();
}

export interface PreparedEvidenceImage {
  attachmentId: string;
  dateKey: string;
  name: string;
  caption: string | null;
  /** JPEG ya reducido para el PDF. */
  jpeg: Uint8Array;
}

export interface PreparedEvidenceFile {
  dateKey: string;
  name: string;
  /** `pdf`: se nombra con su fecha (como la app anterior); `unavailable`: la foto no se pudo leer o convertir. */
  kind: "pdf" | "unavailable";
}

export interface PreparedEvidence {
  images: PreparedEvidenceImage[];
  files: PreparedEvidenceFile[];
}

export const EMPTY_EVIDENCE: PreparedEvidence = { images: [], files: [] };
