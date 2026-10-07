"use server";

import { requireAuthenticatedDbContext } from "@/lib/db/server-context";
import { validateBackupPayload } from "@/lib/backup/validation";
import { toImportPreviewDto, type ImportPreviewDto, type BackupStudentSummaryMap, type RawDuplicatePersonSource } from "@/lib/backup/import-preview-mapping";
import { toHumanBlockedRow, UNDO_BLOCKED_EXPLANATION, type UndoBlockedPreview } from "@/lib/backup/undo-blocked-mapping";
import {
  fetchOwnLatestCloudBackup,
  previewBackupImport,
  applyBackupImport,
  previewUndoBackupImport,
  applyUndoBackupImport,
  discardImportUndo,
  listImportRuns,
  fetchStudentsSummaryByIds,
  resolveUndoBlockers,
  type FieldOverride,
  type DuplicateDecision,
  type ApplyRunSummary,
} from "@/lib/repositories/backup-import";
import type { ImportRunHistoryRow } from "@/lib/backup/import-history-mapping";
import { translateImportError, translateValidationErrors, type ImportErrorContext } from "@/lib/backup/import-copy";
import { formatInstantDateTime } from "@/lib/format/date-format";
import { actionErrorMessage } from "@/lib/errors/action-error";
import { consumeActionQuota } from "@/lib/repositories/action-quota";

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
  /** Código corto y estable para soporte (nunca datos personales, ids ni nombres de tablas). */
  errorCode?: string;
  data?: T;
}

// Todo error del asistente se traduce a una frase útil + un código de soporte (`lib/backup/import-copy.ts`): el mensaje
// interno de la RPC (ids, palabras como «preview» o «invariante») nunca llega al navegador.
function failure(error: unknown, context: ImportErrorContext): { error: string; errorCode: string } {
  const translated = translateImportError(actionErrorMessage("backup", error), context);
  return { error: translated.message, errorCode: translated.code };
}

export async function fetchLatestCloudBackupAction(): Promise<ActionResult<{ found: boolean; createdAt?: string; appVersion?: string | null }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const backup = await fetchOwnLatestCloudBackup(ctx);
    if (!backup) return { data: { found: false } };
    return { data: { found: true, createdAt: backup.createdAt, appVersion: backup.appVersion } };
  } catch (error) {
    return failure(error, "analyze");
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
export async function analyzeLatestCloudBackupAction(): Promise<ActionResult<{ preview: ImportPreviewDto; backup: { createdAtLabel: string; appVersion: string | null } }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await consumeActionQuota(ctx, "cloud_backup_analyze");
    const backup = await fetchOwnLatestCloudBackup(ctx);
    if (!backup) {
      const translated = translateImportError("No encontramos ningún respaldo en la nube para tu cuenta.", "analyze");
      return { error: translated.message, errorCode: translated.code };
    }

    const validation = validateBackupPayload(backup.payload);
    if (!validation.ok) {
      const translated = translateValidationErrors(validation.errors);
      return { error: translated.message, errorCode: translated.code };
    }

    const result = await previewBackupImport(
      ctx,
      validation.backup as unknown as Record<string, unknown>,
      validation.excludedCollections as unknown as Record<string, unknown>
    );

    // Corrección de UX post-E2E: el panel de "posible duplicado" necesita
    // identificar a ambos alumnos por nombre — se resuelve acá, server-side,
    // ANTES del DTO. El backup ya está en memoria (validado); el candidato
    // web se lee de verdad (RLS + owner explícito).
    const duplicates = result.classification.maestros.students.duplicates;
    const backupStudents: BackupStudentSummaryMap = {};
    for (const legacyId of duplicates.map((d) => d.backup_legacy_mobile_id)) {
      const raw = validation.backup.students.find((s) => s.id === legacyId);
      if (raw) {
        backupStudents[legacyId] = { name: raw.name, levels: raw.levels, initialLevel: raw.initialLevel, status: raw.status, phone: raw.phone, email: raw.email } satisfies RawDuplicatePersonSource;
      }
    }
    // También se resuelve el nombre de cada alumno en conflicto (mismo helper, solo lectura): sin él, la pantalla pedía
    // elegir campos sin decir de qué alumno se trataba.
    const candidateStudents = await fetchStudentsSummaryByIds(ctx, [
      ...duplicates.map((d) => d.candidate_student_id),
      ...result.classification.maestros.students.conflicts.map((c) => c.row_id),
    ]);

    const preview = toImportPreviewDto(
      {
        previewId: result.previewId,
        expiresAt: result.expiresAt,
        classification: result.classification,
        excludedCollections: result.excludedCollections,
      },
      { backupStudents, candidateStudents }
    );
    return { data: { preview, backup: { createdAtLabel: formatInstantDateTime(backup.createdAt), appVersion: backup.appVersion ?? null } } };
  } catch (error) {
    return failure(error, "analyze");
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
    return failure(error, "apply");
  }
}

export async function previewUndoImportAction(importRunId: string): Promise<ActionResult<UndoBlockedPreview>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const result = await previewUndoBackupImport(ctx, importRunId);
    if (result.isSafe) {
      return { data: { undoPreviewId: result.undoPreviewId, isSafe: true, explanation: "", blockedRows: [] } };
    }
    // Corrección de UX post-E2E: nunca devolver table_name/row_id crudos —
    // se resuelven a nombre real de alumno + fecha/concepto real ANTES de
    // que esto vuelva al cliente.
    const resolved = await resolveUndoBlockers(ctx, result.unsafeRows);
    return {
      data: {
        undoPreviewId: result.undoPreviewId,
        isSafe: false,
        explanation: UNDO_BLOCKED_EXPLANATION,
        blockedRows: resolved.map(toHumanBlockedRow),
      },
    };
  } catch (error) {
    return failure(error, "undoPreview");
  }
}

export async function applyUndoImportAction(undoPreviewId: string): Promise<ActionResult<{ summary: ApplyRunSummary }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const summary = await applyUndoBackupImport(ctx, undoPreviewId);
    return { data: { summary } };
  } catch (error) {
    return failure(error, "undo");
  }
}

export async function discardImportUndoAction(importRunId: string): Promise<ActionResult<{ discarded: true }>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    await discardImportUndo(ctx, importRunId);
    return { data: { discarded: true } };
  } catch (error) {
    return failure(error, "discard");
  }
}

export async function listImportRunsAction(): Promise<ActionResult<ImportRunHistoryRow[]>> {
  try {
    const ctx = await requireAuthenticatedDbContext();
    const runs = await listImportRuns(ctx);
    return { data: runs };
  } catch (error) {
    return failure(error, "history");
  }
}
