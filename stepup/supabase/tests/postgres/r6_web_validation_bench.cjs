// R6 — Costo de la validación de la web (tiempo y memoria) con respaldos sintéticos de 100 elementos hasta el máximo aceptado y por encima del límite.
//
//   node --expose-gc supabase/tests/postgres/r6_web_validation_bench.cjs
const path = require("path");
const { pathToFileURL } = require("url");
const { generateBackup, workUnits } = require("./r6_dataset.cjs");

function largest(limit, opts = {}) {
  let lo = 100;
  let hi = 20000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (workUnits(generateBackup(mid, opts)) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

(async () => {
  const { validateBackupPayload } = await import(pathToFileURL(path.resolve(__dirname, "..", "..", "..", "lib", "backup", "validation.ts")).href);
  const { BACKUP_IMPORT_LIMITS } = await import(pathToFileURL(path.resolve(__dirname, "..", "..", "..", "lib", "backup", "limits.ts")).href);
  function run(label, backup) {
    const text = JSON.stringify(backup);
    const raw = JSON.parse(text); // lo que recibe el servidor al leer la respuesta de la base
    if (global.gc) global.gc();
    const m0 = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    const r = validateBackupPayload(raw);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const m1 = process.memoryUsage().heapUsed;
    console.log(`${label.padEnd(38)} ${(Buffer.byteLength(text) / 1048576).toFixed(2).padStart(6)} MB  validación ${ms.toFixed(0).padStart(5)} ms  heap +${Math.max(0, (m1 - m0) / 1048576).toFixed(0).padStart(3)} MB  ${r.ok ? "acepta" : "rechaza: " + r.errors.map((e) => e.code).join(",")}`);
  }
  run("100 elementos", generateBackup(100, { levelHistory: false }));
  run("1.000 elementos", generateBackup(1000));
  run("2.000 elementos", generateBackup(2000));
  const nmax = largest(BACKUP_IMPORT_LIMITS.MAX_WORK_UNITS);
  const max = generateBackup(nmax);
  run(`máximo aceptado (${workUnits(max)} unidades)`, max);
  const long = generateBackup(nmax);
  for (const s of long.students) s.notes = "ñ".repeat(9000);
  run("máximo con notas largas (texto máximo en cada alumno)", long);
  run("por encima del límite (rechazo temprano)", generateBackup(nmax + 600));
  run("arreglo gigantesco (300.000 elementos)", { ...generateBackup(100), students: new Array(300000).fill({ id: "x" }) });
})();
