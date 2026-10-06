import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCLUDED_COLLECTION_LABELS,
  IMPORT_GLOSSARY,
  PREVIEW_VALIDITY_MINUTES,
  countOf,
  describeFinancialMembers,
  describeMatchSignals,
  fieldLabel,
  formatFieldValue,
  translateImportError,
  translateOmissionReason,
  translateValidationErrors,
  type ImportErrorContext,
} from "../import-copy.ts";
import { toImportPreviewDto, type RawPreviewResult } from "../import-preview-mapping.ts";

// Datos 100% sintéticos: nombres inventados y ids de mentira. Nada de esto sale de un respaldo real.

const LEAKS = /[0-9a-f]{8}-[0-9a-f]{4}-|\bstudents\b|\bpayments\b|payment_|calendar_|lesson_|\bpreview\b|invariante|\bfilas?\b|checksum|schema|esquema|legacy|\bnull\b|undefined/i;

test("countOf: singular y plural, también con cero", () => {
  assert.equal(countOf(1, "alumno", "alumnos"), "1 alumno");
  assert.equal(countOf(0, "alumno", "alumnos"), "0 alumnos");
  assert.equal(countOf(7, "alumno", "alumnos"), "7 alumnos");
});

test("el vocabulario son cinco palabras fijas y cada una tiene su significado", () => {
  assert.deepEqual(
    IMPORT_GLOSSARY.map((e) => e.term),
    ["Agregar", "Conservar", "Reemplazar", "No importar", "Deshacer"],
  );
  assert.match(IMPORT_GLOSSARY[2].meaning, /Solo pasa si lo marcás vos/);
  assert.match(IMPORT_GLOSSARY[4].meaning, /tiempo limitado/);
  assert.equal(PREVIEW_VALIDITY_MINUTES, 30);
});

test("etiquetas de datos: nunca el nombre de la columna; lo desconocido es «Otro dato»", () => {
  assert.equal(fieldLabel("students", "phone"), "Teléfono");
  assert.equal(fieldLabel("students", "name"), "Nombre del alumno");
  assert.equal(fieldLabel("custom_levels", "name"), "Nombre del nivel");
  assert.equal(fieldLabel("teacher_profiles", "display_name"), "Nombre visible");
  assert.equal(fieldLabel("budget_distribution_settings", "needs_percent"), "Porcentaje para necesidades");
  assert.equal(fieldLabel("teacher_availability", "weekly_blocks"), "Bloqueos semanales");
  for (const field of ["areas_to_improve", "usual_days", "savings_goal_target_date", "columna_nueva_interna"]) {
    assert.doesNotMatch(fieldLabel("students", field), /_/, field);
  }
  assert.equal(fieldLabel("students", "columna_nueva_interna"), "Otro dato");
});

