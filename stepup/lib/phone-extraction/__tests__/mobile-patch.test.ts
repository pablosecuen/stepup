import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildExtractionPlan, DEVICE_LOCAL_KEYS, KEYS } from "../plan.ts";
import { buildMobileBackup, buildPhoneExtraction } from "../../backup/__fixtures__/mobile-real-shape.ts";

/**
 * El código que corre en el teléfono (tools/phone-extraction/mobile-patch) se GENERA a partir del mismo plan y runner que se prueban acá. Estas pruebas
 * cuidan que no se desfasen y que el parche siga siendo NO destructivo (sólo lectura del teléfono + subida de copias a la cuenta).
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PATCH = join(ROOT, "tools", "phone-extraction", "mobile-patch");
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

test("el código generado para el teléfono está al día con lib/phone-extraction (si falla: node tools/phone-extraction/build-mobile-patch.mjs)", () => {
  const generated = read(join(PATCH, "src", "features", "transfer", "phoneExtraction", "runner.ts"));
  const source = read(join(ROOT, "lib", "phone-extraction", "runner.ts")).replace('from "./plan.ts"', "from './plan'").replace('from "./sniff.ts"', "from './sniff'");
  assert.equal(generated, "// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.\n" + source);
  const depsGenerated = read(join(PATCH, "src", "features", "transfer", "phoneExtraction", "supabase-deps.ts"));
  const depsSource = read(join(ROOT, "lib", "phone-extraction", "supabase-deps.ts")).replace('from "./runner.ts"', "from './runner'");
  assert.equal(depsGenerated, "// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.\n" + depsSource);
  const plan = read(join(PATCH, "src", "features", "transfer", "phoneExtraction", "plan.ts"));
  const planSource = read(join(ROOT, "lib", "phone-extraction", "plan.ts"));
  assert.ok(plan.startsWith("// GENERADO por"));
  assert.equal(/^import .*from/m.test(plan), false, "el plan del teléfono no importa nada de la web");
  assert.ok(planSource.includes('from "../backup/mobile-adapter.ts"'));
});

test("el plan generado para el teléfono arma EXACTAMENTE la misma lista que el de la web (mismo hash, mismos identificadores)", async () => {
  const mobile = (await import(join(PATCH, "src", "features", "transfer", "phoneExtraction", "plan.ts").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"))) as typeof import("../plan.ts");
  const source = buildMobileBackup();
  const phone = buildPhoneExtraction() as unknown as { materials: unknown[]; deviceLocal: Record<string, string> };
  // un adjunto sin identificador propio obliga a usar el hash determinístico
  const lessons = JSON.parse(JSON.stringify(source.pedagogicalLessons)) as Array<{ form: { activityAttachments: Array<Record<string, unknown>> } }>;
  delete lessons[0].form.activityAttachments[0].id;
  const snapshot = {
    lessonsRaw: JSON.stringify(lessons),
    reportsRaw: JSON.stringify(source.reportRecords),
    materialsRaw: JSON.stringify(phone.materials),
    deviceLocal: Object.fromEntries(DEVICE_LOCAL_KEYS.map((k) => [k, phone.deviceLocal[k] ?? null])),
  };
  assert.deepEqual(mobile.buildExtractionPlan(snapshot), buildExtractionPlan(snapshot));
  assert.match(buildExtractionPlan(snapshot).items[0].legacyId, /^les-1:att_[0-9a-f]{8}$/);
  assert.equal(mobile.KEYS.lessons, KEYS.lessons);
});

test("el parche es NO destructivo: ninguna operación de borrar, mover, renombrar ni escribir en el teléfono", () => {
  const forbidden = /\.(delete|move|rename|copy|write|writeSync|truncate)\s*\(|new Directory|removeItem|multiRemove|setItem|multiSet|clear\s*\(|unlink|deleteAsync|moveAsync|copyAsync|writeAsStringAsync|makeDirectoryAsync|\.remove\s*\(|\.update\s*\(|\.insert\s*\(|\.delete\s*\(\)/;
  for (const file of walk(PATCH).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const lines = read(file).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"));
    for (const line of lines) assert.equal(forbidden.test(line), false, `${file}: ${line.trim()}`);
  }
});

test("el parche sólo habla con la cuenta por las funciones previstas y sube COPIAS sin pisar (upsert apagado)", () => {
  const deps = read(join(PATCH, "src", "features", "transfer", "phoneExtraction", "supabase-deps.ts")) + read(join(PATCH, "src", "features", "transfer", "phoneExtractionDeps.ts"));
  assert.match(deps, /upsert: false/);
  assert.doesNotMatch(deps, /service_role|SERVICE_ROLE|\.auth\.(signOut|updateUser|signIn)/);
  const runner = read(join(ROOT, "lib", "phone-extraction", "runner.ts"));
  const rpcNames = [...runner.matchAll(/deps\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(rpcNames)], ["import_phone_extraction", "mark_transfer_file_unavailable", "record_phone_extraction_result", "register_transfer_file"]);
});

test("la pantalla siempre renderiza su Modal (sólo cambia lo de adentro) y muestra únicamente cantidades", () => {
  const screen = read(join(PATCH, "src", "features", "transfer", "PhoneTransferEntry.tsx"));
  assert.match(screen, /<Modal visible=\{open\}/);
  assert.doesNotMatch(screen, /if \(!open\) return null|return null/);
  assert.doesNotMatch(screen, /\.name\b|\.uri\b|legacyId|missingAtOrigin\.map/, "nunca nombres ni rutas en pantalla");
});
