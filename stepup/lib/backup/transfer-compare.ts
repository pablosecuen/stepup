/**
 * Comparación ORIGEN ↔ DESTINO del traslado desde la app móvil. Función pura: recibe el respaldo crudo de la app (el JSON original, antes de adaptar
 * nada) y un volcado de SÓLO LECTURA de las tablas de la web (una lista de filas por tabla). No escribe ni usa la red.
 *
 * Qué compara (nada se da por bueno porque «el texto aparece en algún lado»):
 *   1. ENTIDADES: cada fila del origen se busca en el destino por su identificador de origen (`legacy_mobile_id`, o la clave compuesta de las filas hijas:
 *      registro + alumno, serie + ocurrencia…). Faltantes, sobrantes y duplicados se listan por identificador.
 *   2. CAMPOS: de cada fila encontrada se compara cada campo con SU columna de destino (fechas por instante o día civil, importes numéricos, listas, jsonb).
 *      Un valor que apareciera en otra fila (alumnos o clases intercambiados) o con otro importe NO pasa.
 *   3. RELACIONES: cada referencia del origen (cobro → alumno, pago → cobro, clase → serie…) se compara contra la fila de destino a la que apunta de verdad
 *      (se traduce el uuid al identificador de origen), nunca por posición.
 *   4. CAMPOS SIN DECLARAR: una clave del origen que ningún mapeo conoce se informa (no se ignora): es un dato sin destino.
 *   5. ARCHIVOS: adjuntos, materiales y PDF de reportes: «disponible» sólo si el archivo está registrado con su huella; «pendiente» si falta extraerlo.
 *
 * Veredicto: COMPLETO sólo si no falta ninguna fila, ningún campo difiere, no hay claves sin declarar, ninguna fila fue omitida por el adaptador y no quedan
 * archivos pendientes. Lo que sólo está preservado en el archivo del origen (`import_source_archives`) se lista aparte y NUNCA cuenta como migrado.
 */
import { stableHash, toCivilDateKey, localToIso, plusMinutes } from "./mobile-adapter.ts";
import { CalendarRefResolver } from "./calendar-refs.ts";
import { buildOriginIncidents, type OriginIncident } from "./origin-incidents.ts";
import { classifyAllExcesses, type AllocationExcess } from "./surcharge-evidence.ts";

type Obj = Record<string, unknown>;
export type DestinationDump = Record<string, Obj[]>;

export interface EntityLine {
  entity: string;
  table: string;
  source: number;
  omitted: number;
  expected: number;
  destination: number;
  /** Identificadores de origen que debían estar y no están. */
  missing: string[];
  /** Filas de destino con identificador de origen que el respaldo no trae (informativo: pueden ser de importaciones anteriores). */
  extra: string[];
  ok: boolean;
}
export interface FieldLine {
  entity: string;
  field: string;
  checked: number;
  migrated: number;
  mismatched: number;
  examples: Array<{ id: string; source: string; destination: string }>;
}
export interface UndeclaredLine {
  entity: string;
  key: string;
  rows: number;
  examples: string[];
  /** ¿El valor está en el archivo del origen (import_source_archives)? Aun así NO cuenta como migrado. */
  preservedInArchive: boolean;
}
export interface FileLine {
  kind: "adjunto" | "material" | "reporte_pdf";
  total: number;
  available: number;
  pending: number;
  unavailableAtOrigin: number;
  examples: string[];
}
export interface DuplicateLine {
  table: string;
  legacyId: string;
  count: number;
}
export interface Reconciliation {
  /** Filas del origen (todas las entidades). */
  sourceRows: number;
  /** Filas que el adaptador declaró como NO migradas. */
  omittedByAdapter: number;
  /** Filas que deben estar en la web: origen − omitidas. */
  expectedRows: number;
  /** De las esperadas, las que se encontraron en la web. */
  foundRows: number;
  /** De las esperadas, las que faltan. */
  missingRows: number;
  /** Filas de la web con identificador de origen que el respaldo no trae (informativo). */
  extraRows: number;
  /** origen = omitidas + esperadas, y esperadas = encontradas + faltantes. */
  balanced: boolean;
}
export interface TransferComparison {
  entities: EntityLine[];
  fields: FieldLine[];
  undeclared: UndeclaredLine[];
  files: FileLine[];
  duplicates: DuplicateLine[];
  omittedByAdapter: number;
  /** Referencias que ya estaban rotas en TeacherFlow anterior (la clase, el pago o el alumno no existen en el respaldo): se conservan como incidencias explícitas; son inconsistencias del ORIGEN, no defectos del traslado. */
  originIncidents: OriginIncident[];
  /** Balance inequívoco: lo que hay en el origen, lo declarado como no migrado por el adaptador, lo esperado, lo que hay en el destino y lo que falta. */
  reconciliation: Reconciliation;
  summary: { entities: number; rowsExpected: number; rowsFound: number; fieldChecks: number; fieldMismatches: number };
  /** Datos preservados sólo en el archivo del origen: NO migrados. */
  preservedOnlyInArchive: string[];
  /**
   * `complete`: nada sin migrar, sin diferencias y sin archivos pendientes. `absentAtOrigin`: archivos que el teléfono YA NO tenía (declarados por la extracción):
   * NO están migrados (no existen en ningún lado) y se informan siempre aparte, aun con veredicto completo.
   */
  verdict: { complete: boolean; reasons: string[]; absentAtOrigin: number; /** Referencias ya rotas en el origen, conservadas como incidencias (informativo: no bloquea el cierre). */ originInconsistencies: number; /** `false` mientras no se haya leído el teléfono: «0 ausentes» no está comprobado. */ absentAtOriginVerified: boolean };
}

// ── Utilidades de comparación ─────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type Cmp = "text" | "num" | "bool" | "instant" | "date" | "array" | "sarray" | "json";

const ms = (v: unknown): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};
const civil = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? toCivilDateKey(v) : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const canonical = (v: unknown): string => {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e9) / 1e9);
  return JSON.stringify(v);
};

function same(cmp: Cmp, a: unknown, b: unknown): boolean {
  switch (cmp) {
    case "text": {
      const na = a === null || a === undefined || a === "" ? null : String(a);
      const nb = b === null || b === undefined || b === "" ? null : String(b);
      return na === nb;
    }
    case "num": {
      const na = num(a);
      const nb = num(b);
      if (na === null || nb === null) return na === nb;
      return Math.abs(na - nb) < 1e-9;
    }
    case "bool":
      return (a === true) === (b === true);
    case "instant":
      return ms(a) === ms(b);
    case "date": {
      const na = typeof a === "string" && a !== "" ? a.slice(0, 10) : null;
      const nb = typeof b === "string" && b !== "" ? b.slice(0, 10) : null;
      return na === nb;
    }
    case "array": {
      const la = Array.isArray(a) ? a : [];
      const lb = Array.isArray(b) ? b : [];
      return la.length === lb.length && la.every((x, i) => String(x) === String(lb[i]));
    }
    case "sarray": {
      const la = (Array.isArray(a) ? a : []).map(String).sort();
      const lb = (Array.isArray(b) ? b : []).map(String).sort();
      return la.length === lb.length && la.every((x, i) => x === lb[i]);
    }
    case "json":
      return canonical(a) === canonical(b);
  }
}

/**
 * Cómo se muestra un valor en un ejemplo de diferencia. Por defecto NUNCA el valor (puede ser un nombre, un teléfono o un importe real): sólo su tipo, su
 * largo y una huella corta, suficiente para ver SI dos valores difieren sin que el informe, un log o un archivo guarden datos personales.
 */
