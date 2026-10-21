// Revisión automática TEMPORAL de sólo lectura, para cuando el depurador de Expo Go no permite dispararla desde la computadora.
//
//   node tools/phone-extraction/auto-review.mjs --app <carpeta de la app> [--puerto-metro 8082] [--espera-min 30]
//
// 1. Abre un receptor local (sólo la red local) con una clave de un solo uso.
// 2. Agrega a la app un módulo TEMPORAL que, al cargar, hace la misma revisión de sólo lectura (`inspectPhoneFiles` con `createPhoneReadDeps`:
//    no usa la cuenta, no sube, no borra, no cambia nada) y devuelve SÓLO CANTIDADES a este receptor. No escribe en consola ni en ningún registro.
// 3. Pide a Metro que recargue la app (mensaje de desarrollo `reload`).
// 4. Al recibir el resultado lo guarda junto a las copias privadas, deshace el cambio de la app (módulo + línea de import) y termina.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "./drive-review.mjs";

export const TEMP_MODULE = "autoReviewTemp.ts";
export const IMPORT_LINE = "import './autoReviewTemp';";
const MAX_BODY = 64 * 1024;

/** Direcciones IPv4 privadas de esta computadora (las únicas a las que el teléfono puede llegar sin salir a internet). */
export function lanAddresses(interfaces = networkInterfaces()) {
  const out = [];
  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (item.family !== "IPv4" || item.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) out.push(item.address);
    }
  }
  return out;
}

/** Texto del módulo temporal que se agrega a la app. */
export function buildTempModule({ targets, token }) {
  return `// TEMPORAL — revisión automática de SÓLO LECTURA. Se borra sola al terminar. Devuelve únicamente cantidades a la computadora local.
import { inspectPhoneFiles } from './phoneExtraction/runner';
import { createPhoneReadDeps } from './phoneExtractionDeps';

const TARGETS: readonly string[] = ${JSON.stringify(targets)};
const TOKEN = ${JSON.stringify(token)};

async function send(base: string, body: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(base + '/revision/' + TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function autoReview(): Promise<void> {
  try {
    const summary = await inspectPhoneFiles(createPhoneReadDeps());
    const body = JSON.stringify({ ...summary, unreadable: summary.unreadable.length });
    for (const base of TARGETS) {
      if (await send(base, body)) return;
    }
  } catch {
    // sin registro: no hay nada que informar fuera de la computadora
  }
}

setTimeout(() => {
  void autoReview();
}, 6000);
`;
}

/** Receptor de un solo uso: acepta UN resultado con la clave correcta y se cierra. */
export function createReceiver({ token, onResult }) {
  let done = false;
  const server = createServer((req, res) => {
    const reply = (code, text = "") => {
      res.writeHead(code, { "Content-Type": "text/plain" });
      res.end(text);
    };
    if (req.url !== `/revision/${token}`) return reply(403);
    if (req.method !== "POST") return reply(405);
    if (done) return reply(409);
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reply(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY || done) return;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(400);
      }
      if (!value || typeof value !== "object" || !value.counts) return reply(400);
      done = true;
      reply(200, "ok");
      onResult(value);
    });
  });
  return server;
}

/** Agrega (o quita) la línea de import del módulo temporal en PhoneTransferEntry.tsx. */
export function setImport(source, enabled) {
  const normalized = source.replace(/\r\n/g, "\n");
  const crlf = source.includes("\r\n");
  const lines = normalized.split("\n").filter((line) => line !== IMPORT_LINE);
  if (enabled) {
    const last = lines.map((l) => /^import /.test(l)).lastIndexOf(true);
    lines.splice(last + 1, 0, IMPORT_LINE);
  }
  const text = lines.join("\n");
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Pide a Metro que recargue la app conectada (canal de mensajes de desarrollo). */
export async function requestReload({ port, WebSocketImpl = WebSocket }) {
  return new Promise((resolve) => {
    let ws;
    const timer = setTimeout(() => resolve(false), 8000);
    try {
      ws = new WebSocketImpl(`ws://127.0.0.1:${port}/message`);
    } catch {
      clearTimeout(timer);
      return resolve(false);
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ version: 2, method: "reload" }));
      setTimeout(() => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ya cerrado */
        }
        resolve(true);
      }, 1000);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const appDir = option("--app", "");
  if (!appDir) {
    console.log("Falta --app <carpeta de la app>.");
    return 1;
  }
  const transferDir = join(appDir, "src", "features", "transfer");
  const entryFile = join(transferDir, "PhoneTransferEntry.tsx");
  const moduleFile = join(transferDir, TEMP_MODULE);
  if (!existsSync(entryFile)) {
    console.log("No se encuentra PhoneTransferEntry.tsx en la app.");
    return 1;
  }
  const metroPort = Number(option("--puerto-metro", "8082"));
  const waitMinutes = Number(option("--espera-min", "30"));
  const addresses = lanAddresses();
  if (addresses.length === 0) {
    console.log("Esta computadora no tiene una dirección de red local.");
    return 1;
  }
  const token = randomBytes(16).toString("hex");
  const port = 47000 + Math.floor(Math.random() * 1000);
  const targets = addresses.map((address) => `http://${address}:${port}`);
  const originalEntry = readFileSync(entryFile, "utf8");

  let finish;
  const finished = new Promise((resolve) => (finish = resolve));
  const server = createReceiver({
    token,
    onResult: (result) => {
      const folder = join(homedir(), "TeacherFlow-copias-privadas");
      mkdirSync(folder, { recursive: true });
      const file = join(folder, `revision-telefono-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), result }, null, 2), { flag: "wx" });
      console.log("REVISIÓN TERMINADA (sólo lectura; no se copió ni se cambió nada).");
      for (const line of summarize(result)) console.log(line);
      console.log(`Resultado guardado en ${file}`);
      finish(0);
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  const cleanup = () => {
    try {
      rmSync(moduleFile, { force: true });
      writeFileSync(entryFile, setImport(readFileSync(entryFile, "utf8"), false));
    } catch {
      /* se informa abajo si queda algo */
    }
    server.close();
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  writeFileSync(moduleFile, buildTempModule({ targets, token }));
  writeFileSync(entryFile, setImport(originalEntry, true));
  console.log(`Receptor escuchando en el puerto ${port} (sólo red local, clave de un solo uso). Módulo temporal agregado a la app.`);
  const reloaded = await requestReload({ port: metroPort });
  console.log(reloaded ? "Se pidió a Metro que recargue la app." : "No se pudo pedir la recarga a Metro (la app debe recargarse sola o desde el teléfono).");
  const timer = setTimeout(() => finish(2), waitMinutes * 60_000);
  const code = await finished;
  clearTimeout(timer);
  cleanup();
  if (code === 2) console.log("Se agotó la espera sin recibir el resultado; el cambio temporal de la app fue deshecho.");
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
