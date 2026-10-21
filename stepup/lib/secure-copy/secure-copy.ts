/**
 * Copias CIFRADAS fuera de la base (traslado Expo Go → web). Las copias del origen (el respaldo vigente de la nube) y del destino (el volcado previo) contienen
 * datos personales de alumnos: nunca se guardan en claro, ni en el repositorio, ni en un log. Este módulo cifra y descifra EN MEMORIA con primitivas estándar de
 * Node (sin dependencias nuevas):
 *   - clave: scrypt (N=2^15, r=8, p=1) a partir de una frase de paso larga que escribe la propia usuaria en su terminal (nunca por argumento ni por chat);
 *   - cifrado: AES-256-GCM, sal e IV aleatorios por archivo; el encabezado (formato, parámetros, sal, IV) va autenticado como datos asociados, así que tocar
 *     cualquier byte (encabezado o contenido) hace fallar el descifrado;
 *   - la huella SHA-256 del contenido original se informa al cifrar y se compara al verificar («recuperación comprobada»): cifrar no se da por bueno hasta
 *     que el mismo archivo ya escrito se vuelve a descifrar en memoria y coincide.
 * El resultado nunca contiene el contenido en claro (ni siquiera trozos): sólo encabezado, texto cifrado y etiqueta.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const MAGIC = "TFSC1\n";
const IV_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
export const DEFAULT_SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const;
export const MIN_PASSPHRASE_LENGTH = 12;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export type SecureCopyErrorCode = "weak_passphrase" | "bad_format" | "wrong_passphrase_or_tampered" | "unsafe_path" | "hash_mismatch" | "exists";

export class SecureCopyError extends Error {
  readonly code: SecureCopyErrorCode;

  constructor(code: SecureCopyErrorCode, message: string) {
    super(message);
    this.name = "SecureCopyError";
    this.code = code;
  }
}

export interface EncryptResult {
  file: Buffer;
  /** SHA-256 (hexadecimal) del contenido ORIGINAL: sirve para comprobar después que lo recuperado es idéntico. */
  plaintextSha256: string;
  plaintextBytes: number;
}

export const sha256Hex = (data: Buffer | Uint8Array): string => createHash("sha256").update(data).digest("hex");

function assertPassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new SecureCopyError("weak_passphrase", `La frase de paso debe tener al menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);
  }
}

function deriveKey(passphrase: string, salt: Buffer, params: ScryptParams): Buffer {
  return scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 });
}

export function encryptBuffer(plaintext: Buffer, passphrase: string, params: ScryptParams = DEFAULT_SCRYPT): EncryptResult {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.from(JSON.stringify({ v: 1, alg: "aes-256-gcm", kdf: "scrypt", N: params.N, r: params.r, p: params.p, salt: salt.toString("base64"), iv: iv.toString("base64") }), "utf8");
  const prefix = Buffer.concat([Buffer.from(MAGIC, "utf8"), lengthPrefix(header), header]);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt, params), iv);
  cipher.setAAD(prefix);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { file: Buffer.concat([prefix, body, cipher.getAuthTag()]), plaintextSha256: sha256Hex(plaintext), plaintextBytes: plaintext.length };
}

function lengthPrefix(header: Buffer): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(header.length);
  return out;
}

export function decryptBuffer(file: Buffer, passphrase: string): Buffer {
  const magic = Buffer.from(MAGIC, "utf8");
  if (file.length < magic.length + 4 + TAG_BYTES || !file.subarray(0, magic.length).equals(magic)) throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  const headerLength = file.readUInt32BE(magic.length);
  const prefixEnd = magic.length + 4 + headerLength;
  if (headerLength < 2 || headerLength > 4096 || file.length < prefixEnd + TAG_BYTES) throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  let header: { v?: number; alg?: string; kdf?: string; N?: number; r?: number; p?: number; salt?: string; iv?: string };
  try {
    header = JSON.parse(file.subarray(magic.length + 4, prefixEnd).toString("utf8"));
  } catch {
    throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  }
  if (header.v !== 1 || header.alg !== "aes-256-gcm" || header.kdf !== "scrypt" || !Number.isInteger(header.N) || !Number.isInteger(header.r) || !Number.isInteger(header.p) || typeof header.salt !== "string" || typeof header.iv !== "string") {
    throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  }
  // Un encabezado hostil no puede pedir un costo desmedido (memoria / tiempo).
  if ((header.N as number) > 1 << 20 || (header.N as number) < 1 << 10 || (header.r as number) > 32 || (header.p as number) > 8) throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  assertPassphrase(passphrase);
  const salt = Buffer.from(header.salt, "base64");
  const iv = Buffer.from(header.iv, "base64");
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new SecureCopyError("bad_format", "El archivo no es una copia cifrada de TeacherFlow.");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt, { N: header.N as number, r: header.r as number, p: header.p as number }), iv);
  decipher.setAAD(file.subarray(0, prefixEnd));
  decipher.setAuthTag(file.subarray(file.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(file.subarray(prefixEnd, file.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SecureCopyError("wrong_passphrase_or_tampered", "No se pudo descifrar: la frase de paso es otra o el archivo se modificó.");
  }
}

/**
 * Recuperación comprobada: descifra el archivo YA ESCRITO (no el que se tiene en memoria) y exige que su huella sea la del original. Nunca escribe el contenido.
 */
export function verifyEncrypted(file: Buffer, passphrase: string, expectedSha256?: string): { ok: true; plaintextSha256: string; plaintextBytes: number } {
  const plain = decryptBuffer(file, passphrase);
  const actual = sha256Hex(plain);
  if (expectedSha256 !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(expectedSha256) || !timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedSha256, "hex"))) {
      throw new SecureCopyError("hash_mismatch", "Lo recuperado NO coincide con la huella esperada.");
    }
  }
  return { ok: true, plaintextSha256: actual, plaintextBytes: plain.length };
}

// ── Rutas seguras: nunca dentro de un repositorio, nunca al lado de un .env ───────────────────────────────────────────

/** ¿Alguna carpeta de la ruta (o ella misma) es un repositorio de git o tiene un `.env` al lado? */
export function insideRepository(path: string): boolean {
  let dir = isAbsolute(path) ? path : resolve(path);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) dir = dirname(dir);
  for (;;) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".env"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Ruta absoluta de salida, validada: fuera de cualquier repositorio o proyecto, sin pisar un archivo existente. */
export function safeOutputPath(path: string, { allowOverwrite = false }: { allowOverwrite?: boolean } = {}): string {
  const absolute = resolve(path);
  if (absolute.split(sep).includes("..") || insideRepository(absolute)) {
    throw new SecureCopyError("unsafe_path", "La copia debe guardarse FUERA del repositorio y de cualquier carpeta de proyecto (por ejemplo, en una carpeta propia de tu usuario).");
  }
  if (!allowOverwrite && existsSync(absolute)) throw new SecureCopyError("exists", "Ya existe un archivo con ese nombre: no se pisa.");
  return absolute;
}

export const readFileForCopy = (path: string): Buffer => readFileSync(path);