const show = (v: unknown, reveal: boolean): string => {
  if (v === null || v === undefined) return "∅";
  const text = typeof v === "string" ? v : canonical(v);
  if (!reveal) return `«${typeof v === "string" ? "texto" : Array.isArray(v) ? "lista" : typeof v === "object" ? "objeto" : typeof v}, ${text.length} car., #${stableHash(text)}»`;
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

// ── Contexto: traducción de uuid de destino → identificador de origen ─────────────────────────────────────────────────

interface Ctx {
  doc: Obj;
  dump: DestinationDump;
  /** Identificador de origen de la fila de destino con ese uuid (o null si no tiene). */
  legacy(table: string, uuid: unknown): string | null;
  /** `student_source_extras.extras` por uuid de alumno. */
  studentExtras: Map<string, unknown>;
  /** Misma correspondencia que aplica el adaptador entre ids virtuales de ocurrencias y clases materializadas del calendario. */
  calendarRefs: CalendarRefResolver;
  /** Exceso (separado y clasificado) de cada asignación que supera el importe base de su cobro. */
  excesses: Map<string, AllocationExcess>;
  /** Referencias que ya estaban rotas en el origen: deben quedar como incidencias explícitas en la web. */
  incidents: OriginIncident[];
  studentIds: Set<string>;
  paymentIds: Set<string>;
}

function buildCtx(doc: Obj, dump: DestinationDump): Ctx {
  const maps = new Map<string, Map<string, string | null>>();
  for (const [table, rows] of Object.entries(dump)) {
    const m = new Map<string, string | null>();
    for (const r of rows) if (typeof r.id === "string") m.set(r.id, typeof r.legacy_mobile_id === "string" ? r.legacy_mobile_id : null);
    maps.set(table, m);
  }
  const studentExtras = new Map<string, unknown>();
  for (const row of dump.student_source_extras ?? []) if (typeof row.student_id === "string") studentExtras.set(row.student_id, row.extras);
  const calendarRefs = new CalendarRefResolver(arr(doc.calendarLessons), arr(doc.pedagogicalLessons));
  return {
    doc,
    dump,
    legacy: (table, uuid) => (typeof uuid === "string" ? (maps.get(table)?.get(uuid) ?? null) : null),
    studentExtras,
    calendarRefs,
    excesses: classifyAllExcesses(doc),
    incidents: buildOriginIncidents(doc, calendarRefs),
    studentIds: new Set(arr(doc.students).map((r) => str(r.id)).filter((v): v is string => v !== null)),
    paymentIds: new Set(arr(doc.payments).map((r) => str(r.id)).filter((v): v is string => v !== null)),
  };
}

/** Una relación a una clase del calendario sólo se espera en la web si esa clase EXISTE en el respaldo; si ya colgaba en el origen no hay a qué enlazar (`null`) y se declara aparte. */
function existingCalendarRef(x: Ctx, value: unknown): string | null {
  const ref = str(value);
  return ref !== null && x.calendarRefs.has(ref) ? ref : null;
}

// ── Especificación por entidad ────────────────────────────────────────────────────────────────────────────────────────

interface FieldSpec {
  f: string;
  cmp: Cmp;
  /** Sólo se compara cuando el origen trae el dato (si no, la columna de la web tiene su propio valor por defecto, p. ej. la hora de la importación). */
  whenPresent?: boolean;
  src: (row: Obj, x: Ctx) => unknown;
  dst: (d: Obj, x: Ctx) => unknown;
}
interface SourceRow {
  id: string;
  row: Obj;
}
interface EntitySpec {
  name: string;
  table: string;
  /** Clave de las omisiones del adaptador (`collection`) que se informan como no migradas. */
  omitKey?: string;
  rows: (x: Ctx) => SourceRow[];
  /** Clave de la fila de destino (por defecto, `legacy_mobile_id`). */
  key?: (d: Obj, x: Ctx) => string | null;
  /** Historiales sin identificador de origen: se comparan por posición ordenada dentro del grupo. */
  rank?: boolean;
  fields: FieldSpec[];
  /** Claves de la fila del origen que algún campo (o una excepción documentada) cubre; el resto se informa como «sin declarar». */
  keys?: string[];
}

const get = (k: string) => (r: Obj) => r[k];
const col = (k: string) => (d: Obj) => d[k];
const T = (f: string, srcKey: string, dstCol: string, cmp: Cmp = "text"): FieldSpec => ({ f, cmp, src: get(srcKey), dst: col(dstCol) });
const rel = (f: string, srcKey: string, dstCol: string, table: string): FieldSpec => ({ f: `${f} (relación)`, cmp: "text", src: (r) => str(r[srcKey]), dst: (d, x) => x.legacy(table, d[dstCol]) });
const withId = (rows: Obj[], key = "id"): SourceRow[] => rows.flatMap((row) => (str(row[key]) ? [{ id: row[key] as string, row }] : []));
const nonNull = (v: unknown) => (v === undefined ? null : v);

const form = (l: Obj): Obj => (isObj(l.form) ? l.form : {});
const profileOf = (x: Ctx, id: string): Obj => (isObj(x.doc.profiles) && isObj((x.doc.profiles as Obj)[id]) ? ((x.doc.profiles as Obj)[id] as Obj) : {});

const CARD_MAPPED = new Set(["id", "name", "levels", "modality", "status", "isFeatured", "isNew"]);
const PROFILE_MAPPED = new Set([
  "id", "name", "phone", "whatsapp", "email", "usualDays", "usualTime", "notes", "birthDate", "levels", "initialLevel", "modality", "status", "category", "billingType", "billingPlan", "dateJoined",
  "lastReactivatedAt", "statusChangeDate", "usualDurationMinutes", "weeklyFrequency", "price", "pendingHomework", "alerts", "currentGoals", "strengths", "areasToImprove", "levelHistory", "statusHistory",
  "priceHistory",
]);
const STUDENT_STATUSES = new Set(["activo", "pausado", "inactivo", "archivado"]);

/** Lo que debe quedar en `students.source_extras` (datos calculados por la app, entradas de historial inválidas y valores de la tarjeta que difieren de la ficha). */
function expectedStudentExtras(row: Obj): Obj {
  const card = isObj(row.card) ? row.card : {};
  const profile = isObj(row.profile) ? row.profile : {};
  const cardExtras: Obj = {};
  for (const [k, v] of Object.entries(card)) {
    if (!CARD_MAPPED.has(k)) cardExtras[k] = v;
    else if (k !== "id" && profile[k] !== undefined && canonical(profile[k]) !== canonical(v)) cardExtras[k] = v;
  }
  const profileExtras: Obj = {};
  for (const [k, v] of Object.entries(profile)) if (!PROFILE_MAPPED.has(k)) profileExtras[k] = v;
  const invalid = { statusHistory: [] as Obj[], priceHistory: [] as Obj[] };
  for (const e of arr(profile.statusHistory)) if (!civil(e.date) || typeof e.status !== "string" || !STUDENT_STATUSES.has(e.status)) invalid.statusHistory.push(e);
  for (const e of arr(profile.priceHistory)) if (!civil(e.date) || typeof e.price !== "number" || !Number.isFinite(e.price) || e.price < 0) invalid.priceHistory.push(e);
  const out: Obj = {};
  if (Object.keys(cardExtras).length > 0) out.card = cardExtras;
  if (Object.keys(profileExtras).length > 0) out.profile = profileExtras;
  if (invalid.statusHistory.length > 0 || invalid.priceHistory.length > 0) out.invalidHistory = invalid;
  return out;
}

function studentRows(x: Ctx): SourceRow[] {
  return withId(arr(x.doc.students)).map(({ id, row: card }) => ({ id, row: { card, profile: profileOf(x, id) } }));
}
const pick = (r: Obj, k: string): unknown => {
  const profile = isObj(r.profile) ? r.profile : {};
  const card = isObj(r.card) ? r.card : {};
  return profile[k] !== undefined ? profile[k] : card[k];
};
const prof = (r: Obj, k: string): unknown => (isObj(r.profile) ? (r.profile as Obj)[k] : undefined);

const GRADE_OK = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10;
const SKILLS = new Set(["speaking", "listening", "reading", "writing", "grammar", "vocabulary", "pronunciation", "participation"]);
const gradeStatus = (v: unknown): string => {
  if (v === null || v === undefined) return "absent";
  if (typeof v !== "number" || !Number.isFinite(v)) return "out_of_range";
  if (v === 0) return "unset";
  return v >= 1 && v <= 10 ? "ok" : "out_of_range";
};

const LESSON_KEYS = new Set([
  "id", "createdAt", "form", "countsAsClass", "billedAmount", "billedAmountByStudent", "appliedPolicy", "calendarReservationKey", "calendarLessonId", "calendarRegistration", "profileAppliedAt",
  "scheduledStartAt", "effectiveStartAt", "actualStartedAt", "actualEndedAt", "scheduleAdjustment", "studentArrival", "startSource", "endSource", "sessionUpdatedAt", "updatedAt", "editHistory",
  "homeworkReviews", "registrationStatus", "groupProgress",
]);
const FORM_KEYS = new Set([
  "eventType", "activityKind", "studentIds", "date", "time", "scheduledDurationMinutes", "actualDurationMinutes", "modality", "attendance", "topics", "objectives", "activities", "activityNotes",
  "activityAttachments", "materialIds", "evaluations", "internalNotes", "homeworkDescription", "homeworkDueDate", "isBillable", "lateCancellationPolicy", "lateCancellationPercentage",
  "consumesMonthlyPackage", "holidayException", "rescheduledFromLessonId",
]);
const ATTENDANCE = new Set(["presente", "ausente", "tarde", "ausente_aviso", "sin_registrar"]);
const PARTICIPANT = new Set(["pending", "completed", "omitted"]);

const eventType = (l: Obj): string => (typeof form(l).eventType === "string" ? (form(l).eventType as string) : "clase_dictada");
const outcomeOf = (l: Obj): string => (eventType(l) === "alumno_ausente" ? "clase_dictada" : eventType(l));
const scheduledStart = (l: Obj): string | null => str(l.scheduledStartAt) ?? localToIso(form(l).date, form(l).time);
const regStatus = (l: Obj): string => (l.registrationStatus === "partially_registered" ? "in_progress" : "completed");

function actualTimes(l: Obj): { start: string | null; end: string | null } {
  let start = str(l.actualStartedAt);
  let end = str(l.actualEndedAt);
  const f = form(l);
  const sched = scheduledStart(l);
  if ((!start || !end) && eventType(l) === "clase_dictada" && typeof f.actualDurationMinutes === "number" && f.actualDurationMinutes > 0 && sched) {
    start = sched;
    end = plusMinutes(sched, f.actualDurationMinutes);
  }
  return { start, end };
}

const lateCancellationPolicy = (l: Obj): string | null => (outcomeOf(l) === "cancelada_tarde" ? (str(form(l).lateCancellationPolicy) ?? str(l.appliedPolicy)) : null);

function participantProgress(l: Obj): Array<{ studentId: string; status: string; position: number }> {
  const progress = isObj(l.groupProgress) ? l.groupProgress : null;
  const order = strings(progress?.participantOrder);
  const statusMap: Obj = isObj(progress?.participantStatus) ? (progress?.participantStatus as Obj) : {};
  const ids = [...new Set([...order, ...strings(form(l).studentIds)])];
  return ids.map((studentId, index) => {
    const given = statusMap[studentId];
    const status = typeof given === "string" && PARTICIPANT.has(given) ? given : regStatus(l) === "completed" ? "completed" : "pending";
    const position = order.indexOf(studentId);
    return { studentId, status, position: position >= 0 ? position : order.length + index };
  });
}

function expectedTopics(l: Obj): Obj[] {
  return arr(form(l).topics).map((t) => ({ id: str(t.id), text: typeof t.text === "string" ? t.text : "", status: t.status === "visto" ? "visto" : "planificado" }));
}

function expectedLessonExtras(l: Obj, x: Ctx): Obj {
  const f = form(l);
  const outcome = x.calendarRefs.forRegistration(str(l.id) ?? "");
  const linked = outcome.kind === "resolved";
  const missingAtOrigin = CalendarRefResolver.isMissingAtOrigin(outcome);
  const idAtOrigin = str(l.calendarLessonId) ?? str(isObj(l.calendarRegistration) ? l.calendarRegistration.lessonId : null);
  const unknown: Obj = {};
  for (const [k, v] of Object.entries(l)) if (!LESSON_KEYS.has(k)) unknown[k] = v;
  for (const [k, v] of Object.entries(f)) if (!FORM_KEYS.has(k)) unknown[`form.${k}`] = v;
  return {
    calendarReservationKey: l.calendarReservationKey ?? null,
    profileAppliedAt: l.profileAppliedAt ?? null,
    effectiveStartAt: l.effectiveStartAt ?? null,
    startSource: l.startSource ?? null,
    endSource: l.endSource ?? null,
    sessionUpdatedAt: l.sessionUpdatedAt ?? null,
    scheduleAdjustment: l.scheduleAdjustment ?? null,
    studentArrival: l.studentArrival ?? null,
    calendarRegistration: l.calendarRegistration ?? null,
    ...(linked ? { calendarLessonIdAtOrigin: idAtOrigin } : {}),
    ...(missingAtOrigin ? { calendarLessonIdAtOrigin: idAtOrigin, calendarLessonMissingAtOrigin: true } : {}),
    appliedPolicy: l.appliedPolicy ?? null,
    billedAmountByStudent: l.billedAmountByStudent ?? null,
    formDate: f.date ?? null,
    formTime: f.time ?? null,
    ...(Object.keys(unknown).length > 0 ? { unknown } : {}),
  };
}

function lessonRows(x: Ctx): SourceRow[] {
  return withId(arr(x.doc.pedagogicalLessons));
}

/** Filas hijas de las clases registradas con identificador compuesto `claseId#alumnoId` (y variantes). */
function lessonChildren(x: Ctx, children: (l: Obj, id: string) => Array<{ key: string; row: Obj }>): SourceRow[] {
  return lessonRows(x).flatMap(({ id, row }) => children(row, id).map((c) => ({ id: c.key, row: { ...c.row, __lesson: row } })));
}
const regStudentKey = (d: Obj, x: Ctx): string | null => {
  const reg = x.legacy("lesson_registrations", d.lesson_registration_id);
  const stu = x.legacy("students", d.student_id);
  return reg && stu ? `${reg}#${stu}` : null;
};

const LEVEL_KEYS = ["id", "level", "fromLevel", "date", "recordedAt", "previousMilestoneAt", "durationDays", "note", "origin"];

function levelHistoryId(studentId: string, e: Obj, index: number): string {
  return str(e.id) ?? `lvl_${stableHash(`${studentId}|${index}|${typeof e.level === "string" ? e.level : ""}|${typeof e.date === "string" ? e.date : ""}`)}`;
}

/** Entradas de historial agrupadas por alumno y ordenadas (el destino no tiene identificador de origen: se compara por posición dentro del alumno). */
function historyRows(x: Ctx, key: "statusHistory" | "priceHistory"): SourceRow[] {
  const out: SourceRow[] = [];
  for (const [sid, p] of Object.entries(isObj(x.doc.profiles) ? (x.doc.profiles as Obj) : {})) {
    if (!isObj(p)) continue;
    const valid = arr(p[key]).filter((e) =>
      key === "statusHistory" ? !!civil(e.date) && typeof e.status === "string" && STUDENT_STATUSES.has(e.status) : !!civil(e.date) && typeof e.price === "number" && Number.isFinite(e.price) && e.price >= 0
    );
    const sortKey = (e: Obj) => (key === "statusHistory" ? [civil(e.date), e.status, e.reason ?? "", e.internalNote ?? ""] : [civil(e.date), String(e.price)]).join("|");
    valid.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
    valid.forEach((e, i) => out.push({ id: `${sid}#${i + 1}`, row: e }));
  }
  return out;
}

function destHistory(x: Ctx, table: string, sortKey: (d: Obj) => string): Map<string, Obj[]> {
  const grouped = new Map<string, Obj[]>();
  for (const d of x.dump[table] ?? []) {
    const sid = x.legacy("students", d.student_id);
    if (!sid) continue;
    const list = grouped.get(sid) ?? [];
    list.push(d);
    grouped.set(sid, list);
  }
  const out = new Map<string, Obj[]>();
  for (const [sid, list] of grouped) {
    list.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));
    list.forEach((d, i) => out.set(`${sid}#${i + 1}`, [d]));
  }
  return out;
}

