// Lanza la REVISIÓN SIN COPIAR en el teléfono desde la computadora, con el depurador de Expo (Metro), sin tocar la pantalla del teléfono.
//
//   node tools/phone-extraction/drive-review.mjs [--port 8081] [--espera-min 180]
//
// Espera a que el teléfono se conecte a Metro (basta con abrir el proyecto en Expo Go) y ejecuta UNA sola expresión fija: `globalThis.__tfReview()`, el gancho de SÓLO LECTURA del parche
// (lee las claves y los archivos del teléfono y devuelve cantidades; no usa la cuenta ni la red, no sube, no borra ni cambia nada). Guarda el resultado (sólo cantidades) junto a las
// copias privadas. No hay ningún gancho de copia: esta herramienta no puede subir ni modificar nada.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

/** La ÚNICA expresión que se ejecuta en el teléfono. */
export const REVIEW_EXPRESSION = "globalThis.__tfReview()";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una llamada de Chrome DevTools Protocol sobre un WebSocket ya abierto. */
function callCdp(ws, id, method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMessage);
      reject(new Error(`sin respuesta a ${method}`));
    }, timeoutMs);
    function onMessage(event) {
      let message;
      try {
        message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message ?? "error del depurador"));
      else resolve(message.result);
    }
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function openSocket(url, WebSocketImpl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", () => reject(new Error("no se pudo abrir el depurador")));
  });
}

/** Intenta la revisión en cada página que Metro lista; devuelve el resultado de la primera que tiene el gancho. */
export async function reviewOnce({ port = 8081, fetchImpl = fetch, WebSocketImpl = WebSocket, evaluateTimeoutMs = 15 * 60_000 } = {}) {
  let pages;
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/json/list`);
    pages = await response.json();
  } catch {
    return { state: "sin_metro" };
  }
  if (!Array.isArray(pages) || pages.length === 0) return { state: "sin_telefono" };
  for (const page of pages) {
    if (typeof page.webSocketDebuggerUrl !== "string") continue;
    let ws;
    try {
      ws = await openSocket(page.webSocketDebuggerUrl, WebSocketImpl);
      await callCdp(ws, 1, "Runtime.enable", {}, 15_000);
      const probe = await callCdp(ws, 2, "Runtime.evaluate", { expression: "typeof globalThis.__tfReview", returnByValue: true }, 15_000);
      if (probe?.result?.value !== "function") continue;
      const done = await callCdp(ws, 3, "Runtime.evaluate", { expression: REVIEW_EXPRESSION, awaitPromise: true, returnByValue: true }, evaluateTimeoutMs);
      if (done.exceptionDetails) return { state: "error", message: String(done.exceptionDetails.exception?.description ?? done.exceptionDetails.text ?? "error en el teléfono").slice(0, 300) };
      return { state: "listo", result: done.result?.value };
    } catch (error) {
      return { state: "error", message: String(error.message).slice(0, 300) };
    } finally {
      try {
        ws?.close();
      } catch {
        /* ya cerrado */
      }
    }
  }
  return { state: "sin_gancho" };
}

export function summarize(result) {
  const lines = [];
  for (const [kind, label] of [["lesson_attachment", "Adjuntos de clases"], ["material", "Materiales con archivo"], ["report_pdf", "PDF de reportes"]]) {
    const c = result.counts[kind];
    lines.push(`${label}: ${c.total} en total · ${c.found} encontrados · ${c.notFound} no encontrados · ${(c.actualBytes / 1048576).toFixed(1)} MB medidos (declarados ${(c.declaredBytes / 1048576).toFixed(1)} MB) · mayor ${(c.largestBytes / 1048576).toFixed(2)} MB · sobre el tope ${c.overLimit} · tamaño distinto ${c.sizeMismatch} · sin poder leer ${c.unreadable}`);
  }
  lines.push(`Formato real: ${Object.entries(result.formats).map(([k, n]) => `${k} ${n}`).join(", ") || "ninguno"} · declarados HEIC que son JPEG: ${result.declaredHeicActuallyJpeg} · HEIC de verdad: ${result.actuallyHeic} · con formato distinto al declarado: ${result.labelDiffersFromContent}`);
  lines.push(`Biblioteca de materiales: ${result.materialsInLibrary} · reportes: ${result.reports} · operaciones pendientes: ${result.gates.pendingOperations} · clase en curso: ${result.gates.activeClassSession ? "sí" : "no"}`);
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
  };
  const port = Number(option("--port", "8081"));
  const waitMinutes = Number(option("--espera-min", "180"));
  const deadline = Date.now() + waitMinutes * 60_000;
  let last = "";
  while (Date.now() < deadline) {
    const outcome = await reviewOnce({ port });
    if (outcome.state === "listo") {
      const folder = join(homedir(), "TeacherFlow-copias-privadas");
      mkdirSync(folder, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = join(folder, `revision-telefono-${stamp}.json`);
      writeFileSync(file, JSON.stringify({ takenAt: new Date().toISOString(), result: outcome.result }, null, 2), { flag: "wx" });
      console.log("REVISIÓN TERMINADA (sólo lectura; no se copió ni se cambió nada).");
      for (const line of summarize(outcome.result)) console.log(line);
      console.log(`Resultado guardado en ${file}`);
      return 0;
    }
    if (outcome.state === "error") {
      console.log(`Error en el teléfono: ${outcome.message}`);
      return 1;
    }
    const message = { sin_metro: "Esperando a Metro…", sin_telefono: "Esperando que el teléfono abra el proyecto en Expo Go…", sin_gancho: "El teléfono está conectado pero todavía no cargó el parche; esperando…" }[outcome.state];
    if (message !== last) console.log(message);
    last = message;
    await sleep(3000);
  }
  console.log("Se agotó la espera sin que el teléfono se conectara.");
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main();
}
