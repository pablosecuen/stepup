// Puerto VERBATIM del original (`src/shared/backup/restoreValidation.ts`): sólo se adaptan los imports (extensión .ts y `type`). Núcleo de dominio puro; no se modifica la lógica.
import type {
  CalendarLesson,
  RecurrenceException,
  RecurrenceRule,
} from '../../features/calendar/types/index.ts';
import type { TeacherAvailability } from '../../features/calendar/types/teacherAvailability.ts';
import type { SavedLesson } from '../../features/new-class/types/index.ts';
import type { StudentListItem } from '../../features/students/types/index.ts';
import type { StudentProfile } from '../../features/student-profile/types/index.ts';
import type {
  Payment,
  PaymentAdjustment,
  PaymentAllocation,
  PaymentCharge,
  PackageCreditMovement,
  PackagePurchase,
  MonthlyAmountCorrectionEntry,
  InitialPaidSurchargeCorrectionEntry,
  FirstMonthProrationDecision,
  TrainingBillingAgreement,
} from '../../features/payments/types/index.ts';
import { isValidBillingPeriod } from '../../features/payments/utils/paymentDates.ts';
import type { SurchargeSettings, SurchargeTierValues } from '../../features/payments/utils/surchargeSettings.ts';
import type { BudgetDistribution, BudgetDistributionSettings, SavingsGoal } from '../../features/payments/utils/budgetDistribution.ts';
import type { ReportRecord } from '../../features/reportes/types/index.ts';
import type { TeacherProfile } from '../../features/account/hooks/teacherProfileStore.ts';
import { BACKUP_SCHEMA_VERSION, BACKUP_SCHEMA_VERSION_V2, type TeacherFlowBackupV2 } from './backupTypes.ts';
import { normalizeLevelsList } from '../../features/students/utils/studentLevelsCore.ts';

/** Límite razonable para el contenido de un archivo de respaldo, en bytes UTF-8 reales. */
export const RESTORE_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

/**
 * `JSON.parse` nunca activa el setter de `__proto__`, pero una asignación
 * posterior por corchetes (`obj[key] = value` con `key === '__proto__'`)
 * sobre un objeto literal sí lo hace. Por eso se rechaza el archivo entero
 * apenas se detecta cualquiera de estas claves EN CUALQUIER NIVEL del
 * documento, antes de que ese contenido llegue a tocar ningún objeto real.
 */
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type RestoreValidationErrorCode =
  | 'too_large'
  | 'invalid_json'
  | 'not_an_object'
  | 'unknown_schema_version'
  | 'missing_field'
  | 'invalid_type'
  | 'dangerous_key';

export interface RestoreValidationError {
  code: RestoreValidationErrorCode;
  /** Nombre técnico del campo afectado (students, profiles, ...). Nunca un dato personal. */
  field?: string;
  message: string;
}

/**
 * El resultado siempre trae un `backup` con forma v2 (con las cuatro
 * colecciones financieras, vacías si el archivo era v1): la migración v1→v2
 * ocurre acá mismo, no en un paso separado. Ver `validateBackupFileContents`.
 */
export type RestoreValidationResult =
  | { ok: true; backup: TeacherFlowBackupV2 }
  | { ok: false; errors: RestoreValidationError[] };

// ---------------------------------------------------------------------------
// Utilidades de tamaño (compatibles con Node y con Hermes/React Native, sin
// depender de `Buffer` ni de `TextEncoder`, que no están garantizados en RN).
// ---------------------------------------------------------------------------

/**
 * Cantidad real de bytes UTF-8 de un string, calculada a mano a partir de
 * sus unidades UTF-16 (igual que haría `TextEncoder`, pero portable). Los
 * pares subrogantes (usados por emojis y otros caracteres fuera del plano
 * básico) cuentan como 4 bytes; los caracteres acentuados de 1 o 2 bytes
 * cuentan 2; el resto del plano básico cuenta 3.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
        continue;
      }
    }
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Primitivas de tipo
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isIsoDateTime(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function isNullableIsoDateTime(value: unknown): boolean {
  return value === null || isIsoDateTime(value);
}

/** Fecha local YYYY-MM-DD (reglas de recurrencia, disponibilidad). */
function isDateKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** Hora local HH:mm (bloques/excepciones de disponibilidad, form de clase). */
function isTimeKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function isWeekday(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

function isHour(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isMinute(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 59;
}

// ---------------------------------------------------------------------------
// Enums reales del dominio (ver src/features/*/types)
// ---------------------------------------------------------------------------

const STUDENT_MODALITIES = new Set(['presencial', 'online', 'mixta']);
const PAYMENT_STATUSES = new Set(['verde', 'amarillo', 'naranja', 'rojo']);
const STUDENT_STATUSES = new Set(['activo', 'pausado', 'inactivo', 'archivado']);
const STUDENT_CATEGORIES = new Set([
  'primaria',
  'secundaria',
  'profesorado_ingles',
  'universitario',
  'adulto_interes_personal',
  'adulto_laboral',
  'examen_internacional',
  'apoyo_escolar',
  'otro',
]);
const BILLING_TYPES = new Set(['por_clase', 'mensual']);
const EVENT_TYPES = new Set([
  'clase_dictada',
  'alumno_ausente',
  'profesora_ausente',
  'cancelada_con_aviso',
  'cancelada_tarde',
  'reprogramada',
  'feriado',
]);
const LATE_CANCELLATION_POLICIES = new Set([
  'cobrar_100',
  'cobrar_porcentaje',
  'descontar_del_paquete',
  'no_cobrar',
]);
/**
 * Corrección 2026-09-05 (a pedido de Joaquín — Entrenamientos): allowlist
 * del campo opcional `activityKind` — mismo criterio que `EVENT_TYPES`.
 * Ausente (backup histórico anterior a esta fase) o cualquier valor no
 * reconocido se interpreta como `'class'` en memoria (`normalizeActivityKind`,
 * `calendarActivityKind.ts`) — nunca se rechaza el backup por esto.
 */
const ACTIVITY_KINDS = new Set(['class', 'training']);
const CALENDAR_LESSON_STATUSES = new Set(['scheduled', 'completed', 'cancelled', 'rescheduled']);
const CALENDAR_LESSON_TYPES = new Set(['individual', 'group']);
const RECURRENCE_RULE_TYPES = new Set(['weekly', 'custom']);
const CYCLE_LENGTHS = new Set([1, 2, 3, 4]);
const RECURRENCE_RULE_STATUSES = new Set(['active', 'paused', 'ended']);
const RECURRENCE_EXCEPTION_TYPES = new Set(['cancelled', 'rescheduled', 'excluded']);
const AVAILABILITY_BLOCK_REASONS = new Set(['work', 'study', 'personal', 'other']);
const AVAILABILITY_EXCEPTION_REASONS = new Set(['vacation', 'holiday', 'leave', 'other']);
const AVAILABILITY_EXCEPTION_TYPES = new Set([
  'unavailable_full_day',
  'unavailable_block',
  'available_extra',
]);
const SKILLS = new Set([
  'speaking',
  'listening',
  'reading',
  'writing',
  'grammar',
  'vocabulary',
  'pronunciation',
  'participation',
]);

// ---------------------------------------------------------------------------
// Claves peligrosas — recursivo sobre todo el documento
// ---------------------------------------------------------------------------

/**
 * Recorre TODO el documento (no sólo `profiles`) buscando `__proto__`,
 * `constructor` o `prototype` como clave propia de cualquier objeto, a
 * cualquier profundidad. Devuelve rutas técnicas (nombres de campo e
 * índices de array) — nunca el valor asociado a la clave encontrada.
 */
export function findDangerousKeysDeep(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findDangerousKeysDeep(item, `${path}[${index}]`));
  }
  if (!isPlainObject(value)) return [];

  const found: string[] = [];
  Object.keys(value).forEach((key) => {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      found.push(path ? `${path}.${key}` : key);
    }
  });
  Object.entries(value).forEach(([key, nested]) => {
    found.push(...findDangerousKeysDeep(nested, path ? `${path}.${key}` : key));
  });
  return found;
}

// ---------------------------------------------------------------------------
// Validadores profundos por tipo real
// ---------------------------------------------------------------------------