const SPECS: EntitySpec[] = [
  // ── Alumnos ──
  {
    name: "Alumnos",
    table: "students",
    omitKey: "students",
    rows: studentRows,
    fields: [
      { f: "name", cmp: "text", src: (r) => pick(r, "name"), dst: col("name") },
      { f: "phone", cmp: "text", src: (r) => prof(r, "phone"), dst: col("phone") },
      { f: "whatsapp", cmp: "text", src: (r) => prof(r, "whatsapp"), dst: col("whatsapp") },
      { f: "email", cmp: "text", src: (r) => prof(r, "email"), dst: col("email") },
      { f: "usualDays", cmp: "array", src: (r) => prof(r, "usualDays"), dst: col("usual_days") },
      { f: "usualTime", cmp: "text", src: (r) => prof(r, "usualTime"), dst: col("usual_time") },
      { f: "notes", cmp: "text", src: (r) => prof(r, "notes"), dst: col("notes") },
      { f: "birthDate", cmp: "date", src: (r) => civil(prof(r, "birthDate")), dst: col("birth_date") },
      { f: "levels", cmp: "array", src: (r) => pick(r, "levels"), dst: col("levels") },
      { f: "initialLevel", cmp: "text", src: (r) => prof(r, "initialLevel") ?? "", dst: col("initial_level") },
      { f: "modality", cmp: "text", src: (r) => pick(r, "modality"), dst: col("modality") },
      { f: "status", cmp: "text", src: (r) => pick(r, "status"), dst: col("status") },
      { f: "category", cmp: "text", src: (r) => prof(r, "category"), dst: col("category") },
      { f: "billingType", cmp: "text", src: (r) => prof(r, "billingType"), dst: col("billing_type") },
      { f: "billingPlan", cmp: "json", src: (r) => prof(r, "billingPlan") ?? null, dst: col("billing_plan") },
      { f: "dateJoined", cmp: "date", src: (r) => civil(prof(r, "dateJoined")), dst: col("date_joined") },
      { f: "lastReactivatedAt", cmp: "date", src: (r) => civil(prof(r, "lastReactivatedAt")), dst: col("last_reactivated_at") },
      { f: "statusChangeDate", cmp: "date", src: (r) => civil(prof(r, "statusChangeDate")), dst: col("status_change_date") },
      { f: "usualDurationMinutes", cmp: "num", src: (r) => prof(r, "usualDurationMinutes"), dst: col("usual_duration_minutes") },
      { f: "weeklyFrequency", cmp: "num", src: (r) => prof(r, "weeklyFrequency"), dst: col("weekly_frequency") },
      { f: "price", cmp: "num", src: (r) => prof(r, "price"), dst: col("price") },
      { f: "pendingHomework", cmp: "text", src: (r) => prof(r, "pendingHomework"), dst: col("pending_homework") },
      { f: "alerts", cmp: "array", src: (r) => prof(r, "alerts"), dst: col("alerts") },
      { f: "currentGoals", cmp: "array", src: (r) => prof(r, "currentGoals"), dst: col("current_goals") },
      { f: "strengths", cmp: "array", src: (r) => prof(r, "strengths"), dst: col("strengths") },
      { f: "areasToImprove", cmp: "array", src: (r) => prof(r, "areasToImprove"), dst: col("areas_to_improve") },
      { f: "isFeatured", cmp: "bool", src: (r) => (isObj(r.card) ? (r.card as Obj).isFeatured === true : false), dst: col("is_featured") },
      { f: "isNew", cmp: "bool", src: (r) => (isObj(r.card) ? (r.card as Obj).isNew === true : false), dst: col("is_new") },
      { f: "datos calculados y otros (student_source_extras)", cmp: "json", src: (r) => expectedStudentExtras(r), dst: (d, x) => x.studentExtras.get(String(d.id)) ?? {} },
    ],
  },
  {
    name: "Historial de niveles",
    table: "student_level_history",
    keys: [...LEVEL_KEYS, "__student"],
    rows: (x) => {
      const out: SourceRow[] = [];
      for (const [sid, p] of Object.entries(isObj(x.doc.profiles) ? (x.doc.profiles as Obj) : {})) {
        if (!isObj(p)) continue;
        arr(p.levelHistory).forEach((e, i) => out.push({ id: levelHistoryId(sid, e, i), row: { ...e, __student: sid } }));
      }
      return out;
    },
    fields: [
      { f: "level", cmp: "text", src: get("level"), dst: col("level") },
      { f: "fromLevel", cmp: "text", src: get("fromLevel"), dst: col("from_level") },
      { f: "date", cmp: "date", src: (r) => civil(r.date), dst: col("achieved_on") },
      { f: "recordedAt", cmp: "instant", src: get("recordedAt"), dst: col("recorded_at") },
      { f: "previousMilestoneAt", cmp: "instant", src: get("previousMilestoneAt"), dst: col("previous_milestone_at") },
      { f: "durationDays", cmp: "num", src: get("durationDays"), dst: col("duration_days") },
      { f: "note", cmp: "text", src: get("note"), dst: col("note") },
      { f: "origin", cmp: "text", src: get("origin"), dst: col("origin") },
      { f: "alumno (relación)", cmp: "text", src: get("__student"), dst: (d, x) => x.legacy("students", d.student_id) },
    ],
  },
  {
    name: "Historial de estados",
    table: "student_status_history",
    rank: true,
    keys: ["status", "date", "reason", "internalNote"],
    rows: (x) => historyRows(x, "statusHistory"),
    fields: [
      { f: "status", cmp: "text", src: get("status"), dst: col("status") },
      { f: "date", cmp: "date", src: (r) => civil(r.date), dst: col("occurred_on") },
      { f: "reason", cmp: "text", src: get("reason"), dst: col("reason") },
      { f: "internalNote", cmp: "text", src: get("internalNote"), dst: col("internal_note") },
      { f: "entrada original (payload_snapshot)", cmp: "json", src: (r) => r, dst: col("payload_snapshot") },
    ],
  },
  {
    name: "Historial de precios",
    table: "student_price_history",
    rank: true,
    keys: ["price", "date"],
    rows: (x) => historyRows(x, "priceHistory"),
    fields: [
      { f: "price", cmp: "num", src: get("price"), dst: col("price") },
      { f: "date", cmp: "date", src: (r) => civil(r.date), dst: col("effective_on") },
      { f: "entrada original (source_entry)", cmp: "json", src: (r) => r, dst: col("source_entry") },
    ],
  },
  {
    name: "Niveles personalizados",
    table: "custom_levels",
    omitKey: "customLevels",
    keys: ["id", "name", "createdAt"],
    rows: (x) => withId(arr(x.doc.customLevels)),
    fields: [T("name", "name", "name"), T("createdAt", "createdAt", "created_at", "instant")],
  },
  {
    name: "Acuerdos de entrenamiento",
    table: "training_billing_agreements",
    omitKey: "trainingBillingAgreements",
    keys: ["id", "monthlyFee", "pendingMonthlyFee", "pendingMonthlyFeeEffectiveFrom", "startPeriod", "createdAt"],
    rows: (x) => withId(arr(x.doc.trainingBillingAgreements)),
    fields: [
      T("monthlyFee", "monthlyFee", "monthly_fee", "num"),
      T("pendingMonthlyFee", "pendingMonthlyFee", "pending_monthly_fee", "num"),
      T("pendingMonthlyFeeEffectiveFrom", "pendingMonthlyFeeEffectiveFrom", "pending_monthly_fee_effective_from"),
      T("startPeriod", "startPeriod", "start_period"),
      T("createdAt", "createdAt", "created_at", "instant"),
    ],
  },
  // ── Series y calendario ──
  {
    name: "Series",
    table: "recurrence_rules",
    omitKey: "recurrenceRules",
    keys: ["recurrenceId", "studentId", "type", "cycleLengthWeeks", "weeks", "modality", "timezone", "startDate", "endDate", "status", "supersedesRecurrenceId", "supersededByRecurrenceId", "effectiveFromDate", "classTitle", "activityKind", "trainingBillingAgreementId", "participantIds"],
    rows: (x) => withId(arr(x.doc.recurrenceRules), "recurrenceId"),
    fields: [
      rel("alumno principal", "studentId", "primary_student_id", "students"),
      T("type", "type", "rule_type"),
      T("cycleLengthWeeks", "cycleLengthWeeks", "cycle_length_weeks", "num"),
      T("weeks", "weeks", "weeks", "json"),
      T("modality", "modality", "modality"),
      T("timezone", "timezone", "timezone"),
      { f: "startDate", cmp: "date", src: (r) => civil(r.startDate), dst: col("start_date") },
      { f: "endDate", cmp: "date", src: (r) => civil(r.endDate), dst: col("end_date") },
      T("status", "status", "status"),
      rel("serie que reemplaza", "supersedesRecurrenceId", "supersedes_recurrence_id", "recurrence_rules"),
      rel("serie reemplazada por", "supersededByRecurrenceId", "superseded_by_recurrence_id", "recurrence_rules"),
      { f: "effectiveFromDate", cmp: "date", src: (r) => civil(r.effectiveFromDate), dst: col("effective_from_date") },
      T("classTitle", "classTitle", "class_title"),
      { f: "activityKind", cmp: "text", src: (r) => r.activityKind ?? "class", dst: col("activity_kind") },
      rel("acuerdo de entrenamiento", "trainingBillingAgreementId", "training_billing_agreement_id", "training_billing_agreements"),
      {
        f: "integrantes (relación)",
        cmp: "sarray",
        src: (r) => strings(r.participantIds),
        dst: (d, x) => (x.dump.recurrence_rule_participants ?? []).filter((p) => p.recurrence_rule_id === d.id).map((p) => x.legacy("students", p.student_id) ?? "?"),
      },
    ],
  },
  {
    name: "Clases de calendario",
    table: "calendar_lessons",
    omitKey: "calendarLessons",
    keys: ["id", "studentId", "studentName", "level", "lessonType", "start", "end", "modality", "status", "color", "overlapAllowed", "overlapGroupId", "notes", "isRecurring", "recurrenceId", "recurrenceOccurrenceKey", "recurrenceIndex", "recurrenceOriginalStart", "scheduleAdjustment", "classTitle", "freedByLessonId", "activityKind", "participants"],
    rows: (x) => withId(arr(x.doc.calendarLessons)),
    fields: [
      rel("alumno principal", "studentId", "primary_student_id", "students"),
      T("studentName", "studentName", "student_name"),
      T("level", "level", "level"),
      T("lessonType", "lessonType", "lesson_type"),
      T("start", "start", "start_at", "instant"),
      T("end", "end", "end_at", "instant"),
      T("modality", "modality", "modality"),
      T("status", "status", "status"),
      T("color", "color", "color"),
      { f: "overlapAllowed", cmp: "bool", src: (r) => r.overlapAllowed === true, dst: col("overlap_allowed") },
      { f: "overlapGroupId (original)", cmp: "text", src: get("overlapGroupId"), dst: col("legacy_overlap_group_id") },
      T("notes", "notes", "notes"),
      { f: "isRecurring", cmp: "bool", src: (r) => r.isRecurring === true, dst: col("is_recurring") },
      rel("serie", "recurrenceId", "recurrence_id", "recurrence_rules"),
      T("recurrenceOccurrenceKey", "recurrenceOccurrenceKey", "recurrence_occurrence_key"),
      T("recurrenceIndex", "recurrenceIndex", "recurrence_index", "num"),
      T("recurrenceOriginalStart", "recurrenceOriginalStart", "recurrence_original_start", "instant"),
      T("scheduleAdjustment", "scheduleAdjustment", "schedule_adjustment", "json"),
      T("classTitle", "classTitle", "class_title"),
      { f: "clase que liberó (relación)", cmp: "text", src: (r, x) => existingCalendarRef(x, r.freedByLessonId), dst: (d, x) => x.legacy("calendar_lessons", d.freed_by_lesson_id) },
      { f: "activityKind", cmp: "text", src: (r) => r.activityKind ?? "class", dst: col("activity_kind") },
    ],
  },
  {
    name: "Excepciones de series",
    table: "recurrence_exceptions",
    keys: ["recurrenceId", "occurrenceKey", "type", "replacementLessonId", "createdAt"],
    rows: (x) => arr(x.doc.recurrenceExceptions).flatMap((row) => (str(row.recurrenceId) && str(row.occurrenceKey) ? [{ id: `${row.recurrenceId}|${row.occurrenceKey}`, row }] : [])),
    key: (d, x) => {
      const rid = x.legacy("recurrence_rules", d.recurrence_id);
      return rid && typeof d.occurrence_key === "string" ? `${rid}|${d.occurrence_key}` : null;
    },
    fields: [T("type", "type", "exception_type"), { f: "clase de reemplazo (relación)", cmp: "text", src: (r, x) => existingCalendarRef(x, r.replacementLessonId), dst: (d, x) => x.legacy("calendar_lessons", d.replacement_lesson_id) }, T("createdAt", "createdAt", "created_at", "instant")],
  },
  // ── Clases registradas y sus partes ──
  {
    name: "Clases registradas",
    table: "lesson_registrations",
    omitKey: "pedagogicalLessons",
    rows: lessonRows,
    fields: [
      {
        f: "clase de calendario (relación)",
        cmp: "text",
        src: (r, x) => {
          const original = str(r.calendarLessonId) ?? str(isObj(r.calendarRegistration) ? r.calendarRegistration.lessonId : null);
          return x.calendarRefs.registrationTarget(str(r.id) ?? "", original);
        },
        dst: (d, x) => x.legacy("calendar_lessons", d.calendar_lesson_id),
      },
      { f: "form.activityKind", cmp: "text", src: (r) => form(r).activityKind ?? "class", dst: col("activity_kind") },
      { f: "countsAsClass", cmp: "bool", src: (r) => r.countsAsClass !== false, dst: col("counts_as_class") },
      { f: "form.homeworkDescription", cmp: "text", src: (r) => form(r).homeworkDescription, dst: col("homework_description") },
      { f: "form.homeworkDueDate", cmp: "date", src: (r) => civil(form(r).homeworkDueDate), dst: col("homework_due_date") },
      T("billedAmount", "billedAmount", "billed_amount", "num"),
      { f: "scheduledStartAt", cmp: "instant", src: (r) => scheduledStart(r), dst: col("scheduled_start_at") },
      { f: "scheduledEndAt", cmp: "instant", src: (r) => plusMinutes(scheduledStart(r), form(r).scheduledDurationMinutes), dst: col("scheduled_end_at") },
      { f: "actualStartedAt", cmp: "instant", src: (r) => actualTimes(r).start, dst: col("actual_started_at") },
      { f: "actualEndedAt", cmp: "instant", src: (r) => actualTimes(r).end, dst: col("actual_ended_at") },
      { f: "form.eventType → outcome", cmp: "text", src: (r) => outcomeOf(r), dst: col("outcome") },
      { f: "form.eventType (original)", cmp: "text", src: (r) => eventType(r), dst: col("source_event_type") },
      { f: "form.holidayException", cmp: "bool", src: (r) => form(r).holidayException === true, dst: col("holiday_exception") },
      { f: "form.modality", cmp: "text", src: (r) => form(r).modality, dst: col("modality") },
      { f: "form.lateCancellationPolicy", cmp: "text", src: (r) => lateCancellationPolicy(r), dst: col("late_cancellation_policy") },
      { f: "form.lateCancellationPercentage", cmp: "num", src: (r) => (lateCancellationPolicy(r) === "cobrar_porcentaje" ? form(r).lateCancellationPercentage : null), dst: col("late_cancellation_percentage") },
      { f: "registro reprogramado (relación)", cmp: "text", src: (r) => str(form(r).rescheduledFromLessonId), dst: (d, x) => x.legacy("lesson_registrations", d.rescheduled_from_registration_id) },
      { f: "form.scheduledDurationMinutes", cmp: "num", src: (r) => form(r).scheduledDurationMinutes, dst: col("scheduled_duration_minutes") },
      { f: "form.actualDurationMinutes", cmp: "num", src: (r) => form(r).actualDurationMinutes, dst: col("actual_duration_minutes") },
      { f: "form.topics", cmp: "json", src: (r) => expectedTopics(r), dst: col("topics") },
      { f: "form.objectives", cmp: "array", src: (r) => form(r).objectives, dst: col("objectives") },
      { f: "form.activities", cmp: "array", src: (r) => form(r).activities, dst: col("activities") },
      { f: "form.activityNotes", cmp: "text", src: (r) => form(r).activityNotes ?? "", dst: col("activity_notes") },
      { f: "form.internalNotes", cmp: "text", src: (r) => form(r).internalNotes ?? "", dst: col("internal_notes") },
      { f: "form.materialIds", cmp: "array", src: (r) => form(r).materialIds, dst: col("material_ids") },
      { f: "form.isBillable", cmp: "bool", src: (r) => form(r).isBillable !== false, dst: col("is_billable") },
      { f: "form.consumesMonthlyPackage", cmp: "bool", src: (r) => form(r).consumesMonthlyPackage !== false, dst: col("consumes_monthly_package") },
      { f: "createdAt", cmp: "instant", src: get("createdAt"), dst: col("created_at") },
      { f: "updatedAt", cmp: "instant", whenPresent: true, src: get("updatedAt"), dst: col("updated_at") },
      { f: "registrationStatus", cmp: "text", src: (r) => regStatus(r), dst: col("status") },
      { f: "reserva, cronómetro, puntualidad, importes por alumno y campos nuevos (source_extras)", cmp: "json", src: (r, x) => expectedLessonExtras(r, x), dst: (d) => d.source_extras ?? {} },
    ],
  },
  {
    name: "Integrantes de registros",
    table: "lesson_registration_students",
    rows: (x) => lessonChildren(x, (l, id) => participantProgress(l).map((p) => ({ key: `${id}#${p.studentId}`, row: { ...p } }))),
    key: regStudentKey,
    fields: [
      { f: "estado del participante", cmp: "text", src: get("status"), dst: col("participant_status") },
      { f: "orden del participante", cmp: "num", src: get("position"), dst: col("participant_position") },
    ],
  },
  {
    name: "Asistencias",
    table: "lesson_registration_attendance",
    rows: (x) =>
      lessonChildren(x, (l, id) => {
        const absentEvent = eventType(l) === "alumno_ausente";
        const list = arr(form(l).attendance).flatMap((a) => (str(a.studentId) ? [{ key: `${id}#${a.studentId}`, row: a }] : []));
        if (absentEvent) for (const sid of strings(form(l).studentIds)) if (!list.some((e) => e.key === `${id}#${sid}`)) list.push({ key: `${id}#${sid}`, row: { studentId: sid } });
        return list.map((e) => ({ key: e.key, row: { ...e.row, __absentEvent: absentEvent } }));
      }),
    key: regStudentKey,
    fields: [
      {
        f: "status",
        cmp: "text",
        src: (r) => (r.__absentEvent === true ? "ausente" : typeof r.status === "string" && ATTENDANCE.has(r.status) ? r.status : r.present === true ? "presente" : "ausente"),
        dst: col("status"),
      },
      { f: "lateMinutes", cmp: "num", src: (r) => (typeof r.lateMinutes === "number" ? r.lateMinutes : null), dst: col("late_minutes") },
    ],
  },
  {
    name: "Evaluaciones",
    table: "lesson_registration_evaluations",
    rows: (x) =>
      lessonChildren(x, (l, id) =>
        arr(form(l).evaluations).flatMap((e) => (str(e.studentId) ? [{ key: `${id}#${e.studentId}`, row: { ...e, __billed: isObj(l.billedAmountByStudent) ? (l.billedAmountByStudent as Obj)[e.studentId as string] : undefined } }] : []))
      ),
    key: regStudentKey,
    fields: [
      { f: "generalGrade (válida 1–10)", cmp: "num", src: (r) => (GRADE_OK(r.generalGrade) ? r.generalGrade : null), dst: col("general_grade") },
      {
        f: "skillGrades (válidas 1–10)",
        cmp: "json",
        src: (r) => Object.fromEntries(Object.entries(isObj(r.skillGrades) ? r.skillGrades : {}).filter(([k, v]) => SKILLS.has(k) && GRADE_OK(v))),
        dst: (d) => d.skill_grades ?? {},
      },
      { f: "generalGrade ORIGINAL (source_grades)", cmp: "json", src: (r) => r.generalGrade ?? null, dst: (d) => (isObj(d.source_grades) ? ((d.source_grades as Obj).generalGrade ?? null) : null) },
      { f: "skillGrades ORIGINALES (source_grades)", cmp: "json", src: (r) => (isObj(r.skillGrades) ? r.skillGrades : {}), dst: (d) => (isObj(d.source_grades) ? ((d.source_grades as Obj).skillGrades ?? {}) : {}) },
      {
        f: "notas a revisar (flags)",
        cmp: "sarray",
        src: (r) => {
          const flags: string[] = [];
          const g = gradeStatus(r.generalGrade);
          if (g === "unset" || g === "out_of_range") flags.push(`generalGrade:${g}`);
          for (const [k, v] of Object.entries(isObj(r.skillGrades) ? r.skillGrades : {})) {
            const s = gradeStatus(v);
            if (s !== "ok" && s !== "absent") flags.push(`skillGrades.${k}:${SKILLS.has(k) ? s : "unknown_skill"}`);
            else if (s === "ok" && !SKILLS.has(k)) flags.push(`skillGrades.${k}:unknown_skill`);
          }
          return flags;
        },
        dst: (d) => (isObj(d.source_grades) ? ((d.source_grades as Obj).flags ?? []) : []),
      },
      T("strengths", "strengths", "strengths", "array"),
      T("areasToImprove", "areasToImprove", "areas_to_improve", "array"),
      T("individualObservation", "individualObservation", "individual_observation"),
      T("individualHomeworkDescription", "individualHomeworkDescription", "individual_homework_description"),
      { f: "individualHomeworkDueDate", cmp: "date", src: (r) => civil(r.individualHomeworkDueDate), dst: col("individual_homework_due_date") },
      { f: "billedAmount (por alumno)", cmp: "num", src: (r) => (typeof r.__billed === "number" ? r.__billed : null), dst: col("billed_amount") },
    ],
  },
  {
    name: "Revisiones de tarea",
    table: "lesson_registration_homework_reviews",
    rows: (x) => lessonChildren(x, (l, id) => arr(l.homeworkReviews).flatMap((h) => (str(h.studentId) && str(h.taskId) ? [{ key: `${id}#${h.studentId}#${h.taskId}`, row: h }] : []))),
    key: (d, x) => {
      const k = regStudentKey(d, x);
      return k && typeof d.task_id === "string" ? `${k}#${d.task_id}` : null;
    },
    fields: [T("outcome", "outcome", "outcome"), T("reviewedAt", "reviewedAt", "reviewed_at", "instant")],
  },
  {
    name: "Historial de ediciones",
    table: "lesson_registration_edit_history",
    rank: true,
    rows: (x) => {
      const out: SourceRow[] = [];
      for (const { id, row } of lessonRows(x)) {
        const valid = arr(row.editHistory).filter((e) => ms(e.editedAt) !== null);
        valid.sort((a, b) => (ms(a.editedAt) as number) - (ms(b.editedAt) as number));
        valid.forEach((e, i) => out.push({ id: `${id}#${i + 1}`, row: e }));
      }
      return out;
    },
    fields: [
      T("editedAt", "editedAt", "edited_at", "instant"),
      { f: "versión anterior de la clase", cmp: "json", src: (r) => r, dst: (d) => (isObj(d.previous_snapshot) ? Object.fromEntries(Object.entries(d.previous_snapshot as Obj).filter(([k]) => k !== "_format")) : null) },
    ],
  },
  {
    name: "Adjuntos de clase",
    table: "lesson_attachments",
    keys: ["id", "name", "uri", "addedAt", "kind", "mimeType", "sizeBytes", "caption", "studentId"],
    rows: (x) => lessonChildren(x, (l, id) => arr(form(l).activityAttachments).map((a, i) => ({ key: `${id}:${str(a.id) ?? `att_${stableHash(`${id}:${i}`)}`}`, row: a }))),
    fields: [
      T("name", "name", "name"),
      { f: "kind", cmp: "text", src: (r) => (r.kind === "image" ? "image" : "pdf"), dst: col("kind") },
      T("mimeType", "mimeType", "mime_type"),
      T("sizeBytes", "sizeBytes", "size_bytes", "num"),
      T("caption", "caption", "caption"),
      T("addedAt", "addedAt", "added_at", "instant"),
      { f: "alumno (relación; vacío = común)", cmp: "text", src: (r) => str(r.studentId), dst: (d, x) => x.legacy("students", d.student_id) },
      T("uri (ruta original)", "uri", "source_uri"),
    ],
  },
  // ── Finanzas ──
  {
    name: "Cobros",
    table: "payment_charges",
    omitKey: "paymentCharges",
    keys: ["id", "studentId", "type", "originalAmount", "currency", "dueDate", "billingPeriod", "savedLessonId", "packageId", "trainingBillingAgreementId", "trainingSeriesName", "calendarLessonId", "createdAt", "voidedAt", "voidReason"],
    rows: (x) => withId(arr(x.doc.paymentCharges)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("type", "type", "charge_type"),
      T("originalAmount", "originalAmount", "original_amount", "num"),
      { f: "currency", cmp: "text", src: (r) => r.currency ?? "ARS", dst: col("currency") },
      { f: "dueDate", cmp: "date", src: (r) => civil(r.dueDate), dst: col("due_date") },
      T("billingPeriod", "billingPeriod", "billing_period"),
      rel("clase registrada", "savedLessonId", "saved_lesson_id", "lesson_registrations"),
      rel("paquete", "packageId", "package_id", "package_purchases"),
      rel("acuerdo de entrenamiento", "trainingBillingAgreementId", "training_billing_agreement_id", "training_billing_agreements"),
      T("trainingSeriesName", "trainingSeriesName", "training_series_name"),
      {
        f: "clase de calendario (relación)",
        cmp: "text",
        src: (r, x) => {
          const original = str(r.calendarLessonId);
          return x.calendarRefs.chargeTarget(original, str(r.savedLessonId));
        },
        dst: (d, x) => x.legacy("calendar_lessons", d.calendar_lesson_id),
      },
      T("createdAt", "createdAt", "created_at", "instant"),
      T("voidedAt", "voidedAt", "voided_at", "instant"),
      T("voidReason", "voidReason", "void_reason"),
    ],
  },
  {
    name: "Pagos",
    table: "payments",
    omitKey: "payments",
    keys: ["id", "studentId", "amount", "currency", "method", "paidAt", "notes", "voidedAt", "voidReason", "replacesPaymentId", "source", "recordedAt"],
    rows: (x) => withId(arr(x.doc.payments)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("amount", "amount", "amount", "num"),
      { f: "currency", cmp: "text", src: (r) => r.currency ?? "ARS", dst: col("currency") },
      T("method", "method", "method"),
      { f: "paidAt", cmp: "date", src: (r) => civil(r.paidAt), dst: col("paid_at") },
      T("notes", "notes", "notes"),
      T("voidedAt", "voidedAt", "voided_at", "instant"),
      T("voidReason", "voidReason", "void_reason"),
      rel("pago que reemplaza", "replacesPaymentId", "replaces_payment_id", "payments"),
      T("source", "source", "source"),
      T("recordedAt", "recordedAt", "recorded_at", "instant"),
    ],
  },
  {
    name: "Asignaciones de pago",
    table: "payment_allocations",
    omitKey: "paymentAllocations",
    keys: ["id", "paymentId", "chargeId", "studentId", "amount"],
    rows: (x) => withId(arr(x.doc.paymentAllocations)),
    fields: [
      { f: "exceso sobre el importe base (excess_amount)", cmp: "num", src: (r, x) => x.excesses.get(String(r.id))?.excessAmount ?? 0, dst: (d) => d.excess_amount ?? 0 },
      { f: "clasificación del exceso (excess_status)", cmp: "text", src: (r, x) => x.excesses.get(String(r.id))?.status ?? null, dst: (d) => d.excess_status ?? null },
      { f: "evidencia de la clasificación (excess_evidence)", cmp: "json", src: (r, x) => x.excesses.get(String(r.id))?.evidence ?? null, dst: (d) => d.excess_evidence ?? null },
      rel("pago", "paymentId", "payment_id", "payments"), rel("cobro", "chargeId", "charge_id", "payment_charges"), rel("alumno", "studentId", "student_id", "students"), T("amount", "amount", "amount", "num")],
  },
  {
    name: "Ajustes de cobro",
    table: "payment_adjustments",
    omitKey: "paymentAdjustments",
    keys: ["id", "chargeId", "studentId", "reason", "voidedAt", "voidReason", "createdAt"],
    rows: (x) => withId(arr(x.doc.paymentAdjustments)),
    fields: [rel("cobro", "chargeId", "charge_id", "payment_charges"), rel("alumno", "studentId", "student_id", "students"), T("reason", "reason", "reason"), T("voidedAt", "voidedAt", "voided_at", "instant"), T("voidReason", "voidReason", "void_reason"), T("createdAt", "createdAt", "created_at", "instant")],
  },
  {
    name: "Paquetes de clases",
    table: "package_purchases",
    omitKey: "packagePurchases",
    keys: ["id", "studentId", "includedClasses", "amount", "validFrom", "validUntil", "voidedAt", "voidReason", "createdAt"],
    rows: (x) => withId(arr(x.doc.packagePurchases)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("includedClasses", "includedClasses", "included_classes", "num"),
      T("amount", "amount", "amount", "num"),
      { f: "validFrom", cmp: "date", src: (r) => civil(r.validFrom), dst: col("valid_from") },
      { f: "validUntil", cmp: "date", src: (r) => civil(r.validUntil), dst: col("valid_until") },
      T("voidedAt", "voidedAt", "voided_at", "instant"),
      T("voidReason", "voidReason", "void_reason"),
      T("createdAt", "createdAt", "created_at", "instant"),
    ],
  },
  {
    name: "Movimientos de paquete",
    table: "package_credit_movements",
    omitKey: "packageCreditMovements",
    keys: ["id", "packageId", "studentId", "type", "amount", "savedLessonId", "reason", "voidedAt", "voidReason", "createdAt"],
    rows: (x) => withId(arr(x.doc.packageCreditMovements)),
    fields: [
      rel("paquete", "packageId", "package_id", "package_purchases"),
      rel("alumno", "studentId", "student_id", "students"),
      T("type", "type", "movement_type"),
      T("amount", "amount", "amount", "num"),
      rel("clase registrada", "savedLessonId", "saved_lesson_id", "lesson_registrations"),
      T("reason", "reason", "reason"),
      T("voidedAt", "voidedAt", "voided_at", "instant"),
      T("voidReason", "voidReason", "void_reason"),
      T("createdAt", "createdAt", "created_at", "instant"),
    ],
  },
  {
    name: "Correcciones de importe mensual",
    table: "monthly_amount_corrections",
    omitKey: "monthlyAmountCorrections",
    keys: ["id", "studentId", "billingPeriod", "previousAmount", "newAmount", "changedAt", "reason", "effectiveFrom"],
    rows: (x) => withId(arr(x.doc.monthlyAmountCorrections)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("billingPeriod", "billingPeriod", "billing_period"),
      T("previousAmount", "previousAmount", "previous_amount", "num"),
      T("newAmount", "newAmount", "new_amount", "num"),
      T("changedAt", "changedAt", "changed_at", "instant"),
      T("reason", "reason", "reason"),
      { f: "effectiveFrom", cmp: "text", src: (r) => (r.effectiveFrom === "this_month" || r.effectiveFrom === "next_month" ? r.effectiveFrom : null), dst: col("effective_from") },
    ],
  },
  {
    name: "Correcciones de recargo inicial",
    table: "initial_paid_surcharge_corrections",
    omitKey: "initialPaidSurchargeCorrections",
    keys: ["id", "studentId", "billingPeriod", "previousSurchargeAmount", "voidedPaymentId", "newPaymentId", "correctedAt", "reason"],
    rows: (x) => withId(arr(x.doc.initialPaidSurchargeCorrections)),
    fields: [
      { f: "alumno (relación)", cmp: "text", src: (r, x) => (str(r.studentId) !== null && x.studentIds.has(str(r.studentId) as string) ? str(r.studentId) : null), dst: (d, x) => x.legacy("students", d.student_id) },
      { f: "alumno inexistente en el origen (referencia original)", cmp: "text", src: (r, x) => (str(r.studentId) !== null && !x.studentIds.has(str(r.studentId) as string) ? str(r.studentId) : null), dst: col("student_missing_ref") },
      T("billingPeriod", "billingPeriod", "billing_period"),
      T("previousSurchargeAmount", "previousSurchargeAmount", "previous_surcharge_amount", "num"),
      { f: "pago anulado (relación)", cmp: "text", src: (r, x) => (str(r.voidedPaymentId) !== null && x.paymentIds.has(str(r.voidedPaymentId) as string) ? str(r.voidedPaymentId) : null), dst: (d, x) => x.legacy("payments", d.voided_payment_id) },
      { f: "pago nuevo (relación)", cmp: "text", src: (r, x) => (str(r.newPaymentId) !== null && x.paymentIds.has(str(r.newPaymentId) as string) ? str(r.newPaymentId) : null), dst: (d, x) => x.legacy("payments", d.new_payment_id) },
      { f: "pago anulado inexistente en el origen (referencia original)", cmp: "text", src: (r, x) => (str(r.voidedPaymentId) !== null && !x.paymentIds.has(str(r.voidedPaymentId) as string) ? str(r.voidedPaymentId) : null), dst: col("voided_payment_missing_ref") },
      { f: "pago nuevo inexistente en el origen (referencia original)", cmp: "text", src: (r, x) => (str(r.newPaymentId) !== null && !x.paymentIds.has(str(r.newPaymentId) as string) ? str(r.newPaymentId) : null), dst: col("new_payment_missing_ref") },
      T("correctedAt", "correctedAt", "corrected_at", "instant"),
      T("reason", "reason", "reason"),
    ],
  },
  {
    name: "Decisiones de primer mes",
    table: "first_month_proration_decisions",
    omitKey: "firstMonthProrationDecisions",
    keys: ["id", "studentId", "billingPeriod", "effectiveJoinDate", "criterion", "classesRemaining", "classesPerFullPeriod", "permanentMonthlyAmount", "chargedAmount", "chargeId", "confirmedAt", "source", "createdAt", "recurrenceIds", "seriesPatternSnapshot", "ruleVersion"],
    rows: (x) => withId(arr(x.doc.firstMonthProrationDecisions)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("billingPeriod", "billingPeriod", "billing_period"),
      { f: "effectiveJoinDate", cmp: "date", src: (r) => civil(r.effectiveJoinDate), dst: col("effective_join_date") },
      T("criterion", "criterion", "criterion"),
      T("classesRemaining", "classesRemaining", "classes_remaining", "num"),
      T("classesPerFullPeriod", "classesPerFullPeriod", "classes_per_full_period", "num"),
      T("permanentMonthlyAmount", "permanentMonthlyAmount", "permanent_monthly_amount", "num"),
      T("chargedAmount", "chargedAmount", "charged_amount", "num"),
      rel("cobro", "chargeId", "charge_id", "payment_charges"),
      T("confirmedAt", "confirmedAt", "confirmed_at", "instant"),
      T("source", "source", "source"),
      T("createdAt", "createdAt", "created_at", "instant"),
      T("recurrenceIds", "recurrenceIds", "recurrence_ids", "array"),
      T("seriesPatternSnapshot", "seriesPatternSnapshot", "series_pattern_snapshot", "json"),
      T("ruleVersion", "ruleVersion", "rule_version", "num"),
    ],
  },
  // ── Reportes ──
  {
    name: "Reportes generados",
    table: "report_records",
    omitKey: "reportRecords",
    keys: ["id", "studentId", "title", "selectedMonths", "periodStart", "periodEnd", "generatedAt", "permanentPdfUri", "snapshot", "schemaVersion"],
    rows: (x) => withId(arr(x.doc.reportRecords)),
    fields: [
      rel("alumno", "studentId", "student_id", "students"),
      T("title", "title", "title"),
      T("selectedMonths", "selectedMonths", "selected_months", "array"),
      { f: "periodStart", cmp: "date", src: (r) => civil(r.periodStart), dst: col("period_start") },
      { f: "periodEnd", cmp: "date", src: (r) => civil(r.periodEnd), dst: col("period_end") },
      T("generatedAt", "generatedAt", "generated_at", "instant"),
      { f: "schemaVersion", cmp: "num", src: (r) => (typeof r.schemaVersion === "number" ? r.schemaVersion : 1), dst: col("schema_version") },
      { f: "snapshot ORIGINAL completo", cmp: "json", src: (r) => r.snapshot ?? null, dst: (d) => (isObj(d.snapshot) && isObj((d.snapshot as Obj)._mobileRecord) ? (((d.snapshot as Obj)._mobileRecord as Obj).snapshot ?? null) : null) },
      { f: "ruta original del PDF", cmp: "text", src: get("permanentPdfUri"), dst: (d) => (isObj(d.snapshot) && isObj((d.snapshot as Obj)._mobileRecord) ? (((d.snapshot as Obj)._mobileRecord as Obj).permanentPdfUri ?? null) : null) },
      { f: "texto del informe (formato de la web)", cmp: "text", src: (r) => (isObj(r.snapshot) ? (r.snapshot as Obj).narrativeText : null) ?? "", dst: (d) => (isObj(d.snapshot) ? (d.snapshot as Obj).narrativeText : null) },
      {
        f: "clases dictadas (formato de la web)",
        cmp: "num",
        src: (r) => (isObj(r.snapshot) && isObj((r.snapshot as Obj).data) && isObj(((r.snapshot as Obj).data as Obj).attendance) ? ((((r.snapshot as Obj).data as Obj).attendance as Obj).classesHeld ?? 0) : 0),
        dst: (d) => (isObj(d.snapshot) && isObj((d.snapshot as Obj).data) ? (((d.snapshot as Obj).data as Obj).classesHeld ?? 0) : 0),
      },
    ],
  },
  // ── Una fila por cuenta ──
  {
    name: "Perfil de la profesora",
    table: "teacher_profiles",
    keys: ["displayName", "createdAt", "updatedAt", "schemaVersion", "completedTutorialVersion", "tutorialCompletedAt"],
    rows: (x) => (isObj(x.doc.teacherProfile) ? [{ id: "perfil", row: x.doc.teacherProfile }] : []),
    key: () => "perfil",
    fields: [
      T("displayName", "displayName", "display_name"),
      T("createdAt", "createdAt", "created_at", "instant"),
      T("updatedAt (original)", "updatedAt", "source_updated_at", "instant"),
      T("completedTutorialVersion", "completedTutorialVersion", "completed_tutorial_version", "num"),
      T("tutorialCompletedAt", "tutorialCompletedAt", "tutorial_completed_at", "instant"),
    ],
  },
  {
    name: "Disponibilidad",
    table: "teacher_availability",
    keys: ["schemaVersion", "timezone", "weeklyBlocks", "exceptions"],
    rows: (x) => (isObj(x.doc.teacherAvailability) ? [{ id: "disponibilidad", row: x.doc.teacherAvailability }] : []),
    key: () => "disponibilidad",
    fields: [T("timezone", "timezone", "timezone"), T("weeklyBlocks", "weeklyBlocks", "weekly_blocks", "json"), T("exceptions", "exceptions", "exceptions", "json")],
  },
  {
    name: "Recargos (configuración)",
    table: "surcharge_settings",
    keys: ["current", "pending", "pendingEffectiveFrom"],
    rows: (x) => (isObj(x.doc.surchargeSettings) ? [{ id: "recargos", row: x.doc.surchargeSettings }] : []),
    key: () => "recargos",
    fields: [
      { f: "current.enabled (siempre apagado por decisión de negocio)", cmp: "bool", src: () => false, dst: col("enabled") },
      ...(["graceDay", "firstLateDay", "firstLatePercentage", "secondLateDay", "secondLatePercentage", "lastLateDay", "lastLatePercentage"] as const).map(
        (k): FieldSpec => ({ f: `current.${k}`, cmp: "num", src: (r) => (isObj(r.current) ? (r.current as Obj)[k] : null), dst: col(k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)) })
      ),
      { f: "pending (cambio programado)", cmp: "json", src: (r) => r.pending ?? null, dst: col("pending") },
      { f: "pendingEffectiveFrom", cmp: "text", src: get("pendingEffectiveFrom"), dst: col("pending_effective_from") },
    ],
  },
  {
    name: "Distribución 50/30/20",
    table: "budget_distribution_settings",
    keys: ["distribution", "savingsGoal"],
    rows: (x) => (isObj(x.doc.budgetDistribution) ? [{ id: "presupuesto", row: x.doc.budgetDistribution }] : []),
    key: () => "presupuesto",
    fields: [
      { f: "distribution.needs", cmp: "num", src: (r) => (isObj(r.distribution) ? (r.distribution as Obj).needs : null), dst: col("needs_percent") },
      { f: "distribution.wants", cmp: "num", src: (r) => (isObj(r.distribution) ? (r.distribution as Obj).wants : null), dst: col("wants_percent") },
      { f: "distribution.savings", cmp: "num", src: (r) => (isObj(r.distribution) ? (r.distribution as Obj).savings : null), dst: col("savings_percent") },
      { f: "savingsGoal.enabled", cmp: "bool", src: (r) => (isObj(r.savingsGoal) ? (r.savingsGoal as Obj).enabled === true : false), dst: col("savings_goal_enabled") },
      { f: "savingsGoal.targetAmount", cmp: "num", src: (r) => (isObj(r.savingsGoal) ? (r.savingsGoal as Obj).targetAmount : null), dst: col("savings_goal_target_amount") },
      { f: "savingsGoal.targetDate", cmp: "date", src: (r) => (isObj(r.savingsGoal) ? civil((r.savingsGoal as Obj).targetDate) : null), dst: col("savings_goal_target_date") },
    ],
  },
  // ── Integrantes de series y de clases de calendario ──
  {
    name: "Integrantes de series",
    table: "recurrence_rule_participants",
    rows: (x) => arr(x.doc.recurrenceRules).flatMap((r) => (str(r.recurrenceId) ? strings(r.participantIds).map((sid) => ({ id: `${r.recurrenceId}#${sid}`, row: {} })) : [])),
    key: (d, x) => {
      const rid = x.legacy("recurrence_rules", d.recurrence_rule_id);
      const sid = x.legacy("students", d.student_id);
      return rid && sid ? `${rid}#${sid}` : null;
    },
    fields: [],
  },
  {
    name: "Incidencias del origen (referencias ya rotas en TeacherFlow anterior)",
    table: "origin_incidents",
    omitKey: "originIncidents",
    rows: (x) => x.incidents.map((i) => ({ id: i.id, row: i as unknown as Obj })),
    fields: [
      T("entity", "entity", "entity"),
      T("rowId", "rowId", "row_legacy_id"),
      T("field", "field", "field"),
      T("originalReference", "originalReference", "original_reference"),
      T("kind", "kind", "kind"),
      T("detail", "detail", "detail", "json"),
    ],
  },
  {
    name: "Integrantes de clases de calendario",
    table: "calendar_lesson_participants",
    keys: ["studentId", "studentName", "level"],
    rows: (x) => arr(x.doc.calendarLessons).flatMap((l) => (str(l.id) ? arr(l.participants).flatMap((p) => (str(p.studentId) ? [{ id: `${l.id}#${p.studentId}`, row: p }] : [])) : [])),
    key: (d, x) => {
      const cid = x.legacy("calendar_lessons", d.calendar_lesson_id);
      const sid = x.legacy("students", d.student_id);
      return cid && sid ? `${cid}#${sid}` : null;
    },
    fields: [T("studentName", "studentName", "student_name"), T("level", "level", "level")],
  },
];

