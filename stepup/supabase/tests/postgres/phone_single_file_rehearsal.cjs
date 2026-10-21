// PRUEBA DE UN SOLO ARCHIVO contra un destino AISLADO (Postgres real con todas las migraciones + un servidor local con la forma de Supabase + el cliente REAL de supabase-js).
// Es la misma pasada que hará el teléfono: la extracción sube COPIAS con su formato REAL (una foto «HEIC» que es JPEG se sube como JPEG; un HEIC de verdad se conserva original),
// las registra con su huella y no deja constancia de resultado. Datos SINTÉTICOS con las cabeceras reales de cada formato; no toca ninguna red ni Production.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/phone_single_file_rehearsal.cjs
const crypto = require("crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");
const { startShim } = require("./storage_shim.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
const pad = (head, size) => {
  const out = Buffer.alloc(size);
  Buffer.from(head).copy(out);
  return new Uint8Array(out);
};
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const JPEG = (size, seed) => { const b = pad([0xff, 0xd8, 0xff, 0xe0], size); b[10] = seed; return b; };
const HEIC = (size, seed) => { const b = pad([0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic")], size); b[20] = seed; return b; };

async function main() {
  const { createClient } = require(path.join(ROOT, "node_modules", "@supabase", "supabase-js"));
  const { buildMobileBackup } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { runPhoneExtraction, inspectPhoneFiles, LESSON_FILES_LIMIT_BYTES } = await mod("lib/phone-extraction/runner.ts");
  const { supabaseDeps } = await mod("lib/phone-extraction/supabase-deps.ts");

  const A = H.A;
  const MB = 1048576;
  /** Tres fotos como las del teléfono real: dos declaradas «HEIC» (una que es JPEG, una HEIC de verdad) y una de 21 MiB (supera el tope). */
  const files = {
    "file:///docs/a1.jpg": JPEG(2.1 * MB, 1),
    "file:///docs/a2.heic": HEIC(3 * MB, 2),
    "file:///docs/a3.jpg": JPEG(LESSON_FILES_LIMIT_BYTES + 1024, 3),
  };
  const attachments = [
    { id: "att-img-1", uri: "file:///docs/a1.jpg", kind: "image", name: "IMG_0001.HEIC", mimeType: "image/heic", sizeBytes: files["file:///docs/a1.jpg"].length, addedAt: "2026-08-10T10:00:00.000Z" },
    { id: "att-img-2", uri: "file:///docs/a2.heic", kind: "image", name: "IMG_0002.HEIC", mimeType: "image/heic", sizeBytes: files["file:///docs/a2.heic"].length, addedAt: "2026-08-10T10:01:00.000Z" },
    { id: "att-img-3", uri: "file:///docs/a3.jpg", kind: "image", name: "IMG_0003.JPG", mimeType: "image/jpeg", sizeBytes: files["file:///docs/a3.jpg"].length, addedAt: "2026-08-10T10:02:00.000Z" },
  ];
  const source = buildMobileBackup();
  source.pedagogicalLessons[0].form.activityAttachments = attachments;
  const lessonId = source.pedagogicalLessons[0].id;

  const pg = await start({ port: 5731 });
  try {
    if (pg.failures.length) throw new Error("migraciones con error: " + pg.failures.map((f) => f[0]).join(", "));
    const { admin } = pg;
    await H.reset(admin);
    const validation = validateBackupPayload(source);
    if (!validation.ok) throw new Error("el respaldo sintético no valida");
    const s = await H.apiSession(pg, A, 60000);
    const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
    await H.applyOf(s, preview.preview_id, [], []);
    await s.end();

    const bucket = (await admin.query("select file_size_limit::bigint as l, allowed_mime_types as m from storage.buckets where id = 'lesson-files'")).rows[0];
    check("el bucket «lesson-files» es privado, con tope de 20 MiB y acepta HEIC/HEIF además de JPEG, PNG, WebP y PDF", Number(bucket.l) === 20 * MB && ["image/heic", "image/heif", "image/jpeg", "image/png", "image/webp", "application/pdf"].every((m) => bucket.m.includes(m)), JSON.stringify(bucket));
    check("las tres fotos figuran en la cuenta como «pendiente» (todavía sin archivo)", (await admin.query("select count(*)::int n from public.lesson_attachments where owner_id = $1 and file_status = 'pendiente' and legacy_mobile_id like $2", [A, `${lessonId}:att-img-%`])).rows[0].n === 3);

    const tokens = new Map();
    const shim = await startShim(pg, tokens, { rpcFailOnce: false });
    const token = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: A, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.ZmlybWE`;
    tokens.set(token, A);
    const client = createClient(shim.url, "clave-anonima-de-prueba", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    await client.auth.setSession({ access_token: token, refresh_token: "refresco" });
    const keys = { "@teacherflow/lessons": JSON.stringify(source.pedagogicalLessons), "@teacherflow/report_history": "[]", "@teacherflow/materials_library": "[]" };
    const deps = () => ({
      readKey: async (k) => keys[k] ?? null,
      fileInfo: async (uri) => (uri in files ? { exists: true, size: files[uri].length } : { exists: false, size: null }),
      readBytes: async (uri) => files[uri],
      sha256Hex: async (bytes) => sha256(Buffer.from(bytes)),
      ...supabaseDeps(client),
    });
    try {
      // 0) La revisión no sube nada.
      const objectsBefore = shim.objects.size;
      const review = await inspectPhoneFiles(deps());
      check("la revisión sin copiar mide, reconoce el formato real y NO sube ni registra nada", shim.objects.size === objectsBefore && review.declaredHeicActuallyJpeg === 1 && review.actuallyHeic === 1 && review.counts.lesson_attachment.overLimit === 1, JSON.stringify(review.formats));

      // 1) Prueba de UN archivo: la foto «HEIC» que es JPEG.
      const one = await runPhoneExtraction(deps(), { maxItems: 1, prefer: "image/heic" });
      const keysStored = [...shim.objects.keys()];
      check("un solo archivo: se sube UNA copia, con su formato real (JPEG → «.jpg») y sin constancia de resultado", one.trial && !one.complete && one.counts.lesson_attachment.uploaded === 1 && keysStored.length === 1 && /\.jpg$/.test(keysStored[0]), JSON.stringify(keysStored));
      const row1 = (await admin.query("select file_status, sha256, stored_size_bytes::bigint as sz, storage_path, mime_type from public.lesson_attachments where owner_id = $1 and legacy_mobile_id = $2", [A, `${lessonId}:att-img-1`])).rows[0];
      check("la cuenta registra el archivo con la huella y el tamaño reales y conserva lo que la app declaraba (image/heic)", row1.file_status === "disponible" && row1.sha256 === sha256(Buffer.from(files["file:///docs/a1.jpg"])) && Number(row1.sz) === files["file:///docs/a1.jpg"].length && row1.mime_type === "image/heic" && keysStored[0].endsWith(row1.storage_path), JSON.stringify({ ...row1, sha256: "…" }));
      check("el contenido guardado es idéntico, byte por byte, al del teléfono", Buffer.compare(Buffer.from(shim.objects.get(keysStored[0])), Buffer.from(files["file:///docs/a1.jpg"])) === 0);

      // 2) Repetir: no duplica.
      const again = await runPhoneExtraction(deps(), { maxItems: 1, prefer: "image/heic" });
      check("repetir la prueba no duplica nada (el «ya existe» se reconoce y sólo se vuelve a registrar)", again.counts.lesson_attachment.alreadyThere === 1 && shim.objects.size === 1);

      // 3) Un HEIC de verdad se conserva ORIGINAL.
      keys["@teacherflow/lessons"] = JSON.stringify(source.pedagogicalLessons.map((l, i) => (i === 0 ? { ...l, form: { ...l.form, activityAttachments: [attachments[1]] } } : l)));
      const heic = await runPhoneExtraction(deps(), { maxItems: 1, prefer: "image/heic" });
      const heicKey = [...shim.objects.keys()].find((k) => k.endsWith(".heic"));
      check("un HEIC de verdad se sube ORIGINAL: tipo image/heic, extensión «.heic» y mismos bytes (el bucket lo acepta)", heic.counts.lesson_attachment.uploaded === 1 && heicKey && Buffer.compare(Buffer.from(shim.objects.get(heicKey)), Buffer.from(files["file:///docs/a2.heic"])) === 0, JSON.stringify(heic.failed));
      check("el primer archivo no se tocó al subir el segundo", Buffer.compare(Buffer.from(shim.objects.get(keysStored[0])), Buffer.from(files["file:///docs/a1.jpg"])) === 0 && shim.objects.size === 2);

      // 4) El tope: el runner no sube ni registra un archivo de más de 20 MiB, y el propio almacenamiento lo rechaza si se intentara.
      keys["@teacherflow/lessons"] = JSON.stringify(source.pedagogicalLessons.map((l, i) => (i === 0 ? { ...l, form: { ...l.form, activityAttachments: [attachments[2]] } } : l)));
      const big = await runPhoneExtraction(deps(), {});
      check("un archivo de más de 20 MiB no se sube ni se registra (fallo «too_large») y la copia no es completa", big.failed.some((f) => f.reason === "too_large") && !big.complete && shim.objects.size === 2);
      const direct = await client.storage.from("lesson-files").upload(`${A}/attachments/${"0".repeat(64)}.jpg`, files["file:///docs/a3.jpg"].buffer.slice(0), { contentType: "image/jpeg", upsert: false });
      check("…y el almacenamiento aislado también rechaza ese tamaño (tope real del bucket)", direct.error !== null && shim.objects.size === 2, JSON.stringify(direct.error));
      check("la tercera foto sigue «pendiente» en la cuenta (nunca se da por copiada)", (await admin.query("select file_status from public.lesson_attachments where owner_id = $1 and legacy_mobile_id = $2", [A, `${lessonId}:att-img-3`])).rows[0].file_status === "pendiente");

      // 5) Nada de más.
      const recorded = (await admin.query("select summary from public.phone_extraction_results where owner_id = $1", [A])).rows;
      check("las pruebas de un archivo no dejaron constancia; sólo la corrida completa con el archivo de más de 20 MiB, como INCOMPLETA, y no hay archivos de otra cuenta", recorded.length === 1 && recorded[0].summary.complete === false && [...shim.objects.keys()].every((k) => k.startsWith(`lesson-files/${A}/`)));
    } finally {
      await shim.stop();
    }
  } finally {
    await pg.stop();
    require("fs").rmSync(pg.dir, { recursive: true, force: true });
  }
  console.log(failures.length ? `\n✗ ${failures.length} de ${total} fallaron:\n  - ${failures.join("\n  - ")}` : `\n✓ ${total}/${total} comprobaciones`);
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((e) => {
  console.error("La prueba falló:", String(e.stack || e.message).split("\n").slice(0, 5).join(" | "));
  process.exitCode = 1;
});
