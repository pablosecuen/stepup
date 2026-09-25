import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toImportPreviewDto,
  computeConfirmationSummary,
  type RawPreviewResult,
  type ImportSelections,
} from "../import-preview-mapping.ts";

function baseRaw(overrides: Partial<RawPreviewResult["classification"]> = {}): RawPreviewResult {
  return {
    previewId: "11111111-1111-1111-1111-111111111111",
    expiresAt: "2026-09-27T00:30:00.000Z",
    classification: {
      maestros: {
        students: { inserts: [], equal: [], conflicts: [], duplicates: [] },
        custom_levels: { inserts: [], equal: [], conflicts: [] },
        teacher_profiles: { present_in_backup: false },
        budget_distribution_settings: { present_in_backup: false },
        teacher_availability: { present_in_backup: false },
      },
      insert_only: {
        training_billing_agreements: { inserts: [], preserved: [] },
        student_level_history: { inserts: [], preserved: [] },
        surcharge_settings: { present_in_backup: false },
      },
      aggregates: {
        recurrence_rules: [],
        calendar_lessons: [],
        lesson_registrations: [],
        financial_components: [],
      },
      ...overrides,
    },
    excludedCollections: {
      studentStatusHistory: { count: 0, reason: "sin clave estable" },
      studentPriceHistory: { count: 0, reason: "sin clave estable" },
      lessonRegistrationEditHistory: { count: 0, reason: "sin vía de escritura" },
    },
  };
}