/** Tablas de la web que hay que volcar (sólo lectura, con la sesión de la propia cuenta) para poder comparar: las de cada entidad más las de archivos y extracción. */
export const DESTINATION_TABLES: readonly string[] = [
  ...new Set([...SPECS.map((spec) => spec.table), "recurrence_rule_participants", "calendar_lesson_participants", "lesson_attachments", "student_source_extras", "material_library_items", "device_local_snapshots", "phone_extraction_results"]),
];

/** Tablas cuyo identificador de origen NO puede repetirse en el destino. */
const LEGACY_KEYED = new Set(["students", "student_level_history", "custom_levels", "training_billing_agreements", "recurrence_rules", "calendar_lessons", "lesson_registrations", "lesson_attachments", "payment_charges", "payments", "payment_allocations", "payment_adjustments", "package_purchases", "package_credit_movements", "monthly_amount_corrections", "initial_paid_surcharge_corrections", "first_month_proration_decisions", "report_records"]);

// ── Archivos: adjuntos, materiales y PDF de reportes ──────────────────────────────────────────────────────────────────

export interface PhoneExtractionManifest {
  /** Biblioteca de materiales tal como salió del teléfono (nunca viaja en el respaldo). */
  materials?: Array<{ id: string; name?: string; attachment?: { name?: string } | null }>;
  /** Archivos que NO existen en el teléfono (el origen mismo ya no los tiene): se declaran, no se esperan. Claves `attachment:<id>`, `material:<id>`, `report:<id>`. */
  missingAtOrigin?: string[];
}

