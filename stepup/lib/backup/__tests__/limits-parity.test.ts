import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BACKUP_IMPORT_LIMITS } from "../limits.ts";

// R6: los límites por importación viven en la base (`public._import_limits()`) y se repiten en la web para rechazar ANTES de llamarla.
// Si alguien cambia uno sin el otro, esta prueba falla.

function readDbLimits(): Record<string, number> {
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20261010100000_r6_import_limits_and_helpers.sql"), "utf8");
  const block = sql.slice(sql.indexOf("create or replace function public._import_limits()"));
  const body = block.slice(block.indexOf("jsonb_build_object("), block.indexOf("$$;"));
  const limits: Record<string, number> = {};
  for (const match of body.matchAll(/'([a-z_]+)',\s*(\d+)/g)) limits[match[1]] = Number(match[2]);
  return limits;
}

test("los límites de la web son los mismos que `_import_limits()` en la base", () => {
  const db = readDbLimits();
  assert.deepEqual(db, {
    max_payload_bytes: BACKUP_IMPORT_LIMITS.MAX_PAYLOAD_BYTES,
    max_rows_per_collection: BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION,
    max_rows_total: BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL,
    max_nested_rows: BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS,
    max_work_units: BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS,
    max_field_overrides: BACKUP_IMPORT_LIMITS.MAX_FIELD_OVERRIDES,
    max_duplicate_decisions: BACKUP_IMPORT_LIMITS.MAX_DUPLICATE_DECISIONS,
  });
});

test("la unidad de trabajo es el techo real: ni las filas contadas ni las anidadas pueden pasar solas del máximo de trabajo", () => {
  assert.ok(BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL <= BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS);
  assert.ok(BACKUP_IMPORT_LIMITS.MAX_NESTED_ROWS <= BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS);
  assert.ok(BACKUP_IMPORT_LIMITS.MAX_ROWS_PER_COLLECTION <= BACKUP_IMPORT_LIMITS.MAX_ROWS_TOTAL);
});

test("R6: la página del asistente declara su tiempo máximo (la base corta a los 8 s y revierte todo; la plataforma no es la única defensa)", () => {
  const page = readFileSync(join(process.cwd(), "app", "(app)", "configuracion", "respaldo", "page.tsx"), "utf8");
  assert.match(page, /export const maxDuration = 60;/);
});
