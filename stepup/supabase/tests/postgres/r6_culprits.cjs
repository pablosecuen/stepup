// R6 — ¿Qué parte EXACTA de la importación anterior crecía de forma cuadrática? Medición por ABLACIÓN y micro-pruebas sobre el Postgres con las migraciones
// ANTERIORES a R6 (no sobre las nuevas). Cada variante quita UNA pieza de una función anterior (en una base de pruebas, nunca en Production) y mide cuánto
// tarda el resto; la diferencia es lo que cuesta esa pieza. El exponente p = log2(t(2n)/t(n)) entre los dos tamaños más grandes: p≈1 lineal, p≈2 cuadrático.
//
//   set NODE_PATH=%TEMP%\epg17\node_modules
//   set OLD_MIGRATIONS_DIR=<carpeta con las migraciones anteriores a R6>
//   node supabase/tests/postgres/r6_culprits.cjs [--out resultados.json]
const fs = require("fs");
const { start } = require("./load.cjs");
const { generateBackup } = require("./r6_dataset.cjs");

const OLD = process.env.OLD_MIGRATIONS_DIR;
if (!OLD) throw new Error("Falta OLD_MIGRATIONS_DIR");
const SIZES = [1000, 2000, 4000];
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;

const exponent = (a, b) => (a > 0 && b > 0 ? Math.log2(b / a) : NaN);
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");

