// Ensayo de la EXPORTACIÓN DEL DESTINO (copia de sólo lectura de lo que la cuenta tiene en la web) sobre el esquema de Production ANTERIOR a R9/R10 y sobre el nuevo,
// en un Postgres REAL aislado con datos SINTÉTICOS. Comprueba: detección explícita del esquema («no disponible en esta versión» sólo para las tablas que agregan R9/R10),
// aborto (nunca tablas vacías) ante falta de una tabla existente, permisos o red, cifrado y recuperación comprobada del volcado, y que aplicar R9/R10 después no
// cambia lo ya exportado de las tablas que existían.
//
//   set NODE_PATH=%TEMP%\epg\node_modules
//   node supabase/tests/postgres/export_schema_rehearsal.cjs
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { start } = require("./load.cjs");
const { helpers: H } = require("./r6_import.cjs");
const { generateBackup } = require("./r6_dataset.cjs");

const ROOT = path.join(__dirname, "..", "..", "..");
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const DIR = path.join(ROOT, "supabase", "migrations");
const BEFORE_R9 = fs.readdirSync(DIR).filter((f) => f < "20261019100000").sort().pop();
const A = H.A;

let total = 0;
const failures = [];
function check(name, cond, detail = "") {
  total += 1;
  if (!cond) failures.push(`${name}${detail ? " → " + detail : ""}`);
  console.log(`${cond ? "✓" : "✗"} ${name}${!cond && detail ? "  → " + detail : ""}`);
}

/** Cliente de lectura con el contrato de PostgREST que usa `readTable`, sobre una sesión REAL de la cuenta (rol authenticated, con RLS). Errores con la forma de PostgREST. */
function pgReadClient(session) {
  const toPostgrestError = (e) => {
    if (e.code === "42P01") return { code: "PGRST205", message: "Could not find the table in the schema cache" };
    return { code: e.code ?? "", message: e.message };
  };
  return {
    rpc: () => { throw new Error("no se usa"); },
    from(table) {
      if (!/^[a-z_]+$/.test(table)) throw new Error("tabla inválida");
      return {
        select(_cols, options) {
          const conds = [], params = [], orders = [];
          let limit = null;
          const q = {
            eq(c, v) { params.push(v); conds.push(`${c} = $${params.length}`); return q; },
            order(c, o) { orders.push(`${c} ${o && o.ascending === false ? "desc" : "asc"}`); return q; },
            limit(n) { limit = n; return q; },
            or() { throw new Error("or no soportado por este adaptador (tablas chicas)"); },
            gt() { throw new Error("gt no soportado"); },
            lt() { throw new Error("lt no soportado"); },
            then(resolve, reject) {
              const where = conds.length ? ` where ${conds.join(" and ")}` : "";
              const run = async () => {
                try {
                  const rows = (await session.query(`select to_jsonb(x) r from public.${table} x${where}${orders.length ? " order by " + orders.join(", ") : ""}${limit ? " limit " + limit : ""}`, params)).rows.map((r) => r.r);
                  const count = options && options.count ? (await session.query(`select count(*)::int n from public.${table}${where}`, params)).rows[0].n : null;
                  return { data: rows, error: null, count };
                } catch (e) {
                  return { data: null, error: toPostgrestError(e), count: null };
                }
              };
              return run().then(resolve, reject);
            },
          };
          return q;
        },
      };
    },
  };
}

