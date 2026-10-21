// Genera el código del teléfono a partir del MISMO plan y runner que se prueban en Node (lib/phone-extraction), adaptando sólo cómo se importan.
//   node tools/phone-extraction/build-mobile-patch.mjs
// Resultado: tools/phone-extraction/mobile-patch/src/features/transfer/phoneExtraction/{plan,runner,supabase-deps}.ts (no editar a mano: se regeneran).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "tools", "phone-extraction", "mobile-patch", "src", "features", "transfer", "phoneExtraction");
mkdirSync(out, { recursive: true });

const HEADER = "// GENERADO por tools/phone-extraction/build-mobile-patch.mjs a partir de lib/phone-extraction (web). No editar a mano.\n";
const read = (name) => readFileSync(join(root, "lib", "phone-extraction", name), "utf8").replace(/\r\n/g, "\n");

// Misma función que usa el adaptador del respaldo (lib/backup/mobile-adapter.ts, `stableHash`): una prueba comprueba que dan lo mismo.
const STABLE_HASH = `/** Hash FNV-1a de 32 bits (hexadecimal): idéntico al de lib/backup/mobile-adapter.ts (stableHash). */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
`;

let plan = read("plan.ts");
if (!plan.includes('import { stableHash } from "../backup/mobile-adapter.ts";\n')) throw new Error("plan.ts: no se encontró el import de stableHash");
plan = plan.replace('import { stableHash } from "../backup/mobile-adapter.ts";\n', STABLE_HASH);
writeFileSync(join(out, "plan.ts"), HEADER + plan);

let runner = read("runner.ts");
if (!runner.includes('from "./plan.ts"')) throw new Error("runner.ts: no se encontró el import de plan");
runner = runner.replace('from "./plan.ts"', "from './plan'").replace('from "./sniff.ts"', "from './sniff'");
writeFileSync(join(out, "runner.ts"), HEADER + runner);
writeFileSync(join(out, "sniff.ts"), HEADER + read("sniff.ts"));
let deps = read("supabase-deps.ts");
if (!deps.includes('from "./runner.ts"')) throw new Error("supabase-deps.ts: no se encontró el import de runner");
deps = deps.replace('from "./runner.ts"', "from './runner'");
writeFileSync(join(out, "supabase-deps.ts"), HEADER + deps);
console.log("código del teléfono generado en", out);
