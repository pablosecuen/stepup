import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeHeic, HeicDecodeError } from "../heic-decode.ts";
import { contentDisposition, lessonFileHeaders, safeContentType, safeDownloadName } from "../lesson-file-headers.ts";
import { MAX_PREVIEW_BYTES, messageForUnsupported, planPhotoPreview } from "../photo-preview.ts";

/** Vista previa de fotos: sólo archivos SINTÉTICOS (cuadrantes de color), generados por tools/images/make-fixtures.py. Nunca fotos reales. */

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const pixel = (photo: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => Array.from(photo.rgba.slice((y * photo.width + x) * 4, (y * photo.width + x) * 4 + 3));
const near = (actual: number[], expected: number[]) => actual.every((v, i) => Math.abs(v - expected[i]) <= 6);

test("el plan se decide por los bytes reales, no por el nombre", () => {
  assert.deepEqual(planPhotoPreview(fixture("plana.jpg")), { mode: "native", mime: "image/jpeg" });
  assert.deepEqual(planPhotoPreview(fixture("orientada.jpg")), { mode: "native", mime: "image/jpeg" });
  assert.deepEqual(planPhotoPreview(fixture("plana.png")), { mode: "native", mime: "image/png" });
  assert.deepEqual(planPhotoPreview(fixture("plana.heic")), { mode: "heic" });
  assert.deepEqual(planPhotoPreview(fixture("orientada.heic")), { mode: "heic" });
  assert.deepEqual(planPhotoPreview(fixture("invalida.heic")), { mode: "heic" }, "parece HEIC por la cabecera: se intenta y falla con mensaje");
  assert.deepEqual(planPhotoPreview(fixture("texto.jpg")), { mode: "unsupported", reason: "not_an_image" });
  assert.deepEqual(planPhotoPreview(fixture("vacia.heic")), { mode: "unsupported", reason: "empty" });
  assert.deepEqual(planPhotoPreview(new Uint8Array(MAX_PREVIEW_BYTES + 1)), { mode: "unsupported", reason: "too_large" });
});

test("todos los motivos de «no se puede mostrar» tienen un mensaje en lenguaje simple que ofrece el original", () => {
  for (const reason of ["empty", "too_large", "not_an_image"] as const) {
    const text = messageForUnsupported(reason);
    assert.match(text, /original|descargar/i);
    assert.doesNotMatch(text, /exception|undefined|null|wasm|libheif/i);
  }
});

test("una foto HEIC se decodifica a píxeles con los colores correctos (original intacto)", async () => {
  const bytes = fixture("plana.heic");
  const before = Buffer.from(bytes).toString("base64");
  const photo = await decodeHeic(bytes);
  assert.equal(photo.width, 240);
  assert.equal(photo.height, 160);
  assert.equal(photo.rgba.length, 240 * 160 * 4);
  assert.ok(near(pixel(photo, 100, 70), [220, 30, 30]), "arriba-izquierda roja");
  assert.ok(near(pixel(photo, 140, 70), [30, 180, 60]), "arriba-derecha verde");
  assert.ok(near(pixel(photo, 100, 120), [30, 60, 220]), "abajo-izquierda azul");
  assert.ok(near(pixel(photo, 140, 120), [240, 220, 20]), "abajo-derecha amarilla");
  assert.equal(Buffer.from(bytes).toString("base64"), before, "el archivo original no se modifica");
});

test("la orientación de la propia foto HEIC se respeta (rotación del contenedor)", async () => {
  const photo = await decodeHeic(fixture("orientada.heic"));
  assert.equal(photo.width, 160, "girada 90°: el ancho pasa a ser el alto original");
  assert.equal(photo.height, 240);
  // El rojo (arriba-izquierda en la foto sin girar) queda arriba-derecha; el azul (abajo-izquierda) queda arriba-izquierda.
  assert.ok(near(pixel(photo, 120, 100), [220, 30, 30]), "rojo arriba-derecha");
  assert.ok(near(pixel(photo, 40, 100), [30, 60, 220]), "azul arriba-izquierda");
  assert.ok(near(pixel(photo, 40, 140), [240, 220, 20]), "amarillo abajo-izquierda");
  assert.ok(near(pixel(photo, 120, 140), [30, 180, 60]), "verde abajo-derecha");
});

test("un HEIC inválido o vacío falla con un error controlado, sin mostrar nada", async () => {
  await assert.rejects(() => decodeHeic(fixture("invalida.heic")), HeicDecodeError);
  await assert.rejects(() => decodeHeic(fixture("vacia.heic")), HeicDecodeError);
});

test("el decodificador sólo se carga al decodificar (importación dinámica) y no hay otra dependencia de red", () => {
  const source = readFileSync(join(import.meta.dirname, "..", "heic-decode.ts"), "utf8");
  assert.match(source, /await import\("libheif-js\/wasm-bundle\.js"\)/);
  assert.equal(/^import .*libheif/m.test(source), false, "ninguna importación estática del decodificador");
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|supabase/i);
});

test("la entrega del archivo sólo declara tipos conocidos y nombres seguros", () => {
  assert.equal(safeContentType("image/heic"), "image/heic");
  assert.equal(safeContentType("IMAGE/JPEG; charset=x"), "image/jpeg");
  assert.equal(safeContentType("text/html"), "application/octet-stream");
  assert.equal(safeContentType(null), "application/octet-stream");
  assert.equal(safeDownloadName('../../x"\r\ny.heic'), ".._.._xy.heic", "sin rutas ni comillas ni saltos de línea");
  assert.equal(safeDownloadName(""), "archivo");
  assert.match(contentDisposition("Foto ñandú.heic", true), /^attachment; filename="Foto _and_.heic"; filename\*=UTF-8''Foto%20%C3%B1and%C3%BA\.heic$/);
  assert.match(contentDisposition("a.jpg", false), /^inline;/);
  const headers = lessonFileHeaders({ mime: "image/heic", name: "a.heic", size: 10, download: false });
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Content-Length"], "10");
});
