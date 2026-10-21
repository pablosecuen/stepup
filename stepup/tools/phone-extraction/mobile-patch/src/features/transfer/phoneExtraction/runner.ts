// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.
/**
 * Orquestación de la extracción desde el teléfono (ver `plan.ts`). Recibe las capacidades del dispositivo como DEPENDENCIAS (leer una clave, ver y leer un
 * archivo, calcular la huella SHA-256, hablar con la base y con el almacenamiento): en el teléfono las implementan expo-file-system, expo-crypto y el
 * cliente de Supabase con la sesión de la propia profesora; en las pruebas, simulaciones en memoria. Nada de acá puede borrar, mover ni modificar un
 * archivo o una clave del teléfono: las dependencias NO ofrecen esa operación (es lo que garantiza que la extracción sea no destructiva).
 *
 * Orden: 1) biblioteca de materiales + datos locales a la cuenta; 2) cada archivo: leer → huella → subir (sin pisar uno que ya exista) → registrar en la
 * cuenta (el servidor verifica que el objeto exista y que el tamaño coincida); 3) dejar constancia de lo que el teléfono ya no tenía. Sigue ante el error de
 * un archivo (queda en `failed`) y se puede repetir las veces que haga falta: lo ya subido no se duplica.
 */
import { buildExtractionPlan, extensionFor, KEYS, DEVICE_LOCAL_KEYS, type ExtractionItem, type PhoneSnapshot } from './plan';
import { MIME_BY_KIND, normalizeMime, sniffKind, type SniffedKind } from './sniff';

export interface StorageError {
  message: string;
  statusCode?: string | number;
}
export interface DbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}

export interface ReportRow {
  id: string;
  student_id: string;
  legacy_mobile_id: string;
}

export interface RunnerDeps {
  readKey(key: string): Promise<string | null>;
  fileInfo(uri: string): Promise<{ exists: boolean; size: number | null }>;
  readBytes(uri: string): Promise<Uint8Array>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  ownerId(): Promise<string>;
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<{ error: StorageError | null }>;
  /** Reportes ya importados a la cuenta (id de la web, alumno y identificador de origen). */
  listReports(): Promise<ReportRow[]>;
  onProgress?(done: number, total: number): void;
}

export type ItemStatus = "uploaded" | "already_there" | "missing_at_origin" | "failed";
export type FailureReason = "too_large" | "read_failed" | "upload_failed" | "register_failed" | "size_mismatch" | "report_not_imported" | "not_in_account" | "no_session";

export interface KindCounts {
  total: number;
  uploaded: number;
  alreadyThere: number;
  missingAtOrigin: number;
  failed: number;
}
export interface ExtractionSummary {
  materialsReceived: number;
  materialsInserted: number;
  deviceKeysSaved: number;
  counts: Record<"lesson_attachment" | "material" | "report_pdf", KindCounts>;
  /** Claves `attachment:<id>` / `material:<id>` / `report:<id>` de archivos que el teléfono ya no tenía. */
  missingAtOrigin: string[];
  failed: Array<{ key: string; reason: FailureReason }>;
  gates: { pendingOperations: number; activeClassSession: boolean };
  unreadable: string[];
  /**
   * «Copia completa»: NINGÚN archivo falló (incluida una diferencia de tamaño) y no es una prueba. Un archivo que el teléfono ya no tenía NO cuenta como copiado:
   * se declara aparte (`missingAtOrigin`) y la pantalla lo muestra como tal.
   */
  complete: boolean;
  /** Corrida de prueba con pocos archivos: no deja constancia del resultado ni cuenta como extracción completa. */
  trial: boolean;
  /** Formato REAL de lo copiado (por los primeros bytes), por tipo: sólo cantidades. */
  actualFormats: Record<string, number>;
  /** Archivos cuyo contenido real no es el que la app declaraba (p. ej. «.heic» que en realidad es JPEG): se suben con su formato real. */
  labelDiffersFromContent: number;
}