async function main() {
  const { exportDestination, ExportAbortError, TABLES_ADDED_BY_TRANSFER_MIGRATIONS } = await mod("lib/transfer/export-destination.ts");
  const { DESTINATION_TABLES, compareTransfer } = await mod("lib/backup/transfer-compare.ts");
  const { encryptBuffer, verifyEncrypted, decryptBuffer } = await mod("lib/secure-copy/secure-copy.ts");

  const pg = await start({ port: 5681, upTo: BEFORE_R9 });
  if (pg.failures.length) { console.log("migraciones con error:", pg.failures); process.exit(1); }
  const { admin } = pg;
  await H.reset(admin);
  const s = await H.apiSession(pg, A, 60000);

  // Cuenta con datos reales de la importación (formato canónico sintético) sobre el esquema ANTERIOR.
  const backup = generateBackup(40, { prefix: "exp", levelHistory: false, selfLinks: false });
  const preview = (await s.query("select * from public.preview_backup_import($1::jsonb, '{}'::jsonb)", [JSON.stringify(backup)])).rows[0];
  await s.query("select * from public.apply_backup_import($1::uuid, '[]', '[]')", [preview.preview_id]);

  // 1) Esquema anterior.
  const before = await exportDestination(pgReadClient(s), A, DESTINATION_TABLES);
  check("esquema anterior: se detecta («anterior») y las tablas de R9/R10 se declaran «no disponibles en esta versión»", before.schema === "anterior" && JSON.stringify([...before.unavailable].sort()) === JSON.stringify([...TABLES_ADDED_BY_TRANSFER_MIGRATIONS].sort()), JSON.stringify(before.unavailable));
  check("esquema anterior: TODAS las tablas que existían se leyeron, con sus filas reales", Object.keys(before.tables).length === DESTINATION_TABLES.length - TABLES_ADDED_BY_TRANSFER_MIGRATIONS.length && before.tables.students.length === backup.students.length && before.tables.lesson_registrations.length > 0, JSON.stringify(Object.fromEntries(Object.entries(before.tables).map(([k, v]) => [k, v.length])).students));
  check("esquema anterior: una tabla no disponible NO figura como tabla vacía", !("lesson_attachments" in before.tables));
  const exactRows = (await admin.query("select count(*)::int n from public.students where owner_id = $1", [A])).rows[0].n;
  check("esquema anterior: lo leído coincide con lo que hay en la base (cuenta exacta)", before.tables.students.length === exactRows);

  // 2) Cifrado y recuperación comprobada del volcado del esquema anterior.
  const document = { kind: "destination", takenAt: "2026-10-19T00:00:00.000Z", schema: before.schema, unavailable: before.unavailable, tables: before.tables };
  const plain = Buffer.from(JSON.stringify(document), "utf8");
  const enc = encryptBuffer(plain, "frase de paso larga de prueba", { N: 1 << 10, r: 8, p: 1 });
  const verified = verifyEncrypted(enc.file, "frase de paso larga de prueba", enc.plaintextSha256);
  const recovered = JSON.parse(decryptBuffer(enc.file, "frase de paso larga de prueba").toString("utf8"));
  check("cifrado y recuperación del volcado del esquema anterior: huella idéntica y contenido idéntico, y el archivo cifrado no contiene datos en claro", verified.ok && JSON.stringify(recovered) === JSON.stringify(document) && !enc.file.toString("latin1").includes(backup.students[0].name), "");
  const cmp = compareTransfer({ students: [], profiles: {} }, recovered.tables);
  check("el comparador no se rompe con un volcado del esquema anterior (sin las tablas nuevas)", Array.isArray(cmp.entities) && cmp.files.length === 3);

  // 3) Errores que ABORTAN (nunca tablas vacías).
  await admin.query("revoke select on public.payments from authenticated");
  let kind = null;
  try { await exportDestination(pgReadClient(s), A, DESTINATION_TABLES); } catch (e) { kind = e instanceof ExportAbortError ? `${e.kind}:${e.table}` : "otro:" + e.message; }
  check("permiso de lectura revocado en una tabla existente: ABORTA (permisos), no devuelve la tabla vacía", kind === "permission:payments", String(kind));
  await admin.query("grant select on public.payments to authenticated");

  await admin.query("alter table public.payments rename to payments_x");
  kind = null;
  try { await exportDestination(pgReadClient(s), A, DESTINATION_TABLES); } catch (e) { kind = e instanceof ExportAbortError ? `${e.kind}:${e.table}` : "otro:" + e.message; }
  check("una tabla que existía y ya no está: ABORTA (no se declara «no disponible»)", kind === "missing_existing_table:payments", String(kind));
  await admin.query("alter table public.payments_x rename to payments");

  const failing = pgReadClient(s);
  const original = failing.from;
  failing.from = (t) => { if (t === "calendar_lessons") { throw new TypeError("fetch failed"); } return original(t); };
  kind = null;
  try { await exportDestination(failing, A, DESTINATION_TABLES); } catch (e) { kind = e instanceof ExportAbortError ? `${e.kind}:${e.table}` : "otro:" + e.message; }
  check("falla de red a mitad del volcado: ABORTA y no deja un volcado parcial", kind === "network:calendar_lessons", String(kind));

  // 4) Con R9 y R10 aplicadas el volcado usa el esquema nuevo y las tablas que existían no cambian.
  for (const f of fs.readdirSync(DIR).filter((x) => x > BEFORE_R9).sort()) await admin.query(fs.readFileSync(path.join(DIR, f), "utf8"));
  const after = await exportDestination(pgReadClient(s), A, DESTINATION_TABLES);
  check("con R9 y R10 aplicadas: esquema «r10», nada «no disponible» y las tablas nuevas figuran (vacías, pero como tablas)", after.schema === "r10" && after.unavailable.length === 0 && TABLES_ADDED_BY_TRANSFER_MIGRATIONS.every((t) => Array.isArray(after.tables[t]) && after.tables[t].length === 0));
  const same = ["students", "payments", "payment_charges", "calendar_lessons", "recurrence_rules"].every((t) => JSON.stringify(after.tables[t].map((r) => r.id).sort()) === JSON.stringify(before.tables[t].map((r) => r.id).sort()));
  check("las filas que existían antes de aplicar R9/R10 siguen exactamente las mismas (el volcado previo sirve de referencia)", same);

  await s.end();
  await pg.stop();
  console.log(`\n${total - failures.length}/${total} comprobaciones OK`);
  if (failures.length) { console.log("FALLAN:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
