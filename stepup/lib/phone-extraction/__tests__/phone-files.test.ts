import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MIME_BY_KIND, normalizeMime, sniffKind } from "../sniff.ts";
import { KEYS } from "../plan.ts";
import { inspectPhoneFiles, LESSON_FILES_LIMIT_BYTES, REPORT_PDF_LIMIT_BYTES, runPhoneExtraction, type RunnerDeps } from "../runner.ts";

/**
 * Formato REAL de los archivos del teléfono, revisión sin copiar y prueba de un solo archivo. Datos ANONIMIZADOS: bytes sintéticos con las cabeceras reales de cada formato.
 * Caso real que motiva esto: la app declara «image/heic» y nombre «.HEIC» pero guarda `<id>.jpg` (el selector de fotos la transcodifica a JPEG).
 */

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const pad = (head: number[], size: number): Uint8Array => {
  const out = new Uint8Array(size);
  out.set(head);
  return out;
};
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const JPEG = (size: number) => pad([0xff, 0xd8, 0xff, 0xe0], size);
const PNG = (size: number) => pad([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a], size);
const PDF = (size: number) => pad(ascii("%PDF-1.7"), size);
const WEBP = (size: number) => pad([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")], size);
const HEIC = (size: number, brand = "heic") => pad([0, 0, 0, 24, ...ascii("ftyp"), ...ascii(brand)], size);

test("el formato real se reconoce por los primeros bytes (JPEG, PNG, WebP, PDF y HEIC/HEIF con sus marcas), no por el nombre", () => {
  assert.equal(sniffKind(JPEG(100)), "jpeg");
  assert.equal(sniffKind(PNG(100)), "png");
  assert.equal(sniffKind(WEBP(100)), "webp");
  assert.equal(sniffKind(PDF(100)), "pdf");
  for (const brand of ["heic", "heix", "hevc", "mif1", "heif"]) assert.equal(sniffKind(HEIC(100, brand)), "heic", brand);
  assert.equal(sniffKind(pad([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("avif")], 64)), "unknown", "AVIF no es HEIC");
  assert.equal(sniffKind(new Uint8Array([1, 2, 3])), "unknown");
  assert.equal(sniffKind(new Uint8Array()), "unknown");
  assert.equal(MIME_BY_KIND.heic, "image/heic");
  assert.equal(normalizeMime("image/heif"), "image/heic");
});

/** Teléfono de mentira: una foto «HEIC» que es JPEG, una foto HEIC de verdad, un PNG, un PDF enorme y un archivo que ya no está. */
function makeWorld(options: { heicIsJpeg?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {
    "file:///docs/a1.jpg": options.heicIsJpeg === false ? HEIC(2000) : JPEG(2000), // declarado image/heic
    "file:///docs/a2.heic": HEIC(3000), // declarado image/heic y de verdad HEIC
    "file:///docs/a3.png": PNG(1500),
    "file:///docs/a4.pdf": PDF(LESSON_FILES_LIMIT_BYTES + 1),
  };
  const lessons = [
    {
      id: "les-1",
      form: {
        activityAttachments: [
          { id: "att-1", uri: "file:///docs/a1.jpg", kind: "image", name: "IMG_1.HEIC", mimeType: "image/heic", sizeBytes: 2000 },
          { id: "att-2", uri: "file:///docs/a2.heic", kind: "image", name: "IMG_2.HEIC", mimeType: "image/heic", sizeBytes: 3000 },
          { id: "att-3", uri: "file:///docs/a3.png", kind: "image", name: "foto.png", mimeType: "image/png", sizeBytes: 1500 },
          { id: "att-4", uri: "file:///docs/a4.pdf", kind: "pdf", name: "grande.pdf", sizeBytes: LESSON_FILES_LIMIT_BYTES + 1 },
          { id: "att-5", uri: "file:///docs/ausente.jpg", kind: "image", name: "ausente.jpg", mimeType: "image/jpeg", sizeBytes: 10 },
        ],
      },
    },
  ];
  const keys: Record<string, string | null> = { [KEYS.lessons]: JSON.stringify(lessons), [KEYS.reports]: "[]", [KEYS.materials]: "[]" };
  const calls: string[] = [];
  const uploads: Array<{ path: string; contentType: string; size: number }> = [];
  const registered: Array<Record<string, unknown>> = [];
  const deps: RunnerDeps = {
    readKey: async (k) => {
      calls.push(`readKey`);
      return keys[k] ?? null;
    },
    fileInfo: async (uri) => (uri in files ? { exists: true, size: files[uri].length } : { exists: false, size: null }),
    readBytes: async (uri) => files[uri],
    sha256Hex: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
    ownerId: async () => OWNER,
    listReports: async () => [],
    upload: async (_bucket, path, bytes, contentType) => {
      calls.push("upload");
      uploads.push({ path, contentType, size: bytes.length });
      return { error: null };
    },
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`);
      if (name === "register_transfer_file") registered.push(args);
      return { data: name === "import_phone_extraction" ? { materials_received: 0, materials_inserted: 0 } : {}, error: null };
    },
  };
  return { deps, calls, uploads, registered };
}

test("revisión SIN copiar: cuenta, mide y reconoce el formato real; no habla con la cuenta (ni base ni almacenamiento) y no declara nada ausente", async () => {
  const { deps, calls } = makeWorld();
  const result = await inspectPhoneFiles(deps);
  assert.equal(calls.some((c) => c === "upload" || c.startsWith("rpc:")), false, "ninguna subida ni llamada a la cuenta");
  const a = result.counts.lesson_attachment;
  assert.deepEqual([a.total, a.found, a.notFound], [5, 4, 1], "el no encontrado se cuenta, pero no se declara ausente en ninguna cuenta");
  assert.equal(a.actualBytes, 2000 + 3000 + 1500 + LESSON_FILES_LIMIT_BYTES + 1);
  assert.equal(a.largestBytes, LESSON_FILES_LIMIT_BYTES + 1);
  assert.equal(a.overLimit, 1, "el que supera el tope del almacenamiento se detecta ANTES de copiar");
  assert.equal(a.sizeMismatch, 0);
  assert.deepEqual(result.formats, { jpeg: 1, heic: 1, png: 1, pdf: 1 });
  assert.equal(result.declaredHeicActuallyJpeg, 1, "«HEIC» que en realidad es JPEG");
  assert.equal(result.actuallyHeic, 1, "HEIC de verdad (necesitaría vista previa en la web)");
  assert.equal(result.labelDiffersFromContent, 1, "sólo la foto «HEIC» que en realidad es JPEG");
  assert.deepEqual(result.limits, { lessonFilesBytes: LESSON_FILES_LIMIT_BYTES, reportPdfBytes: REPORT_PDF_LIMIT_BYTES });
});

test("un tamaño distinto al declarado se detecta en la revisión (la copia lo rechazaría)", async () => {
  const { deps } = makeWorld();
  const original = deps.fileInfo;
  deps.fileInfo = async (uri) => (uri === "file:///docs/a3.png" ? { exists: true, size: 9999 } : original(uri));
  const result = await inspectPhoneFiles(deps);
  assert.equal(result.counts.lesson_attachment.sizeMismatch, 1);
});

test("prueba de UN solo archivo: elige primero una foto declarada HEIC, la sube con su formato REAL (JPEG→.jpg), la registra y no deja constancia", async () => {
  const { deps, uploads, registered, calls } = makeWorld();
  const summary = await runPhoneExtraction(deps, { maxItems: 1, prefer: "image/heic" });
  assert.equal(summary.trial, true);
  assert.equal(summary.complete, false, "una prueba no cuenta como copia completa");
  assert.equal(uploads.length, 1);
  assert.match(uploads[0].path, new RegExp(`^${OWNER}/attachments/[0-9a-f]{64}\\.jpg$`), "extensión real, no «.heic»");
  assert.equal(uploads[0].contentType, "image/jpeg", "tipo real, no «image/heic»");
  assert.equal(registered.length, 1);
  assert.equal(registered[0].p_size, 2000);
  assert.equal(summary.labelDiffersFromContent, 1);
  assert.deepEqual(summary.actualFormats, { jpeg: 1 });
  assert.equal(calls.includes("rpc:record_phone_extraction_result"), false, "la prueba no deja constancia del resultado");
});

test("un HEIC de verdad se conserva ORIGINAL: mismos bytes, tipo image/heic y extensión .heic", async () => {
  const { deps, uploads } = makeWorld({ heicIsJpeg: false });
  const summary = await runPhoneExtraction(deps, { maxItems: 1, prefer: "image/heic" });
  assert.equal(uploads[0].contentType, "image/heic");
  assert.match(uploads[0].path, /\.heic$/);
  assert.equal(uploads[0].size, 2000, "sin recomprimir ni convertir");
  assert.equal(summary.labelDiffersFromContent, 0);
});

test("un archivo que supera el tope del almacenamiento no se sube ni se registra: queda como fallo «too_large» y la copia no es completa", async () => {
  const { deps, uploads } = makeWorld();
  const summary = await runPhoneExtraction(deps);
  assert.equal(summary.failed.some((f) => f.reason === "too_large"), true);
  assert.equal(uploads.some((u) => u.size > LESSON_FILES_LIMIT_BYTES), false);
  assert.equal(summary.complete, false);
  assert.equal(summary.missingAtOrigin.length, 1, "el ausente se declara al copiar (no en la revisión)");
});
