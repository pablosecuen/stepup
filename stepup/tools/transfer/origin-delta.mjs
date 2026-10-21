// ¿Qué se cargó en Expo Go DESPUÉS de la copia que se usó para importar? Compara dos copias cifradas del ORIGEN (ver export-account.mjs origin) y lista, por colección e
// identificador, lo agregado, cambiado o quitado. Descifra en memoria, no escribe nada y NO imprime valores: sólo ids y nombres de campo.
//
//   node tools/transfer/origin-delta.mjs <origen-usado-para-importar.tfsc> <origen-mas-reciente.tfsc>
//
// Sale con 0 si no hay diferencias y con 1 si hay algo para incorporar antes de cerrar el traslado.
import { readFileSync } from "node:fs";
import { SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";
import { openCopy } from "../../lib/secure-copy/open-copy.ts";
import { createPrompter } from "./prompt.mjs";
import { diffOrigins } from "../../lib/transfer/origin-delta.ts";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("Uso: origin-delta.mjs <origen-usado.tfsc> <origen-mas-reciente.tfsc>");
  process.exit(2);
}

const prompter = createPrompter();
const askHidden = (question) => prompter.ask(question, true);

const copyPassphrase = (() => {
  let cached;
  return async () => (cached ??= process.env.TF_COPY_PASSPHRASE || (await askHidden("Frase de paso de las copias: ")));
})(); // sólo se pide si alguna copia es de las que llevan frase (las nuevas, con DPAPI, se abren solas)

try {
  const load = async (path) => JSON.parse((await openCopy(readFileSync(path), copyPassphrase)).toString("utf8"));
  const before = await load(beforePath);
  const after = await load(afterPath);
  if (before.kind !== "origin" || after.kind !== "origin") throw new SecureCopyError("bad_format", "Las dos copias tienen que ser del ORIGEN.");
  console.log(`Copia usada: nube del ${before.cloudBackup?.createdAt ?? "?"} · Copia más reciente: nube del ${after.cloudBackup?.createdAt ?? "?"}`);
  if (before.cloudBackup?.checksum && before.cloudBackup.checksum === after.cloudBackup?.checksum) console.log("Es el MISMO respaldo (misma huella): no hay nada nuevo.");

  const delta = diffOrigins(before.payload, after.payload);
  for (const c of delta.collections) {
    if (!c.added.length && !c.removed.length && !c.changed.length && c.withoutId.before === c.withoutId.after) continue;
    console.log(`\n${c.collection}:`);
    if (c.added.length) console.log(`  + nuevos (${c.added.length}): ${c.added.slice(0, 20).join(", ")}${c.added.length > 20 ? "…" : ""}`);
    if (c.changed.length) console.log(`  ~ cambiados (${c.changed.length}): ${c.changed.slice(0, 20).map((x) => `${x.id} [${x.fields.join(",")}]`).join(" · ")}${c.changed.length > 20 ? "…" : ""}`);
    if (c.removed.length) console.log(`  - que ya no están (${c.removed.length}): ${c.removed.slice(0, 20).join(", ")}${c.removed.length > 20 ? "…" : ""}`);
    if (c.withoutId.before !== c.withoutId.after) console.log(`  ? elementos sin identificador: ${c.withoutId.before} → ${c.withoutId.after}`);
  }
  for (const s of delta.singletons.filter((x) => x.changed)) console.log(`\n${s.name}: cambió [${s.fields.join(",")}]`);
  console.log(`\nRESULTADO: ${delta.hasChanges ? `HAY ${delta.totals.added} nuevos, ${delta.totals.changed} cambiados, ${delta.totals.removed} quitados: incorporarlos antes de cerrar el traslado (nueva copia → nueva importación → nuevo cotejo)` : "SIN DIFERENCIAS: la copia usada es la última"}`);
  process.exitCode = delta.hasChanges ? 1 : 0;
} catch (error) {
  console.error(error instanceof SecureCopyError ? error.message : "No se pudo comparar las copias.");
  process.exitCode = 1;
} finally {
  prompter.close();
}
