// Regresión final previa al rediseño — contra Production con CUENTAS SINTÉTICAS (@example.invalid), nunca la cuenta real. Usa el código REAL de los repositorios de la
// web (supabase-js 2.117.3). Todo lo que crea se borra al final (`finally`) y se verifica aparte con huellas.
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const KEYS = JSON.parse(fs.readFileSync(process.env.KEYS_FILE, "utf8"));
const REF = fs.readFileSync("supabase/.temp/project-ref", "utf8").trim();
const URL_ = `https://${REF}.supabase.co`;
const ANON = KEYS.anon, SVC = KEYS.service_role;
const OUT = process.env.OUT_FILE;
const RUN = randomBytes(3).toString("hex");
const E = (n) => `r8reg-${RUN}-${n}@example.invalid`;

const results = [];
function check(section, name, cond, detail = "") {
  const ok = Boolean(cond);
  results.push({ section, name, ok, detail: String(detail).slice(0, 220) });
  console.log(`${ok ? "✓" : "✗"} [${section}] ${name}${!ok && detail ? "  → " + String(detail).slice(0, 220) : ""}`);
}
const step = async (section, name, fn) => {
  try { await fn(); } catch (e) { check(section, name + " (excepción)", false, e?.message ?? e); }
};
const admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
const mk = (opts = {}) => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, ...opts } });
const created = []; // ids de usuarios sintéticos (limpieza)

