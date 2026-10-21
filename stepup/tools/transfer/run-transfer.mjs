// Circuito completo del ensayo del traslado, en una sola ejecución: valida la conexión y la sesión, exporta ORIGEN y DESTINO, los cifra con Windows DPAPI (sin frase),
// comprueba la recuperación DESDE EL DISCO y corre el ensayo aislado en un Postgres local descartable. Lo lanza `Iniciar-traslado.cmd` (formulario con contraseña oculta).
//
//   <JSON {"email","password"} por la ENTRADA ESTÁNDAR> | node tools/transfer/run-transfer.mjs <carpeta-privada> [--sin-ensayo]
//
// Las credenciales llegan SÓLO por la entrada estándar (nunca por argumentos ni variables), viven únicamente en memoria y se sueltan apenas se inicia sesión. Sólo LEE de la
// cuenta (sus propias reglas de acceso); nunca restablece la contraseña ni cierra otras sesiones (al terminar cierra SÓLO la suya, alcance local). No migra ni importa nada
// en Production. Conserva todas las copias anteriores: cada copia nueva tiene nombre con fecha y hora y jamás pisa un archivo.
//
// Protocolo de líneas con el iniciador:  @@AUTH_FAIL|tipo|mensaje  ·  @@AUTH_OK  ·  @@SUMMARY|línea
// Códigos de salida: 0 todo bien · 10 falló la conexión o el inicio de sesión · 20 copias a salvo pero el ensayo no terminó o halló diferencias · 1 otro error.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { safeOutputPath, SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";
import { encryptDpapi, verifyDpapi } from "../../lib/secure-copy/dpapi-copy.ts";
import { DESTINATION_TABLES } from "../../lib/backup/transfer-compare.ts";
import { exportDestination, ExportAbortError } from "../../lib/transfer/export-destination.ts";
import { describeBackupAge } from "../../lib/transfer/backup-age.ts";
import { checkAuthReachable, classifyAuthFailure } from "../../lib/transfer/auth-errors.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const REHEARSAL = join(ROOT, "supabase", "tests", "postgres", "real_rehearsal.cjs");
const [outArg, ...flags] = process.argv.slice(2);
const skipRehearsal = flags.includes("--sin-ensayo");
if (!outArg) {
  console.error("Uso: run-transfer.mjs <carpeta-privada> [--sin-ensayo]  (las credenciales llegan por la entrada estándar)");
  process.exit(2);
}

const say = (text) => console.log(text);
const summary = [];
const addSummary = (line) => {
  summary.push(line);
  console.log(`@@SUMMARY|${line}`);
};
// Sin process.exit (en Windows cortar con conexiones abiertas puede abortar el proceso): se lanza y se resuelve al final.
class AuthAbort extends Error {
  constructor(failure) {
    super(failure.message);
    this.failure = failure;
  }
}
const failAuth = (failure) => {
  throw new AuthAbort(failure);
};

async function readCredentials() {
  if (process.stdin.isTTY) throw new SecureCopyError("unsafe_path", "Este comando lo lanza el iniciador (Iniciar-traslado.cmd): las credenciales llegan por la entrada estándar, no se escriben acá.");
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 16_384) throw new SecureCopyError("bad_format", "Las credenciales recibidas son demasiado largas.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/\uFEFF/g, "").trim()); // tolera una marca BOM al principio o al final
  } catch {
    throw new SecureCopyError("bad_format", "No se recibieron las credenciales en el formato esperado.");
  }
  if (typeof parsed?.email !== "string" || typeof parsed?.password !== "string" || !parsed.email.trim() || !parsed.password) {
    throw new SecureCopyError("bad_format", "Falta el correo o la contraseña.");
  }
  return { email: parsed.email.trim(), password: parsed.password };
}

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Cifra con DPAPI, escribe el archivo parcial, comprueba la recuperación sobre lo escrito en disco, lo mueve a su nombre final y lo vuelve a comprobar. */
function saveCopy(document, out) {
  const plain = Buffer.from(JSON.stringify(document), "utf8");
  const { file, plaintextSha256, plaintextBytes } = encryptDpapi(plain);
  const partial = `${out}.parcial`;
  writeFileSync(partial, file, { mode: 0o600, flag: "wx" });
  verifyDpapi(readFileSync(partial), plaintextSha256);
  renameSync(partial, out);
  verifyDpapi(readFileSync(out), plaintextSha256);
  return { bytes: file.length, plaintextBytes, sha: plaintextSha256 };
}