function fileLines(doc: Obj, dump: DestinationDump, manifest: PhoneExtractionManifest | undefined): FileLine[] {
  // Lo que el teléfono ya no tenía lo declara la propia extracción (queda en la cuenta: `phone_extraction_results`); un manifiesto explícito se suma.
  const results = [...(dump.phone_extraction_results ?? [])].sort((a, b) => (ms(a.finished_at) ?? 0) - (ms(b.finished_at) ?? 0));
  const lastSummary = results.length > 0 && isObj(results[results.length - 1].summary) ? (results[results.length - 1].summary as Obj) : null;
  const missing = new Set([...(manifest?.missingAtOrigin ?? []), ...strings(lastSummary?.missingAtOrigin)]);
  const lines: FileLine[] = [];

  const sourceAttachments = arr(doc.pedagogicalLessons).flatMap((l) => arr(form(l).activityAttachments).map((a, i) => `${l.id}:${str(a.id) ?? `att_${stableHash(`${l.id}:${i}`)}`}`));
  const byLegacy = new Map((dump.lesson_attachments ?? []).map((a) => [String(a.legacy_mobile_id), a]));
  const pendingA: string[] = [];
  let availableA = 0;
  let unavailableA = 0;
  for (const id of sourceAttachments) {
    const row = byLegacy.get(id);
    if (row && row.file_status === "disponible" && typeof row.storage_path === "string" && typeof row.sha256 === "string") availableA += 1;
    else if (missing.has(`attachment:${id}`) || row?.file_status === "no_disponible") unavailableA += 1;
    else pendingA.push(id);
  }
  lines.push({ kind: "adjunto", total: sourceAttachments.length, available: availableA, pending: pendingA.length, unavailableAtOrigin: unavailableA, examples: pendingA.slice(0, 5) });

  const destMaterials = new Map((dump.material_library_items ?? []).map((m) => [String(m.legacy_mobile_id), m]));
  const referenced = new Set(arr(doc.pedagogicalLessons).flatMap((l) => strings(form(l).materialIds)));
  const materialIds = [...new Set([...(manifest?.materials ?? []).map((m) => m.id), ...referenced, ...destMaterials.keys()])];
  const pendingM: string[] = [];
  let availableM = 0;
  let unavailableM = 0;
  for (const id of materialIds) {
    const row = destMaterials.get(id);
    if (!row) pendingM.push(id);
    else if (row.file_status === "sin_archivo") availableM += 1;
    else if (row.file_status === "disponible" && typeof row.sha256 === "string") availableM += 1;
    else if (missing.has(`material:${id}`) || row.file_status === "no_disponible") unavailableM += 1;
    else pendingM.push(id);
  }
  lines.push({ kind: "material", total: materialIds.length, available: availableM, pending: pendingM.length, unavailableAtOrigin: unavailableM, examples: pendingM.slice(0, 5) });

  const reports = arr(doc.reportRecords);
  const destReports = new Map((dump.report_records ?? []).map((r) => [String(r.legacy_mobile_id), r]));
  const pendingR: string[] = [];
  let availableR = 0;
  let unavailableR = 0;
  for (const r of reports) {
    const id = String(r.id);
    const row = destReports.get(id);
    if (row && typeof row.pdf_url === "string" && row.pdf_url !== "") availableR += 1;
    else if (missing.has(`report:${id}`)) unavailableR += 1;
    else pendingR.push(id);
  }
  lines.push({ kind: "reporte_pdf", total: reports.length, available: availableR, pending: pendingR.length, unavailableAtOrigin: unavailableR, examples: pendingR.slice(0, 5) });
  return lines;
}

