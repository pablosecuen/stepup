// Escenarios REALES de create_student_with_operation sobre el esquema real (35/38 migraciones) en PGlite.
const { load } = require("./load.cjs");
const A = "a0000000-0000-0000-0000-00000000000a";
const B = "b0000000-0000-0000-0000-00000000000b";
const OP1 = "11111111-1111-4111-8111-111111111111";
const OP2 = "22222222-2222-4222-8222-222222222222";
const OP3 = "33333333-3333-4333-8333-333333333333";
const OP4 = "44444444-4444-4444-8444-444444444444";
const OP5 = "55555555-5555-4555-8555-555555555555";

const payload = (name, extra = {}) =>
  JSON.stringify({ name, modality: "presencial", category: "otro", billingType: "mensual", dateJoined: "2026-10-05", price: 10000, levels: [], ...extra });

let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log("  ok   " + msg); } else { failed++; console.log("  FALLA " + msg); } };

(async () => {
  const { db, failures } = await load();
  console.log("esquema cargado; migraciones con error (esperadas, ajenas):", failures.map((f) => f[0].slice(0, 14)).join(", "));
  for (const f of failures) if (!/storage|report|active_sessions|dead_write/.test(f[0] + f[1])) console.log("  ⚠ falla inesperada:", f);
  await db.query("insert into auth.users(id,email) values ($1,'a@x.test'),($2,'b@x.test')", [A, B]);
  const as = (u) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [u]);
  const call = async (op, name, confirm = false, extra = {}) => (await db.query("select * from public.create_student_with_operation($1::uuid, $2::jsonb, $3)", [op, payload(name, extra), confirm])).rows[0];
  const n = async (t, where = "") => Number((await db.query(`select count(*) c from public.${t} ${where}`)).rows[0].c);
  const throws = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  await as(A);

  console.log("\n[1] La carga/abandono no escribe: sin envío no existe ningún claim");
  ok((await n("student_creation_claims")) === 0, "0 claims antes de enviar (abrir o abandonar el formulario no toca la base)");
  ok((await n("students")) === 0, "0 alumnos");

  console.log("\n[2] Alta normal (el claim nace al enviar, con la clave del borrador)");
  const r1 = await call(OP1, "Ana Prueba");
  ok(r1.status === "created" && r1.replayed === false && !!r1.student_id, "created, replayed=false");
  const c1 = (await db.query("select * from public.student_creation_claims where operation_id=$1", [OP1])).rows[0];
  ok(c1 && c1.status === "created" && c1.student_id === r1.student_id && c1.owner_id === A, "claim ligado a la clave, al alumno y a la profesora");
  ok((await n("students")) === 1 && (await n("student_creation_claims")) === 1, "1 alumno y 1 claim");

  console.log("\n[3] Recarga / respuesta perdida / pestaña duplicada: misma clave → mismo alumno, sin duplicar");
  for (const label of ["recarga (reintento)", "respuesta perdida (reintento)", "pestaña duplicada (misma clave heredada)"]) {
    const r = await call(OP1, "Ana Prueba");
    ok(r.status === "created" && r.replayed === true && r.student_id === r1.student_id, `${label}: replayed=true y MISMO alumno`);
  }
  const rChanged = await call(OP1, "Otro Nombre Distinto");
  ok(rChanged.replayed === true && rChanged.student_id === r1.student_id, "reintento con datos editados entre medio: sigue convergiendo al alumno canónico");
  ok((await n("students")) === 1 && (await n("student_creation_claims")) === 1, "siguen 1 alumno y 1 claim");

  console.log("\n[4] Doble envío simultáneo (dos llamadas a la vez con la misma clave)");
  const [d1, d2] = await Promise.all([call(OP2, "Beto Doble"), call(OP2, "Beto Doble")]);
  ok(d1.student_id === d2.student_id && (await n("students", "where name='Beto Doble'")) === 1, "un solo alumno 'Beto Doble'");
  ok([d1.replayed, d2.replayed].filter(Boolean).length === 1, "exactamente una de las dos fue el reintento (replayed)");

  console.log("\n[5] Pestaña independiente: clave distinta → operación distinta (no se confunde con la anterior)");
  const r3 = await call(OP3, "Carla Independiente");
  ok(r3.status === "created" && r3.replayed === false && r3.student_id !== r1.student_id, "clave nueva crea otro alumno");
  const dup = await call(OP4, "Ana Prueba");
  ok(dup.status === "possible_duplicate" && dup.replayed === false && Array.isArray(dup.candidates) && dup.candidates.length >= 1, "misma persona con clave nueva NO se reusa a ciegas: pide revisión de duplicado");
  ok((await n("students", "where name='Ana Prueba'")) === 1, "no se creó el duplicado");

  console.log("\n[6] Confirmar 'es otra persona' (misma clave que la revisión) y reintento");
  const conf = await call(OP4, "Ana Prueba", true);
  ok(conf.status === "created" && conf.replayed === false, "confirmación crea el alumno");
  const conf2 = await call(OP4, "Ana Prueba", true);
  ok(conf2.replayed === true && conf2.student_id === conf.student_id, "reintento de la confirmación converge al mismo alumno");

  console.log("\n[7] Sin claims huérfanos: una operación que falla se revierte ENTERA (incluido el claim)");
  const before = await n("student_creation_claims");
  let m = await throws(() => call(OP5, "   "));
  ok(!!m && /nombre es obligatorio/i.test(m), "payload inválido: rechazado");
  ok((await n("student_creation_claims")) === before, "payload inválido: ningún claim nuevo");
  m = await throws(() => call(OP5, "Dani Fecha", false, { dateJoined: "no-es-fecha" }));
  ok(!!m, "falla al insertar el alumno (fecha inválida): rechazada");
  ok((await n("student_creation_claims")) === before && (await n("students", "where name='Dani Fecha'")) === 0, "falla al insertar: ningún claim ni alumno");
  m = await throws(() => call(OP5, "Eli Sin Revision", true));
  ok(!!m && /revisión de posibles duplicados previa/i.test(m), "confirmar sin revisión previa: rechazado");
  ok((await n("student_creation_claims")) === before, "confirmar sin revisión previa: ningún claim nuevo");
  m = await throws(() => db.query("select * from public.create_student_with_operation(null, $1::jsonb, false)", [payload("Sin Clave")]));
  ok(!!m && /clave de la operación/i.test(m), "sin clave: rechazado");

  console.log("\n[8] El único claim sin alumno es el 'pending' con candidatos (estado necesario para confirmar)");
  const pend = (await db.query("select operation_id, status, student_id is null as sin_alumno, candidates_fingerprint is not null as con_huella from public.student_creation_claims where status='pending'")).rows;
  ok(pend.length === 0, "tras confirmar, no queda ningún claim pending");
  const dupOnly = await call("66666666-6666-4666-8666-666666666666", "Carla Independiente");
  ok(dupOnly.status === "possible_duplicate", "revisión de duplicado sin confirmar deja 1 claim pending con huella…");
  const pend2 = (await db.query("select status, student_id, candidates_fingerprint from public.student_creation_claims where status='pending'")).rows;
  ok(pend2.length === 1 && pend2[0].student_id === null && !!pend2[0].candidates_fingerprint, "…(esperado: es el estado de la revisión; vence a los 30 min y se limpia a las 24 h)");

  console.log("\n[9] Vencimiento y limpieza perezosa");
  await db.query("update public.student_creation_claims set expires_at = now() - interval '1 hour' where status='pending'");
  const reopened = await call("66666666-6666-4666-8666-666666666666", "Carla Independiente");
  ok(reopened.status === "possible_duplicate", "claim vencido de la misma clave se reabre (pide revisar de nuevo)");
  const exp = (await db.query("select expires_at > now() as vigente from public.student_creation_claims where operation_id='66666666-6666-4666-8666-666666666666'")).rows[0];
  ok(exp.vigente === true, "expiración renovada");
  // TODOS (también los 'created') quedan vencidos hace 25 h: sólo los pending pueden limpiarse.
  const createdBefore = await n("student_creation_claims", "where status='created'");
  await db.query("update public.student_creation_claims set expires_at = now() - interval '25 hours'");
  await call("77777777-7777-4777-8777-777777777777", "Fede Limpieza");
  ok((await n("student_creation_claims", "where status='pending'")) === 0, "pending vencido hace >24 h se limpia");
  ok(createdBefore >= 4 && (await n("student_creation_claims", "where status='created'")) === createdBefore + 1, "los claims 'created' vencidos NUNCA se limpian (y el alta nueva suma uno)");

  console.log("\n[10] Aislamiento entre profesoras: la clave no cruza owners");
  await as(B);
  const rb = await call(OP1, "Ana Prueba");
  ok(rb.status === "created" && rb.replayed === false && rb.student_id !== r1.student_id, "B con la MISMA clave de A crea el suyo (no recibe el alumno de A)");
  ok((await n("student_creation_claims", `where owner_id='${B}'`)) === 1 && (await n("students", `where owner_id='${B}'`)) === 1, "B tiene su propio claim y su propio alumno");
  await as(A);
  ok((await call(OP1, "Ana Prueba")).student_id === r1.student_id, "A sigue viendo el suyo");

  console.log("\n[11] Sin sesión y permisos");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  m = await throws(() => call(OP1, "Ana Prueba"));
  ok(!!m && /sesión autenticada/i.test(m), "sin sesión: rechazado");
  const priv = (await db.query("select has_function_privilege('anon','public.create_student_with_operation(uuid,jsonb,boolean)','execute') as anon, has_function_privilege('authenticated','public.create_student_with_operation(uuid,jsonb,boolean)','execute') as auth")).rows[0];
  ok(priv.anon === false && priv.auth === true, "anon sin EXECUTE, authenticated con EXECUTE");

  console.log("\n[12] Retiro (R8): las funciones del alta por borrador ya no existen");
  await as(A);
  const gone = Number((await db.query("select count(*) c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('claim_student_creation', 'create_student_via_web')")).rows[0].c);
  ok(gone === 0, "claim_student_creation() y create_student_via_web() fueron retiradas (R8)");
  m = await throws(() => db.query("select * from public.claim_student_creation()"));
  ok(!!m && /does not exist/i.test(m), "llamar a claim_student_creation() falla porque ya no existe");

  console.log(`\nRESULTADO: ${passed} ok, ${failed} fallas`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("ERROR DE HARNESS:", e); process.exit(2); });
