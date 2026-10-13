import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { translateImportError, translateImportTimeout, translateValidationErrors, type ImportErrorContext } from "../../backup/import-copy.ts";
import { DELETE_ACCOUNT_MESSAGES } from "../../account/delete-account-flow.ts";
import { domainErrorMessage } from "../../errors/domain-error-message.ts";

/**
 * Corrección final del Bloque 6: ningún código interno (slug, SQLSTATE, RPC, constraint, tabla, id) se muestra en la interfaz ni viaja en
 * los mensajes al navegador. La clasificación interna se conserva en el servidor y sólo se registra en su log seguro.
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

/** Slug con guion bajo (no_cloud_backup, backup_too_large, undo_failed, payment_charges…), SQLSTATE/PGRST y palabras de base de datos. */
const SLUG = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;
const DB_WORDS = /\b(PGRST\d*|SQLSTATE|constraint|violates|rpc|payment_\w+|cloud_backups?|import_(?:runs|previews)|lesson_\w+|preview_backup_import|apply_backup_import|delete_own_account|undo_\w+|active_sessions)\b/i;
const SUPPORT_CODE = /c[óo]digo (?:para|de) soporte|soporte con el c[óo]digo|el c[óo]digo (?:interno|de error)/i;

function assertClean(message: string, label: string) {
  assert.doesNotMatch(message, SLUG, `${label}: slug visible → ${message}`);
  assert.doesNotMatch(message, DB_WORDS, `${label}: término de base de datos → ${message}`);
  assert.doesNotMatch(message, SUPPORT_CODE, `${label}: remite a un código → ${message}`);
  assert.doesNotMatch(message, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `${label}: id visible`);
  assert.doesNotMatch(message, /\bundefined\b|\bnull\b|\bNaN\b|\[object /, `${label}: valor técnico`);
}

const CONTEXTS: ImportErrorContext[] = ["analyze", "apply", "undoPreview", "undo", "discard", "history"];

// Cada escenario nombrado en el pedido, con el texto crudo que produce la RPC / la validación (lo que NUNCA debe llegar a pantalla).
const RAW: Array<{ scenario: string; raw: string; context: ImportErrorContext }> = [
  { scenario: "sin copia en la nube", raw: "No encontramos ningún respaldo en la nube para tu cuenta.", context: "analyze" },
  { scenario: "copia demasiado grande", raw: "El backup supera el tamaño máximo permitido.", context: "analyze" },
  { scenario: "copia con demasiados datos", raw: "El backup tiene demasiados datos para importar de una vez.", context: "analyze" },
  { scenario: "formato inválido", raw: "El backup no tiene el formato esperado.", context: "analyze" },
  { scenario: "datos repetidos", raw: "El backup tiene datos repetidos.", context: "analyze" },
  { scenario: "error de análisis (desconocido)", raw: 'relation "public.import_previews" does not exist', context: "analyze" },
  { scenario: "error de análisis (red)", raw: "No se pudo conectar con el servidor. Revisá tu conexión.", context: "analyze" },
  { scenario: "error de análisis (sesión)", raw: "No hay una sesión autenticada.", context: "analyze" },
  { scenario: "error al importar (desconocido)", raw: "duplicate key value violates unique constraint payment_charges_pkey", context: "apply" },
  { scenario: "error al importar (invariante)", raw: "Invariante violada: payment_allocations excede el cobro", context: "apply" },
  { scenario: "error al importar (opciones)", raw: "Tabla students no admite overrides", context: "apply" },
  { scenario: "error al importar (revisión vencida)", raw: "El preview ya no es válido", context: "apply" },
  { scenario: "error al importar (red)", raw: "No se pudo conectar con el servidor. Revisá tu conexión.", context: "apply" },
  { scenario: "error al deshacer (desconocido)", raw: "undo_failed: row_id 3f2a not found in import_runs", context: "undo" },
  { scenario: "error al deshacer (bloqueado)", raw: "No se puede deshacer bloqueado: tiene dependencias creadas después", context: "undo" },
  { scenario: "error al deshacer (vencido)", raw: "El plazo para deshacer esta importación venció.", context: "undo" },
  { scenario: "error al deshacer (revisión)", raw: "El preview de undo ya no es válido", context: "undoPreview" },
  { scenario: "quitar la opción de deshacer", raw: "internal_error en discard_import_undo", context: "discard" },
  { scenario: "historial", raw: "PGRST301 JWT expired", context: "history" },
];

test("sin copia en la nube, copia demasiado grande, análisis, importación y deshacer: la frase explica qué pasó y qué hacer, sin ningún código", () => {
  for (const { scenario, raw, context } of RAW) {
    const t = translateImportError(raw, context);
    assertClean(t.message, scenario);
    assert.ok(t.message.length > 30, `${scenario}: explicación clara`);
  }
  const noCloud = translateImportError(RAW[0].raw, "analyze").message;
  assert.match(noCloud, /Abrí la app móvil/, "dice qué puede hacer la persona");
  const tooBig = translateImportError(RAW[1].raw, "analyze").message;
  assert.match(tooBig, /demasiado grande/);
  assert.match(tooBig, /No se cambió nada/);
});

test("todo contexto y toda clasificación posible produce una frase limpia; los casos sin recuperación directa dicen «Contactanos si vuelve a pasar»", () => {
  for (const context of CONTEXTS) {
    assertClean(translateImportTimeout(context).message, "timeout " + context);
    assertClean(translateImportError("algo que no se reconoce 0xDEADBEEF", context).message, "genérico " + context);
    assert.match(translateImportError("algo que no se reconoce", context).message, /Contactanos si vuelve a pasar\./, "genérico " + context);
    assert.match(translateImportTimeout(context).message, /Contactanos si vuelve a pasar\./, "timeout " + context);
  }
  for (const c of ["too_large", "too_many_rows", "too_many_rows_total", "too_many_nested_rows", "too_much_work", "string_too_long", "unknown_schema_version", "otro_codigo_desconocido"]) {
    assertClean(translateValidationErrors([{ code: c }]).message, "validación " + c);
  }
  assertClean(translateValidationErrors([{ code: "too_large" }, { code: "string_too_long" }, { code: "x" }]).message, "validación múltiple");
  for (const raw of [
    "Invariante violada: x",
    "Tabla students no admite overrides",
    "Campo foo no está clasificada",
    "El backup tiene datos repetidos.",
    "El backup no tiene el formato esperado.",
  ]) {
    assert.match(translateImportError(raw, "apply").message, /[Cc]ontactanos/, raw);
  }
  // Con recuperación directa (red, sesión, vencimientos) no se manda a soporte: se dice qué hacer.
  assert.match(translateImportError("No se pudo conectar con el servidor.", "analyze").message, /volvé a intentar/);
  assert.match(translateImportError("No hay una sesión autenticada.", "analyze").message, /Volvé a iniciar sesión/);
});

test("sesión remota y eliminación de cuenta: los mensajes de la cuenta tampoco traen códigos ni términos técnicos", () => {
  for (const [name, message] of Object.entries(DELETE_ACCOUNT_MESSAGES)) assertClean(message, "eliminar cuenta · " + name);
  for (const raw of [
    { code: "P0001", message: "La sesión remota no existe" },
    { code: "42501", message: "permission denied for table active_sessions" },
    { code: "23503", message: 'update or delete on table "students" violates foreign key constraint "payments_student_id_fkey"' },
    { code: "PGRST301", message: "JWT expired" },
    new Error("ECONNREFUSED 127.0.0.1:5432"),
    { code: "P0001", message: "La serie 3f2a1c9e-1111-4222-8333-444455556666 es primaria" },
  ]) {
    assertClean(domainErrorMessage(raw), "cuenta · " + JSON.stringify(raw).slice(0, 50));
  }
});

test("ninguna interfaz de Configuración, Respaldo e Importación dibuja un código: ni «Código para soporte», ni error.code, ni slugs en el JSX", () => {
  const files = [...sources("components/backup"), ...sources("components/account"), ...sources("app/(app)/configuracion")];
  assert.ok(files.length >= 12);
  for (const file of files) {
    const source = code(file);
    assert.doesNotMatch(source, SUPPORT_CODE, `${file}: texto de «código»`);
    assert.doesNotMatch(source, /Código para soporte/i, file);
    assert.doesNotMatch(source, /\berror\.code\b|\bresult\.errorCode\b|\berrorCode\b|\btranslated\.code\b|\bt\.code\b/, `${file}: lee un código de error`);
    if (!file.endsWith("import-wizard.tsx")) assert.doesNotMatch(source, /font-mono/, `${file}: sin tipografía de código`);
    else assert.equal((source.match(/font-mono/g) ?? []).length, 1, "la única tipografía de código es la palabra de confirmación");
    // Texto JSX y atributos visibles/accesibles: nunca un slug ni una palabra de base de datos.
    const visible = [
      ...[...source.matchAll(/>([^<>{}=;]+)</g)].map((m) => m[1]),
      ...[...source.matchAll(/(?:aria-label|title|placeholder|alt|message|label)=\"([^\"]*)\"/g)].map((m) => m[1]),
    ].map((t) => t.trim()).filter((t) => t.length > 0);
    for (const text of visible) {
      assert.doesNotMatch(text, SLUG, `${file}: slug visible → ${text}`);
      assert.doesNotMatch(text, DB_WORDS, `${file}: término de base de datos visible → ${text}`);
    }
  }
  const ui = code("components/backup/import-ui.tsx");
  assert.match(ui, /export function ImportErrorBox\(\{ message, onRetry, boxRef \}/, "la caja de error recibe sólo el mensaje (y, si corresponde, el reintento)");
  assert.match(ui, /Reintentar/);
});

test("«Reintentar» aparece donde hay un reintento directo: análisis inicial y carga del historial", () => {
  const wizard = code("components/backup/import-wizard.tsx");
  assert.match(wizard, /<ImportErrorBox message=\{error\} onRetry=\{onAnalyze\} boxRef=\{errorRef\} \/>/);
  const history = code("components/backup/import-history.tsx");
  assert.match(history, /<ImportErrorBox message=\{error\} onRetry=\{onChanged\} \/>/);
});

test("el servidor no manda ningún código al navegador: el mensaje va traducido y la clasificación interna sólo se registra en el log seguro", () => {
  const actions = code("lib/actions/backup.ts");
  assert.doesNotMatch(actions, /errorCode/, "el resultado de las acciones no lleva código");
  assert.match(actions, /translated\?: true;/);
  assert.match(actions, /return \{ error: translated\.message, translated: true \};/);
  assert.match(actions, /console\.error\(`\[action-error\] \$\{JSON\.stringify\(\{ scope: "backup", kind: "import", context, code: translated\.code \}\)\}`\);/);
  // El log sólo lleva alcance, tipo, paso y la clasificación: nunca el mensaje, ni correos, ni tokens, ni la carga.
  assert.doesNotMatch(actions, /console\.(error|warn|log)\([^)]*(email|token|payload|message)/i);
  // Todas las respuestas de error pasan por `reply`/`failure` (ninguna arma el objeto a mano).
  assert.doesNotMatch(actions, /return \{ error: translated\.message(?!, translated: true)/);
  assert.equal((actions.match(/return failure\(error, "/g) ?? []).length, 7);
  // La clasificación interna sigue existiendo (no se cambió) y el navegador sólo traduce lo que nunca salió del servidor.
  assert.match(code("lib/backup/import-copy.ts"), /export interface TranslatedImportError \{[\s\S]*?code: string;/);
  for (const file of ["components/backup/import-wizard.tsx", "components/backup/import-history.tsx"]) {
    assert.match(code(file), /result\.translated && result\.error \? result\.error : translateImportError\(/, file);
  }
});
