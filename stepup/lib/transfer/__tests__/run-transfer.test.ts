import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeSupabase, type FakeAuthMode, type FakeSupabase } from "./fake-supabase.ts";
import { buildMobileBackup } from "../../backup/__fixtures__/mobile-real-shape.ts";
import { TABLES_ADDED_BY_TRANSFER_MIGRATIONS } from "../export-destination.ts";
import { openCopy } from "../../secure-copy/open-copy.ts";
import { encryptBuffer } from "../../secure-copy/secure-copy.ts";

/** Circuito completo del ensayo (autenticar → exportar → DPAPI → verificar → ensayo), contra un Supabase de mentira local y con datos ficticios. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(ROOT, "tools", "transfer", "run-transfer.mjs");
const EMAIL = "usuario.ficticio@example.invalid";
const PASSWORD = "Clave-Ficticia-123!";
const GOLDEN = JSON.parse(readFileSync(join(ROOT, "lib", "backup", "__fixtures__", "mobile-real-shape.destination.json"), "utf8")) as Record<string, Record<string, unknown>[]>;
const PERSONAL = ["ZQ Alumna Uno", "+54 9 11 5550-0001", "zq.uno@example.invalid", "ZQ nota privada", "41000.37"];
const win = process.platform === "win32";

interface Scenario {
  server: FakeSupabase;
  dir: string;
  envFile: string;
  out: string;
}

async function scenario(options: { backupCreatedAt?: string } = {}): Promise<Scenario> {
  const server = await startFakeSupabase({ email: EMAIL, password: PASSWORD, backupPayload: buildMobileBackup(), backupCreatedAt: options.backupCreatedAt, tables: GOLDEN, missingTables: [...TABLES_ADDED_BY_TRANSFER_MIGRATIONS] });
  const dir = mkdtempSync(join(tmpdir(), "tf-run-"));
  const envFile = join(dir, "fake.env");
  writeFileSync(envFile, `NEXT_PUBLIC_SUPABASE_URL=${server.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=clave-publica-ficticia\n`);
  return { server, dir, envFile, out: join(dir, "privada") };
}
const cleanup = async (s: Scenario) => {
  await s.server.close();
  rmSync(s.dir, { recursive: true, force: true });
};

function run(s: Scenario, credentials: { email: string; password: string } | string, extra: string[] = [], env: Record<string, string> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, s.out, ...extra], { env: { ...process.env, TF_ENV_FILE: s.envFile, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof credentials === "string" ? credentials : JSON.stringify(credentials));
  });
}

const authFail = (stdout: string) => stdout.split(/\r?\n/).find((l) => l.startsWith("@@AUTH_FAIL|"))?.split("|");

test("credenciales rechazadas: lo dice claro, sale con 10, no crea nada y no filtra ni el correo ni la contraseña", async () => {
  const s = await scenario();
  try {
    const r = await run(s, { email: EMAIL, password: "otra-clave" });
    assert.equal(r.code, 10);
    const fail = authFail(r.stdout);
    assert.equal(fail?.[1], "credentials");
    assert.match(fail?.[2] ?? "", /RECHAZÓ el correo o la contraseña \(la conexión funciona\)/);
    assert.match(fail?.[2] ?? "", /No se cambió ni restableció nada/);
    assert.equal(existsSync(s.out), false, "no se creó ni la carpeta");
    for (const secret of [EMAIL, PASSWORD, "otra-clave", "clave-publica-ficticia"]) assert.equal((r.stdout + r.stderr).includes(secret), false, secret);
    assert.equal(s.server.calls.some((c) => c.path === "/auth/v1/recover" || c.path === "/auth/v1/logout"), false, "no restablece contraseñas ni cierra sesiones");
  } finally {
    await cleanup(s);
  }
});

test("cada causa de falla se distingue: servicio caído, clave pública rechazada, demasiados intentos, correo sin confirmar y sin red", async () => {
  const cases: [FakeAuthMode, string][] = [
    ["health_500", "service"],
    ["health_401", "config"],
    ["token_500", "service"],
    ["token_429", "rate_limited"],
    ["token_unconfirmed", "email_not_confirmed"],
  ];
  for (const [mode, kind] of cases) {
    const s = await scenario();
    try {
      s.server.mode = mode;
      const r = await run(s, { email: EMAIL, password: PASSWORD });
      assert.equal(r.code, 10, mode);
      assert.equal(authFail(r.stdout)?.[1], kind, mode);
      assert.equal((r.stdout + r.stderr).includes(PASSWORD), false);
    } finally {
      await cleanup(s);
    }
  }
  const s = await scenario();
  try {
    writeFileSync(s.envFile, "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9\nNEXT_PUBLIC_SUPABASE_ANON_KEY=x\n");
    const r = await run(s, { email: EMAIL, password: PASSWORD });
    assert.equal(r.code, 10);
    assert.equal(authFail(r.stdout)?.[1], "network");
    assert.match(authFail(r.stdout)?.[2] ?? "", /credenciales NO fueron evaluadas/);
  } finally {
    await cleanup(s);
  }
});

test("las credenciales sólo se aceptan por la entrada estándar y en el formato esperado", async () => {
  const s = await scenario();
  try {
    for (const bad of ["", "no es json", JSON.stringify({ email: EMAIL }), JSON.stringify({ email: "", password: "x" })]) {
      const r = await run(s, bad);
      assert.equal(r.code, 1, bad);
      assert.equal(existsSync(s.out), false);
      assert.equal((r.stdout + r.stderr).includes(EMAIL), false);
    }
    const noArgs = await new Promise<number | null>((resolve) => spawn(process.execPath, [SCRIPT], { stdio: "ignore" }).on("close", resolve));
    assert.equal(noArgs, 2);
  } finally {
    await cleanup(s);
  }
});

test("las credenciales con una marca BOM (al principio o al final) se aceptan igual", { skip: !win }, async () => {
  const s = await scenario();
  try {
    for (const wrapped of [`\uFEFF${JSON.stringify({ email: EMAIL, password: "otra-clave" })}`, `${JSON.stringify({ email: EMAIL, password: "otra-clave" })}\uFEFF\n`]) {
      const r = await run(s, wrapped);
      assert.equal(r.code, 10, "llegó hasta Supabase y fue rechazada (no un error de formato)");
      assert.equal(authFail(r.stdout)?.[1], "credentials");
    }
  } finally {
    await cleanup(s);
  }
});

test("circuito sin ensayo: dos copias DPAPI verificadas desde disco, nada en claro, copias anteriores intactas, sólo cierra su sesión local", { skip: !win, timeout: 180_000 }, async () => {
  const s = await scenario({ backupCreatedAt: new Date(Date.now() - 71 * 60_000).toISOString() });
  try {
    // Una copia anterior (con frase) que debe quedar exactamente igual.
    const previous = encryptBuffer(Buffer.from("{}"), "frase de paso larga de prueba", { N: 1 << 10, r: 8, p: 1 }).file;
    const { mkdirSync } = await import("node:fs");
    mkdirSync(s.out, { recursive: true });
    writeFileSync(join(s.out, "origen-anterior.tfsc"), previous);

    const r = await run(s, { email: EMAIL, password: PASSWORD }, ["--sin-ensayo"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const summary = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("@@SUMMARY|")).map((l) => l.slice(10));
    assert.match(summary.join("\n"), /COPIAS VERIFICADAS \(2\)/);
    assert.match(summary.join("\n"), /Windows DPAPI.*ESTE usuario de Windows/);
    assert.match(summary.join("\n"), /1 h 11 min/, "informa la antigüedad del respaldo");
    assert.match(summary.join("\n"), /Production no se modificó/);
    assert.ok(r.stdout.includes("@@AUTH_OK"));

    const files = readdirSync(s.out).sort();
    assert.equal(files.length, 3, files.join(", "));
    assert.deepEqual(readFileSync(join(s.out, "origen-anterior.tfsc")), previous, "la copia anterior no se tocó");
    const origin = files.find((f) => /^origen-dpapi-.*\.tfdp$/.test(f));
    const destination = files.find((f) => /^destino-dpapi-.*\.tfdp$/.test(f));
    assert.ok(origin && destination, files.join(", "));
    assert.equal(files.some((f) => f.endsWith(".parcial")), false);
    for (const f of [origin, destination]) {
      const bytes = readFileSync(join(s.out, f));
      for (const secret of [...PERSONAL, EMAIL, PASSWORD]) assert.equal(bytes.includes(Buffer.from(secret)), false, `${f} contiene un dato en claro`);
    }
    const no = async () => { throw new Error("no debería pedir frase"); };
    const originDoc = JSON.parse((await openCopy(readFileSync(join(s.out, origin)), no)).toString("utf8"));
    const destinationDoc = JSON.parse((await openCopy(readFileSync(join(s.out, destination)), no)).toString("utf8"));
    assert.equal(originDoc.kind, "origin");
    assert.equal(destinationDoc.kind, "destination");
    assert.equal(destinationDoc.schema, "anterior");
    assert.deepEqual(destinationDoc.unavailable.sort(), [...TABLES_ADDED_BY_TRANSFER_MIGRATIONS].sort());

    for (const secret of [...PERSONAL, EMAIL, PASSWORD, "clave-publica-ficticia"]) assert.equal((r.stdout + r.stderr).includes(secret), false, secret);
    const logout = s.server.calls.filter((c) => c.path === "/auth/v1/logout");
    assert.deepEqual(logout.map((c) => c.scope), ["local"], "cierra sólo su propia sesión");
    assert.equal(s.server.calls.some((c) => c.method !== "GET" && c.method !== "POST"), false);
    assert.equal(s.server.calls.filter((c) => c.method === "POST" && !/\/auth\/v1\/(token|logout)|\/rpc\/fetch_own_latest_cloud_backup/.test(c.path)).length, 0, "sólo lecturas (y el inicio/cierre de su sesión)");
  } finally {
    await cleanup(s);
  }
});

test("run-transfer: sin secretos en argumentos ni variables, sin escrituras en claro, y nada que modifique Production", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const writes = [...source.matchAll(/writeFileSync\(([^,]+),/g)].map((m) => m[1].trim());
  assert.deepEqual(writes, ["partial", "reportPath"], "sólo el archivo parcial CIFRADO y el informe (ids, campos y cantidades)");
  assert.doesNotMatch(source, /process\.argv[^;]*(email|password)/i);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*(PASSWORD|EMAIL|PASSPHRASE)/);
  assert.doesNotMatch(source, /service_role|SERVICE_ROLE|\.insert\(|\.update\(|\.delete\(|\.upsert\(|resetPasswordForEmail|updateUser|scope: "global"|scope: "others"|\.rpc\("(?!fetch_own_latest_cloud_backup)/);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /credentials = null/);
  assert.doesNotMatch(source, /console\.log\([^)]*(credentials|password|email)/i);
});
