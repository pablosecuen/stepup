import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildTempModule, createReceiver, IMPORT_LINE, lanAddresses, setImport } from "../../../tools/phone-extraction/auto-review.mjs";

/** Revisión automática temporal: sólo lectura, resultado privado en la red local, se deshace sola. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const RESULT = { counts: { lesson_attachment: { total: 1 } }, formats: {}, gates: {}, unreadable: 0 };

async function listen(token: string, onResult: (r: unknown) => void) {
  const server = createReceiver({ token, onResult });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("el receptor acepta UN resultado con la clave correcta y rechaza todo lo demás", async () => {
  const received: unknown[] = [];
  const { server, base } = await listen("clave123", (r) => received.push(r));
  try {
    const post = (path: string, body: string, method = "POST") => fetch(base + path, { method, body: method === "POST" ? body : undefined });
    assert.equal((await post("/revision/otra", JSON.stringify(RESULT))).status, 403, "clave incorrecta");
    assert.equal((await post("/otra-ruta", JSON.stringify(RESULT))).status, 403);
    assert.equal((await post("/revision/clave123", "", "GET")).status, 405);
    assert.equal((await post("/revision/clave123", "no es json")).status, 400);
    assert.equal((await post("/revision/clave123", JSON.stringify({ otra: 1 }))).status, 400, "sin cantidades no se acepta");
    assert.equal((await post("/revision/clave123", "x".repeat(70 * 1024))).status, 413);
    assert.equal(received.length, 0);
    assert.equal((await post("/revision/clave123", JSON.stringify(RESULT))).status, 200);
    assert.deepEqual(received, [RESULT]);
    assert.equal((await post("/revision/clave123", JSON.stringify(RESULT))).status, 409, "un solo uso");
    assert.equal(received.length, 1);
  } finally {
    server.close();
  }
});

test("sólo ofrece direcciones de red local", () => {
  const fake = {
    a: [{ family: "IPv4", internal: false, address: "192.168.100.11" }],
    b: [{ family: "IPv4", internal: false, address: "8.8.8.8" }],
    c: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    d: [{ family: "IPv6", internal: false, address: "fe80::1" }],
    e: [{ family: "IPv4", internal: false, address: "172.20.1.5" }],
  };
  assert.deepEqual(lanAddresses(fake as never), ["192.168.100.11", "172.20.1.5"]);
});

test("el módulo temporal es de sólo lectura: no usa la cuenta, no sube y devuelve cantidades (sin nombres de claves)", () => {
  const source = buildTempModule({ targets: ["http://192.168.100.11:47123"], token: "abc" });
  assert.match(source, /inspectPhoneFiles\(createPhoneReadDeps\(\)\)/);
  assert.doesNotMatch(source, /supabase|rpc|upload|runPhoneExtraction|createPhoneExtractionDeps|console\./i);
  assert.match(source, /unreadable: summary\.unreadable\.length/, "sólo la cantidad de claves ilegibles");
  assert.deepEqual([...source.matchAll(/fetch\(/g)].length, 1, "una sola salida de red");
  assert.match(source, /TARGETS: readonly string\[\] = \["http:\/\/192\.168\.100\.11:47123"\]/);
});

test("la línea de import se agrega y se quita dejando el archivo idéntico (LF y CRLF)", () => {
  for (const eol of ["\n", "\r\n"]) {
    const original = ["import React from 'react';", "import { x } from './x';", "", "const A = 1;", ""].join(eol);
    const withImport = setImport(original, true);
    assert.ok(withImport.includes(IMPORT_LINE));
    assert.equal(withImport.indexOf(IMPORT_LINE) < withImport.indexOf("const A"), true);
    assert.equal(setImport(withImport, false), original);
  }
});

test("la herramienta no puede copiar ni tocar la cuenta, y no pisa resultados anteriores", () => {
  const source = readFileSync(join(ROOT, "tools", "phone-extraction", "auto-review.mjs"), "utf8");
  assert.doesNotMatch(source, /__tfCopy|runPhoneExtraction|\.upload\(|rpc\(|supabase\./i);
  assert.match(source, /flag: "wx"/);
  assert.match(source, /server\.listen\(port, "0\.0\.0\.0"/);
});
