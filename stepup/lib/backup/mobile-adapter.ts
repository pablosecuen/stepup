/**
 * Traslado desde la app móvil: adaptador del respaldo REAL de la app (el JSON crudo de AsyncStorage, `TeacherFlowBackupV2`) al formato
 * canónico que lee la importación de la base (`preview_backup_import` / `apply_backup_import`).
 *
 * Por qué existe: la importación de la web (R6/R6.1) lee nombres de campo propios (`primaryStudentId`, `startAt`, `ruleType`, `chargeType`,
 * `roster`…) y espera que cada alumno traiga TODO en `students[]`. La app móvil escribe otra cosa (`studentId`, `start`/`end`, `recurrenceId` +
 * `type` en las series, `type` en los cobros, los datos personales en `profiles{}` y cada clase registrada como un `form` anidado). Sin este
 * paso, un respaldo real se rechaza (series sin `id`) o, peor, se importaría incompleto. Ver docs/TRASLADO_EXPO_GO_A_WEB.md.
 *
 * Reglas de diseño:
 *  - Puro y determinista (sin red, sin reloj, sin azar): el mismo respaldo da siempre el mismo resultado, así un reintento no duplica nada.
 *  - Idempotente por elemento: lo que YA está en formato canónico pasa sin tocarse (las pruebas y la web desplegada antes siguen valiendo).
 *  - Nada se pierde en silencio: lo que no se puede importar se lista en `omitted` (con su id y motivo), lo que se transforma en `conversions`
 *    y lo que no tiene destino en las tablas de la web en `notRepresented` (con la cantidad de filas afectadas). Cada clase registrada conserva
 *    el objeto original completo en `_src`, para que el archivo de origen (migración `import_source_archives`) guarde hasta el último campo.
 *  - Nunca se inventa un dato: un valor ausente queda ausente (o `null`), salvo las derivaciones declaradas en `conversions`.
 */

import { CalendarRefResolver } from "./calendar-refs.ts";
import { buildOriginIncidents } from "./origin-incidents.ts";
import { classifyAllExcesses } from "./surcharge-evidence.ts";

export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

type Obj = Record<string, unknown>;

export interface AdaptOmission {
  collection: string;
  id: string | null;
  code: string;
  message: string;
}

export interface AdaptConversion {
  collection: string;
  code: string;
  count: number;
  message: string;
}

export interface AdaptNotRepresented {
  collection: string;
  field: string;
  /** Filas del origen que traen ese dato con contenido. */
  rows: number;
  message: string;
}

export interface AdaptReport {
  shape: "mobile" | "canonical" | "mixed";
  perCollection: Record<string, { source: number; adapted: number; omitted: number }>;
  omitted: AdaptOmission[];
  conversions: AdaptConversion[];
  notRepresented: AdaptNotRepresented[];
}

export interface AdaptResult {
  payload: Obj;
  report: AdaptReport;
}

const isObj = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const nonEmptyText = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const hasContent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isObj(value)) return Object.keys(value).length > 0;
  return true;
};

/** Hash FNV-1a de 32 bits (hexadecimal): estable entre corridas y sin dependencias; sólo sirve para armar identificadores determinísticos. */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const CIVIL_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: ARGENTINA_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/**
 * Fecha civil `YYYY-MM-DD` de un valor que en el móvil puede ser una clave de fecha o un instante ISO. Una clave de fecha pasa igual; un instante
 * que cae EXACTAMENTE a medianoche UTC se toma como fecha sin hora (así lo escribe el móvil cuando arma la fecha desde un día elegido); cualquier
 * otro instante se pasa al día civil de Argentina (un alta registrada a las 22:30 de Buenos Aires es del mismo día, aunque en UTC ya sea el siguiente).
 */
export function toCivilDateKey(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?Z$/.test(trimmed)) return trimmed.slice(0, 10);
  const time = new Date(trimmed).getTime();
  if (Number.isNaN(time)) return null;
  return CIVIL_FORMAT.format(new Date(time));
}

