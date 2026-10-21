// Entrada interactiva compartida por las herramientas del traslado (correo, contraseña oculta, frase oculta, confirmaciones).
//
// UNA sola sesión de lectura para todo el comando: la terminal se pasa a modo «crudo» al empezar y se restaura al terminar, y stdin NO se cierra entre pregunta y pregunta
// (crear y cerrar una interfaz readline por pregunta dejaba stdin pausado y el proceso moría con «unsettled top-level await»). Lo que se escribe o se pega de más no se pierde:
// queda en una cola y lo consume la pregunta siguiente. Los secretos (hidden) no se muestran, no se escriben en ningún lado y no pasan por argumentos ni variables.
import { SecureCopyError } from "../../lib/secure-copy/secure-copy.ts";

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let queue = ""; // caracteres recibidos que ninguna pregunta consumió todavía
  let waiting = null; // { hidden, answer, resolve, reject }
  let started = false;
  let skipLineFeed = false; // tras un \r, el \n de un \r\n pegado no es otra respuesta vacía

  const finish = (settle, value) => {
    const current = waiting;
    waiting = null;
    output.write("\r\n");
    settle === "resolve" ? current.resolve(value) : current.reject(value);
  };
  const cancelled = () => new SecureCopyError("exists", "Cancelado desde el teclado: no se hizo nada.");

  function pump() {
    while (queue.length) {
      const ch = queue[0];
      if (ch === "\x03") { // Ctrl+C: nunca se ignora, haya o no una pregunta pendiente
        queue = "";
        if (waiting) return finish("reject", cancelled());
        close();
        output.write("\r\n");
        process.exit(130);
      }
      if (!waiting) return; // el resto espera a la próxima pregunta
      if (ch === "\x1b") { // teclas especiales (flechas, etc.): se descartan enteras
        if (queue.length < 2) return;
        if (queue[1] !== "[" && queue[1] !== "O") { queue = queue.slice(1); continue; }
        const end = queue.slice(2).search(/[@-~]/);
        if (end === -1) return; // la secuencia llega en otro fragmento
        queue = queue.slice(end + 3);
        continue;
      }
      queue = queue.slice(1);
      if (ch === "\n" && skipLineFeed) { skipLineFeed = false; continue; }
      skipLineFeed = false;
      if (ch === "\r" || ch === "\n") {
        skipLineFeed = ch === "\r";
        return finish("resolve", waiting.answer);
      }
      if (ch === "\x04" && waiting.answer === "") return finish("reject", cancelled()); // Ctrl+D con la respuesta vacía
      if (ch === "\x7f" || ch === "\b") {
        const chars = Array.from(waiting.answer);
        if (chars.length) {
          chars.pop();
          waiting.answer = chars.join("");
          if (!waiting.hidden) output.write("\b \b");
        }
        continue;
      }
      if (ch < " ") continue; // otros caracteres de control
      waiting.answer += ch;
      if (!waiting.hidden) output.write(ch);
    }
  }

  function onData(chunk) {
    queue += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    pump();
  }

  function start() {
    if (started) return;
    if (!input.isTTY) throw new SecureCopyError("weak_passphrase", "Hace falta una terminal interactiva (corré el comando en tu propia terminal).");
    started = true;
    input.setEncoding?.("utf8");
    input.setRawMode(true);
    input.on("data", onData);
    input.resume(); // stdin sigue abierto y activo todo el comando: eso es lo que mantiene vivo el proceso mientras se espera una respuesta
  }

  function close() {
    if (!started) return;
    started = false;
    input.removeListener("data", onData);
    try { input.setRawMode(false); } catch { /* la terminal ya no existe */ }
    input.pause();
  }

  /** Pregunta y devuelve la respuesta escrita. Con hidden no se muestra nada de lo que se teclea. */
  function ask(question, hidden = false) {
    return new Promise((resolveAnswer, reject) => {
      try {
        start();
      } catch (error) {
        return reject(error);
      }
      if (waiting) return reject(new Error("Ya hay una pregunta pendiente."));
      output.write(question);
      waiting = { hidden: Boolean(hidden), answer: "", resolve: resolveAnswer, reject };
      pump();
    });
  }

  return { ask, close };
}
