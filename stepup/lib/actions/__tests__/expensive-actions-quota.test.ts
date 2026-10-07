import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../../db/__tests__/support/register-alias.mjs";
import { FakePostgrest } from "../../db/__tests__/support/fake-postgrest.ts";

// R3 — Las acciones costosas de la web piden su unidad de cuota ANTES del trabajo costoso, y el repositorio llama a la RPC correcta.

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const { consumeActionQuota } = await import("../../repositories/action-quota.ts");

function ctxOf(fake: FakePostgrest) {
  return { supabase: fake as never, ownerId: "o" } as never;
}

test("consumeActionQuota llama a la RPC consume_action_quota con la acción (y nunca con un propietario ni un límite)", async () => {
  const seen: Record<string, unknown>[] = [];
  const fake = new FakePostgrest({ rpcs: { consume_action_quota: (args) => { seen.push(args); return { ok: true }; } } });
  await consumeActionQuota(ctxOf(fake), "report_pdf");
  assert.deepEqual(seen, [{ p_action: "report_pdf" }]);
});

test("si la RPC rechaza (cuota agotada) o falla, la acción se corta: el error se propaga (falla cerrado)", async () => {
  const quota = { code: "53400", message: "quota_rate_exceeded", details: "report_pdf" };
  // PostgREST devuelve el error en `{ error }` (no lanza): el repositorio debe convertirlo en excepción.
  const fake = new FakePostgrest({ rpcs: { consume_action_quota: () => ({}) }, failCall: () => quota });
  await assert.rejects(() => consumeActionQuota(ctxOf(fake), "report_pdf"), (error) => error === quota);
  const other = new FakePostgrest({ rpcs: { consume_action_quota: () => ({}) }, failCall: () => ({ code: "XX000", message: "caída" }) });
  await assert.rejects(() => consumeActionQuota(ctxOf(other), "report_pdf"), (error) => (error as { code: string }).code === "XX000", "cualquier otro fallo también corta (falla cerrado)");
});

const order = (source: string, first: string, second: string) => {
  const a = source.indexOf(first);
  const b = source.indexOf(second);
  return a !== -1 && b !== -1 && a < b;
};

test("reportes: la vista previa, el PDF al generar y la regeneración piden cuota ANTES de trabajar", () => {
  const source = read("lib/actions/reports.ts");
  assert.ok(order(source, 'consumeActionQuota(ctx, "report_preview")', "listCompletedRegistrationsForStudentReport(ctx, input.studentId)"), "vista previa");
  const generate = source.slice(source.indexOf("export async function generateStudentReportAction"), source.indexOf("export async function startNewReportDraftAction"));
  assert.ok(order(generate, 'consumeActionQuota(ctx, "report_pdf")', "await renderReportPdf("), "generar");
  const regenerate = source.slice(source.indexOf("export async function regenerateReportPdfAction"), source.indexOf("export async function deleteReportAction"));
  assert.ok(order(regenerate, 'consumeActionQuota(ctx, "report_pdf")', "await renderReportPdf("), "regenerar");
  // El conteo de PDF sólo se pide cuando de verdad se va a renderizar (un reporte reutilizado no consume).
  assert.match(generate, /if \(!outcome\.staleClaim && !record\.pdfPath\) \{[\s\S]*consumeActionQuota\(ctx, "report_pdf"\)/);
});

test("respaldo de la nube: el análisis pide cuota ANTES de descargar y analizar el respaldo", () => {
  const source = read("lib/actions/backup.ts");
  const analyze = source.slice(source.indexOf("export async function analyzeLatestCloudBackupAction"), source.indexOf("export async function applyImportPreviewAction"));
  assert.ok(order(analyze, 'consumeActionQuota(ctx, "cloud_backup_analyze")', "fetchOwnLatestCloudBackup(ctx)"));
});

test("cambio de contraseña desde Configuración: pide cuota ANTES de pedir el correo y un rechazo no envía nada", () => {
  const source = read("lib/actions/account.ts");
  const action = source.slice(source.indexOf("export async function requestOwnPasswordChangeAction"), source.indexOf("// Eliminación de cuenta"));
  assert.ok(order(action, 'consumeActionQuota(ctx, "password_change_email")', "requestPasswordReset(user.email, "));
  assert.match(action, /catch \(error\) \{\s*return \{ error: actionErrorMessage\("account", error\) \};/);
});

test("las acciones del tipo ExpensiveAction coinciden exactamente con las acciones por defecto de la base", () => {
  // Las acciones nacen en R3 y R4 agrega `account_reauth` (su propia migración, antes de desplegar la web que la usa).
  const sql = read("supabase/migrations/20261007100000_r3_quota_infrastructure.sql") + read("supabase/migrations/20261008110000_r4_reauth_quota.sql");
  const dbActions = [...sql.matchAll(/^  \('([a-z_]+)', \d+, \d+, '/gm)].map((m) => m[1]).sort();
  const type = read("lib/repositories/action-quota.ts").match(/export type ExpensiveAction = ([^;]+);/)![1];
  const tsActions = [...type.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(tsActions, dbActions);
  // y cada acción se usa realmente en alguna Server Action
  const usage = ["lib/actions/reports.ts", "lib/actions/backup.ts", "lib/actions/account.ts"].map(read).join("\n");
  for (const action of tsActions) assert.ok(usage.includes(`consumeActionQuota(ctx, "${action}")`), `${action} no se usa`);
});

test("el repositorio de cuota no acepta propietario ni límites del cliente (sólo envía la acción)", () => {
  const source = read("lib/repositories/action-quota.ts");
  assert.match(source, /export async function consumeActionQuota\(ctx: AuthenticatedDbContext, action: ExpensiveAction\)/);
  assert.match(source, /rpc\("consume_action_quota", \{ p_action: action \}\)/);
  assert.doesNotMatch(source.slice(source.indexOf("export async function")), /p_owner|p_limit|p_max|p_window/);
});
