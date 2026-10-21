/**
 * Copias cifradas SIN frase manual: la clave de cada copia es aleatoria y se protege con Windows DPAPI (alcance CurrentUser).
 *
 *   - El contenido se cifra con AES-256-GCM (clave aleatoria de 32 bytes, IV aleatorio, encabezado autenticado como datos asociados).
 *   - Esa clave se guarda en el propio archivo, pero ENVUELTA por DPAPI: sólo el MISMO usuario de Windows, en el MISMO equipo, puede abrirla.
 *     Sin ese usuario (otro usuario, otro equipo, perfil reinstalado) la copia NO se puede recuperar: no hay frase de respaldo.
 *   - Nada en claro toca el disco, los argumentos ni los registros. Al envolver/abrir la clave, sólo ella (32 bytes en base64) pasa por la
 *     entrada estándar de un powershell.exe hijo; el script va fijo y no lleva datos.
 * Complementa (no reemplaza) las copias con frase de `secure-copy.ts` (`TFSC1`): ésas se conservan y se siguen pudiendo abrir.
 */
import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { SecureCopyError, sha256Hex, type EncryptResult } from "./secure-copy.ts";

const MAGIC = "TFDP1\n";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Entropía adicional de DPAPI: ata la clave a esta aplicación (no es un secreto). */
const ENTROPY = "TeacherFlow-traslado-v1";

const SCRIPT = (mode: "Protect" | "Unprotect") =>
  `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;` +
  `$b=[Convert]::FromBase64String(([Console]::In.ReadToEnd()).Trim());` +
  `$e=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}');` +
  `[Console]::Out.Write([Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::${mode}($b,$e,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)))`;

function powershellPath(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function dpapi(mode: "Protect" | "Unprotect", data: Buffer): Buffer {
  if (process.platform !== "win32") throw new SecureCopyError("unsafe_path", "El cifrado con Windows DPAPI sólo existe en Windows.");
  const result = spawnSync(powershellPath(), ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT(mode), "utf16le").toString("base64")], {
    input: data.toString("base64"),
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  const out = (result.stdout ?? "").trim();
  if (result.error || result.status !== 0 || !out) {
    throw new SecureCopyError(
      mode === "Protect" ? "unsafe_path" : "wrong_passphrase_or_tampered",
      mode === "Protect"
        ? "Windows no pudo proteger la clave de la copia (DPAPI)."
        : "Esta copia no se puede abrir con este usuario de Windows: se cifró con otro usuario u otro equipo."
    );
  }
  return Buffer.from(out, "base64");
}

export const isDpapiCopy = (file: Buffer): boolean => file.length > MAGIC.length && file.subarray(0, MAGIC.length).toString("utf8") === MAGIC;

function lengthPrefix(header: Buffer): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(header.length);
  return out;
}

export function encryptDpapi(plaintext: Buffer): EncryptResult {
  const key = randomBytes(KEY_BYTES);
  const iv = randomBytes(IV_BYTES);
  const wrapped = dpapi("Protect", key);
  const header = Buffer.from(JSON.stringify({ v: 1, alg: "aes-256-gcm", protection: "dpapi-current-user", wrappedKey: wrapped.toString("base64"), iv: iv.toString("base64") }), "utf8");
  const prefix = Buffer.concat([Buffer.from(MAGIC, "utf8"), lengthPrefix(header), header]);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(prefix);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  key.fill(0);
  return { file: Buffer.concat([prefix, body, cipher.getAuthTag()]), plaintextSha256: sha256Hex(plaintext), plaintextBytes: plaintext.length };
}

export function decryptDpapi(file: Buffer): Buffer {
  const bad = () => new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  if (!isDpapiCopy(file) || file.length < MAGIC.length + 4 + TAG_BYTES) throw bad();
  const headerLength = file.readUInt32BE(MAGIC.length);
  const prefixEnd = MAGIC.length + 4 + headerLength;
  if (headerLength < 2 || headerLength > 8192 || file.length < prefixEnd + TAG_BYTES) throw bad();
  let header: { v?: number; alg?: string; protection?: string; wrappedKey?: string; iv?: string };
  try {
    header = JSON.parse(file.subarray(MAGIC.length + 4, prefixEnd).toString("utf8"));
  } catch {
    throw bad();
  }
  if (header.v !== 1 || header.alg !== "aes-256-gcm" || header.protection !== "dpapi-current-user" || typeof header.wrappedKey !== "string" || typeof header.iv !== "string") throw bad();
  const iv = Buffer.from(header.iv, "base64");
  if (iv.length !== IV_BYTES) throw bad();
  const key = dpapi("Unprotect", Buffer.from(header.wrappedKey, "base64"));
  if (key.length !== KEY_BYTES) throw bad();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(file.subarray(0, prefixEnd));
    decipher.setAuthTag(file.subarray(file.length - TAG_BYTES));
    return Buffer.concat([decipher.update(file.subarray(prefixEnd, file.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SecureCopyError("wrong_passphrase_or_tampered", "No se pudo descifrar: el archivo se modificó o está dañado.");
  } finally {
    key.fill(0);
  }
}

/** Recuperación comprobada: abre el archivo YA ESCRITO y exige que su huella sea la del original. Nunca escribe el contenido. */
export function verifyDpapi(file: Buffer, expectedSha256: string): { ok: true; plaintextSha256: string; plaintextBytes: number } {
  const plain = decryptDpapi(file);
  const actual = sha256Hex(plain);
  if (!/^[0-9a-fA-F]{64}$/.test(expectedSha256) || !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedSha256, "hex"))) {
    throw new SecureCopyError("hash_mismatch", "Lo recuperado NO coincide con la huella esperada.");
  }
  return { ok: true, plaintextSha256: actual, plaintextBytes: plain.length };
}