async function mkUser(n, pw) {
  const { data, error } = await admin.auth.admin.createUser({ email: E(n), password: pw, email_confirm: true });
  if (error) throw error;
  created.push(data.user.id);
  return data.user;
}
async function login(n, pw) {
  const c = mk();
  const { data, error } = await c.auth.signInWithPassword({ email: E(n), password: pw });
  if (error) throw error;
  return { client: c, user: data.user, ctx: { supabase: c, ownerId: data.user.id } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // =============================================================================================================================
  // 1. AUTENTICACIÓN
  // =============================================================================================================================
  const S1 = "1-auth";
  const PW1 = `Inicial-${RUN}a`;
  let U1;
  await step(S1, "alta", async () => {
    const w = mk();
    const r = await w.auth.signUp({ email: E("w7"), password: "abc1234" });
    check(S1, "alta con contraseña de 7 caracteres: se rechaza (weak_password) sin crear usuario ni enviar correo", r.error && (r.error.code === "weak_password" || /password/i.test(r.error.message)), r.error?.code ?? "no falló");
    const list = await admin.auth.admin.listUsers({ perPage: 1000 });
    check(S1, "…y no se creó ningún usuario con ese correo", !list.data.users.some((u) => u.email === E("w7")));
    const g = await admin.auth.admin.generateLink({ type: "signup", email: E("1"), password: PW1 });
    if (g.error) throw g.error;
    U1 = g.data.user;
    created.push(U1.id);
    check(S1, "alta con contraseña de 8+ caracteres: el usuario nace SIN confirmar (enlace generado sin enviar correo)", !U1.email_confirmed_at, g.error?.message);
    const pre = await mk().auth.signInWithPassword({ email: E("1"), password: PW1 });
    check(S1, "antes de confirmar el correo NO se puede iniciar sesión (email_not_confirmed)", pre.error && /confirm/i.test(pre.error.message + pre.error.code), pre.error?.code);
    const c = mk();
    const v = await c.auth.verifyOtp({ token_hash: g.data.properties.hashed_token, type: "signup" });
    check(S1, "confirmación de correo (verifyOtp signup): crea sesión y confirma al usuario", !v.error && !!v.data.session && !!v.data.user?.email_confirmed_at, v.error?.message);
    await c.auth.signOut({ scope: "local" });
  });
  await step(S1, "login", async () => {
    const ok = await mk().auth.signInWithPassword({ email: E("1"), password: PW1 });
    check(S1, "login con credenciales correctas", !ok.error && !!ok.data.session, ok.error?.message);
    const bad = await mk().auth.signInWithPassword({ email: E("1"), password: PW1 + "x" });
    check(S1, "login con contraseña incorrecta: rechazado (invalid_credentials)", bad.error?.code === "invalid_credentials", bad.error?.code);
  });
  let PW2 = `Nueva-${RUN}bc`;
  await step(S1, "recuperación", async () => {
    const g = await admin.auth.admin.generateLink({ type: "recovery", email: E("1") });
    if (g.error) throw g.error;
    const c = mk();
    const v = await c.auth.verifyOtp({ token_hash: g.data.properties.hashed_token, type: "recovery" });
    check(S1, "recuperación: el enlace crea una sesión de recuperación", !v.error && !!v.data.session, v.error?.message);
    const w7 = await c.auth.updateUser({ password: "abc1234" });
    check(S1, "cambio de contraseña a 7 caracteres: rechazado (weak_password)", w7.error?.code === "weak_password", w7.error?.code ?? "no falló");
    const w8 = await c.auth.updateUser({ password: PW2 });
    check(S1, "cambio de contraseña a 8+ caracteres: aceptado (con cambio seguro de contraseña activo)", !w8.error, w8.error?.message);
    const old = await mk().auth.signInWithPassword({ email: E("1"), password: PW1 });
    check(S1, "la contraseña anterior ya no sirve", !!old.error);
    const nw = await mk().auth.signInWithPassword({ email: E("1"), password: PW2 });
    check(S1, "la contraseña nueva inicia sesión", !nw.error && !!nw.data.session, nw.error?.message);
    const exact8 = await (async () => { const g2 = await admin.auth.admin.generateLink({ type: "recovery", email: E("1") }); const c2 = mk(); await c2.auth.verifyOtp({ token_hash: g2.data.properties.hashed_token, type: "recovery" }); PW2 = `Ab1-${RUN.slice(0, 4)}`; return c2.auth.updateUser({ password: PW2 }); })();
    check(S1, "contraseña de EXACTAMENTE 8 caracteres: aceptada", PW2.length === 8 && !exact8.error, exact8.error?.message);
  });

  await step(S1, "refresco", async () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const t1 = mk({ persistSession: true, storage, storageKey: "tab" });
    const t2 = mk({ persistSession: true, storage, storageKey: "tab" });
    const li = await t1.auth.signInWithPassword({ email: E("1"), password: PW2 });
    if (li.error) throw li.error;
    const s0 = (await t1.auth.getSession()).data.session;
    const r1 = await t1.auth.refreshSession();
    check(S1, "refresco de sesión con supabase-js 2.117.3: devuelve tokens nuevos del mismo usuario", !r1.error && r1.data.session.access_token !== s0.access_token && r1.data.session.refresh_token !== s0.refresh_token && r1.data.user.id === li.data.user.id, r1.error?.message);
    // Dos «pestañas» (dos clientes con el mismo almacenamiento): la sesión vence y las dos refrescan a la vez.
    const stored = JSON.parse(store.get("tab"));
    stored.expires_at = Math.floor(Date.now() / 1000) - 30;
    store.set("tab", JSON.stringify(stored));
    const [a, b, c3] = await Promise.all([t1.auth.getSession(), t2.auth.getSession(), t1.auth.getUser()]);
    check(S1, "dos pestañas con la sesión vencida refrescan a la vez: las dos siguen con sesión, sin errores ni cierres", !a.error && !b.error && !!a.data.session && !!b.data.session && a.data.session.user.id === b.data.session.user.id && !c3.error, `${a.error?.message ?? ""}${b.error?.message ?? ""}${c3.error?.message ?? ""}`);
    const [u1, u2] = await Promise.all([t1.auth.getUser(), t2.auth.getUser()]);
    check(S1, "…y ambas siguen autenticadas como el MISMO usuario después del refresco", !u1.error && !u2.error && u1.data.user.id === u2.data.user.id && u1.data.user.id === li.data.user.id, u1.error?.message ?? u2.error?.message);
    // Carrera cruda con el MISMO refresh token (dos pestañas sin coordinación): dentro del intervalo de reuso (10 s) las dos tienen que servir.
    const rt = JSON.parse(store.get("tab")).refresh_token;
    const raw = () => fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) });
    const [x, y] = await Promise.all([raw(), raw()]);
    check(S1, "dos refrescos simultáneos con el mismo refresh token (dentro del intervalo de reuso de 10 s): los dos responden 200", x.status === 200 && y.status === 200, `${x.status}/${y.status}`);
    // Rotación: un refresh token de DOS generaciones atrás (ya usado y rotado) deja de servir pasado el intervalo de reuso.
    const rot = mk();
    const lr = await rot.auth.signInWithPassword({ email: E("1"), password: PW2 });
    const g = (tok) => fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: tok }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const R0 = lr.data.session.refresh_token;
    const a1 = await g(R0);
    const a2 = await g(a1.body.refresh_token);
    await sleep(11500);
    const old = await g(R0);
    check(S1, "rotación de refresh tokens: cada refresco entrega un token nuevo y el de dos generaciones atrás se rechaza (400 refresh_token_already_used)", a1.status === 200 && a2.status === 200 && a1.body.refresh_token !== R0 && old.status === 400 && old.body.error_code === "refresh_token_already_used", `${a1.status}/${a2.status}/${old.status} ${old.body.error_code}`);
  });

  // Segunda y tercera cuenta: sin cruces.
  const PWX = `Cuenta-${RUN}x`;
  await mkUser("2", PWX);
  await mkUser("3", PWX);
  const L1 = await login("1", PW2);
  const L2 = await login("2", PWX);
  await step(S1, "cruces", async () => {
    const [g1, g2] = await Promise.all([L1.client.auth.getUser(), L2.client.auth.getUser()]);
    check(S1, "dos cuentas en paralelo: cada sesión ve SU usuario (sin cruces)", g1.data.user.id === L1.user.id && g2.data.user.id === L2.user.id && g1.data.user.id !== g2.data.user.id);
  });

  // =============================================================================================================================
  // 2. ALUMNOS
  // =============================================================================================================================
  const S2 = "2-alumnos";
  const { createStudent, listStudents } = await import("../../../lib/repositories/students.ts");
  const input = (name, extra = {}) => ({ name, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-07", price: 10000, levels: [], ...extra });
  const ids = {};
  await step(S2, "alumnos", async () => {
    const op1 = randomUUID();
    const a = await createStudent(L1.ctx, input("QA Regresion Uno", { email: "qa-uno@example.invalid" }), { operationId: op1 });
    ids.s1 = a.student?.id;
    check(S2, "crear un alumno con una operación sintética", a.status === "created" && a.replayed === false && !!ids.s1, JSON.stringify(a).slice(0, 120));
    const b = await createStudent(L1.ctx, input("QA Regresion Uno", { email: "qa-uno@example.invalid" }), { operationId: op1 });
    check(S2, "recarga (misma operación): devuelve el MISMO alumno, replayed = true, sin duplicar", b.status === "created" && b.replayed === true && b.student.id === ids.s1);
    const op2 = randomUUID();
    const [d1, d2] = await Promise.all([createStudent(L1.ctx, input("QA Regresion Dos"), { operationId: op2 }), createStudent(L1.ctx, input("QA Regresion Dos"), { operationId: op2 })]);
    ids.s2 = d1.student?.id;
    check(S2, "doble envío simultáneo (misma operación): converge en UN alumno", d1.status === "created" && d2.status === "created" && d1.student.id === d2.student.id && [d1.replayed, d2.replayed].filter(Boolean).length >= 1, JSON.stringify([d1.replayed, d2.replayed]));
    const lost = await createStudent(L1.ctx, input("QA Regresion Dos"), { operationId: op2 });
    check(S2, "respuesta perdida y reintento: devuelve el mismo alumno (replayed)", lost.status === "created" && lost.replayed === true && lost.student.id === ids.s2);
    let list = await listStudents(L1.ctx);
    check(S2, "tras recarga, doble envío y reintento hay exactamente 2 alumnos", list.length === 2, String(list.length));
    // Posible duplicado
    const op3 = randomUUID();
    const dup = await createStudent(L1.ctx, input("  qa regresion UNO ", { email: "otro@example.invalid" }), { operationId: op3 });
    check(S2, "posible duplicado: se ADVIERTE y no se crea nada", dup.status === "possible_duplicate" && dup.candidates.length >= 1 && dup.candidates.some((c) => c.id === ids.s1 && c.matchSignals.includes("name")), JSON.stringify(dup).slice(0, 160));
    list = await listStudents(L1.ctx);
    check(S2, "…y la advertencia no escribió ningún alumno", list.length === 2, String(list.length));
    const conf = await createStudent(L1.ctx, input("  qa regresion UNO ", { email: "otro@example.invalid" }), { operationId: op3, confirmDuplicate: true });
    check(S2, "«Es otra persona»: la confirmación explícita lo crea", conf.status === "created" && conf.student.id !== ids.s1, JSON.stringify(conf).slice(0, 100));
    ids.s3 = conf.student?.id;
    const conf2 = await createStudent(L1.ctx, input("  qa regresion UNO ", { email: "otro@example.invalid" }), { operationId: op3, confirmDuplicate: true });
    check(S2, "reenviar la confirmación (doble clic / respuesta perdida): no crea otro", conf2.status === "created" && conf2.replayed === true && conf2.student.id === ids.s3);
    list = await listStudents(L1.ctx);
    check(S2, "total final de la cuenta: 3 alumnos", list.length === 3, String(list.length));
    // Aislamiento: la MISMA operación en otra cuenta es otra operación
    const x = await createStudent(L2.ctx, input("QA Regresion Uno"), { operationId: op1 });
    const l2 = await listStudents(L2.ctx);
    check(S2, "aislamiento: la misma clave de operación en otra cuenta crea su propio alumno y la otra cuenta no ve los ajenos", x.status === "created" && x.student.id !== ids.s1 && l2.length === 1 && !l2.some((s) => [ids.s1, ids.s2, ids.s3].includes(s.id)));
    const peek = await L2.client.from("students").select("id").in("id", [ids.s1, ids.s2, ids.s3]);
    check(S2, "RLS: la otra cuenta no puede leer alumnos ajenos por id", !peek.error && peek.data.length === 0);
    await createStudent(L1.ctx, input("   "), { operationId: randomUUID() }).then(() => check(S2, "alumno inválido (sin nombre): se rechaza antes de escribir", false), () => check(S2, "alumno inválido (sin nombre): se rechaza antes de escribir", true));
  });

  // =============================================================================================================================
  // 3. CALENDARIO
  // =============================================================================================================================
  const S3 = "3-calendario";
  const { createRecurrenceSeries, listRecurrenceRules } = await import("../../../lib/repositories/recurrence-rules.ts");
  const { splitRecurrenceThisAndFuture } = await import("../../../lib/repositories/recurrence-split.ts");
  await step(S3, "calendario", async () => {
    const op = randomUUID();
    const seriesInput = { operationId: op, primaryStudentId: ids.s1, ruleType: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 0, hour: 18, minute: 0, durationMinutes: 60 }] }], modality: "presencial", timezone: "America/Argentina/Buenos_Aires", startDate: "2026-11-02", endDate: null, classTitle: null, activityKind: "class", participantIds: [ids.s1, ids.s2] };
    const orig = await createRecurrenceSeries(L1.ctx, seriesInput);
    check(S3, "crear una serie sintética con 2 participantes", !!orig.id && orig.startDate === "2026-11-02" && orig.endDate === null, JSON.stringify(orig).slice(0, 120));
    const again = await createRecurrenceSeries(L1.ctx, seriesInput);
    check(S3, "crear la serie dos veces con la misma operación: idempotente (misma serie)", again.id === orig.id);
    const succ = await splitRecurrenceThisAndFuture(L1.ctx, { originalRecurrenceId: orig.id, effectiveDate: "2026-11-16", todayDate: "2026-10-07", ruleType: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 19, minute: 0, durationMinutes: 60 }] }], participantIds: [ids.s1, ids.s2], primaryStudentId: ids.s1 });
    check(S3, "«esta y las siguientes»: devuelve la sucesora", !!succ.id && succ.id !== orig.id, JSON.stringify(succ).slice(0, 120));
    const { data: rules } = await admin.from("recurrence_rules").select("*").eq("owner_id", L1.user.id).order("created_at");
    const o = rules.find((r) => r.id === orig.id), s = rules.find((r) => r.id === succ.id);
    check(S3, "original: end_date = día anterior a la fecha efectiva (2026-11-15) y sigue activa hasta entonces", o.end_date === "2026-11-15" && o.status === "active", `${o.end_date}/${o.status}`);
    check(S3, "original: apunta a su sucesora; sucesora: apunta a la original y rige desde 2026-11-16", o.superseded_by_recurrence_id === s.id && s.supersedes_recurrence_id === o.id && s.effective_from_date === "2026-11-16", `${s.effective_from_date}`);
    check(S3, "nueva serie: semanas nuevas (martes 19:00) y sin fin; la original conserva las suyas (lunes 18:00)", s.end_date === null && s.weeks?.[0]?.sessions?.[0]?.weekday === 1 && o.weeks?.[0]?.sessions?.[0]?.weekday === 0);
    const { data: parts } = await admin.from("recurrence_rule_participants").select("recurrence_rule_id, student_id").eq("owner_id", L1.user.id);
    const pOf = (id) => parts.filter((p) => p.recurrence_rule_id === id).map((p) => p.student_id).sort();
    check(S3, "participantes: la original conserva a los 2 y la sucesora recibe a los mismos 2", JSON.stringify(pOf(o.id)) === JSON.stringify([ids.s1, ids.s2].sort()) && JSON.stringify(pOf(s.id)) === JSON.stringify([ids.s1, ids.s2].sort()));
    const { data: exc } = await admin.from("recurrence_exceptions").select("recurrence_id").eq("owner_id", L1.user.id);
    const { data: lessons } = await admin.from("calendar_lessons").select("id, recurrence_id").eq("owner_id", L1.user.id);
    check(S3, "clases: no quedó ninguna clase materializada huérfana de la serie original después de la fecha efectiva", (lessons ?? []).filter((l) => l.recurrence_id === o.id).length === 0, `clases=${lessons?.length}, excepciones=${exc?.length}`);
    const rep = await splitRecurrenceThisAndFuture(L1.ctx, { originalRecurrenceId: orig.id, effectiveDate: "2026-11-16", todayDate: "2026-10-07", ruleType: "weekly", cycleLengthWeeks: 1, weeks: [{ weekIndex: 0, sessions: [{ weekday: 1, hour: 19, minute: 0, durationMinutes: 60 }] }], participantIds: [ids.s1, ids.s2], primaryStudentId: ids.s1 }).catch((e) => ({ error: e }));
    const { data: rules2 } = await admin.from("recurrence_rules").select("id").eq("owner_id", L1.user.id);
    check(S3, "repetir el mismo split (doble clic / respuesta perdida): no crea una segunda sucesora", rules2.length === 2, `reglas=${rules2.length} ${rep.error ? "(" + rep.error.message + ")" : ""}`);
    const listed = await listRecurrenceRules(L1.ctx);
    check(S3, "la web lista las 2 series de la cuenta (y la otra cuenta ninguna)", listed.length === 2 && (await listRecurrenceRules(L2.ctx)).length === 0);
    const bad = await L1.client.rpc("split_recurrence_this_and_future", { p_payload: { original_recurrence_id: orig.id, effective_date: "2026-12-14", original_patch: { status: "active", endDate: "2026-12-13" }, successor_id: randomUUID(), successor_start_date: "2026-12-14", successor_end_date: null, rule_type: "weekly", cycle_length_weeks: 1, weeks: [], participant_ids: [ids.s1], primary_student_id: ids.s1, excluded_occurrence_keys: [] } });
    check(S3, "R8: un payload viejo con SÓLO endDate se rechaza (22023) y no escribe", !!bad.error && bad.error.code === "22023", bad.error?.code ?? "no falló");
  });

  // =============================================================================================================================
  // 4. IMPORTACIÓN R6.1
  // =============================================================================================================================
  const S4 = "4-importacion";
  const L3 = await login("3", PWX);
  const { fetchOwnLatestCloudBackup, previewBackupImport, applyBackupImport, previewUndoBackupImport, applyUndoBackupImport } = await import("../../../lib/repositories/backup-import.ts");
  const { validateBackupPayload } = await import("../../../lib/backup/validation.ts");
  const { toImportPreviewDto } = await import("../../../lib/backup/import-preview-mapping.ts");
  const R = path.resolve("supabase/tests/postgres") + path.sep;
  const { addChain } = require(R + "r61_import.cjs");
  const { emptyBackup } = require(R + "r6_dataset.cjs");
  const O3 = L3.user.id;
  const TABLES = ["students", "training_billing_agreements", "student_level_history", "recurrence_rules", "recurrence_rule_participants", "calendar_lessons", "calendar_lesson_participants", "recurrence_exceptions", "lesson_registrations", "lesson_registration_students", "lesson_registration_attendance", "lesson_registration_evaluations", "lesson_registration_homework_reviews", "payment_charges", "payments", "payment_allocations", "payment_adjustments"];
  const count = async (t) => (await admin.from(t).select("*", { count: "exact", head: true }).eq("owner_id", O3)).count;
  await step(S4, "importación", async () => {
    await admin.from("budget_distribution_settings").insert({ owner_id: O3, needs_percent: 50, wants_percent: 30, savings_percent: 20 });
    await admin.from("custom_levels").insert({ owner_id: O3, legacy_mobile_id: "cv_web", name: "Nivel A" });
    const b = emptyBackup();
    addChain(b, "q1");
    addChain(b, "q2");
    b.customLevels = [{ id: "cv_web", name: "Nivel A", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_dup", name: "  nivel a ", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_new", name: "Nivel B", createdAt: "2025-01-01T00:00:00.000Z" }, { id: "cv_copy", name: "NIVEL B", createdAt: "2025-01-01T00:00:00.000Z" }];
    b.budgetDistribution = { distribution: { needs: 40, wants: 40, savings: 20 }, savingsGoal: { enabled: false, targetAmount: null, targetDate: null } };
    const ins = await admin.from("cloud_backups").insert({ user_id: O3, device_id: "r8-regression-device", schema_version: 2, app_version: "r8-regression", checksum: randomBytes(16).toString("hex"), payload: b });
    check(S4, "copia sintética en la nube de la cuenta QA aislada (acuerdo → serie → clase → registro → asistencia/tarea/cobro, niveles repetidos, presupuesto 40/40/20)", !ins.error, ins.error?.message);
    const cloud = await fetchOwnLatestCloudBackup(L3.ctx);
    check(S4, "la web lee SU copia con fetch_own_latest_cloud_backup", !!cloud && cloud.appVersion === "r8-regression", JSON.stringify(cloud)?.slice(0, 80));
    const val = validateBackupPayload(cloud.payload);
    check(S4, "la validación de la web acepta la copia", val.ok === true, val.ok ? "" : JSON.stringify(val.errors).slice(0, 160));
    const prev = await previewBackupImport(L3.ctx, val.backup, val.excludedCollections);
    const dto = toImportPreviewDto({ previewId: prev.previewId, expiresAt: prev.expiresAt, classification: prev.classification, excludedCollections: prev.excludedCollections });
    const agg = dto.aggregates;
    check(S4, "vista previa en cuenta casi vacía: TODAS las series, clases, registros y cobros de la cadena son importables", [agg.recurrenceRules, agg.calendarLessons, agg.lessonRegistrations].every((a) => a.length > 0 && a.every((x) => x.status === "insertable")) && agg.financialComponents.every((c) => c.status === "insertable"), JSON.stringify([agg.recurrenceRules.length, agg.calendarLessons.length, agg.lessonRegistrations.length, agg.financialComponents.length]));
    check(S4, "niveles repetidos: 2 duplicados informados (uno contra la web, uno dentro de la copia) y sólo «Nivel B» se agrega", dto.customLevels.duplicates.length === 2 && dto.customLevels.inserts.length === 1 && dto.customLevels.duplicates.some((d) => d.reason === "same_name_in_web") && dto.customLevels.duplicates.some((d) => d.reason === "same_name_in_copy"), JSON.stringify(dto.customLevels.duplicates));
    check(S4, "presupuesto: aparece como diferencia a decidir", dto.singletons.budgetDistribution.presentInBackup && dto.singletons.budgetDistribution.status === "conflict");
    const before = {}; for (const t of TABLES) before[t] = await count(t);
    check(S4, "la vista previa no escribió datos de negocio", Object.values(before).every((n) => n === 0));
    // Confirmación con el presupuesto (los tres porcentajes juntos)
    const ov = [{ tableName: "budget_distribution_settings", rowId: O3, fields: ["needs_percent", "wants_percent", "savings_percent"] }];
    const ap = await applyBackupImport(L3.ctx, prev.previewId, ov, []);
    const total = ap.summary.totalRowsWritten;
    check(S4, "confirmación: escribe la cadena completa (sin omitir nada)", !ap.summary.replayed && total > 0 && !!ap.importRunId, JSON.stringify(ap).slice(0, 160));
    const after = {}; for (const t of TABLES) after[t] = await count(t);
    check(S4, "filas escritas por tabla = 2 cadenas completas (6 alumnos, 4 acuerdos, 6 series, 8 clases, 6 registros, 4 cobros, 2 pagos…)", after.students === 6 && after.training_billing_agreements === 4 && after.recurrence_rules === 6 && after.calendar_lessons === 8 && after.lesson_registrations === 6 && after.payment_charges === 4 && after.payments === 2 && after.payment_allocations === 2 && after.lesson_registration_attendance === 6, JSON.stringify(after));
    const { data: link } = await admin.from("calendar_lessons").select("legacy_mobile_id, recurrence_id").eq("owner_id", O3);
    check(S4, "vínculos: toda clase de serie quedó unida a su serie importada", link.filter((l) => /^q\d_cl[123]$/.test(l.legacy_mobile_id)).every((l) => !!l.recurrence_id));
    const { data: bud } = await admin.from("budget_distribution_settings").select("needs_percent,wants_percent,savings_percent").eq("owner_id", O3).single();
    const { data: lv } = await admin.from("custom_levels").select("name").eq("owner_id", O3);
    check(S4, "presupuesto reemplazado de una vez (40/40/20, suma 100) y niveles: sólo se agregó «Nivel B»", bud.needs_percent === 40 && bud.wants_percent === 40 && bud.savings_percent === 20 && lv.map((x) => x.name).sort().join("|") === "Nivel A|Nivel B", `${JSON.stringify(bud)} ${JSON.stringify(lv)}`);
    // Respuesta perdida / reintento
    const ap2 = await applyBackupImport(L3.ctx, prev.previewId, ov, []);
    check(S4, "respuesta perdida y reintento (misma revisión): misma corrida, replayed, cero escrituras", ap2.summary.replayed === true && ap2.importRunId === ap.importRunId && (await count("students")) === 6);
    // Deshacer
    const up = await previewUndoBackupImport(L3.ctx, ap.importRunId);
    check(S4, "deshacer: la revisión dice que es seguro", up.isSafe === true, JSON.stringify(up).slice(0, 140));
    const ua = await applyUndoBackupImport(L3.ctx, up.undoPreviewId);
    const ua2 = await applyUndoBackupImport(L3.ctx, up.undoPreviewId);
    check(S4, "deshacer: se aplica y el reintento devuelve lo mismo (replayed)", !ua.replayed && ua2.replayed === true, JSON.stringify([ua, ua2]).slice(0, 160));
    const res = {}; for (const t of TABLES) res[t] = await count(t);
    const { data: bud2 } = await admin.from("budget_distribution_settings").select("needs_percent,wants_percent,savings_percent").eq("owner_id", O3).single();
    const { data: lv2 } = await admin.from("custom_levels").select("name").eq("owner_id", O3);
    check(S4, "sin residuos: todas las tablas de la cadena en 0, presupuesto de vuelta en 50/30/20 y el nivel agregado desaparece", Object.values(res).every((n) => n === 0) && bud2.needs_percent === 50 && bud2.wants_percent === 30 && bud2.savings_percent === 20 && lv2.length === 1, JSON.stringify([res, bud2, lv2]).slice(0, 200));
    // Revisión vencida
    const prev2 = await previewBackupImport(L3.ctx, val.backup, val.excludedCollections);
    await admin.from("import_previews").update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", prev2.previewId);
    await applyBackupImport(L3.ctx, prev2.previewId, [], []).then(() => check(S4, "revisión vencida: se rechaza", false), (e) => check(S4, "revisión vencida: se rechaza y no escribe nada", /ya no es válido|vencid/i.test(String(e.message)) && true, e.message));
    check(S4, "…y no escribió nada", (await count("students")) === 0);
    // Presupuesto parcial inválido (sólo necesidades) se rechaza sin tocar nada
    const prev3 = await previewBackupImport(L3.ctx, val.backup, val.excludedCollections);
    await applyBackupImport(L3.ctx, prev3.previewId, [{ tableName: "budget_distribution_settings", rowId: O3, fields: ["needs_percent"] }], []).then(() => check(S4, "presupuesto parcial que no suma 100: se rechaza", false), (e) => check(S4, "presupuesto parcial que no suma 100 (sólo necesidades): se rechaza con mensaje propio", /no suma 100/.test(String(e.message)), e.message));
    check(S4, "…y no escribió nada (presupuesto intacto, 0 alumnos)", (await count("students")) === 0);
  });
} finally {
  // =============================================================================================================================
  // LIMPIEZA: se borran las cuentas sintéticas (cascada) — se verifica aparte con huellas
  // =============================================================================================================================
  const cleanup = [];
  for (const id of created) {
    const r = await admin.auth.admin.deleteUser(id);
    cleanup.push({ id: id.slice(0, 8), ok: !r.error, error: r.error?.message });
  }
  const left = await admin.auth.admin.listUsers({ perPage: 1000 });
  const remaining = left.data.users.filter((u) => u.email?.startsWith(`r8reg-${RUN}-`));
  check("5-limpieza", "las cuentas sintéticas se borraron (auth.users)", cleanup.every((c) => c.ok) && remaining.length === 0, JSON.stringify(cleanup.filter((c) => !c.ok)));
  fs.writeFileSync(OUT, JSON.stringify({ run: RUN, created, cleanup, results }, null, 1));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} comprobaciones OK`);
  if (bad.length) console.log("FALLAN:\n - " + bad.map((r) => `[${r.section}] ${r.name} → ${r.detail}`).join("\n - "));
}
