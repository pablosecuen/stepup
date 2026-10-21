import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewOnce, REVIEW_EXPRESSION, summarize } from "../../../tools/phone-extraction/drive-review.mjs";

/** Lanzar la revisión desde la computadora: una sola expresión fija, sólo lectura, con un depurador simulado. */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const RESULT = {
  counts: {
    lesson_attachment: { total: 80, found: 80, notFound: 0, declaredBytes: 178_000_000, actualBytes: 178_000_000, largestBytes: 4_800_000, overLimit: 0, sizeMismatch: 0, unreadable: 0 },
    material: { total: 0, found: 0, notFound: 0, declaredBytes: 0, actualBytes: 0, largestBytes: 0, overLimit: 0, sizeMismatch: 0, unreadable: 0 },
    report_pdf: { total: 0, found: 0, notFound: 0, declaredBytes: 0, actualBytes: 0, largestBytes: 0, overLimit: 0, sizeMismatch: 0, unreadable: 0 },
  },
  formats: { jpeg: 78, png: 2 },
  labelDiffersFromContent: 64,
  declaredHeicActuallyJpeg: 64,
  actuallyHeic: 0,
  materialsInLibrary: 0,
  reports: 0,
  gates: { pendingOperations: 0, activeClassSession: false },
  unreadable: [],
  limits: { lessonFilesBytes: 20971520, reportPdfBytes: 10485760 },
};

/** WebSocket de mentira que habla CDP: registra lo que se le envía. */
function fakeSocketClass(options: { hook: boolean; failEvaluate?: boolean }) {
  const sent: Array<{ id: number; method: string; params: Record<string, unknown> }> = [];
  class FakeSocket {
    private listeners: Array<(e: { data: string }) => void> = [];
    private onOpen: Array<() => void> = [];
    url: string;
    constructor(url: string) {
      this.url = url;
      queueMicrotask(() => this.onOpen.forEach((f) => f()));
    }
    addEventListener(type: string, fn: (e: never) => void) {
      if (type === "open") this.onOpen.push(fn as () => void);
      if (type === "message") this.listeners.push(fn as (e: { data: string }) => void);
    }
    removeEventListener(type: string, fn: unknown) {
      if (type === "message") this.listeners = this.listeners.filter((f) => f !== fn);
    }
    send(raw: string) {
      const message = JSON.parse(raw);
      sent.push(message);
      const reply = (result: unknown) => queueMicrotask(() => this.listeners.slice().forEach((f) => f({ data: JSON.stringify({ id: message.id, result }) })));
      if (message.method === "Runtime.enable") return reply({});
      const expression = message.params.expression as string;
      if (expression === "typeof globalThis.__tfReview") return reply({ result: { value: options.hook ? "function" : "undefined" } });
      if (expression === REVIEW_EXPRESSION) return reply(options.failEvaluate ? { exceptionDetails: { text: "Uncaught", exception: { description: "Error: fallo al leer" } } } : { result: { value: RESULT } });
      reply({});
    }
    close() {}
  }
  return { FakeSocket, sent };
}

const listOf = (pages: unknown[]) => async () => ({ json: async () => pages }) as Response;

test("sin Metro o sin teléfono conectado no ejecuta nada y lo dice", async () => {
  assert.deepEqual(await reviewOnce({ fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as never }), { state: "sin_metro" });
  assert.deepEqual(await reviewOnce({ fetchImpl: listOf([]) as never }), { state: "sin_telefono" });
});

test("con el teléfono conectado ejecuta SOLO la expresión fija de lectura y devuelve las cantidades", async () => {
  const { FakeSocket, sent } = fakeSocketClass({ hook: true });
  const outcome = await reviewOnce({ fetchImpl: listOf([{ webSocketDebuggerUrl: "ws://localhost:8081/inspector/debug?page=1" }]) as never, WebSocketImpl: FakeSocket as never });
  assert.equal(outcome.state, "listo");
  assert.deepEqual(outcome.result, RESULT);
  const expressions = sent.filter((m) => m.method === "Runtime.evaluate").map((m) => m.params.expression);
  assert.deepEqual(expressions, ["typeof globalThis.__tfReview", REVIEW_EXPRESSION], "ninguna otra expresión se ejecuta en el teléfono");
  assert.equal(REVIEW_EXPRESSION, "globalThis.__tfReview()");
});

test("una página sin el gancho (otra app) no se toca; un fallo en el teléfono se informa sin inventar resultados", async () => {
  const none = fakeSocketClass({ hook: false });
  assert.deepEqual(await reviewOnce({ fetchImpl: listOf([{ webSocketDebuggerUrl: "ws://x/1" }]) as never, WebSocketImpl: none.FakeSocket as never }), { state: "sin_gancho" });
  assert.equal(none.sent.some((m) => m.params?.expression === REVIEW_EXPRESSION), false);
  const failing = fakeSocketClass({ hook: true, failEvaluate: true });
  const outcome = await reviewOnce({ fetchImpl: listOf([{ webSocketDebuggerUrl: "ws://x/1" }]) as never, WebSocketImpl: failing.FakeSocket as never });
  assert.equal(outcome.state, "error");
  assert.match(String(outcome.message), /fallo al leer/);
});

test("el resumen impreso lleva sólo cantidades y tamaños, nunca nombres ni rutas", () => {
  const text = summarize(RESULT).join("\n");
  assert.match(text, /Adjuntos de clases: 80 en total · 80 encontrados · 0 no encontrados/);
  assert.match(text, /declarados HEIC que son JPEG: 64/);
  assert.doesNotMatch(text, /file:\/\/|\.heic|\.jpg|IMG_/i);
});

test("la herramienta no puede copiar ni modificar nada: sólo la expresión de revisión, sin subir ni escribir fuera del resultado", () => {
  const source = readFileSync(join(ROOT, "tools", "phone-extraction", "drive-review.mjs"), "utf8");
  assert.equal([...source.matchAll(/expression:\s*([^,}]+)/g)].map((m) => m[1].trim()).sort().join("|"), '"typeof globalThis.__tfReview"|REVIEW_EXPRESSION');
  assert.doesNotMatch(source, /__tfCopy|runPhoneExtraction|\.upload\(|rpc\(|supabase/i);
  assert.match(source, /flag: "wx"/, "no pisa un resultado anterior");
});
