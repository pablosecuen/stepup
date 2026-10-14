import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** Rediseño visual v1 — Bloque 6: Configuración, Respaldo e Importación (docs/design/web-v1/11-bloque-6.md). Sólo presentación. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(entry)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

const FILES = [...sources("components/account"), ...sources("components/backup"), ...sources("app/(app)/configuracion")];
const BUDGET = "components/account/budget-distribution-form.tsx";

test("Configuración y Respaldo ya no usan el azul heredado ni el semáforo de cobro; los colores del plan 50/30/20 quedan sólo en su formulario", () => {
  assert.ok(FILES.length >= 12);
  for (const file of FILES) {
    const source = code(file);
    assert.doesNotMatch(source, /brandBlue|statusVerde|statusRojo|statusAmarillo|statusNaranja|statusPendiente|statusSinDatos/, file);
    assert.doesNotMatch(source, /\b(bg|text|border|ring|accent)-(amber|red|blue|green|yellow|orange)-\d{2,3}\b/, `${file}: sin colores crudos de Tailwind`);
    if (file !== BUDGET) assert.doesNotMatch(source, /pastelLavender|pastelSage|dataNeeds/, `${file}: los colores del plan 50/30/20 son sólo del formulario de la distribución`);
  }
  const budget = code(BUDGET);
  assert.match(budget, /bg-dataNeeds/);
  assert.match(budget, /bg-pastelLavenderText/);
  assert.match(budget, /bg-pastelSageText/);
});

test("el azul heredado de interfaz se retiró: el token no existe y ninguna pantalla lo usa", () => {
  const tailwind = read("tailwind.config.ts");
  assert.doesNotMatch(tailwind, /brandBlue/);
  assert.match(tailwind, /dataNeeds: "#0A64D2"/, "el azul con significado de dato (Necesidades) se conserva");
  for (const file of [...sources("app"), ...sources("components")]) assert.doesNotMatch(code(file), /brandBlue/, file);
});

test("Las páginas sólo resuelven los datos como antes y delegan el dibujo; Respaldo conserva el asistente y el historial", () => {
  const page = code("app/(app)/configuracion/page.tsx");
  for (const loader of ["getTeacherProfile(ctx)", "getBudgetDistributionSettings(ctx)", "getActiveSession(ctx)"]) assert.ok(page.includes(loader), loader);
  assert.match(page, /return <ConfigurationView email=\{email\} displayName=\{profile\.displayName\} budget=\{budget\} session=\{session\} billingEnabled=\{readBillingFlags\(process\.env\)\.enabled\} \/>;/);
  assert.match(page, /<PageHeader title="Configuración"/);
  assert.match(page, /export const maxDuration = 60;/);
  const view = code("components/account/configuration-view.tsx");
  assert.doesNotMatch(view, /lib\/repositories|supabase|requireAuthenticatedDbContext|"use server"/);
  const backup = code("app/(app)/configuracion/respaldo/page.tsx");
  assert.match(backup, /<BackupImportWizard \/>/);
  assert.match(backup, /<ImportHistory \/>/);
  assert.match(backup, /export const maxDuration = 60;/);
  assert.match(backup, /<PageHeader\s+title="Respaldo"/);
});

test("Las acciones sensibles piden confirmación en un diálogo del sistema (hoja inferior en móvil) con las mismas reglas de siempre", () => {
  const del = code("components/account/delete-account-button.tsx");
  assert.match(del, /<Dialog\s+title="Eliminar cuenta"/);
  assert.match(del, /const canConfirm = confirmText\.trim\(\) === CONFIRM_WORD && password\.length > 0;/);
  assert.match(del, /deleteOwnAccountAction\(\{ password, confirmation: confirmText, captchaToken \}\)/);
  assert.match(del, /setPassword\(""\);/, "la contraseña no queda en pantalla tras un intento fallido");
  const session = code("components/account/active-session-card.tsx");
  assert.match(session, /<Dialog\s+title="Cerrar la sesión remota"/);
  assert.match(session, /endActiveSessionAction\(session\.deviceId, session\.generation\)/);
  const ui = code("components/backup/import-ui.tsx");
  assert.match(ui, /<Dialog\s+title="Quitar la opción de deshacer"/);
  assert.match(ui, /<Dialog\s+title=\{undoState\.isSafe/);
  // Ningún diálogo ejecuta nada al abrirse: sólo el botón de confirmar llama a la acción.
  assert.doesNotMatch(ui, /useEffect\(/, "sin efectos que actúen solos");
});

test("El asistente de importación conserva su estado, sus manejadores y sus límites; sólo cambia su presentación", () => {
  const wizard = code("components/backup/import-wizard.tsx");
  for (const call of [
    "analyzeLatestCloudBackupAction()",
    "applyImportPreviewAction(preview.previewId, fieldOverrides, duplicates)",
    "previewUndoImportAction(applyResult.importRunId)",
    "applyUndoImportAction(undoState.undoPreviewId)",
    "discardImportUndoAction(applyResult.importRunId)",
  ]) {
    assert.ok(wizard.includes(call), call);
  }
  assert.match(wizard, /type Stage = "idle" \| "analyzing" \| "preview" \| "applying" \| "result";/);
  assert.match(wizard, /const phraseOk = !summary\.requiresStrongConfirmation \|\| strongConfirmInput\.trim\(\)\.toUpperCase\(\) === STRONG_CONFIRMATION_PHRASE;/);
  assert.match(wizard, /duplicateDecisions\[d\.backupLegacyMobileId\] \?\? "skip"/, "la opción segura sigue siendo la de por defecto");
  // «Antes de confirmar» queda después del contenido en el DOM (orden de tabulación) y sólo se fija a un costado en escritorio.
  const previewSource = wizard.slice(wizard.indexOf("export function PreviewStage"), wizard.indexOf("export interface ResultStageProps"));
  assert.ok(previewSource.indexOf('id="afuera"') < previewSource.indexOf('aria-labelledby="confirmar-titulo"'));
  assert.match(previewSource, /nav:sticky nav:top-6/);
  assert.match(previewSource, /nav:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  const history = code("components/backup/import-history.tsx");
  assert.match(history, /guardNetwork\(\(\) => listImportRunsAction\(\)\)/);
  assert.match(history, /export function ImportHistoryList\(/);
  assert.match(history, /computeUndoAvailability\(run, new Date\(\)\)/);
});

test("Guarda contra formateadores paralelos: fechas y cifras de Configuración y Respaldo salen de los formateadores únicos o llegan ya formateadas", () => {
  for (const file of FILES) {
    const source = code(file);
    assert.doesNotMatch(source, /Intl\.|toLocale(Date|Time)?String|\.toFixed\(|toISOString\(\)\.slice/, `${file}: sólo los formateadores únicos de lib/format`);
    if (!file.endsWith("import-history.tsx")) assert.doesNotMatch(source, /new Date\(/, `${file}: sin fechas armadas a mano`);
  }
  assert.match(code("components/backup/import-history.tsx"), /formatInstantDateTime\(run\.createdAt\)/);
  assert.match(code("app/(app)/configuracion/page.tsx"), /formatInstantDateTime\(row\.authorized_at\)/);
});

test("Nada de lo que no existe: sin «Crear respaldo» en la web ni un historial nuevo de cuenta", () => {
  for (const file of FILES) {
    const source = code(file);
    assert.doesNotMatch(source, /Crear respaldo|Descargar respaldo|Exportar datos/i, file);
  }
});
