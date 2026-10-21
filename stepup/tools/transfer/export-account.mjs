// Copias INDEPENDIENTES del origen y del destino del traslado, directamente a un archivo CIFRADO (nunca queda nada en claro en disco ni en pantalla).
//
//   node tools/transfer/export-account.mjs origin       <copia-origen.tfsc>        la ÚLTIMA copia de la nube (lo que la web importaría), sólo lectura
//   node tools/transfer/export-account.mjs destination  <copia-destino.tfsc>       lo que la cuenta tiene hoy en la web (todas las tablas del traslado), sólo lectura
//   node tools/transfer/export-account.mjs both         <carpeta-privada>          las dos a la vez (un solo inicio de sesión y una sola frase de paso); nombres con fecha y hora
//
// Se corre en TU terminal: te pide el correo y la contraseña de TU cuenta (la contraseña con la pantalla oculta) y la frase de paso para cifrar. Nada de eso pasa por
// el chat ni se guarda. Sólo LEE (con las mismas reglas de acceso que la propia web: cada cuenta ve únicamente lo suyo) y al terminar cierra SÓLO esta sesión
// (alcance local): no toca la sesión del teléfono ni ninguna otra. Usa las claves PÚBLICAS (URL y clave anónima) de `.env.local`, o del archivo que indiques en
// TF_ENV_FILE (por ejemplo, el de la carpeta principal del proyecto web si corrés desde otra copia de trabajo), nunca la clave de servicio.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createPrompter } from "./prompt.mjs";
import { encryptBuffer, safeOutputPath, SecureCopyError, verifyEncrypted } from "../../lib/secure-copy/secure-copy.ts";
import { DESTINATION_TABLES } from "../../lib/backup/transfer-compare.ts";
import { exportDestination, ExportAbortError } from "../../lib/transfer/export-destination.ts";
import { describeBackupAge } from "../../lib/transfer/backup-age.ts";

const [command, outArg] = process.argv.slice(2);
if (!["origin", "destination", "both"].includes(command) || !outArg) {
  console.error("Uso: export-account.mjs origin|destination <copia.tfsc>   |   export-account.mjs both <carpeta-privada>");
  process.exit(2);
}

const prompter = createPrompter();
const ask = (question, hidden) => prompter.ask(question, hidden);

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

let supabase = null;
try {
  // Todas las rutas se validan ANTES de pedir nada: fuera de cualquier repositorio y sin pisar archivos.
  const now = new Date();
  const targets = command === "both"
    ? [["origin", safeOutputPath(join(outArg, `origen-${stamp(now)}.tfsc`))], ["destination", safeOutputPath(join(outArg, `destino-${stamp(now)}.tfsc`))]]
    : [[command, safeOutputPath(outArg)]];
  if (command === "both") mkdirSync(join(outArg), { recursive: true });

  const envFiles = process.env.TF_ENV_FILE ? [process.env.TF_ENV_FILE] : [".env.local", ".env"];
  if (process.env.TF_ENV_FILE && !existsSync(process.env.TF_ENV_FILE)) throw new SecureCopyError("unsafe_path", "TF_ENV_FILE apunta a un archivo que no existe.");
  for (const file of envFiles) if (existsSync(file)) { try { process.loadEnvFile(file); } catch { /* se ignora */ } }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new SecureCopyError("unsafe_path", "Faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública (en .env.local o en el archivo de TF_ENV_FILE).");

  const email = process.env.TF_ACCOUNT_EMAIL || (await ask("Correo de tu cuenta: ", false));
  const password = process.env.TF_ACCOUNT_PASSWORD || (await ask("Contraseña (no se muestra): ", true));
  const passphrase = process.env.TF_COPY_PASSPHRASE || (await ask("Frase de paso para CIFRAR la copia (mínimo 12 caracteres): ", true));
  if (!process.env.TF_COPY_PASSPHRASE) {
    const again = await ask("Repetí la frase de paso: ", true);
    if (again !== passphrase) throw new SecureCopyError("weak_passphrase", "Las dos frases no coinciden.");
  }

  supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !session.user) throw new SecureCopyError("unsafe_path", "No se pudo iniciar sesión con esos datos.");
  const ownerId = session.user.id;

  for (const [kind, out] of targets) {
    let document;
    let ageLine = null;
    if (kind === "origin") {
      const { data, error } = await supabase.rpc("fetch_own_latest_cloud_backup");
      if (error) throw new SecureCopyError("unsafe_path", "No se pudo leer el respaldo de la nube.");
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new SecureCopyError("unsafe_path", "La cuenta no tiene ningún respaldo en la nube.");
      document = { kind: "origin", takenAt: new Date().toISOString(), cloudBackup: { id: row.id, schemaVersion: row.schema_version, appVersion: row.app_version, checksum: row.checksum, createdAt: row.created_at }, payload: row.payload };
      ageLine = describeBackupAge(row.created_at, new Date())?.message ?? null;
    } else {
      // Funciona con el esquema ANTERIOR a R9/R10: lo que esas migraciones agregan y todavía no existe se declara «no disponible»; cualquier otro problema aborta.
      const exported = await exportDestination(supabase, ownerId, DESTINATION_TABLES);
      document = { kind: "destination", takenAt: new Date().toISOString(), schema: exported.schema, unavailable: exported.unavailable, tables: exported.tables };
    }

    const plain = Buffer.from(JSON.stringify(document), "utf8");
    const { file, plaintextSha256, plaintextBytes } = encryptBuffer(plain, passphrase);
    const partial = `${out}.parcial`;
    writeFileSync(partial, file, { mode: 0o600 });
    verifyEncrypted(readFileSync(partial), passphrase, plaintextSha256); // recuperación comprobada sobre lo escrito en disco
    renameSync(partial, out);
    const summary = kind === "origin" ? "1 respaldo" : `${Object.values(document.tables).reduce((n, rows) => n + rows.length, 0)} filas en ${Object.keys(document.tables).length} tablas, esquema ${document.schema}${document.unavailable.length ? ` (no disponibles en esta versión: ${document.unavailable.join(", ")})` : ""}`;
    console.log(`Copia ${kind === "origin" ? "del ORIGEN" : "del DESTINO"} cifrada y verificada: ${out}`);
    console.log(`  ${summary}; ${plaintextBytes} bytes; huella ${plaintextSha256}.`);
    if (ageLine) console.log(`  ${ageLine}`);
  }
  console.log("Guardá la frase de paso en un gestor de contraseñas: sin ella la copia no se recupera. No se escribió nada en claro.");
} catch (error) {
  console.error(error instanceof SecureCopyError || error instanceof ExportAbortError ? error.message : "No se pudo completar la copia.");
  process.exitCode = 1;
} finally {
  prompter.close();
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
