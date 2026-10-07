import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCustomLevelDuplicate, fieldLabel, formatFieldValue, translateImportError } from "../import-copy.ts";
import { toImportPreviewDto, computeConfirmationSummary, type RawPreviewResult } from "../import-preview-mapping.ts";

// R6.1 — niveles repetidos, suma 100 del presupuesto 50/30/20 y su vista previa. Datos 100 % sintéticos.

const LEAKS = /[0-9a-f]{8}-[0-9a-f]{4}-|\bstudents\b|\bpayments\b|payment_|calendar_|lesson_|\bpreview\b|invariante|\bfilas?\b|checksum|schema|esquema|legacy|\bnull\b|undefined/i;

function baseRaw(): RawPreviewResult {
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
      aggregates: { recurrence_rules: [], calendar_lessons: [], lesson_registrations: [], financial_components: [] },
    },
    excludedCollections: {
      studentStatusHistory: { count: 0, reason: "x" },
      studentPriceHistory: { count: 0, reason: "x" },
      lessonRegistrationEditHistory: { count: 0, reason: "x" },
    },
  };
}

test("un reemplazo de nombre de nivel que choca con otro tiene su propio mensaje y código (no el genérico «ya existe»)", () => {
  const t = translateImportError("Ya existe otro nivel con ese nombre.", "apply");
  assert.equal(t.code, "level_name_taken");
  assert.match(t.message, /ya tenés otro nivel con ese nombre/);
  assert.match(t.message, /No se importó nada/);
  assert.doesNotMatch(t.message, LEAKS);
  assert.notEqual(t.code, "review_outdated");
  assert.notEqual(t.code, "unexpected_error");
});

test("un nivel sin nombre y un nivel que aparece después de revisar también se distinguen", () => {
  assert.equal(translateImportError("Un nivel quedaría sin nombre.", "apply").code, "level_name_blank");
  const late = translateImportError("Apareció un nivel con el mismo nombre desde que se generó el preview — generá un preview nuevo.", "apply");
  assert.equal(late.code, "level_name_appeared");
  assert.match(late.message, /No se importó nada/);
  assert.doesNotMatch(late.message, LEAKS);
});

test("una distribución 50/30/20 que no suma 100 se explica en lenguaje simple y dice qué hacer", () => {
  const t = translateImportError("La distribución 50/30/20 que elegiste no suma 100.", "apply");
  assert.equal(t.code, "budget_sum_invalid");
  assert.match(t.message, /no suman 100/);
  assert.match(t.message, /los tres porcentajes juntos/);
  assert.match(t.message, /no se importó nada/);
  assert.doesNotMatch(t.message, LEAKS);
});

test("ninguno de los mensajes nuevos expone constraints, tablas ni SQL", () => {
  const raws = [
    "Ya existe otro nivel con ese nombre.",
    "Un nivel quedaría sin nombre.",
    "La distribución 50/30/20 que elegiste no suma 100.",
    "Apareció un nivel con el mismo nombre desde que se generó el preview — generá un preview nuevo.",
  ];
  for (const raw of raws) {
    const { message, code } = translateImportError(raw, "apply");
    assert.doesNotMatch(message, /custom_levels|budget_distribution|constraint|violates|unique|sum_100|SQL|public\./i, raw);
    assert.doesNotMatch(code, /custom_levels|constraint|unique/i);
  }
});

test("una violación de índice único cualquiera NO se confunde con un nivel repetido y no se muestra cruda", () => {
  const t = translateImportError('duplicate key value violates unique constraint "custom_levels_owner_name_unique"', "apply");
  assert.notEqual(t.code, "level_name_taken");
  assert.doesNotMatch(t.message, /custom_levels|constraint|unique/i);
});

test("describeCustomLevelDuplicate nombra el nivel y dice qué pasa con él, sin ids ni nombres técnicos", () => {
  assert.equal(describeCustomLevelDuplicate({ reason: "same_name_in_web", name: "Nivel A", existingName: "Nivel A" }), "«Nivel A»: ya tenés un nivel con ese nombre. Se conserva el que ya tenés.");
  assert.match(describeCustomLevelDuplicate({ reason: "same_name_in_web", name: "nivel a ", existingName: "Nivel A" }), /ya tenés el nivel «Nivel A» \(se escribe casi igual\)\. Se conserva el que ya tenés\./);
  assert.match(describeCustomLevelDuplicate({ reason: "same_name_in_copy", name: "Nivel B" }), /aparece más de una vez en la copia\. Se agrega una sola vez\./);
  assert.match(describeCustomLevelDuplicate({ reason: "blank_name", name: "" }), /sin nombre/);
  for (const reason of ["same_name_in_web", "same_name_in_copy", "blank_name"] as const) {
    assert.doesNotMatch(describeCustomLevelDuplicate({ reason, name: "Nivel", existingName: "Nivel" }), LEAKS);
  }
});

test("la decisión agrupada del presupuesto tiene una etiqueta clara y se formatea como «50/30/20»", () => {
  assert.match(fieldLabel("budget_distribution_settings", "distribution"), /Distribución 50\/30\/20/);
  assert.equal(formatFieldValue("distribution", "40/40/20"), "40/40/20");
});

test("los niveles repetidos llegan al DTO con su motivo y el nombre (sin id de fila ni nombre técnico)", () => {
  const raw = baseRaw();
  raw.classification.maestros.custom_levels = {
    inserts: [{ legacy_mobile_id: "cv_new" }],
    equal: [],
    conflicts: [],
    duplicates: [
      { legacy_mobile_id: "cv_dup_web", reason: "same_name_in_web", name: "nivel a", existing_row_id: "22222222-2222-2222-2222-222222222222", existing_name: "Nivel A" },
      { legacy_mobile_id: "cv_dup_copy", reason: "same_name_in_copy", name: "Nivel B", existing_row_id: null, existing_name: null },
    ],
  };
  const dto = toImportPreviewDto(raw);
  assert.equal(dto.customLevels.inserts.length, 1);
  assert.deepEqual(dto.customLevels.duplicates, [
    { legacyMobileId: "cv_dup_web", reason: "same_name_in_web", name: "nivel a", existingName: "Nivel A" },
    { legacyMobileId: "cv_dup_copy", reason: "same_name_in_copy", name: "Nivel B" },
  ]);
  assert.doesNotMatch(JSON.stringify(dto.customLevels.duplicates), /2222|existing_row_id|existingRowId/);
});

test("una vista previa anterior (sin la clave de duplicados de niveles) sigue mapeándose, con la lista vacía", () => {
  assert.deepEqual(toImportPreviewDto(baseRaw()).customLevels.duplicates, []);
});

test("los niveles repetidos no suman elementos por crear ni piden confirmación reforzada", () => {
  const raw = baseRaw();
  raw.classification.maestros.custom_levels = {
    inserts: [],
    equal: [],
    conflicts: [],
    duplicates: [{ legacy_mobile_id: "cv_dup", reason: "same_name_in_web", name: "Nivel A", existing_row_id: "22222222-2222-2222-2222-222222222222", existing_name: "Nivel A" }],
  };
  const summary = computeConfirmationSummary(toImportPreviewDto(raw), { fieldOverridesByRow: {}, duplicateDecisions: {} });
  assert.equal(summary.rowsToCreate, 0);
  assert.equal(summary.requiresStrongConfirmation, false);
});
