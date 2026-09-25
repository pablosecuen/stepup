/**
 * Fase 9 — mapeo e interpretación PURA (sin red) del historial real de
 * importaciones (`import_runs`). Nunca expone el payload retenido ni las
 * filas técnicas de snapshot — sólo lo que hace falta para decidir/mostrar.
 */

export interface ImportRunCountsByTable {
  [tableName: string]: number;
}

export interface ImportRunHistoryRow {
  id: string;
  status: "applied" | "undone";
  createdAt: string;
  /** Del `import_previews` original (persiste incluso después de que el preview 'pending' expira — sólo se purga si el propio run se purga). */
  checksum: string | null;
  schemaVersion: number | null;
  appVersion: string | null;
  totalRowsWritten: number;
  countsByTable: ImportRunCountsByTable | null;
  undoExpiresAt: string;
  undoneAt: string | null;
  payloadPurged: boolean;
  snapshotsPurged: boolean;
}

export type UndoAvailability =
  | { kind: "already_undone" }
  | { kind: "snapshots_purged" }
  | { kind: "expired" }
  | { kind: "available" };

/** Nunca asume que "no vencido" = "se puede deshacer de forma segura" — eso sólo lo confirma `preview_undo_backup_import` real; esto sólo decide si tiene sentido ofrecer el botón. */
export function computeUndoAvailability(row: ImportRunHistoryRow, now: Date): UndoAvailability {
  if (row.status === "undone") return { kind: "already_undone" };
  if (row.snapshotsPurged) return { kind: "snapshots_purged" };
  if (new Date(row.undoExpiresAt).getTime() < now.getTime()) return { kind: "expired" };
  return { kind: "available" };
}
