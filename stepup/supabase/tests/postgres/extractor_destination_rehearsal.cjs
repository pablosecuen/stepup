// PRUEBA DEL EXTRACTOR CONTRA UN DESTINO AISLADO, antes de importar sobre la cuenta real. Un Postgres REAL aislado (todas las migraciones) con un servidor local que tiene la
// forma de Supabase (sesión, funciones /rest/v1/rpc, lectura de tablas con RLS y almacenamiento con sus reglas) y, delante, el cliente REAL `@supabase/supabase-js`: lo que corre
// acá es el MISMO código de cuenta que correrá en el teléfono (`lib/phone-extraction/supabase-deps.ts`) más el runner probado. Datos SINTÉTICOS.
//
// Lo que NO puede probar (y por eso sigue siendo obligatoria la prueba con UN archivo en el teléfono): la lectura de archivos de Expo (`File`), el SHA-256 de expo-crypto y la subida desde
// React Native (fetch de RN con un ArrayBuffer). Todo lo demás —nombres de parámetros, forma de los errores, «ya existe», rutas, reglas de acceso, registro y veredicto— sí.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/extractor_destination_rehearsal.cjs
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");

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

const { startShim } = require("./storage_shim.cjs");


async function main() {
  const { createClient } = require(path.join(ROOT, "node_modules", "@supabase", "supabase-js"));
  const { buildMobileBackup, buildPhoneExtraction } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const { validateBackupPayload } = await mod("lib/backup/validation.ts");
  const { compareTransfer, DESTINATION_TABLES } = await mod("lib/backup/transfer-compare.ts");
  const { runPhoneExtraction } = await mod("lib/phone-extraction/runner.ts");
  const { supabaseDeps } = await mod("lib/phone-extraction/supabase-deps.ts");

  const A = H.A;
  const B = "00000000-0000-4000-8000-0000000000b2";
  const source = buildMobileBackup();
  const phone = buildPhoneExtraction();
  const GUIDE = "ZQ-contenido-guia".padEnd(20480, ".");
  const UNIT3 = "ZQ-contenido-unidad3".padEnd(4096, ".");
  const REPORT = "ZQ-contenido-reporte";
  const U = {
    guide: "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf",
    unit3: "file:///data/user/0/host.exp.exponent/files/attachments/matatt-1.pdf",
    report: "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf",
  };

  const pg = await start({ port: 5671 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const { admin } = pg;
  await H.reset(admin);
  await admin.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [B, `${B}@example.invalid`]);

  // Importar el respaldo sintético en dos cuentas (A: flujo completo; B: archivos que el teléfono ya no tiene).
  const validation = validateBackupPayload(source);
  if (!validation.ok) throw new Error("el fixture no valida");
  for (const uid of [A, B]) {
    const s = await H.apiSession(pg, uid, 60000);
    const preview = await H.previewOf(s, validation.backup, validation.excludedCollections);
    await H.applyOf(s, preview.preview_id, [], []);
    await s.end();
  }

  const tokens = new Map();
  const hooks = { rpcFailOnce: false };
  const shim = await startShim(pg, tokens, hooks);
  const clientFor = async (uid) => {
    const token = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: uid, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.ZmlybWE`;
    tokens.set(token, uid);
    const client = createClient(shim.url, "clave-anonima-de-prueba", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await client.auth.setSession({ access_token: token, refresh_token: "refresco" });
    if (error) throw new Error("no se pudo iniciar la sesión simulada: " + error.message);
    return client;
  };
  /** Teléfono simulado (claves y archivos en memoria) + el código REAL de cuenta (cliente de supabase-js). */
  const depsFor = (client, files) => {
    const keys = { "@teacherflow/lessons": JSON.stringify(source.pedagogicalLessons), "@teacherflow/report_history": JSON.stringify(source.reportRecords), "@teacherflow/materials_library": JSON.stringify(phone.materials), ...phone.deviceLocal };
    return {
      readKey: async (k) => keys[k] ?? null,
      fileInfo: async (uri) => (uri in files ? { exists: true, size: files[uri].length } : { exists: false, size: null }),
      readBytes: async (uri) => new TextEncoder().encode(files[uri]),
      sha256Hex: async (bytes) => sha256(Buffer.from(bytes)),
      ...supabaseDeps(client),
    };
  };
  const dump = async (uid) => {
    const out = {};
    for (const t of DESTINATION_TABLES) out[t] = (await admin.query(`select to_jsonb(x) r from public.${t} x where owner_id = $1`, [uid])).rows.map((r) => r.r);
    return out;
  };
  const files = { [U.guide]: GUIDE, [U.unit3]: UNIT3, [U.report]: REPORT };
  const clientA = await clientFor(A);
  check("el cliente real de Supabase inicia sesión contra el destino aislado y la cuenta es la esperada", (await clientA.auth.getUser()).data.user?.id === A);

  // 1) Prueba previa con UN archivo.
  const trial = await runPhoneExtraction(depsFor(clientA, files), { maxItems: 1 });
  check("prueba previa con un solo archivo: sube y registra ese archivo, no deja constancia de resultado y no cuenta como completa", trial.trial && !trial.complete && trial.counts.lesson_attachment.uploaded === 1 && shim.objects.size === 1 && (await admin.query("select count(*)::int n from public.phone_extraction_results where owner_id = $1", [A])).rows[0].n === 0, JSON.stringify(trial.counts));

  // 2) Un archivo con tamaño distinto al declarado por la app: NO se copia y NO hay «Copia completa».
  const mismatched = { ...files, [U.unit3]: UNIT3 + "XXXX" };
  const bad = await runPhoneExtraction(depsFor(clientA, mismatched));
  check("tamaño distinto al declarado: ese archivo NO se copia ni se registra, la extracción NO es completa y los demás siguen", !bad.complete && bad.failed.length === 1 && bad.failed[0].reason === "size_mismatch" && bad.failed[0].key === "material:mat-1" && bad.counts.report_pdf.uploaded === 1 && ![...shim.objects.keys()].some((k) => k.includes("/materials/")), JSON.stringify(bad.failed));
  const materialRow = (await admin.query("select file_status from public.material_library_items where owner_id = $1 and legacy_mobile_id = 'mat-1'", [A])).rows[0];
  check("…y ese material sigue «pendiente» en la cuenta (el comparador no lo da por disponible)", materialRow.file_status === "pendiente");

  // 3) Una falla del servidor al empezar: la extracción se detiene sin subir nada de más y NO se presenta como completa.
  hooks.rpcFailOnce = true;
  const before = shim.objects.size;
  const down = await runPhoneExtraction(depsFor(clientA, files));
  check("falla del servidor al registrar la biblioteca: se detiene, nada se sube de más y no es completa", !down.complete && down.failed.some((f) => f.key === "biblioteca") && shim.objects.size === before);

  // 4) Corrida correcta: los que ya estaban se reconocen por el «ya existe» REAL del almacenamiento.
  const full = await runPhoneExtraction(depsFor(clientA, files));
  check("corrida completa: «Copia completa», los ya subidos se reconocen por el «ya existe» real y los nuevos se suben y registran", full.complete && full.failed.length === 0 && full.counts.lesson_attachment.alreadyThere === 1 && full.counts.report_pdf.alreadyThere === 1 && full.counts.material.uploaded === 1, JSON.stringify(full));
  const keysStored = [...shim.objects.keys()].sort();
  check("el almacenamiento tiene exactamente las 3 copias, en sus rutas y con el contenido idéntico al del teléfono", keysStored.length === 3 && shim.objects.get(`lesson-files/${A}/attachments/${sha256(GUIDE)}.pdf`)?.toString() === GUIDE && shim.objects.get(`lesson-files/${A}/materials/${sha256(UNIT3)}.pdf`)?.toString() === UNIT3 && [...shim.objects.entries()].some(([k, v]) => k.startsWith(`report-pdfs/${A}/`) && v.toString() === REPORT), keysStored.join(" | ").replace(/[0-9a-f]{64}/g, "<huella>"));
  const again = await runPhoneExtraction(depsFor(clientA, files));
  check("repetir la extracción: idempotente (nada nuevo en el almacenamiento)", again.complete && shim.objects.size === 3 && again.counts.lesson_attachment.uploaded === 0);

  // 5) Cotejo origen ↔ destino de la cuenta A: COMPLETO, y la web lo puede consultar (URL firmable: el objeto existe en la ruta registrada).
  const cmp = compareTransfer(source, await dump(A), { adapterOmitted: validation.adaptation.omitted, revealValues: true });
  check("cotejo origen ↔ destino de la cuenta A tras la extracción: COMPLETO (sin diferencias ni archivos pendientes)", cmp.verdict.complete && cmp.verdict.absentAtOrigin === 0, JSON.stringify(cmp.verdict.reasons));
  const registered = (await admin.query("select storage_path from public.lesson_attachments where owner_id = $1 and file_status = 'disponible' union all select storage_path from public.material_library_items where owner_id = $1 and file_status = 'disponible' union all select pdf_url from public.report_records where owner_id = $1 and pdf_url is not null", [A])).rows.map((r) => r.storage_path);
  const inStorage = (await admin.query("select bucket_id || '/' || name n from storage.objects where owner = $1", [A])).rows.map((r) => r.n);
  check("cada ruta registrada en la cuenta existe de verdad en el almacenamiento (lo que la web abrirá con la URL firmada)", registered.length === 3 && registered.every((p) => inStorage.some((n) => n.endsWith(p))), String(registered.length));

  // 6) Cuenta B: archivos que el teléfono YA NO tiene → declarados como ausentes, no migrados.
  const clientB = await clientFor(B);
  const lost = { [U.unit3]: UNIT3 };
  const resultB = await runPhoneExtraction(depsFor(clientB, lost));
  const cmpB = compareTransfer(source, await dump(B), { adapterOmitted: validation.adaptation.omitted, revealValues: true });
  check("archivos ausentes en el teléfono: se declaran como tales (2), NO figuran como copiados ni disponibles, y el veredicto los informa aparte", resultB.complete && resultB.missingAtOrigin.length === 2 && resultB.counts.lesson_attachment.uploaded === 0 && resultB.counts.report_pdf.uploaded === 0 && cmpB.verdict.complete && cmpB.verdict.absentAtOrigin === 2 && cmpB.files.find((f) => f.kind === "adjunto").available === 0 && cmpB.files.find((f) => f.kind === "reporte_pdf").available === 0, JSON.stringify({ missing: resultB.missingAtOrigin, absent: cmpB.verdict.absentAtOrigin }));

  // 7) Reglas de acceso del almacenamiento: una cuenta no puede escribir en la carpeta de otra.
  const intruder = await clientA.storage.from("lesson-files").upload(`${B}/attachments/x.pdf`, new Uint8Array([1, 2, 3]).buffer, { contentType: "application/pdf", upsert: false });
  check("una cuenta no puede subir archivos a la carpeta de otra (el almacenamiento lo rechaza)", intruder.error !== null && shim.objects.has(`lesson-files/${B}/attachments/x.pdf`) === false);

  await shim.stop();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