export interface RunnerOptions {
  /** Procesa sólo los primeros N archivos (prueba previa en el teléfono antes de la extracción completa). */
  maxItems?: number;
  /** Con `maxItems`: elige primero los archivos con este tipo declarado (p. ej. `image/heic`: las fotos de iPhone), y completa con los demás. */
  prefer?: string;
}

/** Topes del almacenamiento (migraciones R10 y de reportes): 20 MiB por archivo en `lesson-files` y 10 MiB por PDF en `report-pdfs`. */
export const LESSON_FILES_LIMIT_BYTES = 20 * 1024 * 1024;
export const REPORT_PDF_LIMIT_BYTES = 10 * 1024 * 1024;
const limitFor = (kind: ExtractionItem["kind"]): number => (kind === "report_pdf" ? REPORT_PDF_LIMIT_BYTES : LESSON_FILES_LIMIT_BYTES);

const BUCKET_FOR: Record<ExtractionItem["kind"], string> = { lesson_attachment: "lesson-files", material: "lesson-files", report_pdf: "report-pdfs" };
const KEY_PREFIX: Record<ExtractionItem["kind"], string> = { lesson_attachment: "attachment", material: "material", report_pdf: "report" };

const isDuplicate = (e: StorageError): boolean => String(e.statusCode ?? "") === "409" || /already exists|duplicate/i.test(e.message);

