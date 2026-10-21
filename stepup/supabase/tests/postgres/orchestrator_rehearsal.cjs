// ENSAYO DEL ORQUESTADOR DEL TRASLADO DE PUNTA A PUNTA con datos SINTÉTICOS. Un Postgres REAL aislado (todas las migraciones) con un servidor local con la forma de Supabase
// (sesión por contraseña y refresco, funciones, lecturas con filtros y orden, almacenamiento) y, delante, el cliente REAL `@supabase/supabase-js` y el código REAL del orquestador,
// de las copias cifradas con Windows DPAPI y del canal con el teléfono (módulo temporal + receptor local). El teléfono es un simulador en memoria que corre el MISMO `runPhoneExtraction`.
//
// Recorre: respaldar → esperar migraciones → archivo permanente → importar (con falla simulada y vuelta atrás automática) → copiar archivos (prueba de 1 archivo y copia completa, con
// interrupciones) → verificar integridad → cambios posteriores → rehacer con la copia más reciente → cotejo final. Comprueba que las credenciales se usan UNA vez, que no se duplica ni se
// pierde nada y que nunca se congela ni se borra el origen.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/orchestrator_rehearsal.cjs
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");
const { startShim } = require("./storage_shim.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { createClient } = require(path.join(ROOT, "node_modules", "@supabase", "supabase-js"));
  const { buildMobileBackup, buildPhoneExtraction } = await mod("lib/backup/__fixtures__/mobile-real-shape.ts");
  const orch = await mod("lib/transfer/orchestrator.ts");
  const { openSession } = await mod("lib/transfer/session.ts");
  const { createMemoryStateStore } = await mod("lib/transfer/state-file.ts");
  const { createDpapiSaver } = await mod("lib/transfer/save-copy.ts");
  const { supabaseDeps } = await mod("lib/phone-extraction/supabase-deps.ts");
  const { runPhoneExtraction } = await mod("lib/phone-extraction/runner.ts");
  const { createPhoneChannel } = await mod("tools/transfer/phone-copy.mjs");

  const FIX = path.join(ROOT, "lib", "images", "__tests__", "fixtures");
  const img = (name) => fs.readFileSync(path.join(FIX, name));
  const A = H.A;
  const EMAIL = "usuaria.ficticia@example.invalid";
  const PASSWORD = "Clave-Ficticia-123!";

  // ── Origen sintético: la fixture real-shape + 6 fotos (2 HEIC reales, 2 JPEG y 1 PNG declarados «image/heic», y 1 que el teléfono ya no tiene).
  const GUIDE = "%PDF-1.4 ZQ-contenido-guia".padEnd(20480, ".");
  const UNIT3 = "%PDF-1.4 ZQ-contenido-unidad3".padEnd(4096, ".");
  const REPORT = "%PDF-1.4 ZQ-contenido-reporte";
  const phoneData = buildPhoneExtraction();
  const photoFiles = {
    "file:///var/mobile/att/foto-1.jpg": img("plana.heic"),
    "file:///var/mobile/att/foto-2.jpg": img("orientada.heic"),
    "file:///var/mobile/att/foto-3.jpg": img("plana.jpg"),
    "file:///var/mobile/att/foto-4.jpg": img("orientada.jpg"),
    "file:///var/mobile/att/foto-5.jpg": img("plana.png"),
  };
  const files = {
    "file:///data/user/0/host.exp.exponent/files/ZQ-guia.pdf": Buffer.from(GUIDE),
    "file:///data/user/0/host.exp.exponent/files/attachments/matatt-1.pdf": Buffer.from(UNIT3),
    "file:///data/user/0/host.exp.exponent/files/ZQ-reporte.pdf": Buffer.from(REPORT),
    ...photoFiles,
  };
  const buildSource = () => {
    const s = buildMobileBackup();
    const attachments = Object.entries(photoFiles).map(([uri, bytes], i) => ({ id: `att-foto-${i + 1}`, name: `ZQ IMG_000${i + 1}.HEIC`, uri, addedAt: "2026-10-13T14:00:00.000Z", kind: "image", mimeType: "image/heic", sizeBytes: bytes.length, caption: null, studentId: "stu-1" }));
    attachments.push({ id: "att-perdida", name: "ZQ IMG_9999.HEIC", uri: "file:///var/mobile/att/perdida.jpg", addedAt: "2026-10-13T14:00:00.000Z", kind: "image", mimeType: "image/heic", sizeBytes: 2048, caption: null, studentId: "stu-1" });
    s.pedagogicalLessons[0].form.activityAttachments.push(...attachments);
    return s;
  };
  const source = buildSource();

  const pg = await start({ port: 5731 });
  if (pg.failures.length) {
    console.log("migraciones con error:", pg.failures);
    process.exit(1);
  }
  const { admin } = pg;
  await H.reset(admin);
  await admin.query("update auth.users set email = $1 where id = $2", [EMAIL, A]);
  const OTHER = "00000000-0000-4000-8000-0000000000c3";
  await admin.query("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", [OTHER, "otra.cuenta@example.invalid"]);

  let backupSeq = 0;
  const addBackup = async (payload) => {
    backupSeq += 1;
    const text = JSON.stringify(payload);
    await admin.query("insert into public.cloud_backups (user_id, device_id, schema_version, app_version, checksum, payload, created_at) values ($1, 'dispositivo-viejo-1', 2, '1.0.0', $2, $3::jsonb, now() + ($4 || ' seconds')::interval)", [A, sha256(text + backupSeq), text, String(backupSeq)]);
  };
  await addBackup(source);

  const tokens = new Map();
  const hooks = { rpcFailOnce: false, passwords: { [EMAIL]: PASSWORD } };
  const shim = await startShim(pg, tokens, hooks);
  const client = () => createClient(shim.url, "clave-anonima-de-prueba", { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tf-orq-copias-"));
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-orq-app-"));
  fs.mkdirSync(path.join(appDir, "src", "features", "transfer"), { recursive: true });
  const ENTRY = path.join(appDir, "src", "features", "transfer", "PhoneTransferEntry.tsx");
  const ENTRY_TEXT = "import React from 'react';\nimport { x } from './x';\n\nexport const A = 1;\n";
  fs.writeFileSync(ENTRY, ENTRY_TEXT);

  // ── Teléfono simulado: al «recargar la app» lee el módulo temporal que el orquestador dejó, y hace lo mismo que él (corre la copia con la sesión del teléfono y la reporta por HTTP).
  const phone = { dieAfterUploads: Infinity, runs: [], moduleSeen: [], protection: { present: true, localRevision: 7, lastProtectedRevision: 7, pendingFileUploads: 0, dirty: false, lastSuccessfulProtectionAt: "2026-10-20T12:00:00Z" } };
  const assertNoAccountAccess = (text) => {
    if (/runPhoneExtraction|createPhoneExtractionDeps|getSupabaseClient|supabase|\.rpc\(|\.upload\(|setItem|removeItem|console\./i.test(text)) throw new Error("el módulo de protección no debe tocar la cuenta ni escribir");
  };
  const phoneClientFor = async () => {
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ sub: A, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, tel: crypto.randomUUID() })}.ZmlybWE`;
    tokens.set(token, A);
    const c = client();
    await c.auth.stopAutoRefresh();
    const { error } = await c.auth.setSession({ access_token: token, refresh_token: "refresco" });
    if (error) throw new Error("sesión del teléfono: " + error.message);
    return c;
  };
  const post = async (targets, p, token, body) => {
    for (const base of targets) {
      try {
        const r = await fetch(`${base}${p}${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (r.ok) return true;
      } catch { /* siguiente */ }
    }
    return false;
  };
  const requestReloadImpl = async () => {
    const text = fs.readFileSync(path.join(appDir, "src", "features", "transfer", "autoCopyTemp.ts"), "utf8");
    phone.moduleSeen.push(text);
    const targets = JSON.parse(/const TARGETS: readonly string\[\] = (\[.*\]);/.exec(text)[1]);
    const token = /const TOKEN = "([0-9a-f]+)";/.exec(text)[1];
    const mode = /const MODE: 'trial' \| 'full' \| 'protection' = "(trial|full|protection)";/.exec(text)[1];
    phone.runs.push(mode);
    if (mode === "protection") {
      // Sólo lectura: el módulo lee el marcador de protección (números) y no toca la cuenta.
      assertNoAccountAccess(text);
      void post(targets, "/resultado/", token, { mode, protection: phone.protection });
      return true;
    }
    void (async () => {
      try {
        const c = await phoneClientFor();
        const keys = { "@teacherflow/lessons": JSON.stringify(source.pedagogicalLessons), "@teacherflow/report_history": JSON.stringify(source.reportRecords), "@teacherflow/materials_library": JSON.stringify(phoneData.materials), ...phoneData.deviceLocal };
        let uploads = 0;
        const base = supabaseDeps(c);
        const deps = {
          readKey: async (k) => keys[k] ?? null,
          fileInfo: async (uri) => (uri in files ? { exists: true, size: files[uri].length } : { exists: false, size: null }),
          readBytes: async (uri) => new Uint8Array(files[uri]),
          sha256Hex: async (bytes) => sha256(Buffer.from(bytes)),
          ...base,
          upload: async (...args) => {
            if (uploads >= phone.dieAfterUploads) throw new Error("TELEFONO_BLOQUEADO");
            const r = await base.upload(...args);
            if (!r.error) uploads += 1;
            return r;
          },
          onProgress: (done, total2) => void post(targets, "/progreso/", token, { done, total: total2 }),
        };
        const summary = await runPhoneExtraction(deps, mode === "trial" ? { maxItems: 1, prefer: "image/heic" } : {});
        await post(targets, "/resultado/", token, { ...summary, unreadable: summary.unreadable.length });
        await c.auth.signOut({ scope: "local" });
      } catch { /* el teléfono se bloqueó: no informa nada */ }
    })();
    return true;
  };
  let phoneCalls = 0;
  const channel = createPhoneChannel({ appDir, requestReloadImpl, firstSignalMs: 2500, stallMs: 2500, addresses: ["127.0.0.1"], log: () => {} });
  const countingChannel = { run: async (mode, o) => { phoneCalls += 1; return channel.run(mode, o); }, checkProtection: async (o) => channel.checkProtection(o) };

  // ── Orquestador con UNA sola sesión (las credenciales se usan una vez).
  const session = await openSession({ createClient: client, email: EMAIL, password: PASSWORD });
  const state = createMemoryStateStore();
  const logs = [];
  const clock = { t: Date.now() };
  const deps = {
    session,
    state,
    now: () => new Date(),
    log: (l) => logs.push(l),
    sleep: (ms) => sleep(Math.min(ms, 50)),
    saveCopy: createDpapiSaver(folder, () => new Date()),
    phone: countingChannel,
    schemaWaitMs: 5000,
    schemaPollMs: 10,
    phoneTimeoutMs: 20000,
  };
  const run = (phases, extra = {}) => orch.runTransfer(deps, { phases, ...extra });
  const count = async (table) => (await admin.query(`select count(*)::int n from public.${table} where owner_id = $1`, [A])).rows[0].n;

  check("una sola sesión: la contraseña se usó una vez al iniciar", hooks.counts.passwordGrants === 1 && session.signInCount === 1);

  // ── Paso 1: respaldos previos (cifrados, recuperación comprobada desde el disco).
  const r1 = await run(["backup"]);
  const encrypted = fs.readdirSync(folder).filter((f) => f.endsWith(".tfdp"));
  check("paso 1: copias del origen y del destino cifradas con DPAPI, verificadas desde el disco y registradas", r1.ok && encrypted.length === 2 && state.snapshot().backups.length === 1, encrypted.join(","));
  check("las copias cifradas no dejan nada legible (ni nombres ni textos del origen)", encrypted.every((f) => !fs.readFileSync(path.join(folder, f)).includes("ZQ Alumna")));

  // ── Esquema: con todas las migraciones aplicadas está listo.
  const probe = await orch.probeSchema(deps);
  check("espera de migraciones: el esquema completo del traslado se reconoce como listo", probe.ready && probe.missing.length === 0, probe.missing.join(","));

  // ── Paso 3: archivo permanente.
  const r3 = await run(["archivo"]);
  check("paso 3: el último respaldo de la nube queda en el archivo permanente (y repetirlo no duplica)", r3.ok && (await run(["archivo"])).ok && (await admin.query("select count(*)::int n from public.legacy_cloud_backup_archive where owner_id = $1", [A])).rows[0].n === 1);

  // ── Paso 4: la importación espera la confirmación del despliegue de la web.
  deps.waitGate = async () => false;
  deps.gateWaitMs = 1;
  const gateClosed = await run(["despliegue", "importar"]);
  check("paso 4: sin la confirmación del despliegue de la web NO se importa nada (la cuenta sigue vacía)", !gateClosed.ok && /confirmación del despliegue/.test(gateClosed.blocker ?? "") && (await count("students")) === 0 && gateClosed.completed.length === 0, gateClosed.blocker);
  deps.waitGate = async () => true;
  check("paso 4: con la confirmación, el circuito sigue", (await run(["despliegue"])).ok);

  // ── Pausa de carga: el teléfono dice si todo lo cargado ya llegó al respaldo de la nube.
  phone.protection = { present: true, localRevision: 9, lastProtectedRevision: 8, pendingFileUploads: 0, dirty: true, lastSuccessfulProtectionAt: "2026-10-20T12:00:00Z" };
  deps.protectionWaitMs = 1200;
  deps.protectionRetryMs = 20;
  const unprotected = await run(["proteccion", "importar"]);
  check("pausa de carga: con cambios SIN respaldar en el teléfono no se importa nada y se pide dejar la app abierta", !unprotected.ok && /SIN respaldar/.test(unprotected.blocker ?? "") && (await count("students")) === 0 && unprotected.completed.length === 0, unprotected.blocker);
  phone.protection = { present: true, localRevision: 9, lastProtectedRevision: 9, pendingFileUploads: 0, dirty: false, lastSuccessfulProtectionAt: "2026-10-20T12:05:00Z" };
  deps.protectionWaitMs = 20000;
  const protectedOk = await run(["proteccion"]);
  check("pausa de carga: con todo respaldado (revisión local = última protegida) el circuito sigue y queda registrado", protectedOk.ok && state.snapshot().protection?.localRevision === 9 && logs.some((l) => /Pausa de carga verificada/.test(l)));
  check("el módulo de lectura del marcador no toca la cuenta ni escribe (sólo números)", phone.moduleSeen.some((m) => /protection_state/.test(m)) && !phone.moduleSeen.filter((m) => /protection_state/.test(m)).some((m) => /runPhoneExtraction|getSupabaseClient|supabase|\.rpc\(|\.upload\(|setItem|removeItem|console\./i.test(m)));

  // ── Paso 5: importación con falla simulada → vuelta atrás automática.
  deps.afterApplyHook = async (origin) => {
    // Simula un defecto de la importación sin tocar la cuenta: se coteja contra un origen donde un alumno figura con otro nombre.
    const changed = structuredClone(origin);
    changed.payload.students[0].name = "ZQ nombre distinto";
    return changed;
  };
  const broken = await run(["importar"]);
  check("paso 5 con una diferencia simulada: el cotejo la detecta (faltan filas), la importación se DESHACE sola y la cuenta queda vacía", !broken.ok && /DESHIZO/.test(broken.blocker ?? "") && (await count("students")) === 0 && (await count("lesson_registrations")) === 0 && !state.snapshot().import, broken.blocker);
  deps.afterApplyHook = undefined;
  const imported = await run(["importar"]);
  const studentsAfter = await count("students");
  check("paso 5: importación limpia con cotejo inmediato (0 defectos, el balance cierra)", imported.ok && studentsAfter > 0 && Boolean(state.snapshot().import?.verifiedAt), imported.blocker);
  const resumed = await run(["importar"]);
  check("reanudar: repetir el paso 5 NO vuelve a importar ni duplica (hay una sola importación aplicada)", resumed.ok && (await count("students")) === studentsAfter && (await admin.query("select count(*)::int n from public.import_runs where owner_id = $1 and status = 'applied' and undone_at is null", [A])).rows[0].n === 1);

  // ── Capacidad de almacenamiento: con un cupo diminuto se frena ANTES de molestar al teléfono.
  const tiny = await orch.filesPhase({ ...deps, quotaBytes: 10_000 });
  check("capacidad: un cupo que no alcanza frena el paso 6 sin llamar al teléfono", !tiny.ok && /No entra/.test(tiny.blocker ?? "") && phoneCalls === 0, tiny.blocker);

  // ── Paso 6: copia desde el teléfono con interrupciones.
  phone.dieAfterUploads = 0;
  const t1 = await run(["archivos"]);
  check("interrupción 1 (el teléfono se bloquea al empezar la prueba): se informa «sin respuesta», no se subió nada y se puede repetir", !t1.ok && /no respondió/.test(t1.blocker ?? "") && shim.objects.size === 0 && !state.snapshot().files?.trialVerifiedAt, t1.blocker);
  phone.dieAfterUploads = 1;
  const t2 = await run(["archivos"]);
  check("prueba con UN archivo verificada (1 objeto, preferencia por HEIC); la copia completa se corta tras 1 archivo más: se informa sin duplicar", !t2.ok && Boolean(state.snapshot().files?.trialVerifiedAt) && /dejó de responder/.test(t2.blocker ?? "") && shim.objects.size === 2, `${t2.blocker} objetos=${shim.objects.size}`);
  const firstObject = [...shim.objects.keys()][0] ?? "";
  check("la prueba prefirió una foto HEIC (la de las cámaras de iPhone)", /\.heic$/.test(firstObject), firstObject.replace(/[0-9a-f]{64}/, "<huella>"));
  phone.dieAfterUploads = 3;
  const t3 = await run(["archivos"]);
  check("interrupción 3 (se corta tras 3 archivos): lo copiado queda a salvo y sigue donde quedó", !t3.ok && shim.objects.size === 5, `${t3.blocker} objetos=${shim.objects.size}`);
  phone.dieAfterUploads = Infinity;
  const t4 = await run(["archivos"]);
  const distinctFiles = new Set(Object.values(files).map((b) => sha256(Buffer.from(b)))).size;
  check("paso 6 completo: todos los archivos copiados, verificados por huella/tamaño/formato y los ausentes declarados", t4.ok && shim.objects.size === distinctFiles && Boolean(state.snapshot().files?.fullVerifiedAt), `${t4.blocker} objetos=${shim.objects.size} esperados=${distinctFiles}`);
  const attRows = (await admin.query("select legacy_mobile_id, file_status, mime_type from public.lesson_attachments where owner_id = $1 order by legacy_mobile_id", [A])).rows;
  check("sin duplicar ni perder: una fila por adjunto, 6 disponibles… y el que el teléfono ya no tenía figura «no_disponible» (ausente, nunca copiado)", attRows.length === new Set(attRows.map((r) => r.legacy_mobile_id)).size && attRows.filter((r) => r.file_status === "disponible").length === 6 && attRows.filter((r) => r.file_status === "no_disponible").length === 1 && attRows.length === 7, JSON.stringify(attRows.map((r) => r.file_status)));
  const storedTypes = [...shim.contentTypes.entries()].filter(([k]) => /\/attachments\//.test(k)).map(([, v]) => v).sort();
  check("formato REAL conservado en el almacenamiento (2 HEIC reales, 2 JPEG, 1 PNG, 1 PDF) aunque la app declaraba todo «image/heic»; la cuenta conserva lo declarado", JSON.stringify(storedTypes) === JSON.stringify(["application/pdf", "image/heic", "image/heic", "image/jpeg", "image/jpeg", "image/png"]) && attRows.filter((r) => r.mime_type === "image/heic").length === 6, JSON.stringify(storedTypes));
  check("el módulo temporal de la app se borró cada vez y la app quedó IDÉNTICA", !fs.existsSync(path.join(appDir, "src", "features", "transfer", "autoCopyTemp.ts")) && fs.readFileSync(ENTRY, "utf8") === ENTRY_TEXT && phone.runs.length >= 5);
  check("el módulo temporal sólo habla con el receptor local y no lleva credenciales ni claves de la cuenta", phone.moduleSeen.every((m) => !m.includes(PASSWORD) && !m.includes(EMAIL) && !/supabase|anon|apikey/i.test(m.replace(/createPhoneExtractionDeps/g, ""))));

  check("capacidad: con el cupo mínimo garantizado de cualquier plan, lo que se copia entra con margen", logs.some((l) => /^Almacenamiento: .*entra con margen/.test(l)));

  // ── Cambios posteriores: se cargó algo en la app anterior DESPUÉS de la copia importada.
  const source2 = buildSource();
  source2.students[1].name = "ZQ Alumno Dos (editado después)";
  source2.profiles["stu-2"].name = "ZQ Alumno Dos (editado después)";
  await addBackup(source2);
  const late = await run(["final"]);
  check("copia final actualizada: un respaldo con datos nuevos se detecta como CAMBIOS POSTERIORES y NO se da por completo ni se congela", !late.ok && /DESPUÉS de la copia importada/.test(late.blocker ?? ""), late.blocker);
  const redo = await run(["importar", "archivos", "final"], { redo: true });
  check("--rehacer: deshace la importación, importa la copia más reciente, vuelve a registrar los archivos (los adjuntos no se duplican: mismo contenido, misma ruta; sólo el PDF del reporte, que lleva el id nuevo del reporte, queda con una copia anterior huérfana AVISADA) y el cotejo final da COMPLETO",redo.ok && redo.final?.complete === true && shim.objects.size === distinctFiles + 1 && logs.some((l) => /huérfanos/.test(l)), `ok=${redo.ok} completo=${redo.final?.complete} objetos=${shim.objects.size}/${distinctFiles} ${redo.blocker ?? ""}`);
  check("el cotejo final reconoce la edición posterior (el destino coincide con la copia MÁS reciente)", (await admin.query("select name from public.students where owner_id = $1 and legacy_mobile_id = 'stu-2'", [A])).rows[0].name.includes("editado después"));

  // ── Credenciales una sola vez, incluso si la sesión caduca durante una ejecución larga.
  check("credenciales: durante TODO el circuito se inició sesión una sola vez", hooks.counts.passwordGrants === 1, String(hooks.counts.passwordGrants));
  hooks.refreshFails = true;
  for (const t of tokens.keys()) hooks.expired.add(t);
  const afterExpiry = await orch.backupPhase(deps, "previa");
  check("sesión caducada: se vuelve a entrar con las credenciales EN MEMORIA (sin pedirlas otra vez) y la operación sigue", afterExpiry.ok && hooks.counts.passwordGrants === 2 && logs.some((l) => /no se piden otra vez/.test(l)));
  await session.dispose();

  // ── El ejecutable real (proceso aparte): credenciales por la ENTRADA ESTÁNDAR una sola vez, una sola sesión para todas las fases, rechazo claro de una contraseña mala.
  const { spawn } = require("child_process");
  const cliFolder = fs.mkdtempSync(path.join(os.tmpdir(), "tf-orq-cli-"));
  const envFile = path.join(cliFolder, "fake.env");
  fs.writeFileSync(envFile, `NEXT_PUBLIC_SUPABASE_URL=${shim.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=clave-publica-ficticia\n`);
  const runCli = (password, phases) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(ROOT, "tools", "transfer", "execute-transfer.mjs"), path.join(cliFolder, "privada"), "--fases", phases, "--app", appDir], { cwd: ROOT, env: { ...process.env, TF_ENV_FILE: envFile }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(JSON.stringify({ email: EMAIL, password }));
    });
  const grantsBefore = hooks.counts.passwordGrants;
  const okCli = await runCli(PASSWORD, "backup,esquema,archivo");
  check("ejecutable real: una sola sesión para todas las fases (credenciales por la entrada estándar), copias cifradas y archivo permanente", okCli.code === 0 && /@@AUTH_OK/.test(okCli.out) && /Fases completadas: backup, esquema, archivo/.test(okCli.out) && /Inicios de sesión en esta ejecución: 1 /.test(okCli.out) && hooks.counts.passwordGrants === grantsBefore + 1 && fs.readdirSync(path.join(cliFolder, "privada")).filter((f) => f.endsWith(".tfdp")).length === 2 && fs.existsSync(path.join(cliFolder, "privada", "estado-traslado.json")), `${okCli.code} ${okCli.out.slice(-300)}`);
  check("ejecutable real: ni la contraseña ni el correo ni datos personales salen por ninguna salida, y el registro de avance no los guarda", !okCli.out.includes(PASSWORD) && !okCli.out.includes(EMAIL) && !/ZQ /.test(okCli.out) && !/ZQ |Clave-Ficticia|@example/.test(fs.readFileSync(path.join(cliFolder, "privada", "estado-traslado.json"), "utf8")));
  const badCli = await runCli("clave-equivocada", "backup");
  check("ejecutable real: una contraseña equivocada se rechaza con un motivo claro (código 10) y no se hace nada más", badCli.code === 10 && /@@AUTH_FAIL\|credentials\|/.test(badCli.out) && !/Fases completadas|──/.test(badCli.out) && !badCli.out.includes("clave-equivocada"));
  const noApp = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "tools", "transfer", "execute-transfer.mjs"), path.join(cliFolder, "privada2"), "--fases", "archivos"], { cwd: ROOT, env: { ...process.env, TF_ENV_FILE: envFile }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(JSON.stringify({ email: EMAIL, password: PASSWORD }));
  });
  check("ejecutable real: la fase del teléfono sin la carpeta de la app se rechaza antes de tocar nada", noApp.code === 1 && /Falta --app/.test(noApp.out) && !/──/.test(noApp.out), noApp.out.slice(-200));
  fs.rmSync(cliFolder, { recursive: true, force: true });

  // ── Nada se congela ni se borra del origen.
  check("el origen no se tocó: sin congelar, todos los respaldos de la nube intactos y copias del origen conservadas", (await admin.query("select count(*)::int n from public.account_transfer_state where owner_id = $1 and status = 'frozen'", [A])).rows[0].n === 0 && (await admin.query("select count(*)::int n from public.cloud_backups where user_id = $1", [A])).rows[0].n === 2 && (await admin.query("select count(*)::int n from public.legacy_cloud_backup_archive where owner_id = $1", [A])).rows[0].n === 2 && fs.readdirSync(folder).filter((f) => f.endsWith(".tfdp")).length >= 8);
  const leak = JSON.stringify(logs);
  check("ninguna línea del progreso lleva datos personales, el correo ni la contraseña", !/ZQ |@example|Clave-Ficticia/.test(leak));

  await shim.stop();
  await pg.stop();
  fs.rmSync(folder, { recursive: true, force: true });
  fs.rmSync(appDir, { recursive: true, force: true });
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) {
    console.log("FALLAN:\n - " + failures.join("\n - "));
    console.log("ÚLTIMAS LÍNEAS DEL PROGRESO:\n" + logs.slice(-60).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
