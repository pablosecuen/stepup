import { BACKUP_IMPORT_LIMITS } from "./limits.ts";
import { BACKUP_SCHEMA_VERSION_V1, BACKUP_SCHEMA_VERSION_V2, type TeacherFlowBackup } from "./types.ts";

/**
 * Fase 9 — validación estructural PURA (sin DB, sin Supabase), puerto de
 * `restoreValidation.ts` (móvil) ajustado a los límites nuevos de Fase 9
 * (`BACKUP_IMPORT_LIMITS`). Corre SIEMPRE antes de llegar a Postgres —
 * `preview_backup_import` repite tamaño/conteos como defensa en
 * profundidad, nunca confía en que esta capa ya corrió del lado correcto.
 */

export interface BackupValidationError {
  code: string;
  message: string;
  path?: string;
}

export type BackupValidationResult =
  | { ok: true; backup: TeacherFlowBackup; excludedCollections: ExcludedCollectionsSummary }
  | { ok: false; errors: BackupValidationError[] };

export interface ExcludedCollectionsSummary {
  studentStatusHistory: { count: number; reason: string };
  studentPriceHistory: { count: number; reason: string };
  lessonRegistrationEditHistory: { count: number; reason: string };
}

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const REQUIRED_V1_COLLECTIONS = [
  "students",
  "profiles",
  "pedagogicalLessons",
  "calendarLessons",
  "recurrenceRules",
  "recurrenceExceptions",
  "teacherAvailability",
] as const;

const REQUIRED_V2_COLLECTIONS = ["paymentCharges", "payments", "paymentAllocations", "paymentAdjustments"] as const;

const ARRAY_COLLECTIONS = [
  "students",
  "pedagogicalLessons",
  "calendarLessons",
  "recurrenceRules",
  "recurrenceExceptions",
  "paymentCharges",
  "payments",
  "paymentAllocations",
  "paymentAdjustments",
  "reportRecords",
  "packagePurchases",
  "packageCreditMovements",
  "monthlyAmountCorrections",
  "initialPaidSurchargeCorrections",
  "firstMonthProrationDecisions",
  "trainingBillingAgreements",
  "customLevels",
] as const;