/**
 * Corrección (a pedido de Joaquín — niveles combinables, y arreglo de un
 * gap real introducido por "niveles personalizados"): antes se exigía
 * `CEFR_LEVELS.has(...)` — SÓLO A1-C2 — para `level`/`initialLevel`/
 * `levelHistory[].level`/`fromLevel`. Eso rechazaba de entrada cualquier
 * respaldo con un alumno que ya tuviera un nivel propio (p. ej.
 * "Infantes"), sin que nadie lo hubiera notado (nunca se restauró un
 * respaldo real con niveles personalizados hasta ahora). Ahora acepta
 * cualquier string no vacío — la validación real de nombre/duplicado/
 * nivel reservado vive en `customLevelsCore.ts`, nunca acá.
 */
function isValidLevelValue(value: unknown): boolean {
  return isNonEmptyString(value);
}

/**
 * Acepta la forma nueva (`levels: string[]`, cada ítem un string no vacío)
 * O la vieja (`level: string`, de antes de "niveles combinables") — un
 * respaldo exportado antes de esta corrección sigue restaurando sin
 * rechazarse. La normalización real a `levels: string[]` ocurre después,
 * al construir el `backup` final (`normalizeLevelsList`) — acá sólo se
 * valida la forma.
 */
function hasValidLevelsField(value: Record<string, unknown>): boolean {
  if (value.levels !== undefined) {
    return Array.isArray(value.levels) && value.levels.every(isValidLevelValue);
  }
  return isValidLevelValue(value.level);
}

/**
 * Ya validada la forma (`hasValidLevelsField`), acá se normaliza de verdad
 * a `levels: string[]` — un respaldo viejo con `level: string` singular se
 * migra en el momento, nunca queda con la forma vieja una vez que pasa la
 * validación.
 */
function normalizeLevelsFieldForRestore<T extends { level?: unknown; levels?: unknown }>(
  value: T
): Omit<T, 'level' | 'levels'> & { levels: string[] } {
  const { level, levels, ...rest } = value;
  return { ...rest, levels: normalizeLevelsList(levels, level) } as Omit<T, 'level' | 'levels'> & { levels: string[] };
}

function isValidStudent(value: unknown): value is StudentListItem {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    hasValidLevelsField(value) &&
    isString(value.modality) &&
    STUDENT_MODALITIES.has(value.modality) &&
    isString(value.status) &&
    STUDENT_STATUSES.has(value.status) &&
    isNullableIsoDateTime(value.nextClassAt) &&
    isString(value.paymentStatus) &&
    PAYMENT_STATUSES.has(value.paymentStatus) &&
    isNullableFiniteNumber(value.averageGrade) &&
    isNonNegativeInteger(value.classesThisMonth) &&
    isNullableIsoDateTime(value.lastPaymentAt) &&
    isBoolean(value.isFeatured) &&
    isBoolean(value.isNew) &&
    isBoolean(value.hasOverduePayment) &&
    isBoolean(value.hasPendingReport) &&
    isBoolean(value.hasPendingHomework)
  );
}

function isValidStatusHistoryEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isString(value.status) &&
    STUDENT_STATUSES.has(value.status) &&
    isIsoDateTime(value.date) &&
    isOptionalString(value.reason) &&
    isOptionalString(value.internalNote)
  );
}

/**
 * Corrección 2026-08-03 (a pedido de Joaquín — registrar logros de nivel en
 * Progreso): `level`/`date` siguen siendo obligatorios (comportamiento sin
 * cambios). Los campos nuevos (`id`/`fromLevel`/`recordedAt`/
 * `previousMilestoneAt`/`durationDays`/`note`/`origin`) son TODOS
 * opcionales — un respaldo tomado ANTES de esta corrección nunca los tiene,
 * y debe seguir restaurando sin rechazarse por eso (mismo criterio ya
 * usado acá para `reportRecords`/`packagePurchases`: nunca `requireField`
 * para un campo nuevo).
 */
function isValidLevelHistoryEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isValidLevelValue(value.level) &&
    isIsoDateTime(value.date) &&
    isOptionalString(value.id) &&
    (value.fromLevel === undefined || value.fromLevel === null || isValidLevelValue(value.fromLevel)) &&
    (value.recordedAt === undefined || isIsoDateTime(value.recordedAt)) &&
    (value.previousMilestoneAt === undefined || isNullableIsoDateTime(value.previousMilestoneAt)) &&
    (value.durationDays === undefined || isNullableFiniteNumber(value.durationDays)) &&
    isOptionalString(value.note) &&
    (value.origin === undefined || value.origin === 'manual')
  );
}

function isValidPriceHistoryEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isFiniteNumber(value.price) && isIsoDateTime(value.date);
}

function isValidSkillGradesHistoryEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isIsoDateTime(value.date)) return false;
  if (!isPlainObject(value.grades)) return false;
  return Object.values(value.grades).every((grade) => isFiniteNumber(grade));
}

function isValidProfile(value: unknown): value is StudentProfile {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isOptionalString(value.phone) &&
    isOptionalString(value.whatsapp) &&
    isOptionalString(value.email) &&
    (value.usualDays === undefined || isStringArray(value.usualDays)) &&
    isOptionalString(value.usualTime) &&
    isOptionalString(value.notes) &&
    (value.birthDate === undefined || isIsoDateTime(value.birthDate)) &&
    hasValidLevelsField(value) &&
    isValidLevelValue(value.initialLevel) &&
    isString(value.modality) &&
    STUDENT_MODALITIES.has(value.modality) &&
    isString(value.status) &&
    STUDENT_STATUSES.has(value.status) &&
    isString(value.category) &&
    STUDENT_CATEGORIES.has(value.category) &&
    isString(value.billingType) &&
    BILLING_TYPES.has(value.billingType) &&
    isIsoDateTime(value.dateJoined) &&
    isNullableIsoDateTime(value.lastReactivatedAt) &&
    isNullableIsoDateTime(value.statusChangeDate) &&
    isPositiveInteger(value.usualDurationMinutes) &&
    isNonNegativeInteger(value.weeklyFrequency) &&
    isFiniteNumber(value.price) &&
    isNullableFiniteNumber(value.averageGrade) &&
    isNonNegativeInteger(value.classesThisMonth) &&
    isFiniteNumber(value.attendanceRate) &&
    isString(value.paymentStatus) &&
    PAYMENT_STATUSES.has(value.paymentStatus) &&
    isNullableIsoDateTime(value.nextClassAt) &&
    isNullableIsoDateTime(value.lastClassAt) &&
    isNullableString(value.pendingHomework) &&
    isStringArray(value.alerts) &&
    isStringArray(value.currentGoals) &&
    isStringArray(value.strengths) &&
    isStringArray(value.areasToImprove) &&
    isNonNegativeInteger(value.totalClasses) &&
    isFiniteNumber(value.totalHoursTaken) &&
    isFiniteNumber(value.totalInvested) &&
    Array.isArray(value.statusHistory) &&
    value.statusHistory.every(isValidStatusHistoryEntry) &&
    Array.isArray(value.levelHistory) &&
    value.levelHistory.every(isValidLevelHistoryEntry) &&
    Array.isArray(value.priceHistory) &&
    value.priceHistory.every(isValidPriceHistoryEntry) &&
    Array.isArray(value.skillGradesHistory) &&
    value.skillGradesHistory.every(isValidSkillGradesHistoryEntry)
  );
}

function isValidAttendanceEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.studentId) && isBoolean(value.present);
}

const TOPIC_STATUSES = new Set(['planificado', 'visto']);

/**
 * Corrección crítica 2026-07-23 (a pedido de Joaquín — protección integral de
 * datos, auditoría previa): `NewClassFormState` reemplazó `topicPlanned`/
 * `topicCovered` por una lista de temas desde la corrección del 2026-07-16
 * ("Contenido pedagógico"). `isValidNewClassFormState` seguía validando los
 * campos viejos, que ya no existen en ningún registro real — el resultado
 * era que CUALQUIER respaldo con al menos una clase en el formato vigente
 * rechazaba el documento COMPLETO (las 11 colecciones de negocio, no sólo
 * `pedagogicalLessons`). Nunca detectado antes porque no había ninguna
 * prueba que usara el formato real de `topics`/`activityNotes`/
 * `activityAttachments`/`materialIds` — los dos fixtures "réplica de
 * producción" en `restoreValidation.test.ts` usaban por error los campos
 * viejos también.
 */
function isValidTopicEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.id) && isString(value.text) && isString(value.status) && TOPIC_STATUSES.has(value.status);
}

