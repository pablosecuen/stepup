// Ejecuta el TRASLADO (pasos 1 a 7 del plan) con UNA sola sesión de la cuenta. Lo lanza `Iniciar-traslado.cmd` (modo traslado); las credenciales llegan UNA vez por la entrada estándar,
// viven sólo en memoria y no se piden otra vez en ninguna fase.
//
//   <JSON {"email","password"} por la ENTRADA ESTÁNDAR> | node tools/transfer/execute-transfer.mjs <carpeta-privada> --app <carpeta de la app> [opciones]
//
//   --fases backup,esquema,archivo,despliegue,proteccion,importar,archivos,final   (por defecto, todas en ese orden)
//   «despliegue» espera el archivo `despliegue-verificado.txt` en la carpeta privada (lo crea quien despliega la web cuando la verificó) antes de importar
//   --rehacer                deshace la importación anterior (sólo si es seguro) y vuelve a importar la copia MÁS RECIENTE
//   --puerto-metro 8082      Metro del teléfono        --espera-esquema-min 180   cuánto esperar las migraciones
//
// Nunca congela el origen ni borra respaldos, archivos o datos del origen. Cierra SÓLO su propia sesión al terminar.
// Protocolo de líneas con el iniciador: @@AUTH_FAIL|tipo|mensaje · @@AUTH_OK · @@SUMMARY|línea. Salida: 0 completo · 10 sesión · 20 se detuvo en una fase · 30 terminó pero NO COMPLETO · 1 error.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";
import { checkAuthReachable, classifyAuthFailure } from "../../lib/transfer/auth-errors.ts";
import { ALL_PHASES, runTransfer } from "../../lib/transfer/orchestrator.ts";
import { openSession, SessionError } from "../../lib/transfer/session.ts";
import { createFileStateStore } from "../../lib/transfer/state-file.ts";
import { createDpapiSaver } from "../../lib/transfer/save-copy.ts";
import { createPhoneChannel } from "./phone-copy.mjs";

const [folder, ...flags] = process.argv.slice(2);
const option = (name, fallback) => {
  const i = flags.indexOf(name);
  return i >= 0 && flags[i + 1] ? flags[i + 1] : fallback;
};
if (!folder) {
  console.error("Uso: execute-transfer.mjs <carpeta-privada> --app <carpeta de la app> [--fases a,b] [--rehacer]  (las credenciales llegan por la entrada estándar)");
  process.exit(2);
}

async function readCredentials() {
  if (process.stdin.isTTY) throw new SecureCopyError("unsafe_path", "Este comando lo lanza el iniciador: las credenciales llegan por la entrada estándar, no se escriben acá.");
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 16_384) throw new SecureCopyError("bad_format", "Las credenciales recibidas son demasiado largas.");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/﻿/g, "").trim());
  } catch {
    throw new SecureCopyError("bad_format", "No se recibieron las credenciales en el formato esperado.");
  }
  if (typeof parsed?.email !== "string" || typeof parsed?.password !== "string" || !parsed.email.trim() || !parsed.password) throw new SecureCopyError("bad_format", "Falta el correo o la contraseña.");
  return { email: parsed.email.trim(), password: parsed.password };
}

const summary = (line) => console.log(`@@SUMMARY|${line}`);
let session = null;
try {
  const credentials = await readCredentials();
  const envFile = process.env.TF_ENV_FILE;
  if (envFile && !existsSync(envFile)) throw new SecureCopyError("unsafe_path", "TF_ENV_FILE apunta a un archivo que no existe.");
  for (const file of envFile ? [envFile] : [".env.local", ".env"]) if (existsSync(file)) { try { process.loadEnvFile(file); } catch { /* se ignora */ } }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new SecureCopyError("unsafe_path", "Faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública en el archivo de entorno (.env.local).");

  console.log("Verificando la conexión y el inicio de sesión…");
  const unreachable = await checkAuthReachable(url, anonKey);
  if (unreachable) {
    console.log(`@@AUTH_FAIL|${unreachable.kind}|${unreachable.message}`);
    process.exitCode = 10;
  } else {
    try {
      session = await openSession({ createClient: () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } }), email: credentials.email, password: credentials.password });
    } catch (error) {
      const failure = classifyAuthFailure(error instanceof SessionError ? error.cause2 : error);
      console.log(`@@AUTH_FAIL|${failure.kind}|${failure.message}`);
      process.exitCode = 10;
    }
    credentials.password = "";
    if (session) {
      console.log("@@AUTH_OK");
      console.log("Sesión iniciada UNA vez: no se piden las credenciales otra vez en ninguna fase.");
      mkdirSync(folder, { recursive: true });
      const phases = option("--fases", ALL_PHASES.join(",")).split(",").map((p) => p.trim()).filter(Boolean);
      const bad = phases.filter((p) => !ALL_PHASES.includes(p));
      if (bad.length) throw new SecureCopyError("bad_format", `Fase desconocida: ${bad.join(", ")}.`);
      const appDir = option("--app", "");
      const deps = {
        session,
        state: createFileStateStore(join(folder, "estado-traslado.json")),
        now: () => new Date(),
        log: (line) => console.log(line),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        saveCopy: createDpapiSaver(folder, () => new Date()),
        phone: createPhoneChannel({ appDir, metroPort: Number(option("--puerto-metro", "8082")), log: (l) => console.log(l) }),
        schemaWaitMs: Number(option("--espera-esquema-min", "180")) * 60_000,
        waitGate: async (_name, timeoutMs) => {
          const flag = join(folder, "despliegue-verificado.txt");
          const deadline = Date.now() + timeoutMs;
          while (!existsSync(flag)) {
            if (Date.now() > deadline) return false;
            await new Promise((r) => setTimeout(r, 5000));
          }
          return true;
        },
        quotaBytes: process.env.TF_STORAGE_QUOTA_BYTES ? Number(process.env.TF_STORAGE_QUOTA_BYTES) : undefined,
      };
      if (phases.includes("archivos") && !appDir) throw new SecureCopyError("bad_format", "Falta --app <carpeta de la app> para la copia del teléfono.");
      const result = await runTransfer(deps, { phases, redo: flags.includes("--rehacer") });
      for (const line of result.final?.lines ?? []) summary(line);
      if (!result.ok) {
        summary(`SE DETUVO: ${result.blocker ?? "sin detalle"}`);
        process.exitCode = 20;
      } else if (result.final && !result.final.complete) {
        summary("El circuito terminó pero el traslado NO está completo (ver arriba).");
        process.exitCode = 30;
      } else if (result.final) summary("TRASLADO COMPLETO verificado. El origen se conserva intacto: congelarlo requiere tu confirmación.");
      else summary(`Fases completadas: ${result.completed.join(", ")}.`);
      summary("Inicios de sesión en esta ejecución: " + session.signInCount + " (las credenciales se pidieron una sola vez).");
    }
  }
} catch (error) {
  console.log("ERROR: " + (error instanceof SecureCopyError ? error.message : "No se pudo completar el circuito (" + String(error?.message ?? error).slice(0, 160) + ")."));
  process.exitCode = process.exitCode || 1;
} finally {
  if (session) await session.dispose();
}
