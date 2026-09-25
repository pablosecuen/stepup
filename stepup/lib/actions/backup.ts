"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { validateBackupPayload } from "@/lib/backup/validation";
import { toImportPreviewDto, type ImportPreviewDto } from "@/lib/backup/import-preview-mapping";
import {
  fetchOwnLatestCloudBackup,
  previewBackupImport,
  applyBackupImport,
  previewUndoBackupImport,
  applyUndoBackupImport,
  discardImportUndo,
  listImportRuns,
  type FieldOverride,
  type DuplicateDecision,
  type ApplyRunSummary,
  type PreviewUndoResult,
} from "@/lib/repositories/backup-import";
import type { ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";

// Server Actions — Fase 9 (Backup e importación). Nunca reciben `ownerId`
// del navegador; `requireAuthenticatedDbContext()` siempre resuelve la
// sesión real en el servidor. La validación estructural pura corre PRIMERO,
// sin tocar la base — sólo si pasa se llama a `preview_backup_import`.
//
// Frontera de seguridad (Fase 9, corrección de transparencia real): el
// mapeo a DTO (`toImportPreviewDto`) corre ACÁ, del lado del servidor,
// ANTES de que cualquier cosa vuelva al cliente — `candidate_fingerprint`
// y cualquier otro campo técnico nunca cruzan la red hacia el navegador.

export interface ActionResult<T> {
  error?: string;
  data?: T;
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Ocurrió un error inesperado. Intentá de nuevo.";
}

export async function fetchLatestCloudBackupAction(): Promise<ActionResult<{ found: boolean; createdAt?: string; appVersion?: string | null }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const backup = await fetchOwnLatestCloudBackup(ctx);
    if (!backup) return { data: { found: false } };
    return { data: { found: true, createdAt: backup.createdAt, appVersion: backup.appVersion } };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

/**
 * Analiza el backup real más reciente de la cuenta: validación estructural
 * pura (sin DB) + `preview_backup_import` (sólo lectura sobre datos de
 * negocio, escribe únicamente las tablas técnicas de preview). Nunca usa
 * el backup real de Joaquín en pruebas — esto es la RUTA REAL de producto,
 * separada de los archivos de prueba `PRUEBA WEB F9` usados en las pruebas
 * automatizadas.
 */
export async function analyzeLatestCloudBackupAction(): Promise<ActionResult<{ preview: ImportPreviewDto }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const backup = await fetchOwnLatestCloudBackup(ctx);
    if (!backup) return { error: "No encontramos ningún respaldo en la nube para tu cuenta." };

    const validation = validateBackupPayload(backup.payload);
    if (!validation.ok) {
      return { error: validation.errors.map((e) => e.message).join(" ") };
    }

    const result = await previewBackupImport(
      ctx,
      validation.backup as unknown as Record<string, unknown>,
      validation.excludedCollections as unknown as Record<string, unknown>
    );
    const preview = toImportPreviewDto({
      previewId: result.previewId,
      expiresAt: result.expiresAt,
      classification: result.classification,
      excludedCollections: result.excludedCollections,
    });
    return { data: { preview } };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function applyImportPreviewAction(
  previewId: string,
  fieldOverrides: FieldOverride[],
  duplicateDecisions: DuplicateDecision[]
): Promise<ActionResult<{ importRunId: string; summary: ApplyRunSummary }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const result = await applyBackupImport(ctx, previewId, fieldOverrides, duplicateDecisions);
    return { data: { importRunId: result.importRunId, summary: result.summary } };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function previewUndoImportAction(importRunId: string): Promise<ActionResult<PreviewUndoResult>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const result = await previewUndoBackupImport(ctx, importRunId);
    return { data: result };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function applyUndoImportAction(undoPreviewId: string): Promise<ActionResult<{ summary: ApplyRunSummary }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const summary = await applyUndoBackupImport(ctx, undoPreviewId);
    return { data: { summary } };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function discardImportUndoAction(importRunId: string): Promise<ActionResult<{ discarded: true }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await discardImportUndo(ctx, importRunId);
    return { data: { discarded: true } };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}

export async function listImportRunsAction(): Promise<ActionResult<ImportRunHistoryRow[]>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const runs = await listImportRuns(ctx);
    return { data: runs };
  } catch (error) {
    return { error: friendlyError(error) };
  }
}