/** Instante ISO de una fecha y hora locales de Argentina (UTC−3, sin horario de verano desde 2009). */
export function localToIso(date: unknown, time: unknown): string | null {
  const day = toCivilDateKey(date);
  const clock = nonEmptyText(time);
  if (!day || !clock || !/^\d{1,2}:\d{2}$/.test(clock)) return null;
  const parsed = new Date(`${day}T${clock.padStart(5, "0")}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function plusMinutes(iso: string | null, minutes: unknown): string | null {
  if (!iso || typeof minutes !== "number" || !Number.isFinite(minutes)) return null;
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/** Instante ISO normalizado de un valor de fecha y hora, o null si no es una fecha válida. */
function isoOrNull(value: unknown): string | null {
  const raw = nonEmptyText(value);
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const SKILL_KEYS = new Set(["speaking", "listening", "reading", "writing", "grammar", "vocabulary", "pronunciation", "participation"]);

/** Estado de una nota según la propia app: 0 es «sin calificar» (convención del control de notas); el resto fuera de 1–10 o no numérico es un dato histórico inválido. */
function gradeStatus(raw: unknown): "ok" | "unset" | "out_of_range" | "absent" {
  if (raw === null || raw === undefined) return "absent";
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "out_of_range";
  if (raw === 0) return "unset";
  return raw >= 1 && raw <= 10 ? "ok" : "out_of_range";
}

class Ledger {
  readonly omitted: AdaptOmission[] = [];
  readonly conversions = new Map<string, AdaptConversion>();
  readonly perCollection: AdaptReport["perCollection"] = {};
  mobileRows = 0;
  canonicalRows = 0;
  /** Campos del origen que ningún mapeo conoce: se conservan (`sourceExtras.unknown`) y se cuentan para que no pasen en silencio. */
  readonly unknown = new Map<string, number>();

  unknownField(collection: string, field: string) {
    const key = `${collection}\u0000${field}`;
    this.unknown.set(key, (this.unknown.get(key) ?? 0) + 1);
  }

  count(collection: string, source: number, adapted: number) {
    this.perCollection[collection] = { source, adapted, omitted: source - adapted };
  }
  omit(collection: string, id: string | null, code: string, message: string) {
    this.omitted.push({ collection, id, code, message });
  }
  convert(collection: string, code: string, message: string, by = 1) {
    const key = `${collection}:${code}`;
    const existing = this.conversions.get(key);
    if (existing) existing.count += by;
    else this.conversions.set(key, { collection, code, count: by, message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Alumnos: `students[]` (tarjeta de lista) + `profiles{}` (ficha completa) → una fila completa por alumno
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CARD_MAPPED = new Set(["id", "name", "levels", "modality", "status", "isFeatured", "isNew"]);
const PROFILE_MAPPED = new Set([
  "id", "name", "phone", "whatsapp", "email", "usualDays", "usualTime", "notes", "birthDate", "levels", "initialLevel", "modality", "status", "category", "billingType", "billingPlan", "dateJoined",
  "lastReactivatedAt", "statusChangeDate", "usualDurationMinutes", "weeklyFrequency", "price", "pendingHomework", "alerts", "currentGoals", "strengths", "areasToImprove", "levelHistory", "statusHistory",
  "priceHistory",
]);

function adaptStudents(doc: Obj, ledger: Ledger): { students: Obj[]; profiles: Obj } {
  const list = arr(doc.students).filter(isObj);
  const profilesIn = isObj(doc.profiles) ? doc.profiles : {};
  const students: Obj[] = [];
  const seen = new Set<string>();
  const extrasSeed = new Map<string, { card: Obj | null; profile: Obj }>();

  const build = (id: string, card: Obj | null, profile: Obj): Obj => {
    extrasSeed.set(id, { card, profile });
    const pick = (key: string) => (profile[key] !== undefined ? profile[key] : card?.[key]);
    const dateOrNull = (key: string) => {
      const raw = profile[key];
      if (raw === null || raw === undefined || raw === "") return null;
      const civil = toCivilDateKey(raw);
      if (civil === null) {
        ledger.convert("students", "invalid_date_dropped", `Una fecha de alumno ('${key}') no era válida y no se importa (queda en el archivo de origen).`);
        return null;
      }
      if (civil !== raw) ledger.convert("students", "date_to_civil_day", "Fechas del alumno (alta, nacimiento, baja o reactivación) pasadas de instante a día civil de Argentina.");
      return civil;
    };
    if (card && profile.status !== undefined && card.status !== undefined && card.status !== profile.status) ledger.convert("students", "card_profile_status_mismatch", "La tarjeta de la lista y la ficha del alumno tenían estados distintos: se usa el de la ficha.");
    if (card && profile.modality !== undefined && card.modality !== undefined && card.modality !== profile.modality) ledger.convert("students", "card_profile_modality_mismatch", "La tarjeta de la lista y la ficha del alumno tenían modalidades distintas: se usa la de la ficha.");
    return {
      id,
      name: pick("name"),
      phone: text(profile.phone),
      whatsapp: text(profile.whatsapp),
      email: text(profile.email),
      usualDays: arr(profile.usualDays),
      usualTime: text(profile.usualTime),
      notes: text(profile.notes),
      birthDate: dateOrNull("birthDate"),
      levels: arr(pick("levels")),
      initialLevel: text(profile.initialLevel) ?? "",
      modality: pick("modality"),
      status: pick("status"),
      category: profile.category,
      billingType: profile.billingType,
      billingPlan: profile.billingPlan ?? null,
      dateJoined: dateOrNull("dateJoined"),
      lastReactivatedAt: dateOrNull("lastReactivatedAt"),
      statusChangeDate: dateOrNull("statusChangeDate"),
      usualDurationMinutes: profile.usualDurationMinutes,
      weeklyFrequency: profile.weeklyFrequency,
      price: profile.price,
      pendingHomework: text(profile.pendingHomework),
      alerts: arr(profile.alerts),
      currentGoals: arr(profile.currentGoals),
      strengths: arr(profile.strengths),
      areasToImprove: arr(profile.areasToImprove),
      isFeatured: card?.isFeatured === true,
      isNew: card?.isNew === true,
    };
  };

  for (const card of list) {
    const id = nonEmptyText(card.id);
    if (!id) {
      ledger.omit("students", null, "missing_id", "Un alumno de la lista no tiene identificador.");
      continue;
    }
    if (seen.has(id)) {
      ledger.omit("students", id, "duplicate_id", "El mismo alumno aparece dos veces en la lista: se importa una sola vez.");
      continue;
    }
    seen.add(id);
    // Ya canónico (formato de la web): pasa tal cual.
    if (card.category !== undefined && card.billingType !== undefined) {
      ledger.canonicalRows += 1;
      students.push(card);
      continue;
    }
    ledger.mobileRows += 1;
    const profile = profilesIn[id];
    if (!isObj(profile)) {
      ledger.omit("students", id, "student_without_profile", "El alumno está en la lista pero no tiene ficha (categoría, tipo de cobro y fecha de alta): no se puede importar sin inventar esos datos.");
      continue;
    }
    students.push(build(id, card, profile));
  }
  // Ficha sin tarjeta en la lista: la app borra la ficha junto con el alumno, así que una ficha huérfana es anómala. Importarla crearía un alumno que la
  // profesora pudo haber eliminado: no se inventa, queda declarada y el traslado se detiene hasta revisarla.
  for (const [id, profile] of Object.entries(profilesIn)) {
    if (seen.has(id) || !isObj(profile)) continue;
    seen.add(id);
    ledger.omit("profiles", id, "profile_without_student", "Hay una ficha que no pertenece a ningún alumno de la lista: no se importa para no recrear un alumno eliminado.");
  }
  ledger.count("students", list.length, students.length);

  // Fichas para la importación: el historial de niveles necesita un identificador por entrada (la base sólo importa las que lo tienen).
  const profiles: Obj = {};
  for (const [id, profile] of Object.entries(profilesIn)) {
    if (!isObj(profile)) continue;
    const history = arr(profile.levelHistory)
      .filter(isObj)
      .map((entry, index) => {
        // La fecha del logro es un día: se pasa al día civil de Argentina (un instante de la noche argentina no puede caer en el día siguiente de UTC).
        const civilDate = toCivilDateKey(entry.date);
        if (civilDate && civilDate !== entry.date) ledger.convert("profiles", "history_date_to_civil_day", "Fechas de los historiales pasadas de instante a día civil de Argentina (la fecha original se conserva en la entrada).");
        const dated = civilDate ? { ...entry, date: civilDate } : entry;
        if (nonEmptyText(entry.id)) return dated;
        ledger.convert("profiles", "level_history_id_generated", "Entradas del historial de niveles sin identificador: se les asignó uno determinístico (mismo respaldo, mismo identificador).");
        return { ...dated, id: `lvl_${stableHash(`${id}|${index}|${text(entry.level) ?? ""}|${text(entry.date) ?? ""}`)}` };
      });
    const invalidHistory: { statusHistory: Obj[]; priceHistory: Obj[] } = { statusHistory: [], priceHistory: [] };
    const statusHistory = arr(profile.statusHistory).filter(isObj).flatMap((entry) => {
      if (isObj(entry.sourceEntry)) return [entry]; // ya adaptada (idempotente)
      const date = toCivilDateKey(entry.date);
      if (!date || typeof entry.status !== "string" || !STUDENT_STATUSES.has(entry.status)) {
        invalidHistory.statusHistory.push(entry);
        ledger.convert("profiles", "invalid_history_entry_kept", "Entradas de historial sin fecha, estado o importe válidos: no entran al historial de la web, pero se conservan tal cual en la ficha del alumno (source_extras) para revisarlas.");
        return [];
      }
      if (date !== entry.date) ledger.convert("profiles", "history_date_to_civil_day", "Fechas de los historiales de estado y de precio pasadas de instante a día civil de Argentina (la fecha original se conserva en la entrada).");
      return [{ status: entry.status, date, reason: text(entry.reason), internalNote: text(entry.internalNote), sourceEntry: entry }];
    });
    const priceHistory = arr(profile.priceHistory).filter(isObj).flatMap((entry) => {
      if (isObj(entry.sourceEntry)) return [entry]; // ya adaptada (idempotente)
      const date = toCivilDateKey(entry.date);
      if (!date || typeof entry.price !== "number" || !Number.isFinite(entry.price) || entry.price < 0) {
        invalidHistory.priceHistory.push(entry);
        ledger.convert("profiles", "invalid_history_entry_kept", "Entradas de historial sin fecha, estado o importe válidos: no entran al historial de la web, pero se conservan tal cual en la ficha del alumno (source_extras) para revisarlas.");
        return [];
      }
      if (date !== entry.date) ledger.convert("profiles", "history_date_to_civil_day", "Fechas de los historiales de estado y de precio pasadas de instante a día civil de Argentina (la fecha original se conserva en la entrada).");
      return [{ price: entry.price, date, sourceEntry: entry }];
    });
    profiles[id] = { ...profile, levelHistory: history, statusHistory, priceHistory };
    const student = students.find((x) => x.id === id);
    const seed = extrasSeed.get(id);
    if (student && seed) {
      const extras: Obj = {};
      const cardExtras: Obj = {};
      if (seed.card) {
        for (const [key, value] of Object.entries(seed.card)) {
          if (!CARD_MAPPED.has(key)) cardExtras[key] = value;
          else if (key !== "id" && profile[key] !== undefined && JSON.stringify(profile[key]) !== JSON.stringify(value)) cardExtras[key] = value;
        }
      }
      const profileExtras: Obj = {};
      for (const [key, value] of Object.entries(profile)) if (!PROFILE_MAPPED.has(key)) profileExtras[key] = value;
      if (Object.keys(cardExtras).length > 0) extras.card = cardExtras;
      if (Object.keys(profileExtras).length > 0) extras.profile = profileExtras;
      if (invalidHistory.statusHistory.length > 0 || invalidHistory.priceHistory.length > 0) extras.invalidHistory = invalidHistory;
      student.sourceExtras = extras;
    }
  }
  return { students, profiles };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Calendario
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function adaptRules(doc: Obj, ledger: Ledger): Obj[] {
  const source = arr(doc.recurrenceRules).filter(isObj);
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const rule of source) {
    if (typeof rule.id === "string" && rule.ruleType !== undefined) {
      ledger.canonicalRows += 1;
      out.push(rule);
      continue;
    }
    ledger.mobileRows += 1;
    const id = nonEmptyText(rule.recurrenceId);
    if (!id) {
      ledger.omit("recurrenceRules", null, "missing_id", "Una serie no tiene identificador.");
      continue;
    }
    if (seen.has(id)) {
      ledger.omit("recurrenceRules", id, "duplicate_id", "La misma serie aparece dos veces: se importa una sola vez.");
      continue;
    }
    seen.add(id);
    out.push({
      id,
      primaryStudentId: nonEmptyText(rule.studentId),
      ruleType: rule.type,
      cycleLengthWeeks: rule.cycleLengthWeeks,
      weeks: rule.weeks,
      modality: rule.modality,
      timezone: rule.timezone,
      startDate: toCivilDateKey(rule.startDate),
      endDate: rule.endDate === null || rule.endDate === undefined ? null : toCivilDateKey(rule.endDate),
      status: rule.status,
      supersedesRecurrenceId: nonEmptyText(rule.supersedesRecurrenceId),
      supersededByRecurrenceId: nonEmptyText(rule.supersededByRecurrenceId),
      effectiveFromDate: rule.effectiveFromDate === undefined || rule.effectiveFromDate === null ? null : toCivilDateKey(rule.effectiveFromDate),
      classTitle: text(rule.classTitle),
      activityKind: rule.activityKind ?? "class",
      trainingBillingAgreementId: nonEmptyText(rule.trainingBillingAgreementId),
      participantStudentIds: arr(rule.participantIds).filter((x): x is string => typeof x === "string"),
    });
  }
  ledger.count("recurrenceRules", source.length, out.length);
  return out;
}

function adaptCalendarLessons(doc: Obj, ledger: Ledger): Obj[] {
  const source = arr(doc.calendarLessons).filter(isObj);
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const lesson of source) {
    if (lesson.startAt !== undefined && lesson.primaryStudentId !== undefined) {
      ledger.canonicalRows += 1;
      out.push(lesson);
      continue;
    }
    ledger.mobileRows += 1;
    const id = nonEmptyText(lesson.id);
    if (!id) {
      ledger.omit("calendarLessons", null, "missing_id", "Una clase de calendario no tiene identificador.");
      continue;
    }
    if (seen.has(id)) {
      ledger.omit("calendarLessons", id, "duplicate_id", "La misma clase de calendario aparece dos veces: se importa una sola vez.");
      continue;
    }
    seen.add(id);
    if (!nonEmptyText(lesson.studentId)) {
      ledger.omit("calendarLessons", id, "missing_primary_student", "La clase no tiene alumno principal: la web lo exige y no se puede inventar.");
      continue;
    }
    out.push({
      id,
      primaryStudentId: lesson.studentId,
      studentName: lesson.studentName,
      level: lesson.level,
      lessonType: lesson.lessonType,
      startAt: lesson.start,
      endAt: lesson.end,
      modality: lesson.modality,
      status: lesson.status,
      color: lesson.color,
      overlapAllowed: lesson.overlapAllowed === true,
      overlapGroupId: lesson.overlapGroupId ?? null,
      notes: text(lesson.notes),
      isRecurring: lesson.isRecurring === true,
      recurrenceId: nonEmptyText(lesson.recurrenceId),
      recurrenceOccurrenceKey: nonEmptyText(lesson.recurrenceOccurrenceKey),
      recurrenceIndex: typeof lesson.recurrenceIndex === "number" ? lesson.recurrenceIndex : null,
      recurrenceOriginalStart: nonEmptyText(lesson.recurrenceOriginalStart),
      scheduleAdjustment: isObj(lesson.scheduleAdjustment) ? lesson.scheduleAdjustment : null,
      classTitle: text(lesson.classTitle),
      freedByLessonId: nonEmptyText(lesson.freedByLessonId),
      activityKind: lesson.activityKind ?? "class",
      participants: arr(lesson.participants).filter(isObj),
    });
  }
  ledger.count("calendarLessons", source.length, out.length);
  return out;
}

function adaptExceptions(doc: Obj, ledger: Ledger): Obj[] {
  const source = arr(doc.recurrenceExceptions).filter(isObj);
  const out = source.map((exception) => {
    if (exception.exceptionType !== undefined) {
      ledger.canonicalRows += 1;
      return exception;
    }
    ledger.mobileRows += 1;
    return {
      recurrenceId: exception.recurrenceId,
      occurrenceKey: exception.occurrenceKey,
      exceptionType: exception.type,
      replacementLessonId: nonEmptyText(exception.replacementLessonId),
      createdAt: exception.createdAt ?? null,
    };
  });
  ledger.count("recurrenceExceptions", source.length, out.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Clases registradas: `SavedLesson` (con su `form` anidado) → registro de la web
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const STUDENT_STATUSES = new Set(["activo", "pausado", "inactivo", "archivado"]);
const ATTENDANCE_STATUSES = new Set(["presente", "ausente", "tarde", "ausente_aviso", "sin_registrar"]);
const WEB_OUTCOMES = new Set(["clase_dictada", "profesora_ausente", "feriado", "cancelada_con_aviso", "cancelada_tarde", "reprogramada"]);
const PARTICIPANT_STATUSES = new Set(["pending", "completed", "omitted"]);

const LESSON_KNOWN = new Set([
  "id", "createdAt", "form", "countsAsClass", "billedAmount", "billedAmountByStudent", "appliedPolicy", "calendarReservationKey", "calendarLessonId", "calendarRegistration", "profileAppliedAt",
  "scheduledStartAt", "effectiveStartAt", "actualStartedAt", "actualEndedAt", "scheduleAdjustment", "studentArrival", "startSource", "endSource", "sessionUpdatedAt", "updatedAt",
  "editHistory", "homeworkReviews", "registrationStatus", "groupProgress",
]);
const FORM_KNOWN = new Set([
  "eventType", "activityKind", "studentIds", "date", "time", "scheduledDurationMinutes", "actualDurationMinutes", "modality", "attendance", "topics", "objectives", "activities", "activityNotes",
  "activityAttachments", "materialIds", "evaluations", "internalNotes", "homeworkDescription", "homeworkDueDate", "isBillable", "lateCancellationPolicy", "lateCancellationPercentage",
  "consumesMonthlyPackage", "holidayException", "rescheduledFromLessonId",
]);

const strings = (value: unknown): string[] => arr(value).filter((x): x is string => typeof x === "string");

function adaptEvaluation(entry: Obj, billedByStudent: Obj, ledger: Ledger): Obj {
  const generalRaw = entry.generalGrade ?? null;
  const general = gradeStatus(generalRaw);
  const skillsRaw: Obj = isObj(entry.skillGrades) ? entry.skillGrades : {};
  const skillGrades: Obj = {};
  const flags: string[] = [];
  if (general === "unset" || general === "out_of_range") flags.push(`generalGrade:${general}`);
  for (const [skill, value] of Object.entries(skillsRaw)) {
    const status = gradeStatus(value);
    if (status === "ok" && SKILL_KEYS.has(skill)) skillGrades[skill] = value;
    else if (status !== "absent") flags.push(`skillGrades.${skill}:${SKILL_KEYS.has(skill) ? status : "unknown_skill"}`);
  }
  if (flags.length > 0) ledger.convert("pedagogicalLessons", "grade_kept_as_source_value", "Notas fuera de 1–10 (o sin calificar): la nota válida queda vacía, pero el valor original se conserva en la evaluación (source_grades) y queda marcado para revisión.");
  const studentId = entry.studentId;
  const billed = typeof studentId === "string" && typeof billedByStudent[studentId] === "number" ? (billedByStudent[studentId] as number) : null;
  return {
    studentId,
    generalGrade: general === "ok" ? generalRaw : null,
    skillGrades,
    sourceGrades: { generalGrade: generalRaw, skillGrades: skillsRaw, flags },
    strengths: arr(entry.strengths),
    areasToImprove: arr(entry.areasToImprove),
    individualObservation: text(entry.individualObservation),
    individualHomeworkDescription: text(entry.individualHomeworkDescription),
    individualHomeworkDueDate: entry.individualHomeworkDueDate ? toCivilDateKey(entry.individualHomeworkDueDate) : null,
    billedAmount: billed,
  };
}

function adaptRegistrations(doc: Obj, ledger: Ledger, refs: CalendarRefResolver): Obj[] {
  const source = arr(doc.pedagogicalLessons).filter(isObj);
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const lesson of source) {
    if (!isObj(lesson.form)) {
      ledger.canonicalRows += 1;
      out.push(lesson);
      continue;
    }
    ledger.mobileRows += 1;
    const id = nonEmptyText(lesson.id);
    if (!id) {
      ledger.omit("pedagogicalLessons", null, "missing_id", "Una clase registrada no tiene identificador.");
      continue;
    }
    if (seen.has(id)) {
      ledger.omit("pedagogicalLessons", id, "duplicate_id", "La misma clase registrada aparece dos veces: se importa una sola vez.");
      continue;
    }
    seen.add(id);
    const form = lesson.form as Obj;
    const eventType = text(form.eventType) ?? "clase_dictada";

    const calendarRegistration = isObj(lesson.calendarRegistration) ? lesson.calendarRegistration : null;
    const calendarLessonIdAtOrigin = nonEmptyText(lesson.calendarLessonId) ?? nonEmptyText(calendarRegistration?.lessonId);
    // La app guarda la clase materializada con otro prefijo (`calendar_completed_…`, `calendar_cancelled_…`…) que el id virtual con el que se creó el registro: se enlaza SÓLO
    // si la evidencia es inequívoca (ver `calendar-refs.ts`). Si en el respaldo NO existe ninguna clase de esa ocurrencia (la referencia ya colgaba en el origen), el registro se importa
    // SIN clase de calendario —no se descarta ni se inventa una clase— y conserva la referencia original. Ante cualquier duda queda el id original y la importación se detiene a la vista.
    const calendarOutcome = refs.forRegistration(id);
    const calendarLessonId = refs.registrationTarget(id, calendarLessonIdAtOrigin);
    const calendarMissingAtOrigin = CalendarRefResolver.isMissingAtOrigin(calendarOutcome);
    if (calendarOutcome.kind === "resolved") {
      ledger.convert("pedagogicalLessons", "calendar_lesson_linked_from_occurrence", "Clases registradas cuyo id de clase del calendario era el de la ocurrencia virtual: se enlazan con la clase materializada de la MISMA ocurrencia (misma clave, inicio y alumno; la nota «Registro pedagógico» la confirma). El id original queda en sourceExtras.calendarLessonIdAtOrigin.");
    } else if (calendarMissingAtOrigin) {
      ledger.convert("pedagogicalLessons", "calendar_lesson_missing_at_origin_kept_unlinked", "Clases registradas cuya clase del calendario NO existe en el respaldo (ya faltaba en TeacherFlow anterior): se importan sin clase de calendario, con todo su contenido, y la referencia original queda en sourceExtras.calendarLessonIdAtOrigin. Se declaran como referencias huérfanas del origen.");
    }

    const scheduledStartAt = nonEmptyText(lesson.scheduledStartAt) ?? localToIso(form.date, form.time);
    if (!nonEmptyText(lesson.scheduledStartAt) && scheduledStartAt) ledger.convert("pedagogicalLessons", "start_from_form_date_time", "Clases registradas sin horario programado guardado: se arma con la fecha y hora de la clase (hora de Argentina).");
    const scheduledEndAt = plusMinutes(scheduledStartAt, form.scheduledDurationMinutes);

    let actualStartedAt = nonEmptyText(lesson.actualStartedAt);
    let actualEndedAt = nonEmptyText(lesson.actualEndedAt);
    if ((!actualStartedAt || !actualEndedAt) && eventType === "clase_dictada" && typeof form.actualDurationMinutes === "number" && form.actualDurationMinutes > 0 && scheduledStartAt) {
      actualStartedAt = scheduledStartAt;
      actualEndedAt = plusMinutes(scheduledStartAt, form.actualDurationMinutes);
      ledger.convert("pedagogicalLessons", "actual_times_from_duration", "Clases dictadas sin horas reales guardadas: se calculan desde el horario programado y la duración real (sólo para no perder las horas dictadas). La duración original se conserva aparte.");
    }

    // La web no tiene «alumno ausente» como resultado de la clase: se registra como clase dictada con la asistencia en «ausente»; el resultado original se conserva (sourceEventType).
    let outcome = eventType;
    const absentFromEvent = eventType === "alumno_ausente";
    if (absentFromEvent) {
      outcome = "clase_dictada";
      ledger.convert("pedagogicalLessons", "student_absent_event_to_attendance", "Clases con resultado «alumno ausente»: la web las guarda como clase dictada con asistencia «ausente»; el resultado original se conserva en el registro.");
    } else if (!WEB_OUTCOMES.has(outcome)) {
      ledger.omit("pedagogicalLessons", id, "unknown_event_type", `La clase registrada tiene un resultado desconocido ('${eventType}').`);
      continue;
    }

    const roster = strings(form.studentIds);
    const attendanceIn = arr(form.attendance).filter(isObj);
    const attendance: Obj[] = attendanceIn.map((entry) => {
      const raw = text(entry.status);
      const status = raw && ATTENDANCE_STATUSES.has(raw) ? raw : entry.present === true ? "presente" : "ausente";
      if (!raw) ledger.convert("pedagogicalLessons", "attendance_status_from_present", "Asistencias sin estado detallado: se deduce de «presente / ausente».");
      return { studentId: entry.studentId, status: absentFromEvent ? "ausente" : status, lateMinutes: typeof entry.lateMinutes === "number" ? entry.lateMinutes : null };
    });
    if (absentFromEvent) {
      for (const studentId of roster) if (!attendance.some((a) => a.studentId === studentId)) attendance.push({ studentId, status: "ausente", lateMinutes: null });
    }

    const billedByStudent = isObj(lesson.billedAmountByStudent) ? lesson.billedAmountByStudent : {};
    const evaluations: Obj[] = arr(form.evaluations).filter(isObj).map((entry) => adaptEvaluation(entry, billedByStudent, ledger));

    const policy = outcome === "cancelada_tarde" ? (text(form.lateCancellationPolicy) ?? text(lesson.appliedPolicy)) : null;

    // Estado del registro y de cada participante: la web usa el MISMO mecanismo que la app (registro «en curso» + estado por participante).
    const registrationStatus = lesson.registrationStatus === "partially_registered" ? "in_progress" : "completed";
    const progress = isObj(lesson.groupProgress) ? lesson.groupProgress : null;
    const order = strings(progress?.participantOrder);
    const statusMap: Obj = isObj(progress?.participantStatus) ? (progress?.participantStatus as Obj) : {};
    const participantIds = [...new Set([...order, ...roster])];
    const participantProgress: Obj[] = participantIds.map((studentId, index) => {
      const given = statusMap[studentId];
      const status = typeof given === "string" && PARTICIPANT_STATUSES.has(given) ? given : registrationStatus === "completed" ? "completed" : "pending";
      const position = order.indexOf(studentId);
      return { studentId, status, position: position >= 0 ? position : order.length + index };
    });
    if (registrationStatus === "in_progress") ledger.convert("pedagogicalLessons", "partial_group_registration_kept_in_progress", "Registros grupales a medio completar: se importan «en curso», con el estado y el orden de cada participante, tal como estaban.");

    // Contenido pedagógico propio de la clase.
    const topics = arr(form.topics).filter(isObj).map((t) => ({ id: nonEmptyText(t.id), text: text(t.text) ?? "", status: t.status === "visto" ? "visto" : "planificado" }));
    const attachments: Obj[] = [];
    arr(form.activityAttachments).filter(isObj).forEach((a, index) => {
      const attachmentId = nonEmptyText(a.id) ?? `att_${stableHash(`${id}:${index}`)}`;
      attachments.push({
        id: `${id}:${attachmentId}`,
        sourceAttachmentId: nonEmptyText(a.id),
        name: text(a.name) ?? "",
        kind: a.kind === "image" ? "image" : "pdf",
        mimeType: text(a.mimeType),
        sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
        caption: text(a.caption),
        addedAt: isoOrNull(a.addedAt),
        studentId: nonEmptyText(a.studentId),
        sourceUri: text(a.uri),
      });
    });
    const editHistory: Obj[] = [];
    arr(lesson.editHistory).filter(isObj).forEach((entry, index) => {
      const editedAt = isoOrNull(entry.editedAt);
      if (!editedAt) {
        ledger.omit("pedagogicalLessons", id, "invalid_edit_history_entry", `Una edición del historial de la clase no tiene una fecha válida (entrada ${index + 1}).`);
        return;
      }
      editHistory.push({ editedAt, index, snapshot: entry });
    });

    const unknown: Obj = {};
    for (const [key, value] of Object.entries(lesson)) if (!LESSON_KNOWN.has(key)) { unknown[key] = value; ledger.unknownField("pedagogicalLessons", key); }
    for (const [key, value] of Object.entries(form)) if (!FORM_KNOWN.has(key)) { unknown[`form.${key}`] = value; ledger.unknownField("pedagogicalLessons", `form.${key}`); }
    const sourceExtras: Obj = {
      calendarReservationKey: lesson.calendarReservationKey ?? null,
      profileAppliedAt: lesson.profileAppliedAt ?? null,
      effectiveStartAt: lesson.effectiveStartAt ?? null,
      startSource: lesson.startSource ?? null,
      endSource: lesson.endSource ?? null,
      sessionUpdatedAt: lesson.sessionUpdatedAt ?? null,
      scheduleAdjustment: lesson.scheduleAdjustment ?? null,
      studentArrival: lesson.studentArrival ?? null,
      calendarRegistration: lesson.calendarRegistration ?? null,
      ...(calendarOutcome.kind === "resolved" ? { calendarLessonIdAtOrigin } : {}),
      ...(calendarMissingAtOrigin ? { calendarLessonIdAtOrigin, calendarLessonMissingAtOrigin: true } : {}),
      appliedPolicy: lesson.appliedPolicy ?? null,
      billedAmountByStudent: lesson.billedAmountByStudent ?? null,
      formDate: form.date ?? null,
      formTime: form.time ?? null,
      ...(Object.keys(unknown).length > 0 ? { unknown } : {}),
    };

    out.push({
      id,
      calendarLessonId,
      activityKind: form.activityKind ?? "class",
      countsAsClass: lesson.countsAsClass !== false,
      homeworkDescription: nonEmptyText(form.homeworkDescription),
      homeworkDueDate: form.homeworkDueDate ? toCivilDateKey(form.homeworkDueDate) : null,
      billedAmount: typeof lesson.billedAmount === "number" ? lesson.billedAmount : null,
      scheduledStartAt,
      actualStartedAt,
      actualEndedAt,
      outcome,
      sourceEventType: eventType,
      holidayException: form.holidayException === true,
      modality: text(form.modality),
      scheduledEndAt,
      scheduledDurationMinutes: typeof form.scheduledDurationMinutes === "number" ? form.scheduledDurationMinutes : null,
      actualDurationMinutes: typeof form.actualDurationMinutes === "number" ? form.actualDurationMinutes : null,
      lateCancellationPolicy: policy,
      lateCancellationPercentage: policy === "cobrar_porcentaje" && typeof form.lateCancellationPercentage === "number" ? form.lateCancellationPercentage : null,
      rescheduledFromRegistrationId: nonEmptyText(form.rescheduledFromLessonId),
      roster: roster.map((studentId) => ({ studentId })),
      attendance,
      evaluations,
      homeworkReviews: arr(lesson.homeworkReviews).filter(isObj),
      topics,
      objectives: strings(form.objectives),
      activities: strings(form.activities),
      activityNotes: text(form.activityNotes) ?? "",
      internalNotes: text(form.internalNotes) ?? "",
      materialIds: strings(form.materialIds),
      isBillable: form.isBillable !== false,
      consumesMonthlyPackage: form.consumesMonthlyPackage !== false,
      createdAt: isoOrNull(lesson.createdAt),
      updatedAt: isoOrNull(lesson.updatedAt),
      registrationStatus,
      participantProgress,
      attachments,
      editHistory,
      sourceExtras,
    });
  }
  ledger.count("pedagogicalLessons", source.length, out.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Reportes generados: el snapshot de la app se convierte al de la web (para poder regenerar el PDF) y el original queda dentro (`_mobileRecord`)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function toWebReportSnapshot(record: Obj): Obj {
  const mobile = isObj(record.snapshot) ? record.snapshot : {};
  const data = isObj(mobile.data) ? mobile.data : {};
  const att = isObj(data.attendance) ? data.attendance : {};
  const period = isObj(data.period) ? data.period : {};
  const punctual = isObj(data.punctualityAndAttendance) ? data.punctualityAndAttendance : null;
  const evaluated = typeof punctual?.evaluatedClasses === "number" ? punctual.evaluatedClasses : 0;
  const lateCount = typeof punctual?.lateArrivalsCount === "number" ? punctual.lateArrivalsCount : 0;
  const onTimePct = typeof punctual?.onTimeOrGracePercent === "number" ? punctual.onTimeOrGracePercent : null;
  return {
    data: {
      classesHeld: typeof att.classesHeld === "number" ? att.classesHeld : 0,
      hoursTaught: typeof data.hoursTaught === "number" ? data.hoursTaught : 0,
      skillNotes: arr(data.skillNotes).filter(isObj).map((n) => ({ skill: n.skill, label: n.label, averageGrade: typeof n.averageGrade === "number" ? n.averageGrade : null })),
      generalAverageGrade: typeof data.generalAverageGrade === "number" ? data.generalAverageGrade : null,
      strengths: strings(data.strengths),
      areasToImprove: strings(data.areasToImprove),
      homeworkAssigned: strings(data.homeworkAssigned),
      attendance: { classesHeld: att.classesHeld ?? 0, classesAttended: att.classesAttended ?? 0, classesAbsent: att.classesAbsent ?? 0, ratePercent: typeof att.ratePercent === "number" ? att.ratePercent : null },
      punctuality: {
        classesWithAttendanceData: evaluated,
        onTimeCount: onTimePct === null ? 0 : Math.round((evaluated * onTimePct) / 100),
        lateCount,
        averageLateMinutes: typeof punctual?.averageLateMinutes === "number" ? punctual.averageLateMinutes : null,
      },
      lessonDetails: arr(data.lessonDetails).filter(isObj).map((d) => ({
        dateKey: d.date,
        attended: d.present === true,
        attendanceStatus: d.present === true ? "presente" : "ausente",
        generalGrade: typeof d.generalGrade === "number" ? d.generalGrade : null,
        durationMinutes: typeof d.durationMinutes === "number" ? d.durationMinutes : 0,
      })),
    },
    narrativeText: text(mobile.narrativeText) ?? "",
    includeClassDetail: mobile.includeClassDetail === true,
    includePunctualitySummary: mobile.includePunctualitySummary === true,
    teacherNotes: { generalComment: "", behaviorAndParticipation: "", nextObjectives: "", recommendations: "" },
    studentName: text(data.studentName) ?? "",
    monthsSummaryLabel: text(period.label) ?? text(record.title) ?? "",
    _mobileRecord: { permanentPdfUri: record.permanentPdfUri ?? null, schemaVersion: record.schemaVersion ?? null, snapshot: record.snapshot ?? null },
  };
}

function adaptReports(doc: Obj, ledger: Ledger): Obj[] {
  const source = arr(doc.reportRecords).filter(isObj);
  const known = new Set(arr(doc.students).filter(isObj).map((x) => x.id).concat(Object.keys(isObj(doc.profiles) ? doc.profiles : {})));
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const record of source) {
    if (isObj(record.snapshot) && isObj((record.snapshot as Obj)._mobileRecord)) {
      ledger.canonicalRows += 1;
      out.push(record);
      continue;
    }
    const id = nonEmptyText(record.id);
    if (!id) {
      ledger.omit("reportRecords", null, "missing_id", "Un reporte generado no tiene identificador.");
      continue;
    }
    if (seen.has(id)) {
      ledger.omit("reportRecords", id, "duplicate_id", "El mismo reporte aparece dos veces: se importa una sola vez.");
      continue;
    }
    seen.add(id);
    const generatedAt = isoOrNull(record.generatedAt);
    const periodStart = toCivilDateKey(record.periodStart);
    const periodEnd = toCivilDateKey(record.periodEnd);
    if (!nonEmptyText(record.studentId) || !known.has(record.studentId)) {
      ledger.omit("reportRecords", id, "report_without_student", "El reporte pertenece a un alumno que no está en la copia: no se puede importar sin inventar al alumno.");
      continue;
    }
    if (!generatedAt || !periodStart || !periodEnd) {
      ledger.omit("reportRecords", id, "report_invalid_dates", "El reporte no tiene fechas válidas (generado, inicio o fin del período).");
      continue;
    }
    ledger.convert("reportRecords", "snapshot_to_web_format", "Reportes generados: el contenido se pasa al formato de la web para poder volver a generar el PDF; el registro original completo queda dentro del reporte.");
    out.push({
      id,
      studentId: record.studentId,
      title: text(record.title) ?? "",
      selectedMonths: strings(record.selectedMonths),
      periodStart,
      periodEnd,
      generatedAt,
      schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
      snapshot: toWebReportSnapshot(record),
    });
  }
  ledger.count("reportRecords", source.length, out.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Cobros y finanzas
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function mapRows(doc: Obj, key: string, ledger: Ledger, isCanonical: ((row: Obj) => boolean) | null, convert: (row: Obj) => Obj, requiredId = true): Obj[] {
  const source = arr(doc[key]).filter(isObj);
  const out: Obj[] = [];
  const seen = new Set<string>();
  for (const row of source) {
    if (isCanonical?.(row)) {
      ledger.canonicalRows += 1;
      out.push(row);
      continue;
    }
    // Sin predicado (`null`): la forma de la fila es la misma en ambos formatos, así que no cuenta para decidir el formato del documento.
    if (isCanonical) ledger.mobileRows += 1;
    const id = nonEmptyText(row.id);
    if (requiredId && !id) {
      ledger.omit(key, null, "missing_id", "Una fila no tiene identificador.");
      continue;
    }
    if (id) {
      if (seen.has(id)) {
        ledger.omit(key, id, "duplicate_id", "La misma fila aparece dos veces: se importa una sola vez.");
        continue;
      }
      seen.add(id);
    }
    out.push(convert(row));
  }
  ledger.count(key, source.length, out.length);
  return out;
}

/** Clase del calendario de un cobro por clase: la de la ocurrencia materializada si la evidencia es inequívoca; si no, el id original (sin inventar nada). */
function chargeCalendarLessonId(charge: Obj, refs: CalendarRefResolver, ledger: Ledger): string | null {
  const original = nonEmptyText(charge.calendarLessonId);
  const outcome = refs.forCharge(original, nonEmptyText(charge.savedLessonId));
  if (outcome.kind === "resolved") {
    ledger.convert("paymentCharges", "calendar_lesson_linked_from_occurrence", "Cobros por clase cuyo id de clase del calendario era el de la ocurrencia virtual: se enlazan con la clase materializada de la misma ocurrencia.");
  } else if (CalendarRefResolver.isMissingAtOrigin(outcome)) {
    ledger.convert("paymentCharges", "calendar_lesson_missing_at_origin", "Cobros por clase cuya clase del calendario no existe en el respaldo (ya faltaba en TeacherFlow anterior): el cobro se importa completo, sin ese enlace. La referencia queda sólo en el archivo del origen.");
  }
  return refs.chargeTarget(original, nonEmptyText(charge.savedLessonId));
}

function paymentIdSet(doc: Obj): Set<string> {
  return new Set(arr(doc.payments).filter(isObj).map((p) => nonEmptyText(p.id)).filter((id): id is string => id !== null));
}
/** Id de pago para la relación: el del respaldo si existe; `null` si no existe (no se inventa un pago). */
function existingPaymentId(doc: Obj, value: unknown): string | null {
  const id = nonEmptyText(value);
  return id !== null && paymentIdSet(doc).has(id) ? id : null;
}
/** Referencia original a un pago que NO existe en el respaldo (para conservarla); `null` si no hay referencia o el pago existe. */
function missingPaymentRef(doc: Obj, value: unknown): string | null {
  const id = nonEmptyText(value);
  return id !== null && !paymentIdSet(doc).has(id) ? id : null;
}

function studentIdSet(doc: Obj): Set<string> {
  return new Set(arr(doc.students).filter(isObj).map((s) => nonEmptyText(s.id)).filter((id): id is string => id !== null));
}
function existingStudentId(doc: Obj, value: unknown): string | null {
  const id = nonEmptyText(value);
  return id !== null && studentIdSet(doc).has(id) ? id : null;
}
function missingStudentRef(doc: Obj, value: unknown): string | null {
  const id = nonEmptyText(value);
  return id !== null && !studentIdSet(doc).has(id) ? id : null;
}

function adaptFinance(doc: Obj, ledger: Ledger, refs: CalendarRefResolver): Record<string, Obj[]> {
  const charges = mapRows(doc, "paymentCharges", ledger, (r) => r.chargeType !== undefined, (r) => ({
    id: r.id,
    studentId: r.studentId,
    chargeType: r.type,
    originalAmount: r.originalAmount,
    currency: r.currency ?? "ARS",
    dueDate: toCivilDateKey(r.dueDate),
    billingPeriod: text(r.billingPeriod),
    savedLessonId: nonEmptyText(r.savedLessonId),
    packageId: nonEmptyText(r.packageId),
    trainingBillingAgreementId: nonEmptyText(r.trainingBillingAgreementId),
    trainingSeriesName: text(r.trainingSeriesName),
    calendarLessonId: chargeCalendarLessonId(r, refs, ledger),
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason),
    createdAt: r.createdAt ?? null,
  }));
  const payments = mapRows(doc, "payments", ledger, null, (r) => ({
    id: r.id,
    studentId: r.studentId,
    amount: r.amount,
    currency: r.currency ?? "ARS",
    method: r.method,
    paidAt: toCivilDateKey(r.paidAt),
    notes: text(r.notes),
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason),
    replacesPaymentId: nonEmptyText(r.replacesPaymentId),
    source: r.source ?? null,
    recordedAt: r.recordedAt ?? null,
  }));
  // Un cobro cuyas asignaciones vigentes superan su importe base NO se corrige ni se reparte de nuevo: el exceso se separa EXPLÍCITAMENTE en la asignación que lo produce (vinculada a su pago) y se clasifica
  // con la evidencia del cálculo de recargos de la app (ver surcharge-evidence.ts): `recargo_confirmado` sólo si el motor lo explica exactamente; si no, `pendiente_de_clasificacion` sin inventar causa.
  const excesses = classifyAllExcesses(doc);
  const allocations = mapRows(doc, "paymentAllocations", ledger, null, (r) => {
    const excess = typeof r.id === "string" ? excesses.get(r.id) : undefined;
    if (excess) ledger.convert("paymentAllocations", excess.status === "recargo_confirmado" ? "excess_classified_confirmed_surcharge" : "excess_pending_classification", excess.status === "recargo_confirmado" ? "Asignaciones con exceso sobre el importe base que el cálculo de recargos de TeacherFlow anterior confirma exactamente: el exceso se guarda separado, como recargo confirmado." : "Asignaciones con exceso sobre el importe base que el cálculo de TeacherFlow anterior NO explica: el exceso se conserva separado, «pendiente de clasificación», sin atribuirle una causa.");
    return { id: r.id, paymentId: r.paymentId, chargeId: r.chargeId, studentId: r.studentId, amount: r.amount, ...(excess ? { excess: { amount: excess.excessAmount, status: excess.status, evidence: excess.evidence } } : {}) };
  });
  const adjustments = mapRows(doc, "paymentAdjustments", ledger, null, (r) => ({ id: r.id, chargeId: r.chargeId, studentId: r.studentId, reason: r.reason, voidedAt: r.voidedAt ?? null, voidReason: text(r.voidReason), createdAt: r.createdAt ?? null }));
  const packagePurchases = mapRows(doc, "packagePurchases", ledger, null, (r) => ({
    id: r.id,
    studentId: r.studentId,
    includedClasses: r.includedClasses,
    amount: r.amount,
    validFrom: toCivilDateKey(r.validFrom),
    validUntil: r.validUntil ? toCivilDateKey(r.validUntil) : null,
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason),
    createdAt: r.createdAt ?? null,
  }));
  const creditMovements = mapRows(doc, "packageCreditMovements", ledger, (r) => r.movementType !== undefined, (r) => ({
    id: r.id,
    packageId: r.packageId,
    studentId: r.studentId,
    movementType: r.type,
    amount: r.amount,
    savedLessonId: nonEmptyText(r.savedLessonId),
    reason: text(r.reason),
    voidedAt: r.voidedAt ?? null,
    voidReason: text(r.voidReason),
    createdAt: r.createdAt ?? null,
  }));
  const surcharges = mapRows(doc, "initialPaidSurchargeCorrections", ledger, null, (r) => ({
    id: r.id,
    // Un alumno que no existe en el respaldo NO se inventa: la relación queda vacía y la referencia original se conserva.
    studentId: existingStudentId(doc, r.studentId),
    studentMissingRef: missingStudentRef(doc, r.studentId),
    billingPeriod: r.billingPeriod,
    previousSurchargeAmount: r.previousSurchargeAmount,
    // Un pago que no existe en el respaldo NO se inventa: la relación queda vacía y la referencia original se guarda tal cual (además de la incidencia explícita).
    voidedPaymentId: existingPaymentId(doc, r.voidedPaymentId),
    newPaymentId: existingPaymentId(doc, r.newPaymentId),
    voidedPaymentMissingRef: missingPaymentRef(doc, r.voidedPaymentId),
    newPaymentMissingRef: missingPaymentRef(doc, r.newPaymentId),
    correctedAt: r.correctedAt,
    reason: r.reason,
  }));
  const proration = mapRows(doc, "firstMonthProrationDecisions", ledger, null, (r) => ({
    id: r.id,
    studentId: r.studentId,
    billingPeriod: r.billingPeriod,
    effectiveJoinDate: toCivilDateKey(r.effectiveJoinDate),
    criterion: r.criterion,
    classesRemaining: r.classesRemaining,
    classesPerFullPeriod: r.classesPerFullPeriod,
    permanentMonthlyAmount: r.permanentMonthlyAmount,
    chargedAmount: r.chargedAmount,
    chargeId: nonEmptyText(r.chargeId),
    confirmedAt: r.confirmedAt,
    source: r.source ?? null,
    createdAt: r.createdAt ?? null,
    recurrenceIds: r.recurrenceIds ?? null,
    seriesPatternSnapshot: r.seriesPatternSnapshot ?? null,
    ruleVersion: r.ruleVersion ?? null,
  }));
  const agreements = mapRows(doc, "trainingBillingAgreements", ledger, null, (r) => ({
    id: r.id,
    monthlyFee: r.monthlyFee,
    pendingMonthlyFee: typeof r.pendingMonthlyFee === "number" ? r.pendingMonthlyFee : null,
    pendingMonthlyFeeEffectiveFrom: text(r.pendingMonthlyFeeEffectiveFrom),
    startPeriod: r.startPeriod,
    createdAt: r.createdAt ?? null,
  }));
  const monthly = mapRows(doc, "monthlyAmountCorrections", ledger, null, (r) => ({
    id: r.id,
    studentId: r.studentId,
    billingPeriod: r.billingPeriod,
    previousAmount: r.previousAmount,
    newAmount: r.newAmount,
    changedAt: r.changedAt ?? null,
    reason: typeof r.reason === "string" ? r.reason : "",
    effectiveFrom: r.effectiveFrom === "this_month" || r.effectiveFrom === "next_month" ? r.effectiveFrom : null,
  }));
  const reports = adaptReports(doc, ledger);
  const levels = mapRows(doc, "customLevels", ledger, null, (r) => ({ ...r }));
  return { paymentCharges: charges, payments, paymentAllocations: allocations, paymentAdjustments: adjustments, packagePurchases, packageCreditMovements: creditMovements, initialPaidSurchargeCorrections: surcharges, firstMonthProrationDecisions: proration, trainingBillingAgreements: agreements, monthlyAmountCorrections: monthly, reportRecords: reports, customLevels: levels };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Datos del origen que no tienen destino en las tablas de la web (se cuentan; el detalle queda en el archivo de origen)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function countRows(rows: unknown[], pick: (row: Obj) => unknown): number {
  let count = 0;
  for (const row of rows) if (isObj(row) && hasContent(pick(row))) count += 1;
  return count;
}

function describeNotRepresented(doc: Obj, ledger: Ledger): AdaptNotRepresented[] {
  const out: AdaptNotRepresented[] = [];
  // Cada campo del origen tiene destino (columna propia o `source_extras`): lo único que queda acá es lo que NINGÚN mapeo conoce.
  for (const [key, rows] of ledger.unknown) {
    const [collection, field] = key.split("\u0000");
    out.push({ collection, field, rows, message: "El respaldo trae un campo que esta versión de la web no conoce: se conserva tal cual en el registro (source_extras), pero hay que revisar a qué corresponde." });
  }
  void doc;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const KNOWN_TOP_LEVEL = new Set([
  "originIncidents",
  "schemaVersion", "exportedAt", "appVersion", "students", "profiles", "pedagogicalLessons", "calendarLessons", "recurrenceRules", "recurrenceExceptions", "teacherAvailability",
  "paymentCharges", "payments", "paymentAllocations", "paymentAdjustments", "reportRecords", "packagePurchases", "packageCreditMovements", "teacherProfile", "monthlyAmountCorrections",
  "initialPaidSurchargeCorrections", "surchargeSettings", "budgetDistribution", "customLevels", "firstMonthProrationDecisions", "trainingBillingAgreements",
]);

export function adaptMobileBackup(raw: unknown): AdaptResult {
  const doc: Obj = isObj(raw) ? raw : {};
  const ledger = new Ledger();
  const { students, profiles } = adaptStudents(doc, ledger);
  const refs = new CalendarRefResolver(arr(doc.calendarLessons), arr(doc.pedagogicalLessons));
  const finance = adaptFinance(doc, ledger, refs);

  const adapted: Obj = {
    students,
    profiles,
    recurrenceRules: adaptRules(doc, ledger),
    calendarLessons: adaptCalendarLessons(doc, ledger),
    recurrenceExceptions: adaptExceptions(doc, ledger),
    pedagogicalLessons: adaptRegistrations(doc, ledger, refs),
    ...finance,
  };
  // Sólo se reemplazan las colecciones que el documento ya traía: una colección ausente sigue ausente y la validación la señala.
  const payload: Obj = { ...doc };
  for (const [key, value] of Object.entries(adapted)) if (key in doc) payload[key] = value;
  // Referencias que YA estaban rotas en el origen: se conservan como incidencias explícitas (el contenido de las filas afectadas se importa completo). Idempotente: si el documento ya las trae, no se recalculan.
  if (!("originIncidents" in doc)) {
    const incidents = buildOriginIncidents(doc, refs);
    if (incidents.length > 0) {
      payload.originIncidents = incidents;
      ledger.convert("originIncidents", "origin_incidents_recorded", "Referencias que ya estaban rotas en TeacherFlow anterior (apuntan a algo que no existe en el respaldo): se conservan como incidencias explícitas con su referencia original; el contenido de las filas afectadas se importa completo.", incidents.length);
    }
  }

  for (const key of Object.keys(doc)) {
    if (!KNOWN_TOP_LEVEL.has(key)) ledger.omit("(documento)", key, "unknown_top_level_key", `El respaldo trae una colección que la web no conoce ('${key}'): no se importa.`);
  }

  const shape: AdaptReport["shape"] = ledger.mobileRows > 0 && ledger.canonicalRows > 0 ? "mixed" : ledger.mobileRows > 0 ? "mobile" : "canonical";
  return {
    payload,
    report: {
      shape,
      perCollection: ledger.perCollection,
      omitted: ledger.omitted,
      conversions: [...ledger.conversions.values()],
      notRepresented: describeNotRepresented(doc, ledger),
    },
  };
}
