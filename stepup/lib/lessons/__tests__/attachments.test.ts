import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentStoragePath, checkPickedFile, cleanFileName, extensionForMime, IMAGE_MAX_BYTES, isUuid, materialStoragePath, PDF_MAX_BYTES } from "../attachments.ts";
import { SignedUploadError, uploadToSignedUrl } from "../signed-upload.ts";
import { pedagogicalContentPayload, validatePedagogicalContent } from "../pedagogical-content.ts";
import { toLessonContent, toMaterialLibrary } from "../../repositories/lesson-content-mapping.ts";

const MB = 1024 * 1024;

test("PDF: se acepta hasta 20 MB; más pesa se rechaza con el tamaño y el máximo en el mensaje", () => {
  assert.deepEqual(checkPickedFile({ name: "ejercicios.PDF", type: "application/pdf", size: 5 * MB }), { ok: true, kind: "pdf", mimeType: "application/pdf" });
  assert.equal(checkPickedFile({ name: "a.pdf", type: "application/pdf", size: PDF_MAX_BYTES }).ok, true);
  const big = checkPickedFile({ name: "a.pdf", type: "application/pdf", size: 21 * MB });
  assert.equal(big.ok, false);
  assert.equal(!big.ok && big.message, "El PDF pesa 21 MB. El máximo permitido es 20 MB.");
});

test("foto: se acepta hasta 10 MB; el tipo sale del contenido o, si el navegador no lo informa (HEIC), de la extensión", () => {
  assert.deepEqual(checkPickedFile({ name: "IMG_1.HEIC", type: "", size: 3 * MB }), { ok: true, kind: "image", mimeType: "image/heic" });
  assert.deepEqual(checkPickedFile({ name: "foto.jpeg", type: "image/jpeg", size: IMAGE_MAX_BYTES }), { ok: true, kind: "image", mimeType: "image/jpeg" });
  assert.deepEqual(checkPickedFile({ name: "sin-tipo.webp", type: "", size: MB }), { ok: true, kind: "image", mimeType: "image/webp" });
  const big = checkPickedFile({ name: "f.jpg", type: "image/jpeg", size: 11 * MB });
  assert.equal(!big.ok && big.message, "La foto pesa 11 MB. El máximo permitido es 10 MB.");
});

test("tipos no permitidos, archivos vacíos y la restricción de cada botón («Adjuntar PDF», «Elegir foto», material = sólo PDF)", () => {
  assert.equal(checkPickedFile({ name: "x.zip", type: "application/zip", size: MB }).ok, false);
  assert.equal(checkPickedFile({ name: "x.gif", type: "image/gif", size: MB }).ok, false);
  assert.equal(checkPickedFile({ name: "x.pdf", type: "application/pdf", size: 0 }).ok, false);
  const photoAsPdf = checkPickedFile({ name: "f.jpg", type: "image/jpeg", size: MB }, "pdf");
  assert.equal(!photoAsPdf.ok && photoAsPdf.message, "El archivo tiene que ser un PDF.");
  const pdfAsPhoto = checkPickedFile({ name: "a.pdf", type: "application/pdf", size: MB }, "image");
  assert.equal(!pdfAsPhoto.ok && pdfAsPhoto.message, "La foto tiene que ser JPG, PNG, WebP o HEIC.");
  assert.equal(checkPickedFile({ name: "a.pdf", type: "application/pdf", size: MB }, "pdf").ok, true);
});

test("la ruta del archivo siempre cuelga de la cuenta y es única por adjunto; nombres con carpetas se limpian", () => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const registration = "22222222-2222-4222-8222-222222222222";
  const attachment = "33333333-3333-4333-8333-333333333333";
  assert.equal(attachmentStoragePath(owner, registration, attachment, "image/heic"), `${owner}/web/${registration}/${attachment}.heic`);
  assert.equal(attachmentStoragePath(owner, registration, attachment, "application/pdf"), `${owner}/web/${registration}/${attachment}.pdf`);
  assert.equal(materialStoragePath(owner, attachment), `${owner}/web-materials/${attachment}.pdf`);
  assert.equal(extensionForMime("image/jpeg"), "jpg");
  assert.equal(cleanFileName("C:\\fotos\\..\\clase 1.jpg"), "clase 1.jpg");
  assert.equal(cleanFileName("   "), "archivo");
  assert.equal(cleanFileName("a".repeat(500)).length, 200);
  assert.equal(isUuid(attachment), true);
  assert.equal(isUuid("../../x"), false);
});

