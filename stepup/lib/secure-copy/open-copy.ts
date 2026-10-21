import { decryptBuffer } from "./secure-copy.ts";
import { decryptDpapi, isDpapiCopy } from "./dpapi-copy.ts";

/**
 * Abre una copia del traslado en memoria, sea cual sea su tipo: las nuevas (DPAPI, sin frase) se abren solas con el usuario de Windows; las anteriores (con frase de paso)
 * piden la frase sólo si hace falta. `askPassphrase` nunca se llama para una copia DPAPI.
 */
export async function openCopy(file: Buffer, askPassphrase: () => Promise<string>): Promise<Buffer> {
  if (isDpapiCopy(file)) return decryptDpapi(file);
  return decryptBuffer(file, await askPassphrase());
}
