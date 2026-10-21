import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildExtractionPlan, DEVICE_LOCAL_KEYS, KEYS } from "../plan.ts";
import { runPhoneExtraction, type RunnerDeps } from "../runner.ts";
import { buildMobileBackup, buildPhoneExtraction } from "../../backup/__fixtures__/mobile-real-shape.ts";

type Row = Record<string, unknown>;
const OWNER = "00000000-0000-4000-8000-0000000000aa";
const STUDENT_UUID = "11111111-1111-4111-8111-111111111111";
const REPORT_UUID = "22222222-2222-4222-8222-222222222222";
/** Contenidos con el tamaño que la app guardó para cada archivo (20480 y 4096 bytes). */
const GUIDE = "ZQ-contenido-guia".padEnd(20480, ".");
const UNIT3 = "ZQ-contenido-unidad3".padEnd(4096, ".");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Teléfono de mentira: claves de AsyncStorage + archivos en memoria. Las dependencias que recibe el runner NO tienen operación de borrar o escribir. */
function makePhone(over: { files?: Record<string, string>; keys?: Record<string, string | null> } = {}) {
  const source = buildMobileBackup();
  const phone = buildPhoneExtraction() as unknown as { materials: Row[]; deviceLocal: Record<string, string> };
  const keys: Record<string, string | null> = {
    [KEYS.lessons]: JSON.stringify(source.pedagogicalLessons),
    [KEYS.reports]: JSON.stringify(source.reportRecords),
    [KEYS.materials]: JSON.stringify(phone.materials),
    ...phone.deviceLocal,
    ...over.keys,
  };
  const files: Record<string, string> = {
    "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf": GUIDE,
    "file:///data/user/0/host.exp.exponent/files/attachments/matatt-1.pdf": UNIT3,
    "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf": "ZQ-contenido-reporte",
    ...over.files,
  };
  return { keys, files };
}

function makeWorld(phone = makePhone(), opts: { failUploads?: Set<string>; noRegisteredRows?: boolean } = {}) {
  const storage = new Map<string, Uint8Array>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = {
    attachments: new Map<string, string>([["les-1:att-1", "pendiente"]]),
    materials: new Map<string, string>(),
    reportPdf: new Map<string, string | null>([["rep-1", null]]),
    results: [] as Row[],
    device: [] as Row[],
  };
  const keyLog: string[] = [];
  const deps: RunnerDeps = {
    readKey: async (k) => {
      keyLog.push(k);
      return phone.keys[k] ?? null;
    },
    fileInfo: async (uri) => (uri in phone.files ? { exists: true, size: phone.files[uri].length } : { exists: false, size: null }),
    readBytes: async (uri) => new TextEncoder().encode(phone.files[uri]),
    sha256Hex: async (bytes) => createHash("sha256").update(bytes).digest("hex"),
    ownerId: async () => OWNER,
    listReports: async () => (opts.noRegisteredRows ? [] : [{ id: REPORT_UUID, student_id: STUDENT_UUID, legacy_mobile_id: "rep-1" }]),
    upload: async (bucket, path, bytes) => {
      if (opts.failUploads?.has(path)) return { error: { message: "boom" } };
      const full = `${bucket}/${path}`;
      if (storage.has(full)) return { error: { message: "The resource already exists", statusCode: "409" } };
      storage.set(full, bytes);
      return { error: null };
    },
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "import_phone_extraction") {
        const payload = args.p_payload as { materials: Row[]; deviceLocal: Record<string, string> };
        let inserted = 0;
        for (const m of payload.materials) {
          if (!db.materials.has(String(m.id))) {
            db.materials.set(String(m.id), m.attachment ? "pendiente" : "sin_archivo");
            inserted += 1;
          }
        }
        db.device.push(payload.deviceLocal);
        return { data: { materials_received: payload.materials.length, materials_inserted: inserted }, error: null };
      }
      if (name === "register_transfer_file") {
        const kind = String(args.p_kind);
        const id = String(args.p_legacy_id);
        const path = String(args.p_path);
        const bucket = kind === "report_pdf" ? "report-pdfs" : "lesson-files";
        const stored = storage.get(`${bucket}/${path}`);
        if (!stored) return { data: null, error: { message: "El archivo todavía no está en el almacenamiento." } };
        if (stored.length !== args.p_size) return { data: null, error: { message: "El tamaño del archivo subido no coincide." } };
        if (kind === "lesson_attachment") {
          if (!db.attachments.has(id)) return { data: null, error: { message: "No se encontró el elemento al que pertenece el archivo." } };
          db.attachments.set(id, "disponible");
        } else if (kind === "material") db.materials.set(id, "disponible");
        else {
          if (!db.reportPdf.has(id)) return { data: null, error: { message: "No se encontró el reporte." } };
          if (path !== `${OWNER}/${STUDENT_UUID}/${REPORT_UUID}.pdf`) return { data: null, error: { message: "La ruta del archivo no corresponde al reporte." } };
          db.reportPdf.set(id, path);
        }
        return { data: { registered: true }, error: null };
      }
      if (name === "mark_transfer_file_unavailable") {
        const id = String(args.p_legacy_id);
        if (args.p_kind === "lesson_attachment" && db.attachments.get(id) === "pendiente") db.attachments.set(id, "no_disponible");
        if (args.p_kind === "material" && db.materials.get(id) === "pendiente") db.materials.set(id, "no_disponible");
        return { data: { marked: 1 }, error: null };
      }
      if (name === "record_phone_extraction_result") {
        db.results.push(args.p_summary as Row);
        return { data: "id", error: null };
      }
      return { data: null, error: { message: "función desconocida" } };
    },
  };
  return { deps, storage, calls, db, phone, keyLog };
}

