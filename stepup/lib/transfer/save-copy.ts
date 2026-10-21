import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encryptDpapi, verifyDpapi } from "../secure-copy/dpapi-copy.ts";
import { safeOutputPath } from "../secure-copy/secure-copy.ts";
import { stampOf, type CopyReceipt } from "./orchestrator.ts";

/**
 * Copias cifradas con Windows DPAPI (se abren sólo con ESTE usuario de Windows en ESTE equipo): se escribe un archivo parcial, se comprueba la recuperación leyendo lo ESCRITO EN DISCO,
 * se lo mueve a su nombre final y se vuelve a comprobar. Cada copia tiene fecha, hora y etiqueta en el nombre y NUNCA pisa un archivo (ni lo borra): las copias anteriores se conservan.
 */
export function createDpapiSaver(folder: string, now: () => Date): (kind: "origin" | "destination", label: string, document: unknown) => CopyReceipt {
  return (kind, label, document) => {
    // Nombre con fecha, hora y etiqueta; si ya hay una copia con ese nombre (dos en el mismo segundo) se agrega un número: NUNCA se pisa.
    const base = `${kind === "origin" ? "origen" : "destino"}-${label}-${stampOf(now())}`;
    let n = 1;
    let name = `${base}.tfdp`;
    while (existsSync(join(folder, name))) name = `${base}-${(n += 1)}.tfdp`;
    const out = safeOutputPath(join(folder, name));
    const plain = Buffer.from(JSON.stringify(document), "utf8");
    const { file, plaintextSha256 } = encryptDpapi(plain);
    const partial = `${out}.parcial`;
    writeFileSync(partial, file, { mode: 0o600, flag: "wx" });
    verifyDpapi(readFileSync(partial), plaintextSha256);
    renameSync(partial, out);
    verifyDpapi(readFileSync(out), plaintextSha256);
    return { file: out, bytes: plain.length };
  };
}
