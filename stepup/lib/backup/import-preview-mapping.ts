/**
 * Fase 9 — mapeo PURO (sin red, sin Supabase) de la respuesta cruda de
 * `preview_backup_import` a un DTO limpio para la UI, y del DTO + las
 * decisiones del profesor a un resumen de confirmación.
 *
 * Frontera de seguridad real (a pedido explícito de Joaquín): `toImportPreviewDto`
 * es el único punto que toca la forma cruda de Postgres — nunca deja pasar
 * `candidate_fingerprint` (sha256 interno, sólo sirve para re-verificación
 * server-side) ni ningún otro campo técnico hacia el resultado que se
 * manda al navegador. `lib/actions/backup.ts` llama esta función ANTES de
 * devolver cualquier cosa desde el Server Action — el componente cliente
 * nunca ve la forma cruda.
 */

// ---------------------------------------------------------------------------
// Forma cruda (snake_case, espeja exactamente preview_backup_import/RPC).
// ---------------------------------------------------------------------------

export interface RawFieldDiff {
  web: unknown;
  backup: unknown;
}
export type RawFieldDiffMap = Record<string, RawFieldDiff>;

export interface RawMasterInsert {
  legacy_mobile_id: string;
}
export interface RawMasterEqual {
  legacy_mobile_id: string;
  row_id: string;
}
export interface RawMasterConflict {
  legacy_mobile_id: string;
  row_id: string;
  fields: RawFieldDiffMap;
}
export interface RawStudentDuplicate {
  backup_legacy_mobile_id: string;
  candidate_student_id: string;
  match_signals: string[];
  candidate_fingerprint: string; // NUNCA debe llegar al DTO — sólo para re-verificación server-side.
  field_diff: RawFieldDiffMap;
}

// ---------------------------------------------------------------------------
// Identidad humana de cada lado de un posible duplicado (Fase 9, corrección
// de UX real post-E2E: el panel nunca mostraba a QUÉ alumno se refería cada
// decisión). Se arma con datos YA RESUELTOS por el servidor (fila real del
// backup + fila real de `students`) — esta función sigue siendo pura, nunca
// hace red acá; quien llama a `toImportPreviewDto` es responsable de
// resolver ambos mapas antes. `candidateStudentId` sigue siendo la ÚNICA
// clave real que ata una decisión a un candidato — el nombre es puramente
// informativo, nunca se usa para asociar nada.
// ---------------------------------------------------------------------------

export interface RawDuplicatePersonSource {
  name: string;
  levels?: string[] | null;
  initialLevel?: string | null;
  status?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** `backup_legacy_mobile_id` -> datos reales de esa fila en el backup (para el lado "backup" del panel). */
export type BackupStudentSummaryMap = Record<string, RawDuplicatePersonSource | undefined>;
/** `candidate_student_id` -> fila real de `students` (para el lado "ya existe en la web" del panel). */
export type CandidateStudentSummaryMap = Record<string, RawDuplicatePersonSource | undefined>;

function levelLabel(source: RawDuplicatePersonSource | undefined): string | undefined {
  if (!source) return undefined;
  if (source.levels && source.levels.length > 0) return source.levels.join(", ");
  if (source.initialLevel) return source.initialLevel;
  return undefined;
}

/**
 * Enmascara el contacto para el panel de duplicados — nunca el dato
 * completo, sólo lo mínimo para diferenciar dos personas ("terminado en
 * 1234" / inicial de email). Prioriza teléfono sobre email si hay ambos
 * (es el dato que más suele diferenciar en la práctica real).
 */
export function maskContact(phone?: string | null, email?: string | null): string | undefined {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length >= 4) return `Tel. terminado en ${digits.slice(-4)}`;
  if (email && email.includes("@")) {
    const [user, domain] = email.split("@");
    if (user && domain) return `${user.slice(0, 1)}•••@${domain}`;
  }
  return undefined;
}

export interface DuplicatePersonSummary {
  /** Nunca vacío: si no hay nombre real resuelto, es un fallback legible explícito, nunca un id ni un string vacío. */
  name: string;
  level?: string;
  status?: string;
  contactMasked?: string;
}

function toDuplicatePersonSummary(source: RawDuplicatePersonSource | undefined, fallbackName: string): DuplicatePersonSummary {
  return {
    name: source?.name && source.name.trim() !== "" ? source.name : fallbackName,
    level: levelLabel(source),
    status: source?.status ?? undefined,
    contactMasked: maskContact(source?.phone, source?.email),
  };
}

