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
  assert.match(editor, /for \(const file of files\) \{\s+const failure = await upload\(file, expect, .*\);\s+if \(failure\) failures\.push\(failure\);/, "una foto que falla se avisa por nombre y NO descarta las demás");
  assert.doesNotMatch(editor, /if \(!saved\) break/);
  assert.match(editor, /picked\.size > IMAGE_PICK_MAX_BYTES/, "una foto muy pesada se intenta reducir antes de rechazarla: el tope de 10 MB se revisa DESPUÉS de preparar");
  assert.match(editor, /size: expect === "image" \? Math\.min\(picked\.size, IMAGE_MAX_BYTES\) : picked\.size/);
  assert.match(editor, /No pudimos reducirla desde este navegador/, "si no se puede reducir, el error es claro");
  assert.match(editor, /onChange=\{\(e\) => setCaption\(e\.target\.value\)\} onBlur=\{saveCaption\}/, "cada foto tiene su propia descripción");
  assert.match(editor, /Quitar/);
});

test("reportes: hasta 12 fotos (como la app anterior), aviso de datos sensibles y las demás fotos se bloquean al llegar al tope", () => {
  const tab = read("components/students/profile/reportes-tab.tsx");
  assert.match(tab, /Evitá incluir imágenes de alumnos o información sensible sin autorización\./);
  assert.ok(tab.includes('(photosFull && candidate.kind === "image" && !selectedEvidenceIds.includes(candidate.attachmentId))'));
  assert.match(read("lib/reports/evidence.ts"), /export const MAX_REPORT_PHOTOS = 12;/);
});
test("HEIC que el navegador no sabe leer: se decodifica con el decodificador propio antes de subir (carga dinámica, sólo en ese momento)", () => {
  const source = read("lib/images/client-prepare.ts");
  assert.match(source, /await import\("\.\/heic-decode"\)/);
  assert.match(source, /if \(isHeic\(file\)\) \{\s+const converted = await heicToJpeg\(file\)/);
  assert.equal(/^import .*heic-decode/m.test(source), false, "el decodificador no entra en el paquete inicial");
});

test("reportes: cada foto elegible lleva su miniatura (la hace el servidor, también para HEIC, y sólo se pide al verla)", () => {
  const tab = read("components/students/profile/reportes-tab.tsx");
  assert.ok(tab.includes('{candidate.kind === "image" && <LessonPhotoThumbnail id={candidate.attachmentId} name={candidate.name} onUnreadable={onEvidenceUnreadable} />}'));
  const thumb = read("components/registro/lesson-photo-thumbnail.tsx");
  assert.ok(thumb.includes("?miniatura=1"));
  assert.ok(thumb.includes("IntersectionObserver"), "sólo se pide cuando la fila entra en pantalla");
  assert.ok(thumb.includes("response.status === 422"), "422 = no se puede leer: se marca como inutilizable");
  assert.ok(thumb.includes('setPhase({ state: "error" })') && thumb.includes("Reintentar"), "un error pasajero NO marca la foto como inutilizable y permite reintentar");
  const route = read("app/api/archivos/adjunto/[id]/route.ts");
  assert.match(route, /query\.get\("miniatura"\) === "1"/);
});

test("clases grupales: cada archivo puede ser de toda la clase o sólo de un participante (la base verifica que sea participante del registro)", () => {
  const editor = read("components/registro/lesson-files-editor.tsx");
  assert.match(editor, /participants\.length > 1 &&/);
  assert.match(editor, /<option value="">Toda la clase<\/option>/);
  assert.match(editor, /registerAttachmentAction\(\{[^}]*caption: null, studentId \}\)/);
  assert.match(editor, /Para: \{ownerLabel\}/);
  const write = read("lib/repositories/lesson-files-write.ts");
  assert.match(write, /student_id: studentId/);
  assert.match(write, /!isUuid\(studentId\)/);
  assert.match(read("app/(app)/registro/[calendarLessonId]/registration-workspace.tsx"), /participants: isGroup \? participants\.map/);
  // El reporte de un alumno nunca ofrece el archivo de otro participante.
  assert.match(read("lib/repositories/lesson-registrations.ts"), /!attachmentBelongsToStudent\(row\.student_id, studentId\)\) continue/);
});

test("fotos que no se pueden leer: no se suben, no se registran, no se ofrecen como utilizables y las demás se conservan", () => {
  const prepare = read("lib/images/client-prepare.ts");
  assert.ok(prepare.includes("assertLooksLikePhoto(new Uint8Array(await file.slice(0, 64).arrayBuffer()));"), "antes de subir: tiene que tener forma de foto");
  assert.ok(prepare.includes("error instanceof HeicDecodeError ? new UnreadablePhotoError(UNREADABLE_HEIC_MESSAGE)"), "un HEIC que no se puede decodificar no se sube");
  assert.ok(!prepare.includes("se sube la original y el servidor/visor explican"));
  const editor = read("components/registro/lesson-files-editor.tsx");
  assert.ok(editor.includes("if (error instanceof UnreadablePhotoError) return error.message;"));
  assert.ok(editor.includes("if (failure) failures.push(failure);"), "las demás fotos elegidas siguen su camino");
  assert.ok(editor.includes("Esta foto no se puede abrir ni usar en reportes"));
  const write = read("lib/repositories/lesson-files-write.ts");
  assert.ok(write.includes('if (input.kind === "image") await assertStoredPhotoReadable(ctx, input.path);'), "el servidor sólo registra una foto si puede generar su miniatura");
  const tab = read("components/students/profile/reportes-tab.tsx");
  assert.ok(tab.includes("disabled={unreadable ||"), "una foto ilegible no se puede elegir para el reporte");
  assert.ok(tab.includes("setSelectedEvidenceIds((current) => current.filter((id) => id !== attachmentId))"), "y si estaba elegida se saca de la selección");
});
