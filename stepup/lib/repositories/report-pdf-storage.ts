/**
 * Borrado de TODOS los PDF de reportes de una cuenta en el bucket privado `report-pdfs` (R4, hallazgo M-06). Los PDF son datos
 * personales de alumnos (posiblemente menores). `delete_own_account` borra la fila de `auth.users` y, en cascada, las tablas, pero
 * Storage no tiene ninguna relación con esa cascada: sin este paso los PDF quedan huérfanos para siempre, y la base no puede
 * borrarlos con SQL (`storage.protect_delete` lo impide: sólo la API de Storage borra objetos).
 *
 * Por eso la eliminación de la cuenta borra los archivos ANTES, con la propia sesión de la persona (las políticas del bucket
 * dejan borrar sólo bajo el prefijo `<id de usuario>/`), y la cuenta se elimina recién cuando no queda ningún archivo.
 * Los objetos viven en `<owner>/<alumno>/<reporte>.pdf`; se recorren por la API de listado (no se confía en lo que dice la tabla
 * `report_records`: así también se limpian archivos huérfanos de intentos anteriores).
 *
 * Idempotente y reanudable: borrar lo que no existe no falla, y si se corta (tiempo, red, Storage) lanza
 * `ReportPdfCleanupIncompleteError` y la cuenta NO se elimina; volver a intentar continúa donde quedó. Pura: recibe el bucket.
 * Nunca registra rutas ni nombres.
 */
export const REPORT_PDF_BUCKET = "report-pdfs";

const PAGE_SIZE = 100;
const REMOVE_BATCH = 100;
const MAX_PAGES_PER_DIRECTORY = 1000;
const MAX_DEPTH = 3; // <owner>/<alumno>/<archivo>: un nivel más de margen
const FOLDER_CONCURRENCY = 6;
const DEFAULT_BUDGET_MS = 40_000;
const OWNER_ID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Un elemento del listado de Storage: `id` nulo = carpeta. */
export interface StorageEntry {
  name: string;
  id: string | null;
}

export interface ReportPdfBucket {
  list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }): Promise<{ data: StorageEntry[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
}

/** Quedaron archivos sin borrar (o no se pudo comprobar): la cuenta no se debe eliminar todavía. */
export type ReportPdfCleanupFailure = "storage_error" | "time_budget" | "files_remaining" | "unexpected_layout";

export class ReportPdfCleanupIncompleteError extends Error {
  reason: ReportPdfCleanupFailure;

  constructor(reason: ReportPdfCleanupFailure) {
    super(`report_pdf_cleanup_incomplete:${reason}`);
    this.name = "ReportPdfCleanupIncompleteError";
    this.reason = reason;
  }
}

export interface ReportPdfCleanupOptions {
  now?: () => number;
  budgetMs?: number;
}

export async function removeAllReportPdfsOf(bucket: ReportPdfBucket, ownerId: string, options: ReportPdfCleanupOptions = {}): Promise<{ removed: number }> {
  // Nunca se opera con un prefijo vacío o que no sea exactamente un id de usuario.
  if (!OWNER_ID_SHAPE.test(ownerId)) throw new ReportPdfCleanupIncompleteError("unexpected_layout");

  const now = options.now ?? Date.now;
  const startedAt = now();
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  let removed = 0;

  const checkTime = () => {
    if (now() - startedAt > budgetMs) throw new ReportPdfCleanupIncompleteError("time_budget");
  };

  async function listAll(directory: string): Promise<StorageEntry[]> {
    const entries: StorageEntry[] = [];
    for (let page = 0; page < MAX_PAGES_PER_DIRECTORY; page += 1) {
      checkTime();
      const { data, error } = await bucket.list(directory, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, sortBy: { column: "name", order: "asc" } });
      if (error || !data) throw new ReportPdfCleanupIncompleteError("storage_error");
      entries.push(...data);
      if (data.length < PAGE_SIZE) return entries;
    }
    throw new ReportPdfCleanupIncompleteError("unexpected_layout");
  }

  const ownedPath = (directory: string, name: string): string => {
    // Cada ruta que se borra sale del propio listado de ESTA cuenta y se comprueba que siga bajo su prefijo.
    const path = `${directory}/${name}`;
    if (!name || name.includes("/") || name === "." || name === ".." || !path.startsWith(`${ownerId}/`)) {
      throw new ReportPdfCleanupIncompleteError("unexpected_layout");
    }
    return path;
  };

  async function clean(directory: string, depth: number): Promise<void> {
    const entries = await listAll(directory);
    const files = entries.filter((entry) => entry.id !== null);
    const folders = entries.filter((entry) => entry.id === null);

    for (let i = 0; i < files.length; i += REMOVE_BATCH) {
      checkTime();
      const paths = files.slice(i, i + REMOVE_BATCH).map((file) => ownedPath(directory, file.name));
      const { error } = await bucket.remove(paths);
      if (error) throw new ReportPdfCleanupIncompleteError("storage_error");
      removed += paths.length;
    }

    if (folders.length > 0 && depth >= MAX_DEPTH) throw new ReportPdfCleanupIncompleteError("unexpected_layout");
    await forEachLimited(folders, FOLDER_CONCURRENCY, (folder) => clean(ownedPath(directory, folder.name), depth + 1));
  }

  async function anyFileLeft(directory: string, depth: number): Promise<boolean> {
    const entries = await listAll(directory);
    if (entries.some((entry) => entry.id !== null)) return true;
    const folders = entries.filter((entry) => entry.id === null);
    if (folders.length > 0 && depth >= MAX_DEPTH) return true;
    for (const folder of folders) {
      if (await anyFileLeft(ownedPath(directory, folder.name), depth + 1)) return true;
    }
    return false;
  }

  await clean(ownerId, 0);
  // Comprobación final: recién cuando un listado nuevo no encuentra NINGÚN archivo se considera hecho.
  if (await anyFileLeft(ownerId, 0)) throw new ReportPdfCleanupIncompleteError("files_remaining");
  return { removed };
}

/** Recorre `items` con a lo sumo `limit` tareas a la vez; ante el primer error espera a las que ya empezaron y lo propaga. */
async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (failure === null && next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await task(item);
      } catch (error) {
        failure = failure ?? error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure !== null) throw failure;
}
