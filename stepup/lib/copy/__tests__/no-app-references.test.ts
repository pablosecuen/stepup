import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

/**
 * Ningún texto VISIBLE de la web presenta una aplicación («la app», «app móvil», «cómo te ve la app», «cómo trabajás con la app»…)
 * como producto existente: la web habla de TeacherFlow. La prohibición es sobre texto para la persona usuaria: los nombres técnicos
 * (carpeta `app/` de Next.js, rutas, identificadores, comentarios, pruebas) no cuentan. Recorre el JSX, los atributos y los
 * literales de texto de `app/`, `components/` y `lib/` (excepto pruebas y los tipos de la base).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        if (["__tests__", "node_modules", ".next", "testing", "original-core"].includes(entry)) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(ROOT, full).split(sep).join("/"));
    }
  };
  walk(join(ROOT, dir));
  return out;
}

const FILES = ["app", "components", "lib"].flatMap(sourceFiles).filter((file) => file !== "lib/db/database.types.ts");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Textos que una persona puede leer: JSX entre etiquetas y literales entre comillas o tildes con aspecto de frase. */
function visibleTexts(source: string): string[] {
  const clean = stripComments(source);
  const texts: string[] = [];
  for (const match of clean.matchAll(/>([^<>{}]+)</g)) texts.push(match[1]);
  for (const match of clean.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) texts.push(match[1] ?? match[2] ?? match[3] ?? "");
  return texts.map((text) => text.trim()).filter((text) => /\s/.test(text) || /[áéíóúñ¿¡]/.test(text));
}

/** Palabras sueltas «app» / «App» y variantes que nombran una aplicación o un celular. */
export const FORBIDDEN_VISIBLE = [/\bapps?\b/i, /aplicaci[óo]n(?:es)?\b/i, /\bm[óo]vil(?:es)?\b/i, /\bcelular(?:es)?\b/i, /\bsmartphone\b/i, /\bApp Store\b|\bGoogle Play\b/];

test("ningún texto visible menciona «la app», «app móvil», una aplicación o un celular", () => {
  assert.ok(FILES.length > 300, `se recorrieron ${FILES.length} archivos`);
  const offenders: string[] = [];
  for (const file of FILES) {
    for (const text of visibleTexts(readFileSync(join(ROOT, file), "utf8"))) {
      if (/^[@./]|^https?:|className|import |from "/.test(text)) continue; // rutas, clases y módulos
      if (FORBIDDEN_VISIBLE.some((pattern) => pattern.test(text))) offenders.push(`${file}: ${text.slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("las frases retiradas no vuelven (con las palabras exactas aprobadas para reemplazarlas)", () => {
  const removed = ["cómo te ve la app", "cómo trabajás con la app", "app móvil", "la app móvil", "tu app móvil", "Recuperar datos del respaldo de la app móvil"];
  const all = FILES.map((file) => visibleTexts(readFileSync(join(ROOT, file), "utf8")).join("\n")).join("\n").toLowerCase();
  for (const phrase of removed) assert.ok(!all.includes(phrase.toLowerCase()), `volvió «${phrase}»`);
  const configuration = stripComments(readFileSync(join(ROOT, "components/account/configuration-view.tsx"), "utf8"));
  assert.match(configuration, /Tus datos de acceso y cómo aparecés en TeacherFlow\./);
  assert.match(configuration, /Organizá cómo funciona TeacherFlow\./);
  assert.match(configuration, /Es el nombre que usa el saludo de Inicio\./);
});

test("el detector funciona: una frase prohibida se detecta y un nombre técnico no", () => {
  const sample = `<p>Mirá cómo te ve la app</p><p>{"Abrí la app móvil"}</p><a href="/app/ruta">ir</a><code>import x from "@/app/page"</code>`;
  const found = visibleTexts(sample).filter((text) => !/^[@./]|^https?:|className|import |from "/.test(text)).filter((text) => FORBIDDEN_VISIBLE.some((pattern) => pattern.test(text)));
  assert.deepEqual(found, ["Mirá cómo te ve la app", "Abrí la app móvil"]);
});