export async function runPhoneExtraction(deps: RunnerDeps, options: RunnerOptions = {}): Promise<ExtractionSummary> {
  const owner = await deps.ownerId();
  const empty = (): KindCounts => ({ total: 0, uploaded: 0, alreadyThere: 0, missingAtOrigin: 0, failed: 0 });
  const summary: ExtractionSummary = {
    materialsReceived: 0,
    materialsInserted: 0,
    deviceKeysSaved: 0,
    counts: { lesson_attachment: empty(), material: empty(), report_pdf: empty() },
    missingAtOrigin: [],
    failed: [],
    gates: { pendingOperations: 0, activeClassSession: false },
    unreadable: [],
    complete: false,
    trial: options.maxItems !== undefined,
    actualFormats: {},
    labelDiffersFromContent: 0,
  };
  if (!owner) {
    summary.failed.push({ key: "sesión", reason: "no_session" });
    return summary;
  }

  // 1) Lo que hay en el teléfono (sólo lectura).
  const deviceLocal: Record<string, string | null> = {};
  for (const key of DEVICE_LOCAL_KEYS) deviceLocal[key] = await deps.readKey(key);
  const snapshot: PhoneSnapshot = { lessonsRaw: await deps.readKey(KEYS.lessons), reportsRaw: await deps.readKey(KEYS.reports), materialsRaw: await deps.readKey(KEYS.materials), deviceLocal };
  const plan = buildExtractionPlan(snapshot);
  summary.gates = plan.gates;
  summary.unreadable = plan.unreadable;

  // 2) Biblioteca de materiales y datos locales a la cuenta.
  const imported = await deps.rpc("import_phone_extraction", { p_payload: plan.manifest });
  if (imported.error) {
    summary.failed.push({ key: "biblioteca", reason: "register_failed" });
    return summary;
  }
  const result = (imported.data ?? {}) as { materials_received?: number; materials_inserted?: number };
  summary.materialsReceived = result.materials_received ?? 0;
  summary.materialsInserted = result.materials_inserted ?? 0;
  summary.deviceKeysSaved = Object.keys(plan.manifest.deviceLocal).length;

  const reports = new Map((await deps.listReports()).map((r) => [r.legacy_mobile_id, r]));

  // 3) Cada archivo, uno por vez (poca memoria).
  let done = 0;
  const ordered = options.maxItems !== undefined && options.prefer ? [...plan.items.filter((i) => normalizeMime(i.mimeType) === normalizeMime(options.prefer as string)), ...plan.items.filter((i) => normalizeMime(i.mimeType) !== normalizeMime(options.prefer as string))] : plan.items;
  const items = options.maxItems !== undefined ? ordered.slice(0, Math.max(0, options.maxItems)) : plan.items;
  for (const item of items) {
    const counts = summary.counts[item.kind];
    counts.total += 1;
    const key = `${KEY_PREFIX[item.kind]}:${item.legacyId}`;
    const fail = (reason: FailureReason) => {
      counts.failed += 1;
      summary.failed.push({ key, reason });
    };
    try {
      const info = await deps.fileInfo(item.uri);
      if (!info.exists) {
        counts.missingAtOrigin += 1;
        summary.missingAtOrigin.push(key);
        if (item.kind !== "report_pdf") await deps.rpc("mark_transfer_file_unavailable", { p_kind: item.kind, p_legacy_id: item.legacyId });
        continue;
      }
      // El archivo cambió desde que se adjuntó (o no se puede leer completo): NO se copia ni se registra. Queda como fallo y «pendiente»: hay que revisarlo.
      if (item.expectedSize !== null && info.size !== null && info.size !== item.expectedSize) {
        fail("size_mismatch");
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await deps.readBytes(item.uri);
      } catch {
        fail("read_failed");
        continue;
      }
      if ((item.expectedSize !== null && bytes.length !== item.expectedSize) || (info.size !== null && bytes.length !== info.size)) {
        fail("size_mismatch");
        continue;
      }
      // Formato REAL por los primeros bytes: la copia se sube con su tipo verdadero (no con el que declaraba la app) y se cuenta cuando difiere.
      const kind: SniffedKind = sniffKind(bytes);
      const actualMime = kind === "unknown" ? item.mimeType : MIME_BY_KIND[kind];
      summary.actualFormats[kind] = (summary.actualFormats[kind] ?? 0) + 1;
      if (kind !== "unknown" && normalizeMime(actualMime) !== normalizeMime(item.mimeType)) summary.labelDiffersFromContent += 1;
      if (bytes.length > limitFor(item.kind)) {
        fail("too_large");
        continue;
      }
      const sha = await deps.sha256Hex(bytes);
      let path: string;
      if (item.kind === "report_pdf") {
        const row = reports.get(item.legacyId);
        if (!row) {
          fail("report_not_imported");
          continue;
        }
        path = `${owner}/${row.student_id}/${row.id}.pdf`;
      } else {
        path = `${owner}/${item.kind === "material" ? "materials" : "attachments"}/${sha}.${extensionFor(actualMime)}`;
      }
      const uploaded = await deps.upload(BUCKET_FOR[item.kind], path, bytes, actualMime);
      let already = false;
      if (uploaded.error) {
        if (isDuplicate(uploaded.error)) already = true;
        else {
          fail("upload_failed");
          continue;
        }
      }
      const registered = await deps.rpc("register_transfer_file", { p_kind: item.kind, p_legacy_id: item.legacyId, p_path: path, p_sha256: sha, p_size: bytes.length });
      if (registered.error) {
        fail(/No se encontró el elemento|No se encontró el reporte/.test(registered.error.message) ? "not_in_account" : "register_failed");
        continue;
      }
      if (already) counts.alreadyThere += 1;
      else counts.uploaded += 1;
    } finally {
      done += 1;
      deps.onProgress?.(done, items.length);
    }
  }

  // 4) Constancia del resultado (identificadores y cantidades; nunca nombres ni rutas).
  summary.complete = !summary.trial && summary.failed.length === 0;
  if (!summary.trial) await deps.rpc("record_phone_extraction_result", { p_summary: summary });
  return summary;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Revisión SIN copiar: sólo lectura del teléfono. No habla con la cuenta (ni base ni almacenamiento): cuenta, mide y reconoce el formato real de los archivos.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface InspectionKindCounts {
  total: number;
  /** Archivos que hay en el teléfono en este momento. */
  found: number;
  /** Archivos que esta revisión no encontró en la ruta guardada (aún NO se declaran ausentes en la cuenta: eso lo hace la copia). */
  notFound: number;
  /** Suma de lo que la app declaró y de lo que mide cada archivo encontrado, en bytes. */
  declaredBytes: number;
  actualBytes: number;
  largestBytes: number;
  /** Archivos que superarían el tope del almacenamiento (no se podrían subir). */
  overLimit: number;
  /** El tamaño real no coincide con el declarado (la copia lo rechazaría como «tamaño distinto»). */
  sizeMismatch: number;
  unreadable: number;
}

export interface InspectionSummary {
  counts: Record<ExtractionItem["kind"], InspectionKindCounts>;
  /** Formato real de los archivos encontrados (por los primeros bytes). */
  formats: Record<string, number>;
  /** De los archivos con un formato reconocido, cuántos NO son lo que la app declaraba. */
  labelDiffersFromContent: number;
  /** Declarados como `image/heic` que en realidad son JPEG (la app los transcodifica al elegirlos de la galería). */
  declaredHeicActuallyJpeg: number;
  /** Declarados como `image/heic` cuyo contenido SIGUE siendo HEIC (necesitarían una vista previa en la web). */
  actuallyHeic: number;
  materialsInLibrary: number;
  reports: number;
  gates: { pendingOperations: number; activeClassSession: boolean };
  unreadable: string[];
  limits: { lessonFilesBytes: number; reportPdfBytes: number };
}

export async function inspectPhoneFiles(deps: Pick<RunnerDeps, "readKey" | "fileInfo" | "readBytes">): Promise<InspectionSummary> {
  const deviceLocal: Record<string, string | null> = {};
  for (const key of DEVICE_LOCAL_KEYS) deviceLocal[key] = await deps.readKey(key);
  const snapshot: PhoneSnapshot = { lessonsRaw: await deps.readKey(KEYS.lessons), reportsRaw: await deps.readKey(KEYS.reports), materialsRaw: await deps.readKey(KEYS.materials), deviceLocal };
  const plan = buildExtractionPlan(snapshot);
  const empty = (): InspectionKindCounts => ({ total: 0, found: 0, notFound: 0, declaredBytes: 0, actualBytes: 0, largestBytes: 0, overLimit: 0, sizeMismatch: 0, unreadable: 0 });
  const result: InspectionSummary = {
    counts: { lesson_attachment: empty(), material: empty(), report_pdf: empty() },
    formats: {},
    labelDiffersFromContent: 0,
    declaredHeicActuallyJpeg: 0,
    actuallyHeic: 0,
    materialsInLibrary: plan.manifest.materials.length,
    reports: 0,
    gates: plan.gates,
    unreadable: plan.unreadable,
    limits: { lessonFilesBytes: LESSON_FILES_LIMIT_BYTES, reportPdfBytes: REPORT_PDF_LIMIT_BYTES },
  };
  for (const item of plan.items) {
    const counts = result.counts[item.kind];
    counts.total += 1;
    if (item.kind === "report_pdf") result.reports += 1;
    if (item.expectedSize !== null) counts.declaredBytes += item.expectedSize;
    const info = await deps.fileInfo(item.uri);
    if (!info.exists) {
      counts.notFound += 1;
      continue;
    }
    counts.found += 1;
    let bytes: Uint8Array;
    try {
      bytes = await deps.readBytes(item.uri);
    } catch {
      counts.unreadable += 1;
      continue;
    }
    counts.actualBytes += bytes.length;
    counts.largestBytes = Math.max(counts.largestBytes, bytes.length);
    if (bytes.length > limitFor(item.kind)) counts.overLimit += 1;
    if ((item.expectedSize !== null && bytes.length !== item.expectedSize) || (info.size !== null && bytes.length !== info.size)) counts.sizeMismatch += 1;
    const kind = sniffKind(bytes);
    result.formats[kind] = (result.formats[kind] ?? 0) + 1;
    if (kind !== "unknown" && normalizeMime(MIME_BY_KIND[kind]) !== normalizeMime(item.mimeType)) result.labelDiffersFromContent += 1;
    if (normalizeMime(item.mimeType) === "image/heic") {
      if (kind === "jpeg") result.declaredHeicActuallyJpeg += 1;
      if (kind === "heic") result.actuallyHeic += 1;
    }
  }
  return result;
}
