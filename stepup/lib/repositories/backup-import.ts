import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import type { ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";
import type { RawClassification, RawExcludedCollections } from "@/lib/backup/import-preview-mapping";

/**
 * Repositorio de Fase 9 — envuelve las 6 RPC reales (`fetch_own_latest_cloud_backup`,
 * `preview_backup_import`, `apply_backup_import`, `preview_undo_backup_import`,
 * `apply_undo_backup_import`, `discard_import_undo`). Nunca reimplementa la
 * clasificación/aplicación acá — toda la lógica real vive en Postgres
 * (`supabase/migrations/20260927090000_backup_import.sql`), este archivo es
 * sólo el pegamento de red, mismo patrón que el resto de `lib/repositories/`.
 */

export interface CloudBackupRow {
  id: string;
  schemaVersion: number;
  appVersion: string | null;
  checksum: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function fetchOwnLatestCloudBackup(ctx: AuthenticatedDbContext): Promise<CloudBackupRow | null> {
  const { data, error } = await ctx.supabase.rpc("fetch_own_latest_cloud_backup");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    appVersion: row.app_version,
    checksum: row.checksum,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export interface PreviewBackupImportResult {
  previewId: string;
  expiresAt: string;
  classification: RawClassification;
  excludedCollections: RawExcludedCollections;
}

export async function previewBackupImport(
  ctx: AuthenticatedDbContext,
  payload: Record<string, unknown>,
  excludedCollections: Record<string, unknown>
): Promise<PreviewBackupImportResult> {
  const { data, error } = await ctx.supabase.rpc("preview_backup_import", {
    p_payload: payload,
    p_excluded_collections: excludedCollections,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    previewId: row.preview_id,
    expiresAt: row.expires_at,
    classification: row.classification,
    excludedCollections: row.excluded_collections,
  };
}

export interface FieldOverride {
  tableName: string;
  rowId: string;
  fields: string[];
}

export interface DuplicateDecision {
  backupLegacyMobileId: string;
  decision: "link" | "create_separate" | "skip";
  candidateStudentId?: string;
}

export interface ApplyRunSummary {
  replayed: boolean;
  totalRowsWritten: number;
  countsByTable: Record<string, number> | null;
}

export interface ApplyBackupImportResult {
  importRunId: string;
  summary: ApplyRunSummary;
}

function toApplyRunSummary(raw: { replayed?: boolean; total_rows_written?: number; counts_by_table?: Record<string, number> } | null): ApplyRunSummary {
  return {
    replayed: raw?.replayed ?? false,
    totalRowsWritten: raw?.total_rows_written ?? 0,
    countsByTable: raw?.counts_by_table ?? null,
  };
}

export async function applyBackupImport(
  ctx: AuthenticatedDbContext,
  previewId: string,
  fieldOverrides: FieldOverride[],
  duplicateDecisions: DuplicateDecision[]
): Promise<ApplyBackupImportResult> {
  const { data, error } = await ctx.supabase.rpc("apply_backup_import", {
    p_preview_id: previewId,
    p_field_overrides: fieldOverrides.map((o) => ({ table_name: o.tableName, row_id: o.rowId, fields: o.fields })),
    p_duplicate_decisions: duplicateDecisions.map((d) => ({
      backup_legacy_mobile_id: d.backupLegacyMobileId,
      decision: d.decision,
      candidate_student_id: d.candidateStudentId ?? null,
    })),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { importRunId: row.import_run_id, summary: toApplyRunSummary(row.summary) };
}

export interface UnsafeUndoRow {
  tableName: string;
  rowId: string | null;
  reason: string;
  blockingChildren?: Array<{ tableName: string; rowId: string | null; reason?: string }>;
}

export interface PreviewUndoResult {
  undoPreviewId: string;
  isSafe: boolean;
  unsafeRows: UnsafeUndoRow[];
}

function toUnsafeRow(raw: { table_name: string; row_id: string | null; reason: string; blocking_children?: Array<{ table_name: string; row_id: string | null; reason?: string }> }): UnsafeUndoRow {
  return {
    tableName: raw.table_name,
    rowId: raw.row_id,
    reason: raw.reason,
    blockingChildren: raw.blocking_children?.map((c) => ({ tableName: c.table_name, rowId: c.row_id, reason: c.reason })),
  };
}

export async function previewUndoBackupImport(ctx: AuthenticatedDbContext, importRunId: string): Promise<PreviewUndoResult> {
  const { data, error } = await ctx.supabase.rpc("preview_undo_backup_import", { p_import_run_id: importRunId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { undoPreviewId: row.undo_preview_id, isSafe: row.is_safe, unsafeRows: (row.unsafe_rows ?? []).map(toUnsafeRow) };
}

export async function applyUndoBackupImport(ctx: AuthenticatedDbContext, undoPreviewId: string): Promise<ApplyRunSummary> {
  const { data, error } = await ctx.supabase.rpc("apply_undo_backup_import", { p_undo_preview_id: undoPreviewId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return toApplyRunSummary(row.summary);
}

export async function discardImportUndo(ctx: AuthenticatedDbContext, importRunId: string): Promise<void> {
  const { error } = await ctx.supabase.rpc("discard_import_undo", { p_import_run_id: importRunId });
  if (error) throw error;
}

/**
 * Historial real de importaciones de la cuenta — sólo lectura directa
 * (RLS: `authenticated` tiene SELECT propio sobre `import_runs`, NUNCA
 * sobre `import_previews`/`import_run_row_snapshots`). Por eso
 * `backup_checksum`/`schema_version`/`app_version` se leen de una copia
 * denormalizada en la propia fila de `import_runs` (copiada una sola vez
 * al confirmar, ver `apply_backup_import`) — nunca de una segunda consulta
 * a `import_previews`, que RLS rechazaría. `retained_payload`/las filas de
 * `import_run_row_snapshots` NUNCA se seleccionan acá — sólo lo necesario
 * para decidir/mostrar.
 */
export async function listImportRuns(ctx: AuthenticatedDbContext): Promise<ImportRunHistoryRow[]> {
  const { data, error } = await ctx.supabase
    .from("import_runs")
    .select(
      "id, status, backup_checksum, schema_version, app_version, summary, created_at, undo_expires_at, undone_at, payload_purged_at, snapshots_purged_at"
    )
    .eq("owner_id", ctx.ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const summary = (r.summary ?? {}) as { counts_by_table?: Record<string, number>; total_rows_written?: number };
    return {
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      checksum: r.backup_checksum,
      schemaVersion: r.schema_version,
      appVersion: r.app_version,
      totalRowsWritten: summary.total_rows_written ?? 0,
      countsByTable: summary.counts_by_table ?? null,
      undoExpiresAt: r.undo_expires_at,
      undoneAt: r.undone_at,
      payloadPurged: r.payload_purged_at !== null,
      snapshotsPurged: r.snapshots_purged_at !== null,
    };
  });
}
