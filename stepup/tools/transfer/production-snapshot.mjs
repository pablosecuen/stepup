// RESPALDO PREVIO DE PRODUCTION (sólo lectura), de TODAS las cuentas y TODAS las tablas de `public`, antes de aplicar migraciones.
//
//   node tools/transfer/production-snapshot.mjs <carpeta-privada> [--etiqueta previa]
//
// Usa la CLI de Supabase ya enlazada (`supabase db query --linked`, lecturas): exporta cada tabla (filas completas) a UN archivo cifrado con Windows DPAPI (sólo se abre con este
// usuario de Windows) y comprueba la recuperación leyendo lo escrito en disco. Aparte deja un RESUMEN sin datos personales (cantidad de filas y huella md5 por tabla, huella de cada
// función, política y disparador) que sirve de línea base: después de las migraciones, lo existente tiene que seguir idéntico. No escribe nada en Production.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { encryptDpapi, verifyDpapi, decryptDpapi } from "../../lib/secure-copy/dpapi-copy.ts";
import { safeOutputPath } from "../../lib/secure-copy/secure-copy.ts";

const [folder, ...flags] = process.argv.slice(2);
const label = flags.includes("--etiqueta") ? flags[flags.indexOf("--etiqueta") + 1] : "previa";
if (!folder) {
  console.error("Uso: production-snapshot.mjs <carpeta-privada> [--etiqueta previa]");
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), "tf-snap-"));
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/** Una consulta de SÓLO LECTURA contra Production con la CLI enlazada. */
function query(sql) {
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(sql.replace(/'[^']*'/g, "''"))) throw new Error("el respaldo sólo admite lecturas");
  const file = join(work, `q-${createHash("sha1").update(sql).digest("hex").slice(0, 10)}.sql`);
  writeFileSync(file, sql);
  const r = spawnSync("npx.cmd", ["supabase", "db", "query", "--linked", "-f", file], { shell: true, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, windowsHide: true, cwd: join(import.meta.dirname, "..", "..") });
  const text = `${r.stdout ?? ""}`;
  const start = text.indexOf("{");
  if (r.status !== 0 || start < 0) throw new Error(`falló una consulta de lectura (código ${r.status})`);
  const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
  return parsed.rows ?? [];
}

try {
  const tables = query("select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1").map((r) => r.t);
  console.log(`Tablas de public: ${tables.length}`);
  const data = {};
  const summary = { takenAt: d.toISOString(), tables: {}, functions: {}, policies: "", triggers: "", columns: "" };
  for (const t of tables) {
    // Una sola consulta por tabla (una sola foto consistente): filas completas, cantidad y huella.
    const one = query(`select count(*)::int as n, coalesce(md5(string_agg(md5(x::text), '' order by md5(x::text))), '') as h, coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as j from public."${t}" x`)[0];
    data[t] = one.j;
    const meta = { n: one.n, h: one.h };
    if (meta.n !== data[t].length) throw new Error(`la tabla ${t} no coincide consigo misma (${meta.n} ≠ ${data[t].length})`);
    summary.tables[t] = { rows: meta.n, md5: meta.h };
  }
  for (const r of query("select p.oid::regprocedure::text as k, md5(pg_get_functiondef(p.oid)) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1")) summary.functions[r.k] = r.h;
  summary.policies = query("select md5(coalesce(string_agg(schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname), '')) as h from pg_policies where schemaname in ('public', 'storage')")[0].h;
  summary.triggers = query("select md5(coalesce(string_agg(c.relname || '.' || t.tgname, '|' order by c.relname, t.tgname), '')) as h from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname = 'public'")[0].h;
  summary.columns = query("select md5(coalesce(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, '|' order by table_name, ordinal_position), '')) as h from information_schema.columns where table_schema = 'public'")[0].h;
  summary.buckets = query("select id, file_size_limit::text as lim, (select count(*)::int from storage.objects o where o.bucket_id = b.id) as objects from storage.buckets b order by 1");

  mkdirSync(folder, { recursive: true });
  const out = safeOutputPath(join(folder, `produccion-${label}-${stamp}.tfdp`));
  const plain = Buffer.from(JSON.stringify({ kind: "production-snapshot", takenAt: summary.takenAt, data }), "utf8");
  const { file, plaintextSha256 } = encryptDpapi(plain);
  const partial = `${out}.parcial`;
  writeFileSync(partial, file, { mode: 0o600, flag: "wx" });
  verifyDpapi(readFileSync(partial), plaintextSha256);
  renameSync(partial, out);
  verifyDpapi(readFileSync(out), plaintextSha256);
  // Recuperación REAL: se descifra lo escrito en disco y se vuelve a contar cada tabla contra el resumen.
  const back = JSON.parse(decryptDpapi(readFileSync(out)).toString("utf8"));
  for (const t of tables) if (back.data[t].length !== summary.tables[t].rows) throw new Error(`la recuperación de ${t} no coincide`);
  const summaryFile = safeOutputPath(join(folder, `produccion-${label}-${stamp}.resumen.json`));
  writeFileSync(summaryFile, JSON.stringify({ ...summary, encryptedFile: out.split(/[\\/]/).pop(), plaintextSha256 }, null, 2), { flag: "wx" });
  const rowsTotal = Object.values(summary.tables).reduce((n, t) => n + t.rows, 0);
  console.log(`RESPALDO PREVIO LISTO: ${tables.length} tablas · ${rowsTotal} filas · ${Object.keys(summary.functions).length} funciones · cifrado con DPAPI y recuperación comprobada desde el disco.`);
  console.log(`Archivo: ${out}`);
  console.log(`Resumen (sin datos personales): ${summaryFile}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
