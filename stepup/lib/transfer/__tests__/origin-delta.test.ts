import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffOrigins } from "../origin-delta.ts";
import { encryptBuffer } from "../../secure-copy/secure-copy.ts";
import { buildMobileBackup } from "../../backup/__fixtures__/mobile-real-shape.ts";

type Row = Record<string, unknown>;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const PERSONAL = ["ZQ Alumna Uno", "+54 9 11 5550-0001", "ZQ nota privada", "41000.37", "ZQ tema visto uno"];

test("dos copias idénticas: sin diferencias", () => {
  const delta = diffOrigins(buildMobileBackup(), buildMobileBackup());
  assert.equal(delta.hasChanges, false);
  assert.deepEqual(delta.totals, { added: 0, removed: 0, changed: 0 });
});

test("lo cargado después de la copia aparece por colección e identificador: clase nueva, pago nuevo, alumno modificado, cobro quitado", () => {
  const before = buildMobileBackup();
  const after = clone(before);
  (after.pedagogicalLessons as Row[]).push({ id: "les-nueva", form: { eventType: "clase_dictada" } });
  (after.payments as Row[]).push({ id: "pay-nuevo", studentId: "stu-1", amount: 100 });
  (after.profiles as Record<string, Row>)["stu-2"].phone = "+54 9 11 0000-0000";
  (after.students as Row[])[0].nextClassAt = "2031-01-01T00:00:00.000Z";
  after.paymentCharges = (after.paymentCharges as Row[]).filter((c) => c.id !== "chg-5");
  (after.teacherProfile as Row).displayName = "Otro nombre";
  const delta = diffOrigins(before, after);
  const of = (name: string) => delta.collections.find((c) => c.collection === name)!;
  assert.deepEqual(of("pedagogicalLessons").added, ["les-nueva"]);
  assert.deepEqual(of("payments").added, ["pay-nuevo"]);
  assert.deepEqual(of("profiles").changed, [{ id: "stu-2", fields: ["phone"] }]);
  assert.deepEqual(of("students").changed, [{ id: "stu-1", fields: ["nextClassAt"] }]);
  assert.deepEqual(of("paymentCharges").removed, ["chg-5"]);
  assert.deepEqual(delta.singletons.find((s) => s.name === "teacherProfile"), { name: "teacherProfile", changed: true, fields: ["displayName"] });
  assert.equal(delta.hasChanges, true);
  assert.deepEqual(delta.totals, { added: 2, removed: 1, changed: 2 });
});

test("el resultado nunca lleva valores: sólo identificadores y nombres de campo", () => {
  const before = buildMobileBackup();
  const after = clone(before);
  (after.profiles as Record<string, Row>)["stu-1"].phone = "+54 9 11 9999-9999";
  (after.profiles as Record<string, Row>)["stu-1"].notes = "otra nota";
  const text = JSON.stringify(diffOrigins(before, after));
  for (const secret of [...PERSONAL, "9999-9999", "otra nota"]) assert.equal(text.includes(secret), false, secret);
  assert.match(text, /"fields":\["notes","phone"\]/);
});

test("la herramienta de línea de comandos compara dos copias cifradas y sale con 1 si hay algo para incorporar", () => {
  const dir = mkdtempSync(join(tmpdir(), "tf-delta-"));
  try {
    const FAST = { N: 1 << 10, r: 8, p: 1 };
    const doc = (payload: unknown, checksum: string) => ({ kind: "origin", cloudBackup: { createdAt: "2026-10-19T00:00:00.000Z", checksum }, payload });
    const write = (name: string, payload: unknown, checksum: string) => {
      const path = join(dir, name);
      writeFileSync(path, encryptBuffer(Buffer.from(JSON.stringify(doc(payload, checksum))), "frase de paso larga de prueba", FAST).file);
      return path;
    };
    const base = buildMobileBackup();
    const newer = clone(base);
    (newer.payments as Row[]).push({ id: "pay-nuevo", studentId: "stu-1", amount: 100 });
    const cli = join(import.meta.dirname, "..", "..", "..", "tools", "transfer", "origin-delta.mjs");
    const run = (a: string, b: string) => spawnSync(process.execPath, [cli, a, b], { env: { ...process.env, TF_COPY_PASSPHRASE: "frase de paso larga de prueba" }, encoding: "utf8" });
    const same = run(write("a.tfsc", base, "aaa"), write("b.tfsc", base, "aaa"));
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /MISMO respaldo/);
    const diff = run(join(dir, "a.tfsc"), write("c.tfsc", newer, "bbb"));
    assert.equal(diff.status, 1);
    assert.match(diff.stdout, /payments:\n  \+ nuevos \(1\): pay-nuevo/);
    assert.match(diff.stdout, /incorporarlos antes de cerrar el traslado/);
    for (const secret of PERSONAL) assert.equal((diff.stdout + diff.stderr).includes(secret), false, secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