function findDangerousKeysDeep(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findDangerousKeysDeep(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) return `${path}.${key}`;
      const found = findDangerousKeysDeep((value as Record<string, unknown>)[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return null;
}

function maxDepth(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length === 0 ? 1 : 1 + Math.max(...value.map(maxDepth));
  }
  if (value !== null && typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    return values.length === 0 ? 1 : 1 + Math.max(...values.map(maxDepth));
  }
  return 0;
}

/** Escanea TODO string del documento — nunca enumera campo por campo, así nunca deja un campo libre nuevo sin cubrir. */
function findOverlongString(value: unknown, path = "$"): string | null {
  if (typeof value === "string") {
    return value.length > BACKUP_IMPORT_LIMITS.MAX_FREE_TEXT_LENGTH ? path : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findOverlongString(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const found = findOverlongString((value as Record<string, unknown>)[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return null;
}

/** `YYYY-MM-DD` estricto, calendario real (no acepta `2026-02-30`). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** ISO datetime laxo — cualquier string parseable por `Date`, mismo criterio que el móvil. */
export function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(new Date(value).getTime());
}

function countRows(backup: Record<string, unknown>): { perCollection: Record<string, number>; total: number } {
  const perCollection: Record<string, number> = {};
  let total = 0;
  for (const key of ARRAY_COLLECTIONS) {
    const value = backup[key];
    const count = Array.isArray(value) ? value.length : 0;
    perCollection[key] = count;
    total += count;
  }
  return { perCollection, total };
}

export function validateBackupPayload(raw: unknown): BackupValidationResult {
  const errors: BackupValidationError[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "not_an_object", message: "El backup no es un objeto JSON válido." }] };
  }

  const sizeBytes = new TextEncoder().encode(JSON.stringify(raw)).length;
  if (sizeBytes > BACKUP_IMPORT_LIMITS.MAX_PAYLOAD_BYTES) {
    errors.push({ code: "too_large", message: `El backup supera el tamaño máximo permitido (${BACKUP_IMPORT_LIMITS.MAX_PAYLOAD_BYTES} bytes).` });
  }

  const depth = maxDepth(raw);
  if (depth > BACKUP_IMPORT_LIMITS.MAX_JSON_DEPTH) {
    errors.push({ code: "too_deep", message: `El backup tiene una estructura anidada más profunda de lo esperado (${depth} niveles).` });
  }

  const dangerousPath = findDangerousKeysDeep(raw);
  if (dangerousPath) {
    errors.push({ code: "dangerous_key", message: "El backup contiene una clave no permitida." });
  }

  const overlongPath = findOverlongString(raw);
  if (overlongPath) {
    errors.push({ code: "string_too_long", message: `Un campo de texto supera los ${BACKUP_IMPORT_LIMITS.MAX_FREE_TEXT_LENGTH} caracteres permitidos.`, path: overlongPath });
  }

  // Si alguno de los tres chequeos estructurales de arriba falló, no tiene
  // sentido seguir leyendo colecciones sobre un documento potencialmente
  // hostil — se corta acá, mismo criterio que el móvil.
  if (errors.length > 0) return { ok: false, errors };

  const doc = raw as Record<string, unknown>;

  const schemaVersion = doc.schemaVersion;
  if (schemaVersion !== BACKUP_SCHEMA_VERSION_V1 && schemaVersion !== BACKUP_SCHEMA_VERSION_V2) {
    errors.push({ code: "unknown_schema_version", message: "Versión de backup no reconocida." });
  }

  if (!("exportedAt" in doc) || !isIsoDateTime(doc.exportedAt)) {
    errors.push({ code: "missing_field", message: "Falta 'exportedAt' o no es una fecha válida.", path: "exportedAt" });
  }
  if (!("appVersion" in doc)) {
    errors.push({ code: "missing_field", message: "Falta 'appVersion'.", path: "appVersion" });
  }

  for (const key of REQUIRED_V1_COLLECTIONS) {
    if (!(key in doc)) errors.push({ code: "missing_field", message: `Falta la colección obligatoria '${key}'.`, path: key });
  }
  if (schemaVersion === BACKUP_SCHEMA_VERSION_V2) {
    for (const key of REQUIRED_V2_COLLECTIONS) {
      if (!(key in doc)) errors.push({ code: "missing_field", message: `Falta la colección obligatoria '${key}' (schemaVersion 2).`, path: key });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const { perCollection, total } = countRows(doc);
  for (const [key, count] of Object.entries(perCollection)) {
    if (count > BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION) {
      errors.push({ code: "too_many_rows", message: `'${key}' tiene ${count} filas, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION} por colección.`, path: key });
    }
  }
  if (total > BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL) {
    errors.push({ code: "too_many_rows_total", message: `El backup tiene ${total} filas en total, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL}.` });
  }

  if (errors.length > 0) return { ok: false, errors };

  // schemaVersion 1 -> se normaliza a v2 con las 4 colecciones financieras
  // vacías (mismo criterio que el móvil: nunca queda un "modo v1" después
  // de validar).
  const normalized: TeacherFlowBackup = {
    schemaVersion: 2,
    exportedAt: doc.exportedAt as string,
    appVersion: (doc.appVersion as string | null) ?? null,
    students: (doc.students as TeacherFlowBackup["students"]) ?? [],
    profiles: (doc.profiles as TeacherFlowBackup["profiles"]) ?? {},
    recurrenceRules: (doc.recurrenceRules as TeacherFlowBackup["recurrenceRules"]) ?? [],
    recurrenceExceptions: (doc.recurrenceExceptions as TeacherFlowBackup["recurrenceExceptions"]) ?? [],
    calendarLessons: (doc.calendarLessons as TeacherFlowBackup["calendarLessons"]) ?? [],
    teacherAvailability: (doc.teacherAvailability as TeacherFlowBackup["teacherAvailability"]) ?? null,
    pedagogicalLessons: (doc.pedagogicalLessons as TeacherFlowBackup["pedagogicalLessons"]) ?? [],
    paymentCharges: (doc.paymentCharges as TeacherFlowBackup["paymentCharges"]) ?? [],
    payments: (doc.payments as TeacherFlowBackup["payments"]) ?? [],
    paymentAllocations: (doc.paymentAllocations as TeacherFlowBackup["paymentAllocations"]) ?? [],
    paymentAdjustments: (doc.paymentAdjustments as TeacherFlowBackup["paymentAdjustments"]) ?? [],
    reportRecords: (doc.reportRecords as TeacherFlowBackup["reportRecords"]) ?? [],
    packagePurchases: (doc.packagePurchases as TeacherFlowBackup["packagePurchases"]) ?? [],
    packageCreditMovements: (doc.packageCreditMovements as TeacherFlowBackup["packageCreditMovements"]) ?? [],
    teacherProfile: (doc.teacherProfile as TeacherFlowBackup["teacherProfile"]) ?? null,
    monthlyAmountCorrections: (doc.monthlyAmountCorrections as TeacherFlowBackup["monthlyAmountCorrections"]) ?? [],
    initialPaidSurchargeCorrections: (doc.initialPaidSurchargeCorrections as TeacherFlowBackup["initialPaidSurchargeCorrections"]) ?? [],
    surchargeSettings: (doc.surchargeSettings as TeacherFlowBackup["surchargeSettings"]) ?? null,
    budgetDistribution: (doc.budgetDistribution as TeacherFlowBackup["budgetDistribution"]) ?? null,
    firstMonthProrationDecisions: (doc.firstMonthProrationDecisions as TeacherFlowBackup["firstMonthProrationDecisions"]) ?? [],
    trainingBillingAgreements: (doc.trainingBillingAgreements as TeacherFlowBackup["trainingBillingAgreements"]) ?? [],
    // Corrige un gap real del cliente móvil: se exporta pero el propio
    // restore del móvil nunca lo lee de vuelta (ver auditoría Fase 9).
    customLevels: (doc.customLevels as TeacherFlowBackup["customLevels"]) ?? [],
  };

  const profilesArray = Object.values(doc.profiles as Record<string, { statusHistory?: unknown[]; priceHistory?: unknown[] }>);
  const excludedCollections: ExcludedCollectionsSummary = {
    studentStatusHistory: {
      count: profilesArray.reduce((sum, p) => sum + (Array.isArray(p?.statusHistory) ? p.statusHistory.length : 0), 0),
      reason: "Sin clave de identidad estable todavía en el formato móvil (StatusHistoryEntry no tiene id) — excluida de Fase 9 v1.",
    },
    studentPriceHistory: {
      count: profilesArray.reduce((sum, p) => sum + (Array.isArray(p?.priceHistory) ? p.priceHistory.length : 0), 0),
      reason: "Sin clave de identidad estable todavía en el formato móvil (PriceHistoryEntry no tiene id) — excluida de Fase 9 v1.",
    },
    lessonRegistrationEditHistory: {
      count: 0, // el backup móvil no expone editHistory como colección propia contable sin recorrer cada lección; se documenta en 0 hasta que se decida importar (fuera de v1).
      reason: "Sin vía de escritura directa habilitada (RLS sólo SELECT) — excluida de Fase 9 v1.",
    },
  };

  return { ok: true, backup: normalized, excludedCollections };
}