test("plan: lista cada adjunto, material con archivo y PDF de reporte con su identificador de origen; las claves locales viajan tal cual", () => {
  const phone = makePhone();
  const plan = buildExtractionPlan({ lessonsRaw: phone.keys[KEYS.lessons], reportsRaw: phone.keys[KEYS.reports], materialsRaw: phone.keys[KEYS.materials], deviceLocal: Object.fromEntries(DEVICE_LOCAL_KEYS.map((k) => [k, phone.keys[k] ?? null])) });
  assert.deepEqual(plan.items.map((i) => [i.kind, i.legacyId, i.mimeType, i.expectedSize]), [
    ["lesson_attachment", "les-1:att-1", "application/pdf", 20480],
    ["material", "mat-1", "application/pdf", 4096],
    ["report_pdf", "rep-1", "application/pdf", null],
  ]);
  assert.equal(plan.manifest.materials.length, 2, "también el material que es sólo una nota");
  assert.deepEqual(Object.keys(plan.manifest.deviceLocal).sort(), ["@teacherflow/live_class_tracking_enabled", "@teacherflow/pending_training_billing_operations", "@teacherflow/reschedule_cancellation_notices"]);
  assert.deepEqual(plan.gates, { pendingOperations: 0, activeClassSession: false });
});

test("plan: operaciones pendientes o una clase en curso se señalan (para el traslado final), y una clave ilegible se informa sin perderse", () => {
  const phone = makePhone({ keys: { [KEYS.pendingTrainingOperations]: JSON.stringify([{ operationId: "op1" }]), [KEYS.activeClassSession]: JSON.stringify({ lessonId: "x" }), [KEYS.materials]: "no es json" } });
  const plan = buildExtractionPlan({ lessonsRaw: phone.keys[KEYS.lessons], reportsRaw: null, materialsRaw: phone.keys[KEYS.materials], deviceLocal: { [KEYS.pendingTrainingOperations]: phone.keys[KEYS.pendingTrainingOperations], [KEYS.activeClassSession]: phone.keys[KEYS.activeClassSession] } });
  assert.deepEqual(plan.gates, { pendingOperations: 1, activeClassSession: true });
  assert.deepEqual(plan.unreadable, [KEYS.materials]);
});

