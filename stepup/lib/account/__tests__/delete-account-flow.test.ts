import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DELETE_ACCOUNT_MESSAGES, runDeleteAccount, type DeleteAccountDeps } from "../delete-account-flow.ts";
import { ReportPdfCleanupIncompleteError } from "../../repositories/report-pdf-storage.ts";
import type { PasswordCheck } from "../../auth/reauth.ts";

// R4 — Eliminar la cuenta es una acción crítica: reautenticación (contraseña) verificada en el servidor, límite por hora, y los PDF se
// borran de Storage (y se comprueba que no quede ninguno) ANTES de eliminar la cuenta. Estas pruebas fijan el ORDEN y que cualquier fallo
// deja la cuenta intacta.

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function setup(overrides: Partial<DeleteAccountDeps> = {}, check: PasswordCheck = { ok: true }) {
  const calls: string[] = [];
  const deps: DeleteAccountDeps = {
    getEmail: async () => { calls.push("email"); return "profe@ejemplo.test"; },
    consumeReauthQuota: async () => { calls.push("quota"); },
    verifyPassword: async (email, password, captcha) => { calls.push(`verify:${email}:${password}:${captcha ?? "-"}`); return check; },
    removePdfs: async () => { calls.push("pdfs"); },
    deleteAccount: async () => { calls.push("delete"); },
    errorMessage: (error) => `ERR:${(error as Error)?.message ?? "?"}`,
    ...overrides,
  };
  return { calls, deps };
}
const GOOD = { password: "mi-clave-123", confirmation: "ELIMINAR" };

test("camino feliz: cuota → contraseña → PDF → cuenta, en ese orden exacto", async () => {
  const { calls, deps } = setup();
  assert.deepEqual(await runDeleteAccount({ ...GOOD, captchaToken: "tok-1" }, deps), { ok: true });
  assert.deepEqual(calls, ["email", "quota", "verify:profe@ejemplo.test:mi-clave-123:tok-1", "pdfs", "delete"]);
});

test("sin la palabra de confirmación (validada en el SERVIDOR) no pasa nada: ni cuota, ni contraseña, ni borrado", async () => {
  for (const confirmation of ["", "eliminar", "ELIMINAR ahora", "ELIMINA", undefined, null, 42, {}]) {
    const { calls, deps } = setup();
    assert.deepEqual(await runDeleteAccount({ password: "x", confirmation }, deps), { ok: false, error: DELETE_ACCOUNT_MESSAGES.confirmation }, String(confirmation));
    assert.deepEqual(calls, []);
  }
  const { deps } = setup();
  assert.equal((await runDeleteAccount({ password: "x", confirmation: "  ELIMINAR  " }, deps)).ok, true, "los espacios alrededor se toleran (igual que el navegador)");
});

test("sin contraseña (vacía, ausente, de otro tipo o enorme) no se llega a ningún paso", async () => {
  for (const password of ["", undefined, null, 123, {}, "x".repeat(1025)]) {
    const { calls, deps } = setup();
    assert.deepEqual(await runDeleteAccount({ password, confirmation: "ELIMINAR" }, deps), { ok: false, error: DELETE_ACCOUNT_MESSAGES.passwordRequired });
    assert.deepEqual(calls, []);
  }
});

test("contraseña incorrecta: no se borran PDF ni cuenta, y el mensaje no revela nada más", async () => {
  const { calls, deps } = setup({}, { ok: false, reason: "wrong_password" });
  assert.deepEqual(await runDeleteAccount(GOOD, deps), { ok: false, error: DELETE_ACCOUNT_MESSAGES.wrongPassword });
  assert.ok(!calls.includes("pdfs") && !calls.includes("delete"));
});

