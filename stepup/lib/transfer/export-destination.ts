/**
 * Volcado de SÓLO LECTURA de lo que la cuenta tiene en la web (copia del destino del traslado). Debe funcionar con el esquema de Production ANTERIOR a R9/R10:
 * las tablas que esas migraciones agregan pueden no existir todavía y se declaran «no disponibles en esta versión» (lista `unavailable`). Cualquier otro
 * problema ABORTA: una tabla que ya existía y falta, un error de permisos, de red o de consulta nunca se convierte en una tabla vacía (un volcado con huecos
 * silenciosos pasaría por una copia buena).
 *
 * Puro: recibe el cliente de lectura (el de la sesión de la propia cuenta). No escribe nada.
 */
import { readTable, type ReadClient } from "../db/read.ts";

type Row = Record<string, unknown>;

/** Tablas que agregan R9/R10: es lo ÚNICO que puede faltar sin abortar. */
export const TABLES_ADDED_BY_TRANSFER_MIGRATIONS: readonly string[] = [
  "lesson_attachments",
  "student_source_extras",
  "material_library_items",
  "device_local_snapshots",
  "phone_extraction_results",
  "origin_incidents",
];

export type ExportFailureKind = "missing_existing_table" | "permission" | "network" | "query";

export class ExportAbortError extends Error {
  readonly kind: ExportFailureKind;
  readonly table: string;
  constructor(kind: ExportFailureKind, table: string) {
    super(`No se pudo leer «${table}» (${kind}). El volcado se cancela: nada se guardó.`);
    this.name = "ExportAbortError";
    this.kind = kind;
    this.table = table;
  }
}

const errorCode = (e: unknown): string => (e !== null && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? ((e as { code: string }).code) : "");
const errorMessage = (e: unknown): string => (e !== null && typeof e === "object" && typeof (e as { message?: unknown }).message === "string" ? ((e as { message: string }).message) : "");

/** ¿El error dice que la TABLA no existe (no que la consulta o el acceso fallaron)? */
export function isMissingTableError(e: unknown): boolean {
  const code = errorCode(e);
  if (code === "PGRST205" || code === "42P01") return true;
  return /could not find the table|relation "?[\w.]+"? does not exist/i.test(errorMessage(e));
}

export function classifyReadError(e: unknown): ExportFailureKind {
  const code = errorCode(e);
  const message = errorMessage(e);
  if (isMissingTableError(e)) return "missing_existing_table";
  if (code === "42501" || code === "PGRST301" || code === "PGRST302" || /permission denied|jwt|not authorized|unauthorized|forbidden/i.test(message)) return "permission";
  if (code === "" || /fetch failed|failed to fetch|network|econn|enotfound|socket hang|aborted/i.test(message)) return "network";
  return "query";
}

export interface DestinationExport {
  tables: Record<string, Row[]>;
  /** Tablas que todavía no existen en esta versión del esquema (sólo las que agregan R9/R10). */
  unavailable: string[];
  /** Versión del esquema detectada: «r10» si están todas las tablas nuevas, «anterior» si falta alguna. */
  schema: "r10" | "anterior";
}

export async function exportDestination(client: ReadClient, ownerId: string, tables: readonly string[]): Promise<DestinationExport> {
  const out: Record<string, Row[]> = {};
  const unavailable: string[] = [];
  for (const table of tables) {
    try {
      out[table] = await readTable<Row>(client, table, { filter: (q) => q.eq("owner_id", ownerId) });
    } catch (error) {
      if (isMissingTableError(error) && TABLES_ADDED_BY_TRANSFER_MIGRATIONS.includes(table)) {
        unavailable.push(table);
        continue;
      }
      throw new ExportAbortError(classifyReadError(error), table);
    }
  }
  return { tables: out, unavailable, schema: unavailable.length === 0 ? "r10" : "anterior" };
}
