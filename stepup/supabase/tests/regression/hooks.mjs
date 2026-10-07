import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.env.WEB_ROOT; // carpeta stepup del worktree

function probe(base) {
  for (const cand of [base, base + ".ts", base + ".mts", path.join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: new URL("./empty.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const file = probe(path.join(ROOT, specifier.slice(2)));
    if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    if (!path.extname(base) || ![".ts", ".mjs", ".js", ".cjs", ".json"].includes(path.extname(base))) {
      const file = probe(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