test("CAPTCHA fallido, límite de Auth o Auth caído: no se borra nada y cada caso tiene su texto", async () => {
  for (const [reason, pattern] of [["captcha_failed", /persona/], ["rate_limited", /demasiados intentos/], ["unavailable", /Tu cuenta no se eliminó/]] as const) {
    const { calls, deps } = setup({}, { ok: false, reason });
    const outcome = await runDeleteAccount(GOOD, deps);
    assert.equal(outcome.ok, false);
    assert.match((outcome as { error: string }).error, pattern, reason);
    assert.ok(!calls.includes("pdfs") && !calls.includes("delete"), reason);
  }
});

test("cuota por hora agotada: se corta ANTES de verificar la contraseña (no hay forma de probar contraseñas sin fin)", async () => {
  const { calls, deps } = setup({ consumeReauthQuota: async () => { calls.push("quota"); throw new Error("quota_rate_exceeded"); } });
  const outcome = await runDeleteAccount(GOOD, deps);
  assert.deepEqual(outcome, { ok: false, error: "ERR:quota_rate_exceeded" });
  assert.deepEqual(calls, ["email", "quota"], "ni se verificó la contraseña");
});

test("sin correo en la sesión: se corta antes de consumir cuota", async () => {
  const { calls, deps } = setup({ getEmail: async () => null });
  assert.deepEqual(await runDeleteAccount(GOOD, deps), { ok: false, error: DELETE_ACCOUNT_MESSAGES.noEmail });
  assert.deepEqual(calls, []);
});

test("si quedan PDF sin borrar (o Storage falla), la CUENTA NO se elimina y el mensaje lo dice", async () => {
  for (const reason of ["storage_error", "time_budget", "files_remaining", "unexpected_layout"] as const) {
    const { calls, deps } = setup({ removePdfs: async () => { calls.push("pdfs"); throw new ReportPdfCleanupIncompleteError(reason); } });
    assert.deepEqual(await runDeleteAccount(GOOD, deps), { ok: false, error: DELETE_ACCOUNT_MESSAGES.pdfIncomplete }, reason);
    assert.ok(!calls.includes("delete"), `${reason}: nunca se elimina la cuenta con archivos pendientes`);
  }
});

test("un error inesperado al borrar los PDF también deja la cuenta intacta", async () => {
  const { calls, deps } = setup({ removePdfs: async () => { calls.push("pdfs"); throw new Error("caída de red"); } });
  assert.deepEqual(await runDeleteAccount(GOOD, deps), { ok: false, error: "ERR:caída de red" });
  assert.ok(!calls.includes("delete"));
});

test("si eliminar la cuenta falla (después de borrar los PDF), la persona ve un error y la cuenta sigue existiendo", async () => {
  const { calls, deps } = setup({ deleteAccount: async () => { calls.push("delete"); throw new Error("rpc caída"); } });
  assert.deepEqual(await runDeleteAccount(GOOD, deps), { ok: false, error: "ERR:rpc caída" });
  assert.deepEqual(calls.slice(-2), ["pdfs", "delete"]);
});

test("reintentar tras un fallo de PDF vuelve a pedir contraseña y cuota (no queda ningún permiso reutilizable)", async () => {
  let failOnce = true;
  const { calls, deps } = setup({ removePdfs: async () => { calls.push("pdfs"); if (failOnce) { failOnce = false; throw new ReportPdfCleanupIncompleteError("time_budget"); } } });
  assert.equal((await runDeleteAccount(GOOD, deps)).ok, false);
  assert.equal((await runDeleteAccount(GOOD, deps)).ok, true);
  assert.equal(calls.filter((c) => c === "quota").length, 2);
  assert.equal(calls.filter((c) => c.startsWith("verify:")).length, 2);
});

test("el token de CAPTCHA con forma inválida no se reenvía", async () => {
  const { calls, deps } = setup();
  await runDeleteAccount({ ...GOOD, captchaToken: "con espacios <script>" }, deps);
  assert.ok(calls.some((c) => c.endsWith(":-")));
});