const LESSON_ATTACHMENT_KINDS = new Set(['pdf', 'image']);

/** `kind`/`mimeType`/`sizeBytes`/`caption`/`studentId` opcionales a propósito — ver comentario en `LessonAttachment` (types/index.ts). */
function isValidLessonAttachment(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.kind !== undefined && (!isString(value.kind) || !LESSON_ATTACHMENT_KINDS.has(value.kind))) return false;
  if (value.mimeType !== undefined && !isString(value.mimeType)) return false;
  if (value.sizeBytes !== undefined && !isFiniteNumber(value.sizeBytes)) return false;
  if (value.caption !== undefined && !isString(value.caption)) return false;
  if (value.studentId !== undefined && !isString(value.studentId)) return false;
  return isNonEmptyString(value.id) && isString(value.name) && isString(value.uri) && isIsoDateTime(value.addedAt);
}

function isValidEvaluationEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.studentId)) return false;
  if (!isNullableFiniteNumber(value.generalGrade)) return false;
  if (!isPlainObject(value.skillGrades)) return false;
  if (!Object.entries(value.skillGrades).every(([key, grade]) => SKILLS.has(key) && isFiniteNumber(grade))) {
    return false;
  }
  return isStringArray(value.strengths) && isStringArray(value.areasToImprove);
}

/**
 * `homeworkDueDate` se valida sólo como `string | null`, sin exigir un
 * formato de fecha: en respaldos reales generados por la app puede
 * contener texto libre no-ISO (ver AI_CONTEXT). Exigir un formato acá
 * rechazaría respaldos reales válidos.
 */
function isValidNewClassFormState(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isString(value.eventType) &&
    EVENT_TYPES.has(value.eventType) &&
    Array.isArray(value.studentIds) &&
    value.studentIds.length > 0 &&
    isStringArray(value.studentIds) &&
    isDateKey(value.date) &&
    isTimeKey(value.time) &&
    isPositiveInteger(value.scheduledDurationMinutes) &&
    (value.actualDurationMinutes === null || isPositiveInteger(value.actualDurationMinutes)) &&
    isString(value.modality) &&
    STUDENT_MODALITIES.has(value.modality) &&
    Array.isArray(value.attendance) &&
    value.attendance.every(isValidAttendanceEntry) &&
    Array.isArray(value.topics) &&
    value.topics.every(isValidTopicEntry) &&
    isStringArray(value.objectives) &&
    isStringArray(value.activities) &&
    isString(value.activityNotes) &&
    Array.isArray(value.activityAttachments) &&
    value.activityAttachments.every(isValidLessonAttachment) &&
    isStringArray(value.materialIds) &&
    Array.isArray(value.evaluations) &&
    value.evaluations.every(isValidEvaluationEntry) &&
    isString(value.internalNotes) &&
    isString(value.homeworkDescription) &&
    isNullableString(value.homeworkDueDate) &&
    isBoolean(value.isBillable) &&
    (value.lateCancellationPolicy === null ||
      (isString(value.lateCancellationPolicy) && LATE_CANCELLATION_POLICIES.has(value.lateCancellationPolicy))) &&
    (value.lateCancellationPercentage === null || isFiniteNumber(value.lateCancellationPercentage)) &&
    isBoolean(value.consumesMonthlyPackage) &&
    isBoolean(value.holidayException) &&
    isNullableString(value.rescheduledFromLessonId) &&
    (value.activityKind === undefined || (isString(value.activityKind) && ACTIVITY_KINDS.has(value.activityKind)))
  );
}

function isValidCalendarLessonRegistration(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.reservationKey) &&
    isNonEmptyString(value.lessonId) &&
    isNonEmptyString(value.studentId) &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    isString(value.modality) &&
    STUDENT_MODALITIES.has(value.modality) &&
    (value.recurrenceId === null || isNonEmptyString(value.recurrenceId)) &&
    (value.recurrenceOccurrenceKey === null || isNonEmptyString(value.recurrenceOccurrenceKey))
  );
}

const STUDENT_ARRIVAL_STATUSES = new Set([
  'on_time',
  'within_grace',
  'late',
  'teacher_delayed',
  'mutual_adjustment',
  'unknown',
  'no_show',
]);
const CLASS_SESSION_SOURCES = new Set(['button', 'manual_correction']);

/** Opcional a propósito: una clase anterior a esta fase no lo tiene. */
function isValidStudentArrival(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    (value.arrivedAt === undefined || isIsoDateTime(value.arrivedAt)) &&
    isString(value.status) &&
    STUDENT_ARRIVAL_STATUSES.has(value.status) &&
    isFiniteNumber(value.lateMinutes) &&
    isBoolean(value.manuallyCorrected)
  );
}

/**
 * Corrección 2026-08-07 (a pedido de Joaquín — PROBLEMA 2: editar una
 * clase ya registrada): `updatedAt`/`editHistory` son campos NUEVOS,
 * ambos opcionales — un respaldo tomado antes de esta corrección nunca los
 * trae y debe seguir restaurando exactamente igual (nunca `requireField`
 * para un campo nuevo, mismo criterio ya usado en todo este archivo).
 * Cada entrada de `editHistory` reutiliza `isValidNewClassFormState` (el
 * mismo validador del `form` principal) para su `previousForm` — nunca un
 * validador paralelo.
 */
function isValidLessonEditAuditEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isIsoDateTime(value.editedAt) &&
    isValidNewClassFormState(value.previousForm) &&
    isBoolean(value.previousCountsAsClass) &&
    isNullableFiniteNumber(value.previousBilledAmount) &&
    (value.previousAppliedPolicy === null ||
      (isString(value.previousAppliedPolicy) && LATE_CANCELLATION_POLICIES.has(value.previousAppliedPolicy)))
  );
}

const HOMEWORK_REVIEW_OUTCOMES = new Set(['realizada', 'parcial', 'no_realizada', 'ya_no_corresponde']);

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — FASE 3: ciclo real de
 * tareas pendientes): `homeworkReviews` es un campo NUEVO, opcional —
 * mismo criterio que `editHistory` — un respaldo tomado antes de esta
 * fase nunca lo trae y debe seguir restaurando exactamente igual.
 */
function isValidHomeworkReviewEntry(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.taskId) &&
    isNonEmptyString(value.studentId) &&
    isString(value.outcome) &&
    HOMEWORK_REVIEW_OUTCOMES.has(value.outcome) &&
    isIsoDateTime(value.reviewedAt)
  );
}

function isValidSavedLesson(value: unknown): value is SavedLesson {
  if (!isPlainObject(value)) return false;
  if (value.scheduleAdjustment !== undefined && !isValidScheduleAdjustment(value.scheduleAdjustment)) return false;
  if (value.studentArrival !== undefined && !isValidStudentArrival(value.studentArrival)) return false;
  if (value.startSource !== undefined && (!isString(value.startSource) || !CLASS_SESSION_SOURCES.has(value.startSource))) {
    return false;
  }
  if (value.endSource !== undefined && (!isString(value.endSource) || !CLASS_SESSION_SOURCES.has(value.endSource))) {
    return false;
  }
  if (value.updatedAt !== undefined && !isIsoDateTime(value.updatedAt)) return false;
  if (value.editHistory !== undefined && (!Array.isArray(value.editHistory) || !value.editHistory.every(isValidLessonEditAuditEntry))) {
    return false;
  }
  if (
    value.homeworkReviews !== undefined &&
    (!Array.isArray(value.homeworkReviews) || !value.homeworkReviews.every(isValidHomeworkReviewEntry))
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isIsoDateTime(value.createdAt) &&
    isValidNewClassFormState(value.form) &&
    isBoolean(value.countsAsClass) &&
    isNullableFiniteNumber(value.billedAmount) &&
    (value.appliedPolicy === null ||
      (isString(value.appliedPolicy) && LATE_CANCELLATION_POLICIES.has(value.appliedPolicy))) &&
    isOptionalString(value.calendarReservationKey) &&
    isOptionalString(value.calendarLessonId) &&
    (value.calendarRegistration === undefined || isValidCalendarLessonRegistration(value.calendarRegistration)) &&
    (value.profileAppliedAt === undefined ||
      value.profileAppliedAt === null ||
      isIsoDateTime(value.profileAppliedAt)) &&
    (value.scheduledStartAt === undefined || isIsoDateTime(value.scheduledStartAt)) &&
    (value.effectiveStartAt === undefined || isIsoDateTime(value.effectiveStartAt)) &&
    (value.actualStartedAt === undefined || isIsoDateTime(value.actualStartedAt)) &&
    (value.actualEndedAt === undefined || isIsoDateTime(value.actualEndedAt)) &&
    (value.sessionUpdatedAt === undefined || isIsoDateTime(value.sessionUpdatedAt))
  );
}