test("extracción completa: sube cada archivo a su ruta, lo registra con su huella y el resultado queda sin errores", async () => {
  const w = makeWorld();
  const summary = await runPhoneExtraction(w.deps);
  assert.equal(summary.complete, true);
  assert.deepEqual(summary.failed, []);
  assert.deepEqual(summary.counts, {
    lesson_attachment: { total: 1, uploaded: 1, alreadyThere: 0, missingAtOrigin: 0, failed: 0 },
    material: { total: 1, uploaded: 1, alreadyThere: 0, missingAtOrigin: 0, failed: 0 },
    report_pdf: { total: 1, uploaded: 1, alreadyThere: 0, missingAtOrigin: 0, failed: 0 },
  });
  assert.equal(summary.materialsReceived, 2);
  assert.equal(summary.materialsInserted, 2);
  assert.deepEqual([...w.storage.keys()].sort(), [
    `lesson-files/${OWNER}/attachments/${sha(GUIDE)}.pdf`,
    `lesson-files/${OWNER}/materials/${sha(UNIT3)}.pdf`,
    `report-pdfs/${OWNER}/${STUDENT_UUID}/${REPORT_UUID}.pdf`,
  ].sort());
  assert.equal(w.db.attachments.get("les-1:att-1"), "disponible");
  assert.equal(w.db.materials.get("mat-1"), "disponible");
  assert.equal(w.db.materials.get("mat-2"), "sin_archivo");
  assert.equal(w.db.reportPdf.get("rep-1"), `${OWNER}/${STUDENT_UUID}/${REPORT_UUID}.pdf`);
  assert.equal(w.db.results.length, 1);
});

test("repetirla no duplica nada: lo ya subido se reconoce y sólo se vuelve a registrar", async () => {
  const w = makeWorld();
  await runPhoneExtraction(w.deps);
  const again = await runPhoneExtraction(w.deps);
  assert.equal(again.complete, true);
  assert.equal(again.materialsInserted, 0);
  assert.deepEqual(Object.values(again.counts).map((c) => [c.uploaded, c.alreadyThere]), [[0, 1], [0, 1], [0, 1]]);
  assert.equal(w.storage.size, 3);
});

test("NO destructiva: lee claves y archivos, y nada más (las dependencias no ofrecen borrar, mover ni escribir en el teléfono)", async () => {
  const w = makeWorld();
  const filesBefore = JSON.stringify(w.phone.files);
  const keysBefore = JSON.stringify(w.phone.keys);
  await runPhoneExtraction(w.deps);
  assert.equal(JSON.stringify(w.phone.files), filesBefore);
  assert.equal(JSON.stringify(w.phone.keys), keysBefore);
  assert.deepEqual(Object.keys(w.deps).sort(), ["fileInfo", "listReports", "onProgress", "ownerId", "readBytes", "readKey", "rpc", "sha256Hex", "upload"].filter((k) => k !== "onProgress").sort());
  assert.ok(w.keyLog.every((k) => k.startsWith("@teacherflow/")));
});

test("un archivo que el teléfono ya no tiene se declara (no queda «pendiente» para siempre) y no frena al resto", async () => {
  const phone = makePhone();
  delete phone.files["file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf"];
  delete phone.files["file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf"];
  const w = makeWorld(phone);
  const summary = await runPhoneExtraction(w.deps);
  assert.deepEqual(summary.missingAtOrigin.sort(), ["attachment:les-1:att-1", "report:rep-1"]);
  assert.equal(w.db.attachments.get("les-1:att-1"), "no_disponible");
  assert.equal(w.db.materials.get("mat-1"), "disponible", "el material sí estaba");
  assert.equal(summary.complete, true, "faltar en el origen no es un error de la extracción…");
  assert.deepEqual([summary.counts.lesson_attachment.uploaded, summary.counts.lesson_attachment.missingAtOrigin, summary.counts.report_pdf.uploaded, summary.counts.report_pdf.missingAtOrigin], [0, 1, 0, 1], "…pero esos archivos NO figuran como copiados: se declaran aparte");
});