function ensureRehearsalDeps() {
  const dir = process.env.TF_EPG_DIR || join(tmpdir(), "epg");
  const modules = join(dir, "node_modules");
  if (existsSync(join(modules, "embedded-postgres")) && existsSync(join(modules, "pg"))) return modules;
  say("Preparando el Postgres local del ensayo (una sola vez: se descarga fuera del proyecto)…");
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("npm.cmd", ["install", "embedded-postgres", "pg", "--no-audit", "--no-fund"], { cwd: dir, shell: true, encoding: "utf8", windowsHide: true, timeout: 600_000 });
  if (r.status !== 0 || !existsSync(join(modules, "embedded-postgres"))) throw new SecureCopyError("unsafe_path", "No se pudo preparar el Postgres local del ensayo (embedded-postgres). Las copias ya están a salvo.");
  return modules;
}

function runRehearsal(originPath, reportPath) {
  return new Promise((resolve) => {
    let modules;
    try {
      modules = ensureRehearsalDeps();
    } catch (error) {
      return resolve({ ok: false, reason: error instanceof SecureCopyError ? error.message : "No se pudo preparar el ensayo." });
    }
    const child = spawn(process.execPath, [REHEARSAL, originPath], { env: { ...process.env, NODE_PATH: modules }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const lines = [];
    let result = null;
    let buffer = "";
    const milestone = /^(Origen:|Validación|Vista previa|Importación|Deshacer|VEREDICTO|Postgres temporal|El ensayo falló|La validación NO)/;
    const onLine = (line) => {
      lines.push(line);
      if (line.startsWith("@@RESULT ")) {
        try { result = JSON.parse(line.slice(9)); } catch { /* resumen ilegible */ }
      } else if (milestone.test(line)) say(`  ${line}`);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        onLine(buffer.slice(0, index).replace(/\r$/, ""));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => lines.push(...chunk.split(/\r?\n/).filter(Boolean).map((l) => `[stderr] ${l}`)));
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buffer) onLine(buffer);
      try {
        // El informe sólo lleva identificadores, nombres de campo y cantidades (así lo garantiza el ensayo).
        writeFileSync(reportPath, lines.filter((l) => !l.startsWith("@@RESULT ")).join("\n") + "\n", { mode: 0o600, flag: "wx" });
      } catch { /* el informe es un extra */ }
      resolve({ ok: code === 0 && result !== null && result.differences === 0 && result.leftAfterUndo === 0, code, result, lastLine: lines.filter((l) => l && !l.startsWith("@@")).slice(-1)[0] ?? "" });
    });
  });
}