function isValidCalendarParticipant(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isNonEmptyString(value.studentId) && isNonEmptyString(value.studentName) && isString(value.level);
}

const SCHEDULE_ADJUSTMENT_DIRECTIONS = new Set(['advanced', 'delayed']);
const SCHEDULE_ADJUSTMENT_MINUTES = new Set([15, 20, 30, 40, 50, 60]);
const SCHEDULE_ADJUSTMENT_REASONS = new Set(['teacher', 'mutual_agreement']);

/** Opcional a propósito: una clase anterior a esta fase no lo tiene. */
function isValidScheduleAdjustment(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isString(value.direction) &&
    SCHEDULE_ADJUSTMENT_DIRECTIONS.has(value.direction) &&
    typeof value.minutes === 'number' &&
    SCHEDULE_ADJUSTMENT_MINUTES.has(value.minutes) &&
    isString(value.reason) &&
    SCHEDULE_ADJUSTMENT_REASONS.has(value.reason) &&
    isIsoDateTime(value.adjustedAt)
  );
}

function isValidCalendarLesson(value: unknown): value is CalendarLesson {
  if (!isPlainObject(value)) return false;
  if (value.scheduleAdjustment !== undefined && !isValidScheduleAdjustment(value.scheduleAdjustment)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    isNonEmptyString(value.studentName) &&
    isString(value.level) &&
    Array.isArray(value.participants) &&
    value.participants.length > 0 &&
    value.participants.every(isValidCalendarParticipant) &&
    isString(value.lessonType) &&
    CALENDAR_LESSON_TYPES.has(value.lessonType) &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    isString(value.modality) &&
    STUDENT_MODALITIES.has(value.modality) &&
    isString(value.status) &&
    CALENDAR_LESSON_STATUSES.has(value.status) &&
    isNonEmptyString(value.color) &&
    isBoolean(value.overlapAllowed) &&
    (value.overlapGroupId === null || isNonEmptyString(value.overlapGroupId)) &&
    isOptionalString(value.notes) &&
    isBoolean(value.isRecurring) &&
    (value.recurrenceId === null || isNonEmptyString(value.recurrenceId)) &&
    (value.recurrenceOccurrenceKey === null || isNonEmptyString(value.recurrenceOccurrenceKey)) &&
    (value.recurrenceIndex === null || isFiniteNumber(value.recurrenceIndex)) &&
    (value.recurrenceOriginalStart === null || isIsoDateTime(value.recurrenceOriginalStart)) &&
    isOptionalString(value.classTitle) &&
    (value.activityKind === undefined || (isString(value.activityKind) && ACTIVITY_KINDS.has(value.activityKind)))
  );
}

function isValidRecurrenceSession(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isWeekday(value.weekday) && isHour(value.hour) && isMinute(value.minute) && isPositiveInteger(value.durationMinutes)
  );
}

/**
 * Corrección 2026-08-16 (a pedido de Joaquín — E01, auditoría de simulación
 * anual): una semana del ciclo puede legítimamente no tener ninguna sesión
 * (`sessions: []`) — es la única forma correcta de representar "clase
 * quincenal"/"cada 3 o 4 semanas" en el modelo de ciclo (ver
 * `assertRecurrenceRule` en `calendarRecurrenceEngine.ts`, que ya lo
 * permite y lo genera). Antes acá se exigía `sessions.length > 0` por
 * semana — más estricto que el propio motor que crea estos datos — y
 * cualquier alumno con ese patrón real hacía que el respaldo COMPLETO del
 * dispositivo se rechazara al restaurar. Que el CICLO tenga al menos una
 * sesión real se sigue exigiendo, pero a nivel de regla completa (ver
 * `isValidRecurrenceRule`), nunca por semana individual.
 */
function isValidRecurrenceWeek(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonNegativeInteger(value.weekIndex) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isValidRecurrenceSession)
  );
}

function isValidRecurrenceRule(value: unknown): value is RecurrenceRule {
  if (!isPlainObject(value)) return false;
  if (
    !isNonEmptyString(value.recurrenceId) ||
    !isNonEmptyString(value.studentId) ||
    !isString(value.type) ||
    !RECURRENCE_RULE_TYPES.has(value.type) ||
    typeof value.cycleLengthWeeks !== 'number' ||
    !CYCLE_LENGTHS.has(value.cycleLengthWeeks) ||
    !Array.isArray(value.weeks) ||
    value.weeks.length !== value.cycleLengthWeeks ||
    !value.weeks.every(isValidRecurrenceWeek) ||
    !isString(value.modality) ||
    !STUDENT_MODALITIES.has(value.modality) ||
    !isNonEmptyString(value.timezone) ||
    !isDateKey(value.startDate) ||
    !(value.endDate === null || isDateKey(value.endDate)) ||
    !isString(value.status) ||
    !RECURRENCE_RULE_STATUSES.has(value.status) ||
    !(value.supersedesRecurrenceId === undefined ||
      value.supersedesRecurrenceId === null ||
      isNonEmptyString(value.supersedesRecurrenceId)) ||
    !(value.supersededByRecurrenceId === undefined ||
      value.supersededByRecurrenceId === null ||
      isNonEmptyString(value.supersededByRecurrenceId)) ||
    !(value.effectiveFromDate === undefined || isDateKey(value.effectiveFromDate)) ||
    !isOptionalString(value.classTitle) ||
    !(value.activityKind === undefined || (isString(value.activityKind) && ACTIVITY_KINDS.has(value.activityKind))) ||
    // Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
    // ENTRENAMIENTOS): identidad estable del acuerdo de cobro de la serie —
    // opcional, mismo criterio que `classTitle`.
    !isOptionalString(value.trainingBillingAgreementId)
  ) {
    return false;
  }

  const weeks = value.weeks as Array<{ weekIndex: number; sessions: unknown[] }>;

  // weekIndex único y cubre exactamente 0..cycleLengthWeeks-1 — mismo
  // criterio que `assertRecurrenceRule` (nunca dos semanas con el mismo
  // índice, ni un índice fuera del ciclo declarado).
  const weekIndexes = new Set(weeks.map((week) => week.weekIndex));
  if (weekIndexes.size !== value.cycleLengthWeeks) return false;
  for (let index = 0; index < value.cycleLengthWeeks; index += 1) {
    if (!weekIndexes.has(index)) return false;
  }

  // Corrección E01: al menos UNA sesión real en TODO el ciclo — una regla
  // con todas las semanas vacías nunca es una serie válida (no representa
  // ninguna clase real).
  const hasAtLeastOneSession = weeks.some((week) => week.sessions.length > 0);
  if (!hasAtLeastOneSession) return false;

  return true;
}

function isValidRecurrenceException(value: unknown): value is RecurrenceException {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.occurrenceKey) &&
    isNonEmptyString(value.recurrenceId) &&
    isString(value.type) &&
    RECURRENCE_EXCEPTION_TYPES.has(value.type) &&
    isOptionalString(value.replacementLessonId) &&
    isIsoDateTime(value.createdAt)
  );
}

function isValidWeeklyBlock(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isWeekday(value.weekday) &&
    isTimeKey(value.startTime) &&
    isTimeKey(value.endTime) &&
    isString(value.reason) &&
    AVAILABILITY_BLOCK_REASONS.has(value.reason) &&
    isOptionalString(value.note)
  );
}

function isValidAvailabilityException(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isDateKey(value.date) &&
    (value.endDate === undefined || isDateKey(value.endDate)) &&
    isString(value.type) &&
    AVAILABILITY_EXCEPTION_TYPES.has(value.type) &&
    (value.startTime === undefined || isTimeKey(value.startTime)) &&
    (value.endTime === undefined || isTimeKey(value.endTime)) &&
    isString(value.reason) &&
    AVAILABILITY_EXCEPTION_REASONS.has(value.reason) &&
    isOptionalString(value.note)
  );
}

