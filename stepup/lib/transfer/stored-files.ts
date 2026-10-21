import { createHash } from "node:crypto";
import { readTable, type ReadClient } from "../db/read.ts";
import { sniffKind } from "../phone-extraction/sniff.ts";

/**
 * Verificación de INTEGRIDAD de los archivos ya copiados a la cuenta, hecha desde la computadora con la sesión de la propia cuenta (no se confía en lo que informa el teléfono):
 * cada archivo registrado como disponible se vuelve a descargar y se comprueba que su huella SHA-256 y su tamaño son los registrados y que su formato real es el declarado.
 * Sólo informa cantidades y claves de origen (`adjunto:<id>`), nunca nombres, rutas ni contenido. No escribe nada.
 */

export interface StorageReadClient extends ReadClient {
  storage: { from(bucket: string): { download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }> } };
}

export type IntegrityProblem = "not_downloadable" | "size_differs" | "hash_differs" | "format_differs" | "missing_registration";

export interface IntegrityResult {
  /** Filas registradas como disponibles. */
  registered: number;
  /** Archivos distintos descargados (varias filas pueden compartir un mismo archivo por tener el mismo contenido). */
  downloaded: number;
  verified: number;
  bytes: number;
  problems: Array<{ key: string; problem: IntegrityProblem }>;
  /** Filas que siguen «pendiente» (todavía sin archivo ni ausencia declarada). */
  pending: Array<{ key: string }>;
  /** Filas declaradas «no disponible» (el teléfono ya no tenía el archivo): ausentes, nunca copiadas. */
  absent: Array<{ key: string }>;
  /** Identificadores de origen repetidos dentro de una misma tabla (no debería haber ninguno). */
  duplicateIds: string[];
}

interface FileRow {
  legacy_mobile_id: string | null;
  kind?: string | null;
  attachment_kind?: string | null;
  storage_path: string | null;
  sha256: string | null;
  stored_size_bytes: number | string | null;
  file_status: string;
}

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function verifyStoredFiles(client: StorageReadClient, ownerId: string): Promise<IntegrityResult> {
  const result: IntegrityResult = { registered: 0, downloaded: 0, verified: 0, bytes: 0, problems: [], pending: [], absent: [], duplicateIds: [] };
  const sources: Array<{ prefix: string; table: string; columns: string; bucket: string }> = [
    { prefix: "adjunto", table: "lesson_attachments", columns: "id, legacy_mobile_id, kind, storage_path, sha256, stored_size_bytes, file_status", bucket: "lesson-files" },
    { prefix: "material", table: "material_library_items", columns: "id, legacy_mobile_id, attachment_kind, storage_path, sha256, stored_size_bytes, file_status", bucket: "lesson-files" },
  ];
  const cache = new Map<string, { sha: string; size: number; format: string } | null>();
  for (const source of sources) {
    const rows = await readTable<FileRow>(client, source.table, { columns: source.columns, filter: (q) => q.eq("owner_id", ownerId) });
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.legacy_mobile_id ?? "?";
      const key = `${source.prefix}:${id}`;
      if (seen.has(id)) result.duplicateIds.push(key);
      seen.add(id);
      if (row.file_status === "pendiente") result.pending.push({ key });
      else if (row.file_status === "no_disponible") result.absent.push({ key });
      if (row.file_status !== "disponible") continue;
      result.registered += 1;
      if (!row.storage_path || !row.sha256 || row.stored_size_bytes === null) {
        result.problems.push({ key, problem: "missing_registration" });
        continue;
      }
      let info = cache.get(row.storage_path);
      if (info === undefined) {
        const downloaded = await client.storage.from(source.bucket).download(row.storage_path);
        if (downloaded.error || !downloaded.data) info = null;
        else {
          const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
          info = { sha: sha256Hex(bytes), size: bytes.length, format: sniffKind(bytes) };
          result.downloaded += 1;
          result.bytes += bytes.length;
        }
        cache.set(row.storage_path, info);
      }
      if (!info) {
        result.problems.push({ key, problem: "not_downloadable" });
        continue;
      }
      if (info.size !== Number(row.stored_size_bytes)) result.problems.push({ key, problem: "size_differs" });
      else if (info.sha !== row.sha256) result.problems.push({ key, problem: "hash_differs" });
      else {
        // El tipo que DECLARABA la app puede no ser el real (fotos «.HEIC» que son JPEG): no es un problema. Lo que se exige es que el contenido sea de la familia del adjunto (foto o PDF).
        const family = String(row.kind ?? row.attachment_kind ?? "");
        const okFormat = family === "pdf" ? info.format === "pdf" : family === "image" ? ["jpeg", "png", "webp", "heic"].includes(info.format) : info.format !== "unknown";
        if (!okFormat) result.problems.push({ key, problem: "format_differs" });
        else result.verified += 1;
      }
    }
  }
  // Los PDF de reportes (bucket `report-pdfs`): sólo se comprueba que existan, tengan contenido y sean PDF.
  const reports = await readTable<{ legacy_mobile_id: string | null; pdf_url: string | null }>(client, "report_records", { columns: "id, legacy_mobile_id, pdf_url", filter: (q) => q.eq("owner_id", ownerId) });
  for (const report of reports) {
    if (!report.pdf_url) continue;
    const key = `reporte:${report.legacy_mobile_id ?? "?"}`;
    result.registered += 1;
    const downloaded = await client.storage.from("report-pdfs").download(report.pdf_url);
    if (downloaded.error || !downloaded.data) {
      result.problems.push({ key, problem: "not_downloadable" });
      continue;
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    result.downloaded += 1;
    result.bytes += bytes.length;
    if (bytes.length > 0 && sniffKind(bytes) === "pdf") result.verified += 1;
    else result.problems.push({ key, problem: "format_differs" });
  }
  return result;
}
