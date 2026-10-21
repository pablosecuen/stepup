// Copias cifradas del traslado (origen y destino). Se usa desde TU terminal; la frase de paso la escribís vos (no se pasa por argumento ni por chat).
//
//   node tools/secure-copy/secure-copy.mjs encrypt  <archivo-en-claro> <copia.tfsc>        cifra, comprueba que se puede recuperar y recién ahí deja el archivo
//   node tools/secure-copy/secure-copy.mjs verify   <copia.tfsc> [huella-sha256]           descifra EN MEMORIA y compara la huella; no escribe nada
//   node tools/secure-copy/secure-copy.mjs decrypt  <copia.tfsc> <salida>                  descifra a un archivo (fuera del repositorio, permisos sólo tuyos)
//
// La frase de paso se pide con la pantalla oculta. Para automatizar en un entorno propio se admite la variable TF_COPY_PASSPHRASE (nunca por argumento).
// Reglas: la salida va FUERA del repositorio/proyecto; nunca se pisa un archivo; nunca se imprime contenido; el «en claro» se borra a mano por quien lo creó.
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { encryptBuffer, safeOutputPath, SecureCopyError, verifyEncrypted, decryptBuffer, sha256Hex } from "../../lib/secure-copy/secure-copy.ts";
import { createPrompter } from "../transfer/prompt.mjs";

const prompter = createPrompter();
const askHidden = (question) => prompter.ask(question, true);

async function passphrase(confirm) {
  if (process.env.TF_COPY_PASSPHRASE) return process.env.TF_COPY_PASSPHRASE;
  const first = await askHidden("Frase de paso (mínimo 12 caracteres): ");
  if (confirm) {
    const second = await askHidden("Repetila: ");
    if (first !== second) throw new SecureCopyError("weak_passphrase", "Las dos frases no coinciden.");
  }
  return first;
}

const [command, a, b, c] = process.argv.slice(2);
try {
  if (command === "encrypt" && a && b) {
    const plain = readFileSync(a);
    const out = safeOutputPath(b);
    const pass = await passphrase(true);
    const { file, plaintextSha256, plaintextBytes } = encryptBuffer(plain, pass);
    const partial = `${out}.parcial`;
    writeFileSync(partial, file, { mode: 0o600 });
    // Recuperación comprobada sobre lo que quedó ESCRITO en disco, no sobre lo que había en memoria.
    verifyEncrypted(readFileSync(partial), pass, plaintextSha256);
    renameSync(partial, out);
    try { chmodSync(out, 0o600); } catch { /* en Windows los permisos los define la carpeta */ }
    console.log(`Copia cifrada y verificada: ${plaintextBytes} bytes originales, huella ${plaintextSha256}.`);
    console.log("Guardá la frase de paso en un gestor de contraseñas: sin ella la copia NO se puede recuperar. El archivo original en claro sigue donde estaba: borralo vos cuando ya no lo necesites.");
  } else if (command === "verify" && a) {
    const file = readFileSync(a);
    const typed = await passphrase(false);
    let result;
    try {
      result = verifyEncrypted(file, typed, b);
    } catch (error) {
      if (!(error instanceof SecureCopyError) || error.code !== "wrong_passphrase_or_tampered") throw error;
      // Diagnóstico sin revelar la frase: el archivo tiene formato válido; sólo cuenta cuántos caracteres llegaron y si alguno no es ASCII (teclado/acentos).
      const nonAscii = /[^\u0000-\u007f]/.test(typed);
      let worksTrimmed = false;
      if (typed.trim() !== typed) { try { decryptBuffer(file, typed.trim()); worksTrimmed = true; } catch { /* no era eso */ } }
      if (worksTrimmed) throw new SecureCopyError("wrong_passphrase_or_tampered", "La frase es correcta, pero escribiste espacios de más al principio o al final. Ingresala sin ellos.");
      throw new SecureCopyError("wrong_passphrase_or_tampered", `${error.message} (la terminal recibió ${[...typed].length} caracteres${nonAscii ? ", con alguno no ASCII" : ", todos ASCII"}; el formato del archivo es válido)`);
    }
    console.log(`Recuperación comprobada: ${result.plaintextBytes} bytes, huella ${result.plaintextSha256}${b ? " (coincide con la esperada)" : ""}.`);
  } else if (command === "decrypt" && a && b) {
    const out = safeOutputPath(b);
    const plain = decryptBuffer(readFileSync(a), await passphrase(false));
    writeFileSync(out, plain, { mode: 0o600, flag: "wx" });
    console.log(`Descifrado en ${out} (${plain.length} bytes, huella ${sha256Hex(plain)}). Es un archivo EN CLARO con datos personales: borralo cuando termines.`);
  } else {
    console.error("Uso: encrypt <en-claro> <copia.tfsc> | verify <copia.tfsc> [huella] | decrypt <copia.tfsc> <salida>");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof SecureCopyError ? error.message : "No se pudo completar la operación.");
  process.exitCode = 1;
} finally {
  prompter.close();
}