// ── Comparación ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CompareOptions {
  /** Omisiones declaradas por el adaptador (`report.omitted`): cada una es una fila del origen que NO llegó; nunca se cuenta como correcta. */
  adapterOmitted?: Array<{ collection: string; id?: string | null }>;
  /** Respuesta de la extracción del teléfono (biblioteca de materiales, archivos inexistentes en el origen). */
  phoneExtraction?: PhoneExtractionManifest;
  /**
   * Mostrar los valores reales en los ejemplos de diferencias. SÓLO para datos sintéticos (pruebas y ensayos): con datos reales queda apagado y los ejemplos
   * llevan únicamente el identificador de origen, el tipo, el largo y una huella del valor.
   */
  revealValues?: boolean;
}

export function compareTransfer(source: Obj, dump: DestinationDump, options: CompareOptions = {}): TransferComparison {
  const x = buildCtx(source, dump);
  const omitted = options.adapterOmitted ?? [];
  const reveal = options.revealValues === true;
  const entities: EntityLine[] = [];
  const fields: FieldLine[] = [];
  const undeclared: UndeclaredLine[] = [];
  const duplicates: DuplicateLine[] = [];
  const archiveText = JSON.stringify((dump.import_source_archives ?? []).map((a) => a.source_payload ?? null));

  for (const spec of SPECS) {
    const sourceRows = spec.rows(x);
    const omittedIds = new Set(omitted.filter((o) => o.collection === spec.omitKey && o.id).map((o) => String(o.id)));
    const omittedAnon = omitted.filter((o) => o.collection === spec.omitKey && !o.id).length;
    const expectedRows = sourceRows.filter((r) => !omittedIds.has(r.id));

    let destMap: Map<string, Obj[]>;
    if (spec.rank && spec.table === "student_status_history") destMap = destHistory(x, spec.table, (d) => [d.occurred_on, d.status, d.reason ?? "", d.internal_note ?? ""].join("|"));
    else if (spec.rank && spec.table === "student_price_history") destMap = destHistory(x, spec.table, (d) => [d.effective_on, String(num(d.price))].join("|"));
    else if (spec.rank && spec.table === "lesson_registration_edit_history") {
      const grouped = new Map<string, Obj[]>();
      for (const d of x.dump[spec.table] ?? []) {
        const reg = x.legacy("lesson_registrations", d.lesson_registration_id);
        if (!reg) continue;
        grouped.set(reg, [...(grouped.get(reg) ?? []), d]);
      }
      destMap = new Map();
      for (const [reg, list] of grouped) {
        list.sort((a, b) => (ms(a.edited_at) as number) - (ms(b.edited_at) as number));
        list.forEach((d, i) => destMap.set(`${reg}#${i + 1}`, [d]));
      }
    } else {
      destMap = new Map();
      for (const d of x.dump[spec.table] ?? []) {
        const key = spec.key ? spec.key(d, x) : typeof d.legacy_mobile_id === "string" ? d.legacy_mobile_id : null;
        if (!key) continue;
        destMap.set(key, [...(destMap.get(key) ?? []), d]);
      }
    }
    if (LEGACY_KEYED.has(spec.table) || spec.key) {
      for (const [key, list] of destMap) if (list.length > 1) duplicates.push({ table: spec.table, legacyId: key, count: list.length });
    }

    const missingIds = expectedRows.filter((r) => !destMap.has(r.id)).map((r) => r.id);
    const sourceKeys = new Set(sourceRows.map((r) => r.id));
    const extra = [...destMap.keys()].filter((k) => !sourceKeys.has(k));
    entities.push({
      entity: spec.name,
      table: spec.table,
      source: sourceRows.length + omittedAnon,
      omitted: omittedIds.size + omittedAnon,
      expected: expectedRows.length,
      destination: destMap.size,
      missing: missingIds,
      extra,
      ok: missingIds.length === 0 && omittedIds.size + omittedAnon === 0,
    });

    for (const field of spec.fields) {
      const line: FieldLine = { entity: spec.name, field: field.f, checked: 0, migrated: 0, mismatched: 0, examples: [] };
      for (const sr of expectedRows) {
        const dst = destMap.get(sr.id)?.[0];
        if (!dst) continue;
        const a = field.src(sr.row, x);
        if (field.whenPresent && (a === null || a === undefined)) continue;
        line.checked += 1;
        const b = field.dst(dst, x);
        if (same(field.cmp, nonNull(a), nonNull(b))) line.migrated += 1;
        else {
          line.mismatched += 1;
          if (line.examples.length < 5) line.examples.push({ id: sr.id, source: show(a, reveal), destination: show(b, reveal) });
        }
      }
      fields.push(line);
    }

    // Claves del origen que ningún campo declara. (En alumnos y clases registradas lo desconocido se conserva en `source_extras` y ya se comparó arriba.)
    if (spec.keys) {
      const known = new Set(spec.keys);
      const seenKeys = new Map<string, string[]>();
      for (const sr of sourceRows) {
        for (const k of Object.keys(sr.row)) {
          if (k.startsWith("__") || known.has(k)) continue;
          seenKeys.set(k, [...(seenKeys.get(k) ?? []), sr.id]);
        }
      }
      for (const [key, ids] of seenKeys) {
        const sample = sourceRows.find((r) => ids[0] === r.id)?.row[key];
        undeclared.push({ entity: spec.name, key, rows: ids.length, examples: ids.slice(0, 3), preservedInArchive: sample !== undefined && archiveText.includes(JSON.stringify(sample)) });
      }
    }
  }

  const files = fileLines(source, dump, options.phoneExtraction);
  const omittedByAdapter = omitted.length;
  const fieldChecks = fields.reduce((n, f) => n + f.checked, 0);
  const fieldMismatches = fields.reduce((n, f) => n + f.mismatched, 0);
  const rowsExpected = entities.reduce((n, e) => n + e.expected, 0);
  const rowsFound = entities.reduce((n, e) => n + (e.expected - e.missing.length), 0);

  const reasons: string[] = [];
  for (const e of entities) if (e.missing.length > 0) reasons.push(`${e.entity}: faltan ${e.missing.length} de ${e.expected} (${e.missing.slice(0, 3).join(", ")}${e.missing.length > 3 ? "…" : ""})`);
  if (omittedByAdapter > 0) reasons.push(`El adaptador dejó ${omittedByAdapter} fila(s) sin importar`);
  for (const f of fields) if (f.mismatched > 0) reasons.push(`${f.entity} · ${f.field}: ${f.mismatched} de ${f.checked} no coinciden`);
  for (const u of undeclared) reasons.push(`${u.entity}: el campo «${u.key}» del origen no tiene destino (${u.rows} fila(s))${u.preservedInArchive ? ", sólo preservado en el archivo" : ""}`);
  for (const d of duplicates) reasons.push(`${d.table}: «${d.legacyId}» repetido ${d.count} veces`);
  for (const f of files) if (f.pending > 0) reasons.push(`Archivos (${f.kind}): ${f.pending} de ${f.total} todavía no se extrajeron del teléfono`);
  const preservedOnlyInArchive = undeclared.filter((u) => u.preservedInArchive).map((u) => `${u.entity}.${u.key}`);

  return {
    entities,
    fields,
    undeclared,
    files,
    duplicates,
    omittedByAdapter,
    originIncidents: x.incidents,
    reconciliation: {
      sourceRows: entities.reduce((n, e) => n + e.source, 0),
      omittedByAdapter: entities.reduce((n, e) => n + e.omitted, 0),
      expectedRows: rowsExpected,
      foundRows: rowsFound,
      missingRows: entities.reduce((n, e) => n + e.missing.length, 0),
      extraRows: entities.reduce((n, e) => n + e.extra.length, 0),
      balanced: entities.every((e) => e.source === e.omitted + e.expected && e.expected === e.destination - e.extra.length + e.missing.length),
    },
    summary: { entities: entities.length, rowsExpected, rowsFound, fieldChecks, fieldMismatches },
    preservedOnlyInArchive,
    verdict: { complete: reasons.length === 0, reasons, absentAtOrigin: files.reduce((n, f) => n + f.unavailableAtOrigin, 0), originInconsistencies: x.incidents.length, absentAtOriginVerified: options.phoneExtraction !== undefined || (dump.phone_extraction_results ?? []).length > 0 },
  };
}
