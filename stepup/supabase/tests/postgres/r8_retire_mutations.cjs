// R8 — Mutaciones del retiro: cada una rompe a propósito la migración (no retira una función, vuelve a aceptar endDate, pierde el search_path o los privilegios, toca
// el alta nueva) y la batería de `r8_retire.cjs` tiene que detectarla (alguna comprobación falla o la carga se interrumpe).
//   node supabase/tests/postgres/r8_retire_mutations.cjs
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MIG = path.join(__dirname, "..", "..", "migrations");
const F = fs.readdirSync(MIG).find((f) => /^20261012\d{6}_r8_/.test(f));
const MUTATIONS = [
  ["no se retira claim_student_creation()", "drop function if exists public.claim_student_creation();", "select 1;"],
  ["no se retira create_student_via_web()", "drop function if exists public.create_student_via_web(uuid, jsonb, boolean);", "select 1;"],
  ["el split vuelve a aceptar endDate", "v_patch_end_date := nullif(v_original_patch->>'end_date', '')::date;", "v_patch_end_date := coalesce(nullif(v_original_patch->>'end_date', ''), nullif(v_original_patch->>'endDate', ''))::date;"],
  ["el split pierde el search_path vacío de R5", "security invoker\nset search_path = ''\nas $$", "security invoker\nas $$"],
  ["el split deja EXECUTE a anon", "revoke execute on function public.split_recurrence_this_and_future(jsonb) from anon;", "grant execute on function public.split_recurrence_this_and_future(jsonb) to anon;"],
  ["se deja de validar la fecha de fin de una original activa", "if v_patch_end_date is null then", "if false then"],
  ["se retira de más: también la tabla de claims", "drop function if exists public.claim_student_creation();", "drop function if exists public.claim_student_creation();\ndrop table if exists public.student_creation_claims cascade;"],
];

let undetected = 0;
for (const [name, from, to] of MUTATIONS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-r8-mut-"));
  for (const f of fs.readdirSync(MIG)) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(MIG, f), "utf8").replace(/\r\n/g, "\n"));
  const p = path.join(dir, F);
  const text = fs.readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`La mutación «${name}» no encontró su texto`);
  fs.writeFileSync(p, text.split(from).join(to));
  const r = spawnSync(process.execPath, [path.join(__dirname, "r8_retire.cjs")], { env: { ...process.env, MIGRATIONS_DIR: dir }, encoding: "utf8", timeout: 600000 });
  const detected = r.status !== 0;
  console.log(`${detected ? "✔ detectada " : "✘ NO DETECTADA"}  ${name}`);
  if (!detected) undetected += 1;
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(undetected ? `\n${undetected} mutación(es) SIN detectar` : `\nLas ${MUTATIONS.length} mutaciones se detectan.`);
process.exit(undetected ? 1 : 0);