function isValidTeacherAvailability(value: unknown): value is TeacherAvailability | null {
  if (value === null) return true; // el contrato permite null si el original estaba corrupto
  if (!isPlainObject(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.timezone) &&
    Array.isArray(value.weeklyBlocks) &&
    value.weeklyBlocks.every(isValidWeeklyBlock) &&
    Array.isArray(value.exceptions) &&
    value.exceptions.every(isValidAvailabilityException)
  );
}

// ---------------------------------------------------------------------------
// Validadores profundos — colecciones financieras (Fase 4A, sólo en v2)
// ---------------------------------------------------------------------------

const PAYMENT_CHARGE_TYPES = new Set(['mensual', 'por_clase', 'entrenamiento']);
const PAYMENT_METHODS = new Set(['efectivo', 'transferencia', 'otro']);

function isValidPaymentCharge(value: unknown): value is PaymentCharge {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    isString(value.type) &&
    PAYMENT_CHARGE_TYPES.has(value.type) &&
    isFiniteNumber(value.originalAmount) &&
    value.currency === 'ARS' &&
    isDateKey(value.dueDate) &&
    isIsoDateTime(value.createdAt) &&
    (value.billingPeriod === undefined ||
      (typeof value.billingPeriod === 'string' && isValidBillingPeriod(value.billingPeriod))) &&
    (value.savedLessonId === undefined || isNonEmptyString(value.savedLessonId)) &&
    (value.calendarLessonId === undefined ||
      value.calendarLessonId === null ||
      isNonEmptyString(value.calendarLessonId)) &&
    // Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
    // ENTRENAMIENTOS): sólo para type: 'entrenamiento' — opcionales acá
    // porque cualquier cargo de un tipo anterior a esta fase nunca los tiene.
    (value.trainingBillingAgreementId === undefined || isNonEmptyString(value.trainingBillingAgreementId)) &&
    (value.trainingSeriesName === undefined || isNonEmptyString(value.trainingSeriesName)) &&
    isNullableString(value.voidedAt) &&
    isNullableString(value.voidReason)
  );
}

function isValidPayment(value: unknown): value is Payment {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    isFiniteNumber(value.amount) &&
    value.amount > 0 &&
    value.currency === 'ARS' &&
    isString(value.method) &&
    PAYMENT_METHODS.has(value.method) &&
    isDateKey(value.paidAt) &&
    isIsoDateTime(value.recordedAt) &&
    isOptionalString(value.notes) &&
    isNullableString(value.voidedAt) &&
    isNullableString(value.voidReason) &&
    (value.replacesPaymentId === undefined ||
      value.replacesPaymentId === null ||
      isNonEmptyString(value.replacesPaymentId))
  );
}

function isValidPaymentAllocation(value: unknown): value is PaymentAllocation {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.paymentId) &&
    isNonEmptyString(value.chargeId) &&
    isNonEmptyString(value.studentId) &&
    isFiniteNumber(value.amount) &&
    value.amount > 0
  );
}

function isValidPaymentAdjustment(value: unknown): value is PaymentAdjustment {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.chargeId) &&
    isNonEmptyString(value.studentId) &&
    isNonEmptyString(value.reason) &&
    isIsoDateTime(value.createdAt) &&
    isNullableString(value.voidedAt) &&
    isNullableString(value.voidReason)
  );
}

// ---------------------------------------------------------------------------
// Validadores — paquetes de clases (corrección 2026-07-21, clase como
// contenedor: campos OPCIONALES, un respaldo v2 anterior a esta fase no
// los tiene, mismo criterio que reportRecords más abajo).
// ---------------------------------------------------------------------------

const PACKAGE_CREDIT_MOVEMENT_TYPES = new Set(['consumo', 'ajuste_manual']);

function isValidPackagePurchase(value: unknown): value is PackagePurchase {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    isFiniteNumber(value.includedClasses) &&
    isFiniteNumber(value.amount) &&
    isDateKey(value.validFrom) &&
    (value.validUntil === undefined || isDateKey(value.validUntil)) &&
    isIsoDateTime(value.createdAt) &&
    isNullableString(value.voidedAt) &&
    isNullableString(value.voidReason)
  );
}

function isValidPackageCreditMovement(value: unknown): value is PackageCreditMovement {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.packageId) &&
    isNonEmptyString(value.studentId) &&
    isString(value.type) &&
    PACKAGE_CREDIT_MOVEMENT_TYPES.has(value.type) &&
    isFiniteNumber(value.amount) &&
    (value.savedLessonId === undefined || isNonEmptyString(value.savedLessonId)) &&
    (value.reason === undefined || isString(value.reason)) &&
    isIsoDateTime(value.createdAt) &&
    isNullableString(value.voidedAt) &&
    isNullableString(value.voidReason)
  );
}

// ---------------------------------------------------------------------------
// Validadores profundos — historial de reportes (segunda ronda 2026-07-18,
// sólo en v2, campo OPCIONAL: un respaldo v2 anterior a esta fase no lo tiene)
// ---------------------------------------------------------------------------

const EVIDENCE_KINDS = new Set(['pdf', 'image']);

/** Mes YYYY-MM (distinto de `isDateKey`: sin día). */
function isMonthKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  return true;
}

function isValidStudentReportPeriod(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isDateKey(value.startDate) && isDateKey(value.endDate) && isString(value.label);
}

function isValidStudentReportSkillNote(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isString(value.skill) && SKILLS.has(value.skill) && isString(value.label) && isFiniteNumber(value.averageGrade);
}

function isValidStudentReportLessonDetail(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.lessonId) &&
    isDateKey(value.date) &&
    isBoolean(value.present) &&
    isStringArray(value.topicsSeen) &&
    isNullableFiniteNumber(value.generalGrade) &&
    isFiniteNumber(value.durationMinutes)
  );
}

function isValidStudentReportEvidenceCandidate(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.lessonId) &&
    isDateKey(value.lessonDate) &&
    isNonEmptyString(value.attachmentId) &&
    isString(value.kind) &&
    EVIDENCE_KINDS.has(value.kind) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.uri) &&
    isOptionalString(value.caption)
  );
}

/** Opcional a propósito: un snapshot guardado antes de esta fase no lo tiene. */
function isValidStudentReportPunctualitySummary(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return (
    isNonNegativeInteger(value.evaluatedClasses) &&
    isNullableFiniteNumber(value.onTimeOrGracePercent) &&
    isNullableFiniteNumber(value.averageLateMinutes) &&
    isNonNegativeInteger(value.lateArrivalsCount) &&
    isNonNegativeInteger(value.absencesCount)
  );
}

function isValidStudentReportData(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isPlainObject(value.attendance)) return false;
  if (
    value.punctualityAndAttendance !== undefined &&
    !isValidStudentReportPunctualitySummary(value.punctualityAndAttendance)
  ) {
    return false;
  }
  const attendance = value.attendance;
  return (
    isNonEmptyString(value.studentId) &&
    isNonEmptyString(value.studentName) &&
    isValidStudentReportPeriod(value.period) &&
    isStringArray(value.topicsSeen) &&
    Array.isArray(value.skillNotes) &&
    value.skillNotes.every(isValidStudentReportSkillNote) &&
    isNullableFiniteNumber(value.generalAverageGrade) &&
    isStringArray(value.strengths) &&
    isStringArray(value.areasToImprove) &&
    isStringArray(value.homeworkAssigned) &&
    isNonNegativeInteger(attendance.classesHeld) &&
    isNonNegativeInteger(attendance.classesAttended) &&
    isNonNegativeInteger(attendance.classesAbsent) &&
    isNullableFiniteNumber(attendance.ratePercent) &&
    isFiniteNumber(value.hoursTaught) &&
    Array.isArray(value.lessonDetails) &&
    value.lessonDetails.every(isValidStudentReportLessonDetail) &&
    Array.isArray(value.evidenceCandidates) &&
    value.evidenceCandidates.every(isValidStudentReportEvidenceCandidate)
  );
}

function isValidReportRecordSnapshot(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (value.includePunctualitySummary !== undefined && !isBoolean(value.includePunctualitySummary)) return false;
  return (
    isValidStudentReportData(value.data) &&
    isString(value.narrativeText) &&
    isBoolean(value.includeClassDetail) &&
    isStringArray(value.selectedEvidenceIds)
  );
}

function isValidMonthlyAmountCorrectionEntry(value: unknown): value is MonthlyAmountCorrectionEntry {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    typeof value.billingPeriod === 'string' &&
    isValidBillingPeriod(value.billingPeriod) &&
    isFiniteNumber(value.previousAmount) &&
    isFiniteNumber(value.newAmount) &&
    isIsoDateTime(value.changedAt) &&
    isString(value.reason)
  );
}