let supabase = null;
try {
  const now = new Date();
  const folder = outArg;
  const targets = {
    origin: safeOutputPath(join(folder, `origen-dpapi-${stamp(now)}.tfdp`)),
    destination: safeOutputPath(join(folder, `destino-dpapi-${stamp(now)}.tfdp`)),
    report: safeOutputPath(join(folder, `informe-ensayo-${stamp(now)}.txt`)),
  };

  let credentials = await readCredentials();

  const envFile = process.env.TF_ENV_FILE;
  if (envFile && !existsSync(envFile)) throw new SecureCopyError("unsafe_path", "TF_ENV_FILE apunta a un archivo que no existe.");
  for (const file of envFile ? [envFile] : [".env.local", ".env"]) if (existsSync(file)) { try { process.loadEnvFile(file); } catch { /* se ignora */ } }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new SecureCopyError("unsafe_path", "Faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública en el archivo de entorno (.env.local).");

  // 1) Primero se valida la autenticación: servicio alcanzable y credenciales aceptadas, con un diagnóstico claro de cada causa.
  say("1/4 Verificando la conexión y el inicio de sesión…");
  const unreachable = await checkAuthReachable(url, anonKey);
  if (unreachable) failAuth(unreachable);
  supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let session;
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: credentials.email, password: credentials.password });
    if (error || !data?.user) failAuth(classifyAuthFailure(error ?? {}));
    session = data;
  } catch (error) {
    if (error instanceof AuthAbort) throw error;
    failAuth(classifyAuthFailure(error));
  }
  credentials = null; // las credenciales ya no se necesitan: no quedan referenciadas
  console.log("@@AUTH_OK");
  say("    Sesión iniciada (sólo lectura; no se toca ninguna otra sesión).");

  // 2) Exportar origen y destino, cifrados con DPAPI y verificados desde el disco.
  mkdirSync(folder, { recursive: true });
  say("2/4 Exportando el ORIGEN (último respaldo de la nube) y el DESTINO (lo que tiene la web hoy)…");
  const { data: backupRows, error: backupError } = await supabase.rpc("fetch_own_latest_cloud_backup");
  if (backupError) throw new SecureCopyError("unsafe_path", "No se pudo leer el respaldo de la nube.");
  const row = Array.isArray(backupRows) ? backupRows[0] : backupRows;
  if (!row) throw new SecureCopyError("unsafe_path", "La cuenta no tiene ningún respaldo en la nube.");
  const originDocument = { kind: "origin", takenAt: new Date().toISOString(), cloudBackup: { id: row.id, schemaVersion: row.schema_version, appVersion: row.app_version, checksum: row.checksum, createdAt: row.created_at }, payload: row.payload };
  const age = describeBackupAge(row.created_at, new Date());
  const exported = await exportDestination(supabase, session.user.id, DESTINATION_TABLES);
  const destinationDocument = { kind: "destination", takenAt: new Date().toISOString(), schema: exported.schema, unavailable: exported.unavailable, tables: exported.tables };

  say("3/4 Cifrando con Windows DPAPI y comprobando la recuperación desde el disco…");
  const originSaved = saveCopy(originDocument, targets.origin);
  const destinationSaved = saveCopy(destinationDocument, targets.destination);
  const destinationRows = Object.values(exported.tables).reduce((n, rows) => n + rows.length, 0);
  addSummary(`COPIAS VERIFICADAS (2): origen ${originSaved.plaintextBytes} bytes · destino ${destinationRows} filas en ${Object.keys(exported.tables).length} tablas (esquema ${exported.schema}). Recuperación comprobada leyendo los archivos ya escritos.`);
  addSummary(`Carpeta: ${folder} · ${targets.origin.split(/[\\/]/).pop()} y ${targets.destination.split(/[\\/]/).pop()}`);
  if (age) addSummary(age.message);
  addSummary("Cifradas con Windows DPAPI: sólo se abren con ESTE usuario de Windows en ESTE equipo (sin frase de respaldo). Las copias anteriores se conservaron intactas.");
  void originSaved; void destinationSaved;

  // 3) Ensayo aislado.
  if (skipRehearsal) {
    addSummary("Ensayo aislado: omitido (--sin-ensayo).");
  } else {
    say("4/4 Ensayo aislado en un Postgres local descartable (puede tardar unos minutos)…");
    const rehearsal = await runRehearsal(targets.origin, targets.report);
    if (!rehearsal.result) {
      addSummary(`ENSAYO NO TERMINÓ: ${rehearsal.reason ?? rehearsal.lastLine ?? "sin detalle"}. Las copias ya están a salvo.`);
      process.exitCode = 20;
    } else {
      const r = rehearsal.result;
      const rc = r.reconciliation;
      addSummary(`DEFECTOS DEL TRASLADO: ${r.differences === 0 ? "ninguno" : `${r.differences} (ver el informe)`} · ${r.fieldChecks} campos comparados, ${r.mismatchedFields} con diferencias · deshacer ${r.undoSafe ? "seguro" : "NO seguro"} (quedan ${r.leftAfterUndo} filas).`);
      addSummary(`BALANCE: origen ${rc.sourceRows} filas = omitidas ${rc.omittedByAdapter} + esperadas ${rc.expectedRows} · en el destino ${rc.foundRows} · pendientes ${rc.missingRows} · de más ${rc.extraRows} (${rc.balanced && rc.expectedRows === rc.foundRows + rc.missingRows ? "CIERRA" : "NO CIERRA"}). Registros: ${r.registrations.insertable}/${r.registrations.total} se trasladan.`);
      const excess = (r.excess ?? []).reduce((n, e) => n + e.n, 0);
      addSummary(`INCONSISTENCIAS DEL ORIGEN CONSERVADAS (no son defectos): ${r.originIncidents} referencias ya rotas en la app (incidencias explícitas) · ${excess} asignación(es) con exceso pendiente de clasificación · ${r.zeroAmountCharges} cobro(s) de importe 0.`);
      const pending = r.files.reduce((n, f) => n + f.pending, 0);
      const byKind = Object.fromEntries(r.files.map((f) => [f.kind, f]));
      addSummary(`ARCHIVOS: ${pending} por extraer del teléfono — adjuntos ${byKind.adjunto?.pending ?? 0}/${byKind.adjunto?.total ?? 0} (${(r.attachments.declaredBytes / 1048576).toFixed(1)} MB declarados), materiales ${byKind.material?.pending ?? 0}/${byKind.material?.total ?? 0}, PDF ${byKind.reporte_pdf?.pending ?? 0}/${byKind.reporte_pdf?.total ?? 0}. Ausentes en el teléfono: ${r.absentAtOriginVerified ? r.files.reduce((n, f) => n + f.unavailableAtOrigin, 0) : "NO COMPROBADO (falta leer el teléfono)"}.`);
      addSummary(`Informe del ensayo (sólo ids, campos y cantidades): ${targets.report}`);
      if (!rehearsal.ok) process.exitCode = 20;
    }
  }
  addSummary("Production no se modificó: no hubo migraciones, importaciones, congelamiento ni borrados.");
} catch (error) {
  if (error instanceof AuthAbort) {
    console.log(`@@AUTH_FAIL|${error.failure.kind}|${error.failure.message}`);
    process.exitCode = 10;
  } else console.log("ERROR: " + (error instanceof SecureCopyError || error instanceof ExportAbortError ? error.message : "No se pudo completar el circuito."));
  if (!(error instanceof AuthAbort)) process.exitCode = process.exitCode || 1;
} finally {
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
