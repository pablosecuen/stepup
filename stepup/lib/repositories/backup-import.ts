import "server-only";
import type { AuthenticatedDbContext } from "@/lib/db/server-context";
import { readTable, readTableByIds } from "@/lib/db/read";
import type { ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";
import type { RawClassification, RawExcludedCollections, RawDuplicatePersonSource } from "@/lib/backup/import-preview-mapping";
import type { ResolvedBlockerRow, ResolvedBlockerChild } from "@/lib/backup/undo-blocked-mapping";

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

/**
 * Fila real de `students` reducida a los campos mínimos necesarios para
 * identificar a un alumno en el panel de "posible duplicado" (corrección de
 * UX post-E2E) — nunca se selecciona ni se expone ningún otro campo.
 * `RLS` ya restringe a filas del propio owner; el `.eq('owner_id', ...)`
 * explícito es defensa en profundidad, mismo patrón que `listImportRuns`.
 */
export async function fetchStudentsSummaryByIds(ctx: AuthenticatedDbContext, ids: string[]): Promise<Record<string, RawDuplicatePersonSource>> {
  if (ids.length === 0) return {};
  // R2: ids en lotes de 100 (nunca una lista ilimitada en la URL).
  const data = await readTableByIds<Record<string, unknown>>(ctx.supabase, "students", {
    columns: "id, name, levels, status, phone, email",
    matchColumn: "id",
    ids,
    filter: (query) => query.eq("owner_id", ctx.ownerId),
  });
  const out: Record<string, RawDuplicatePersonSource> = {};
  for (const row of data) {
    out[row.id as string] = { name: row.name as string, levels: (row.levels as string[]) ?? [], status: row.status as string, phone: row.phone as string | null, email: row.email as string | null };
  }
  return out;
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

/**
 * Config real por tabla para resolver una dependencia bloqueante a texto
 * humano (fecha/concepto) — sólo las columnas mínimas necesarias, nunca
 * `owner_id` ni ninguna otra. Las tablas sin config igual se resuelven
 * (se confirma que la fila existe) pero sin fecha/concepto propio, con el
 * rótulo humano genérico de `humanTableLabel`.
 */
const BLOCKER_TABLE_SELECT: Record<string, { select: string; date: (r: Record<string, unknown>) => string | null; concept?: (r: Record<string, unknown>) => string | null }> = {
  payment_charges: { select: "due_date, billing_period, original_amount", date: (r) => r.due_date as string | null, concept: (r) => (r.original_amount != null ? `$${r.original_amount}${r.billing_period ? ` (${r.billing_period})` : ""}` : null) },
  payments: { select: "paid_at, amount", date: (r) => r.paid_at as string | null, concept: (r) => (r.amount != null ? `$${r.amount}` : null) },
  payment_allocations: { select: "created_at, amount", date: (r) => r.created_at as string | null, concept: (r) => (r.amount != null ? `$${r.amount}` : null) },
  payment_adjustments: { select: "created_at, reason", date: (r) => r.created_at as string | null, concept: (r) => (r.reason as string | null) },
  package_purchases: { select: "valid_from, amount", date: (r) => r.valid_from as string | null, concept: (r) => (r.amount != null ? `$${r.amount}` : null) },
  package_credit_movements: { select: "created_at, amount, reason", date: (r) => r.created_at as string | null, concept: (r) => (r.reason as string | null) },
  lesson_registrations: { select: "scheduled_start_at, actual_started_at", date: (r) => (r.actual_started_at ?? r.scheduled_start_at) as string | null },
  calendar_lessons: { select: "start_at, student_name", date: (r) => r.start_at as string | null, concept: (r) => (r.student_name as string | null) },
  calendar_lesson_participants: { select: "created_at, student_name", date: (r) => r.created_at as string | null, concept: (r) => (r.student_name as string | null) },
  recurrence_rules: { select: "effective_from_date, status", date: (r) => r.effective_from_date as string | null, concept: (r) => (r.status as string | null) },
  recurrence_rule_participants: { select: "created_at", date: (r) => r.created_at as string | null },
  recurrence_exceptions: { select: "created_at", date: (r) => r.created_at as string | null },
  training_billing_agreements: { select: "created_at", date: (r) => r.created_at as string | null },
  student_status_history: { select: "created_at, status, reason", date: (r) => r.created_at as string | null, concept: (r) => (r.status as string | null) },
  student_level_history: { select: "achieved_on, level", date: (r) => r.achieved_on as string | null, concept: (r) => (r.level as string | null) },
  student_price_history: { select: "created_at", date: (r) => r.created_at as string | null },
  monthly_amount_corrections: { select: "billing_period, reason", date: () => null, concept: (r) => (r.reason as string | null) ?? (r.billing_period as string | null) },
  initial_paid_surcharge_corrections: { select: "billing_period, reason", date: () => null, concept: (r) => (r.reason as string | null) ?? (r.billing_period as string | null) },
  first_month_proration_decisions: { select: "billing_period, created_at", date: (r) => r.created_at as string | null, concept: (r) => (r.billing_period as string | null) },
  report_draft_claims: { select: "created_at", date: (r) => r.created_at as string | null },
};

/**
 * Resuelve `unsafe_rows` (crudo, de `preview_undo_backup_import`) contra la
 * base real: nombre real del alumno para el padre bloqueado (si es
 * `students`), y fecha/concepto real por cada dependencia hija. Nunca
 * expone nada de esto sin pasar antes por `toHumanBlockedRow`
 * (`lib/backup/undo-blocked-mapping.ts`) — este archivo sólo junta datos
 * reales, no arma el texto final para el navegador.
 */
export async function resolveUndoBlockers(ctx: AuthenticatedDbContext, unsafeRows: UnsafeUndoRow[]): Promise<ResolvedBlockerRow[]> {
  const studentParentIds = unsafeRows.filter((r) => r.tableName === "students" && r.rowId).map((r) => r.rowId as string);
  const studentNames = studentParentIds.length > 0 ? await fetchStudentsSummaryByIds(ctx, studentParentIds) : {};

  const out: ResolvedBlockerRow[] = [];
  for (const row of unsafeRows) {
    const children: ResolvedBlockerChild[] = [];
    for (const child of row.blockingChildren ?? []) {
      if (!child.rowId) {
        children.push({ tableName: child.tableName, resolved: false });
        continue;
      }
      const config = BLOCKER_TABLE_SELECT[child.tableName];
      if (!config) {
        // Tabla sin config de detalle: igual confirmamos que la fila existe realmente.
        const { data } = await ctx.supabase.from(child.tableName).select("id").eq("owner_id", ctx.ownerId).eq("id", child.rowId).maybeSingle();
        children.push({ tableName: child.tableName, resolved: Boolean(data) });
        continue;
      }
      const { data } = await ctx.supabase.from(child.tableName).select(config.select).eq("owner_id", ctx.ownerId).eq("id", child.rowId).maybeSingle();
      if (!data) {
        children.push({ tableName: child.tableName, resolved: false });
        continue;
      }
      const record = data as unknown as Record<string, unknown>;
      children.push({ tableName: child.tableName, resolved: true, dateIso: config.date(record), concept: config.concept?.(record) ?? null });
    }
    out.push({
      parentTableName: row.tableName,
      parentStudentName: row.tableName === "students" && row.rowId ? studentNames[row.rowId]?.name : undefined,
      children,
    });
  }
  return out;
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
  const data = await readTable<Record<string, any>>(ctx.supabase, "import_runs", {
    columns:
      "id, status, backup_checksum, schema_version, app_version, summary, created_at, undo_expires_at, undone_at, payload_purged_at, snapshots_purged_at",
    filter: (query) => query.eq("owner_id", ctx.ownerId),
    order: [
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ],
    pageSize: 100,
  });
  return data.map((r) => {
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
