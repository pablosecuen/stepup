import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptBuffer, encryptBuffer, insideRepository, safeOutputPath, SecureCopyError, sha256Hex, verifyEncrypted } from "../secure-copy.ts";

// Costo bajo de scrypt para que las pruebas sean rápidas (el valor real es N=2^15, ver DEFAULT_SCRYPT).
const FAST = { N: 1 << 10, r: 8, p: 1 };
const PASS = "una frase de paso larga y unica";
const SECRET = JSON.stringify({ students: [{ name: "ZQ Persona Sintética", phone: "+54 9 11 5550-0001" }], payments: [{ amount: 41000.37 }] });

test("cifrar y recuperar da el mismo contenido (byte por byte) y la misma huella", () => {
  const { file, plaintextSha256, plaintextBytes } = encryptBuffer(Buffer.from(SECRET), PASS, FAST);
  assert.equal(plaintextBytes, Buffer.byteLength(SECRET));
  assert.equal(decryptBuffer(file, PASS).toString("utf8"), SECRET);
  assert.deepEqual(verifyEncrypted(file, PASS, plaintextSha256), { ok: true, plaintextSha256, plaintextBytes });
  assert.equal(plaintextSha256, sha256Hex(Buffer.from(SECRET)));
});

test("el archivo cifrado no contiene NADA del contenido en claro (ni nombres, ni teléfonos, ni importes, ni trozos)", () => {
  const { file } = encryptBuffer(Buffer.from(SECRET.repeat(50)), PASS, FAST);
  const text = file.toString("latin1");
  for (const piece of ["ZQ Persona", "5550-0001", "41000", "students", "payments", "name"]) assert.equal(text.includes(piece), false, piece);
});

test("dos cifrados del mismo contenido no se parecen (sal e IV aleatorios por archivo)", () => {
  const a = encryptBuffer(Buffer.from(SECRET), PASS, FAST).file;
  const b = encryptBuffer(Buffer.from(SECRET), PASS, FAST).file;
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a.subarray(-40), b.subarray(-40));
});

test("otra frase de paso NO descifra, y cualquier byte alterado (encabezado, contenido o etiqueta) tampoco", () => {
  const { file } = encryptBuffer(Buffer.from(SECRET), PASS, FAST);
  assert.throws(() => decryptBuffer(file, "otra frase de paso distinta"), (e: unknown) => e instanceof SecureCopyError && e.code === "wrong_passphrase_or_tampered");
  for (const position of [8, 40, 120, file.length - 20, file.length - 1]) {
    const tampered = Buffer.from(file);
    tampered[position] ^= 0x01;
    assert.throws(() => decryptBuffer(tampered, PASS), SecureCopyError, `byte ${position}`);
  }
  assert.throws(() => decryptBuffer(file.subarray(0, file.length - 5), PASS), SecureCopyError, "truncado");
  assert.throws(() => decryptBuffer(Buffer.from("no es una copia"), PASS), (e: unknown) => e instanceof SecureCopyError && e.code === "bad_format");
});

test("la verificación de recuperación exige la huella esperada: una huella distinta falla", () => {
  const { file, plaintextSha256 } = encryptBuffer(Buffer.from(SECRET), PASS, FAST);
  assert.throws(() => verifyEncrypted(file, PASS, "0".repeat(64)), (e: unknown) => e instanceof SecureCopyError && e.code === "hash_mismatch");
  assert.throws(() => verifyEncrypted(file, PASS, "corta"), (e: unknown) => e instanceof SecureCopyError && e.code === "hash_mismatch");
  assert.equal(verifyEncrypted(file, PASS, plaintextSha256.toUpperCase()).ok, true);
});

test("una frase de paso corta se rechaza antes de cifrar", () => {
  assert.throws(() => encryptBuffer(Buffer.from(SECRET), "corta", FAST), (e: unknown) => e instanceof SecureCopyError && e.code === "weak_passphrase");
});

