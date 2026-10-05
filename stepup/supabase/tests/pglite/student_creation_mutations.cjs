const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const SRC = path.join(__dirname, "..", "..", "migrations");
const TMP = path.join(__dirname, "mig_mut");
const FILE = "20261005160000_student_creation_operation_id.sql";
const muts = [
  ["sin replay: un reintento vuelve a crear", "  if v_existing and v_claim.status = 'created' then", "  if false then"],
  ["la clave cruza profesoras (sin owner_id)", "where scc.owner_id = v_owner and scc.operation_id = p_operation_id\n    for update;", "where scc.operation_id = p_operation_id\n    for update;"],
  ["el claim se crea aunque el payload sea inválido y se commitea (sin rollback): validar DESPUÉS de insertar y tragar el error", "  perform public._validate_new_student_payload(p_payload);\n\n  if not v_existing then", "  if not v_existing then"],
  ["se permite confirmar sin revisión previa", "    if v_claim.candidates_fingerprint is null then\n      raise exception 'No hay una revisión de posibles duplicados previa para confirmar en este borrador.';\n    end if;\n", ""],
  ["se limpian también los claims created", "scc.status = 'pending' and scc.expires_at < now() - interval '24 hours';", "scc.expires_at < now() - interval '24 hours';"],
  ["anon puede ejecutar", "revoke all on function public.create_student_with_operation(uuid, jsonb, boolean) from anon;", "grant execute on function public.create_student_with_operation(uuid, jsonb, boolean) to anon;"],
];
for (const [name, a, b] of muts) {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP);
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(TMP, f));
  const p = path.join(TMP, FILE);
  const sql = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  if (sql.split(a).length !== 2) { console.log("ANCLA NO ÚNICA:", name); continue; }
  fs.writeFileSync(p, sql.replace(a, () => b));
  const r = spawnSync("node", ["student_creation_scenarios.cjs"], { cwd: __dirname, encoding: "utf8", env: { ...process.env, MIGRATIONS_DIR: TMP } });
  console.log((r.status === 0 ? "NO DETECTADA " : "detectada    ") + "→ " + name);
}
fs.rmSync(TMP, { recursive: true, force: true });