export interface RawMasterBucket {
  inserts: RawMasterInsert[];
  equal: RawMasterEqual[];
  conflicts: RawMasterConflict[];
}
export interface RawStudentsBucket extends RawMasterBucket {
  duplicates: RawStudentDuplicate[];
}

/** Nivel de la copia que NO se agrega porque ya existe uno con el mismo nombre (en la web o repetido dentro de la copia) — R6.1. */
export type RawCustomLevelDuplicateReason = "same_name_in_web" | "same_name_in_copy" | "blank_name";
export interface RawCustomLevelDuplicate {
  legacy_mobile_id: string;
  reason: RawCustomLevelDuplicateReason;
  name: string;
  existing_row_id: string | null;
  existing_name: string | null;
}
export interface RawCustomLevelsBucket extends RawMasterBucket {
  /** Ausente en las vistas previas anteriores a R6.1. */
  duplicates?: RawCustomLevelDuplicate[];
}

export type RawSingletonState =
  | { present_in_backup: false }
  | { present_in_backup: true; status: "insert" }
  | { present_in_backup: true; status: "equal"; row_id: string }
  | { present_in_backup: true; status: "conflict"; row_id: string; web: Record<string, unknown>; backup: Record<string, unknown> };

export type RawSurchargeState = { present_in_backup: false } | { present_in_backup: true; status: "insert" | "preserved" };

export interface RawInsertOnlyPreserved {
  legacy_mobile_id: string;
  differs: boolean;
}
export interface RawInsertOnlyBucket {
  inserts: RawMasterInsert[];
  preserved: RawInsertOnlyPreserved[];
}

export type RawAggregateItem =
  | { legacy_mobile_id: string; status: "insertable" }
  | { legacy_mobile_id: string; status: "preserved" | "omitted_broken_reference"; reason: string };

export interface RawFinancialMember {
  table_name: string;
  legacy_mobile_id: string;
}
export interface RawFinancialComponent {
  component_id: string;
  status: "insertable" | "omitted";
  members: RawFinancialMember[];
  reason: string | null;
}

export interface RawClassification {
  maestros: {
    students: RawStudentsBucket;
    custom_levels: RawCustomLevelsBucket;
    teacher_profiles: RawSingletonState;
    budget_distribution_settings: RawSingletonState;
    teacher_availability: RawSingletonState;
  };
  insert_only: {
    training_billing_agreements: RawInsertOnlyBucket;
    student_level_history: RawInsertOnlyBucket;
    surcharge_settings: RawSurchargeState;
  };
  aggregates: {
    recurrence_rules: RawAggregateItem[];
    calendar_lessons: RawAggregateItem[];
    lesson_registrations: RawAggregateItem[];
    financial_components: RawFinancialComponent[];
  };
}

export interface RawExcludedCollectionEntry {
  count: number;
  reason: string;
}
export interface RawExcludedCollections {
  studentStatusHistory: RawExcludedCollectionEntry;
  studentPriceHistory: RawExcludedCollectionEntry;
  lessonRegistrationEditHistory: RawExcludedCollectionEntry;
}

export interface RawPreviewResult {
  previewId: string;
  expiresAt: string;
  classification: RawClassification;
  excludedCollections: RawExcludedCollections;
}

// ---------------------------------------------------------------------------
// DTO limpio (camelCase, sin ningún campo técnico) — lo único que ve el cliente.
// ---------------------------------------------------------------------------

export interface FieldDiff {
  web: unknown;
  backup: unknown;
}
export type FieldDiffMap = Record<string, FieldDiff>;

export interface MasterInsert {
  legacyMobileId: string;
}
export interface MasterEqual {
  legacyMobileId: string;
  rowId: string;
}
export interface MasterConflict {
  legacyMobileId: string;
  rowId: string;
  fields: FieldDiffMap;
  /** Sólo en alumnos: el nombre real del alumno ya existente en la web, para decir de quién son las diferencias. */
  studentName?: string;
}
export interface StudentDuplicate {
  backupLegacyMobileId: string;
  candidateStudentId: string;
  matchSignals: string[];
  fieldDiff: FieldDiffMap;
  /** Alumno tal como viene en el backup — sólo informativo, nunca se usa para asociar la decisión. */
  backupStudent: DuplicatePersonSummary;
  /** Alumno ya existente en la web (mismo id que `candidateStudentId`) — sólo informativo. */
  candidateStudent: DuplicatePersonSummary;
}

