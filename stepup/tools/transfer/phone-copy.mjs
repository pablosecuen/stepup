// Canal con el teléfono para copiar los archivos (paso 6 del traslado). Mismo método que la revisión automática: un módulo TEMPORAL en la app (`autoCopyTemp.ts`) que al cargar corre la
// copia no destructiva con la sesión de la propia cuenta del teléfono y devuelve SÓLO cantidades a un receptor local de un solo uso (clave aleatoria, sólo red local); la
// computadora pide a Metro que recargue la app y espera. Al terminar —con éxito, error o Ctrl+C— se borra el módulo y se deshace el cambio de la app (se comprueba que la app quedó igual).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lanAddresses, requestReload } from "../phone-extraction/auto-review.mjs";
import { buildCopyModule, COPY_IMPORT_LINE, COPY_TEMP_MODULE, parsePhoneCopyReport, parsePhoneProtectionReport } from "../../lib/transfer/phone-copy-module.ts";

/** Agrega (o quita) una línea de import tras el último import de un archivo, respetando LF/CRLF. */
export function setImportLine(source, line, enabled) {
  const crlf = source.includes("\r\n");
  const lines = source.replace(/\r\n/g, "\n").split("\n").filter((l) => l !== line);
  if (enabled) {
    const last = lines.map((l) => /^import /.test(l)).lastIndexOf(true);
    lines.splice(last + 1, 0, line);
  }
  const text = lines.join("\n");
  return crlf ? text.replace(/\n/g, "\r\n") : text;
}

/** Receptor de un solo uso: `/progreso/<clave>` (avance) y `/resultado/<clave>` (resultado final, una sola vez). */
export function createCopyReceiver({ token, onProgress, onResult }) {
  let done = false;
  return createServer((req, res) => {
    const reply = (code) => {
      res.writeHead(code, { "Content-Type": "text/plain" });
      res.end(code === 200 ? "ok" : "");
    };
    const match = /^\/(progreso|resultado)\/([0-9a-f]+)$/.exec(req.url ?? "");
    if (!match || match[2] !== token) return reply(403);
    if (req.method !== "POST") return reply(405);
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 256 * 1024) {
        reply(413);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (size > 256 * 1024) return;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(400);
      }
      if (match[1] === "progreso") {
        if (typeof value?.done === "number" && typeof value?.total === "number") onProgress(value);
        return reply(200);
      }
      if (done) return reply(409);
      done = true;
      reply(200);
      onResult(value);
    });
  });
}

export function createPhoneChannel({ appDir, metroPort = 8082, log = () => {}, requestReloadImpl = requestReload, firstSignalMs = 4 * 60_000, stallMs = 5 * 60_000, addresses = lanAddresses() }) {
  const transferDir = join(appDir, "src", "features", "transfer");
  const entryFile = join(transferDir, "PhoneTransferEntry.tsx");
  const moduleFile = join(transferDir, COPY_TEMP_MODULE);

  const channel = {
    async run(mode, { timeoutMs }) {
      if (!existsSync(entryFile)) return { state: "error", error: "app_sin_parche" };
      if (addresses.length === 0) return { state: "error", error: "sin_red_local" };
      const original = readFileSync(entryFile, "utf8");
      const token = randomBytes(16).toString("hex");
      const port = 47000 + Math.floor(Math.random() * 1000);
      const targets = addresses.map((a) => `http://${a}:${port}`);
      let lastSignal = Date.now();
      let sawSignal = false;
      let finish;
      const finished = new Promise((r) => (finish = r));
      const server = createCopyReceiver({
        token,
        onProgress: ({ done, total }) => {
          sawSignal = true;
          lastSignal = Date.now();
          log(`  teléfono: ${done}/${total} archivos`);
        },
        onResult: (value) => {
          if (mode === "protection") {
            const protection = parsePhoneProtectionReport(value);
            finish(protection.ok ? { state: "listo", protection: protection.report } : { state: "error", error: protection.error });
            return;
          }
          const parsed = parsePhoneCopyReport(value);
          finish(parsed.ok ? { state: "listo", report: parsed.report } : { state: "error", error: parsed.error });
        },
      });
      const cleanup = () => {
        try {
          rmSync(moduleFile, { force: true });
          writeFileSync(entryFile, setImportLine(readFileSync(entryFile, "utf8"), COPY_IMPORT_LINE, false));
        } catch {
          /* se verifica abajo */
        }
        server.close();
      };
      const onSigint = () => {
        cleanup();
        process.exit(130);
      };
      process.once("SIGINT", onSigint);
      try {
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, "0.0.0.0", resolve);
        });
        writeFileSync(moduleFile, buildCopyModule({ targets, token, mode }));
        writeFileSync(entryFile, setImportLine(original, COPY_IMPORT_LINE, true));
        const reloaded = await requestReloadImpl({ port: metroPort });
        log(reloaded ? "Se pidió a Metro que recargue la app: el teléfono empieza solo." : "No se pudo pedir la recarga a Metro: recargá la app desde el teléfono (sacudir → Reload).");
        const deadline = Date.now() + timeoutMs;
        const watchdog = setInterval(() => {
          const now = Date.now();
          if (now > deadline) finish({ state: "sin_respuesta" });
          else if (!sawSignal && now - lastSignal > firstSignalMs) finish({ state: "sin_respuesta" });
          else if (sawSignal && now - lastSignal > stallMs) finish({ state: "sin_respuesta" });
        }, 1000);
        const outcome = await finished;
        clearInterval(watchdog);
        return outcome;
      } finally {
        process.removeListener("SIGINT", onSigint);
        cleanup();
        const restored = existsSync(entryFile) && readFileSync(entryFile, "utf8") === original && !existsSync(moduleFile);
        if (!restored) log("AVISO: la app no quedó idéntica a antes de la copia; revisar src/features/transfer.");
      }
    },
  };
  /** Lectura de sólo lectura del marcador de protección de datos del teléfono. */
  channel.checkProtection = (options) => channel.run("protection", options);
  return channel;
}
