import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encryptBuffer } from "../secure-copy.ts";
import { buildMobileBackup } from "../../backup/__fixtures__/mobile-real-shape.ts";
import type { DestinationDump } from "../../backup/transfer-compare.ts";

/** Herramientas del traslado (copias cifradas del origen y del destino y su comparación), probadas de punta a punta con datos sintéticos. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const TOOLS = join(ROOT, "tools", "transfer");
const PASS = "frase de paso larga de prueba";
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "lib", "backup", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as DestinationDump;
const FAST = { N: 1 << 10, r: 8, p: 1 };
const PERSONAL = ["ZQ Alumna Uno", "+54 9 11 5550-0001", "zq.uno@example.invalid", "ZQ nota privada", "41000.37", "ZQ notas internas de la clase", "ZQ tema visto uno"];

function writeCopy(dir: string, name: string, document: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, encryptBuffer(Buffer.from(JSON.stringify(document)), PASS, FAST).file);
  return path;
}
const origin = () => ({ kind: "origin", takenAt: "2026-10-19T00:00:00.000Z", cloudBackup: { createdAt: "2026-10-19T00:00:00.000Z" }, payload: buildMobileBackup() });
const destination = (mutate?: (d: DestinationDump) => void) => {
  const tables = JSON.parse(JSON.stringify(GOLDEN)) as DestinationDump;
  mutate?.(tables);
  return { kind: "destination", takenAt: "2026-10-19T00:00:00.000Z", tables };
};
const compare = (a: string, b: string) => spawnSync(process.execPath, [join(TOOLS, "compare-copies.mjs"), a, b], { env: { ...process.env, TF_COPY_PASSPHRASE: PASS }, encoding: "utf8" });

test("comparar las dos copias cifradas: COMPLETO con el destino correcto, y la salida no lleva ningún dato personal", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-compare-"));
  try {
    const r = compare(writeCopy(dir, "origen.tfsc", origin()), writeCopy(dir, "destino.tfsc", destination()));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /VEREDICTO: COMPLETO/);
    for (const secret of PERSONAL) assert.equal((r.stdout + r.stderr).includes(secret), false, secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("con un dato intercambiado o faltante: NO COMPLETO, sale con error, indica qué (ids, campos, cantidades) y sigue sin imprimir valores", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-compare-"));
  try {
    const bad = destination((d) => {
      const a = d.students.find((x) => x.legacy_mobile_id === "stu-1") as Record<string, unknown>;
      const b = d.students.find((x) => x.legacy_mobile_id === "stu-2") as Record<string, unknown>;
      [a.phone, b.phone] = [b.phone, a.phone];
      d.payments = d.payments.filter((p) => p.legacy_mobile_id !== "pay-2");
    });
    const r = compare(writeCopy(dir, "origen.tfsc", origin()), writeCopy(dir, "destino.tfsc", bad));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /VEREDICTO: NO COMPLETO/);
    assert.match(r.stdout, /Alumnos · phone: 2 de 4/);
    assert.match(r.stdout, /FALTAN \(ids\): pay-2/);
    for (const secret of PERSONAL) assert.equal((r.stdout + r.stderr).includes(secret), false, secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copias en el orden equivocado, con otra frase de paso o alteradas: no compara y no imprime nada del contenido", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-compare-"));
  try {
    const o = writeCopy(dir, "origen.tfsc", origin());
    const d = writeCopy(dir, "destino.tfsc", destination());
    assert.equal(compare(d, o).status, 1, "orden equivocado");
    const wrong = spawnSync(process.execPath, [join(TOOLS, "compare-copies.mjs"), o, d], { env: { ...process.env, TF_COPY_PASSPHRASE: "otra frase de paso larga" }, encoding: "utf8" });
    assert.equal(wrong.status, 1);
    assert.equal(wrong.stdout.includes("VEREDICTO"), false);
    const tampered = readFileSync(d);
    tampered[tampered.length - 30] ^= 0xff;
    writeFileSync(join(dir, "alterada.tfsc"), tampered);
    assert.equal(compare(o, join(dir, "alterada.tfsc")).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export-account: sólo lee y sólo escribe el archivo CIFRADO (nunca en claro); cierra únicamente su propia sesión; no usa la clave de servicio", () => {
  const source = readFileSync(join(TOOLS, "export-account.mjs"), "utf8");
  const writes = [...source.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(writes, ["partial"], "la única escritura es el archivo parcial CIFRADO");
  assert.match(source, /encryptBuffer\(plain, passphrase\)/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.doesNotMatch(source, /scope: "global"|scope: "others"|service_role|SERVICE_ROLE|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(source, /console\.log\([^)]*(email|password|passphrase)\b/i);
  const usage = spawnSync(process.execPath, [join(TOOLS, "export-account.mjs")], { encoding: "utf8" });
  assert.equal(usage.status, 2);
});

test("export-account both: valida las rutas ANTES de pedir nada (fuera del repositorio, sin pisar) y TF_ENV_FILE inexistente se rechaza sin iniciar sesión", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-both-"));
  try {
    const run = (folder: string, env: Record<string, string> = {}) => spawnSync(process.execPath, [join(TOOLS, "export-account.mjs"), "both", folder], { env: { ...process.env, ...env }, encoding: "utf8", input: "" });
    // Un repositorio de prueba propio (carpeta con `.git`): no depende de que el árbol donde corre la prueba conserve su `.git` (una copia LF no lo trae).
    mkdirSync(join(dir, "repo", ".git"), { recursive: true });
    const inside = run(join(dir, "repo", "copias-dentro-del-repo"));
    assert.equal(inside.status, 1);
    assert.match(inside.stderr, /FUERA del repositorio/);
    const missingEnv = run(join(dir, "privada"), { TF_ENV_FILE: join(dir, "no-existe.env") });
    assert.equal(missingEnv.status, 1);
    assert.match(missingEnv.stderr, /TF_ENV_FILE/);
    const noTty = run(join(dir, "privada"), { TF_ENV_FILE: "", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" });
    assert.equal(noTty.status, 1);
    assert.match(noTty.stderr, /terminal interactiva/, "sin terminal no pide ni usa credenciales");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("export-account: el respaldo del origen informa su antigüedad y los dos comandos aceptan TF_ENV_FILE", () => {
  const exporter = readFileSync(join(TOOLS, "export-account.mjs"), "utf8");
  assert.match(exporter, /describeBackupAge\(row\.created_at/);
  assert.match(exporter, /TF_ENV_FILE/);
  const freeze = readFileSync(join(TOOLS, "freeze-legacy.mjs"), "utf8");
  assert.match(freeze, /TF_ENV_FILE/);
  // Archivos ausentes en el teléfono: sin aceptación explícita (ACEPTO) no se congela, y queda registrada en la auditoría.
  assert.match(freeze, /ACEPTO/);
  assert.match(freeze, /absent_accepted_by_user/);
});

test("freeze-legacy: sólo agrega y congela (nunca borra), usa únicamente las funciones previstas y cierra sólo su sesión", () => {
  const source = readFileSync(join(TOOLS, "freeze-legacy.mjs"), "utf8");
  const rpcs = [...source.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(rpcs)], ["archive_legacy_cloud_backups", "freeze_legacy_source", "get_transfer_state", "reopen_legacy_source"]);
  assert.doesNotMatch(source, /\.from\(|\.delete\(|\.insert\(|\.upsert\(|scope: "global"|scope: "others"|service_role|SERVICE_ROLE|auth\.admin|signOut\(\)/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /CONFIRMO/);
  assert.equal(spawnSync(process.execPath, [join(TOOLS, "freeze-legacy.mjs")], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [join(TOOLS, "freeze-legacy.mjs"), "freeze", "solo-una"], { encoding: "utf8" }).status, 2);
});

test("freeze-legacy freeze: con un cotejo NO completo no congela y ni siquiera inicia sesión; con el cotejo completo exige la confirmación escrita (terminal)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-freeze-"));
  try {
    const run = (o: string, d: string) => spawnSync(process.execPath, [join(TOOLS, "freeze-legacy.mjs"), "freeze", o, d], { env: { ...process.env, TF_COPY_PASSPHRASE: PASS, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" }, encoding: "utf8", input: "" });
    const withChecksum = { ...origin(), cloudBackup: { createdAt: "2026-10-19T00:00:00.000Z", checksum: "a".repeat(64) } };
    const o = writeCopy(dir, "origen.tfsc", withChecksum);
    const bad = run(o, writeCopy(dir, "destino-malo.tfsc", destination((d) => { d.payments = d.payments.filter((p) => p.legacy_mobile_id !== "pay-2"); })));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /NO es COMPLETO: no se congela nada/);
    assert.equal(bad.stdout.includes("CONFIRMO"), false);
    const good = run(o, writeCopy(dir, "destino-bueno.tfsc", destination()));
    assert.equal(good.status, 1);
    assert.match(good.stdout, /0 diferencias/);
    assert.match(good.stderr, /terminal interactiva/, "pide la confirmación escrita antes de tocar nada");
    for (const secret of PERSONAL) assert.equal((good.stdout + good.stderr + bad.stdout + bad.stderr).includes(secret), false, secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