export interface MasterBucket {
  inserts: MasterInsert[];
  equal: MasterEqual[];
  conflicts: MasterConflict[];
}
export interface StudentsBucket extends MasterBucket {
  duplicates: StudentDuplicate[];
}

export type CustomLevelDuplicateReason = RawCustomLevelDuplicateReason;
/** Nivel de la copia que no se agrega: el que ya tenés se conserva tal cual (no hay nada que decidir). */
export interface CustomLevelDuplicate {
  legacyMobileId: string;
  reason: CustomLevelDuplicateReason;
  /** Nombre del nivel en la copia. */
  name: string;
  /** Nombre del nivel que ya existe (sólo si ya existe en la web). */
  existingName?: string;
}
export interface CustomLevelsBucket extends MasterBucket {
  duplicates: CustomLevelDuplicate[];
}

export type SingletonState =
  | { presentInBackup: false }
  | { presentInBackup: true; status: "insert" }
  | { presentInBackup: true; status: "equal"; rowId: string }
  | { presentInBackup: true; status: "conflict"; rowId: string; web: Record<string, unknown>; backup: Record<string, unknown> };

export type SurchargeState = { presentInBackup: false } | { presentInBackup: true; status: "insert" | "preserved" };

export interface InsertOnlyPreserved {
  legacyMobileId: string;
  differs: boolean;
}
export interface InsertOnlyBucket {
  inserts: MasterInsert[];
  preserved: InsertOnlyPreserved[];
}

export type AggregateItem =
  | { legacyMobileId: string; status: "insertable" }
  | { legacyMobileId: string; status: "preserved" | "omitted_broken_reference"; reason: string };

export interface FinancialMember {
  tableName: string;
  legacyMobileId: string;
}
export interface FinancialComponent {
  componentId: string;
  status: "insertable" | "omitted";
  members: FinancialMember[];
  reason: string | null;
}

export interface ExcludedCollectionEntry {
  count: number;
  reason: string;
}
export interface ExcludedCollections {
  studentStatusHistory: ExcludedCollectionEntry;
  studentPriceHistory: ExcludedCollectionEntry;
  lessonRegistrationEditHistory: ExcludedCollectionEntry;
}

export interface ImportPreviewDto {
  previewId: string;
  expiresAt: string;
  students: StudentsBucket;
  customLevels: CustomLevelsBucket;
  singletons: {
    teacherProfile: SingletonState;
    budgetDistribution: SingletonState;
    teacherAvailability: SingletonState;
  };
  insertOnly: {
    trainingBillingAgreements: InsertOnlyBucket;
    studentLevelHistory: InsertOnlyBucket;
    surchargeSettings: SurchargeState;
  };
  aggregates: {
    recurrenceRules: AggregateItem[];
    calendarLessons: AggregateItem[];
    lessonRegistrations: AggregateItem[];
    financialComponents: FinancialComponent[];
  };
  excludedCollections: ExcludedCollections;
}

function toMasterBucket(raw: RawMasterBucket): MasterBucket {
  return {
    inserts: raw.inserts.map((i) => ({ legacyMobileId: i.legacy_mobile_id })),
    equal: raw.equal.map((e) => ({ legacyMobileId: e.legacy_mobile_id, rowId: e.row_id })),
    conflicts: raw.conflicts.map((c) => ({ legacyMobileId: c.legacy_mobile_id, rowId: c.row_id, fields: c.fields })),
  };
}

function toCustomLevelsBucket(raw: RawCustomLevelsBucket): CustomLevelsBucket {
  return {
    ...toMasterBucket(raw),
    duplicates: (raw.duplicates ?? []).map((d) => ({
      legacyMobileId: d.legacy_mobile_id,
      reason: d.reason,
      name: d.name,
      ...(d.existing_name ? { existingName: d.existing_name } : {}),
    })),
  };
}

function toSingletonState(raw: RawSingletonState): SingletonState {
  if (!raw.present_in_backup) return { presentInBackup: false };
  if (raw.status === "insert") return { presentInBackup: true, status: "insert" };
  if (raw.status === "equal") return { presentInBackup: true, status: "equal", rowId: raw.row_id };
  return { presentInBackup: true, status: "conflict", rowId: raw.row_id, web: raw.web, backup: raw.backup };
}

function toSurchargeState(raw: RawSurchargeState): SurchargeState {
  if (!raw.present_in_backup) return { presentInBackup: false };
  return { presentInBackup: true, status: raw.status };
}

