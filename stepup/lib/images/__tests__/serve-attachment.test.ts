import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveLessonAttachment } from "../serve-attachment.ts";

/** Entrega de un adjunto por el servidor: sólo de la cuenta de la sesión, sólo si está disponible, sin detalles internos en los errores. */

const OWNER = "11111111-1111-1111-1111-111111111111";
const ROOT = join(import.meta.dirname, "..", "..", "..");

interface Row {
  name: string;
  mime_type: string | null;
  storage_path: string | null;
  file_status: string;
}

function fakeContext(row: Row | null, options: { storageError?: boolean; ownerId?: string } = {}) {
  const calls: string[] = [];
  const filters: Array<[string, string]> = [];
  const query = {
    select: () => query,
    is: () => query,
    eq: (column: string, value: string) => {
      filters.push([column, value]);
      return query;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const supabase = {
    from: (table: string) => {
      calls.push(`from:${table}`);
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          calls.push(`download:${bucket}:${path}`);
          return options.storageError ? { data: null, error: new Error("storage down") } : { data: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: "image/jpeg" }), error: null };
        },
      }),
    },
  };
  return { ctx: { supabase, ownerId: options.ownerId ?? OWNER }, calls, filters };
}

const available: Row = { name: "foto.heic", mime_type: "image/heic", storage_path: `${OWNER}/attachments/abc.heic`, file_status: "disponible" };

test("entrega la foto de la cuenta con tipo conocido, sin caché compartida, y filtra por la cuenta de la sesión", async () => {
  const { ctx, calls, filters } = fakeContext(available);
  const response = await serveLessonAttachment(async () => ctx as never, "att-1", false);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/heic");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(response.headers.get("content-length"), "6");
  assert.equal((await response.arrayBuffer()).byteLength, 6);
  assert.ok(filters.some(([c, v]) => c === "owner_id" && v === OWNER), "siempre por la cuenta de la sesión");
  assert.deepEqual(calls, ["from:lesson_attachments", `download:lesson-files:${OWNER}/attachments/abc.heic`]);
});

test("con ?descargar=1 el original se baja (attachment)", async () => {
  const response = await serveLessonAttachment(async () => fakeContext(available).ctx as never, "att-1", true);
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
});

test("sin sesión → 401; inexistente, no disponible o de otra cuenta → 404; fallo del almacenamiento → 500; sin detalles en el cuerpo", async () => {
  assert.equal((await serveLessonAttachment(async () => { throw new Error("sin sesión"); }, "att-1", false)).status, 401);
  assert.equal((await serveLessonAttachment(async () => fakeContext(null).ctx as never, "att-1", false)).status, 404);
  assert.equal((await serveLessonAttachment(async () => fakeContext({ ...available, file_status: "pendiente", storage_path: null }).ctx as never, "att-1", false)).status, 404);
  assert.equal((await serveLessonAttachment(async () => fakeContext({ ...available, storage_path: "22222222-2222-2222-2222-222222222222/attachments/x.heic" }).ctx as never, "att-1", false)).status, 404);
  const failed = await serveLessonAttachment(async () => fakeContext(available, { storageError: true }).ctx as never, "att-1", false);
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), "");
  assert.equal((await serveLessonAttachment(async () => fakeContext(available).ctx as never, "", false)).status, 404);
  assert.equal((await serveLessonAttachment(async () => fakeContext(available).ctx as never, "x".repeat(65), false)).status, 404);
});

test("un tipo guardado raro nunca se entrega como página", async () => {
  const response = await serveLessonAttachment(async () => fakeContext({ ...available, mime_type: "text/html" }).ctx as never, "att-1", false);
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
});

test("la ruta es sólo lectura y el visor no habla con Supabase desde el navegador", () => {
  const route = readFileSync(join(ROOT, "app", "api", "archivos", "adjunto", "[id]", "route.ts"), "utf8");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export (async )?function (POST|PUT|PATCH|DELETE)|export const (POST|PUT|PATCH|DELETE)/);
  const viewer = readFileSync(join(ROOT, "components", "registro", "lesson-photo-viewer.tsx"), "utf8");
  assert.doesNotMatch(viewer, /supabase|createSignedUrl|window\.open/i);
  assert.match(viewer, /await import\("@\/lib\/images\/heic-decode"\)/, "el decodificador se carga sólo al abrir una foto HEIC");
  assert.equal(/^import .*heic-decode/m.test(viewer), false);
});