test("la contraseña y el correo nunca aparecen en ningún mensaje de error", async () => {
  const outcomes = [
    await runDeleteAccount(GOOD, setup({}, { ok: false, reason: "wrong_password" }).deps),
    await runDeleteAccount(GOOD, setup({}, { ok: false, reason: "unavailable" }).deps),
    await runDeleteAccount(GOOD, setup({ removePdfs: async () => { throw new ReportPdfCleanupIncompleteError("storage_error"); } }).deps),
  ];
  for (const outcome of outcomes) assert.doesNotMatch(JSON.stringify(outcome), /mi-clave-123|profe@ejemplo/);
});

// ---- Cableado de la Server Action y de la pantalla (lo que no se ejecuta sin Next) ----

test("la Server Action exige reautenticación: usa la verificación real, la cuota 'account_reauth' y borra los PDF antes de la cuenta", () => {
  const source = read("lib/actions/account.ts");
  const action = source.slice(source.indexOf("export async function deleteOwnAccountAction"));
  assert.match(action, /runDeleteAccount\(/);
  assert.match(action, /consumeReauthQuota: \(\) => consumeActionQuota\(ctx, "account_reauth"\)/);
  assert.match(action, /verifyPassword: verifyOwnPassword/);
  assert.match(action, /removePdfs: \(\) => removeOwnReportPdfs\(ctx\)/);
  assert.match(action, /deleteAccount: \(\) => deleteOwnAccount\(ctx\)/);
  assert.equal((action.match(/signOut\(\)/g) ?? []).length, 1, "un único cierre de sesión");
  assert.match(action, /\n  \} catch \(error\) \{\n    return \{ error: friendlyErrorMessage\(error\) \};\n  \}\n\n  await createSupabaseAuthAdapter\(\)\.signOut\(\);\n  redirect\("\/login"\);\n\}\n$/, "primero borra (todo el bloque try) y sólo después, ya fuera de él, cierra sesión");
  assert.doesNotMatch(action, /console\./);
  assert.doesNotMatch(action, /password.*(log|console)/i);
});

test("la pantalla pide la contraseña (tipo password, autocompletado de contraseña actual) y manda palabra + contraseña + token al servidor", () => {
  const ui = read("components/account/delete-account-button.tsx");
  assert.match(ui, /type="password"/);
  assert.match(ui, /autoComplete="current-password"/);
  assert.match(ui, /canConfirm = confirmText\.trim\(\) === CONFIRM_WORD && password\.length > 0/);
  assert.match(ui, /deleteOwnAccountAction\(\{ password, confirmation: confirmText, captchaToken \}\)/);
  assert.match(ui, /<CaptchaWidget key=\{captchaAttempt\} onToken=\{setCaptchaToken\} \/>/);
  assert.match(ui, /setPassword\(""\);\s*setError\(result\.error\)/, "tras un intento fallido la contraseña no queda en pantalla");
});

test("la verificación real usa un cliente aparte (sin cookies ni persistencia) y descarta SÓLO su sesión (alcance local, nunca global)", () => {
  const source = read("lib/auth/reauth-supabase.ts");
  assert.match(source, /persistSession: false/);
  assert.match(source, /autoRefreshToken: false/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(source, /scope: "global"|scope: "others"/);
  assert.doesNotMatch(source, /cookies\(|createSupabaseServerClient/);
});

test("el borrado de PDF de la cuenta usa el prefijo del propietario real de la sesión, nunca un valor del cliente", () => {
  const repo = read("lib/repositories/account-deletion.ts");
  assert.match(repo, /removeAllReportPdfsOf\(ctx\.supabase\.storage\.from\(REPORT_PDF_BUCKET\) as never, ctx\.ownerId\)/);
  assert.match(read("lib/repositories/reports.ts"), /const BUCKET = REPORT_PDF_BUCKET;/, "una sola constante del bucket");
});

test("la página de Configuración declara un tiempo máximo suficiente para borrar muchos PDF", () => {
  assert.match(read("app/(app)/configuracion/page.tsx"), /export const maxDuration = 60;/);
});
