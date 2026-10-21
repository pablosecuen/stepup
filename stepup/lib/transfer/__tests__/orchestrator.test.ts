import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkImportPreview } from "../import-preview-check.ts";
import { backupPhase, filesPhase, importPhase, probeSchema, protectionPhase, waitSchemaPhase, type TransferClient, type TransferDeps } from "../orchestrator.ts";
import { buildCopyModule, parsePhoneCopyReport, parsePhoneProtectionReport } from "../phone-copy-module.ts";
import { openSession, type AuthClient } from "../session.ts";
import { checkStorageCapacity, describeCapacity, GIB, MIB } from "../storage-capacity.ts";
import { createMemoryStateStore } from "../state-file.ts";
import { verifyStoredFiles } from "../stored-files.ts";

/** Piezas del orquestador del traslado que no necesitan una base real (el circuito completo está en supabase/tests/postgres/orchestrator_rehearsal.cjs). Sólo datos ficticios. */

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** PostgREST de mentira mínimo: select/eq/order/limit y recuento (lo que usa la lectura paginada de la web). */
function fakeClient(tables: Record<string, Array<Record<string, unknown>>>, storage: Record<string, Uint8Array> = {}, options: { rpc?: (fn: string) => { data?: unknown; error?: { message: string; code?: string } | null } } = {}): TransferClient {
  return {
    from(table: string) {
      return {
        select(_columns?: string, opts?: { count?: "exact" }) {
          let rows = tables[table];
          const builder: any = {
            eq: (c: string, v: unknown) => ((rows = rows?.filter((r) => r[c] === v)), builder),
            order: () => builder,
            limit: () => builder,
            gt: () => builder,
            lt: () => builder,
            or: () => builder,
            then: (resolve: (v: unknown) => unknown) =>
              resolve(rows === undefined ? { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${table}'` } } : { data: rows, error: null, count: opts?.count ? rows.length : null }),
          };
          return builder;
        },
      };
    },
    rpc: (fn: string) => Promise.resolve({ data: null, error: null, ...(options.rpc?.(fn) ?? {}) }),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          const bytes = storage[`${bucket}/${path}`];
          return bytes ? { data: new Blob([bytes as BlobPart]), error: null } : { data: null, error: { message: "not found" } };
        },
      }),
    },
  } as unknown as TransferClient;
}

test("capacidad: lo que entra en el cupo mínimo de cualquier plan pasa; lo que no, se frena con la cuenta clara", () => {
  const ok = checkStorageCapacity({ requiredBytes: 171 * MIB, usedBytes: 1 * MIB, largestFileBytes: 4.6 * MIB });
  assert.equal(ok.ok, true);
  assert.equal(ok.quotaBytes, 1 * GIB);
  assert.match(describeCapacity(ok), /16\.8% del cupo mínimo.*entra con margen/);
  const tooMuch = checkStorageCapacity({ requiredBytes: 950 * MIB, usedBytes: 100 * MIB, largestFileBytes: 1 * MIB });
  assert.equal(tooMuch.ok, false);
  assert.match(tooMuch.reasons.join(" "), /No entra en el almacenamiento: faltan/);
  assert.equal(checkStorageCapacity({ requiredBytes: MIB, usedBytes: 0, largestFileBytes: 21 * MIB }).ok, false, "un archivo sobre el tope del bucket nunca entra");
  assert.equal(checkStorageCapacity({ requiredBytes: 100, usedBytes: 0, largestFileBytes: 100, quotaBytes: 50 }).ok, false, "el cupo medido puede indicarse");
});

test("vista previa de la importación: sólo avanza sin conflictos, duplicados, filas que no se agregan ni omisiones", () => {
  const clean = { maestros: { students: { inserts: [{}, {}], conflicts: [], duplicates: [] } }, aggregates: { lesson_registrations: [{ legacy_mobile_id: "a", status: "insertable" }] } };
  assert.equal(checkImportPreview(clean, 0).ok, true);
  assert.equal(checkImportPreview(clean, 0).studentsToAdd, 2);
  const dirty = { maestros: { students: { inserts: [], conflicts: [{}], duplicates: [{}, {}] } }, aggregates: { calendar_lessons: [{ legacy_mobile_id: "c1", status: "blocked", reason: "alumno_inexistente" }] } };
  const check = checkImportPreview(dirty, 3);
  assert.equal(check.ok, false);
  assert.deepEqual([check.conflicts, check.duplicates, check.notInsertable.length, check.omittedByAdapter], [1, 2, 1, 3]);
  assert.match(check.reasons.join(" "), /alumno_inexistente/);
  assert.doesNotMatch(JSON.stringify(check), /ZQ/);
});