test("valores legibles: sin JSON, sin null, con fechas y porcentajes de la app", () => {
  assert.equal(formatFieldValue("notes", null), "vacío");
  assert.equal(formatFieldValue("notes", "   "), "vacío");
  assert.equal(formatFieldValue("alerts", []), "vacío");
  assert.equal(formatFieldValue("savings_goal_enabled", true), "Sí");
  assert.equal(formatFieldValue("savings_goal_enabled", false), "No");
  assert.equal(formatFieldValue("current_goals", ["Conversación", "Escritura"]), "Conversación, Escritura");
  assert.equal(formatFieldValue("birth_date", "2010-03-04"), "04/03/2010");
  assert.equal(formatFieldValue("savings_goal_target_date", "2027-01-31"), "31/01/2027");
  assert.equal(formatFieldValue("needs_percent", 50), "50%");
  assert.equal(formatFieldValue("savings_goal_target_amount", 15000).replace(/ /g, " "), "$ 15.000");
  assert.equal(formatFieldValue("weekly_blocks", [{}, {}, {}]), "3 bloques");
  assert.equal(formatFieldValue("weekly_blocks", [{}]), "1 bloque");
  assert.equal(formatFieldValue("exceptions", [{}, {}]), "2 excepciones");
  assert.equal(formatFieldValue("something", [{ a: 1 }]), "1 elemento");
  assert.equal(formatFieldValue("something", { a: 1 }), "datos con varios campos");
  const long = formatFieldValue("notes", "x".repeat(500));
  assert.ok(long.length <= 120 && long.endsWith("…"), "los textos largos se acortan");
  for (const v of [null, undefined, [], {}, [{ a: 1 }], { a: { b: 2 } }]) assert.doesNotMatch(formatFieldValue("x", v), /[{}\[\]"]|null|undefined/);
});

test("señales de coincidencia: «el nombre y el teléfono»; una desconocida nunca se muestra cruda", () => {
  assert.equal(describeMatchSignals(["name"]), "el nombre");
  assert.equal(describeMatchSignals(["name", "phone"]), "el nombre y el teléfono");
  assert.equal(describeMatchSignals(["name", "email", "phone"]), "el nombre, el correo y el teléfono");
  assert.equal(describeMatchSignals(["senal_nueva"]), "otros datos");
});

test("motivos de omisión: una frase clara por cada motivo conocido, y una genérica para los demás (nunca ids ni tablas)", () => {
  assert.match(translateOmissionReason("referencia a alumno inexistente"), /alumno que no está en la web ni en la copia/);
  assert.match(translateOmissionReason("referencia a acuerdo de entrenamiento inexistente"), /acuerdo de entrenamiento/);
  assert.match(translateOmissionReason("referencia a una serie que no se importó"), /serie que no se importa/);
  assert.match(translateOmissionReason("referencia a una clase de calendario que no se importó"), /clase del calendario/);
  assert.match(translateOmissionReason("roster con un alumno inexistente"), /alumno/);
  assert.match(translateOmissionReason("referencia a registro de clase inexistente"), /registro de clase/);
  assert.match(translateOmissionReason("la clase ya existe en la web"), /ya existe en la web/);
  assert.match(translateOmissionReason("referencia a pago-9f8e no existe ni en el backup ni en la web"), /no está en la web ni en la copia/);
  assert.match(translateOmissionReason("payments con legacy_mobile_id 8f1b2c3d-1111-2222-3333-444455556666 ya existe en la web"), /ya existe en la web/);
  for (const raw of [null, undefined, "", "algo raro con payments y 8f1b2c3d-1111-2222-3333-444455556666"]) {
    assert.doesNotMatch(translateOmissionReason(raw), LEAKS);
  }
});

test("grupos de cobros: se cuentan por tipo con nombres humanos, sin ids ni nombres de tabla", () => {
  assert.equal(describeFinancialMembers([{ tableName: "payments" }, { tableName: "payments" }, { tableName: "payment_charges" }]), "2 pagos, 1 cobro");
  assert.equal(describeFinancialMembers([{ tableName: "payment_allocations" }]), "1 asignación de un pago a un cobro");
  assert.equal(describeFinancialMembers([{ tableName: "tabla_nueva" }, { tableName: "otra_tabla" }]), "2 otros datos de cobros");
  assert.equal(describeFinancialMembers([]), "");
  assert.doesNotMatch(describeFinancialMembers([{ tableName: "package_credit_movements" }, { tableName: "first_month_proration_decisions" }]), /_/);
});

test("lo que no se importa tiene nombre propio y ningún término interno", () => {
  assert.deepEqual(Object.keys(EXCLUDED_COLLECTION_LABELS).sort(), ["lessonRegistrationEditHistory", "studentPriceHistory", "studentStatusHistory"]);
  for (const label of Object.values(EXCLUDED_COLLECTION_LABELS)) assert.doesNotMatch(label, LEAKS);
});

// ---------------------------------------------------------------------------
// Errores: cada mensaje real de las RPC se traduce, lleva un código estable y no filtra nada interno
// ---------------------------------------------------------------------------

const RAW_MESSAGES: Array<[string, ImportErrorContext, string]> = [
  ["No hay una sesión autenticada.", "analyze", "session_required"],
  ["No encontramos ningún respaldo en la nube para tu cuenta.", "analyze", "no_cloud_backup"],
  ["El backup supera el tamaño máximo permitido.", "analyze", "backup_too_large"],
  ["El preview ya no es válido (vencido o ya resuelto). Generá uno nuevo.", "apply", "review_expired"],
  ["El preview no existe o no te pertenece.", "apply", "review_expired"],
  ["La fila 8f1b2c3d-1111-2222-3333-444455556666 de students cambió desde que se generó el preview. Generá un preview nuevo.", "apply", "review_outdated"],
  ["El alumno 8f1b2c3d-1111-2222-3333-444455556666 ya existe — generá un preview nuevo.", "apply", "review_outdated"],
  ["Apareció una coincidencia heurística nueva para abc desde que se generó el preview — generá un preview nuevo.", "apply", "review_outdated"],
  ["El pago 12 ya existe — preview desactualizado.", "apply", "review_outdated"],
  ["Invariante violada: las asignaciones del pago 1 (a) superan su importe (b).", "apply", "integrity_check_failed"],
  ["Invariante violada: un cargo de tipo paquete quedó sin compra asociada.", "apply", "integrity_check_failed"],
  ["Campo name no es overridable en payments.", "apply", "selection_invalid"],
  ["Decisión de duplicado inválida: x.", "apply", "selection_invalid"],
  ["candidate_student_id no coincide con el candidato real analizado por el preview.", "apply", "selection_invalid"],
  ["La fila x de students no está clasificada como conflicto en este preview.", "apply", "selection_invalid"],
  ["Esta importación ya fue deshecha.", "undo", "undo_already_done"],
  ["Esta importación ya no puede deshacerse.", "undo", "undo_already_done"],
  ["El plazo para deshacer esta importación ya venció (2026-10-01 12:00:00+00).", "undo", "undo_expired"],
  ["La fila 1 de payments tiene dependencias creadas después de la importación — deshacer bloqueado por completo, no se tocó nada.", "undo", "undo_blocked"],
  ["El preview de undo ya no es válido. Generá uno nuevo con preview_undo_backup_import.", "undo", "undo_review_expired"],
  ["Importación no encontrada.", "undoPreview", "import_not_found"],
  ["Algo que nunca vimos con payments y 8f1b2c3d-1111-2222-3333-444455556666", "apply", "unexpected_error"],
];

test("cada mensaje interno de las RPC se traduce a una frase útil con su código y sin filtrar nada técnico", () => {
  for (const [raw, context, code] of RAW_MESSAGES) {
    const t = translateImportError(raw, context);
    assert.equal(t.code, code, raw);
    assert.doesNotMatch(t.message, LEAKS, `${raw} → ${t.message}`);
    assert.ok(t.message.length > 30 && t.message.length < 330, `largo razonable: ${t.message.length}`);
    assert.match(t.code, /^[a-z_]+$/, "el código de soporte es estable y no contiene datos");
  }
});

test("los errores dicen qué pasó con los datos: «no se cambió nada» cuando es cierto, y prudencia cuando no se sabe", () => {
  assert.match(translateImportError("El preview ya no es válido (vencido o ya resuelto).", "apply").message, /No se importó nada nuevo/);
  assert.match(translateImportError("Invariante violada: x", "apply").message, /No se cambió nada en la web/);
  assert.match(translateImportError("La fila x de students cambió desde el preview.", "apply").message, /No se importó nada/);
  assert.match(translateImportError("bloqueado — deshacer bloqueado por completo", "undo").message, /No se cambió nada/);
  // Un error inesperado al importar NO afirma que no se importó nada: manda a mirar el historial.
  const unknownApply = translateImportError("algo raro", "apply");
  assert.match(unknownApply.message, /historial/);
  assert.doesNotMatch(unknownApply.message, /^No se importó nada/);
  assert.match(translateImportError("algo raro", "analyze").message, /No se cambió nada/);
  assert.match(translateImportError("algo raro", "discard").message, /Sigue disponible/);
  assert.match(translateImportError("algo raro", "history").message, /historial de importaciones/);
});

test("una falla de red nunca asegura que no pasó nada al importar o deshacer: manda al historial y recuerda que reintentar no duplica", () => {
  const network = "No se pudo conectar con el servidor. Revisá tu conexión y volvé a intentar: lo que escribiste sigue acá.";
  const apply = translateImportError(network, "apply");
  assert.equal(apply.code, "network_unreachable");
  assert.match(apply.message, /no sabemos si la importación llegó a completarse/);
  assert.match(apply.message, /historial/);
  assert.match(apply.message, /no se duplica nada/);
  assert.match(translateImportError(network, "undo").message, /no sabemos si se llegó a deshacer/);
  const analyze = translateImportError(network, "analyze");
  assert.match(analyze.message, /No se cambió nada/);
  assert.doesNotMatch(analyze.message, /lo que escribiste/);
});

test("los mensajes del servicio (permisos, conflictos) pasan tal cual, con su propio código", () => {
  const t = translateImportError("No tenés permiso para realizar esta acción.", "apply");
  assert.deepEqual(t, { message: "No tenés permiso para realizar esta acción.", code: "service_error" });
  assert.equal(translateImportError("Hubo un conflicto con otra operación. Intentá de nuevo.", "apply").code, "service_error");
});

test("errores de validación del respaldo: se traducen por código (nunca por texto ni por colección) y el código de soporte lista los distintos", () => {
  const tooLarge = translateValidationErrors([{ code: "too_large" }]);
  assert.equal(tooLarge.code, "backup_too_large");
  assert.match(tooLarge.message, /20 MB/);
  assert.equal(translateValidationErrors([{ code: "too_many_rows" }, { code: "too_many_rows_total" }]).code, "backup_too_many_rows");
  assert.equal(translateValidationErrors([{ code: "string_too_long" }]).code, "backup_text_too_long");
  assert.equal(translateValidationErrors([{ code: "unknown_schema_version" }]).code, "backup_version_unknown");
  for (const code of ["not_an_object", "too_deep", "dangerous_key", "missing_field", "algo_nuevo"]) {
    const t = translateValidationErrors([{ code }]);
    assert.equal(t.code, "backup_format_invalid", code);
    assert.match(t.message, /No se cambió nada/);
    assert.doesNotMatch(t.message, LEAKS);
  }
  const several = translateValidationErrors([{ code: "missing_field" }, { code: "missing_field" }, { code: "too_large" }]);
  assert.equal(several.code, "backup_format_invalid, backup_too_large", "sin repetir");
  assert.match(several.message, /otros problemas/);
  assert.equal(translateValidationErrors([]).code, "backup_format_invalid");
});

// ---------------------------------------------------------------------------
// Mapeo: el nombre del alumno en conflicto llega sólo cuando se pudo leer
// ---------------------------------------------------------------------------

function rawWithConflict(): RawPreviewResult {
  const emptyBucket = { inserts: [], equal: [], conflicts: [] };
  return {
    previewId: "p",
    expiresAt: "2026-10-06T15:00:00Z",
    classification: {
      maestros: {
        students: { ...emptyBucket, conflicts: [{ legacy_mobile_id: "d", row_id: "r1", fields: { phone: { web: "1", backup: "2" } } }], duplicates: [] },
        custom_levels: emptyBucket,
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
      studentStatusHistory: { count: 0, reason: "" },
      studentPriceHistory: { count: 0, reason: "" },
      lessonRegistrationEditHistory: { count: 0, reason: "" },
    },
  };
}

test("el alumno en conflicto trae su nombre si se pudo leer; si no, la propiedad no existe (y nunca llega el fingerprint)", () => {
  const withName = toImportPreviewDto(rawWithConflict(), { backupStudents: {}, candidateStudents: { r1: { name: "Mateo Prueba" } } });
  assert.equal(withName.students.conflicts[0].studentName, "Mateo Prueba");
  const withoutName = toImportPreviewDto(rawWithConflict(), { backupStudents: {}, candidateStudents: {} });
  assert.equal("studentName" in withoutName.students.conflicts[0], false);
  const blank = toImportPreviewDto(rawWithConflict(), { backupStudents: {}, candidateStudents: { r1: { name: "   " } } });
  assert.equal("studentName" in blank.students.conflicts[0], false);
  assert.doesNotMatch(JSON.stringify(withName), /fingerprint/i);
});