/**
 * Corrección (a pedido de Joaquín — primer mes proporcional): mismo
 * criterio que `isValidMonthlyAmountCorrectionEntry` — `criterion` es un
 * enum cerrado de 4 valores reales, `chargeId` es nullable (sólo
 * `'no_charge'` no tiene cargo asociado).
 */
const FIRST_MONTH_PRORATION_CRITERIA = new Set(['proportional', 'full', 'custom', 'no_charge']);

function isValidFirstMonthProrationDecision(value: unknown): value is FirstMonthProrationDecision {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    typeof value.billingPeriod === 'string' &&
    isValidBillingPeriod(value.billingPeriod) &&
    isNonEmptyString(value.effectiveJoinDate) &&
    isString(value.criterion) &&
    FIRST_MONTH_PRORATION_CRITERIA.has(value.criterion) &&
    isFiniteNumber(value.classesRemaining) &&
    isFiniteNumber(value.classesPerFullPeriod) &&
    isFiniteNumber(value.permanentMonthlyAmount) &&
    isFiniteNumber(value.chargedAmount) &&
    (value.chargeId === null || isNonEmptyString(value.chargeId)) &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.confirmedAt)
  );
}

/**
 * Corrección 2026-09-13 (a pedido de Joaquín — COBRO MENSUAL SEPARADO DE
 * ENTRENAMIENTOS): mismo criterio de validación que
 * `isValidFirstMonthProrationDecision` — campos propios de
 * `TrainingBillingAgreement`, ver `payments/types/index.ts`.
 */
function isValidTrainingBillingAgreement(value: unknown): value is TrainingBillingAgreement {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isFiniteNumber(value.monthlyFee) &&
    value.monthlyFee > 0 &&
    (value.pendingMonthlyFee === undefined ||
      (isFiniteNumber(value.pendingMonthlyFee) && value.pendingMonthlyFee > 0)) &&
    (value.pendingMonthlyFeeEffectiveFrom === undefined ||
      (typeof value.pendingMonthlyFeeEffectiveFrom === 'string' && isValidBillingPeriod(value.pendingMonthlyFeeEffectiveFrom))) &&
    typeof value.startPeriod === 'string' &&
    isValidBillingPeriod(value.startPeriod) &&
    isIsoDateTime(value.createdAt)
  );
}

function isValidInitialPaidSurchargeCorrectionEntry(
  value: unknown
): value is InitialPaidSurchargeCorrectionEntry {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    typeof value.billingPeriod === 'string' &&
    isValidBillingPeriod(value.billingPeriod) &&
    isFiniteNumber(value.previousSurchargeAmount) &&
    isNonEmptyString(value.voidedPaymentId) &&
    isNonEmptyString(value.newPaymentId) &&
    isIsoDateTime(value.correctedAt) &&
    isString(value.reason)
  );
}

function isValidReportRecord(value: unknown): value is ReportRecord {
  if (!isPlainObject(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.studentId) &&
    isNonEmptyString(value.title) &&
    Array.isArray(value.selectedMonths) &&
    value.selectedMonths.length > 0 &&
    value.selectedMonths.every(isMonthKey) &&
    isDateKey(value.periodStart) &&
    isDateKey(value.periodEnd) &&
    isIsoDateTime(value.generatedAt) &&
    isNonEmptyString(value.permanentPdfUri) &&
    isValidReportRecordSnapshot(value.snapshot) &&
    isNonNegativeInteger(value.schemaVersion)
  );
}

/**
 * Corrección 2026-07-22 (a pedido de Joaquín — autenticación, teclado,
 * correo y nombre de la profesora, ítem G): forma mínima persistida —
 * `displayName` (nunca apellido ni otros datos).
 *
 * Corrección 2026-07-23 (protección integral de datos, Etapa 1):
 * `createdAt`/`updatedAt`/`schemaVersion` se suman, todos OPCIONALES a
 * propósito — un respaldo anterior a esta fase sólo tiene `displayName`, y
 * eso nunca es un error (`replaceTeacherProfileFromBackup` completa los
 * valores faltantes al restaurar).
 */
function isValidTeacherProfile(value: unknown): value is TeacherProfile {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.displayName)) return false;
  if (value.createdAt !== undefined && !isIsoDateTime(value.createdAt)) return false;
  if (value.updatedAt !== undefined && !isIsoDateTime(value.updatedAt)) return false;
  if (value.schemaVersion !== undefined && !isNonNegativeInteger(value.schemaVersion)) return false;
  // Corrección 2026-07-23 (tutorial rápido salteable, ítem D): opcionales
  // por el mismo motivo que los tres campos de arriba — un respaldo
  // anterior a esta fase simplemente no los trae, lo que sigue significando
  // "todavía no vio el tutorial", nunca un error de validación.
  if (value.completedTutorialVersion !== undefined && !isNonNegativeInteger(value.completedTutorialVersion)) return false;
  if (value.tutorialCompletedAt !== undefined && !isIsoDateTime(value.tutorialCompletedAt)) return false;
  return true;
}

/**
 * Corrección 2026-08-11 (a pedido de Joaquín — "convertir los recargos
 * automáticos en una configuración opcional de la profesora"): forma
 * mínima persistida de una etapa de recargo — sólo valida el TIPO de cada
 * campo (nunca los rangos de negocio 1-31/orden cronológico, que ya exige
 * `validateSurchargeTierValues` cada vez que la profesora edita el panel;
 * acá sólo se rechaza JSON con forma corrupta, igual criterio que el resto
 * de los validadores de este archivo).
 */
function isValidSurchargeTierValues(value: unknown): value is SurchargeTierValues {
  if (!isPlainObject(value)) return false;
  if (typeof value.enabled !== 'boolean') return false;
  if (!isNonNegativeInteger(value.graceDay)) return false;
  if (!isNonNegativeInteger(value.firstLateDay)) return false;
  if (!isNonNegativeInteger(value.firstLatePercentage)) return false;
  if (!isNonNegativeInteger(value.secondLateDay)) return false;
  if (!isNonNegativeInteger(value.secondLatePercentage)) return false;
  if (!isNonNegativeInteger(value.lastLateDay)) return false;
  if (!isNonNegativeInteger(value.lastLatePercentage)) return false;
  return true;
}

function isValidSurchargeSettings(value: unknown): value is SurchargeSettings {
  if (!isPlainObject(value)) return false;
  if (!isValidSurchargeTierValues(value.current)) return false;
  if (value.pending !== null && !isValidSurchargeTierValues(value.pending)) return false;
  if (value.pendingEffectiveFrom !== null && !(typeof value.pendingEffectiveFrom === 'string' && isValidBillingPeriod(value.pendingEffectiveFrom))) {
    return false;
  }
  return true;
}

/**
 * Fase financiera — Plan de distribución 50/30/20: los tres porcentajes
 * deben ser enteros entre 0 y 100 Y sumar exactamente 100 — un respaldo con
 * una suma distinta está corrupto/manipulado, nunca se restaura a medias.
 */
function isValidBudgetDistributionShares(value: unknown): value is BudgetDistribution {
  if (!isPlainObject(value)) return false;
  const { needs, wants, savings } = value;
  if (!isNonNegativeInteger(needs) || (needs as number) > 100) return false;
  if (!isNonNegativeInteger(wants) || (wants as number) > 100) return false;
  if (!isNonNegativeInteger(savings) || (savings as number) > 100) return false;
  return (needs as number) + (wants as number) + (savings as number) === 100;
}

function isValidSavingsGoal(value: unknown): value is SavingsGoal {
  if (!isPlainObject(value)) return false;
  if (!isBoolean(value.enabled)) return false;
  if (value.targetAmount !== null && !(isFiniteNumber(value.targetAmount) && value.targetAmount >= 0)) return false;
  if (value.targetDate !== null && !isDateKey(value.targetDate)) return false;
  return true;
}