test("el teléfono es un dato externo: sólo se acepta un informe con la forma esperada; «error» significa que no pudo empezar", () => {
  const kind = { total: 1, uploaded: 1, alreadyThere: 0, missingAtOrigin: 0, failed: 0 };
  const good = { trial: false, complete: true, counts: { lesson_attachment: kind, material: kind, report_pdf: kind }, failed: [], missingAtOrigin: ["attachment:x"], actualFormats: { jpeg: 2 }, gates: { pendingOperations: 0, activeClassSession: false }, unreadable: 0 };
  const parsed = parsePhoneCopyReport(good);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsePhoneCopyReport({ error: "sin_sesion" }), { ok: false, error: "sin_sesion" });
  assert.deepEqual(parsePhoneCopyReport({ counts: {} }), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(parsePhoneCopyReport(null), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(parsePhoneCopyReport({ ...good, counts: { ...good.counts, material: { total: "1" } } }), { ok: false, error: "respuesta_invalida" });
});

test("el módulo temporal del teléfono copia SIN borrar ni tocar la cuenta salvo con su propia sesión y sólo informa cantidades a la red local", () => {
  const text = buildCopyModule({ targets: ["http://192.168.1.5:47001"], token: "abc123", mode: "trial" });
  assert.match(text, /runPhoneExtraction\(deps, MODE === 'trial' \? \{ maxItems: 1, prefer: 'image\/heic' \} : \{\}\)/);
  assert.match(text, /createPhoneExtractionDeps\(/);
  assert.doesNotMatch(text, /console\.|deleteAsync|\.delete\(|remove\(|moveAsync|signOut|setSession|password|email/i, "no borra, no mueve, no cierra sesiones, no maneja credenciales");
  assert.equal([...text.matchAll(/fetch\(/g)].length, 1, "una sola salida de red: el receptor local");
  assert.match(text, /unreadable: summary\.unreadable\.length/, "sólo la cantidad de claves ilegibles");
  assert.match(buildCopyModule({ targets: [], token: "t", mode: "full" }), /const MODE: 'trial' \| 'full' \| 'protection' = "full"/);
});

test("sesión única: las credenciales se usan al iniciar, sólo se reutilizan en memoria si caduca, y se sueltan al cerrar", async () => {
  const calls: Array<[string, string]> = [];
  let signedOut = false;
  const client = { auth: { signInWithPassword: async (c: { email: string; password: string }) => (calls.push([c.email, c.password]), { data: { user: { id: "u1" } }, error: null }), signOut: async () => void (signedOut = true) } } as unknown as AuthClient;
  const session = await openSession({ createClient: () => client, email: "a@example.invalid", password: "clave" });
  assert.equal(session.ownerId, "u1");
  assert.equal(session.signInCount, 1);
  await session.reauthenticate();
  assert.deepEqual(calls, [["a@example.invalid", "clave"], ["a@example.invalid", "clave"]]);
  await session.dispose();
  assert.equal(signedOut, true);
  await assert.rejects(() => session.reauthenticate(), /No se pudo iniciar sesión/, "sin credenciales en memoria ya no puede volver a entrar");
  const bad = { auth: { signInWithPassword: async () => ({ data: null, error: { status: 400, code: "invalid_credentials" } }), signOut: async () => {} } } as unknown as AuthClient;
  await assert.rejects(() => openSession({ createClient: () => bad, email: "x@example.invalid", password: "mal" }), /No se pudo iniciar sesión/);
});

function depsWith(client: TransferClient, extra: Partial<TransferDeps> = {}): TransferDeps & { logs: string[] } {
  const logs: string[] = [];
  let t = 0;
  return {
    session: { client, ownerId: "owner-1", reauthenticate: async () => {} },
    state: createMemoryStateStore(),
    now: () => new Date(1_000_000 + (t += 1000)),
    log: (l) => logs.push(l),
    sleep: async () => {},
    saveCopy: () => ({ file: "x", bytes: 1 }),
    phone: { run: async () => ({ state: "sin_respuesta" as const }) },
    schemaWaitMs: 3000,
    schemaPollMs: 1,
    logs,
    ...extra,
  };
}

test("espera de migraciones: detecta las tablas y funciones que faltan y se frena con un motivo claro si no llegan", async () => {
  const missingFn = fakeClient({ origin_incidents: [] }, {}, { rpc: (fn) => (fn === "get_transfer_state" ? { error: { code: "PGRST202", message: "Could not find the function" } } : {}) });
  const probe = await probeSchema(depsWith(missingFn));
  assert.equal(probe.ready, false);
  assert.ok(probe.missing.includes("lesson_attachments") && probe.missing.includes("función get_transfer_state") && probe.missing.includes("account_transfer_state"));
  const waited = await waitSchemaPhase(depsWith(missingFn));
  assert.equal(waited.ok, false);
  assert.match(waited.blocker ?? "", /todavía faltan migraciones/);
  const allThere = Object.fromEntries(["lesson_attachments", "student_source_extras", "material_library_items", "device_local_snapshots", "phone_extraction_results", "origin_incidents", "legacy_cloud_backup_archive", "account_transfer_state"].map((t) => [t, []]));
  assert.equal((await waitSchemaPhase(depsWith(fakeClient(allThere)))).ok, true);
});

test("deshacer una importación que NO es segura se informa con las tablas afectadas y no se toca nada", async () => {
  const calls: string[] = [];
  const client = fakeClient({ import_runs: [{ id: "run-1", owner_id: "owner-1", status: "applied", undone_at: null, created_at: "2026-10-20" }], report_records: [] });
  (client as any).rpc = async (fn: string) => {
    calls.push(fn);
    if (fn === "preview_undo_backup_import") return { data: [{ undo_preview_id: "u1", is_safe: false, unsafe_rows: [{ table_name: "lesson_attachments", reason: "editada después de la importación" }] }], error: null };
    if (fn === "fetch_own_latest_cloud_backup") return { data: [{ id: "b1", schema_version: 2, app_version: "1", checksum: "c", created_at: "2026-10-20T00:00:00Z", payload: {} }], error: null };
    return { data: null, error: null };
  };
  const deps = depsWith(client);
  const result = await importPhase(deps, { redo: true });
  assert.equal(result.ok, false);
  assert.match(result.blocker ?? "", /NO es seguro.*lesson_attachments: editada después de la importación.*no se toca nada/);
  assert.equal(calls.includes("apply_undo_backup_import"), false, "no se deshizo nada");
  assert.equal(calls.includes("apply_backup_import"), false, "no se importó nada");
});

test("integridad: huella, tamaño y formato se comprueban de nuevo desde la cuenta; pendientes y ausentes se declaran aparte; nada se da por copiado sin verificar", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const pdf = new TextEncoder().encode("%PDF-1.4 ficticio");
  const text = new TextEncoder().encode("esto no es un pdf");
  const tables = {
    lesson_attachments: [
      { id: "1", owner_id: "owner-1", legacy_mobile_id: "ok", kind: "image", storage_path: "owner-1/attachments/a.jpg", sha256: sha(jpeg), stored_size_bytes: jpeg.length, file_status: "disponible" },
      { id: "2", owner_id: "owner-1", legacy_mobile_id: "mala-huella", kind: "pdf", storage_path: "owner-1/attachments/b.pdf", sha256: "0".repeat(64), stored_size_bytes: pdf.length, file_status: "disponible" },
      { id: "3", owner_id: "owner-1", legacy_mobile_id: "mal-tamano", kind: "pdf", storage_path: "owner-1/attachments/b.pdf", sha256: sha(pdf), stored_size_bytes: 999, file_status: "disponible" },
      { id: "4", owner_id: "owner-1", legacy_mobile_id: "no-es-pdf", kind: "pdf", storage_path: "owner-1/attachments/t.pdf", sha256: sha(text), stored_size_bytes: text.length, file_status: "disponible" },
      { id: "5", owner_id: "owner-1", legacy_mobile_id: "falta", kind: "image", storage_path: "owner-1/attachments/no-esta.jpg", sha256: sha(jpeg), stored_size_bytes: jpeg.length, file_status: "disponible" },
      { id: "6", owner_id: "owner-1", legacy_mobile_id: "pendiente", kind: "image", storage_path: null, sha256: null, stored_size_bytes: null, file_status: "pendiente" },
      { id: "7", owner_id: "owner-1", legacy_mobile_id: "ausente", kind: "image", storage_path: null, sha256: null, stored_size_bytes: null, file_status: "no_disponible" },
      { id: "8", owner_id: "owner-1", legacy_mobile_id: "ok", kind: "image", storage_path: "owner-1/attachments/a.jpg", sha256: sha(jpeg), stored_size_bytes: jpeg.length, file_status: "disponible" },
    ],
    material_library_items: [],
    report_records: [{ id: "r1", owner_id: "owner-1", legacy_mobile_id: "rep", pdf_url: "owner-1/s/r1.pdf" }],
  };
  const storage = { "lesson-files/owner-1/attachments/a.jpg": jpeg, "lesson-files/owner-1/attachments/b.pdf": pdf, "lesson-files/owner-1/attachments/t.pdf": text, "report-pdfs/owner-1/s/r1.pdf": pdf };
  const result = await verifyStoredFiles(fakeClient(tables, storage) as never, "owner-1");
  const byKey = Object.fromEntries(result.problems.map((p) => [p.key, p.problem]));
  assert.deepEqual(byKey, { "adjunto:mala-huella": "hash_differs", "adjunto:mal-tamano": "size_differs", "adjunto:no-es-pdf": "format_differs", "adjunto:falta": "not_downloadable" });
  assert.deepEqual(result.pending, [{ key: "adjunto:pendiente" }]);
  assert.deepEqual(result.absent, [{ key: "adjunto:ausente" }]);
  assert.deepEqual(result.duplicateIds, ["adjunto:ok"], "un identificador de origen repetido se detecta");
  assert.equal(result.verified, 3, "ok ×2 (mismo contenido) y el PDF del reporte");
  assert.equal(result.downloaded, 4, "el archivo compartido se descarga una sola vez");
  assert.doesNotMatch(JSON.stringify(result), /owner-1\/|a\.jpg/, "sin rutas en el informe");
});

test("copia de archivos: si el teléfono no responde, nada se da por copiado y se puede repetir; el cupo se mira ANTES de llamar al teléfono", async () => {
  const tables = { lesson_attachments: [{ id: "1", owner_id: "owner-1", legacy_mobile_id: "x", size_bytes: 1000, stored_size_bytes: null, file_status: "pendiente" }], material_library_items: [], report_records: [] };
  let phoneCalls = 0;
  const deps = depsWith(fakeClient(tables), { phone: { run: async () => (phoneCalls++, { state: "sin_respuesta" as const }) } });
  const r = await filesPhase(deps);
  assert.equal(r.ok, false);
  assert.match(r.blocker ?? "", /no respondió/);
  assert.equal(phoneCalls, 1);
  assert.equal(deps.state.read().files?.trialVerifiedAt, undefined);
  const noRoom = depsWith(fakeClient(tables), { quotaBytes: 500, phone: { run: async () => (phoneCalls++, { state: "sin_respuesta" as const }) } });
  assert.match((await filesPhase(noRoom)).blocker ?? "", /No entra/);
  assert.equal(phoneCalls, 1, "con el cupo insuficiente no se llamó al teléfono");
});

test("copias previas: un volcado del destino incompleto aborta y NO se guarda como si fuera una copia buena", async () => {
  const saved: string[] = [];
  const client = fakeClient(
    Object.fromEntries(["lesson_registrations", "students"].map((t) => [t, []])),
  );
  (client as any).rpc = async () => ({ data: [{ id: "b1", schema_version: 2, app_version: "1", checksum: "huella-1", created_at: "2026-10-20T00:00:00Z", payload: { students: [] } }], error: null });
  const deps = depsWith(client, { saveCopy: (kind, label) => (saved.push(`${kind}:${label}`), { file: "f", bytes: 10 }) });
  // Las tablas del destino que no existen en esta base de mentira abortan el volcado: se comprueba que NO se guarda una copia a medias.
  await assert.rejects(() => backupPhase(deps, "previa"), /No se pudo leer/);
  assert.deepEqual(saved, [], "un volcado incompleto no se guarda como copia buena");
});

test("pausa de carga: el teléfono confirma por su marcador de protección que todo lo cargado ya está respaldado; si no, no se avanza", async () => {
  const protectedReport = { present: true, localRevision: 5, lastProtectedRevision: 5, pendingFileUploads: 2, dirty: false, lastSuccessfulProtectionAt: "2026-10-20T10:00:00Z" };
  const make = (answers: Array<unknown>, extra: Partial<TransferDeps> = {}) => {
    let i = 0;
    return depsWith(fakeClient({}), {
      protectionWaitMs: 5000,
      protectionRetryMs: 1,
      phone: { run: async () => ({ state: "sin_respuesta" as const }), checkProtection: async () => (answers[Math.min(i++, answers.length - 1)] as never) },
      ...extra,
    });
  };
  const ok = make([{ state: "listo", protection: protectedReport }]);
  assert.equal((await protectionPhase(ok)).ok, true);
  assert.match(ok.logs.join(" "), /Pausa de carga verificada.*2 archivo\(s\) por subir/);
  assert.equal(ok.state.read().protection?.localRevision, 5);
  const pendingThenProtected = make([{ state: "listo", protection: { ...protectedReport, lastProtectedRevision: 4 } }, { state: "sin_respuesta" }, { state: "listo", protection: protectedReport }]);
  assert.equal((await protectionPhase(pendingThenProtected)).ok, true, "espera a que la app suba su respaldo");
  assert.match(pendingThenProtected.logs.join(" "), /SIN respaldar/);
  assert.match(pendingThenProtected.logs.join(" "), /Abrí Expo Go/);
  const dirtyForever = make([{ state: "listo", protection: { ...protectedReport, dirty: true } }]);
  const blocked = await protectionPhase(dirtyForever);
  assert.equal(blocked.ok, false);
  assert.match(blocked.blocker ?? "", /No se pudo confirmar.*TODO lo cargado.*No se importó nada/);
  const silent = make([{ state: "sin_respuesta" }]);
  assert.match((await protectionPhase(silent)).blocker ?? "", /Abrí Expo Go/);
  const absent = make([{ state: "listo", protection: { ...protectedReport, present: false } }]);
  assert.equal((await protectionPhase(absent)).ok, true);
  assert.equal((await protectionPhase(depsWith(fakeClient({})))).ok, true, "sin canal del teléfono no se exige");
});

test("el informe de protección del teléfono sólo se acepta con la forma esperada y el módulo de lectura no escribe ni toca la cuenta", () => {
  const good = { protection: { present: true, localRevision: 3, lastProtectedRevision: 3, pendingFileUploads: 0, dirty: false, lastSuccessfulProtectionAt: null } };
  assert.equal(parsePhoneProtectionReport(good).ok, true);
  assert.deepEqual(parsePhoneProtectionReport({ error: "fallo_en_el_telefono" }), { ok: false, error: "fallo_en_el_telefono" });
  assert.deepEqual(parsePhoneProtectionReport({ protection: { present: true, localRevision: "3" } }), { ok: false, error: "respuesta_invalida" });
  assert.deepEqual(parsePhoneProtectionReport(null), { ok: false, error: "respuesta_invalida" });
  const text = buildCopyModule({ targets: ["http://192.168.1.5:47001"], token: "ab", mode: "protection" });
  assert.match(text, /@teacherflow\/protection_state/);
  assert.doesNotMatch(text, /runPhoneExtraction|createPhoneExtractionDeps|getSupabaseClient|\.rpc\(|\.upload\(|setItem|removeItem|console\./i);
  assert.equal([...text.matchAll(/fetch\(/g)].length, 1);
  assert.doesNotMatch(text, /studentId|amount|attachments|lessons/, "sin datos de alumnos, clases ni importes");
});
