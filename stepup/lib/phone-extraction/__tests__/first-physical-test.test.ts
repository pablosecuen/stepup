import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Primera prueba física en el teléfono: sólo lectura. El cambio exacto a la app y lo que la pantalla ofrece. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const PATCH = join(ROOT, "tools", "phone-extraction", "mobile-patch");

test("la primera prueba física sólo ofrece «Revisar sin copiar»: la copia está apagada y la revisión no usa la cuenta", () => {
  const screen = read(join(PATCH, "src", "features", "transfer", "PhoneTransferEntry.tsx"));
  assert.match(screen, /const COPY_ENABLED = false;/);
  assert.match(screen, /\{COPY_ENABLED && \(/, "los botones de copiar sólo aparecen con el interruptor encendido");
  assert.match(screen, /0\. Revisar sin copiar/);
  const review = screen.slice(screen.indexOf("async function review()"), screen.indexOf("async function run("));
  assert.match(review, /inspectPhoneFiles\(createPhoneReadDeps\(\)\)/, "sólo lectura del teléfono: ni siquiera pide la cuenta");
  assert.doesNotMatch(review, /runPhoneExtraction|upload|rpc|createPhoneExtractionDeps/, "la revisión no sube ni registra nada");
  assert.match(screen, /__tfReview = \(\) => inspectPhoneFiles\(createPhoneReadDeps\(\)\)/, "gancho de revisión para el depurador");
  assert.doesNotMatch(screen, /__tfCopy|globalThis[^\n]*runPhoneExtraction/, "la copia no tiene gancho");
  const deps = read(join(PATCH, "src", "features", "transfer", "phoneExtractionDeps.ts"));
  const readDeps = deps.slice(deps.indexOf("export function createPhoneReadDeps"), deps.indexOf("export function createPhoneExtractionDeps"));
  assert.doesNotMatch(readDeps, /supabase|getSupabaseClient|upload|rpc|fetch/i, "las dependencias de lectura no usan la cuenta ni la red");
  const runner = read(join(ROOT, "lib", "phone-extraction", "runner.ts"));
  const inspect = runner.slice(runner.indexOf("export async function inspectPhoneFiles"));
  assert.doesNotMatch(inspect, /deps\.(rpc|upload|listReports)/, "la revisión no habla con la cuenta");
});

test("el cambio exacto a la app son DOS líneas agregadas en BackupScreen.tsx (un import y la entrada), sin quitar ni cambiar ninguna existente", () => {
  const diff = read(join(ROOT, "tools", "phone-extraction", "BackupScreen.cambio.diff"));
  const lines = diff.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1).trim());
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
  assert.deepEqual(added, ["import { PhoneTransferEntry } from '../transfer/PhoneTransferEntry';", "<PhoneTransferEntry />"]);
  assert.deepEqual(removed, []);
  assert.match(diff, /a\/src\/features\/backup\/BackupScreen\.tsx/);
});

test("el parche incluye el reconocimiento del formato real y los tres archivos generados están al día", () => {
  const generated = read(join(PATCH, "src", "features", "transfer", "phoneExtraction", "sniff.ts"));
  const source = read(join(ROOT, "lib", "phone-extraction", "sniff.ts"));
  assert.equal(generated, "// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.\n" + source);
  assert.equal(/^import .*from/m.test(source), false, "el reconocimiento de formato no depende de nada: viaja tal cual al teléfono");
});

test("la huella SHA-256 se calcula sobre el Uint8Array (expo-crypto en el teléfono NO acepta un ArrayBuffer: «The 3rd argument cannot be cast»)", () => {
  const deps = read(join(PATCH, "src", "features", "transfer", "phoneExtractionDeps.ts"));
  assert.match(deps, /Crypto\.digest\(Crypto\.CryptoDigestAlgorithm\.SHA256, bytes as unknown as BufferSource\)/);
  assert.doesNotMatch(deps.slice(deps.indexOf("sha256Hex")), /toArrayBuffer/, "la huella no recibe un ArrayBuffer");
});
