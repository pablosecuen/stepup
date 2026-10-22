import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOT_A_PHOTO_MESSAGE, UnreadablePhotoError, assertLooksLikePhoto } from "../photo-validity.ts";
import { toThumbnailJpeg } from "../../reports/evidence-image.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const bytes = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));

test("forma de foto por los primeros bytes: JPG, PNG y HEIC pasan; un texto con nombre .jpg o un archivo vacío no", () => {
  assert.equal(assertLooksLikePhoto(bytes("plana.jpg")), "native");
  assert.equal(assertLooksLikePhoto(bytes("plana.png")), "native");
  assert.equal(assertLooksLikePhoto(bytes("plana.heic")), "heic");
  assert.throws(() => assertLooksLikePhoto(bytes("texto.jpg")), (e: unknown) => e instanceof UnreadablePhotoError && e.message === NOT_A_PHOTO_MESSAGE);
  assert.throws(() => assertLooksLikePhoto(bytes("vacia.heic")), /vacío/);
});

test("una HEIC con cabecera correcta pero contenido inválido pasa la forma y FALLA al generar la miniatura: por eso se rechaza antes de guardarla", async () => {
  assert.equal(assertLooksLikePhoto(bytes("invalida.heic")), "heic", "sólo la cabecera: la forma no alcanza");
  await assert.rejects(toThumbnailJpeg(bytes("invalida.heic")), "no se puede generar miniatura");
  const ok = await toThumbnailJpeg(bytes("plana.heic"));
  assert.ok(ok.byteLength > 0, "una HEIC válida sí tiene miniatura");
});
