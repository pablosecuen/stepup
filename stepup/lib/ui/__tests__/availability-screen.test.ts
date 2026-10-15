import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Pantalla Disponibilidad (corrección visual aprobada): contenedor que usa el ancho del shell, cierre con una X que lleva siempre a
 * `/calendario`, formularios que se reordenan solos y estado vacío compacto. Sin cambios de lógica, validaciones ni acciones.
 * (El comportamiento real — anchos medidos en 320, 390, 1366 y 1440 px, sin desbordes, Enter sobre la X — se verifica en el navegador.)
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const DIR = "app/(app)/calendario/disponibilidad";

test("la pantalla ya no tiene «Volver al Calendario» ni el marco angosto de formulario", () => {
  for (const file of [`${DIR}/page.tsx`, `${DIR}/availability-editor.tsx`, `${DIR}/availability-header.tsx`]) {
    const source = read(file);
    assert.doesNotMatch(source, /Volver al Calendario/, file);
    assert.doesNotMatch(source, /BackLink|FormPage|PAGE_WIDTH\.narrow/, file);
  }
});

test("una única acción «Cerrar Disponibilidad»: enlace a /calendario (nunca history.back), 44 × 44 px, anillo de foco y activable con Enter", () => {
  const header = code(`${DIR}/availability-header.tsx`);
  assert.equal((header.match(/aria-label="Cerrar Disponibilidad"/g) ?? []).length, 1, "una sola");
  assert.match(header, /<PrivateLink\s+href="\/calendario"/, "un enlace real: Enter lo activa como cualquier enlace");
  assert.doesNotMatch(header, /history\.back|router\.back|useRouter|onClick|window\.history/, "el destino es siempre Calendario");
  assert.match(header, /h-11 min-h-11 w-11 min-w-11/, "al menos 44 × 44 px");
  assert.match(header, /shrink-0/, "no se encoge ni queda tapada en móvil");
  assert.match(header, /focus-visible:ring-2 focus-visible:ring-ink/, "anillo de foco visible");
  assert.match(header, /<XMarkIcon className="h-5 w-5" aria-hidden \/>/, "una X (el nombre accesible lo da aria-label)");
  // esquina superior derecha: el título a la izquierda (puede encogerse) y la X al final de la misma fila
  assert.match(header, /flex items-start justify-between gap-3/);
  assert.match(header, /<div className="min-w-0">[\s\S]*<PageTitle>Disponibilidad<\/PageTitle>/);
  // ninguna otra pantalla ofrece «Cerrar Disponibilidad»
  assert.doesNotMatch(code(`${DIR}/page.tsx`), /Cerrar Disponibilidad/, "el nombre vive en el encabezado, no se duplica");
  assert.equal((code(`${DIR}/page.tsx`).match(/<AvailabilityHeader/g) ?? []).length, 2, "la pantalla normal y la de error (cada una con su única X)");
});

test("el contenedor aprovecha el ancho del shell (el de las listas), también en el estado de error", () => {
  const page = code(`${DIR}/page.tsx`);
  assert.equal((page.match(/className=\{PAGE_WIDTH\.wide\}/g) ?? []).length, 2);
  const widths = read("components/ui/page-header.tsx");
  assert.match(widths, /wide: "mx-auto w-full max-w-\[1180px\] px-4 py-5 nav:px-10/, "márgenes laterales razonables");
  assert.match(page, /<AvailabilityEditor initial=\{availability\} \/>/);
});

test("las tarjetas ocupan el ancho y los formularios se reparten solos (auto-fit de 170 px mínimo), sin columnas fijas que compriman campos", () => {
  const editor = code(`${DIR}/availability-editor.tsx`);
  assert.match(editor, /const FORM_GRID = "mt-4 grid grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,170px\),1fr\)\)\]/);
  assert.equal((editor.match(/className=\{FORM_GRID\}/g) ?? []).length, 2, "bloqueos y excepciones");
  assert.doesNotMatch(editor, /sm:grid-cols-|nav:grid-cols-|sm:col-span|nav:col-span/, "nada de cuatro columnas fijas en anchos medios");
  // los botones de enviar ocupan su celda (44 px de alto lo da Button) y los campos conservan su control original
  assert.equal((editor.match(/type="submit" variant="secondary" busy=\{pending\} className="w-full"/g) ?? []).length, 2);
  for (const field of ["weekday", "startTime", "endTime", "reason", "date", "endDate"]) assert.match(editor, new RegExp(`name="${field}"`), field);
  for (const label of ["Día", "Desde", "Hasta", "Motivo", "Hasta \\(opcional\\)"]) assert.match(editor, new RegExp(`<Field label="${label}"`), label);
});

test("estado vacío compacto: alineado a la izquierda, ~540 px como máximo en escritorio y fluido en móvil; las filas reales no lo heredan", () => {
  const editor = code(`${DIR}/availability-editor.tsx`);
  const empty = editor.slice(editor.indexOf("function EmptyNote"), editor.indexOf("function ListRow") > 0 ? editor.indexOf("function ListRow") : undefined);
  assert.match(empty, /<li className="w-full max-w-\[540px\] rounded-md border-2 border-dashed/, "fluido (w-full) hasta 540 px");
  const maxWidth = Number(/max-w-\[(\d+)px\]/.exec(empty)?.[1]);
  assert.ok(maxWidth >= 500 && maxWidth <= 560, `ancho máximo ${maxWidth}`);
  assert.doesNotMatch(empty, /mx-auto|text-center|justify-center/, "alineado a la izquierda");
  assert.match(editor, /<EmptyNote>Sin excepciones todavía\.<\/EmptyNote>/);
  assert.match(editor, /<EmptyNote>Sin bloqueos semanales todavía\.<\/EmptyNote>/);
  // la fila real (ListRow) y las listas no llevan el límite del estado vacío
  const row = editor.slice(editor.indexOf("function ListRow"), editor.indexOf("export function AvailabilityEditor"));
  assert.doesNotMatch(row, /max-w-/, "las filas con excepciones o bloqueos reales usan el ancho que necesitan");
  assert.match(row, /flex flex-wrap items-center justify-between/, "información a la izquierda y «Quitar» al otro extremo");
  assert.match(editor, /<ul className="mt-3 flex flex-col gap-2">/, "la lista ocupa todo el ancho de la tarjeta");
  assert.doesNotMatch(editor.replace(empty, ""), /max-w-\[540px\]/, "el límite vive sólo en el estado vacío");
});

test("la lógica no cambió: mismas acciones, validaciones y «Quitar»", () => {
  const editor = code(`${DIR}/availability-editor.tsx`);
  assert.match(editor, /saveAvailabilityAction\(next\)/);
  assert.match(editor, /guardNetwork\(/);
  assert.match(editor, /El horario de fin debe ser posterior al de inicio\./);
  assert.match(editor, /Elegí una fecha\./);
  assert.match(editor, /startTime >= endTime/);
  assert.match(editor, /<Button variant="dangerGhost" onClick=\{onRemove\} disabled=\{disabled\}>\s*Quitar\s*<\/Button>/);
  assert.match(editor, /removeWeeklyBlock\(block\.id\)/);
  assert.match(editor, /removeException\(exception\.id\)/);
  assert.doesNotMatch(code(`${DIR}/page.tsx`), /migration|rpc\(|supabase\.from/i);
});
