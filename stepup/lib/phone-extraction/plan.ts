/**
 * Extracción de los archivos y datos que SÓLO existen en el teléfono (traslado Expo Go → web). Plan PURO: a partir de lo que la app guarda localmente
 * (sin tocar nada) arma la lista de archivos por subir y el manifiesto de datos locales. Lo ejecuta `runner.ts`, que recibe las capacidades del teléfono
 * (lectura de claves, de archivos, huella, subida) como dependencias: así se prueba entero en Node con datos sintéticos.
 *
 * Qué NO viaja en el respaldo de la app (ver `src/shared/backup` y los comentarios de `teacherFlowStorage.ts`):
 *   - los archivos adjuntos de las clases (PDF y fotos): sólo se guarda la ruta local (`Paths.document/attachments/<id>.<ext>`);
 *   - los PDF de los reportes generados (`Paths.document/reports/<idDelReporte>.pdf`);
 *   - la biblioteca de materiales (`@teacherflow/materials_library`), con sus propios archivos;
 *   - claves que la app guarda sólo en el dispositivo (cola de operaciones pendientes, avisos, sesión de clase en curso, preferencias).
 *
 * Reglas: NO destructivo (sólo lee; nada se mueve, se borra ni se modifica en el teléfono); idempotente (repetirlo no duplica); nunca registra nombres,
 * rutas ni contenido en el resultado (sólo identificadores de origen y cantidades).
 */
import { stableHash } from "../backup/mobile-adapter.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Claves de AsyncStorage de la app. */
export const KEYS = {
  lessons: "@teacherflow/lessons",
  reports: "@teacherflow/report_history",
  materials: "@teacherflow/materials_library",
  pendingTrainingOperations: "@teacherflow/pending_training_billing_operations",
  activeClassSession: "@teacherflow/active_class_session",
} as const;

/** Claves que la app guarda sólo en el dispositivo (no entran en el respaldo). Se guardan tal cual en la cuenta: son datos de la profesora. */
export const DEVICE_LOCAL_KEYS: readonly string[] = [
  "@teacherflow/pending_training_billing_operations",
  "@teacherflow/reschedule_cancellation_notices",
  "@teacherflow/daily_collections_notice",
  "@teacherflow/active_class_session",
  "@teacherflow/live_class_tracking_enabled",
  "@teacherflow/navigation_location",
  "@teacherflow/report_share_privacy_notice_seen",
  "@teacherflow/pending_post_restore_active_session_warning",
  "@teacherflow/protection_state",
  "@teacherflow/backup_last_success_at",
];

export type ItemKind = "lesson_attachment" | "material" | "report_pdf";

export interface ExtractionItem {
  kind: ItemKind;
  /** Identificador de origen del elemento al que pertenece el archivo (el mismo `legacy_mobile_id` que usa la importación). */
  legacyId: string;
  /** Ruta local en el teléfono (no sale del dispositivo ni se registra). */
  uri: string;
  mimeType: string;
  /** Tamaño declarado por la app (si lo guardó). */
  expectedSize: number | null;
}

export interface PhoneSnapshot {
  lessonsRaw: string | null;
  reportsRaw: string | null;
  materialsRaw: string | null;
  deviceLocal: Record<string, string | null>;
}

export interface ExtractionManifest {
  materials: Obj[];
  deviceLocal: Record<string, string>;
}

export interface ExtractionPlan {
  items: ExtractionItem[];
  manifest: ExtractionManifest;
  /** Condiciones que conviene cumplir antes del traslado final (se informan; no bloquean la extracción). */
  gates: { pendingOperations: number; activeClassSession: boolean };
  /** Claves cuyo contenido no se pudo leer como JSON (se informan por clave; el dato igual se guarda tal cual). */
  unreadable: string[];
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function mimeFor(kind: "pdf" | "image", name: string, mimeType: string | null): string {
  if (mimeType && /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(mimeType)) return mimeType;
  if (kind === "pdf") return "application/pdf";
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

export function extensionFor(mime: string): string {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/heic" || mime === "image/heif" ? "heic" : "jpg";
}

export function buildExtractionPlan(snapshot: PhoneSnapshot): ExtractionPlan {
  const unreadable: string[] = [];
  const read = (key: string, raw: string | null): unknown => {
    const parsed = parseJson(raw);
    if (parsed === undefined) {
      unreadable.push(key);
      return null;
    }
    return parsed;
  };

  const lessons = arr(read(KEYS.lessons, snapshot.lessonsRaw));
  const reports = arr(read(KEYS.reports, snapshot.reportsRaw));
  const materials = arr(read(KEYS.materials, snapshot.materialsRaw));

  const items: ExtractionItem[] = [];
  for (const lesson of lessons) {
    const lessonId = str(lesson.id);
    if (!lessonId || !isObj(lesson.form)) continue;
    arr((lesson.form as Obj).activityAttachments).forEach((a, index) => {
      const uri = str(a.uri);
      if (!uri) return;
      const attachmentId = str(a.id) ?? `att_${stableHash(`${lessonId}:${index}`)}`;
      const kind = a.kind === "image" ? "image" : "pdf";
      items.push({
        kind: "lesson_attachment",
        legacyId: `${lessonId}:${attachmentId}`,
        uri,
        mimeType: mimeFor(kind, str(a.name) ?? "", str(a.mimeType)),
        expectedSize: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
      });
    });
  }
  for (const material of materials) {
    const id = str(material.id);
    const attachment = isObj(material.attachment) ? material.attachment : null;
    const uri = attachment ? str(attachment.uri) : null;
    if (!id || !attachment || !uri) continue;
    const kind = attachment.kind === "image" ? "image" : "pdf";
    items.push({ kind: "material", legacyId: id, uri, mimeType: mimeFor(kind, str(attachment.name) ?? "", str(attachment.mimeType)), expectedSize: typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : null });
  }
  for (const report of reports) {
    const id = str(report.id);
    const uri = str(report.permanentPdfUri);
    if (id && uri) items.push({ kind: "report_pdf", legacyId: id, uri, mimeType: "application/pdf", expectedSize: null });
  }

  const deviceLocal: Record<string, string> = {};
  for (const key of DEVICE_LOCAL_KEYS) {
    const value = snapshot.deviceLocal[key];
    if (typeof value === "string") deviceLocal[key] = value;
  }
  const pending = parseJson(deviceLocal[KEYS.pendingTrainingOperations] ?? null);
  const pendingOperations = Array.isArray(pending) ? pending.length : isObj(pending) ? Object.keys(pending).length : 0;
  const session = parseJson(deviceLocal[KEYS.activeClassSession] ?? null);
  const activeClassSession = session !== null && session !== undefined && !(isObj(session) && Object.keys(session).length === 0);

  return { items, manifest: { materials, deviceLocal }, gates: { pendingOperations, activeClassSession }, unreadable };
}
