import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPrompter } from "../../../tools/transfer/prompt.mjs";

/** Entrada interactiva de las herramientas del traslado: una sola sesión de lectura, secretos ocultos y nada perdido entre preguntas (con una terminal simulada y datos ficticios). */

const ROOT = join(import.meta.dirname, "..", "..", "..");

function fakeTerminal() {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    raw: false,
    paused: true,
    rawChanges: [] as boolean[],
    setEncoding() {},
    setRawMode(value: boolean) { this.raw = value; this.rawChanges.push(value); },
    resume() { this.paused = false; },
    pause() { this.paused = true; },
  });
  const shown: string[] = [];
  const output = { write(text: string) { shown.push(text); return true; } };
  const type = (text: string) => input.emit("data", text);
  const tick = () => new Promise((r) => setImmediate(r));
  return { input, output, shown, type, tick, screen: () => shown.join("") };
}

test("correo, contraseña oculta, frase oculta y repetición, una tras otra, sin cerrar stdin", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const email = p.ask("Correo: ", false);
  await t.tick();
  t.type("ficticio@example.invalid\r");
  assert.equal(await email, "ficticio@example.invalid");
  const password = p.ask("Contraseña: ", true);
  await t.tick();
  t.type("clave-ficticia-1\r");
  assert.equal(await password, "clave-ficticia-1");
  const phrase = p.ask("Frase: ", true);
  await t.tick();
  t.type("frase ficticia larga\r");
  assert.equal(await phrase, "frase ficticia larga");
  const again = p.ask("Repetí: ", true);
  await t.tick();
  t.type("frase ficticia larga\r");
  assert.equal(await again, "frase ficticia larga");
  assert.equal(t.input.paused, false, "stdin sigue activo mientras dura el comando");
  assert.deepEqual(t.input.rawChanges, [true], "la terminal entra en modo crudo una sola vez");
  p.close();
  assert.equal(t.input.paused, true);
  assert.equal(t.input.raw, false, "la terminal se restaura");
  assert.equal(t.input.listenerCount("data"), 0);
});

test("los secretos no se muestran nunca; lo no secreto sí", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const a = p.ask("Correo: ", false);
  await t.tick();
  t.type("visible@example.invalid\r");
  await a;
  const b = p.ask("Contraseña: ", true);
  await t.tick();
  t.type("secreto-ficticio-XYZ\r");
  await b;
  const screen = t.screen();
  assert.equal(screen.includes("secreto-ficticio-XYZ"), false);
  assert.equal(screen.replace(/Contraseña: |\r\n|visible@example\.invalid|Correo: /g, ""), "", "de la contraseña no se escribió ni un carácter");
  assert.ok(screen.includes("visible@example.invalid"));
});

test("un pegado de varias líneas (o \\r\\n) no se pierde: cada pregunta toma la suya", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const first = p.ask("1: ", false);
  await t.tick();
  t.type("uno\r\ndos\r\ntres\ncuatro\r");
  assert.equal(await first, "uno");
  assert.equal(await p.ask("2: ", true), "dos");
  assert.equal(await p.ask("3: ", true), "tres");
  assert.equal(await p.ask("4: ", true), "cuatro");
  p.close();
});

test("lo tecleado antes de que llegue la pregunta se conserva en la cola", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const first = p.ask("1: ", false);
  await t.tick();
  t.type("a\r");
  await first;
  t.type("adelantada\r"); // todavía no hay pregunta pendiente
  assert.equal(await p.ask("2: ", true), "adelantada");
  p.close();
});

test("respuesta que llega en fragmentos, con retroceso y con teclas especiales descartadas", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const answer = p.ask("x: ", false);
  await t.tick();
  t.type("ab");
  t.type("cX\x7f"); // retroceso borra la X
  t.type("\x1b[A\x1b[D"); // flechas: se ignoran
  t.type("\x1b[");
  t.type("Cñ\r"); // secuencia partida en dos fragmentos + carácter no ASCII
  assert.equal(await answer, "abcñ");
  p.close();
});

test("Ctrl+C y Ctrl+D (respuesta vacía) cancelan sin hacer nada y sin colgar", async () => {
  const t = fakeTerminal();
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  const a = p.ask("a: ", true);
  await t.tick();
  t.type("algo\x03");
  await assert.rejects(a, /Cancelado/);
  const b = p.ask("b: ", true);
  await t.tick();
  t.type("\x04");
  await assert.rejects(b, /Cancelado/);
  p.close();
});

test("sin terminal interactiva no pregunta ni lee nada", async () => {
  const t = fakeTerminal();
  (t.input as { isTTY: boolean }).isTTY = false;
  const p = createPrompter({ input: t.input as never, output: t.output as never });
  await assert.rejects(p.ask("x: ", true), /terminal interactiva/);
  assert.equal(t.input.paused, true);
  assert.equal(t.screen(), "");
});

test("el ensayo real y la herramienta de copias también usan el módulo único (y el ensayo devuelve la terminal a su modo normal tras la frase)", () => {
  const rehearsal = readFileSync(join(ROOT, "supabase", "tests", "postgres", "real_rehearsal.cjs"), "utf8");
  assert.match(rehearsal, /tools\/transfer\/prompt\.mjs/);
  assert.match(rehearsal, /prompter\.close\(\)/);
  assert.doesNotMatch(rehearsal, /createInterface|require\("readline"\)/);
  const copies = readFileSync(join(ROOT, "tools", "secure-copy", "secure-copy.mjs"), "utf8");
  assert.match(copies, /createPrompter/);
  assert.doesNotMatch(copies, /createInterface|node:readline/);
  assert.match(copies, /terminal recibió/, "verify diagnostica sin mostrar la frase");
});

test("las cuatro herramientas usan el módulo único: ninguna crea ni cierra un readline por pregunta", () => {
  for (const file of ["export-account", "freeze-legacy", "compare-copies", "origin-delta"]) {
    const source = readFileSync(join(ROOT, "tools", "transfer", `${file}.mjs`), "utf8");
    assert.match(source, /createPrompter/, file);
    assert.match(source, /prompter\.close\(\)/, file);
    assert.doesNotMatch(source, /createInterface|node:readline/, file);
  }
  const shared = readFileSync(join(ROOT, "tools", "transfer", "prompt.mjs"), "utf8");
  assert.doesNotMatch(shared, /createInterface|process\.argv|process\.env|console\./, "no usa argumentos, variables visibles ni registros");
});
