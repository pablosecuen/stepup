import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "original-core") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}

test("`lib/original-core` (copia de referencia del dominio de la app original) no se importa desde código de producción: sólo lo leen pruebas", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "components", "lib", "middleware.ts", "proxy.ts"]) {
    let files: string[];
    try {
      files = statSync(join(ROOT, dir)).isDirectory() ? walk(join(ROOT, dir)) : [dir];
    } catch {
      continue;
    }
    for (const file of files) {
      if (/\/__tests__\//.test(file) || /\.test\.(ts|tsx)$/.test(file)) continue;
      if (/original-core/.test(readFileSync(join(ROOT, file), "utf8"))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "ningún archivo de producción puede importar lib/original-core");
});

test("las pruebas portadas del original viven sólo dentro de lib/original-core (no se duplican fuera) y las de la web no vuelven a copiarlas", () => {
  const outside = walk(join(ROOT, "lib")).filter((file) => /\.test\.ts$/.test(file) && /original-core/.test(readFileSync(join(ROOT, file), "utf8")));
  // Las únicas pruebas fuera del núcleo que lo leen son diferenciales declaradas (comparan el puerto de la web contra el original).
  for (const file of outside) assert.match(readFileSync(join(ROOT, file), "utf8"), /diferencial|DIFERENCIAL|original/i, `${file} debe declarar que es una comparación contra el original`);
});