function toInsertOnlyBucket(raw: RawInsertOnlyBucket): InsertOnlyBucket {
  return {
    inserts: raw.inserts.map((i) => ({ legacyMobileId: i.legacy_mobile_id })),
    preserved: raw.preserved.map((p) => ({ legacyMobileId: p.legacy_mobile_id, differs: p.differs })),
  };
}

function toAggregateItem(raw: RawAggregateItem): AggregateItem {
  if (raw.status === "insertable") return { legacyMobileId: raw.legacy_mobile_id, status: "insertable" };
  return { legacyMobileId: raw.legacy_mobile_id, status: raw.status, reason: raw.reason };
}

function toExcludedCollections(raw: RawExcludedCollections): ExcludedCollections {
  return {
    studentStatusHistory: { count: raw.studentStatusHistory.count, reason: raw.studentStatusHistory.reason },
    studentPriceHistory: { count: raw.studentPriceHistory.count, reason: raw.studentPriceHistory.reason },
    lessonRegistrationEditHistory: { count: raw.lessonRegistrationEditHistory.count, reason: raw.lessonRegistrationEditHistory.reason },
  };
}

/**
 * Única puerta real entre la forma cruda de Postgres y lo que ve el
 * navegador — nunca deja pasar `candidate_fingerprint` ni ningún otro campo
 * técnico. `duplicateContext` trae los datos humanos YA RESUELTOS por quien
 * llama (fila real del backup + fila real de `students`, ver
 * `lib/repositories/backup-import.ts`) — esta función sigue sin tocar red.
 */
export function toImportPreviewDto(
  raw: RawPreviewResult,
  duplicateContext: { backupStudents: BackupStudentSummaryMap; candidateStudents: CandidateStudentSummaryMap } = { backupStudents: {}, candidateStudents: {} }
): ImportPreviewDto {
  return {
    previewId: raw.previewId,
    expiresAt: raw.expiresAt,
    students: {
      ...toMasterBucket(raw.classification.maestros.students),
      conflicts: toMasterBucket(raw.classification.maestros.students).conflicts.map((c) => {
        const name = duplicateContext.candidateStudents[c.rowId]?.name;
        return name && name.trim() !== "" ? { ...c, studentName: name } : c;
      }),
      duplicates: raw.classification.maestros.students.duplicates.map((d) => ({
        backupLegacyMobileId: d.backup_legacy_mobile_id,
        candidateStudentId: d.candidate_student_id,
        matchSignals: d.match_signals,
        fieldDiff: d.field_diff,
        backupStudent: toDuplicatePersonSummary(duplicateContext.backupStudents[d.backup_legacy_mobile_id], "Alumno del backup sin nombre disponible"),
        candidateStudent: toDuplicatePersonSummary(duplicateContext.candidateStudents[d.candidate_student_id], "Alumno existente sin nombre disponible"),
        // candidate_fingerprint deliberadamente omitido.
      })),
    },
    customLevels: toCustomLevelsBucket(raw.classification.maestros.custom_levels),
    singletons: {
      teacherProfile: toSingletonState(raw.classification.maestros.teacher_profiles),
      budgetDistribution: toSingletonState(raw.classification.maestros.budget_distribution_settings),
      teacherAvailability: toSingletonState(raw.classification.maestros.teacher_availability),
    },
    insertOnly: {
      trainingBillingAgreements: toInsertOnlyBucket(raw.classification.insert_only.training_billing_agreements),
      studentLevelHistory: toInsertOnlyBucket(raw.classification.insert_only.student_level_history),
      surchargeSettings: toSurchargeState(raw.classification.insert_only.surcharge_settings),
    },
    aggregates: {
      recurrenceRules: raw.classification.aggregates.recurrence_rules.map(toAggregateItem),
      calendarLessons: raw.classification.aggregates.calendar_lessons.map(toAggregateItem),
      lessonRegistrations: raw.classification.aggregates.lesson_registrations.map(toAggregateItem),
      financialComponents: raw.classification.aggregates.financial_components.map((f) => ({
        componentId: f.component_id,
        status: f.status,
        members: f.members.map((m) => ({ tableName: m.table_name, legacyMobileId: m.legacy_mobile_id })),
        reason: f.reason,
      })),
    },
    excludedCollections: toExcludedCollections(raw.excludedCollections),
  };
}

