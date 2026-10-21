// Conservar y congelar el origen (R11) desde TU terminal, con tu sesión. Nada se borra: la copia permanente de los respaldos de la nube se AGREGA, y congelar sólo impide que la
// app anterior guarde (y rote) respaldos y que se importe otra copia. No cierra sesiones ni toca la autenticación, el dispositivo activo ni otras cuentas. Requiere R11 aplicada.
//
//   node tools/transfer/freeze-legacy.mjs status
//   node tools/transfer/freeze-legacy.mjs archive                                   deja a salvo TODOS los respaldos de la nube (hacerlo ya, y de nuevo en la pausa de carga)
//   node tools/transfer/freeze-legacy.mjs freeze <origen-final.tfsc> <destino-final.tfsc>   coteja las dos copias cifradas y, sólo con veredicto COMPLETO y tu confirmación, congela
//   node tools/transfer/freeze-legacy.mjs reopen "<motivo>"                         reabre (para incorporar algo cargado después de la copia); queda registrado
//
// Pide correo y contraseña (oculta) de TU cuenta; la frase de paso de las copias sólo para `freeze`. Usa las claves PÚBLICAS de .env.local, nunca la de servicio.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createPrompter } from "./prompt.mjs";
import { SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";
import { openCopy } from "../../lib/secure-copy/open-copy.ts";
import { compareTransfer } from "../../lib/backup/transfer-compare.ts";
import { validateBackupPayload } from "../../lib/backup/validation.ts";

const [command, a, b] = process.argv.slice(2);
if (!["status", "archive", "freeze", "reopen"].includes(command) || (command === "freeze" && (!a || !b)) || (command === "reopen" && !a)) {
  console.error('Uso: freeze-legacy.mjs status | archive | freeze <origen-final.tfsc> <destino-final.tfsc> | reopen "<motivo>"');
  process.exit(2);
}

const prompter = createPrompter();
const ask = (question, hidden) => prompter.ask(question, hidden);

let supabase = null;
try {
  if (process.env.TF_ENV_FILE && !existsSync(process.env.TF_ENV_FILE)) throw new SecureCopyError("unsafe_path", "TF_ENV_FILE apunta a un archivo que no existe.");
  for (const file of process.env.TF_ENV_FILE ? [process.env.TF_ENV_FILE] : [".env.local", ".env"]) if (existsSync(file)) { try { process.loadEnvFile(file); } catch { /* se ignora */ } }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new SecureCopyError("unsafe_path", "Faltan NEXT_PUBLIC_SUPABASE_URL y la clave pública en .env.local.");

  // Primero se prepara todo lo que no necesita la cuenta (cotejo de las copias): si algo falla, no se inicia sesión.
  let freezeArgs = null;
  if (command === "freeze") {
    let cached;
    const copyPassphrase = async () => (cached ??= process.env.TF_COPY_PASSPHRASE || (await ask("Frase de paso de las copias: ", true))); // sólo si alguna copia lleva frase
    const originPlain = await openCopy(readFileSync(a), copyPassphrase);
    const destinationPlain = await openCopy(readFileSync(b), copyPassphrase);
    const origin = JSON.parse(originPlain.toString("utf8"));
    const destination = JSON.parse(destinationPlain.toString("utf8"));
    if (origin.kind !== "origin" || destination.kind !== "destination") throw new SecureCopyError("bad_format", "Las copias tienen que ser (origen, destino) en ese orden.");
    if (!origin.cloudBackup?.checksum) throw new SecureCopyError("bad_format", "La copia del origen no trae la huella del respaldo de la nube.");
    const validation = validateBackupPayload(origin.payload);
    const result = compareTransfer(origin.payload, destination.tables, { adapterOmitted: validation.adaptation?.omitted ?? [] });
    console.log(`Cotejo: ${result.summary.rowsFound}/${result.summary.rowsExpected} filas, ${result.summary.fieldChecks} campos, ${result.summary.fieldMismatches} diferencias · archivos ausentes en el origen: ${result.verdict.absentAtOrigin}`);
    if (!result.verdict.complete) {
      for (const reason of result.verdict.reasons.slice(0, 20)) console.log(`  - ${reason}`);
      throw new SecureCopyError("hash_mismatch", "El cotejo NO es COMPLETO: no se congela nada. Resolvé las diferencias y volvé a copiar origen y destino.");
    }
    const absent = result.verdict.absentAtOrigin;
    if (!result.verdict.absentAtOriginVerified) throw new SecureCopyError("hash_mismatch", "Todavía no se leyó el teléfono: «0 archivos ausentes» no está comprobado. No se congela nada hasta que la extracción del teléfono esté registrada.");
    if (absent > 0) {
      console.log(`AVISO: ${absent} archivo(s) ya no existían en el teléfono: están declarados como AUSENTES y NO se migraron. No se puede decir «sin pérdidas» mientras no los resuelvas o aceptes esta excepción.`);
      const accepted = await ask(`Si aceptás EXPLÍCITAMENTE que esos ${absent} archivo(s) queden sin migrar, escribí ACEPTO (otra cosa cancela): `, false);
      if (accepted.trim() !== "ACEPTO") throw new SecureCopyError("exists", "No se congeló nada: los archivos ausentes no fueron aceptados.");
    }
    console.log("Verificá en la web que todo se ve bien (clases, cobros, reportes, adjuntos) y que en Expo Go no se cargó nada después de la copia.");
    const typed = await ask("Si TODO está correcto escribí CONFIRMO para congelar el origen: ", false);
    if (typed.trim() !== "CONFIRMO") throw new SecureCopyError("exists", "No se congeló nada (no escribiste CONFIRMO).");
    freezeArgs = {
      checksum: origin.cloudBackup.checksum,
      audit: {
        verdict: "COMPLETO",
        user_confirmed: "true",
        origin_copy_sha256: createHash("sha256").update(originPlain).digest("hex"),
        destination_copy_sha256: createHash("sha256").update(destinationPlain).digest("hex"),
        entities: result.summary.entities,
        rows: result.summary.rowsExpected,
        field_checks: result.summary.fieldChecks,
        absent_at_origin: absent,
        absent_accepted_by_user: absent > 0 ? "true" : "not_applicable",
        origin_incidents_preserved: result.verdict.originInconsistencies,
      },
    };
  }

  const email = process.env.TF_ACCOUNT_EMAIL || (await ask("Correo de tu cuenta: ", false));
  const password = process.env.TF_ACCOUNT_PASSWORD || (await ask("Contraseña (no se muestra): ", true));
  supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !session.user) throw new SecureCopyError("unsafe_path", "No se pudo iniciar sesión con esos datos.");

  const rpc = async (name, args) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new SecureCopyError("unsafe_path", error.code === "PGRST202" ? "R11 todavía no está aplicada en la base." : (error.message || "La base rechazó la operación.").slice(0, 300));
    return data;
  };
  if (command === "status") console.log("Estado del traslado:", JSON.stringify(await rpc("get_transfer_state")));
  else if (command === "archive") {
    const r = await rpc("archive_legacy_cloud_backups");
    console.log(`Copia permanente: ${r.archived_now} respaldo(s) nuevo(s) guardado(s); en total ${r.archived_total}. No se borró nada.`);
  } else if (command === "freeze") {
    const r = await rpc("freeze_legacy_source", { p_final_checksum: freezeArgs.checksum, p_audit: freezeArgs.audit });
    console.log(`Origen CONGELADO (${r.status}). Los respaldos de la app anterior quedan conservados y quietos; no se puede importar otra copia salvo que se reabra.`);
  } else if (command === "reopen") {
    await rpc("reopen_legacy_source", { p_reason: a });
    console.log("Traslado REABIERTO (queda registrado). Incorporá lo faltante y volvé a cotejar antes de congelar de nuevo.");
  }
} catch (error) {
  console.error(error instanceof SecureCopyError ? error.message : "No se pudo completar la operación.");
  process.exitCode = 1;
} finally {
  prompter.close();
  if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
