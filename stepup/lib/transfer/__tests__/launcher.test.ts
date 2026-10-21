import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeSupabase } from "./fake-supabase.ts";
import { buildMobileBackup } from "../../backup/__fixtures__/mobile-real-shape.ts";
import { TABLES_ADDED_BY_TRANSFER_MIGRATIONS } from "../export-destination.ts";

/** El iniciador de Windows (formulario con contraseña oculta + circuito) probado con datos ficticios contra un Supabase de mentira. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TOOLS = join(ROOT, "tools", "transfer");
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "lib", "backup", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as Record<string, Record<string, unknown>[]>;
const EMAIL = "usuario.ficticio@example.invalid";
const PASSWORD = "Clave-Ficticia-123!";
const win = process.platform === "win32";

test("el iniciador está bien formado: BOM para los acentos, sin credenciales en argumentos, por la entrada estándar y sin hacer nada destructivo", () => {
  const ps1 = readFileSync(join(TOOLS, "Iniciar-traslado.ps1"));
  assert.deepEqual([...ps1.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 con BOM: PowerShell 5.1 lee bien los acentos");
  const text = ps1.toString("utf8");
  assert.match(text, /UseSystemPasswordChar = \$true/, "la contraseña arranca oculta");
  assert.match(text, /Mostrar contraseña/);
  assert.match(text, /StandardInput\.BaseStream\.Write/, "las credenciales entran por la entrada estándar");
  assert.doesNotMatch(text, /\$psi\.Arguments[^\n]*(\$Password|\$Email)|EnvironmentVariables\[[^\]]*(PASSWORD|EMAIL)/i);
  assert.doesNotMatch(text, /Remove-Item|Set-Content|Out-File|Add-Content|Reset-|Invoke-WebRequest|Invoke-RestMethod|Stop-Process/);
  const cmd = readFileSync(join(TOOLS, "Iniciar-traslado.cmd"), "utf8");
  assert.match(cmd, /-File "%~dp0Iniciar-traslado\.ps1"/);
  assert.equal(/[^\x00-\x7f]/.test(cmd), false, "el .cmd es ASCII puro");
});

test("modo traslado: el mismo formulario lanza el orquestador con las credenciales por la entrada estándar, una sola vez, y el .cmd es ASCII", () => {
  const ps1 = readFileSync(join(TOOLS, "Iniciar-traslado.ps1"), "utf8");
  assert.match(ps1, /\[ValidateSet\('ensayo', 'traslado'\)\] \[string\]\$Modo = 'ensayo'/, "el modo por defecto sigue siendo el ensayo");
  assert.match(ps1, /execute-transfer\.mjs/);
  assert.match(ps1, /Traslado a la web \(una sola vez\)/);
  assert.doesNotMatch(ps1, /\$psi\.Arguments[^\n]*(\$Password|\$Email)/, "las credenciales nunca viajan por argumentos");
  const cmd = readFileSync(join(TOOLS, "Ejecutar-traslado.cmd"), "utf8");
  assert.match(cmd, /-File "%~dp0Iniciar-traslado\.ps1" -Modo traslado %\*/);
  assert.equal(/[^\x00-\x7f]/.test(cmd), false, "el .cmd es ASCII puro");
  const cli = readFileSync(join(TOOLS, "execute-transfer.mjs"), "utf8");
  assert.equal([...cli.matchAll(/readCredentials\(\)/g)].length, 2, "se leen las credenciales UNA vez (definición + una llamada)");
  assert.doesNotMatch(cli, /process\.env\.[A-Z_]*(PASSWORD|EMAIL)|argv[^\n]*password/i, "ni variables de entorno ni argumentos con credenciales");
  assert.doesNotMatch(cli, /freeze_legacy_source|reopen_legacy_source|\.delete\(|\.remove\(|truncate|drop table/i, "no congela ni borra");
});

test("circuito por el formulario (sin ensayo): contraseña oculta/visible, rechazo claro y reintento, copias DPAPI y resultado breve", { skip: !win, timeout: 240_000 }, async () => {
  const server = await startFakeSupabase({ email: EMAIL, password: PASSWORD, backupPayload: buildMobileBackup(), tables: GOLDEN, missingTables: [...TABLES_ADDED_BY_TRANSFER_MIGRATIONS] });
  const dir = mkdtempSync(join(tmpdir(), "tf-launcher-"));
  try {
    const envFile = join(dir, "fake.env");
    writeFileSync(envFile, `NEXT_PUBLIC_SUPABASE_URL=${server.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=clave-publica-ficticia\n`);
    const out = join(dir, "privada");
    const output = await new Promise<{ code: number | null; text: string }>((resolve) => {
      // Igual que Iniciar-traslado.cmd: consola en UTF-8 (chcp 65001), que con un escritor .NET agregaba un BOM al cerrar la entrada y rompía las credenciales.
      const child = spawn("cmd.exe", ["/d", "/c", `chcp 65001>nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "${join(TOOLS, "test", "launcher-form.test.ps1")}"`], {
        windowsVerbatimArguments: true,
        env: { ...process.env, TF_ENV_FILE: envFile, TF_TEST_OUT: out, TF_TEST_EMAIL: EMAIL, TF_TEST_PASSWORD: PASSWORD, TF_TEST_FULL: process.env.TF_TEST_FULL ?? "" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("close", (code) => resolve({ code, text }));
    });
    if (process.env.TF_TEST_VERBOSE) console.log(output.text);
    const failed = output.text.split(/\r?\n/).filter((l) => l.startsWith("FAIL"));
    assert.deepEqual(failed, [], output.text);
    assert.equal(output.code, 0, output.text);
    assert.match(output.text, /RESULTADO: todo bien/);
    assert.equal(output.text.includes(PASSWORD), false, "la contraseña nunca sale por ninguna salida");
    assert.equal(output.text.includes(EMAIL), false);
    assert.equal(existsSync(out), true);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
