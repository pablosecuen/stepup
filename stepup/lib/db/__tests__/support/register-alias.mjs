// Sólo pruebas: permite importar los repositorios REALES con `node --test` — resuelve el alias `@/…` del proyecto, los
// imports relativos sin extensión y reemplaza `server-only` por un módulo vacío. No cambia ningún archivo de la app.
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

function pick(base) {
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const extension of EXTENSIONS) {
    const candidate = path.join(base, "index" + extension);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(ROOT, specifier.slice(2));
      const found = path.extname(base) ? base : pick(base);
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && !path.extname(specifier) && context.parentURL) {
      const found = pick(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
