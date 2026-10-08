import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/** B11 — cierre final de la web: guardas estructurales que no dependen de un bloque en particular. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function sources(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  for (const dir of dirs) walk(join(ROOT, dir));
  return out;
}

/** Etiquetas JSX de apertura completas; respeta llaves y comillas dentro de los atributos (y el `=>` de las flechas). */
function openingTags(source: string, name: string): Array<{ text: string; index: number }> {
  const result: Array<{ text: string; index: number }> = [];
  const re = new RegExp(`<${name}\\b`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = m.index; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (ch === quote && source[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0 && source[i - 1] !== "=") {
        result.push({ text: source.slice(m.index, i + 1), index: m.index });
        break;
      }
    }
  }
  return result;
}

const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

test("todo campo de formulario tiene un nombre accesible propio: aria-label, etiqueta envolvente o `id` con su `htmlFor` (un placeholder no alcanza)", () => {
  const offenders: string[] = [];
  for (const file of sources(["app", "components"])) {
    // components/ui/field.tsx DEFINE los envoltorios (reciben id/aria-* por props): lo que se verifica es cada USO.
    if (file === "components/ui/field.tsx") continue;
    const source = code(file);
    for (const name of ["input", "select", "textarea", "TextInput", "SelectInput", "TextArea"]) {
      for (const tag of openingTags(source, name)) {
        if (/type="hidden"/.test(tag.text)) continue;
        if (/aria-label=|aria-labelledby=/.test(tag.text)) continue;
        const before = source.slice(0, tag.index);
        if (before.lastIndexOf("<label") > before.lastIndexOf("</label>")) continue; // envuelto por su etiqueta
        const id = /\bid=(?:"([^"]+)"|\{([^}]+)\})/.exec(tag.text);
        if (id && /htmlFor=/.test(source)) continue;
        offenders.push(`${file}:${lineOf(source, tag.index)} <${name}>`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("cada página tiene su propio título de pestaña (sólo la portada usa el título general del sitio)", () => {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const full = join(dir, entry);
      if (statSync(join(ROOT, full)).isDirectory()) walk(full);
      else if (entry === "page.tsx") pages.push(full.split(sep).join("/"));
    }
  };
  walk("app");
  assert.ok(pages.length >= 20, "se encontraron las páginas");
  const without = pages.filter((file) => !/export const metadata\b|export (async )?function generateMetadata/.test(read(file)));
  assert.deepEqual(without, ["app/page.tsx"]);
  assert.match(code("app/(app)/alumnos/[id]/page.tsx"), /export const metadata = \{ title: "Perfil del alumno · TeacherFlow" \};/);
});