function isValidBudgetDistributionSettings(value: unknown): value is BudgetDistributionSettings {
  if (!isPlainObject(value)) return false;
  if (!isValidBudgetDistributionShares(value.distribution)) return false;
  if (!isValidSavingsGoal(value.savingsGoal)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validación de nivel superior
// ---------------------------------------------------------------------------

/**
 * Valida el contenido crudo (texto) de un archivo de respaldo, sin tocar
 * AsyncStorage ni ningún store: tamaño en bytes reales, JSON.parse, claves
 * peligrosas en todo el documento, versión, y presencia/tipo/enum/rango de
 * cada campo de cada colección. Nunca "repara" nada — o el documento es
 * válido tal cual, o se rechaza con la lista completa de errores.
 */
export function validateBackupFileContents(
  rawContent: string,
  options: { maxBytes?: number } = {}
): RestoreValidationResult {
  const maxBytes = options.maxBytes ?? RESTORE_MAX_FILE_SIZE_BYTES;
  if (utf8ByteLength(rawContent) > maxBytes) {
    return {
      ok: false,
      errors: [
        {
          code: 'too_large',
          message: `El archivo supera el límite permitido de ${Math.round(maxBytes / (1024 * 1024))} MB.`,
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return { ok: false, errors: [{ code: 'invalid_json', message: 'El archivo no es un JSON válido.' }] };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      errors: [
        { code: 'not_an_object', message: 'El archivo no tiene la estructura de un respaldo de TeacherFlow.' },
      ],
    };
  }

  const doc: Record<string, unknown> = parsed;

  const dangerousPaths = findDangerousKeysDeep(doc);
  if (dangerousPaths.length > 0) {
    return {
      ok: false,
      errors: [
        {
          code: 'dangerous_key',
          message: 'El respaldo contiene una clave no permitida en su contenido.',
        },
      ],
    };
  }

  const schemaVersion = doc.schemaVersion;
  if (schemaVersion !== BACKUP_SCHEMA_VERSION && schemaVersion !== BACKUP_SCHEMA_VERSION_V2) {
    return {
      ok: false,
      errors: [
        {
          code: 'unknown_schema_version',
          message: 'La versión del respaldo no es compatible con esta versión de TeacherFlow.',
        },
      ],
    };
  }
  const isV2Document = schemaVersion === BACKUP_SCHEMA_VERSION_V2;

  const errors: RestoreValidationError[] = [];

  function requireField(field: string): unknown {
    if (!(field in doc)) {
      errors.push({ code: 'missing_field', field, message: `Falta el campo "${field}" en el respaldo.` });
      return undefined;
    }
    return doc[field];
  }

  const exportedAt = requireField('exportedAt');
  if (exportedAt !== undefined && !isIsoDateTime(exportedAt)) {
    errors.push({ code: 'invalid_type', field: 'exportedAt', message: 'La fecha del respaldo no es válida.' });
  }

  const appVersionRaw = requireField('appVersion');
  if (appVersionRaw !== undefined && appVersionRaw !== null && typeof appVersionRaw !== 'string') {
    errors.push({
      code: 'invalid_type',
      field: 'appVersion',
      message: 'El campo de versión de la aplicación no es válido.',
    });
  }

  const studentsRaw = requireField('students');
  if (studentsRaw !== undefined && (!Array.isArray(studentsRaw) || !studentsRaw.every(isValidStudent))) {
    errors.push({ code: 'invalid_type', field: 'students', message: 'La lista de alumnos tiene un formato inválido.' });
  }

  const profilesRaw = requireField('profiles');
  if (profilesRaw !== undefined) {
    if (!isPlainObject(profilesRaw)) {
      errors.push({ code: 'invalid_type', field: 'profiles', message: 'Los perfiles tienen un formato inválido.' });
    } else if (!Object.values(profilesRaw).every(isValidProfile)) {
      errors.push({
        code: 'invalid_type',
        field: 'profiles',
        message: 'Alguno de los perfiles tiene un formato inválido.',
      });
    }
  }

  const pedagogicalLessonsRaw = requireField('pedagogicalLessons');
  if (
    pedagogicalLessonsRaw !== undefined &&
    (!Array.isArray(pedagogicalLessonsRaw) || !pedagogicalLessonsRaw.every(isValidSavedLesson))
  ) {
    errors.push({
      code: 'invalid_type',
      field: 'pedagogicalLessons',
      message: 'Las clases registradas tienen un formato inválido.',
    });
  }

  const calendarLessonsRaw = requireField('calendarLessons');
  if (
    calendarLessonsRaw !== undefined &&
    (!Array.isArray(calendarLessonsRaw) || !calendarLessonsRaw.every(isValidCalendarLesson))
  ) {
    errors.push({
      code: 'invalid_type',
      field: 'calendarLessons',
      message: 'Las reservas de calendario tienen un formato inválido.',
    });
  }

  const recurrenceRulesRaw = requireField('recurrenceRules');
  if (
    recurrenceRulesRaw !== undefined &&
    (!Array.isArray(recurrenceRulesRaw) || !recurrenceRulesRaw.every(isValidRecurrenceRule))
  ) {
    errors.push({
      code: 'invalid_type',
      field: 'recurrenceRules',
      message: 'Las reglas de repetición tienen un formato inválido.',
    });
  }

  const recurrenceExceptionsRaw = requireField('recurrenceExceptions');
  if (
    recurrenceExceptionsRaw !== undefined &&
    (!Array.isArray(recurrenceExceptionsRaw) || !recurrenceExceptionsRaw.every(isValidRecurrenceException))
  ) {
    errors.push({
      code: 'invalid_type',
      field: 'recurrenceExceptions',
      message: 'Las excepciones de repetición tienen un formato inválido.',
    });
  }

  const teacherAvailabilityRaw = requireField('teacherAvailability');
  if (teacherAvailabilityRaw !== undefined && !isValidTeacherAvailability(teacherAvailabilityRaw)) {
    errors.push({
      code: 'invalid_type',
      field: 'teacherAvailability',
      message: 'La disponibilidad tiene un formato inválido.',
    });
  }

  // Colecciones financieras: sólo existen (y se exigen) en v2. Un respaldo
  // v1 se migra acá mismo con las cuatro colecciones vacías — nunca se
  // inventa contenido, sólo se completa la forma v2 con "no había nada".
  let paymentChargesRaw: unknown = [];
  let paymentsRaw: unknown = [];
  let paymentAllocationsRaw: unknown = [];
  let paymentAdjustmentsRaw: unknown = [];

  if (isV2Document) {
    paymentChargesRaw = requireField('paymentCharges');
    if (
      paymentChargesRaw !== undefined &&
      (!Array.isArray(paymentChargesRaw) || !paymentChargesRaw.every(isValidPaymentCharge))
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'paymentCharges',
        message: 'Las obligaciones de cobro tienen un formato inválido.',
      });
    }

    paymentsRaw = requireField('payments');
    if (paymentsRaw !== undefined && (!Array.isArray(paymentsRaw) || !paymentsRaw.every(isValidPayment))) {
      errors.push({ code: 'invalid_type', field: 'payments', message: 'Los pagos tienen un formato inválido.' });
    }

    paymentAllocationsRaw = requireField('paymentAllocations');
    if (
      paymentAllocationsRaw !== undefined &&
      (!Array.isArray(paymentAllocationsRaw) || !paymentAllocationsRaw.every(isValidPaymentAllocation))
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'paymentAllocations',
        message: 'Las asignaciones de pago tienen un formato inválido.',
      });
    }

    paymentAdjustmentsRaw = requireField('paymentAdjustments');
    if (
      paymentAdjustmentsRaw !== undefined &&
      (!Array.isArray(paymentAdjustmentsRaw) || !paymentAdjustmentsRaw.every(isValidPaymentAdjustment))
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'paymentAdjustments',
        message: 'Las condonaciones tienen un formato inválido.',
      });
    }
  }

  // reportRecords: campo OPCIONAL (nunca `requireField`) — un respaldo v2
  // anterior a esta fase simplemente no lo tiene, y eso nunca es un error.
  const reportRecordsRaw: unknown = doc.reportRecords;
  if (reportRecordsRaw !== undefined) {
    if (!Array.isArray(reportRecordsRaw) || !reportRecordsRaw.every(isValidReportRecord)) {
      errors.push({
        code: 'invalid_type',
        field: 'reportRecords',
        message: 'Los reportes generados tienen un formato inválido.',
      });
    }
  }

  // packagePurchases/packageCreditMovements: campos OPCIONALES, mismo
  // criterio que reportRecords — un respaldo v2 anterior a esta fase no
  // los tiene, y eso nunca es un error.
  const packagePurchasesRaw: unknown = doc.packagePurchases;
  if (packagePurchasesRaw !== undefined) {
    if (!Array.isArray(packagePurchasesRaw) || !packagePurchasesRaw.every(isValidPackagePurchase)) {
      errors.push({
        code: 'invalid_type',
        field: 'packagePurchases',
        message: 'Los paquetes comprados tienen un formato inválido.',
      });
    }
  }

  const packageCreditMovementsRaw: unknown = doc.packageCreditMovements;
  if (packageCreditMovementsRaw !== undefined) {
    if (!Array.isArray(packageCreditMovementsRaw) || !packageCreditMovementsRaw.every(isValidPackageCreditMovement)) {
      errors.push({
        code: 'invalid_type',
        field: 'packageCreditMovements',
        message: 'Los movimientos de crédito de paquetes tienen un formato inválido.',
      });
    }
  }

  // teacherProfile: campo OPCIONAL, mismo criterio que reportRecords — un
  // respaldo v2 anterior a esta fase no lo tiene. `null` es un valor válido
  // (el dispositivo que armó el respaldo todavía no tenía nombre guardado).
  const teacherProfileRaw: unknown = doc.teacherProfile;
  if (teacherProfileRaw !== undefined && teacherProfileRaw !== null) {
    if (!isValidTeacherProfile(teacherProfileRaw)) {
      errors.push({
        code: 'invalid_type',
        field: 'teacherProfile',
        message: 'El nombre de la profesora tiene un formato inválido.',
      });
    }
  }

  // firstMonthProrationDecisions: campo OPCIONAL, mismo criterio que
  // monthlyAmountCorrections — un respaldo anterior a esta fase no lo
  // tiene, y eso nunca es un error.
  const firstMonthProrationDecisionsRaw: unknown = doc.firstMonthProrationDecisions;
  if (firstMonthProrationDecisionsRaw !== undefined) {
    if (
      !Array.isArray(firstMonthProrationDecisionsRaw) ||
      !firstMonthProrationDecisionsRaw.every(isValidFirstMonthProrationDecision)
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'firstMonthProrationDecisions',
        message: 'El registro de decisiones de primer mes proporcional tiene un formato inválido.',
      });
    }
  }

  // monthlyAmountCorrections: campo OPCIONAL, mismo criterio que
  // reportRecords/teacherProfile — un respaldo anterior a esta fase no lo
  // tiene, y eso nunca es un error.
  const monthlyAmountCorrectionsRaw: unknown = doc.monthlyAmountCorrections;
  if (monthlyAmountCorrectionsRaw !== undefined) {
    if (
      !Array.isArray(monthlyAmountCorrectionsRaw) ||
      !monthlyAmountCorrectionsRaw.every(isValidMonthlyAmountCorrectionEntry)
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'monthlyAmountCorrections',
        message: 'El registro de correcciones de monto mensual tiene un formato inválido.',
      });
    }
  }

  // initialPaidSurchargeCorrections: campo OPCIONAL, mismo criterio exacto
  // que monthlyAmountCorrections — un respaldo anterior a esta fase no lo
  // tiene, y eso nunca es un error.
  const initialPaidSurchargeCorrectionsRaw: unknown = doc.initialPaidSurchargeCorrections;
  if (initialPaidSurchargeCorrectionsRaw !== undefined) {
    if (
      !Array.isArray(initialPaidSurchargeCorrectionsRaw) ||
      !initialPaidSurchargeCorrectionsRaw.every(isValidInitialPaidSurchargeCorrectionEntry)
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'initialPaidSurchargeCorrections',
        message: 'El registro de correcciones de situación inicial tiene un formato inválido.',
      });
    }
  }

  // surchargeSettings: campo OPCIONAL, mismo criterio que teacherProfile —
  // un respaldo anterior a esta fase no lo tiene, y eso nunca es un error.
  const surchargeSettingsRaw: unknown = doc.surchargeSettings;
  if (surchargeSettingsRaw !== undefined && surchargeSettingsRaw !== null) {
    if (!isValidSurchargeSettings(surchargeSettingsRaw)) {
      errors.push({
        code: 'invalid_type',
        field: 'surchargeSettings',
        message: 'La configuración de recargos automáticos tiene un formato inválido.',
      });
    }
  }

  // budgetDistribution: campo OPCIONAL, mismo criterio exacto que
  // surchargeSettings — un respaldo anterior a la fase financiera no lo
  // tiene, y eso nunca es un error (se migra sola a 50/30/20 por defecto).
  const budgetDistributionRaw: unknown = doc.budgetDistribution;
  if (budgetDistributionRaw !== undefined && budgetDistributionRaw !== null) {
    if (!isValidBudgetDistributionSettings(budgetDistributionRaw)) {
      errors.push({
        code: 'invalid_type',
        field: 'budgetDistribution',
        message: 'El plan de distribución 50/30/20 tiene un formato inválido.',
      });
    }
  }

  // trainingBillingAgreements: campo OPCIONAL, mismo criterio exacto que
  // firstMonthProrationDecisions — un respaldo anterior a esta fase no lo
  // tiene, y eso nunca es un error.
  const trainingBillingAgreementsRaw: unknown = doc.trainingBillingAgreements;
  if (trainingBillingAgreementsRaw !== undefined) {
    if (
      !Array.isArray(trainingBillingAgreementsRaw) ||
      !trainingBillingAgreementsRaw.every(isValidTrainingBillingAgreement)
    ) {
      errors.push({
        code: 'invalid_type',
        field: 'trainingBillingAgreements',
        message: 'La configuración de cuotas de entrenamiento tiene un formato inválido.',
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    backup: {
      schemaVersion: BACKUP_SCHEMA_VERSION_V2,
      exportedAt: exportedAt as string,
      appVersion: (appVersionRaw ?? null) as string | null,
      students: (studentsRaw as Array<Record<string, unknown>>).map(
        (student) => normalizeLevelsFieldForRestore(student) as unknown as StudentListItem
      ),
      profiles: Object.fromEntries(
        Object.entries(profilesRaw as Record<string, Record<string, unknown>>).map(([id, profile]) => [
          id,
          normalizeLevelsFieldForRestore(profile) as unknown as StudentProfile,
        ])
      ),
      pedagogicalLessons: pedagogicalLessonsRaw as SavedLesson[],
      calendarLessons: calendarLessonsRaw as CalendarLesson[],
      recurrenceRules: recurrenceRulesRaw as RecurrenceRule[],
      recurrenceExceptions: recurrenceExceptionsRaw as RecurrenceException[],
      teacherAvailability: (teacherAvailabilityRaw ?? null) as TeacherAvailability | null,
      paymentCharges: paymentChargesRaw as PaymentCharge[],
      payments: paymentsRaw as Payment[],
      paymentAllocations: paymentAllocationsRaw as PaymentAllocation[],
      paymentAdjustments: paymentAdjustmentsRaw as PaymentAdjustment[],
      reportRecords: reportRecordsRaw === undefined ? undefined : (reportRecordsRaw as ReportRecord[]),
      packagePurchases: packagePurchasesRaw === undefined ? undefined : (packagePurchasesRaw as PackagePurchase[]),
      packageCreditMovements:
        packageCreditMovementsRaw === undefined ? undefined : (packageCreditMovementsRaw as PackageCreditMovement[]),
      teacherProfile: teacherProfileRaw === undefined ? undefined : (teacherProfileRaw as TeacherProfile | null),
      monthlyAmountCorrections:
        monthlyAmountCorrectionsRaw === undefined
          ? undefined
          : (monthlyAmountCorrectionsRaw as MonthlyAmountCorrectionEntry[]),
      initialPaidSurchargeCorrections:
        initialPaidSurchargeCorrectionsRaw === undefined
          ? undefined
          : (initialPaidSurchargeCorrectionsRaw as InitialPaidSurchargeCorrectionEntry[]),
      surchargeSettings:
        surchargeSettingsRaw === undefined ? undefined : (surchargeSettingsRaw as SurchargeSettings | null),
      budgetDistribution:
        budgetDistributionRaw === undefined ? undefined : (budgetDistributionRaw as BudgetDistributionSettings | null),
      firstMonthProrationDecisions:
        firstMonthProrationDecisionsRaw === undefined
          ? undefined
          : (firstMonthProrationDecisionsRaw as FirstMonthProrationDecision[]),
      trainingBillingAgreements:
        trainingBillingAgreementsRaw === undefined
          ? undefined
          : (trainingBillingAgreementsRaw as TrainingBillingAgreement[]),
    },
  };
}
