import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jpegName, needsClientConversion } from "../client-prepare.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");

const MB = 1024 * 1024;

test("convierte a JPEG antes de subir sólo lo que hace falta: HEIC/HEIF siempre y cualquier foto que pase de 10 MB", () => {
  assert.equal(needsClientConversion({ name: "IMG_0001.HEIC", type: "image/heic", size: 2 * MB }), true);
  assert.equal(needsClientConversion({ name: "IMG_0002.heif", type: "", size: 2 * MB }), true, "el navegador a veces no informa el tipo de una HEIC");
  assert.equal(needsClientConversion({ name: "foto.jpg", type: "image/jpeg", size: 3 * MB }), false, "una JPEG normal se sube tal cual");
  assert.equal(needsClientConversion({ name: "foto.png", type: "image/png", size: 10 * MB }), false, "justo en el tope entra");
  assert.equal(needsClientConversion({ name: "foto.jpg", type: "image/jpeg", size: 10 * MB + 1 }), true);
});

test("nombre del archivo convertido: el mismo con extensión .jpg", () => {
  assert.equal(jpegName("IMG_0001.HEIC"), "IMG_0001.jpg");
  assert.equal(jpegName("mi.foto.de.clase.heif"), "mi.foto.de.clase.jpg");
  assert.equal(jpegName("sinextension"), "sinextension.jpg");
});
test("el editor de evidencias: la galería admite varias fotos, la cámara una, todas pasan por la preparación y se suben de a una frenando en la primera que falla", () => {
  const editor = read("components/registro/lesson-files-editor.tsx");
  assert.match(editor, /<input ref=\{photoInput\} aria-label="Foto a adjuntar" type="file" multiple /, "Elegir foto: varias fotos de la galería a la vez");
  assert.match(editor, /<input ref=\{cameraInput\}[^>]*capture="environment"/, "Tomar foto abre la cámara");
  assert.doesNotMatch(editor, /<input ref=\{cameraInput\}[^>]* multiple /);
  assert.match(editor, /expect === "image" \? await prepareImageForUpload\(picked\) : picked/, "HEIC o demasiado pesada: se convierte a JPEG antes de subir cuando el navegador sabe");
  assert.match(editor, /for \(const file of files\) \{\s+const saved = await upload\(file, expect, .*\);\s+if \(!saved\) break;/);
  assert.match(editor, /onChange=\{\(e\) => setCaption\(e\.target\.value\)\} onBlur=\{saveCaption\}/, "cada foto tiene su propia descripción");
  assert.match(editor, /Quitar/);
});

test("reportes: hasta 12 fotos (como la app anterior), aviso de datos sensibles y las demás fotos se bloquean al llegar al tope", () => {
  const tab = read("components/students/profile/reportes-tab.tsx");
  assert.match(tab, /Evitá incluir imágenes de alumnos o información sensible sin autorización\./);
  assert.match(tab, /disabled=\{photosFull && candidate\.kind === "image" && !selectedEvidenceIds\.includes\(candidate\.attachmentId\)\}/);
  assert.match(read("lib/reports/evidence.ts"), /export const MAX_REPORT_PHOTOS = 12;/);
});