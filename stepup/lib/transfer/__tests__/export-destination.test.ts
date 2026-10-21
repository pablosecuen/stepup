import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyReadError, exportDestination, ExportAbortError, isMissingTableError, TABLES_ADDED_BY_TRANSFER_MIGRATIONS } from "../export-destination.ts";
import { DESTINATION_TABLES } from "../../backup/transfer-compare.ts";
import type { ReadClient } from "../../db/read.ts";

type Row = Record<string, unknown>;
const OWNER = "00000000-0000-4000-8000-0000000000aa";

/** PostgREST de mentira: cada tabla responde con filas, o con el error que se le asigne. El filtro de cuenta se aplica de verdad. */
function fakeClient(data: Record<string, Row[]>, errors: Record<string, unknown> = {}): ReadClient & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    rpc: () => {
      throw new Error("no se usa");
    },
    from(table: string) {
      return {
        select() {
          reads.push(table);
          let owner: string | null = null;
          const q: Record<string, unknown> = {
            eq(_c: string, v: string) {
              owner = v;
              return q;
            },
            order: () => q,
            limit: () => q,
            or: () => q,
            gt: () => q,
            lt: () => q,
            then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
              if (table in errors) {
                const e = errors[table];
                if (e instanceof Error) return Promise.reject(e).then(resolve, reject);
                return Promise.resolve({ data: null, error: e, count: null }).then(resolve, reject);
              }
              const rows = (data[table] ?? []).filter((r) => owner === null || r.owner_id === owner);
              return Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve, reject);
            },
          };
          return q;
        },
      };
    },
  } as unknown as ReadClient & { reads: string[] };
}

const everything = (): Record<string, Row[]> => Object.fromEntries(DESTINATION_TABLES.map((t) => [t, [{ id: `${t}-1`, owner_id: OWNER }, { id: `${t}-2`, owner_id: "otra-cuenta" }]]));
const MISSING = { code: "PGRST205", message: "Could not find the table 'public.lesson_attachments' in the schema cache" };

test("esquema completo: lee todas las tablas con el filtro de la cuenta y no declara nada como no disponible", async () => {
  const result = await exportDestination(fakeClient(everything()), OWNER, DESTINATION_TABLES);
  assert.equal(result.schema, "r10");
  assert.deepEqual(result.unavailable, []);
  assert.equal(Object.keys(result.tables).length, DESTINATION_TABLES.length);
  assert.ok(Object.values(result.tables).every((rows) => rows.length === 1 && rows[0].owner_id === OWNER), "sólo filas de la cuenta");
});

test("esquema ANTERIOR a R9/R10: las tablas nuevas inexistentes se declaran «no disponibles en esta versión» y el resto se lee completo", async () => {
  const errors = Object.fromEntries(TABLES_ADDED_BY_TRANSFER_MIGRATIONS.map((t) => [t, { code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` }]));
  const result = await exportDestination(fakeClient(everything(), errors), OWNER, DESTINATION_TABLES);
  assert.equal(result.schema, "anterior");
  assert.deepEqual(result.unavailable.sort(), [...TABLES_ADDED_BY_TRANSFER_MIGRATIONS].sort());
  assert.equal(Object.keys(result.tables).length, DESTINATION_TABLES.length - TABLES_ADDED_BY_TRANSFER_MIGRATIONS.length);
  assert.equal("lesson_attachments" in result.tables, false, "una tabla no disponible NO figura como vacía");
  assert.equal(result.tables.students.length, 1);
});

test("también se reconoce el error clásico de Postgres (42P01) para una tabla nueva inexistente", async () => {
  const result = await exportDestination(fakeClient(everything(), { student_source_extras: { code: "42P01", message: 'relation "public.student_source_extras" does not exist' } }), OWNER, DESTINATION_TABLES);
  assert.deepEqual(result.unavailable, ["student_source_extras"]);
});

test("una tabla que YA existía y falta ABORTA (no se declara «no disponible»)", async () => {
  await assert.rejects(exportDestination(fakeClient(everything(), { payments: MISSING }), OWNER, DESTINATION_TABLES), (e: unknown) => e instanceof ExportAbortError && e.kind === "missing_existing_table" && e.table === "payments");
});

test("errores de permisos, de red y de consulta ABORTAN, también en una tabla nueva: nunca se convierten en tablas vacías", async () => {
  const cases: Array<[unknown, string]> = [
    [{ code: "42501", message: "permission denied for table students" }, "permission"],
    [{ code: "PGRST301", message: "JWT expired" }, "permission"],
    [new TypeError("fetch failed"), "network"],
    [{ code: "", message: "Failed to fetch" }, "network"],
    [{ code: "42703", message: "column x does not exist" }, "query"],
    [{ code: "57014", message: "canceling statement due to statement timeout" }, "query"],
  ];
  for (const [error, kind] of cases) {
    for (const table of ["students", "lesson_attachments"]) {
      await assert.rejects(exportDestination(fakeClient(everything(), { [table]: error }), OWNER, DESTINATION_TABLES), (e: unknown) => e instanceof ExportAbortError && e.kind === kind && e.table === table, `${table} ${kind}`);
    }
  }
});

test("el aborto no deja un volcado parcial ni filtra datos en el mensaje", async () => {
  const client = fakeClient(everything(), { calendar_lessons: { code: "42501", message: 'permission denied for table calendar_lessons: fila de "ZQ Alumna Uno"' } });
  let caught: unknown = null;
  try {
    await exportDestination(client, OWNER, DESTINATION_TABLES);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof ExportAbortError);
  assert.equal((caught as Error).message.includes("ZQ Alumna Uno"), false, "el mensaje no copia el detalle del servidor");
});

test("clasificación de errores", () => {
  assert.equal(isMissingTableError({ code: "PGRST205" }), true);
  assert.equal(isMissingTableError({ code: "42501" }), false);
  assert.equal(isMissingTableError({ message: "relation \"public.x\" does not exist" }), true);
  assert.equal(classifyReadError({ code: "PGRST205" }), "missing_existing_table");
  assert.equal(classifyReadError({ code: "XX000", message: "boom" }), "query");
});