test("toImportPreviewDto: nunca deja pasar candidate_fingerprint al DTO", () => {
  const raw = baseRaw({
    maestros: {
      students: {
        inserts: [],
        equal: [],
        conflicts: [],
        duplicates: [
          {
            backup_legacy_mobile_id: "bkp1",
            candidate_student_id: "row-1",
            match_signals: ["name"],
            candidate_fingerprint: "deadbeef_secreto_interno",
            field_diff: {},
          },
        ],
      },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  assert.equal(dto.students.duplicates[0].backupLegacyMobileId, "bkp1");
  assert.equal("candidateFingerprint" in dto.students.duplicates[0], false, "el fingerprint nunca debe sobrevivir al mapeo");
  assert.equal(JSON.stringify(dto).includes("deadbeef_secreto_interno"), false, "el fingerprint no debe aparecer en ningún lado del DTO serializado");
});

test("toImportPreviewDto: singletons ausentes/insert/equal/conflict mapean camelCase sin perder campos", () => {
  const raw = baseRaw({
    maestros: {
      students: { inserts: [], equal: [], conflicts: [], duplicates: [] },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: true, status: "conflict", row_id: "owner-1", web: { display_name: "Web" }, backup: { display_name: "Backup" } },
      budget_distribution_settings: { present_in_backup: true, status: "equal", row_id: "owner-1" },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  assert.deepEqual(dto.singletons.teacherProfile, { presentInBackup: true, status: "conflict", rowId: "owner-1", web: { display_name: "Web" }, backup: { display_name: "Backup" } });
  assert.deepEqual(dto.singletons.budgetDistribution, { presentInBackup: true, status: "equal", rowId: "owner-1" });
  assert.deepEqual(dto.singletons.teacherAvailability, { presentInBackup: false });
});

test("toImportPreviewDto: agregado omitted_broken_reference conserva el motivo legible", () => {
  const raw = baseRaw({
    maestros: {
      students: { inserts: [], equal: [], conflicts: [], duplicates: [] },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
    aggregates: {
      recurrence_rules: [],
      calendar_lessons: [],
      lesson_registrations: [{ legacy_mobile_id: "lr1", status: "omitted_broken_reference", reason: "roster con un alumno inexistente" }],
      financial_components: [],
    },
  });
  const dto = toImportPreviewDto(raw);
  assert.deepEqual(dto.aggregates.lessonRegistrations[0], {
    legacyMobileId: "lr1",
    status: "omitted_broken_reference",
    reason: "roster con un alumno inexistente",
  });
});

test("toImportPreviewDto: colecciones excluidas de v1 siempre visibles con cantidad y motivo", () => {
  const raw = baseRaw();
  raw.excludedCollections.studentStatusHistory = { count: 7, reason: "Sin clave de identidad estable todavía." };
  const dto = toImportPreviewDto(raw);
  assert.deepEqual(dto.excludedCollections.studentStatusHistory, { count: 7, reason: "Sin clave de identidad estable todavía." });
});

const EMPTY_SELECTIONS: ImportSelections = { fieldOverridesByRow: {}, duplicateDecisions: {} };

test("computeConfirmationSummary: por defecto (nada seleccionado) siempre conserva la web — cero overrides, cero vínculos, sin confirmación reforzada", () => {
  const raw = baseRaw({
    maestros: {
      students: {
        inserts: [{ legacy_mobile_id: "s1" }],
        equal: [],
        conflicts: [{ legacy_mobile_id: "s2", row_id: "row-2", fields: { phone: { web: "111", backup: "222" } } }],
        duplicates: [{ backup_legacy_mobile_id: "s3", candidate_student_id: "row-3", match_signals: ["name"], candidate_fingerprint: "x", field_diff: {} }],
      },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, EMPTY_SELECTIONS);
  assert.equal(summary.fieldsToOverride, 0);
  assert.equal(summary.studentsToLink, 0);
  assert.equal(summary.duplicatesToCreateSeparately, 0);
  assert.equal(summary.requiresStrongConfirmation, false);
  // El alta limpia (s1) sí se crea siempre -- eso no es "pisar la web", es un alumno que no existía.
  assert.equal(summary.rowsToCreate, 1);
});

test("computeConfirmationSummary: overrides de campo activan confirmación reforzada y se cuentan", () => {
  const raw = baseRaw({
    maestros: {
      students: {
        inserts: [],
        equal: [],
        conflicts: [{ legacy_mobile_id: "s2", row_id: "row-2", fields: { phone: { web: "111", backup: "222" }, notes: { web: "a", backup: "b" } } }],
        duplicates: [],
      },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, { fieldOverridesByRow: { "row-2": ["phone", "notes"] }, duplicateDecisions: {} });
  assert.equal(summary.fieldsToOverride, 2);
  assert.equal(summary.requiresStrongConfirmation, true);
});

test("computeConfirmationSummary: vincular cuenta como estudiantesToLink y activa confirmación reforzada, crear_separate cuenta aparte y también la activa", () => {
  const raw = baseRaw({
    maestros: {
      students: {
        inserts: [],
        equal: [],
        conflicts: [],
        duplicates: [
          { backup_legacy_mobile_id: "d1", candidate_student_id: "row-1", match_signals: ["name"], candidate_fingerprint: "x", field_diff: {} },
          { backup_legacy_mobile_id: "d2", candidate_student_id: "row-2", match_signals: ["email"], candidate_fingerprint: "y", field_diff: {} },
        ],
      },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, {
    fieldOverridesByRow: {},
    duplicateDecisions: { d1: "link", d2: "create_separate" },
  });
  assert.equal(summary.studentsToLink, 1);
  assert.equal(summary.duplicatesToCreateSeparately, 1);
  assert.equal(summary.requiresStrongConfirmation, true);
  assert.equal(summary.rowsToCreate, 1, "sólo create_separate genera una fila nueva, link nunca inserta");
});

test("computeConfirmationSummary: 'omitir por ahora' (skip) no activa confirmación reforzada ni crea filas", () => {
  const raw = baseRaw({
    maestros: {
      students: {
        inserts: [],
        equal: [],
        conflicts: [],
        duplicates: [{ backup_legacy_mobile_id: "d1", candidate_student_id: "row-1", match_signals: ["name"], candidate_fingerprint: "x", field_diff: {} }],
      },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, { fieldOverridesByRow: {}, duplicateDecisions: { d1: "skip" } });
  assert.equal(summary.requiresStrongConfirmation, false);
  assert.equal(summary.rowsToCreate, 0);
});

test("computeConfirmationSummary: agregados omitidos/preservados se cuentan por separado, nunca activan la confirmación reforzada por sí solos", () => {
  const raw = baseRaw({
    maestros: {
      students: { inserts: [], equal: [], conflicts: [], duplicates: [] },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
    aggregates: {
      recurrence_rules: [
        { legacy_mobile_id: "r1", status: "omitted_broken_reference", reason: "referencia a alumno inexistente" },
        { legacy_mobile_id: "r2", status: "preserved", reason: "la regla ya existe en la web" },
      ],
      calendar_lessons: [],
      lesson_registrations: [],
      financial_components: [{ component_id: "payments:x", status: "omitted", members: [{ table_name: "payments", legacy_mobile_id: "p1" }], reason: "referencia a alumno inexistente" }],
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, EMPTY_SELECTIONS);
  assert.equal(summary.aggregatesOmitted, 2, "1 recurrence_rules omitted_broken_reference + 1 financial_component omitted");
  assert.equal(summary.aggregatesPreserved, 1);
  assert.equal(summary.requiresStrongConfirmation, false, "agregados omitidos/preservados no son una decisión del profesor -- nunca exigen escribir IMPORTAR por sí solos");
});

test("computeConfirmationSummary: colecciones excluidas con datos reales se cuentan, sin datos no suman", () => {
  const raw = baseRaw();
  raw.excludedCollections.studentStatusHistory = { count: 3, reason: "x" };
  raw.excludedCollections.studentPriceHistory = { count: 0, reason: "x" };
  raw.excludedCollections.lessonRegistrationEditHistory = { count: 0, reason: "x" };
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, EMPTY_SELECTIONS);
  assert.equal(summary.excludedCollectionsWithData, 1);
});

test("computeConfirmationSummary: componentes financieras insertables suman sus miembros reales, nunca sólo 1 por componente", () => {
  const raw = baseRaw({
    maestros: {
      students: { inserts: [], equal: [], conflicts: [], duplicates: [] },
      custom_levels: { inserts: [], equal: [], conflicts: [] },
      teacher_profiles: { present_in_backup: false },
      budget_distribution_settings: { present_in_backup: false },
      teacher_availability: { present_in_backup: false },
    },
    aggregates: {
      recurrence_rules: [],
      calendar_lessons: [],
      lesson_registrations: [],
      financial_components: [
        {
          component_id: "payments:x",
          status: "insertable",
          members: [
            { table_name: "payments", legacy_mobile_id: "pay1" },
            { table_name: "payment_charges", legacy_mobile_id: "chg1" },
            { table_name: "payment_allocations", legacy_mobile_id: "alloc1" },
          ],
          reason: null,
        },
      ],
    },
  });
  const dto = toImportPreviewDto(raw);
  const summary = computeConfirmationSummary(dto, EMPTY_SELECTIONS);
  assert.equal(summary.rowsToCreate, 3);
});