// ---------------------------------------------------------------------------
// Resumen de confirmación — puro, calculado sobre el DTO + las decisiones
// actuales del profesor. La opción por defecto (nada seleccionado, todas
// las decisiones de duplicado en "skip") SIEMPRE conserva la web: cero
// overrides, cero vínculos, cero altas de "otra persona".
// ---------------------------------------------------------------------------

export interface ImportSelections {
  /** rowId (o candidateStudentId si es un duplicado vinculado) -> campos elegidos para traer del backup. */
  fieldOverridesByRow: Record<string, string[]>;
  /** backupLegacyMobileId -> decisión — ausente equivale a "skip". */
  duplicateDecisions: Record<string, "link" | "create_separate" | "skip">;
}

export interface ConfirmationSummary {
  /** Filas principales que se crearán (alumnos, niveles, config., agregados, componentes financieras completas). No cuenta hijos de agenda/registros pedagógicos (esos no vienen contados en la clasificación) — ver `mainRowsApproximate`. */
  rowsToCreate: number;
  /** true si `rowsToCreate` es un piso, no el total exacto de filas reales (agenda/registros tienen hijos no contados acá). */
  rowsToCreateIsApproximate: boolean;
  fieldsToOverride: number;
  studentsToLink: number;
  duplicatesToCreateSeparately: number;
  aggregatesOmitted: number;
  aggregatesPreserved: number;
  excludedCollectionsWithData: number;
  /** true si hay overrides, vínculos o altas explícitas de "otra persona" — exige escribir "IMPORTAR" para confirmar. */
  requiresStrongConfirmation: boolean;
}

export function computeConfirmationSummary(dto: ImportPreviewDto, selections: ImportSelections): ConfirmationSummary {
  const fieldsToOverride = Object.values(selections.fieldOverridesByRow).reduce((sum, fields) => sum + fields.length, 0);

  let studentsToLink = 0;
  let duplicatesToCreateSeparately = 0;
  for (const d of dto.students.duplicates) {
    const decision = selections.duplicateDecisions[d.backupLegacyMobileId] ?? "skip";
    if (decision === "link") studentsToLink += 1;
    if (decision === "create_separate") duplicatesToCreateSeparately += 1;
  }

  const singletonInserts = [dto.singletons.teacherProfile, dto.singletons.budgetDistribution, dto.singletons.teacherAvailability].filter(
    (s) => s.presentInBackup && s.status === "insert"
  ).length;
  const surchargeInsert = dto.insertOnly.surchargeSettings.presentInBackup && dto.insertOnly.surchargeSettings.status === "insert" ? 1 : 0;

  const aggregateArrays = [dto.aggregates.recurrenceRules, dto.aggregates.calendarLessons, dto.aggregates.lessonRegistrations];
  const aggregatesInsertable = aggregateArrays.reduce((sum, arr) => sum + arr.filter((a) => a.status === "insertable").length, 0);
  const aggregatesOmitted =
    aggregateArrays.reduce((sum, arr) => sum + arr.filter((a) => a.status === "omitted_broken_reference").length, 0) +
    dto.aggregates.financialComponents.filter((f) => f.status === "omitted").length;
  const aggregatesPreserved = aggregateArrays.reduce((sum, arr) => sum + arr.filter((a) => a.status === "preserved").length, 0);

  const financialMembersInsertable = dto.aggregates.financialComponents
    .filter((f) => f.status === "insertable")
    .reduce((sum, f) => sum + f.members.length, 0);

  const rowsToCreate =
    dto.students.inserts.length +
    duplicatesToCreateSeparately +
    dto.customLevels.inserts.length +
    singletonInserts +
    surchargeInsert +
    dto.insertOnly.trainingBillingAgreements.inserts.length +
    dto.insertOnly.studentLevelHistory.inserts.length +
    aggregatesInsertable +
    financialMembersInsertable;

  const excludedCollectionsWithData = Object.values(dto.excludedCollections).filter((c) => c.count > 0).length;

  return {
    rowsToCreate,
    rowsToCreateIsApproximate: aggregatesInsertable > 0,
    fieldsToOverride,
    studentsToLink,
    duplicatesToCreateSeparately,
    aggregatesOmitted,
    aggregatesPreserved,
    excludedCollectionsWithData,
    requiresStrongConfirmation: fieldsToOverride > 0 || studentsToLink > 0 || duplicatesToCreateSeparately > 0,
  };
}

export const STRONG_CONFIRMATION_PHRASE = "IMPORTAR";