test("un encabezado hostil no puede pedir un costo desmedido de memoria o tiempo", () => {
  const { file } = encryptBuffer(Buffer.from(SECRET), PASS, FAST);
  const text = file.toString("latin1");
  const hostile = Buffer.from(text.replace('"N":1024', '"N":999999999'), "latin1");
  assert.throws(() => decryptBuffer(hostile, PASS), (e: unknown) => e instanceof SecureCopyError && e.code === "bad_format");
});

test("las copias sólo se guardan FUERA de un repositorio y sin pisar archivos existentes", () => {
  const base = mkdtempSync(join(tmpdir(), "tf-secure-"));
  try {
    const repo = join(base, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "docs"));
    mkdirSync(join(base, "copias"));
    mkdirSync(join(base, "proyecto"));
    writeFileSync(join(base, "proyecto", ".env"), "X=1");
    assert.equal(insideRepository(join(repo, "docs", "copia.tfsc")), true);
    assert.throws(() => safeOutputPath(join(repo, "docs", "copia.tfsc")), (e: unknown) => e instanceof SecureCopyError && e.code === "unsafe_path");
    assert.throws(() => safeOutputPath(join(base, "proyecto", "copia.tfsc")), (e: unknown) => e instanceof SecureCopyError && e.code === "unsafe_path", "al lado de un .env");
    assert.equal(safeOutputPath(join(base, "copias", "copia.tfsc")), join(base, "copias", "copia.tfsc"));
    writeFileSync(join(base, "copias", "existe.tfsc"), "x");
    assert.throws(() => safeOutputPath(join(base, "copias", "existe.tfsc")), (e: unknown) => e instanceof SecureCopyError && e.code === "exists");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("la herramienta de línea de comandos: cifra, comprueba la recuperación en disco, verifica y descifra; nunca imprime el contenido", () => {
  const base = mkdtempSync(join(tmpdir(), "tf-secure-cli-"));
  try {
    const plain = join(base, "respaldo.json");
    const copy = join(base, "copia.tfsc");
    const back = join(base, "recuperado.json");
    writeFileSync(plain, SECRET);
    const cli = join(import.meta.dirname, "..", "..", "..", "tools", "secure-copy", "secure-copy.mjs");
    const env = { ...process.env, TF_COPY_PASSPHRASE: PASS };
    const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });

    const enc = run("encrypt", plain, copy);
    assert.equal(enc.status, 0, enc.stderr);
    const sha = sha256Hex(Buffer.from(SECRET));
    assert.match(enc.stdout, new RegExp(`huella ${sha}`));
    assert.equal(existsSync(`${copy}.parcial`), false, "el archivo parcial ya no está");
    assert.equal(readFileSync(copy).toString("latin1").includes("ZQ Persona"), false);
    for (const text of [enc.stdout, enc.stderr]) for (const secret of ["ZQ Persona", "5550-0001", "41000"]) assert.equal(text.includes(secret), false, secret);

    const ver = run("verify", copy, sha);
    assert.equal(ver.status, 0, ver.stderr);
    assert.match(ver.stdout, /Recuperación comprobada/);
    assert.equal(run("verify", copy, "0".repeat(64)).status, 1);
    assert.equal(spawnSync(process.execPath, [cli, "verify", copy], { env: { ...process.env, TF_COPY_PASSPHRASE: "otra frase de paso larga" }, encoding: "utf8" }).status, 1);

    const dec = run("decrypt", copy, back);
    assert.equal(dec.status, 0, dec.stderr);
    assert.equal(readFileSync(back, "utf8"), SECRET);
    assert.equal(run("decrypt", copy, back).status, 1, "no pisa un archivo existente");
    assert.equal(run("encrypt", plain, copy).status, 1, "tampoco una copia existente");

    const repo = join(base, "repo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    assert.equal(run("encrypt", plain, join(repo, "copia.tfsc")).status, 1, "no escribe dentro de un repositorio");
    assert.equal(spawnSync(process.execPath, [cli, "encrypt", plain, join(base, "sin-frase.tfsc")], { env: { ...process.env, TF_COPY_PASSPHRASE: "" }, encoding: "utf8", input: "" }).status, 1, "sin frase de paso no cifra");
    void execFileSync;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
