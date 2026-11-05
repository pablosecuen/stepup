import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("selector estrecho: reserva siete objetivos de 44px y contiene el desplazamiento dentro del calendario", () => {
  const month = read("components/calendar/availability-month.tsx");
  assert.match(month, /min-w-\[332px\] grid-cols-7 gap-1/);
  assert.match(month, /max-w-full overflow-x-auto/);
  assert.match(month, /h-12 min-w-11 w-full/);
  assert.match(month, /aria-pressed=\{selected\}/);
  assert.match(month, /aria-busy=\{loading\}/);
  assert.match(month, /!disabled && !loading/);
});

test("la ayuda vive en Información; abrirla no descarta el formulario ni duplica la leyenda bajo el selector", () => {
  const picker = read("components/calendar/availability-picker.tsx");
  const info = read("app/(app)/calendario/informacion/page.tsx");
  assert.doesNotMatch(picker, /Referencias de colores|Amplia: más de 20|Gris: ocupado/);
  assert.match(picker, /href="\/calendario\/informacion#horarios-libres" target="_blank" rel="noopener noreferrer"/);
  assert.match(info, /id="horarios-libres"/);
  for (const label of ["Amplia disponibilidad", "Disponibilidad limitada", "Sin horarios libres", "Fecha seleccionada", "Mostrar :15 y :45", "duración completa"]) assert.ok(info.includes(label), label);
  assert.doesNotMatch(read("components/calendar/time-slot-grid.tsx"), /<p[^>]*>Tocá un horario/);
});

test("al navegar entre meses no se usan los colores ni los horarios calculados para el mes o la serie anteriores", () => {
  const picker = read("components/calendar/availability-picker.tsx");
  assert.match(picker, /loadedData\?\.month === month && loadedData\.recurrenceId === recurrenceId \? loadedData : null/);
  assert.match(picker, /setData\(\{ month, recurrenceId,/);
  assert.match(picker, /loading=\{!data\}/);
});
