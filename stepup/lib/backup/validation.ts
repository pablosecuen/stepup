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
  // Con bucle y no con `Math.max(...hijos)`: un arreglo enorme revienta la pila antes de poder rechazarlo con un mensaje claro.
  if (Array.isArray(value)) {
    let deepest = 0;
    for (const item of value) {
      const depth = maxDepth(item);
      if (depth > deepest) deepest = depth;
    }
    return 1 + deepest;
  }
  if (value !== null && typeof value === "object") {
    let deepest = 0;
    for (const item of Object.values(value as Record<string, unknown>)) {
      const depth = maxDepth(item);
      if (depth > deepest) deepest = depth;
    }
    return 1 + deepest;
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

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Filas ANIDADAS que `countRows` no ve (lo que se escribe además de las filas principales): historial de niveles, integrantes de clases y de
 * series, y roster / asistencias / evaluaciones / revisiones de tarea de cada registro. Mismo criterio que `_import_check_payload` en la base.
 */
export function countNestedRows(backup: Record<string, unknown>): number {
  let nested = 0;
  const profiles = backup.profiles;
  if (profiles !== null && typeof profiles === "object" && !Array.isArray(profiles)) {
    for (const profile of Object.values(profiles as Record<string, unknown>)) {
      if (profile !== null && typeof profile === "object") nested += arrayLength((profile as Record<string, unknown>).levelHistory);
    }
  }
  const items = (key: string): Record<string, unknown>[] =>
    Array.isArray(backup[key]) ? (backup[key] as unknown[]).filter((x): x is Record<string, unknown> => x !== null && typeof x === "object") : [];
  for (const lesson of items("calendarLessons")) nested += arrayLength(lesson.participants);
  for (const rule of items("recurrenceRules")) nested += arrayLength(rule.participantStudentIds);
  for (const registration of items("pedagogicalLessons")) {
    nested += arrayLength(registration.roster) + arrayLength(registration.attendance) + arrayLength(registration.evaluations) + arrayLength(registration.homeworkReviews);
  }
  return nested;
}

function hasStringId(item: unknown): boolean {
  if (item === null || typeof item !== "object") return false;
  const id = (item as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() !== "";
}

function isObjectItem(item: unknown): boolean {
  return item !== null && typeof item === "object" && !Array.isArray(item);
}

/**
 * Rechazo TEMPRANO y barato (antes de serializar, medir profundidad o recorrer textos): colección que no es lista, cantidad de filas y de trabajo por
 * encima de los límites, elementos sin identificador y referencias obligatorias ausentes. La base repite estos mismos controles
 * (`_import_check_payload`) como defensa en profundidad.
 */
export function checkImportWorkLimits(doc: Record<string, unknown>): BackupValidationError[] {
  const errors: BackupValidationError[] = [];
  for (const key of ARRAY_COLLECTIONS) {
    const value = doc[key];
    if (value !== undefined && value !== null && !Array.isArray(value)) {
      errors.push({ code: "invalid_collection", message: "Una colección del backup no es una lista.", path: key });
    }
  }
  if (errors.length > 0) return errors;

  const { perCollection, total } = countRows(doc);
  for (const [key, count] of Object.entries(perCollection)) {
    if (count > BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION) {
      errors.push({ code: "too_many_rows", message: `'${key}' tiene ${count} filas, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION} por colección.`, path: key });
    }
  }
  if (total > BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL) {
    errors.push({ code: "too_many_rows_total", message: `El backup tiene ${total} filas en total, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL}.` });
  }
  if (errors.length > 0) return errors;

  const nested = countNestedRows(doc);
  if (nested > BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS) {
    errors.push({ code: "too_many_nested_rows", message: `El backup tiene ${nested} filas anidadas, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS}.` });
  } else if (total + nested > BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS) {
    errors.push({ code: "too_much_work", message: `El backup suma ${total + nested} filas entre principales y anidadas, supera el máximo de ${BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS}.` });
  }
  if (errors.length > 0) return errors;

  for (const key of ARRAY_COLLECTIONS) {
    const value = doc[key];
    if (!Array.isArray(value)) continue;
    const valid = key === "recurrenceExceptions" ? value.every(isObjectItem) : value.every(hasStringId);
    if (!valid) errors.push({ code: "invalid_item", message: "Un elemento del backup no tiene el formato esperado.", path: key });
  }
  const list = (key: string): Record<string, unknown>[] => (Array.isArray(doc[key]) ? (doc[key] as Record<string, unknown>[]) : []);
  if (list("paymentAllocations").some((a) => typeof a.paymentId !== "string" || typeof a.chargeId !== "string")) {
    errors.push({ code: "invalid_item", message: "Una asignación de pago no tiene el formato esperado.", path: "paymentAllocations" });
  }
  if (list("paymentAdjustments").some((a) => typeof a.chargeId !== "string")) {
    errors.push({ code: "invalid_item", message: "Un ajuste de cobro no tiene el formato esperado.", path: "paymentAdjustments" });
  }
  if (list("packageCreditMovements").some((m) => typeof m.packageId !== "string")) {
    errors.push({ code: "invalid_item", message: "Un movimiento de paquete no tiene el formato esperado.", path: "packageCreditMovements" });
  }
  return errors;
}

export function validateBackupPayload(raw: unknown): BackupValidationResult {
  const errors: BackupValidationError[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: "not_an_object", message: "El backup no es un objeto JSON válido." }] };
  }

  // Rechazo temprano y barato: cantidad de filas / trabajo y forma de los elementos, ANTES de serializar o recorrer el documento entero.
  const early = checkImportWorkLimits(raw as Record<string, unknown>);
  if (early.length > 0) return { ok: false, errors: early };

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

  // (Cantidad de filas y de trabajo: ya controlada al principio por `checkImportWorkLimits`, antes de recorrer el documento.)

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
