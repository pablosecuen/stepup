// «Demanda semanal y horaria» mide lo que necesita su contenido (29/10/2026). Causa del hueco: estaba en una grilla de dos columnas con las filas estiradas (alineación por defecto, `stretch`)
// junto a «Valor programado de tu hora», que es mucho más alta (una fila por nivel): la tarjeta corta se estiraba hasta la altura de su vecina. La medición real (375/390/430/1366 px) está en la entrega.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const view = readFileSync(join(ROOT, "components/finance/financial-overview-view.tsx"), "utf8").replace(/\r\n/g, "\n");

test("las cuatro tarjetas inferiores van en dos columnas independientes (apiladas), sin filas compartidas que estiren a ninguna", () => {
  assert.match(view, /<div className="mt-5 flex flex-col gap-5 min-\[1100px\]:grid min-\[1100px\]:grid-cols-2 min-\[1100px\]:items-start">/);
  const columns = view.match(/<div className="flex min-w-0 flex-col gap-5">/g) ?? [];
  assert.equal(columns.length, 2, "dos columnas");
  const order = ["hora-titulo", "anual-titulo", "demanda-titulo", "alumnos-titulo"].map((id) => view.indexOf(`<section aria-labelledby="${id}"`));
  assert.ok(order.every((index) => index > 0) && order.join() === [...order].sort((a, b) => a - b).join(), "mismo orden de lectura en móvil (una columna) y en escritorio (columna izquierda y luego derecha)");
  const secondColumn = view.indexOf('<div className="flex min-w-0 flex-col gap-5">', view.indexOf('<div className="flex min-w-0 flex-col gap-5">') + 1);
  assert.ok(view.indexOf('aria-labelledby="demanda-titulo"') > secondColumn && view.indexOf('aria-labelledby="alumnos-titulo"') > view.indexOf('aria-labelledby="demanda-titulo"'), "«Alumnos del año» empieza justo debajo de la demanda");
  const card = /const CARD = "([^"]*)"/.exec(view)![1];
  assert.doesNotMatch(card, /\bh-|min-h|max-h/, "la tarjeta no fija su altura");
  const rows = view.slice(view.indexOf("Dos columnas independientes"), view.indexOf('<section aria-labelledby="hora-titulo"'));
  assert.doesNotMatch(rows, /\bh-|min-h|row-span|grid-rows|auto-rows|items-stretch/, "ni la grilla ni las columnas fijan alturas o filas compartidas");
  // la demanda no pierde ningún dato
  for (const piece of ["Demanda semanal y horaria", "Últimos 90 días, del", "Día más demandado", "Días más demandados (empate)", "Horarios más demandados (con empates)", "ocupadas", "clase(s)", "de la demanda semanal"]) {
    assert.ok(view.includes(piece) || view.includes(piece.replace(/ \(.*\)/, "")), piece);
  }
});
