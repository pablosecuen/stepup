import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Rediseño visual v1 — Bloque 2: Inicio (docs/design/web-v1/). Sólo presentación: sin consultas, campos ni funciones nuevas. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const VIEW = "components/dashboard/home-view.tsx";

test("Inicio usa el diseño nuevo: sin el azul heredado ni los colores reservados del semáforo de cobro", () => {
  for (const file of [VIEW, "components/dashboard/first-steps.tsx", "components/dashboard/home-error.tsx"]) {
    assert.doesNotMatch(code(file), /brandBlue|statusVerde|statusRojo|statusAmarillo|statusNaranja|statusPendiente|pastelLavender|pastelSage/, file);
  }
});

test("Inicio no agrega consultas, campos ni funciones: la vista sólo lee lo que HomeData ya trae y no muestra nombres ni importes de cobros", () => {
  const view = code(VIEW);
  // Sólo campos que ya usaba o que HomeData ya cargaba para esta pantalla.
  for (const field of data(view)) assert.ok(ALLOWED_FIELDS.has(field), `campo no previsto: data.${field}`);
  assert.doesNotMatch(view, /collectionEntries|formatMoney|balance|amount|"use client"|useState|useEffect|fetch\(|supabase|\.rpc\(/);
  // Ni «Esta semana», «Mañana» ni un panel de notificaciones nuevo.
  assert.doesNotMatch(view, /Esta semana|Mañana|role="dialog"|aria-haspopup/);
  // Los cuatro accesos que ya existían siguen: campana → Recordatorios, Nueva clase, Series, Registro y Cobros.
  for (const href of ["/recordatorios", "/calendario/nueva", "/calendario/series", "/registro", "/cobros"]) assert.ok(view.includes(`"${href}"`), href);
});

test("Inicio: los textos de una clase no se truncan (se parten sin desbordar) y el estado se dice con texto", () => {
  const view = code(VIEW);
  assert.doesNotMatch(view, /\btruncate\b|text-ellipsis|line-clamp/, "una etiqueta como «Clase individual» nunca se corta con «…»");
  assert.match(view, /\[overflow-wrap:anywhere\]/, "los nombres y títulos largos se parten");
  assert.match(view, /\{live \? "En curso" : "Sigue"\}/, "En curso / Sigue con texto, no sólo color");
  assert.match(view, /sr-only">hasta </, "la hora de fin se lee «hasta»");
});

test("Inicio sigue sin loading.tsx (la recuperación B0 es un redirect HTTP real) y el error usa el componente propio", () => {
  assert.equal(existsSync(join(ROOT, "app/(app)/inicio/loading.tsx")), false);
  const page = code("app/(app)/inicio/page.tsx");
  assert.match(page, /redirect\(SESSION_RECOVERY_PATH\)/);
  assert.match(page, /<HomeLoadError\s+message=/);
  const error = code("components/dashboard/home-error.tsx");
  assert.match(error, /<h1 /, "el error tiene su título");
  assert.match(error, /Reintentar/);
  assert.match(error, /<ErrorState message=\{message\} \/>/);
});

const ALLOWED_FIELDS = new Set([
  "localHour", "todayDateKey", "todayLessons", "nextClass", "pendingLessons", "emptyClasses", "remindersSummary", "collectionsUrgency",
  "studentCount", "activeStudentCount",
]);

function data(source: string): string[] {
  return [...new Set([...source.matchAll(/\bdata\.([A-Za-z]+)/g)].map((m) => m[1]))];
}
