import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createCopyReceiver, createPhoneChannel, setImportLine } from "../../../tools/transfer/phone-copy.mjs";
import { COPY_IMPORT_LINE, COPY_TEMP_MODULE } from "../phone-copy-module.ts";

/** Canal con el teléfono: receptor de un solo uso, módulo temporal y app que queda IDÉNTICA. Sin teléfono real: un simulador envía lo mismo que enviaría el módulo. */

async function listen(token: string, onProgress: (p: unknown) => void, onResult: (r: unknown) => void) {
  const server = createCopyReceiver({ token, onProgress, onResult });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("el receptor acepta avance y UN resultado con la clave correcta; rechaza clave, método y tamaño incorrectos", async () => {
  const progress: unknown[] = [];
  const results: unknown[] = [];
  const { server, base } = await listen("ab12", (p) => progress.push(p), (r) => results.push(r));
  try {
    const post = (path: string, body: unknown, method = "POST") => fetch(base + path, { method, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    assert.equal((await post("/resultado/zz", {})).status, 403);
    assert.equal((await post("/otra/ab12", {})).status, 403);
    assert.equal((await post("/resultado/ab12", {}, "GET")).status, 405);
    assert.equal((await post("/progreso/ab12", { done: 5, total: 80 })).status, 200);
    assert.deepEqual(progress, [{ done: 5, total: 80 }]);
    assert.equal((await post("/progreso/ab12", { nada: 1 })).status, 200, "un avance sin la forma esperada se ignora");
    assert.equal(progress.length, 1);
    assert.equal((await post("/resultado/ab12", "no es json")).status, 400);
    assert.equal((await post("/resultado/ab12", { x: "y".repeat(300 * 1024) })).status, 413);
    assert.equal(results.length, 0);
    assert.equal((await post("/resultado/ab12", { ok: 1 })).status, 200);
    assert.equal((await post("/resultado/ab12", { ok: 2 })).status, 409, "un solo resultado");
    assert.deepEqual(results, [{ ok: 1 }]);
  } finally {
    server.close();
  }
});

test("la línea de import se agrega y se quita dejando el archivo idéntico (LF y CRLF)", () => {
  for (const eol of ["\n", "\r\n"]) {
    const original = ["import React from 'react';", "import { x } from './x';", "", "export const A = 1;", ""].join(eol);
    const withLine = setImportLine(original, COPY_IMPORT_LINE, true);
    assert.ok(withLine.includes(COPY_IMPORT_LINE) && withLine.indexOf(COPY_IMPORT_LINE) < withLine.indexOf("export const"));
    assert.equal(setImportLine(withLine, COPY_IMPORT_LINE, false), original);
  }
});

test("canal con el teléfono: instala el módulo, espera el resultado, borra todo y la app queda idéntica; sin respuesta no queda nada instalado", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "tf-canal-"));
  mkdirSync(join(appDir, "src", "features", "transfer"), { recursive: true });
  const entry = join(appDir, "src", "features", "transfer", "PhoneTransferEntry.tsx");
  const ORIGINAL = "import React from 'react';\nimport { x } from './x';\n\nexport const A = 1;\n";
  writeFileSync(entry, ORIGINAL);
  const moduleFile = join(appDir, "src", "features", "transfer", COPY_TEMP_MODULE);
  try {
    const kind = { total: 2, uploaded: 2, alreadyThere: 0, missingAtOrigin: 0, failed: 0 };
    const report = { trial: false, complete: true, counts: { lesson_attachment: kind, material: kind, report_pdf: kind }, failed: [], missingAtOrigin: [], actualFormats: {}, gates: { pendingOperations: 0, activeClassSession: false }, unreadable: 0 };
    let installedDuringRun = "";
    const channel = createPhoneChannel({
      appDir,
      addresses: ["127.0.0.1"],
      firstSignalMs: 1500,
      stallMs: 1500,
      requestReloadImpl: async () => {
        installedDuringRun = readFileSync(moduleFile, "utf8");
        const targets = JSON.parse(/TARGETS: readonly string\[\] = (\[.*\]);/.exec(installedDuringRun)![1]);
        const token = /TOKEN = "([0-9a-f]+)"/.exec(installedDuringRun)![1];
        assert.match(readFileSync(entry, "utf8"), /import '\.\/autoCopyTemp';/);
        void fetch(`${targets[0]}/progreso/${token}`, { method: "POST", body: JSON.stringify({ done: 1, total: 2 }) }).then(() => fetch(`${targets[0]}/resultado/${token}`, { method: "POST", body: JSON.stringify(report) }));
        return true;
      },
    });
    const ok = await channel.run("full", { timeoutMs: 10_000 });
    assert.equal(ok.state, "listo");
    assert.match(installedDuringRun, /const MODE: 'trial' \| 'full' \| 'protection' = "full"/);
    assert.equal(readFileSync(entry, "utf8"), ORIGINAL, "la app quedó idéntica");
    assert.throws(() => readFileSync(moduleFile), /ENOENT/, "el módulo temporal se borró");

    const silent = createPhoneChannel({ appDir, addresses: ["127.0.0.1"], firstSignalMs: 1200, stallMs: 1200, requestReloadImpl: async () => true });
    assert.deepEqual(await silent.run("trial", { timeoutMs: 10_000 }), { state: "sin_respuesta" });
    assert.equal(readFileSync(entry, "utf8"), ORIGINAL);
    assert.throws(() => readFileSync(moduleFile), /ENOENT/);

    const broken = createPhoneChannel({
      appDir,
      addresses: ["127.0.0.1"],
      requestReloadImpl: async () => {
        const text = readFileSync(moduleFile, "utf8");
        const targets = JSON.parse(/TARGETS: readonly string\[\] = (\[.*\]);/.exec(text)![1]);
        const token = /TOKEN = "([0-9a-f]+)"/.exec(text)![1];
        void fetch(`${targets[0]}/resultado/${token}`, { method: "POST", body: JSON.stringify({ error: "sin_sesion" }) });
        return true;
      },
    });
    assert.deepEqual(await broken.run("full", { timeoutMs: 10_000 }), { state: "error", error: "sin_sesion" });
    assert.equal(readFileSync(entry, "utf8"), ORIGINAL);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});