class FakeRequest {
  status = 200;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  body: FormData | null = null;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: FormData) {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    queueMicrotask(() => this.onload?.());
  }
}

test("la subida replica el pedido de storage-js: PUT con formulario (cacheControl + archivo con su tipo), sin sobrescribir, y informa el avance", async () => {
  const request = new FakeRequest();
  const progress: number[] = [];
  await uploadToSignedUrl({ signedUrl: "https://ejemplo.invalid/storage/v1/object/upload/sign/b/p?token=t", file: new Blob(["hola"]), mimeType: "image/heic", onProgress: (f) => progress.push(f), createRequest: () => request as unknown as XMLHttpRequest, publishableKey: "clave-publica" });
  assert.equal(request.method, "PUT");
  assert.equal(request.headers["x-upsert"], "false");
  assert.equal(request.headers.apikey, "clave-publica");
  assert.equal(request.body?.get("cacheControl"), "3600");
  const file = request.body?.get("") as File;
  assert.equal(file.type, "image/heic");
  assert.deepEqual(progress, [0.5]);
});

test("una subida rechazada informa el estado; una falla de red se vuelve «Failed to fetch» (el texto de red de siempre)", async () => {
  const rejected = new FakeRequest();
  rejected.status = 413;
  await assert.rejects(uploadToSignedUrl({ signedUrl: "u", file: new Blob(["x"]), mimeType: "application/pdf", createRequest: () => rejected as unknown as XMLHttpRequest }), (e) => e instanceof SignedUploadError && e.status === 413);
  const offline = new FakeRequest();
  offline.send = () => queueMicrotask(() => offline.onerror?.());
  await assert.rejects(uploadToSignedUrl({ signedUrl: "u", file: new Blob(["x"]), mimeType: "application/pdf", createRequest: () => offline as unknown as XMLHttpRequest }), (e) => e instanceof TypeError && /failed to fetch/i.test(e.message));
});

test("materiales de la clase: viajan en el contenido sólo si se indican (sin la clave, el guardado no los toca) y sin repetidos", () => {
  const base = { topics: [], objectives: [], activities: [], activityNotes: "", internalNotes: "" };
  assert.equal("material_ids" in pedagogicalContentPayload(base), false);
  assert.deepEqual(pedagogicalContentPayload({ ...base, materialIds: ["web_1", "web_1", "web_2"] }).material_ids, ["web_1", "web_2"]);
  assert.deepEqual(pedagogicalContentPayload({ ...base, materialIds: [] }).material_ids, []);
  assert.equal(validatePedagogicalContent({ ...base, materialIds: [""] }), false);
  assert.equal(validatePedagogicalContent({ ...base, materialIds: "x" }), false);
});

test("la biblioteca se ordena por antigüedad (como la app anterior) e indica qué materiales tienen archivo", () => {
  const row = (legacy: string, name: string, created: string | null, attachment: string | null, status: string) => ({ id: `id-${legacy}`, legacy_mobile_id: legacy, name, note: null, attachment_name: attachment, attachment_kind: attachment ? "pdf" : null, file_status: status, created_at: created });
  const library = toMaterialLibrary([row("b", "Segundo", "2026-02-01T00:00:00Z", null, "sin_archivo"), row("a", "Primero", "2026-01-01T00:00:00Z", "a.pdf", "disponible")]);
  assert.deepEqual(library.map((m) => [m.name, m.hasFile, m.availability]), [["Primero", true, "disponible"], ["Segundo", false, "sin_archivo"]]);
});

test("un adjunto quitado no llega al editor: sólo se mapean las filas vigentes que lee el repositorio", () => {
  const content = toLessonContent({ material_ids: ["m"] }, [{ id: "a1", name: "f.jpg", kind: "image", caption: null, student_id: null, size_bytes: 1, file_status: "disponible" }], []);
  assert.equal(content?.attachments.length, 1);
  assert.equal(content?.materials[0].inLibrary, false);
});