test("un fallo de subida de un archivo no frena a los demás y queda informado por identificador", async () => {
  const guide = `${OWNER}/attachments/${sha(GUIDE)}.pdf`;
  const w = makeWorld(makePhone(), { failUploads: new Set([guide]) });
  const summary = await runPhoneExtraction(w.deps);
  assert.equal(summary.complete, false);
  assert.deepEqual(summary.failed, [{ key: "attachment:les-1:att-1", reason: "upload_failed" }]);
  assert.equal(summary.counts.material.uploaded, 1);
  assert.equal(summary.counts.report_pdf.uploaded, 1);
  assert.equal(w.db.attachments.get("les-1:att-1"), "pendiente", "sigue pendiente: el comparador no lo da por disponible");
});

test("un reporte que todavía no se importó a la cuenta no se sube (no hay a dónde asociarlo) y se informa", async () => {
  const w = makeWorld(makePhone(), { noRegisteredRows: true });
  const summary = await runPhoneExtraction(w.deps);
  assert.deepEqual(summary.failed, [{ key: "report:rep-1", reason: "report_not_imported" }]);
  assert.equal([...w.storage.keys()].some((k) => k.startsWith("report-pdfs/")), false);
});

test("un tamaño distinto al guardado por la app NO se copia ni se registra, queda como fallo y IMPIDE «Copia completa»", async () => {
  const phone = makePhone({ files: { "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf": "mas-largo-que-lo-declarado-en-la-app-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } });
  const w = makeWorld(phone);
  const summary = await runPhoneExtraction(w.deps);
  assert.deepEqual(summary.failed, [{ key: "attachment:les-1:att-1", reason: "size_mismatch" }]);
  assert.deepEqual(summary.counts.lesson_attachment, { total: 1, uploaded: 0, alreadyThere: 0, missingAtOrigin: 0, failed: 1 });
  assert.equal(summary.complete, false);
  assert.equal([...w.storage.keys()].some((k) => k.includes("/attachments/")), false, "no se subió nada de ese archivo");
  assert.equal(w.db.attachments.get("les-1:att-1"), "pendiente", "sigue pendiente: el comparador no lo da por disponible");
  assert.equal(summary.counts.material.uploaded, 1, "los demás archivos siguen su curso");
});

test("el tamaño que informa el sistema de archivos debe coincidir con los bytes leídos: si no, es un fallo (no se registra un archivo a medias)", async () => {
  const w = makeWorld();
  const reader = w.deps.readBytes;
  const summary = await runPhoneExtraction({ ...w.deps, readBytes: async (uri) => (await reader(uri)).slice(0, 5) });
  assert.equal(summary.complete, false);
  assert.ok(summary.failed.length >= 2 && summary.failed.every((f) => f.reason === "size_mismatch"));
  assert.equal(w.storage.size, 0);
});

test("el resultado que se guarda en la cuenta lleva sólo identificadores y cantidades: ni nombres ni rutas ni contenido", async () => {
  const w = makeWorld();
  await runPhoneExtraction(w.deps);
  const stored = JSON.stringify(w.db.results);
  for (const secret of ["ZQ guia.pdf", "ZQ Unidad 3", "host.exp.exponent", "file:///", "ZQ-contenido", "ZQ nota del material"]) assert.equal(stored.includes(secret), false, secret);
  assert.match(stored, /"missingAtOrigin":\[\]/);
});

test("prueba previa con un solo archivo: sube sólo ese, no deja constancia de resultado y no cuenta como extracción completa", async () => {
  const w = makeWorld();
  const summary = await runPhoneExtraction(w.deps, { maxItems: 1 });
  assert.equal(summary.trial, true);
  assert.equal(summary.complete, false);
  assert.equal(w.storage.size, 1);
  assert.equal(w.db.results.length, 0);
  const full = await runPhoneExtraction(w.deps);
  assert.equal(full.complete, true);
  assert.equal(w.storage.size, 3, "la extracción completa que sigue no duplica el archivo de la prueba");
  assert.equal(full.counts.lesson_attachment.alreadyThere, 1);
});

test("sin sesión: no sube ni registra nada", async () => {
  const w = makeWorld();
  const summary = await runPhoneExtraction({ ...w.deps, ownerId: async () => "" });
  assert.deepEqual(summary.failed, [{ key: "sesión", reason: "no_session" }]);
  assert.equal(w.storage.size, 0);
  assert.equal(w.calls.length, 0);
});
