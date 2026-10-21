import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decryptDpapi, encryptDpapi, isDpapiCopy, verifyDpapi } from "../dpapi-copy.ts";
import { encryptBuffer } from "../secure-copy.ts";
import { openCopy } from "../open-copy.ts";

/** Copias cifradas con Windows DPAPI (usuario actual), sin frase manual. Datos sintéticos. */

const win = process.platform === "win32";
const SECRET = JSON.stringify({ kind: "origin", payload: { alumno: "ZQ Alumna Ficticia", telefono: "+54 9 11 5550-0001" } });

test("DPAPI: cifra, el archivo no contiene nada en claro y se recupera idéntico (huella)", { skip: !win }, () => {
  const { file, plaintextSha256, plaintextBytes } = encryptDpapi(Buffer.from(SECRET));
  assert.equal(isDpapiCopy(file), true);
  assert.equal(file.includes(Buffer.from("ZQ Alumna")), false);
  assert.equal(file.includes(Buffer.from("5550")), false);
  assert.equal(plaintextBytes, Buffer.byteLength(SECRET));
  assert.equal(decryptDpapi(file).toString("utf8"), SECRET);
  assert.deepEqual(verifyDpapi(file, plaintextSha256), { ok: true, plaintextSha256, plaintextBytes });
});

test("DPAPI: cada copia lleva su propia clave aleatoria; alterar cualquier byte o la huella esperada falla", { skip: !win }, () => {
  const a = encryptDpapi(Buffer.from(SECRET));
  const b = encryptDpapi(Buffer.from(SECRET));
  assert.notDeepEqual(a.file, b.file);
  for (const index of [3, 20, 60, a.file.length - 5, a.file.length - 1]) {
    const tampered = Buffer.from(a.file);
    tampered[index] ^= 0xff;
    assert.throws(() => decryptDpapi(tampered), Error, `byte ${index}`);
  }
  assert.throws(() => verifyDpapi(a.file, "0".repeat(64)), /NO coincide/);
  assert.throws(() => decryptDpapi(a.file.subarray(0, 40)), /no es una copia/);
});

test("DPAPI: una clave envuelta que Windows no puede abrir (otro usuario/equipo) da un mensaje claro, sin detalles", { skip: !win }, () => {
  const { file } = encryptDpapi(Buffer.from(SECRET));
  const headerLength = file.readUInt32BE(6);
  const header = JSON.parse(file.subarray(10, 10 + headerLength).toString("utf8"));
  const wrapped = Buffer.from(header.wrappedKey, "base64");
  wrapped[wrapped.length - 3] ^= 0xff; // como si la hubiera envuelto otra cuenta
  header.wrappedKey = wrapped.toString("base64");
  const newHeader = Buffer.from(JSON.stringify(header));
  const prefix = Buffer.concat([file.subarray(0, 6), Buffer.from([0, 0, 0, 0]), newHeader]);
  prefix.writeUInt32BE(newHeader.length, 6);
  const forged = Buffer.concat([prefix, file.subarray(10 + headerLength)]);
  assert.throws(() => decryptDpapi(forged), /otro usuario u otro equipo|se modificó/);
});

test("openCopy: una copia DPAPI no pide frase; una copia con frase (anterior) la pide y se sigue abriendo", { skip: !win }, async () => {
  let asked = 0;
  const ask = async () => {
    asked += 1;
    return "frase de paso larga de prueba";
  };
  const dpapi = encryptDpapi(Buffer.from(SECRET)).file;
  assert.equal((await openCopy(dpapi, ask)).toString("utf8"), SECRET);
  assert.equal(asked, 0);
  const legacy = encryptBuffer(Buffer.from(SECRET), "frase de paso larga de prueba", { N: 1 << 10, r: 8, p: 1 }).file;
  assert.equal((await openCopy(legacy, ask)).toString("utf8"), SECRET);
  assert.equal(asked, 1);
});

test("DPAPI: nada secreto por argumentos ni a disco; el script de PowerShell es fijo", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "dpapi-copy.ts"), "utf8");
  assert.match(source, /input: data\.toString\("base64"\)/, "los datos viajan por la entrada estándar");
  assert.doesNotMatch(source, /writeFileSync|appendFileSync|console\./, "no escribe a disco ni a registros");
  assert.match(source, /CurrentUser/);
});
