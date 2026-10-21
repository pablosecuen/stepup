// Compara la copia del ORIGEN con la del DESTINO (las dos cifradas, ver export-account.mjs). Descifra EN MEMORIA, no escribe nada y NO imprime valores: sólo
// identificadores de origen, nombres de campo y cantidades (nunca nombres, teléfonos, importes ni contenido).
//
//   node tools/transfer/compare-copies.mjs <copia-origen.tfsc> <copia-destino.tfsc>
//
// Veredicto «completo» sólo si no falta ninguna fila, ningún campo difiere, no quedan claves sin destino, el adaptador no dejó nada afuera y no hay archivos
// pendientes de extraer. Lo que sólo estuviera preservado en el archivo del origen se lista aparte y nunca cuenta como migrado.
import { readFileSync } from "node:fs";
import { SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";
import { openCopy } from "../../lib/secure-copy/open-copy.ts";
import { createPrompter } from "./prompt.mjs";
import { compareTransfer } from "../../lib/backup/transfer-compare.ts";
import { validateBackupPayload } from "../../lib/backup/validation.ts";

const [originPath, destinationPath] = process.argv.slice(2);
if (!originPath || !destinationPath) {
  console.error("Uso: compare-copies.mjs <copia-origen.tfsc> <copia-destino.tfsc>");
  process.exit(2);
}

const prompter = createPrompter();
const askHidden = (question) => prompter.ask(question, true);

const copyPassphrase = (() => {
  let cached;
  return async () => (cached ??= process.env.TF_COPY_PASSPHRASE || (await askHidden("Frase de paso de las copias: ")));
})(); // sólo se pide si alguna copia es de las que llevan frase (las nuevas, con DPAPI, se abren solas)

try {
  const origin = JSON.parse((await openCopy(readFileSync(originPath), copyPassphrase)).toString("utf8"));
  const destination = JSON.parse((await openCopy(readFileSync(destinationPath), copyPassphrase)).toString("utf8"));
  if (origin.kind !== "origin" || destination.kind !== "destination") throw new SecureCopyError("bad_format", "Las copias no son (origen, destino) en ese orden.");

  const validation = validateBackupPayload(origin.payload);
  const omitted = validation.adaptation?.omitted ?? [];
  const result = compareTransfer(origin.payload, destination.tables, { adapterOmitted: omitted });

  if (destination.unavailable?.length) console.log(`AVISO: el destino es del esquema ${destination.schema ?? "anterior"}: no existen todavía ${destination.unavailable.join(", ")} (no disponibles en esa versión). Una comparación contra ese volcado NO puede dar COMPLETO.`);
  console.log(`Origen: copia de la nube del ${origin.cloudBackup?.createdAt ?? "?"} · Destino: volcado del ${destination.takenAt}`);
  console.log(`Validación del respaldo: ${validation.ok ? "válido" : "NO válido"}${omitted.length ? ` · el adaptador dejó ${omitted.length} fila(s) sin importar` : ""}`);
  console.log("\nEntidades (origen → web):");
  for (const e of result.entities) console.log(`  ${e.ok ? "✓" : "✗"} ${e.entity.padEnd(36)} origen ${String(e.source).padStart(4)} · esperadas ${String(e.expected).padStart(4)} · en la web ${String(e.destination).padStart(4)}${e.missing.length ? `  FALTAN (ids): ${e.missing.slice(0, 5).join(", ")}${e.missing.length > 5 ? "…" : ""}` : ""}`);
  const bad = result.fields.filter((f) => f.mismatched > 0);
  console.log(`\nCampos comparados: ${result.summary.fieldChecks} · con diferencias: ${bad.length ? "" : "ninguno"}`);
  for (const f of bad) console.log(`  ✗ ${f.entity} · ${f.field}: ${f.mismatched} de ${f.checked}  ejemplos (id → huella origen / huella destino): ${f.examples.map((x) => `${x.id} → ${x.source} / ${x.destination}`).join(" · ")}`);
  console.log("\nCampos del origen sin destino:", result.undeclared.length ? result.undeclared.map((u) => `${u.entity}.${u.key} (${u.rows})${u.preservedInArchive ? " [sólo en el archivo]" : ""}`).join(", ") : "ninguno");
  console.log("Duplicados:", result.duplicates.length ? result.duplicates.map((d) => `${d.table}:${d.legacyId}×${d.count}`).join(", ") : "ninguno");
  console.log("\nArchivos (adjuntos, materiales, PDF de reportes):");
  for (const f of result.files) console.log(`  ${f.kind}: ${f.total} en total · ${f.available} disponibles · ${f.pending} pendientes · ${f.unavailableAtOrigin} ya no existían en el teléfono`);
  console.log(`\nVEREDICTO: ${result.verdict.complete ? "COMPLETO" : "NO COMPLETO"}${result.verdict.absentAtOrigin ? ` · con ${result.verdict.absentAtOrigin} archivo(s) que el teléfono YA NO tenía: declarados como ausentes, NO migrados` : ""}`);
  for (const reason of result.verdict.reasons) console.log(`  - ${reason}`);
  const rc = result.reconciliation;
  console.log(`Balance: origen ${rc.sourceRows} = omitidas ${rc.omittedByAdapter} + esperadas ${rc.expectedRows} · en el destino ${rc.foundRows} · pendientes ${rc.missingRows} · de más ${rc.extraRows} · ${rc.balanced && rc.expectedRows === rc.foundRows + rc.missingRows ? "CIERRA" : "NO CIERRA"}`);
  if (result.verdict.originInconsistencies > 0) {
    const byField = {};
    for (const d of result.originIncidents) byField[`${d.entity}.${d.field}`] = (byField[`${d.entity}.${d.field}`] ?? 0) + 1;
    console.log(`Inconsistencias del ORIGEN conservadas como incidencias (no son defectos del traslado): ${Object.entries(byField).map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  }
  if (!result.verdict.absentAtOriginVerified) console.log("Ausentes en el teléfono: NO COMPROBADO (todavía no se leyó el teléfono).");
  process.exitCode = result.verdict.complete ? 0 : 1;
} catch (error) {
  console.error(error instanceof SecureCopyError ? error.message : "No se pudo comparar las copias.");
  process.exitCode = 1;
} finally {
  prompter.close();
}