async function main() {
  const pg = await start({ port: 5651, migrationsDir: OLD });
  const admin = pg.admin;
  const results = { classify: {}, apply: {}, micro: {} };
  const uid = (await admin.query(`insert into auth.users (email) values ('culprits@example.invalid') returning id`)).rows[0].id;
  await admin.query(`select set_config('request.jwt.claim.sub', '${uid}', false)`);

  async function defOf(sig) {
    // Los cuerpos guardados pueden traer CRLF (según dónde se aplicó la migración): se normaliza a LF para poder buscar fragmentos de varias líneas.
    return (await admin.query(`select replace(pg_get_functiondef($1::regprocedure), chr(13), '') as d`, [sig])).rows[0].d;
  }
  async function withVariant(sig, edits, fn) {
    const original = await defOf(sig);
    let d = original;
    for (const [from, to] of edits) {
      if (!d.includes(from)) throw new Error(`variante: no se encontró «${from.slice(0, 50)}» en ${sig}`);
      d = d.split(from).join(to);
    }
    await admin.query(d);
    try { return await fn(); } finally { await admin.query(original); }
  }
  const ms = async (fn) => { const t0 = process.hrtime.bigint(); await fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  // 1) Vista previa: _classify_financial_components (anterior) con la unión de componentes, el recorrido de miembros y la búsqueda de filas quitados de a uno
  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  if (!process.argv.includes("--only-micro")) { // (con --only-micro se salta la ablación y se corren sólo las micro-pruebas)
  const SIG_FIN = "public._classify_financial_components(uuid,jsonb,jsonb,jsonb,jsonb,jsonb)";
  // Cortes tempranos (la función devuelve vacío en ese punto): la diferencia entre dos cortes es lo que cuesta el tramo entre ellos.
  const finVariants = {
    "completa": [],
    "solo armar nodos y aristas (corte antes de la unión de componentes)": [[`  loop
    v_changed := false;`, `  return '[]'::jsonb;
  loop
    v_changed := false;`]],
    "armar nodos y aristas + unión de componentes (corte después de la unión)": [["  select array_agg(distinct root) into v_roots from _fin_nodes;", "  return '[]'::jsonb;"]],
    "sin el recorrido de miembros por componente (SELECT * … WHERE root = …)": [[`for v_member in select * from _fin_nodes where root = v_root
    loop`, `for v_member in select * from _fin_nodes where root = v_root and false
    loop`]],
    "sin la búsqueda de la fila de cada miembro en el respaldo (jsonb_array_elements … WHERE id = …)": [[`    if v_all_clean then
      for v_member in select * from _fin_nodes where root = v_root
      loop`, `    if false then
      for v_member in select * from _fin_nodes where root = v_root
      loop`]],
  };
  const finTimes = {};
  for (const n of SIZES) {
    const backup = generateBackup(n, { profile: "financial_heavy", levelHistory: false });
    const payload = JSON.stringify(backup);
    await admin.query(`select set_config('r6.payload', $1, false)`, [payload]);
    for (const [name, edits] of Object.entries(finVariants)) {
      const t = await withVariant(SIG_FIN, edits, () =>
        ms(() => admin.query(`select public._classify_financial_components($1::uuid, current_setting('r6.payload')::jsonb, '{"inserts":[]}'::jsonb, '{"inserts":[]}'::jsonb, '[]'::jsonb, '[]'::jsonb)`, [uid]).catch(() => null))
      );
      (finTimes[name] ||= {})[n] = t;
    }
  }
  results.classify.financial = finTimes;
  console.log("\n== Vista previa · _classify_financial_components (perfil financiero, tiempo en ms)");
  for (const [name, t] of Object.entries(finTimes)) console.log(`  ${name.padEnd(95)} ${SIZES.map((n) => String(Math.round(t[n])).padStart(7)).join(" ")}   p=${fmt(exponent(t[SIZES[1]], t[SIZES[2]]))}`);
  const full = finTimes["completa"];
  const t0 = finTimes["solo armar nodos y aristas (corte antes de la unión de componentes)"];
  const t1 = finTimes["armar nodos y aristas + unión de componentes (corte después de la unión)"];
  const segs = {
    "armar nodos y aristas (inserciones por lote)": SIZES.map((n) => t0[n]),
    "unión de componentes (UPDATE de todos los nodos por arista)": SIZES.map((n) => Math.max(0, t1[n] - t0[n])),
    "análisis de componentes (recorrido de miembros + búsqueda de fila de cada miembro)": SIZES.map((n) => Math.max(0, full[n] - t1[n])),
  };
  results.classify.financialSegments = segs;
  for (const [name, v] of Object.entries(segs)) console.log(`  → ${name.padEnd(90)} ${v.map((x) => String(Math.round(x)).padStart(7)).join(" ")}   p=${fmt(exponent(v[1], v[2]))}`);
  for (const name of ["sin el recorrido de miembros por componente (SELECT * … WHERE root = …)", "sin la búsqueda de la fila de cada miembro en el respaldo (jsonb_array_elements … WHERE id = …)"]) {
    const t = finTimes[name];
    const share = SIZES.map((n) => Math.max(0, full[n] - t[n]));
    console.log(`  → costo de «${name.slice(0, 70)}»: ${share.map((v) => Math.round(v) + " ms").join(" / ")}  (p=${fmt(exponent(share[1], share[2]))})`);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  // 2) Aplicación (anterior): costo por pieza con ablación sobre una importación REAL de la profesora sintética (perfil mix, sin historial de niveles)
  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  async function applyOnce(n) {
    const backup = generateBackup(n, { profile: "mix", levelHistory: false, selfLinks: true });
    const s = await pg.session(uid);
    await s.query(`set statement_timeout = 0`);
    const p = (await s.query(`select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)`, [JSON.stringify(backup)])).rows[0];
    const t = await ms(() => s.query(`select * from public.apply_backup_import($1::uuid, '[]', '[]')`, [p.preview_id]));
    await s.end();
    await admin.query(`delete from auth.users where id = $1`, [uid]);
    await admin.query(`insert into auth.users (id, email) values ($1, 'culprits@example.invalid')`, [uid]);
    return t;
  }
  const applyVariants = [
    { name: "completa", sig: null, edits: [] },
    {
      name: "sin los disparadores de cuotas de R3 (un count(*) de la tabla por cada INSERT de una fila)",
      sig: null, triggers: true, edits: [],
    },
    {
      name: "sin la segunda pasada de clases (UPDATE … FROM jsonb_array_elements(payload))",
      sig: "public._apply_calendar_lessons(uuid,uuid,jsonb,jsonb)",
      edits: [["  update public.calendar_lessons cl set freed_by_lesson_id = freed.id", "  if false then return; end if;\n  update public.calendar_lessons cl set freed_by_lesson_id = freed.id"]],
    },
  ];
  const applyTimes = {};
  for (const n of SIZES) {
    for (const v of applyVariants) {
      let t;
      if (v.triggers) {
        // Se desactivan SOLO los disparadores de conteo de R3 en esta base de pruebas.
        const tables = (await admin.query(`select event_object_table t from information_schema.triggers where trigger_name = 'trg_quota_count' group by 1`)).rows.map((r) => r.t);
        for (const tb of tables) await admin.query(`alter table public.${tb} disable trigger trg_quota_count`);
        try { t = await applyOnce(n); } finally { for (const tb of tables) await admin.query(`alter table public.${tb} enable trigger trg_quota_count`); }
      } else if (v.sig) {
        t = await withVariant(v.sig, v.edits, () => applyOnce(n));
      } else {
        t = await applyOnce(n);
      }
      (applyTimes[v.name] ||= {})[n] = t;
    }
  }
  results.apply = applyTimes;
  console.log("\n== Aplicación · tiempo total en ms (perfil mix)");
  for (const [name, t] of Object.entries(applyTimes)) console.log(`  ${name.padEnd(100)} ${SIZES.map((n) => String(Math.round(t[n])).padStart(7)).join(" ")}   p=${fmt(exponent(t[SIZES[1]], t[SIZES[2]]))}`);
  const fullA = applyTimes["completa"];
  for (const [name, t] of Object.entries(applyTimes)) {
    if (name === "completa") continue;
    const share = SIZES.map((n) => Math.max(0, fullA[n] - t[n]));
    console.log(`  → costo de «${name.slice(0, 70)}»: ${share.map((v) => Math.round(v) + " ms").join(" / ")}  (p=${fmt(exponent(share[1], share[2]))})`);
  }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  // 3) Micro-pruebas del mecanismo (SQL puro, sin código de la aplicación)
  // ---------------------------------------------------------------------------------------------------------------------------------------------------
  const MICRO = [1000, 2000, 4000];
  const micro = {};
  async function timeSql(sql) { return ms(() => admin.query(sql)); }
  for (const n of MICRO) {
    // (a) buscar CADA elemento recorriendo el arreglo del respaldo (lo que hacía cada _apply_*): n recorridos de n elementos
    micro["una búsqueda lineal en el respaldo por elemento (jsonb_array_elements … WHERE id = …)"] ||= {};
    micro["una búsqueda lineal en el respaldo por elemento (jsonb_array_elements … WHERE id = …)"][n] = await timeSql(`do $$ declare v jsonb; r jsonb; begin v := (select jsonb_agg(jsonb_build_object('id', 'x' || g, 'v', g)) from generate_series(1, ${n}) g); for i in 1 .. ${n} loop select e into r from jsonb_array_elements(v) e where e ->> 'id' = 'x' || i; end loop; end $$`);
    // (b) lo mismo con el arreglo guardado en un campo grande (cada -> copia el subárbol: lo que pasaba con p_payload->'students')
    micro["la misma búsqueda extrayendo el arreglo del documento cada vez (p_payload->'x')"] ||= {};
    micro["la misma búsqueda extrayendo el arreglo del documento cada vez (p_payload->'x')"][n] = await timeSql(`do $$ declare v jsonb; r jsonb; begin v := jsonb_build_object('students', (select jsonb_agg(jsonb_build_object('id', 'x' || g, 'v', g)) from generate_series(1, ${n}) g)); for i in 1 .. ${n} loop select e into r from jsonb_array_elements(v -> 'students') e where e ->> 'id' = 'x' || i; end loop; end $$`);
    // (c) acumular el resultado con || (copia todo el arreglo en cada elemento)
    micro["acumular el resultado con v := v || jsonb_build_object(…)"] ||= {};
    micro["acumular el resultado con v := v || jsonb_build_object(…)"][n] = await timeSql(`do $$ declare v jsonb := '[]'; begin for i in 1 .. ${n} loop v := v || jsonb_build_object('legacy_mobile_id', 'x' || i, 'status', 'insertable'); end loop; end $$`);
    // (d) lo mismo con una sola agregación
    micro["lo mismo con una sola agregación (jsonb_agg)"] ||= {};
    micro["lo mismo con una sola agregación (jsonb_agg)"][n] = await timeSql(`do $$ declare v jsonb; begin select jsonb_agg(jsonb_build_object('legacy_mobile_id', 'x' || i, 'status', 'insertable')) into v from generate_series(1, ${n}) i; end $$`);
    // (e) unión de componentes con UPDATE por arista (algoritmo anterior) sobre una cadena de n nodos
    // (cadena de n/4 nodos: el algoritmo anterior sobre una cadena de n nodos tarda minutos y la base de pruebas llegó a cortar la conexión)
    micro["unión de componentes con un UPDATE de todos los nodos por arista (algoritmo anterior), cadena de n/4 nodos"] ||= {};
    micro["unión de componentes con un UPDATE de todos los nodos por arista (algoritmo anterior), cadena de n/4 nodos"][n] = await timeSql(`do $$ declare e record; ra text; rb text; m text; begin create temp table _u (k text primary key, root text) on commit drop; create temp table _e (a text, b text) on commit drop; insert into _u select 'n' || lpad(g::text, 6, '0'), 'n' || lpad(g::text, 6, '0') from generate_series(1, ${n / 4}) g; insert into _e select 'n' || lpad(g::text, 6, '0'), 'n' || lpad((g + 1)::text, 6, '0') from generate_series(1, ${n / 4} - 1) g; for e in select a, b from _e loop select root into ra from _u where k = e.a; select root into rb from _u where k = e.b; if ra is distinct from rb then m := least(ra, rb); update _u set root = m where root in (ra, rb); end if; end loop; end $$`);
    // (f) la misma cadena con union-find en un arreglo (algoritmo nuevo)
    micro["la misma cadena con union-find en un arreglo (algoritmo nuevo)"] ||= {};
    micro["la misma cadena con union-find en un arreglo (algoritmo nuevo)"][n] = await timeSql(`do $$ declare p int[]; a int; b int; begin p := array(select generate_series(1, ${n})); for i in 1 .. ${n} - 1 loop a := i; while p[a] <> a loop p[a] := p[p[a]]; a := p[a]; end loop; b := i + 1; while p[b] <> b loop p[b] := p[p[b]]; b := p[b]; end loop; if a <> b then if a < b then p[b] := a; else p[a] := b; end if; end if; end loop; end $$`);
  }
  results.micro = micro;
  console.log("\n== Micro-pruebas del mecanismo (ms)");
  for (const [name, t] of Object.entries(micro)) console.log(`  ${name.padEnd(105)} ${MICRO.map((n) => String(Math.round(t[n])).padStart(8)).join(" ")}   p=${fmt(exponent(t[MICRO[1]], t[MICRO[2]]))}`);

  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  await pg.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
